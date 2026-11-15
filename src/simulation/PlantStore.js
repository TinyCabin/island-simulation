import { Stage } from '../config.js';

export const F = Object.freeze({
  ID: 0,
  SPECIES: 1,
  X: 2,
  Y: 3,
  Z: 4,
  AGE: 5,
  STAGE: 6,
  SCALE: 7,
  STRESS: 8,
  SAND: 9,
  SENESCENCE: 10,
  DEAD: 11,
  ROTATION: 12,
  CLIMATE: 13, // skumulowany stres klimatyczny (s)
  LEAF: 14, // ulistnienie korony 0..1
  HUE: 15, // przebarwienie liści 0 (zielone) .. 1 (jesienne/uschnięte)
});

export const STRIDE = 16;

export class PlantStore {
  constructor(capacity) {
    this.capacity = capacity;
    this.data = new Float32Array(capacity * STRIDE);
    this.count = 0;
    this.nextId = 1;
  }

  get isFull() {
    return this.count >= this.capacity;
  }

  add({ species, x, y, z, age, stage, scale, rotation, leaf = 0 }) {
    if (this.isFull) return -1;
    const index = this.count++;
    const base = index * STRIDE;
    this.data.fill(0, base, base + STRIDE);
    this.data[base + F.ID] = this.nextId++;
    this.data[base + F.SPECIES] = species;
    this.data[base + F.X] = x;
    this.data[base + F.Y] = y;
    this.data[base + F.Z] = z;
    this.data[base + F.AGE] = age;
    this.data[base + F.STAGE] = stage;
    this.data[base + F.SCALE] = scale;
    this.data[base + F.ROTATION] = rotation;
    this.data[base + F.LEAF] = leaf;
    return index;
  }

  removeAt(index) {
    const last = this.count - 1;
    if (index !== last) this.data.copyWithin(index * STRIDE, last * STRIDE, (last + 1) * STRIDE);
    this.count = last;
  }

  countNeighbours(x, z, radius, excludeIndex, limit, layerMask = null) {
    const radiusSq = radius * radius;
    const data = this.data;
    let found = 0;
    for (let i = 0; i < this.count; i++) {
      if (i === excludeIndex) continue;
      const base = i * STRIDE;
      if (data[base + F.STAGE] === Stage.DEAD) continue;
      if (layerMask && !layerMask[data[base + F.SPECIES]]) continue;
      const dx = data[base + F.X] - x;
      const dz = data[base + F.Z] - z;
      if (dx * dx + dz * dz <= radiusSq && ++found > limit) return found;
    }
    return found;
  }

  stageCounts() {
    const counts = [0, 0, 0, 0];
    for (let i = 0; i < this.count; i++) counts[this.data[i * STRIDE + F.STAGE]]++;
    return counts;
  }

  speciesCounts(speciesTotal) {
    const counts = new Array(speciesTotal).fill(0);
    for (let i = 0; i < this.count; i++) {
      const base = i * STRIDE;
      if (this.data[base + F.STAGE] !== Stage.DEAD) counts[this.data[base + F.SPECIES]]++;
    }
    return counts;
  }

  createSnapshot() {
    return {
      data: this.data.slice(0, this.count * STRIDE),
      count: this.count,
      nextId: this.nextId,
    };
  }

  restoreSnapshot(snapshot) {
    this.data.set(snapshot.data);
    this.count = snapshot.count;
    this.nextId = snapshot.nextId;
  }
}