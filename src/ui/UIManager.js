import GUI from 'lil-gui';
import { BIOMES, CLIMATE, CLIMATE_PRESETS, SIM_SEED, SPECIES, SoilMode, WEATHER } from '../config.js';

const STATS_REFRESH_FRAMES = 15;

export class UIManager {
  constructor({ simulation, timeManager, store }) {
    this.simulation = simulation;
    this.time = timeManager;
    this.store = store;
    this.frame = 0;
    this.lastMax = 1;
    this.lastPlayLabel = '';
    this.lastSpeedLabel = '';
    this.lastAuto = simulation.weather.autoWeather;

    this.params = {
      timeline: 0,
      clock: '0.0 s',
      rain: simulation.weather.raining,
      autoWeather: simulation.weather.autoWeather,
      windSpeed: simulation.weather.windSpeed,
      windAngle: simulation.weather.windAngle,
      soil: simulation.soilMode,
      targetTemperature: simulation.climate.target.temperature,
      targetMoisture: simulation.climate.target.moisture,
      liveTemperature: simulation.climate.params.temperature,
      liveMoisture: simulation.climate.params.moisture,
      soilMoisture: simulation.weather.soilMoisture,
      precip: simulation.weather.precip,
      isSnow: false,
      biome: '',
      preset: '—',
      seed: simulation.seed,
      seeds: 0,
      saplings: 0,
      adults: 0,
      dead: 0,
    };

    this.gui = new GUI({ title: 'Ekosystem wyspy' });
    this.#buildTimeControls();
    this.#buildWeatherControls();
    this.#buildClimateControls();
    this.#buildSoilControls();
    this.#buildSeedControls();
    this.#buildEventControls();
    this.#buildStatsControls();
    this.#buildSpeciesControls();
    this.#applyManualWeatherEnabled(!this.params.autoWeather);
  }

  sync() {
    const { simulation, time, params } = this;
    const max = Math.max(1, time.length - 1);
    if (max !== this.lastMax) {
      this.timelineController.max(max);
      this.lastMax = max;
    }

    const w = simulation.weather;
    params.timeline = time.cursor;
    params.clock = `${simulation.simTime.toFixed(1)} s${time.isAtHead ? '' : '  (podgląd historii)'}`;
    params.rain = w.raining;
    params.autoWeather = w.autoWeather;
    params.windSpeed = w.windSpeed;
    params.windAngle = w.windAngle;
    params.soil = simulation.soilMode;
    params.targetTemperature = simulation.climate.target.temperature;
    params.targetMoisture = simulation.climate.target.moisture;
    params.liveTemperature = w.temperature;
    params.liveMoisture = w.airMoisture;
    params.soilMoisture = w.soilMoisture;
    params.precip = w.precip;
    params.isSnow = !!w.isSnow;
    params.seed = simulation.seed;
    params.biome = this.#biomeLabel();

    if (w.autoWeather !== this.lastAuto) {
      this.lastAuto = w.autoWeather;
      this.#applyManualWeatherEnabled(!w.autoWeather);
    }

    const playLabel = simulation.paused ? '▶ Wznów' : '⏸ Pauza';
    if (playLabel !== this.lastPlayLabel) {
      this.playController.name(playLabel);
      this.lastPlayLabel = playLabel;
    }
    const speedLabel = `⏩ Przyspiesz (×${simulation.speed})`;
    if (speedLabel !== this.lastSpeedLabel) {
      this.speedController.name(speedLabel);
      this.lastSpeedLabel = speedLabel;
    }

    if (this.frame++ % STATS_REFRESH_FRAMES === 0) this.#refreshStats();
  }

