import * as THREE from 'three';
import { CLIMATE, Soil, SoilMode, SOIL_EVOLVE, WORLD } from '../config.js';
import { fbm } from '../utils/noise.js';

const SOIL_ORDER = [Soil.GRASSLAND, Soil.SAND, Soil.ROCK, Soil.WATER];
const SOIL_COLORS = {
  [Soil.GRASSLAND]: 0x5f9e3d,
  [Soil.SAND]: 0xdcc88e,
  [Soil.ROCK]: 0x808086,
  [Soil.WATER]: 0x7d7455,
};

const IDX_GRASS = 0;
const IDX_SAND = 1;
const IDX_ROCK = 2;
const IDX_WATER = 3;

const LAND_LIMIT = 0.95;
const SAND_LIMIT = 0.8;
const POND_SOIL_RADIUS = 0.07;
const ROCK_THRESHOLD = 0.62;

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smoothstep = (edge0, edge1, x) => {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

export class Island {
  constructor(scene, climate) {
    this.climate = climate;
    this.paintedKey = '';
    this.radius = WORLD.islandRadius;
    this.extent = this.radius * 1.2;
    this.soilMode = SoilMode.MIXED;
    this.soilDirty = false;
    this.evolvePhase = 0;
    /** false w testach headless — pomija kosztowny vertex paint */
    this.paintEnabled = true;

    this.#buildSoilGrid();
    this.terrain = this.#buildTerrain();
    this.water = this.#buildWater();
    scene.add(this.terrain, this.water);
  }

  heightAt(x, z) {
    const radial = Math.hypot(x, z) / this.radius;
    const base = clamp01((LAND_LIMIT - this.#shore(x, z)) / LAND_LIMIT);
    const relief = fbm(x * 0.09 - 11, z * 0.09 + 5);
    const rockBump = smoothstep(ROCK_THRESHOLD, 0.8, this.#rockNoise(x, z));
    const pond = 1 - smoothstep(0.06, 0.12, radial);
    return Math.pow(base, 0.7) * 4 + (relief - 0.5) * 1.6 * base + rockBump * 1.4 * base - pond * 5.5 - 0.5;
  }

  soilAt(x, z) {
    const gx = Math.floor((x + this.extent) / WORLD.soilGridCell);
    const gz = Math.floor((z + this.extent) / WORLD.soilGridCell);
    if (gx < 0 || gz < 0 || gx >= this.gridSize || gz >= this.gridSize) return Soil.WATER;
    const natural = SOIL_ORDER[this.soilGrid[gz * this.gridSize + gx]];
    if (natural === Soil.WATER || this.soilMode === SoilMode.MIXED) return natural;
    return this.soilMode;
  }

  setSoilMode(mode) {
    if (mode === this.soilMode) return;
    this.soilMode = mode;
    this.#paint(this.terrain.geometry);
  }

  refreshClimate() {
    if (this.paintedKey === this.climate.key && !this.soilDirty) return;
    if (!this.paintEnabled) {
      this.paintedKey = this.climate.key;
      this.soilDirty = false;
      return;
    }
    this.#paint(this.terrain.geometry);
    this.soilDirty = false;
  }

  /**
   * Czy wolno sadzić roślinę w (x,z): nie woda, nie stromy brzeg, nie pas wybrzeża/stawu.
   */
  canPlantAt(x, z) {
    const soil = this.soilAt(x, z);
    if (soil === Soil.WATER) return false;

    const radial = Math.hypot(x, z) / this.radius;
    if (radial < SOIL_EVOLVE.pondPlantMinRadial) return false;

    const shore = this.#shore(x, z);
    // Blisko linii morza (WATER zaczyna się ~LAND_LIMIT)
    if (shore > LAND_LIMIT - SOIL_EVOLVE.coastBuffer / this.radius) return false;

    const d = SOIL_EVOLVE.slopeSample;
    const h = this.heightAt(x, z);
    const gx = Math.abs(this.heightAt(x + d, z) - this.heightAt(x - d, z)) / (2 * d);
    const gz = Math.abs(this.heightAt(x, z + d) - this.heightAt(x, z - d)) / (2 * d);
    const slope = Math.hypot(gx, gz);
    if (slope > SOIL_EVOLVE.maxSlope) return false;

    // Bardzo nisko względem wody (płaski mesh wody ~0) — unikaj „w wodzie”
    if (h < 0.15) return false;

    return true;
  }

  /**
   * Ewolucja typów gleby (tylko Mixed).
   * @param {number} dt
   * @param {{ soilMoisture: number, windSpeed: number, coverAt: (x:number,z:number)=>number }} ctx
   */
  evolveSoil(dt, ctx) {
    if (this.soilMode !== SoilMode.MIXED) return 0;
    const size = this.gridSize;
    const n = size * size;
    const cell = WORLD.soilGridCell;
    const extent = this.extent;
    const stride = SOIL_EVOLVE.cellStride;
    const phase = this.evolvePhase % stride;
    this.evolvePhase++;
    // Kompensacja stride: każda komórka dostaje update rzadziej
    const stepDt = dt * stride;
    let changed = 0;

    for (let i = phase; i < n; i += stride) {
      const type = this.soilGrid[i];
      if (type === IDX_WATER) continue;

      const gz = (i / size) | 0;
      const gx = i - gz * size;
      const x = -extent + (gx + 0.5) * cell;
      const z = -extent + (gz + 0.5) * cell;
      const cover = ctx.coverAt(x, z);
      const wet = localSoilWet(x, z, ctx.soilMoisture);
      const windNorm = clamp01(ctx.windSpeed / 1.5);
      const erosion = windNorm * (1 - cover);

      let rate = 0;
      let target = type;

      if (type === IDX_ROCK) {
        if (wet >= SOIL_EVOLVE.wetForGrowth && cover >= SOIL_EVOLVE.coverForGrowth) {
          rate = SOIL_EVOLVE.rockToGrassRate * ((wet - SOIL_EVOLVE.wetForGrowth) / 0.55 + cover);
          target = IDX_GRASS;
        }
      } else if (type === IDX_GRASS) {
        if (
          wet <= SOIL_EVOLVE.dryForErosion
          && cover <= SOIL_EVOLVE.coverMaxErosion
          && ctx.windSpeed >= SOIL_EVOLVE.windForErosion
        ) {
          rate = SOIL_EVOLVE.grassToSandRate * erosion * (1 - wet);
          target = IDX_SAND;
        }
      } else if (type === IDX_SAND) {
        if (wet >= SOIL_EVOLVE.wetForGrowth && cover >= SOIL_EVOLVE.coverForGrowth && erosion < 0.35) {
          rate = SOIL_EVOLVE.sandToGrassRate * wet * cover;
          target = IDX_GRASS;
        }
      }

      if (rate <= 0 || target === type) {
        this.soilProgress[i] = Math.max(0, this.soilProgress[i] - stepDt * 0.01);
        continue;
      }

      if (this.soilTarget[i] !== target) {
        this.soilTarget[i] = target;
        this.soilProgress[i] = 0;
      }

      this.soilProgress[i] += rate * stepDt;
      if (this.soilProgress[i] >= 1) {
        this.soilGrid[i] = target;
        this.soilProgress[i] = 0;
        this.soilTarget[i] = target;
        changed++;
      }
    }

    if (changed > 0) this.soilDirty = true;
    return changed;
  }

  createSoilSnapshot() {
    return {
      grid: this.soilGrid.slice(),
      progress: this.soilProgress.slice(),
      target: this.soilTarget.slice(),
      mode: this.soilMode,
      evolvePhase: this.evolvePhase,
    };
  }

  restoreSoilSnapshot(snapshot) {
    if (!snapshot) return;
    this.soilGrid.set(snapshot.grid);
    this.soilProgress.set(snapshot.progress);
    this.soilTarget.set(snapshot.target);
    this.soilMode = snapshot.mode;
    this.evolvePhase = snapshot.evolvePhase ?? 0;
    this.soilDirty = true;
    this.refreshClimate();
  }

  #shore(x, z) {
    return Math.hypot(x, z) / this.radius + (fbm(x * 0.04 + 3.1, z * 0.04 - 7.7) - 0.5) * 0.35;
  }

  #rockNoise(x, z) {
    return fbm(x * 0.07 + 40, z * 0.07 - 17);
  }

  #classify(x, z) {
    const radial = Math.hypot(x, z) / this.radius;
    const shore = this.#shore(x, z);
    if (shore > LAND_LIMIT || radial < POND_SOIL_RADIUS) return Soil.WATER;
    if (shore > SAND_LIMIT) return Soil.SAND;
    if (this.#rockNoise(x, z) > ROCK_THRESHOLD) return Soil.ROCK;
    return Soil.GRASSLAND;
  }

  #buildSoilGrid() {
    this.gridSize = Math.ceil((this.extent * 2) / WORLD.soilGridCell);
    const n = this.gridSize * this.gridSize;
    this.soilGrid = new Uint8Array(n);
    this.soilProgress = new Float32Array(n);
    this.soilTarget = new Uint8Array(n);
    for (let gz = 0; gz < this.gridSize; gz++) {
      for (let gx = 0; gx < this.gridSize; gx++) {
        const x = -this.extent + (gx + 0.5) * WORLD.soilGridCell;
        const z = -this.extent + (gz + 0.5) * WORLD.soilGridCell;
        const idx = SOIL_ORDER.indexOf(this.#classify(x, z));
        const i = gz * this.gridSize + gx;
        this.soilGrid[i] = idx;
        this.soilTarget[i] = idx;
      }
    }
  }

  #buildTerrain() {
    const size = this.extent * 2;
    const geometry = new THREE.PlaneGeometry(size, size, WORLD.terrainSegments, WORLD.terrainSegments);
    geometry.rotateX(-Math.PI / 2);

    const position = geometry.attributes.position;
    for (let i = 0; i < position.count; i++) {
      position.setY(i, this.heightAt(position.getX(i), position.getZ(i)));
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(position.count * 3), 3));
    this.colorNoise = new Float32Array(position.count);
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i);
      const z = position.getZ(i);
      this.colorNoise[i] = 0.82 + 0.36 * fbm(x * 0.6 + 9, z * 0.6 - 3, 2);
    }
    geometry.computeVertexNormals();
    this.#paint(geometry);

    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
    mesh.receiveShadow = true;
    return mesh;
  }

  #soilColorAt(x, y, z, out) {
    const soil = this.soilAt(x, z);
    if (soil === Soil.GRASSLAND) {
      const [r, g, b] = this.climate.groundRGB(x, y, z);
      out.setRGB(r, g, b, THREE.SRGBColorSpace);
    } else {
      out.set(SOIL_COLORS[soil]);
    }
  }

  #paint(geometry) {
    const position = geometry.attributes.position;
    const colors = geometry.attributes.color;
    const color = new THREE.Color();
    const blend = new THREE.Color();
    const tmp = new THREE.Color();
    const b = SOIL_EVOLVE.colorBlend;
    const step = WORLD.soilGridCell;

    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i);
      const y = position.getY(i);
      const z = position.getZ(i);
      this.#soilColorAt(x, y, z, color);

      if (b > 0) {
        blend.set(0, 0, 0);
        this.#soilColorAt(x + step, y, z, tmp); blend.add(tmp);
        this.#soilColorAt(x - step, y, z, tmp); blend.add(tmp);
        this.#soilColorAt(x, y, z + step, tmp); blend.add(tmp);
        this.#soilColorAt(x, y, z - step, tmp); blend.add(tmp);
        blend.multiplyScalar(0.25);
        color.lerp(blend, b);
      }

      color.multiplyScalar(this.colorNoise[i]);
      colors.setXYZ(i, color.r, color.g, color.b);
    }
    colors.needsUpdate = true;
    this.paintedKey = this.climate.key;
  }

  #buildWater() {
    const geometry = new THREE.PlaneGeometry(this.extent * 2, this.extent * 2);
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.MeshStandardMaterial({ color: 0x2f78a8, roughness: 0.25, metalness: 0.1 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    return mesh;
  }
}

/** Lokalna wilgotność gleby: global + oaza przy stawie (bez cover/erozji — te osobno). */
function localSoilWet(x, z, soilMoisture) {
  const pond = CLIMATE.pondMoistureBonus * (1 - smoothstep(0, CLIMATE.pondFalloffRadius, Math.hypot(x, z)));
  return clamp01(soilMoisture + pond);
}
