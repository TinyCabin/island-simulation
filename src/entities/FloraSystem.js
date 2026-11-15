import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MODELS, Stage } from '../config.js';
import { F, STRIDE } from '../simulation/PlantStore.js';

const WHITE = new THREE.Color(1, 1, 1);
const UP = new THREE.Vector3(0, 1, 0);
const IDENTITY_QUAT = new THREE.Quaternion();

const hash01 = (id) => {
  const value = Math.sin(id * 12.9898) * 43758.5453;
  return value - Math.floor(value);
};

/** Paleta gatunku wyliczona raz z config.colors (bez alokacji w pętli klatki). */
const createPalette = (colors) => {
  const crown = new THREE.Color(colors.crown);
  return {
    trunk: new THREE.Color(colors.trunk),
    crown,
    sapling: crown.clone().lerp(new THREE.Color(0xc4e68a), 0.3),
    autumn: new THREE.Color(colors.autumn),
    seed: new THREE.Color(colors.seed),
    deadTrunk: new THREE.Color(colors.deadTrunk),
    deadCrown: new THREE.Color(colors.deadCrown),
  };
};

/**
 * Rysuje rośliny jako InstancedMesh. Każda część modelu (pień, korona) ma własny
 * InstancedMesh, dzięki czemu korona może być skalowana (ulistnienie) i kolorowana
 * (jesień, uschnięcie) niezależnie od pnia.
 */
