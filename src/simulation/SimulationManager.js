import { CLIMATE, INITIAL_PLANTS, LEAF, RULES, SPECIES, SIM_SEED, SOIL_EVOLVE, Soil, SoilMode, Stage, WEATHER, WORLD } from '../config.js';
import { SeededRandom } from '../utils/random.js';
import { F, STRIDE } from './PlantStore.js';
import { WeatherCore } from './WeatherCore.js';

const SPEED_STEPS = [1, 2, 4, 8];
const MAX_STEPS_PER_FRAME = 60;
const SEED_SCALE = 0.12;
const TWO_PI = Math.PI * 2;

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smoothstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const approach = (value, target, step) => (value < target ? Math.min(target, value + step) : Math.max(target, value - step));

export class SimulationManager {
  constructor({ island, store, rng, timeManager, climate, seed = SIM_SEED }) {
    this.island = island;
    this.climate = climate;
    this.store = store;
    this.rng = rng;
    this.seed = seed >>> 0;
    this.time = timeManager;
    this.weatherCore = new WeatherCore(climate);

    this.simTime = 0;
    this.paused = false;
    this.speedIndex = 0;
    this.accumulator = 0;
    this.soilMode = SoilMode.MIXED;
    this.coverTick = 0;
    this.soilEvolveAcc = 0;

    this.pickWeights = new Float32Array(SPECIES.length);
    this.layerMasks = SPECIES.map((cfg) => Uint8Array.from(SPECIES, (other) => (other.layer === cfg.layer ? 1 : 0)));
    this.lightningListeners = [];
    this.doomed = [];
    this.parents = [];

    this.#initCoverGrid();
    this.climate.coverAt = (x, z) => this.coverAt(x, z);
    this.climate.windSpeedAt = () => this.weather.windSpeed;
    this.climate.soilMoistureAt = () => this.weather.soilMoisture;
    this.climate.moistureBonusAt = (x, z) => this.island.moistureBonusAt(x, z);
  }

  get weather() {
    return this.weatherCore.state;
  }

  get speed() {
    return SPEED_STEPS[this.speedIndex];
  }

  initialize() {
    this.weatherCore.applyInstant();
    this.refreshCover();
    this.populate();
    this.time.capture(this);
  }

  onLightning(listener) {
    this.lightningListeners.push(listener);
  }

  update(delta) {
    if (this.paused) return;
    this.accumulator += delta * this.speed;
    let steps = 0;
    while (this.accumulator >= RULES.tickSeconds && steps < MAX_STEPS_PER_FRAME) {
      this.step();
      this.accumulator -= RULES.tickSeconds;
      this.time.recordIfDue(this);
      steps++;
    }
    if (steps === MAX_STEPS_PER_FRAME) this.accumulator = 0;
  }

  step() {
    const dt = RULES.tickSeconds;
    this.simTime += dt;
    this.weatherCore.step(dt, this.simTime, this.rng);

    if (++this.coverTick >= WEATHER.coverRefreshTicks) {
      this.coverTick = 0;
      this.refreshCover();
    }

    this.soilEvolveAcc += dt;
    if (this.soilEvolveAcc >= SOIL_EVOLVE.tickEverySeconds) {
      const soilDt = this.soilEvolveAcc;
      this.soilEvolveAcc = 0;
      this.island.evolveSoil(soilDt, {
        soilMoisture: this.weather.soilMoisture,
        windSpeed: this.weather.windSpeed,
        coverAt: (x, z) => this.coverAt(x, z),
      });
      const w = this.weather;
      this.island.updateBasinFill(soilDt, {
        precip: w.precip,
        soilMoisture: w.soilMoisture,
        raining: w.raining,
      });
      this.island.updatePuddles(soilDt, w.soilMoisture, this.rng);
    }

    const w = this.weather;
    const conditions = {
      raining: w.raining,
      drought: !w.raining && w.timeSinceRain >= RULES.droughtAfterSeconds,
      precip: w.precip,
      soilMoisture: w.soilMoisture,
      windSpeed: w.windSpeed,
    };

    const count = this.store.count;
    this.doomed.length = 0;
    this.parents.length = 0;

    for (let i = 0; i < count; i++) this.updatePlant(i, dt, conditions);

    this.dispatchSeeds();
    this.immigrate();
    this.removeDoomed();

    // Kolor gruntu: odświeżaj gdy klucz klimatu się zmienił (Island i tak no-op przy tym samym key).
    // Nie częściej niż co ~1 s czasu symulacji — chase zmienia T/M płynnie.
    if (Math.floor(this.simTime) !== Math.floor(this.simTime - dt)) this.island.refreshClimate();
  }

