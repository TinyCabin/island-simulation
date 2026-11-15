import * as THREE from 'three';
import { CLIMATE, LAKES, SIM_SEED, Soil, SoilMode, SOIL_EVOLVE, WORLD } from '../config.js';
import { fbm } from '../utils/noise.js';
import { basinDigAt, basinWaterRadius, generateBasins, nearestBasin } from './lakes.js';

const SOIL_ORDER = [Soil.GRASSLAND, Soil.SAND, Soil.ROCK, Soil.WATER, Soil.WETLAND];
const SOIL_COLORS = {
  [Soil.GRASSLAND]: 0x5f9e3d,
  [Soil.SAND]: 0xdcc88e,
  [Soil.ROCK]: 0x808086,
  [Soil.WATER]: 0x7d7455,
  [Soil.WETLAND]: 0x4a6b3a,
};

const IDX_GRASS = 0;
const IDX_SAND = 1;
const IDX_ROCK = 2;
const IDX_WATER = 3;
const IDX_WETLAND = 4;

const LAND_LIMIT = 0.95;
const SAND_LIMIT = 0.8;
const ROCK_THRESHOLD = 0.62;

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smoothstep = (edge0, edge1, x) => {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

export class Island {
  constructor(scene, climate, seed = SIM_SEED) {
    this.scene = scene;
    this.climate = climate;
    this.paintedKey = '';
    this.radius = WORLD.islandRadius;
    this.extent = this.radius * 1.2;
    this.soilMode = SoilMode.MIXED;
    this.soilDirty = false;
    this.evolvePhase = 0;
    this.paintEnabled = true;
    this.seed = seed >>> 0;
    this.basins = [];
    this.puddles = [];
    this.puddleAcc = 0;
    this.lakeMeshes = [];

    this.basins = generateBasins(this.seed, this.radius);
    this.#buildSoilGrid();
    this.terrain = this.#buildTerrain();
    this.ocean = this.#buildOcean();
    this.lakeGroup = new THREE.Group();
    scene.add(this.terrain, this.ocean, this.lakeGroup);
    this.#rebuildLakeMeshes();
  }

  /** Nowy seed → nowe baseny, przebudowa wysokości / gleby / meshy. */
  regenerate(seed) {
    this.seed = seed >>> 0;
    this.basins = generateBasins(this.seed, this.radius);
    this.puddles = [];
    this.#buildSoilGrid();
    this.#applyTerrainHeights();
    this.terrain.geometry.computeVertexNormals();
    this.soilDirty = true;
    this.refreshClimate();
    this.#rebuildLakeMeshes();
  }

  heightAt(x, z) {
    const radial = Math.hypot(x, z) / this.radius;
    const base = clamp01((LAND_LIMIT - this.#shore(x, z)) / LAND_LIMIT);
    const relief = fbm(x * 0.09 - 11, z * 0.09 + 5);
    const rockBump = smoothstep(ROCK_THRESHOLD, 0.8, this.#rockNoise(x, z));
    const dig = basinDigAt(this.basins, x, z);
    return Math.pow(base, 0.7) * 4 + (relief - 0.5) * 1.6 * base + rockBump * 1.4 * base - dig - 0.5;
  }

  soilAt(x, z) {
    const gx = Math.floor((x + this.extent) / WORLD.soilGridCell);
    const gz = Math.floor((z + this.extent) / WORLD.soilGridCell);
    if (gx < 0 || gz < 0 || gx >= this.gridSize || gz >= this.gridSize) return Soil.WATER;
    const natural = SOIL_ORDER[this.soilGrid[gz * this.gridSize + gx]];
    if (natural === Soil.WATER || natural === Soil.WETLAND || this.soilMode === SoilMode.MIXED) return natural;
    return this.soilMode;
  }

  /** Bonus wilgoci od jezior / mokradeł / kałuż. Pusta misa ≈ brak oazy. */
  moistureBonusAt(x, z) {
    let bonus = 0;
    const near = nearestBasin(this.basins, x, z);
    if (near && near.basin.fill > 0.08) {
      const fillFactor = near.basin.fill ** LAKES.moistureFillPower;
      const waterR = basinWaterRadius(near.basin);
      const floodR = near.basin.radius * (1 + LAKES.wetlandFloodExtra * near.basin.fill);
      const fall = LAKES.moistureFalloff;
      if (near.dist < floodR + fall) {
        const core = 1 - smoothstep(waterR, waterR + fall, near.dist);
        bonus = Math.max(bonus, CLIMATE.pondMoistureBonus * fillFactor * core);
      }
    }
    const soil = this.soilAt(x, z);
    if (soil === Soil.WETLAND) bonus = Math.max(bonus, CLIMATE.pondMoistureBonus * 0.45);
    if (soil === Soil.WATER && Math.hypot(x, z) / this.radius < LAND_LIMIT) {
      bonus = Math.max(bonus, CLIMATE.pondMoistureBonus * 0.85);
    }
    for (let i = 0; i < this.puddles.length; i++) {
      const p = this.puddles[i];
      const d = Math.hypot(x - p.x, z - p.z);
      if (d < p.radius + 6) {
        bonus = Math.max(bonus, CLIMATE.pondMoistureBonus * 0.7 * (1 - smoothstep(p.radius, p.radius + 6, d)));
      }
    }
    return bonus;
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

  canPlantAt(x, z) {
    const soil = this.soilAt(x, z);
    if (soil === Soil.WATER) return false;

    const shore = this.#shore(x, z);
    if (shore > LAND_LIMIT - SOIL_EVOLVE.coastBuffer / this.radius) return false;

    for (let i = 0; i < this.basins.length; i++) {
      const b = this.basins[i];
      const d = Math.hypot(x - b.x, z - b.z);
      if (d < basinWaterRadius(b) + 0.8) return false;
    }

    for (let i = 0; i < this.puddles.length; i++) {
      const p = this.puddles[i];
      if (Math.hypot(x - p.x, z - p.z) < p.radius + 0.4) return false;
    }

    const d = SOIL_EVOLVE.slopeSample;
    const h = this.heightAt(x, z);
    const gx = Math.abs(this.heightAt(x + d, z) - this.heightAt(x - d, z)) / (2 * d);
    const gz = Math.abs(this.heightAt(x, z + d) - this.heightAt(x, z - d)) / (2 * d);
    if (Math.hypot(gx, gz) > SOIL_EVOLVE.maxSlope) return false;
    if (h < 0.15) return false;

    return true;
  }

  /**
   * Ewolucja gleby + mokradła dynamiczne (tylko Mixed).
   * Komórki locked (stałe jezioro) nie zmieniają typu.
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
    const stepDt = dt * stride;
    let changed = 0;

    for (let i = phase; i < n; i += stride) {
      if (this.soilLocked[i]) continue;
      const type = this.soilGrid[i];

      const gz = (i / size) | 0;
      const gx = i - gz * size;
      const x = -extent + (gx + 0.5) * cell;
      const z = -extent + (gz + 0.5) * cell;
      const cover = ctx.coverAt(x, z);
      const wet = localSoilWet(this, x, z, ctx.soilMoisture);
      const windNorm = clamp01(ctx.windSpeed / 1.5);
      const erosion = windNorm * (1 - cover);
      const h = this.heightAt(x, z);

      let rate = 0;
      let target = type;

      // Costowne tylko gdy potrzebne do rozlewiska
      const needFloodProbe = type === IDX_GRASS || type === IDX_SAND || type === IDX_WETLAND || type === IDX_WATER;
      const nearWet = needFloodProbe ? this.#nearWetOrWater(x, z, 2.2) : false;
      const inFlood = needFloodProbe ? this.#inBasinFlood(x, z) : false;

      // Rozlewisko / mokradła: w dołku lub przy wodzie / w strefie flood basenu
      if (
        (type === IDX_GRASS || type === IDX_SAND)
        && h < LAKES.wetlandMaxHeight
        && wet >= LAKES.wetlandFormSoilM
        && (nearWet || inFlood || h < 0.45)
      ) {
        rate = LAKES.wetlandFormRate * wet * (inFlood ? 1.4 : 1);
        target = IDX_WETLAND;
      } else if (type === IDX_WETLAND && wet >= LAKES.floodToWaterSoilM && (nearWet || inFlood)) {
        // Płytka woda zalewowa (odblokowana — może wyparować)
        rate = LAKES.wetlandFormRate * 0.8;
        target = IDX_WATER;
      } else if (type === IDX_WATER && wet <= LAKES.floodWaterDrySoilM) {
        rate = LAKES.wetlandDryRate * 1.2;
        target = IDX_WETLAND;
      } else if (type === IDX_WETLAND && wet <= LAKES.wetlandDrySoilM) {
        rate = LAKES.wetlandDryRate * (1 - wet);
        target = IDX_GRASS;
      } else if (type === IDX_ROCK) {
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

  /** Kałuże tymczasowe: spawn przy mokrej glebie w dołkach, znikają przy suszy. */
  updatePuddles(dt, soilMoisture, rng) {
    this.puddleAcc += dt;
    if (this.puddleAcc < LAKES.puddleTickSeconds) return;
    this.puddleAcc = 0;

    if (soilMoisture < LAKES.puddleDrySoilM) {
      this.puddles = this.puddles.filter((p) => {
        p.life -= 1;
        return p.life > 0;
      });
      this.#rebuildPuddleMeshes();
      return;
    }

    if (soilMoisture >= LAKES.puddleSpawnSoilM && this.puddles.length < LAKES.puddleMax) {
      for (let tryN = 0; tryN < 8 && this.puddles.length < LAKES.puddleMax; tryN++) {
        const ang = rng.range(0, Math.PI * 2);
        const dist = Math.sqrt(rng.next()) * this.radius * 0.75;
        const x = Math.cos(ang) * dist;
        const z = Math.sin(ang) * dist;
        if (this.#shore(x, z) > SAND_LIMIT) continue;
        const h = this.heightAt(x, z);
        if (h < 0.05 || h > LAKES.wetlandMaxHeight) continue;
        if (this.soilAt(x, z) === Soil.WATER) continue;
        if (this.puddles.some((p) => Math.hypot(p.x - x, p.z - z) < 4)) continue;
        const near = nearestBasin(this.basins, x, z);
        if (near && near.dist < basinWaterRadius(near.basin) + 2) continue;

        const r = rng.range(LAKES.puddleRadius[0], LAKES.puddleRadius[1]);
        this.puddles.push({ x, z, radius: r, life: 4 });
      }
    } else if (soilMoisture >= LAKES.puddleSpawnSoilM) {
      for (const p of this.puddles) p.life = Math.min(6, p.life + 1);
    }

    this.#rebuildPuddleMeshes();
  }

  createSoilSnapshot() {
    return {
      grid: this.soilGrid.slice(),
      progress: this.soilProgress.slice(),
      target: this.soilTarget.slice(),
      locked: this.soilLocked.slice(),
      mode: this.soilMode,
      evolvePhase: this.evolvePhase,
      puddleAcc: this.puddleAcc,
      basins: this.basins.map((b) => ({ ...b })),
      puddles: this.puddles.map((p) => ({ ...p })),
      seed: this.seed,
    };
  }

  restoreSoilSnapshot(snapshot) {
    if (!snapshot) return;
    this.soilGrid.set(snapshot.grid);
    this.soilProgress.set(snapshot.progress);
    this.soilTarget.set(snapshot.target);
    if (snapshot.locked) this.soilLocked.set(snapshot.locked);
    this.soilMode = snapshot.mode;
    this.evolvePhase = snapshot.evolvePhase ?? 0;
    this.puddleAcc = snapshot.puddleAcc ?? 0;
    if (snapshot.basins) this.basins = snapshot.basins.map((b) => ({ ...b }));
    if (snapshot.puddles) this.puddles = snapshot.puddles.map((p) => ({ ...p }));
    if (snapshot.seed !== undefined) this.seed = snapshot.seed;
    this.soilDirty = true;
    this.refreshClimate();
    if (this.paintEnabled) this.#applyTerrainHeights();
    this.#rebuildLakeMeshes();
  }

  #shore(x, z) {
    return Math.hypot(x, z) / this.radius + (fbm(x * 0.04 + 3.1, z * 0.04 - 7.7) - 0.5) * 0.35;
  }

  #rockNoise(x, z) {
    return fbm(x * 0.07 + 40, z * 0.07 - 17);
  }

  #basinSoilAt(x, z) {
    for (let i = 0; i < this.basins.length; i++) {
      const b = this.basins[i];
      const d = Math.hypot(x - b.x, z - b.z);
      const floodR = b.radius * (1 + LAKES.wetlandFloodExtra * b.fill);
      if (d > floodR) continue;
      const waterR = basinWaterRadius(b);
      // Lustro — locked tylko gdy jest realna woda
      if (b.fill > 0.08 && d < waterR) return { soil: Soil.WATER, locked: true };
      // Mokradło w misie / rozlewisku — locked słabo (sync może cofnąć przy wyschnięciu)
      if (b.fill > 0.12 && d < floodR) return { soil: Soil.WETLAND, locked: true };
      // Prawie pusta misa: suchy dołek (bez oazy / mokradła)
      if (b.fill <= 0.12 && d < b.radius * 0.85) return null;
    }
    return null;
  }

  #inBasinFlood(x, z) {
    for (let i = 0; i < this.basins.length; i++) {
      const b = this.basins[i];
      if (b.fill < 0.35) continue;
      const floodR = b.radius * (1 + LAKES.wetlandFloodExtra * b.fill);
      if (Math.hypot(x - b.x, z - b.z) < floodR) return true;
    }
    return false;
  }

  #nearWetOrWater(x, z, radius) {
    // 4 kierunki + środek — tanio wystarczy do rozlewiska
    const s0 = this.soilAt(x, z);
    if (s0 === Soil.WATER || s0 === Soil.WETLAND) return true;
    if (this.soilAt(x + radius, z) === Soil.WATER || this.soilAt(x + radius, z) === Soil.WETLAND) return true;
    if (this.soilAt(x - radius, z) === Soil.WATER || this.soilAt(x - radius, z) === Soil.WETLAND) return true;
    if (this.soilAt(x, z + radius) === Soil.WATER || this.soilAt(x, z + radius) === Soil.WETLAND) return true;
    if (this.soilAt(x, z - radius) === Soil.WATER || this.soilAt(x, z - radius) === Soil.WETLAND) return true;
    return false;
  }

  /**
   * Deszcz dopełnia misy; upał + suche powietrze + piasek → parowanie (pustynia).
   */
  updateBasinFill(dt, {
    precip = 0,
    soilMoisture = 0.5,
    raining = false,
    temperature = 15,
    airMoisture = 0.5,
  } = {}) {
    let changed = false;
    const hot = clamp01(
      (temperature - LAKES.evaporateTempStart) / (LAKES.evaporateTempFull - LAKES.evaporateTempStart),
    );
    const dryAir = 1 - airMoisture;

    for (let i = 0; i < this.basins.length; i++) {
      const b = this.basins[i];
      const before = b.fill;
      let delta = 0;
      if (raining || precip > 0.2) delta += precip * LAKES.fillFromPrecip;
      if (soilMoisture >= LAKES.fillWetSoilM) {
        delta += (soilMoisture - LAKES.fillWetSoilM) * LAKES.fillFromSoilM;
      }

      // Retencja: mokradło wokół / wysoki fill trzyma wodę; piasek przyspiesza stratę
      const rimSoil = this.soilAt(b.x + b.radius * 0.7, b.z);
      let retention = LAKES.wetlandRetain * b.fill;
      if (rimSoil === Soil.WETLAND) retention = Math.min(0.85, retention + 0.25);
      if (rimSoil === Soil.SAND) retention *= 0.35;

      let loss = 0;
      if (soilMoisture < LAKES.fillDrySoilM && precip < 0.15) {
        loss += LAKES.fillDrain * (1 - soilMoisture);
      }
      // Parowanie termiczne (kluczowe na pustyni)
      loss += LAKES.evaporateBase * (0.25 + 0.75 * hot) * dryAir * (1 - retention);
      if (rimSoil === Soil.SAND) loss *= LAKES.sandEvaporateMult;

      delta -= loss;
      b.fill = clamp01(b.fill + delta * dt);
      if (Math.abs(b.fill - before) > 0.002) changed = true;
    }
    if (changed) {
      this.#syncBasinSoilCells();
      this.#updateLakeMeshTransforms();
      this.soilDirty = true;
    }
  }

  /** Przelicz Water/Wetland w komórkach basenów po zmianie fill. */
  #syncBasinSoilCells() {
    const size = this.gridSize;
    const cell = WORLD.soilGridCell;
    const extent = this.extent;
    for (let gz = 0; gz < size; gz++) {
      for (let gx = 0; gx < size; gx++) {
        const i = gz * size + gx;
        if (!this.soilLocked[i] && this.soilGrid[i] !== IDX_WATER && this.soilGrid[i] !== IDX_WETLAND) continue;
        const x = -extent + (gx + 0.5) * cell;
        const z = -extent + (gz + 0.5) * cell;
        // Tylko komórki należące do basenów (nie ocean)
        const shore = this.#shore(x, z);
        if (shore > LAND_LIMIT) continue;
        const classified = this.#basinSoilAt(x, z);
        if (classified) {
          const idx = SOIL_ORDER.indexOf(classified.soil);
          this.soilGrid[i] = idx;
          this.soilTarget[i] = idx;
          this.soilLocked[i] = 1;
        } else if (this.soilLocked[i]) {
          // Było w basenie, fill spadł — wróć do trawy/skały
          const rock = this.#rockNoise(x, z) > ROCK_THRESHOLD;
          const idx = rock ? IDX_ROCK : IDX_GRASS;
          this.soilGrid[i] = idx;
          this.soilTarget[i] = idx;
          this.soilLocked[i] = 0;
        }
      }
    }
  }

  #classify(x, z) {
    const shore = this.#shore(x, z);
    if (shore > LAND_LIMIT) return { soil: Soil.WATER, locked: true };
    const basin = this.#basinSoilAt(x, z);
    if (basin) return basin;
    if (shore > SAND_LIMIT) return { soil: Soil.SAND, locked: false };
    if (this.#rockNoise(x, z) > ROCK_THRESHOLD) return { soil: Soil.ROCK, locked: false };
    return { soil: Soil.GRASSLAND, locked: false };
  }

  #buildSoilGrid() {
    this.gridSize = Math.ceil((this.extent * 2) / WORLD.soilGridCell);
    const n = this.gridSize * this.gridSize;
    this.soilGrid = new Uint8Array(n);
    this.soilProgress = new Float32Array(n);
    this.soilTarget = new Uint8Array(n);
    this.soilLocked = new Uint8Array(n);
    for (let gz = 0; gz < this.gridSize; gz++) {
      for (let gx = 0; gx < this.gridSize; gx++) {
        const x = -this.extent + (gx + 0.5) * WORLD.soilGridCell;
        const z = -this.extent + (gz + 0.5) * WORLD.soilGridCell;
        const { soil, locked } = this.#classify(x, z);
        const idx = SOIL_ORDER.indexOf(soil);
        const i = gz * this.gridSize + gx;
        this.soilGrid[i] = idx;
        this.soilTarget[i] = idx;
        this.soilLocked[i] = locked ? 1 : 0;
      }
    }
  }

  #applyTerrainHeights() {
    const position = this.terrain.geometry.attributes.position;
    for (let i = 0; i < position.count; i++) {
      position.setY(i, this.heightAt(position.getX(i), position.getZ(i)));
    }
    position.needsUpdate = true;
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
      out.set(SOIL_COLORS[soil] ?? SOIL_COLORS[Soil.GRASSLAND]);
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

  #buildOcean() {
    const geometry = new THREE.PlaneGeometry(this.extent * 2, this.extent * 2);
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.MeshStandardMaterial({ color: 0x2f78a8, roughness: 0.25, metalness: 0.1 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    mesh.position.y = 0;
    return mesh;
  }

  /** Y lustra: przy fill=1 ≈ poziom brzegu misy (heightAt(środek)+depth). */
  #basinWaterY(b) {
    const bottom = this.heightAt(b.x, b.z);
    return bottom + b.depth * Math.max(0.05, b.fill);
  }

  #rebuildLakeMeshes() {
    while (this.lakeGroup.children.length) {
      const child = this.lakeGroup.children[0];
      this.lakeGroup.remove(child);
      child.geometry?.dispose();
      child.material?.dispose();
    }
    this.lakeMeshes = [];

    const mat = new THREE.MeshStandardMaterial({
      color: 0x3a8ec4,
      roughness: 0.22,
      metalness: 0.08,
      transparent: true,
      opacity: 0.92,
    });

    for (const b of this.basins) {
      const r = Math.max(0.35, basinWaterRadius(b));
      const geo = new THREE.CircleGeometry(1, 32); // jednostkowy — skalujemy fill
      geo.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(geo, mat.clone());
      mesh.userData.basin = true;
      mesh.scale.set(r, 1, r);
      mesh.position.set(b.x, this.#basinWaterY(b), b.z);
      mesh.visible = b.fill > 0.04;
      mesh.receiveShadow = true;
      this.lakeGroup.add(mesh);
      this.lakeMeshes.push(mesh);
    }

    this.#rebuildPuddleMeshes();
  }

  #updateLakeMeshTransforms() {
    for (let i = 0; i < this.basins.length; i++) {
      const b = this.basins[i];
      const mesh = this.lakeMeshes[i];
      if (!mesh) continue;
      const r = Math.max(0.35, basinWaterRadius(b));
      mesh.scale.set(r, 1, r);
      mesh.position.set(b.x, this.#basinWaterY(b), b.z);
      mesh.visible = b.fill > 0.04;
      mesh.material.opacity = 0.55 + 0.4 * b.fill;
    }
  }

  #rebuildPuddleMeshes() {
    // Usuń poprzednie kałuże (tag userData.puddle)
    for (let i = this.lakeGroup.children.length - 1; i >= 0; i--) {
      const child = this.lakeGroup.children[i];
      if (!child.userData.puddle) continue;
      this.lakeGroup.remove(child);
      child.geometry?.dispose();
      child.material?.dispose();
    }

    const mat = new THREE.MeshStandardMaterial({
      color: 0x4aa0c8,
      roughness: 0.3,
      metalness: 0.05,
      transparent: true,
      opacity: 0.75,
    });

    for (const p of this.puddles) {
      const geo = new THREE.CircleGeometry(p.radius, 16);
      geo.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(geo, mat.clone());
      const y = Math.max(0.05, this.heightAt(p.x, p.z) + 0.15);
      mesh.position.set(p.x, y, p.z);
      mesh.userData.puddle = true;
      this.lakeGroup.add(mesh);
    }
  }
}

function localSoilWet(island, x, z, soilMoisture) {
  return clamp01(soilMoisture + island.moistureBonusAt(x, z));
}
