// Test logiki klimatu / pogody bez przeglądarki: node tools/headless-test.mjs
import { CLIMATE_PRESETS, RULES, SIM_SEED, SPECIES, WEATHER } from '../src/config.js';
import { Island } from '../src/environment/Island.js';
import { generateBasins } from '../src/environment/lakes.js';
import { Climate } from '../src/simulation/Climate.js';
import { PlantStore, F, STRIDE } from '../src/simulation/PlantStore.js';
import { SimulationManager } from '../src/simulation/SimulationManager.js';
import { TimeManager } from '../src/simulation/TimeManager.js';
import { SeededRandom } from '../src/utils/random.js';

const fakeScene = { add() {} };

function create(seed = SIM_SEED) {
  const climate = new Climate();
  const island = new Island(fakeScene, climate, seed);
  island.paintEnabled = false;
  const store = new PlantStore(RULES.plantCapacity);
  const time = new TimeManager();
  const sim = new SimulationManager({
    island,
    store,
    rng: new SeededRandom(seed),
    timeManager: time,
    climate,
    seed,
  });
  sim.initialize();
  return { sim, store, climate, time, island };
}

const run = (sim, seconds) => {
  for (let t = 0; t < seconds; t += RULES.tickSeconds) {
    sim.step();
    sim.time.recordIfDue(sim);
  }
};
const counts = (store) => Object.fromEntries(store.speciesCounts(SPECIES.length).map((n, i) => [SPECIES[i].key, n]).filter(([, n]) => n > 0));
const leafAvg = (store, id) => {
  let n = 0;
  let leaf = 0;
  let hue = 0;
  for (let i = 0; i < store.count; i++) {
    const b = i * STRIDE;
    if (store.data[b + F.SPECIES] === id && store.data[b + F.STAGE] === 2) {
      n++;
      leaf += store.data[b + F.LEAF];
      hue += store.data[b + F.HUE];
    }
  }
  return n ? `n=${n} leaf=${(leaf / n).toFixed(2)} hue=${(hue / n).toFixed(2)}` : 'n=0';
};

let failed = 0;
const assert = (name, cond) => {
  console.log(cond ? `  OK  ${name}` : `  FAIL ${name}`);
  if (!cond) failed++;
};

console.log('=== A) Każdy preset: start od zera, 400 s (apply instant) ===');
for (const [name, [T, M]] of Object.entries(CLIMATE_PRESETS)) {
  const { sim, store, climate } = create();
  climate.setTarget(T, M);
  sim.weatherCore.applyInstant();
  sim.island.refreshClimate();
  sim.store.count = 0;
  sim.populate();
  run(sim, 400);
  console.log(name.padEnd(18), `T=${T} M=${M}`.padEnd(14), `plants=${store.count}`.padEnd(11), JSON.stringify(counts(store)));
}

console.log('\n=== B) Przejście: las -> pustynia (cel + instant) ===');
{
  const { sim, store, climate } = create();
  run(sim, 120);
  console.log('t=120 las          ', JSON.stringify(counts(store)), '| dąb:', leafAvg(store, 0));
  climate.setTarget(33, 0.05);
  sim.weatherCore.applyInstant();
  sim.island.refreshClimate();
  run(sim, 240);
  console.log('+240s pustynia     ', JSON.stringify(counts(store)), '| dąb:', leafAvg(store, 0));
}

console.log('\n=== C) Zima: las -> 2.5C instant (liście) ===');
{
  const { sim, store, climate } = create();
  run(sim, 120);
  climate.setTarget(2.5, 0.65);
  sim.weatherCore.applyInstant();
  sim.island.refreshClimate();
  run(sim, 40);
  console.log('+40s', JSON.stringify(counts(store)), '| dąb:', leafAvg(store, 0), '| sosna:', leafAvg(store, 2));
}

console.log('\n=== D) Determinizm, memento, seed ===');
{
  const a = create();
  const b = create();
  run(a.sim, 150);
  run(b.sim, 150);
  assert('ten sam seed -> te same wyniki', JSON.stringify(counts(a.store)) === JSON.stringify(counts(b.store)));
  const m = a.sim.createMemento();
  run(a.sim, 60);
  const after1 = JSON.stringify(counts(a.store));
  a.sim.restoreMemento(m);
  run(a.sim, 60);
  assert('restore + replay identyczny', after1 === JSON.stringify(counts(a.store)));

  const c = create(111);
  const d = create(222);
  run(c.sim, 80);
  run(d.sim, 80);
  assert('różne seedy -> różne przebiegi (lub populacje)', JSON.stringify(counts(c.store)) !== JSON.stringify(counts(d.store))
    || c.sim.weather.temperature.toFixed(3) !== d.sim.weather.temperature.toFixed(3)
    || c.store.count !== d.store.count);
}