  updatePlant(index, dt, conditions) {
    const data = this.store.data;
    const base = index * STRIDE;

    if (data[base + F.STAGE] === Stage.DEAD) {
      this.decayCorpse(index, base, dt);
      return;
    }

    const cfg = SPECIES[data[base + F.SPECIES]];
    const x = data[base + F.X];
    const y = data[base + F.Y];
    const z = data[base + F.Z];
    const soil = this.island.soilAt(x, z);

    if (!this.canLive(cfg, soil)) {
      this.eliminate(index, base);
      return;
    }

    const fit = this.climate.fitnessAt(cfg.id, x, y, z);
    const localT = this.climate.localT;
    const localSoil = this.climate.localSoilM;

    const nearWater = this.island.moistureBonusAt(x, z) > 0.08;
    const wet = conditions.raining || nearWater || localSoil > 0.55;
    const waterStressed = (conditions.drought || localSoil < 0.2) && !nearWater && localSoil < 0.35;
    const weatherGrowth = wet
      ? RULES.wetGrowthMultiplier
      : waterStressed
        ? lerp(RULES.droughtGrowthMultiplier, 1, cfg.droughtTolerance)
        : lerp(0.7, 1.2, localSoil);
    const growth = weatherGrowth * lerp(CLIMATE.unfitGrowthFloor, 1, fit);

    data[base + F.AGE] += dt * growth;

    if (this.applyClimateStress(base, dt, fit)) return;
    if (this.applyDroughtStress(base, dt, waterStressed, cfg.droughtTolerance)) return;

    switch (data[base + F.STAGE]) {
      case Stage.SEED:
        this.tryGerminate(index, base, cfg, soil, fit);
        break;
      case Stage.SAPLING:
        if (this.applySandRule(base, cfg, soil, dt)) return;
        if (data[base + F.AGE] >= cfg.matureAge) data[base + F.STAGE] = Stage.ADULT;
        break;
      case Stage.ADULT:
        if (this.applySandRule(base, cfg, soil, dt)) return;
        if (this.ageAdult(base, cfg, dt, waterStressed)) return;
        if (this.rng.next() < cfg.seedChancePerTick * fit) this.parents.push(index);
        break;
      default:
        break;
    }

    this.updateLeaves(base, cfg, dt, localT, waterStressed, conditions.windSpeed);
    data[base + F.SCALE] = this.scaleFor(cfg, data[base + F.STAGE], data[base + F.AGE]);
  }

  canLive(cfg, soil) {
    if (soil === Soil.WATER) return false;
    if (soil === Soil.WETLAND) return cfg.soils.includes(Soil.WETLAND);
    if (soil === Soil.ROCK) return cfg.soils.includes(Soil.ROCK);
    return true;
  }

  applyClimateStress(base, dt, fit) {
    const data = this.store.data;
    if (fit < CLIMATE.minFitness) {
      data[base + F.CLIMATE] += dt * (1 - fit / CLIMATE.minFitness);
    } else {
      data[base + F.CLIMATE] = Math.max(0, data[base + F.CLIMATE] - dt * CLIMATE.stressRecovery);
    }
    if (data[base + F.CLIMATE] < CLIMATE.stressLimitSeconds) return false;
    this.kill(base);
    return true;
  }

  applyDroughtStress(base, dt, stressed, tolerance) {
    const data = this.store.data;
    data[base + F.STRESS] = stressed
      ? data[base + F.STRESS] + dt * (1 - tolerance)
      : Math.max(0, data[base + F.STRESS] - 2 * dt);
    if (data[base + F.STRESS] < RULES.droughtStressLimitSeconds) return false;
    this.kill(base);
    return true;
  }

  applySandRule(base, cfg, soil, dt) {
    const data = this.store.data;
    if (soil !== Soil.SAND || cfg.soils.includes(Soil.SAND)) {
      data[base + F.SAND] = 0;
      return false;
    }
    data[base + F.SAND] += dt;
    if (data[base + F.SAND] < RULES.sandDeathSeconds) return false;
    this.kill(base);
    return true;
  }

