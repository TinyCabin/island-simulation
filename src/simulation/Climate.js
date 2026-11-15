import {
  BIOME_MATRIX,
  BIOMES,
  CLIMATE,
  FLORA_AFFINITY,
  MOISTURE_BANDS,
  SPECIES,
  TEMPERATURE_BANDS,
  WEATHER,
} from '../config.js';

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smoothstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

const BIOME_IDS = Object.keys(BIOMES);
const BIOME_INDEX = Object.fromEntries(BIOME_IDS.map((id, i) => [id, i]));
const SPECIES_COUNT = SPECIES.length;
const T_CENTERS = TEMPERATURE_BANDS.map((b) => b.center);
const M_CENTERS = MOISTURE_BANDS.map((b) => b.center);
const MATRIX = BIOME_MATRIX.map((row) => row.map((id) => BIOME_INDEX[id]));

const AFFINITY = new Float32Array(BIOME_IDS.length * SPECIES_COUNT);
BIOME_IDS.forEach((id, b) => {
  const row = FLORA_AFFINITY[id];
  if (!row || row.length !== SPECIES_COUNT) {
    throw new Error(`FLORA_AFFINITY["${id}"] musi mieć ${SPECIES_COUNT} wartości (po jednej na gatunek).`);
  }
  row.forEach((value, s) => { AFFINITY[b * SPECIES_COUNT + s] = value; });
});

const GRASS_RGB = BIOME_IDS.map((id) => {
  const hex = BIOMES[id].grass;
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
});

if (MATRIX.length !== T_CENTERS.length || MATRIX.some((r) => r.length !== M_CENTERS.length)) {
  throw new Error('BIOME_MATRIX musi mieć wymiary [pasma temperatury] x [pasma wilgotności].');
}

/**
 * Klimat: cel (suwaki) vs live (aktualna pogoda).
 * Biom z live T × airM + lokalne poprawki (wysokość, staw, pokrywa roślin, wiatr).
 */
export class Climate {
  constructor() {
    this.target = {
      temperature: CLIMATE.temperature.default,
      moisture: CLIMATE.moisture.default,
    };
    // live — synchronizowane z WeatherCore; biom i fit używają tych wartości
    this.params = {
      temperature: CLIMATE.temperature.default,
      moisture: CLIMATE.moisture.default,
    };
    this.weights = new Float32Array(4);
    this.cells = new Int32Array(4);
    this.localT = 0;
    this.localM = 0;
    this.localSoilM = 0;
    this._index = 0;
    this._frac = 0;
    this._share = new Float32Array(BIOME_IDS.length);
    this.rgb = [0, 0, 0];
    /** @type {((x:number,z:number)=>number)|null} pokrywa drzew 0..1 */
    this.coverAt = null;
    /** @type {(()=>number)|null} globalna siła wiatru */
    this.windSpeedAt = null;
    /** @type {(()=>number)|null} globalna wilgotność gleby */
    this.soilMoistureAt = null;
    /** @type {((x:number,z:number)=>number)|null} oaza od jezior/kałuż */
    this.moistureBonusAt = null;
  }

  get key() {
    return `${this.params.temperature.toFixed(2)}|${this.params.moisture.toFixed(3)}`;
  }

  setTarget(temperature, moisture) {
    this.target.temperature = Math.min(CLIMATE.temperature.max, Math.max(CLIMATE.temperature.min, temperature));
    this.target.moisture = clamp01(moisture);
  }

  /** Aktualna pogoda (z WeatherCore) — używana do biomu. */
  setLive(temperature, moisture) {
    this.params.temperature = Math.min(CLIMATE.temperature.max, Math.max(CLIMATE.temperature.min, temperature));
    this.params.moisture = clamp01(moisture);
  }

  /** @deprecated użyj setTarget / setLive — zostawione dla starych wywołań setParams = cel+live */
  setParams(temperature, moisture) {
    this.setTarget(temperature, moisture);
    this.setLive(temperature, moisture);
  }