export class FloraSystem {
  constructor(scene, speciesList, capacity) {
    this.scene = scene;
    this.species = speciesList;
    this.capacity = capacity;
    this.loader = new GLTFLoader();
    this.gltfCache = new Map();

    this.position = new THREE.Vector3();
    this.scaleVector = new THREE.Vector3();
    this.cropScale = new THREE.Vector3();
    this.cropOffset = new THREE.Vector3();
    this.leanAxis = new THREE.Vector3();
    this.leanAxisSmooth = new THREE.Vector3(0, 0, -1);
    this.yawQuat = new THREE.Quaternion();
    this.leanQuat = new THREE.Quaternion();
    this.matrix = new THREE.Matrix4();
    this.local = new THREE.Matrix4();
    this.partMatrix = new THREE.Matrix4();
    this.crownColor = new THREE.Color();
    this.cursors = new Int32Array(speciesList.length);
    this.smoothWindSpeed = 0.45;
    this.smoothWindAngle = 40;
    this.lastRenderElapsed = 0;

    this.visuals = speciesList.map((cfg) => this.#createFallbackVisual(cfg));
    this.visuals.forEach((visual) => visual.parts.forEach((part) => scene.add(part.mesh)));
  }

  async loadModels() {
    await Promise.all(this.species.map((cfg, index) => this.#loadSpecies(cfg, index)));
  }

  render(store, weather, elapsed) {
    const data = store.data;
    const frameDt = Math.min(0.1, Math.max(0, elapsed - this.lastRenderElapsed));
    this.lastRenderElapsed = elapsed;
    // Wygładzanie kierunku/siły wiatru — bez skoków pochylenia drzew
    const follow = 1 - Math.exp(-4.5 * frameDt);
    let targetAngle = weather.windAngle;
    let deltaA = ((targetAngle - this.smoothWindAngle + 540) % 360) - 180;
    this.smoothWindAngle = (this.smoothWindAngle + deltaA * follow + 360) % 360;
    this.smoothWindSpeed += (weather.windSpeed - this.smoothWindSpeed) * follow;
    const angle = THREE.MathUtils.degToRad(this.smoothWindAngle);
    this.leanAxis.set(Math.sin(angle), 0, -Math.cos(angle));
    this.leanAxisSmooth.lerp(this.leanAxis, follow).normalize();
    this.cursors.fill(0);

    for (let i = 0; i < store.count; i++) {
      const base = i * STRIDE;
      const speciesIndex = data[base + F.SPECIES];
      const cursor = this.cursors[speciesIndex];
      if (cursor >= this.capacity) continue;
      this.cursors[speciesIndex] = cursor + 1;

      const cfg = this.species[speciesIndex];
      const visual = this.visuals[speciesIndex];
      const palette = visual.palette;
      const stage = data[base + F.STAGE];
      const id = data[base + F.ID];
      const jitterA = hash01(id);
      const jitterB = hash01(id + 101);

      const sway = Math.sin(elapsed * 1.6 + id * 0.7);
      const lean = stage === Stage.SEED
        ? 0
        : cfg.maxLean * this.smoothWindSpeed * (0.75 + 0.25 * sway) + 0.01 * sway;

      this.yawQuat.setFromAxisAngle(UP, data[base + F.ROTATION]);
      this.leanQuat.setFromAxisAngle(this.leanAxisSmooth, lean).multiply(this.yawQuat);

      // Proceduralna indywidualność: rozmiar, grubość i odcień zależą od ID rośliny.
      const size = data[base + F.SCALE] * cfg.height * (0.85 + 0.3 * jitterA);
      const girth = 1 + 0.18 * (jitterB - 0.5);
      const [px, py, pz] = cfg.proportions;
      this.scaleVector.set(size * px * girth, size * py, size * pz * girth);
      this.position.set(data[base + F.X], data[base + F.Y], data[base + F.Z]);
      this.matrix.compose(this.position, this.leanQuat, this.scaleVector);

      // Kolory pnia i korony wg etapu życia i przebarwienia liści.
      let trunkColor = palette.trunk;
      let crown = this.crownColor;
      if (stage === Stage.DEAD) {
        trunkColor = palette.deadTrunk;
        crown.copy(palette.deadCrown);
      } else if (stage === Stage.SEED) {
        trunkColor = palette.seed;
        crown.copy(palette.seed);
      } else {
        crown.copy(stage === Stage.SAPLING ? palette.sapling : palette.crown);
        crown.lerp(palette.autumn, data[base + F.HUE]);
        crown.multiplyScalar(0.88 + 0.24 * jitterB);
      }

      // Skala korony: ulistnienie 0..1 razem z kształtem gatunku (parasol, kępa).
      const showFullCrown = stage === Stage.SEED || cfg.leaf.strategy === 'none';
      const leaf = showFullCrown ? 1 : Math.max(0.001, data[base + F.LEAF]);
      const [cx, cy, cz] = cfg.crownShape;

      for (const part of visual.parts) {
        let matrix = this.matrix;
        let color = trunkColor;
        if (part.kind !== 'trunk') {
          color = crown;
          if (part.kind === 'crown' && stage !== Stage.SEED) {
            // Skalowanie wokół środka korony: T(p) · S · T(-p)
            this.cropScale.set(leaf * cx, leaf * cy, leaf * cz);
            this.cropOffset.set(
              part.pivot.x * (1 - this.cropScale.x),
              part.pivot.y * (1 - this.cropScale.y),
              part.pivot.z * (1 - this.cropScale.z),
            );
            this.local.compose(this.cropOffset, IDENTITY_QUAT, this.cropScale);
            this.partMatrix.multiplyMatrices(this.matrix, this.local);
            matrix = this.partMatrix;
          }
        }
        part.mesh.setMatrixAt(cursor, matrix);
        part.mesh.setColorAt(cursor, color);
      }
    }

    this.visuals.forEach((visual, speciesIndex) => {
      for (const { mesh } of visual.parts) {
        mesh.count = this.cursors[speciesIndex];
        mesh.instanceMatrix.needsUpdate = true;
        mesh.instanceColor.needsUpdate = true;
      }
    });
  }

  #createInstanced(geometry, material) {
    const mesh = new THREE.InstancedMesh(geometry, material, this.capacity);
    mesh.count = 0;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.setColorAt(0, WHITE);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    return mesh;
  }

  #createFallbackVisual(cfg) {
    const geometry = new THREE.ConeGeometry(cfg.fallbackRadius, 1, 8);
    geometry.translate(0, 0.5, 0);
    const material = new THREE.MeshStandardMaterial({ roughness: 0.85, flatShading: true });
    return {
      parts: [{ mesh: this.#createInstanced(geometry, material), kind: 'whole', pivot: new THREE.Vector3() }],
      palette: createPalette(cfg.colors),
    };
  }

  #loadGltf(url) {
    if (!this.gltfCache.has(url)) this.gltfCache.set(url, this.loader.loadAsync(url));
    return this.gltfCache.get(url);
  }

  async #loadSpecies(cfg, index) {
    try {
      const model = MODELS[cfg.model];
      const gltf = await this.#loadGltf(model.url);
      const parts = this.#buildGltfParts(gltf, model);
      if (parts.length === 0) throw new Error('Model nie zawiera siatek');
      this.#swapVisual(index, { parts, palette: createPalette(cfg.colors) });
    } catch (error) {
      console.warn(`[FloraSystem] Model "${cfg.name}" niedostępny, używam geometrii zastępczej.`, error);
    }
  }

  #buildGltfParts(gltf, model) {
    const root = gltf.scene;
    root.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const unitScale = 1 / Math.max(size.y, 1e-6);

    const normalize = new THREE.Matrix4()
      .makeScale(unitScale, unitScale, unitScale)
      .multiply(new THREE.Matrix4().makeTranslation(-center.x, -box.min.y, -center.z));

    const parts = [];
    root.traverse((object) => {
      if (!object.isMesh) return;
      const geometry = object.geometry.clone();
      geometry.applyMatrix4(normalize.clone().multiply(object.matrixWorld));
      geometry.computeBoundingBox();

      const source = Array.isArray(object.material) ? object.material[0] : object.material;
      const material = source.clone();
      material.color.set(0xffffff); // kolor całkowicie z koloru instancji (paleta gatunku)
      material.metalness = 0;

      const kind = model.trunkMaterials.includes(source.name) ? 'trunk' : 'crown';
      const pivot = geometry.boundingBox.getCenter(new THREE.Vector3());
      parts.push({ mesh: this.#createInstanced(geometry, material), kind, pivot });
    });
    return parts;
  }

  #swapVisual(index, next) {
    const previous = this.visuals[index];
    for (const { mesh } of previous.parts) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
      mesh.dispose();
    }
    next.parts.forEach((part) => this.scene.add(part.mesh));
    this.visuals[index] = next;
  }
}