  ageAdult(base, cfg, dt, waterStressed) {
    const data = this.store.data;
    const rate = waterStressed ? lerp(RULES.droughtSenescenceMultiplier, 1, cfg.droughtTolerance) : 1;
    data[base + F.SENESCENCE] += dt * rate;
    if (data[base + F.SENESCENCE] < cfg.lifespan) return false;
    this.kill(base);
    return true;
  }

  updateLeaves(base, cfg, dt, localT, waterStressed, windSpeed) {
    const data = this.store.data;
    const stage = data[base + F.STAGE];
    if (cfg.leaf.strategy === 'none') {
      data[base + F.LEAF] = 1;
      return;
    }

    let cap = 0;
    if (stage === Stage.ADULT) cap = 1;
    else if (stage === Stage.SAPLING) {
      const progress = clamp01((data[base + F.AGE] - cfg.germinationAge) / (cfg.matureAge - cfg.germinationAge));
      cap = 0.85 * smoothstep(LEAF.saplingStart, 1, progress);
    }

    const seasonal =
      (cfg.leaf.strategy === 'deciduous' && localT < cfg.leaf.dropBelowT) ||
      (cfg.leaf.strategy === 'drought' && waterStressed);
    const wither = clamp01(data[base + F.CLIMATE] / CLIMATE.stressLimitSeconds);

    const windDrop = this.#windLeafFactor(cfg, windSpeed);

    const hueTarget = Math.max(seasonal ? 1 : 0, clamp01(wither * 1.5), windDrop > 0.4 ? 0.6 : 0);
    let leafTarget = seasonal ? 0 : cap * (1 - windDrop);
    if (wither > 0.5) leafTarget = Math.min(leafTarget, 1 - (wither - 0.5) * 2);

    const hue = approach(
      data[base + F.HUE],
      hueTarget,
      dt / (hueTarget > data[base + F.HUE] ? LEAF.hueTurnSeconds : LEAF.hueRecoverSeconds),
    );
    data[base + F.HUE] = hue;

    const leaf = data[base + F.LEAF];
    if (leaf > leafTarget) {
      if (hue >= 0.9 || windDrop > 0.3) data[base + F.LEAF] = approach(leaf, leafTarget, dt / LEAF.dropSeconds);
    } else if (hue < 0.3) {
      data[base + F.LEAF] = approach(leaf, leafTarget, dt / LEAF.growSeconds);
    }
  }

