import { CLIMATE, WEATHER, WEATHER_RULES, WEATHER_SETS } from '../config.js';
import { evaluateRules } from './Fuzzy.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const clamp01 = (v) => clamp(v, 0, 1);
const TAU = Math.PI * 2;

/**
 * Autonomiczna pogoda wokół celu klimatu (target T + moisture).
 * Fuzzy daje krótkie wahania; chase trzyma klimat; applyInstant skacze od razu.
 */
export class WeatherCore {
  constructor(climate) {
    this.climate = climate;
    this.state = {
      temperature: CLIMATE.temperature.default,
      airMoisture: CLIMATE.moisture.default,
      soilMoisture: CLIMATE.moisture.default,
      windSpeed: WEATHER.windSpeedDefault,
      windAngle: WEATHER.windAngleDefault,
      precip: 0,
      isSnow: false,
      raining: false,
      autoWeather: true,
      // legacy fields kept for memento / UI compatibility
      timeSinceRain: 0,
      nextRainToggle: 0,
    };
    this.#syncClimateLive();
  }

  get weather() {
    return this.state;
  }

  /** Skopiuj cel → aktualną pogodę (T, airM); soilM dociągnij do airM. */
  applyInstant() {
    const t = this.climate.target;
    this.state.temperature = t.temperature;
    this.state.airMoisture = t.moisture;
    this.state.soilMoisture = t.moisture;
    this.state.precip = 0;
    this.state.isSnow = false;
    this.state.raining = false;
    this.state.timeSinceRain = 0;
    this.#syncClimateLive();
  }

  /** Ustaw stan z mementa / zewnętrznego obiektu. */
  restore(snapshot) {
    Object.assign(this.state, snapshot);
    this.#syncClimateLive();
  }

  /**
   * Jeden tick pogody.
   * @param {number} dt sekundy
   * @param {number} simTime czas symulacji
   * @param {{ next: () => number, range: (a:number,b:number)=>number }} rng
   */
  step(dt, simTime, rng) {
    const s = this.state;
    const target = this.climate.target;

    const seasonPhase = (Math.sin((simTime / WEATHER.seasonPeriodSeconds) * TAU) + 1) * 0.5;
    const seasonalT = target.temperature + WEATHER.seasonAmplitude * Math.sin((simTime / WEATHER.seasonPeriodSeconds) * TAU);
    const chaseT = seasonalT;
    const chaseM = target.moisture;

    if (s.autoWeather) {
      const fuzzy = evaluateRules(
        {
          temp: s.temperature,
          airM: s.airMoisture,
          soilM: s.soilMoisture,
          wind: s.windSpeed,
          season: seasonPhase,
        },
        WEATHER_SETS,
        WEATHER_RULES,
      );

      // Chase + małe delty z fuzzy (dTemp 0..1 → −1..+1 °C/s skalowane)
      const dTempFuzzy = ((fuzzy.dTemp ?? 0.5) - 0.5) * 2.5;
      const dAirFuzzy = ((fuzzy.dAirM ?? 0.5) - 0.5) * 0.15;
      const precipTarget = fuzzy.precipRate ?? 0.2;
      const windTarget = (fuzzy.dWind ?? 0.4) * WEATHER.windSpeedMax;

      s.temperature += (chaseT - s.temperature) * WEATHER.chaseRate * dt + dTempFuzzy * dt;
      s.airMoisture += (chaseM - s.airMoisture) * WEATHER.chaseRate * dt + dAirFuzzy * dt;

      s.precip += (precipTarget - s.precip) * Math.min(1, 1.2 * dt);
      s.windSpeed += (windTarget - s.windSpeed) * Math.min(1, 0.4 * dt);
      // Powolny dryf kierunku + jitter
      s.windAngle = (s.windAngle + rng.range(-8, 8) * dt + (rng.next() - 0.5) * 4) % 360;
      if (s.windAngle < 0) s.windAngle += 360;

      // Gleba: goni cel klimatu; deszcz/parowanie dają małe wahania w paśmie
      const snow = s.temperature < WEATHER.snowTempC && s.precip > WEATHER.precipRainThreshold * 0.5;
      const soilGain = s.precip * WEATHER.soilFromPrecip * (snow ? WEATHER.snowSoilFactor : 1);
      const soilLoss = WEATHER.soilEvapBase * (1 - s.precip) * (0.5 + 0.5 * (fuzzy.dSoilM !== undefined ? 1 - fuzzy.dSoilM : 0.5));
      const soilBias = ((fuzzy.dSoilM ?? 0.5) - 0.5) * 0.06;
      s.soilMoisture += (chaseM - s.soilMoisture) * WEATHER.soilChaseRate * dt;
      s.soilMoisture += (soilGain - soilLoss + soilBias) * WEATHER.soilWeatherScale * dt;
      const lo = clamp01(chaseM - WEATHER.soilSwingAmp);
      const hi = clamp01(chaseM + WEATHER.soilSwingAmp);
      s.soilMoisture = clamp(s.soilMoisture, lo, hi);
    }

    s.temperature = clamp(s.temperature, CLIMATE.temperature.min, CLIMATE.temperature.max);
    s.airMoisture = clamp01(s.airMoisture);
    s.soilMoisture = clamp01(s.soilMoisture);
    s.windSpeed = clamp(s.windSpeed, 0, WEATHER.windSpeedMax);
    s.precip = clamp01(s.precip);

    s.raining = s.precip >= WEATHER.precipRainThreshold;
    s.isSnow = s.raining && s.temperature < WEATHER.snowTempC;
    s.timeSinceRain = s.raining ? 0 : s.timeSinceRain + dt;

    this.#syncClimateLive();
  }

  #syncClimateLive() {
    this.climate.setLive(this.state.temperature, this.state.airMoisture);
  }
}