  #applyManualWeatherEnabled(manual) {
    const ctrls = [this.liveTempCtrl, this.liveAirCtrl, this.liveSoilCtrl, this.livePrecipCtrl];
    for (const ctrl of ctrls) {
      if (!ctrl) continue;
      if (manual) ctrl.enable();
      else ctrl.disable();
    }
  }

  #buildTimeControls() {
    const { simulation, params } = this;
    const folder = this.gui.addFolder('Oś czasu');

    this.timelineController = folder
      .add(params, 'timeline', 0, 1, 1)
      .name('Snapshot')
      .onChange((value) => simulation.scrubTo(Math.round(value)))
      .listen();

    folder.add(params, 'clock').name('Czas symulacji').disable().listen();

    const actions = {
      togglePlay: () => simulation.togglePause(),
      fastForward: () => simulation.cycleSpeed(),
      live: () => simulation.resumeLive(),
    };
    this.playController = folder.add(actions, 'togglePlay').name('⏸ Pauza');
    this.speedController = folder.add(actions, 'fastForward').name('⏩ Przyspiesz (×1)');
    folder.add(actions, 'live').name('⏭ Wznów na żywo');
  }

  #buildWeatherControls() {
    const { simulation, params } = this;
    const folder = this.gui.addFolder('Pogoda (aktualna)');
    folder.add(params, 'autoWeather').name('Auto pogoda').onChange((v) => {
      simulation.setAutoWeather(v);
      this.#applyManualWeatherEnabled(!v);
    }).listen();
    folder.add(params, 'rain').name('Deszcz').onChange((v) => simulation.setRain(v)).listen();
    folder.add(params, 'windSpeed', 0, WEATHER.windSpeedMax, 0.01).name('Siła wiatru').onChange((v) => simulation.setWindSpeed(v)).listen();
    folder.add(params, 'windAngle', 0, 360, 1).name('Kierunek wiatru [°]').onChange((v) => simulation.setWindAngle(v)).listen();

    this.liveTempCtrl = folder
      .add(params, 'liveTemperature', CLIMATE.temperature.min, CLIMATE.temperature.max, 0.5)
      .name('T aktualna [°C]')
      .onChange((v) => simulation.setLiveTemperature(v))
      .listen();
    this.liveAirCtrl = folder
      .add(params, 'liveMoisture', 0, 1, 0.01)
      .name('Wilg. powietrza')
      .onChange((v) => simulation.setLiveAirMoisture(v))
      .listen();
    this.liveSoilCtrl = folder
      .add(params, 'soilMoisture', 0, 1, 0.01)
      .name('Wilg. gleby')
      .onChange((v) => simulation.setLiveSoilMoisture(v))
      .listen();
    this.livePrecipCtrl = folder
      .add(params, 'precip', 0, 1, 0.01)
      .name('Opad (precip)')
      .onChange((v) => simulation.setLivePrecip(v))
      .listen();
    folder.add(params, 'isSnow').name('Śnieg').disable().listen();
  }

  #buildClimateControls() {
    const { simulation, params } = this;
    const folder = this.gui.addFolder('Klimat (cel)');
    const { temperature, moisture } = CLIMATE;
    folder
      .add(params, 'targetTemperature', temperature.min, temperature.max, 0.5)
      .name('Cel T [°C]')
      .onChange((v) => simulation.setTemperature(v))
      .listen();
    folder
      .add(params, 'targetMoisture', moisture.min, moisture.max, 0.01)
      .name('Cel wilgotności')
      .onChange((v) => simulation.setMoisture(v))
      .listen();
    folder.add(params, 'biome').name('Biom (live)').disable().listen();
    folder
      .add(params, 'preset', ['—', ...Object.keys(CLIMATE_PRESETS)])
      .name('Preset')
      .onChange((name) => {
        if (CLIMATE_PRESETS[name]) simulation.setClimate(...CLIMATE_PRESETS[name]);
        params.preset = '—';
      });
    folder
      .add({ apply: () => simulation.applyClimateInstant() }, 'apply')
      .name('Zastosuj natychmiast');
  }

  #biomeLabel() {
    const info = this.simulation.climate.describe();
    const main = `${BIOMES[info.primary].label} ${Math.round(info.primaryShare * 100)}%`;
    return info.secondary ? `${main} + ${BIOMES[info.secondary].label} ${Math.round(info.secondaryShare * 100)}%` : main;
  }

  #buildSoilControls() {
    const { simulation, params } = this;
    const folder = this.gui.addFolder('Gleba');
    folder
      .add(params, 'soil', Object.values(SoilMode))
      .name('Typ gleby')
      .onChange((v) => simulation.setSoilMode(v))
      .listen();
  }

  #buildSeedControls() {
    const { simulation, params } = this;
    const folder = this.gui.addFolder('Losowość');
    folder.add(params, 'seed').name('Seed').listen();
    const actions = {
      applySeed: () => {
        const n = Number(params.seed);
        simulation.setSeed(Number.isFinite(n) ? n >>> 0 : SIM_SEED);
      },
      randomSeed: () => {
        const n = (Math.random() * 0xffffffff) >>> 0;
        params.seed = n;
        simulation.setSeed(n);
      },
    };
    folder.add(actions, 'applySeed').name('Zastosuj seed (reset)');
    folder.add(actions, 'randomSeed').name('Losowy seed (reset)');
  }

  #buildEventControls() {
    const { simulation } = this;
    const folder = this.gui.addFolder('Eventy');
    folder.add({ strike: () => simulation.triggerLightning() }, 'strike').name('⚡ Uderzenie pioruna');
  }

  #buildStatsControls() {
    const { params } = this;
    const folder = this.gui.addFolder('Populacja');
    [
      ['seeds', 'Nasiona'],
      ['saplings', 'Sadzonki'],
      ['adults', 'Dorosłe'],
      ['dead', 'Martwe'],
    ].forEach(([key, label]) => folder.add(params, key).name(label).disable().listen());
  }

  #buildSpeciesControls() {
    const folder = this.gui.addFolder('Gatunki (żywe)');
    this.speciesParams = {};
    SPECIES.forEach((cfg) => {
      this.speciesParams[cfg.key] = 0;
      folder.add(this.speciesParams, cfg.key).name(cfg.name).disable().listen();
    });
  }

  #refreshStats() {
    const [seeds, saplings, adults, dead] = this.store.stageCounts();
    Object.assign(this.params, { seeds, saplings, adults, dead });
    const counts = this.store.speciesCounts(SPECIES.length);
    SPECIES.forEach((cfg, i) => { this.speciesParams[cfg.key] = counts[i]; });
  }
}