  #windLeafFactor(cfg, windSpeed) {
    const t = smoothstep(WEATHER.windLeafStart, WEATHER.windLeafFull, windSpeed);
    if (cfg.leaf.strategy === 'deciduous' || cfg.leaf.strategy === 'drought') return t;
    if (cfg.leaf.strategy === 'evergreen') return t * WEATHER.windLeafEvergreenFactor;
    return 0;
  }

  tryGerminate(index, base, cfg, soil, fit) {
    const data = this.store.data;
    if (data[base + F.AGE] < cfg.germinationAge) return;

    if (!cfg.soils.includes(soil) || this.rng.next() >= fit) {
      this.doomed.push(index);
      return;
    }

    const crowd = this.store.countNeighbours(
      data[base + F.X],
      data[base + F.Z],
      cfg.crowdingRadius,
      index,
      cfg.crowdingMax,
      this.layerMasks[cfg.id],
    );

    if (crowd <= cfg.crowdingMax) data[base + F.STAGE] = Stage.SAPLING;
    else this.doomed.push(index);
  }

  decayCorpse(index, base, dt) {
    const data = this.store.data;
    data[base + F.DEAD] += dt;
    data[base + F.LEAF] = Math.max(0, data[base + F.LEAF] - dt * 0.25);
    data[base + F.SCALE] *= 0.995;
    if (data[base + F.DEAD] >= RULES.deadLingerSeconds) this.doomed.push(index);
  }

  eliminate(index, base) {
    if (this.store.data[base + F.STAGE] === Stage.SEED) this.doomed.push(index);
    else this.kill(base);
  }

  kill(base) {
    const data = this.store.data;
    data[base + F.STAGE] = Stage.DEAD;
    data[base + F.DEAD] = 0;
  }

  dispatchSeeds() {
    const data = this.store.data;
    const windAngleRad = (this.weather.windAngle * Math.PI) / 180;
    const windSpeed = this.weather.windSpeed;
    for (const parentIndex of this.parents) {
      if (this.store.isFull) break;
      const base = parentIndex * STRIDE;
      const cfg = SPECIES[data[base + F.SPECIES]];
      const randomAngle = this.rng.range(0, TWO_PI);
      const angle = randomAngle * (1 - WEATHER.windSeedAlign) + windAngleRad * WEATHER.windSeedAlign
        + (this.rng.next() - 0.5) * 0.6;
      const distance = this.rng.range(1, cfg.seedRadius) * (1 + windSpeed * WEATHER.windSeedDistanceBonus);
      const x = data[base + F.X] + Math.cos(angle) * distance;
      const z = data[base + F.Z] + Math.sin(angle) * distance;
      if (!this.island.canPlantAt(x, z)) continue;
      if (!this.canLive(cfg, this.island.soilAt(x, z))) continue;
      this.spawn(cfg.id, x, z, 0);
    }
  }

  immigrate() {
    if (this.store.count >= RULES.plantCapacity * 0.9) return;
    if (this.rng.next() >= CLIMATE.immigrationChancePerTick) return;
    const distance = Math.sqrt(this.rng.next()) * this.island.radius * 0.9;
    const angle = this.rng.range(0, TWO_PI);
    const x = Math.cos(angle) * distance;
    const z = Math.sin(angle) * distance;
    if (!this.island.canPlantAt(x, z)) return;
    const speciesId = this.pickSpeciesAt(x, z, CLIMATE.immigrationMinFitness);
    if (speciesId >= 0) this.spawn(speciesId, x, z, 0);
  }

  pickSpeciesAt(x, z, minFitness) {
    const soil = this.island.soilAt(x, z);
    if (soil === Soil.WATER) return -1;
    const y = this.island.heightAt(x, z);
    let total = 0;
    const weights = this.pickWeights;
    for (let s = 0; s < SPECIES.length; s++) {
      const cfg = SPECIES[s];
      const fit = this.canLive(cfg, soil) ? this.climate.fitnessAt(s, x, y, z) : 0;
      weights[s] = fit >= minFitness ? fit * fit : 0;
      total += weights[s];
    }
    if (total <= 0) return -1;
    let roll = this.rng.next() * total;
    for (let s = 0; s < SPECIES.length; s++) {
      roll -= weights[s];
      if (roll <= 0 && weights[s] > 0) return s;
    }
    return -1;
  }

  removeDoomed() {
    for (let k = this.doomed.length - 1; k >= 0; k--) this.store.removeAt(this.doomed[k]);
  }

  #initCoverGrid() {
    const cell = WEATHER.coverCellSize;
    const size = Math.ceil((WORLD.islandRadius * 2.4) / cell);
    this.coverSize = size;
    this.coverCell = cell;
    this.coverExtent = (size * cell) / 2;
    this.coverGrid = new Float32Array(size * size);
  }

  refreshCover() {
    this.coverGrid.fill(0);
    const data = this.store.data;
    const size = this.coverSize;
    const cell = this.coverCell;
    const extent = this.coverExtent;
    for (let i = 0; i < this.store.count; i++) {
      const base = i * STRIDE;
      if (data[base + F.STAGE] !== Stage.ADULT) continue;
      const cfg = SPECIES[data[base + F.SPECIES]];
      if (cfg.layer !== 'tree') continue;
      const gx = Math.floor((data[base + F.X] + extent) / cell);
      const gz = Math.floor((data[base + F.Z] + extent) / cell);
      if (gx < 0 || gz < 0 || gx >= size || gz >= size) continue;
      this.coverGrid[gz * size + gx] += 0.35;
    }
    for (let i = 0; i < this.coverGrid.length; i++) {
      this.coverGrid[i] = Math.min(1, this.coverGrid[i]);
    }
  }

  coverAt(x, z) {
    const gx = Math.floor((x + this.coverExtent) / this.coverCell);
    const gz = Math.floor((z + this.coverExtent) / this.coverCell);
    if (gx < 0 || gz < 0 || gx >= this.coverSize || gz >= this.coverSize) return 0;
    return this.coverGrid[gz * this.coverSize + gx];
  }

  spawn(speciesId, x, z, age) {
    const cfg = SPECIES[speciesId];
    const stage = this.stageForAge(cfg, age);
    return this.store.add({
      species: speciesId,
      x,
      y: this.island.heightAt(x, z),
      z,
      age,
      stage,
      scale: this.scaleFor(cfg, stage, age),
      rotation: this.rng.range(0, TWO_PI),
      leaf: cfg.leaf.strategy === 'none' ? 1 : this.initialLeaf(cfg, stage, age),
    });
  }

  initialLeaf(cfg, stage, age) {
    if (stage === Stage.ADULT) return 1;
    if (stage === Stage.SEED) return 0;
    const progress = clamp01((age - cfg.germinationAge) / (cfg.matureAge - cfg.germinationAge));
    return 0.85 * smoothstep(LEAF.saplingStart, 1, progress);
  }

  stageForAge(cfg, age) {
    if (age < cfg.germinationAge) return Stage.SEED;
    if (age < cfg.matureAge) return Stage.SAPLING;
    return Stage.ADULT;
  }

  scaleFor(cfg, stage, age) {
    if (stage === Stage.SEED) return SEED_SCALE;
    if (stage === Stage.SAPLING) {
      const t = clamp01((age - cfg.germinationAge) / (cfg.matureAge - cfg.germinationAge));
      return lerp(0.3, 0.7, t);
    }
    return lerp(0.7, 1, clamp01((age - cfg.matureAge) / RULES.growthSpanAfterMaturity));
  }

  populate() {
    const radius = this.island.radius * 0.85;
    let placed = 0;
    for (let attempt = 0; placed < INITIAL_PLANTS && attempt < INITIAL_PLANTS * 40; attempt++) {
      const distance = Math.sqrt(this.rng.next()) * radius;
      const angle = this.rng.range(0, TWO_PI);
      const x = Math.cos(angle) * distance;
      const z = Math.sin(angle) * distance;
      if (!this.island.canPlantAt(x, z)) continue;
      if (this.island.soilAt(x, z) !== Soil.GRASSLAND) continue;
      const speciesId = this.pickSpeciesAt(x, z, 0.3);
      if (speciesId < 0) continue;
      const cfg = SPECIES[speciesId];
      if (this.store.countNeighbours(x, z, cfg.crowdingRadius, -1, 0, this.layerMasks[cfg.id]) > 0) continue;
      const age = this.rng.range(cfg.germinationAge, cfg.matureAge + 25);
      this.spawn(speciesId, x, z, age);
      placed++;
    }
    this.refreshCover();
  }

  createMemento() {
    return Object.freeze({
      simTime: this.simTime,
      rngState: this.rng.state,
      seed: this.seed,
      soilMode: this.soilMode,
      weather: { ...this.weather },
      climateTarget: { ...this.climate.target },
      climate: { ...this.climate.params },
      soil: this.island.createSoilSnapshot(),
      soilEvolveAcc: this.soilEvolveAcc,
      coverTick: this.coverTick,
      plants: this.store.createSnapshot(),
    });
  }

  restoreMemento(memento) {
    this.simTime = memento.simTime;
    this.rng.state = memento.rngState;
    if (memento.seed !== undefined) this.seed = memento.seed;
    this.soilMode = memento.soilMode;
    this.weatherCore.restore(memento.weather);
    if (memento.climateTarget) {
      this.climate.setTarget(memento.climateTarget.temperature, memento.climateTarget.moisture);
    }
    if (memento.climate) {
      this.climate.setLive(memento.climate.temperature, memento.climate.moisture);
    }
    if (memento.soil) this.island.restoreSoilSnapshot(memento.soil);
    else {
      this.island.setSoilMode(memento.soilMode);
      this.island.refreshClimate();
    }
    this.soilEvolveAcc = memento.soilEvolveAcc ?? 0;
    this.coverTick = memento.coverTick ?? 0;
    this.store.restoreSnapshot(memento.plants);
    this.refreshCover();
    this.accumulator = 0;
  }

  commit(mutation) {
    this.time.branchFromCursor();
    mutation();
    this.time.capture(this);
  }

  play() {
    this.time.branchFromCursor();
    this.paused = false;
  }

  pause() {
    this.paused = true;
  }

  togglePause() {
    if (this.paused) this.play();
    else this.pause();
  }

  cycleSpeed() {
    this.speedIndex = (this.speedIndex + 1) % SPEED_STEPS.length;
  }

  scrubTo(index) {
    this.paused = true;
    this.restoreMemento(this.time.seek(index));
  }

  resumeLive() {
    this.scrubTo(this.time.length - 1);
    this.play();
  }

  setRain(raining) {
    this.commit(() => {
      this.weather.raining = raining;
      this.weather.precip = raining ? Math.max(this.weather.precip, WEATHER.precipRainThreshold) : 0;
      this.weather.isSnow = raining && this.weather.temperature < WEATHER.snowTempC;
      if (!raining) this.weather.timeSinceRain = 0;
    });
  }

  setAutoWeather(enabled) {
    this.commit(() => {
      this.weather.autoWeather = enabled;
    });
  }

  setWindSpeed(speed) {
    this.commit(() => {
      this.weather.windSpeed = speed;
    });
  }

  setWindAngle(angle) {
    this.commit(() => {
      this.weather.windAngle = angle;
    });
  }

  /** Ręczna edycja aktualnej pogody (gdy auto wyłączone). */
  setLiveTemperature(value) {
    this.commit(() => {
      this.weather.temperature = value;
      this.weather.isSnow = this.weather.raining && value < WEATHER.snowTempC;
      this.climate.setLive(value, this.weather.airMoisture);
      this.island.refreshClimate();
    });
  }

  setLiveAirMoisture(value) {
    this.commit(() => {
      this.weather.airMoisture = Math.min(1, Math.max(0, value));
      this.climate.setLive(this.weather.temperature, this.weather.airMoisture);
      this.island.refreshClimate();
    });
  }

  setLiveSoilMoisture(value) {
    this.commit(() => {
      this.weather.soilMoisture = Math.min(1, Math.max(0, value));
    });
  }

  setLivePrecip(value) {
    this.commit(() => {
      this.weather.precip = Math.min(1, Math.max(0, value));
      this.weather.raining = this.weather.precip >= WEATHER.precipRainThreshold;
      this.weather.isSnow = this.weather.raining && this.weather.temperature < WEATHER.snowTempC;
      if (this.weather.raining) this.weather.timeSinceRain = 0;
    });
  }

  setTemperature(value) {
    this.commit(() => {
      this.climate.setTarget(value, this.climate.target.moisture);
    });
  }

  setMoisture(value) {
    this.commit(() => {
      this.climate.setTarget(this.climate.target.temperature, value);
    });
  }

  setClimate(temperature, moisture) {
    this.commit(() => {
      this.climate.setTarget(temperature, moisture);
    });
  }

  /** Natychmiast skopiuj cel → pogodę (demo / testy). */
  applyClimateInstant() {
    this.commit(() => {
      this.weatherCore.applyInstant();
      this.island.refreshClimate();
    });
  }

  /**
   * Nowy seed + pełny reset populacji i historii.
   * @param {number} [seed] jeśli brak — losowy
   */
  setSeed(seed = (Math.random() * 0xffffffff) >>> 0) {
    this.seed = seed >>> 0;
    this.rng = new SeededRandom(this.seed);
    this.simTime = 0;
    this.accumulator = 0;
    this.soilEvolveAcc = 0;
    this.store.count = 0;
    this.store.nextId = 1;
    this.time.history.length = 0;
    this.time.cursor = -1;
    this.island.regenerate(this.seed);
    this.weatherCore.applyInstant();
    this.populate();
    this.time.capture(this);
    this.paused = false;
  }

  setSoilMode(mode) {
    this.commit(() => {
      this.soilMode = mode;
      this.island.setSoilMode(mode);
    });
  }

  triggerLightning() {
    this.commit(() => {
      const target = this.pickLightningTarget();
      if (!target) return;
      this.destroyAround(target.x, target.z, RULES.lightningKillRadius);
      this.lightningListeners.forEach((listener) => listener(target));
    });
  }

  pickLightningTarget() {
    const data = this.store.data;
    const candidates = [];
    for (let i = 0; i < this.store.count; i++) {
      const base = i * STRIDE;
      if (data[base + F.STAGE] === Stage.ADULT && SPECIES[data[base + F.SPECIES]].attractsLightning) {
        candidates.push(base);
      }
    }
    if (candidates.length === 0) return null;
    const base = this.rng.pick(candidates);
    return { x: data[base + F.X], y: data[base + F.Y], z: data[base + F.Z] };
  }

  destroyAround(x, z, radius) {
    const data = this.store.data;
    const radiusSq = radius * radius;
    for (let i = 0; i < this.store.count; i++) {
      const base = i * STRIDE;
      if (data[base + F.STAGE] === Stage.DEAD) continue;
      const dx = data[base + F.X] - x;
      const dz = data[base + F.Z] - z;
      if (dx * dx + dz * dz <= radiusSq) this.kill(base);
    }
  }
}