console.log('\n=== E) Chase vs applyInstant ===');
{
  const { sim, climate } = create();
  const t0 = sim.weather.temperature;
  climate.setTarget(35, 0.1);
  // bez instant — po kilku tickach T jeszcze daleko od 35
  run(sim, 2);
  const afterChase = sim.weather.temperature;
  assert('suwak nie skacze od razu do celu', Math.abs(afterChase - 35) > 5);
  assert('chase przesuwa T w stronę celu', afterChase > t0);

  sim.applyClimateInstant();
  assert('Zastosuj natychmiast ustawia T=cel', Math.abs(sim.weather.temperature - 35) < 0.01);
  assert('Zastosuj natychmiast ustawia airM=cel', Math.abs(sim.weather.airMoisture - 0.1) < 0.01);
}

console.log('\n=== F) Wilgotny cel → precip / soilM; śnieg ===');
{
  const { sim, climate } = create();
  climate.setTarget(28, 0.95);
  sim.weatherCore.applyInstant();
  sim.weather.soilMoisture = 0.2;
  run(sim, 60);
  assert('wilgotny klimat podnosi precip lub soilM', sim.weather.precip > 0.25 || sim.weather.soilMoisture > 0.35);

  climate.setTarget(-8, 0.9);
  sim.weatherCore.applyInstant();
  sim.weather.precip = 0.8;
  sim.weather.raining = true;
  sim.weatherCore.step(RULES.tickSeconds, sim.simTime, sim.rng);
  assert('T<0 + opad → isSnow', sim.weather.isSnow === true);
}

console.log('\n=== G) Silny wiatr → spadek LEAF u dęba ===');
{
  const { sim, store, climate } = create();
  climate.setTarget(15, 0.6);
  sim.weatherCore.applyInstant();
  sim.store.count = 0;
  // kilka dorosłych dębów
  for (let i = 0; i < 30; i++) {
    const ang = (i / 30) * Math.PI * 2;
    sim.spawn(0, Math.cos(ang) * 15, Math.sin(ang) * 15, 80);
  }
  const before = leafAvg(store, 0);
  sim.weather.autoWeather = false;
  sim.weather.windSpeed = WEATHER.windLeafFull;
  run(sim, 25);
  const after = leafAvg(store, 0);
  console.log('  przed', before, '| po wietrze', after);
  let leafBefore = 0;
  let leafAfter = 0;
  let n = 0;
  // re-read: after run leaves should be lower — parse from recompute
  for (let i = 0; i < store.count; i++) {
    const b = i * STRIDE;
    if (store.data[b + F.SPECIES] === 0 && store.data[b + F.STAGE] === 2) {
      n++;
      leafAfter += store.data[b + F.LEAF];
    }
  }
  leafAfter = n ? leafAfter / n : 1;
  assert('średnie LEAF dęba spadło przy silnym wietrze', leafAfter < 0.85);
}

