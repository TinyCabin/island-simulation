import { RULES, SIM_SEED, SPECIES } from './config.js';
import { Engine } from './core/Engine.js';
import { FloraSystem } from './entities/FloraSystem.js';
import { Island } from './environment/Island.js';
import { WeatherSystem } from './environment/WeatherSystem.js';
import { Climate } from './simulation/Climate.js';
import { PlantStore } from './simulation/PlantStore.js';
import { SimulationManager } from './simulation/SimulationManager.js';
import { TimeManager } from './simulation/TimeManager.js';
import { UIManager } from './ui/UIManager.js';
import { SeededRandom } from './utils/random.js';

const MAX_VISUAL_SPEED = 3;

const engine = new Engine(document.getElementById('app'));
const climate = new Climate();
const island = new Island(engine.scene, climate);
engine.constrainCamera((x, z) => island.heightAt(x, z));

const store = new PlantStore(RULES.plantCapacity);
const timeManager = new TimeManager();
const simulation = new SimulationManager({
  island,
  store,
  rng: new SeededRandom(SIM_SEED),
  timeManager,
  climate,
  seed: SIM_SEED,
});

const flora = new FloraSystem(engine.scene, SPECIES, RULES.plantCapacity);
const weatherSystem = new WeatherSystem(engine);
simulation.onLightning((target) => weatherSystem.strike(target));
simulation.initialize();

const ui = new UIManager({ simulation, timeManager, store });
flora.loadModels();

engine.onFrame((delta, elapsed) => {
  simulation.update(delta);
  const visualDelta = simulation.paused ? 0 : delta * Math.min(simulation.speed, MAX_VISUAL_SPEED);
  weatherSystem.update(delta, visualDelta, simulation.weather);
  flora.render(store, simulation.weather, elapsed);
  ui.sync();
});

engine.start();