  /**
   * Lokalne warunki w punkcie: chłodniej na wzgórzach, wilgotniej przy stawie,
   * + mikroklimat lasu, − wysuszanie wiatrem na odsłoniętym terenie.
   */
  setLocal(x, y, z) {
    const wet = this.moistureBonusAt ? this.moistureBonusAt(x, z) : 0;
    const cover = this.coverAt ? clamp01(this.coverAt(x, z)) : 0;
    const wind = this.windSpeedAt ? this.windSpeedAt() : 0;
    const globalSoil = this.soilMoistureAt ? this.soilMoistureAt() : this.params.moisture;

    const coverBoost = WEATHER.coverMoistureBonus * cover;
    const bare = 1 - cover;
    const windNorm = clamp01(wind / WEATHER.windSpeedMax);
    const erosion = WEATHER.windErosionMax * bare * windNorm;

    this.localT = this.params.temperature - CLIMATE.lapseRatePerUnit * Math.max(0, y);
    this.localM = clamp01(this.params.moisture + wet + coverBoost);
    this.localSoilM = clamp01(globalSoil + wet + coverBoost - erosion);
  }

  fitnessAt(speciesId, x, y, z) {
    this.setLocal(x, y, z);
    this.computeWeights(this.localT, this.localM);
    return this.fitness(speciesId);
  }

  computeWeights(temperature, moisture) {
    const h = CLIMATE.transitionWidth / 2;
    this.#axis(temperature, T_CENTERS, h);
    const ti = this._index;
    const tt = this._frac;
    this.#axis(moisture, M_CENTERS, h);
    const mi = this._index;
    const mt = this._frac;
    const t1 = Math.min(ti + 1, T_CENTERS.length - 1);
    const m1 = Math.min(mi + 1, M_CENTERS.length - 1);

    this.cells[0] = MATRIX[ti][mi];
    this.cells[1] = MATRIX[ti][m1];
    this.cells[2] = MATRIX[t1][mi];
    this.cells[3] = MATRIX[t1][m1];
    this.weights[0] = (1 - tt) * (1 - mt);
    this.weights[1] = (1 - tt) * mt;
    this.weights[2] = tt * (1 - mt);
    this.weights[3] = tt * mt;
  }

  fitness(speciesId) {
    let sum = 0;
    for (let k = 0; k < 4; k++) sum += this.weights[k] * AFFINITY[this.cells[k] * SPECIES_COUNT + speciesId];
    return sum;
  }

  describe() {
    this.computeWeights(this.params.temperature, this.params.moisture);
    this._share.fill(0);
    for (let k = 0; k < 4; k++) this._share[this.cells[k]] += this.weights[k];
    let first = 0;
    for (let b = 1; b < this._share.length; b++) if (this._share[b] > this._share[first]) first = b;
    let second = -1;
    for (let b = 0; b < this._share.length; b++) {
      if (b !== first && this._share[b] > 0.02 && (second < 0 || this._share[b] > this._share[second])) second = b;
    }
    return {
      primary: BIOME_IDS[first],
      primaryShare: this._share[first],
      secondary: second < 0 ? null : BIOME_IDS[second],
      secondaryShare: second < 0 ? 0 : this._share[second],
    };
  }

  groundRGB(x, y, z) {
    this.setLocal(x, y, z);
    this.computeWeights(this.localT, this.localM);
    const rgb = this.rgb;
    rgb[0] = rgb[1] = rgb[2] = 0;
    for (let k = 0; k < 4; k++) {
      const c = GRASS_RGB[this.cells[k]];
      const w = this.weights[k];
      rgb[0] += c[0] * w;
      rgb[1] += c[1] * w;
      rgb[2] += c[2] * w;
    }
    return rgb;
  }

  #axis(value, centers, halfWidth) {
    const last = centers.length - 1;
    if (value <= centers[0]) { this._index = 0; this._frac = 0; return; }
    if (value >= centers[last]) { this._index = last; this._frac = 0; return; }
    let i = 0;
    while (value > centers[i + 1]) i++;
    const t = (value - centers[i]) / (centers[i + 1] - centers[i]);
    this._index = i;
    this._frac = halfWidth <= 0 ? (t < 0.5 ? 0 : 1) : smoothstep(0.5 - halfWidth, 0.5 + halfWidth, t);
  }
}