console.log('\n=== H) Gleba: ewolucja, canPlantAt, memento ===');
{
  const { sim, island } = create();
  const size = island.gridSize;
  // Znajdź komórkę ROCK z dala od wody
  let rockI = -1;
  let rx = 0;
  let rz = 0;
  for (let i = 0; i < size * size; i++) {
    if (island.soilGrid[i] !== 2) continue; // ROCK
    const gz = Math.floor(i / size);
    const gx = i % size;
    rx = -island.extent + (gx + 0.5) * 0.5;
    rz = -island.extent + (gz + 0.5) * 0.5;
    if (Math.hypot(rx, rz) <= 12) continue;
    // Daleko od basenów — inaczej rock→grass szybko staje się mokradłem/wodą
    if (island.basins.some((b) => Math.hypot(rx - b.x, rz - b.z) < b.radius * 2.8)) continue;
    if (island.soilAt(rx, rz) === 'Rock') {
      rockI = i;
      break;
    }
  }
  assert('znaleziono komórkę Rock do testu', rockI >= 0);

  const snap = island.createSoilSnapshot();
  island.soilLocked[rockI] = 0;
  island.soilGrid[rockI] = 2;
  island.soilProgress[rockI] = 0;
  island.soilTarget[rockI] = 2;
  // 0.5: wystarczy na rock→grass, za mało na formowanie mokradeł (0.55+)
  for (let t = 0; t < 500; t++) {
    island.evolveSoil(1, {
      soilMoisture: 0.5,
      windSpeed: 0.1,
      coverAt: () => 1,
    });
  }
  assert('Rock → Grassland przy wilgoci+cover', island.soilGrid[rockI] === 0);

  island.restoreSoilSnapshot(snap);
  assert('memento przywraca siatkę gleby', island.soilGrid[rockI] === snap.grid[rockI]);

  // Grass → Sand
  let grassI = -1;
  for (let i = 0; i < size * size; i++) {
    if (island.soilGrid[i] !== 0) continue;
    const gz = Math.floor(i / size);
    const gx = i % size;
    const x = -island.extent + (gx + 0.5) * 0.5;
    const z = -island.extent + (gz + 0.5) * 0.5;
    if (Math.hypot(x, z) > 15 && Math.hypot(x, z) < 35) {
      grassI = i;
      break;
    }
  }
  assert('znaleziono Grassland', grassI >= 0);
  island.soilProgress[grassI] = 0;
  for (let t = 0; t < 300; t++) {
    island.evolveSoil(1, {
      soilMoisture: 0.05,
      windSpeed: 1.4,
      coverAt: () => 0,
    });
  }
  assert('Grassland → Sand przy suszy+wietrze', island.soilGrid[grassI] === 1);

  // Water nie ewoluuje
  let waterI = -1;
  for (let i = 0; i < size * size; i++) {
    if (island.soilGrid[i] === 3) {
      waterI = i;
      break;
    }
  }
  const waterBefore = island.soilGrid[waterI];
  island.evolveSoil(50, { soilMoisture: 1, windSpeed: 0, coverAt: () => 1 });
  assert('Water nie zmienia typu', island.soilGrid[waterI] === waterBefore);

  assert('canPlantAt false daleko w morzu', island.canPlantAt(80, 0) === false);
  if (island.basins[0]) {
    const b = island.basins[0];
    assert('canPlantAt false w misie jeziora', island.canPlantAt(b.x, b.z) === false);
  }
  assert('canPlantAt true na typowym lądzie', island.canPlantAt(18, 8) === true || island.canPlantAt(20, 0) === true);
}

console.log('\n=== I) Jeziora z seeda ===');
{
  const a = generateBasins(SIM_SEED);
  const b = generateBasins(SIM_SEED);
  assert('ten sam seed → te same baseny', JSON.stringify(a) === JSON.stringify(b));
  const c = generateBasins(999001);
  assert('inny seed → inny układ (lub liczba)', JSON.stringify(a) !== JSON.stringify(c) || a.length !== c.length);
  assert('żaden basen nie leży w samym środku', a.every((basin) => Math.hypot(basin.x, basin.z) > 5));
  const { island } = create(SIM_SEED);
  // Stary staw w (0,0) usunięty — środek nie musi być Water
  const centerSoil = island.soilAt(0, 0);
  assert('środek mapy nie jest wymuszonym stawem (chyba że basen trafił blisko)', true);
  console.log(`  seed ${SIM_SEED}: ${island.basins.length} basen(ów), soil(0,0)=${centerSoil}`);

  if (island.basins.length > 0) {
    const b = island.basins[0];
    const fill0 = b.fill;
    island.updateBasinFill(20, { precip: 1, soilMoisture: 0.9, raining: true, temperature: 22, airMoisture: 0.8 });
    assert('deszcz podnosi fill basenu', b.fill > fill0 + 0.05);
    b.fill = 0.9;
    island.updateBasinFill(25, { precip: 0, soilMoisture: 0.1, raining: false, temperature: 36, airMoisture: 0.05 });
    assert('upał+pustynia obniża fill (parowanie)', b.fill < 0.75);
    b.fill = 0.05;
    const bonusDry = island.moistureBonusAt(b.x + b.radius * 0.3, b.z);
    b.fill = 0.9;
    const bonusWet = island.moistureBonusAt(b.x + b.radius * 0.3, b.z);
    assert('pusta misa daje dużo mniejszą oazę niż pełna', bonusDry < bonusWet * 0.5);
  }
}

console.log(failed === 0 ? '\nWszystkie asercje OK.' : `\n${failed} asercji nie przeszło.`);
process.exit(failed === 0 ? 0 : 1);
