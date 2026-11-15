export const Stage = Object.freeze({ SEED: 0, SAPLING: 1, ADULT: 2, DEAD: 3 });

export const Soil = Object.freeze({
  GRASSLAND: 'Grassland',
  SAND: 'Sand',
  ROCK: 'Rock',
  WATER: 'Water',
  WETLAND: 'Wetland',
});

export const SoilMode = Object.freeze({
  MIXED: 'Mixed',
  GRASSLAND: Soil.GRASSLAND,
  SAND: Soil.SAND,
  ROCK: Soil.ROCK,
});

export const WORLD = Object.freeze({
  islandRadius: 50,
  terrainSegments: 200,
  soilGridCell: 0.5,
});

/* Jeziora / mokradła / kałuże — baseny z seeda + reguły wilgotności */
export const LAKES = Object.freeze({
  minCenterDist: 0.18, // × islandRadius — nie w samym środku
  maxCenterDist: 0.62,
  /** Przy fill=1 lustro sięga ~tego ułamka promienia misy (brzeg). */
  fillRadiusMax: 0.94,
  /** Przy fill=0 minimalny „kałużowy” środek (0 = całkowicie puste). */
  fillRadiusMin: 0.08,
  moistureFalloff: 22, // oaza wokół wody
  wetlandPlantBuffer: 0.6, // dodatkowy bufor sadzenia przy mokradle
  // Wypełnianie mis deszczem / wilgocią
  fillFromPrecip: 0.25, // /s przy precip=1
  fillFromSoilM: 0.08, // /s gdy soilM wysokie
  fillDrain: 0.06, // /s przy suszy
  fillWetSoilM: 0.55, // powyżej — dopełnianie z gleby
  fillDrySoilM: 0.35, // poniżej — spadek fill
  // Kałuże tymczasowe
  puddleMax: 12,
  puddleSpawnSoilM: 0.72,
  puddleDrySoilM: 0.38,
  puddleRadius: [1.2, 2.8],
  puddleTickSeconds: 3,
  // Mokradła dynamiczne (niezablokowane komórki)
  wetlandFormSoilM: 0.62,
  wetlandDrySoilM: 0.32,
  wetlandMaxHeight: 0.55, // tylko w zagłębieniach
  wetlandFormRate: 0.04,
  wetlandDryRate: 0.03,
});

/* Ewolucja gleby (tylko Mixed) + reguły sadzenia / wygładzanie paint */
export const SOIL_EVOLVE = Object.freeze({
  tickEverySeconds: 2, // jak często odpalać evolveSoil
  // Co wywołanie aktualizujemy co N-tą komórkę (reszta w kolejnych fazach).
  cellStride: 4,
  // postęp /s przy „pełnej” sile warunków (0..1 → zmiana typu)
  rockToGrassRate: 0.008,
  grassToSandRate: 0.02,
  sandToGrassRate: 0.015,
  // progi lokalnej wilgotności gleby
  wetForGrowth: 0.45,
  dryForErosion: 0.28,
  // pokrywa roślin 0..1
  coverForGrowth: 0.25,
  coverMaxErosion: 0.2, // poniżej → erozja Grass→Sand
  windForErosion: 0.55,
  // sadzenie
  maxSlope: 1.35, // |Δh| / dystans — powyżej za stromo
  slopeSample: 1.2, // odległość próbek wysokości
  coastBuffer: 2.5, // jednostki od linii WATER (morze)
  // paint
  colorBlend: 0.55, // 0 = twarde komórki, 1 = mocny blend sąsiadów
});

/** Seed startowy RNG — ten sam seed = ten sam przebieg; UI może go zmienić i zresetować symulację. */
export const SIM_SEED = 20240611;

export const RULES = Object.freeze({
  tickSeconds: 0.2,
  snapshotIntervalSeconds: 1,
  maxSnapshots: 600,
  plantCapacity: 4000,

  sandDeathSeconds: 12,
  deadLingerSeconds: 10,
  growthSpanAfterMaturity: 20,

  waterSourceRadius: 20,
  wetGrowthMultiplier: 2.5,
  droughtGrowthMultiplier: 0.2,
  droughtAfterSeconds: 50,
  droughtStressLimitSeconds: 45,
  droughtSenescenceMultiplier: 3,

  lightningKillRadius: 5,

  // Zachowane dla kompatybilności UI; auto-pogoda steruje teraz fuzzy + chase.
  autoWeather: Object.freeze({
    rainDuration: [20, 40],
    dryDuration: [45, 90],
  }),
});

/* ==========================================================================
 *  POGODA: chase celu klimatu + lekki fuzzy
 * ========================================================================== */

export const WEATHER = Object.freeze({
  chaseRate: 0.12, // 1/s — jak szybko T/airM doganiają cel sezonowy
  seasonAmplitude: 6, // °C wahania sezonowe wokół targetT
  seasonPeriodSeconds: 240,

  precipRainThreshold: 0.3, // powyżej → raining (wizual / stare API)
  snowTempC: 0,

  windSpeedDefault: 0.45,
  windAngleDefault: 40,
  windSpeedMax: 1.5,

  // Gleba: ładowanie z opadu, parowanie
  soilFromPrecip: 0.4, // /s przy precip=1
  soilEvapBase: 0.06, // /s przy suchej pogodzie
  snowSoilFactor: 0.35, // śnieg wolniej podnosi soilM

  // Liście vs wiatr (liściaste / drought)
  windLeafStart: 0.5, // od tej siły wiatru liście zaczynają spadać
  windLeafFull: 1.2, // przy tej sile leafTarget → 0 (dla deciduous)
  windLeafEvergreenFactor: 0.15, // evergreen prawie nie zrzuca od wiatru

  // Lokalny mikroklimat od roślin / erozja wiatrowa
  coverCellSize: 4,
  coverMoistureBonus: 0.12, // max +airM/+soilM przy pełnej pokrywie drzew
  coverRefreshTicks: 5,
  windErosionMax: 0.15, // max −soilM gdy goło + silny wiatr

  // Rozsiew z wiatrem
  windSeedAlign: 0.65, // 0 = losowy kąt, 1 = dokładnie windAngle
  windSeedDistanceBonus: 0.8, // dystans × (1 + windSpeed * bonus)
});

/**
 * Funkcje przynależności (trapezy: [a,b,c,d] — 0 poza [a,d], 1 na [b,c]).
 * Wartości wejść: temp °C, air/soil 0..1, wind 0..windSpeedMax, season 0..1.
 */
export const WEATHER_SETS = Object.freeze({
  temp: Object.freeze({
    frozen: [-15, -10, -5, 0],
    cold: [-2, 2.5, 6, 12],
    temperate: [8, 15, 18, 24],
    warm: [20, 27.5, 30, 36],
    hot: [32, 38, 45, 50],
  }),
  airM: Object.freeze({
    arid: [-0.05, 0, 0.08, 0.2],
    dry: [0.1, 0.25, 0.3, 0.45],
    moderate: [0.35, 0.5, 0.55, 0.7],
    humid: [0.6, 0.75, 0.8, 0.92],
    wet: [0.85, 0.95, 1.05, 1.1],
  }),
  soilM: Object.freeze({
    dry: [-0.05, 0, 0.15, 0.35],
    moist: [0.25, 0.45, 0.55, 0.75],
    saturated: [0.65, 0.85, 1.05, 1.1],
  }),
  wind: Object.freeze({
    calm: [-0.05, 0, 0.2, 0.4],
    breeze: [0.25, 0.5, 0.7, 1.0],
    strong: [0.8, 1.1, 1.6, 2.0],
  }),
  season: Object.freeze({
    winter: [-0.1, 0, 0.15, 0.35],
    summer: [0.35, 0.5, 0.65, 0.85],
  }),
});

/**
 * Reguły fuzzy: when = { zmienna: etykieta, ... } (AND = min),
 * then = częściowe wyjścia 0..1 (zostaną zmapowane na delty w WeatherCore).
 */
export const WEATHER_RULES = Object.freeze([
  { when: { airM: 'humid', temp: 'warm' }, then: { precipRate: 0.75, dSoilM: 0.7, dAirM: 0.4 } },
  { when: { airM: 'wet', temp: 'hot' }, then: { precipRate: 0.9, dSoilM: 0.85, dAirM: 0.35 } },
  { when: { airM: 'wet', temp: 'temperate' }, then: { precipRate: 0.7, dSoilM: 0.65 } },
  { when: { airM: 'arid', temp: 'hot' }, then: { precipRate: 0.05, dSoilM: 0.1, dAirM: 0.1, dTemp: 0.7 } },
  { when: { airM: 'dry', temp: 'warm' }, then: { precipRate: 0.15, dSoilM: 0.2, dAirM: 0.2 } },
  { when: { airM: 'wet', temp: 'cold' }, then: { precipRate: 0.55, dSoilM: 0.4 } },
  { when: { airM: 'wet', temp: 'frozen' }, then: { precipRate: 0.45, dSoilM: 0.25 } },
  { when: { airM: 'humid', temp: 'cold' }, then: { precipRate: 0.5, dSoilM: 0.45 } },
  { when: { wind: 'strong', soilM: 'dry' }, then: { dSoilM: 0.05, dWind: 0.8 } },
  { when: { wind: 'breeze' }, then: { dWind: 0.45 } },
  { when: { wind: 'calm' }, then: { dWind: 0.15 } },
  { when: { wind: 'strong' }, then: { dWind: 0.85 } },
  { when: { season: 'winter' }, then: { dTemp: 0.15 } },
  { when: { season: 'summer' }, then: { dTemp: 0.75 } },
  { when: { airM: 'wet', soilM: 'dry' }, then: { precipRate: 0.6, dSoilM: 0.8 } },
  { when: { airM: 'moderate', temp: 'temperate' }, then: { precipRate: 0.4, dSoilM: 0.45, dAirM: 0.5 } },
  { when: { airM: 'arid', temp: 'frozen' }, then: { precipRate: 0.05, dSoilM: 0.1, dAirM: 0.1 } },
]);

const modelUrl = (file) => `${import.meta.env?.BASE_URL ?? '/'}models/${file}`;

/* ==========================================================================
 *  KLIMAT: parametry globalne, osie macierzy, biomy
 * ========================================================================== */

export const CLIMATE = Object.freeze({
  temperature: Object.freeze({ min: -10, max: 40, default: 15 }), // °C
  moisture: Object.freeze({ min: 0, max: 1, default: 0.6 }), // 0 = sucho, 1 = mokro

  lapseRatePerUnit: 1.6, // °C chłodniej na każdą jednostkę wysokości terenu
  pondMoistureBonus: 0.3, // o tyle wilgotniej przy stawie (oaza)
  pondFalloffRadius: 30, // do jakiej odległości od środka działa bonus

  // Szerokość strefy przejścia między sąsiednimi biomami (0..1 odstępu między
  // środkami pasm). 0 = ostra granica, 1 = płynne mieszanie na całym odcinku.
  transitionWidth: 0.5,

  minFitness: 0.12, // poniżej tej przydatności klimatu roślina cierpi
  stressLimitSeconds: 60, // po tylu sekundach "klimatycznego" stresu roślina ginie
  stressRecovery: 0.5, // tempo odpoczynku, gdy warunki wracają do normy
  unfitGrowthFloor: 0.3, // przy zerowej przydatności wzrost = 30% normalnego

  immigrationChancePerTick: 0.15, // szansa na "obcy" propagul z zewnątrz wyspy
  immigrationMinFitness: 0.3,
});

export const LEAF = Object.freeze({
  growSeconds: 12, // pełne ulistnienie
  dropSeconds: 10, // pełny opad liści
  hueTurnSeconds: 6, // zazielenienie -> jesienna barwa
  hueRecoverSeconds: 3,
  saplingStart: 0.3, // od jakiego postępu sadzonki zaczynają pojawiać się liście
});

/* Osie macierzy klimatu. Wartość parametru leży między środkami pasm,
 * a wagi sąsiednich komórek macierzy mieszają się (patrz Climate.js). */
export const TEMPERATURE_BANDS = Object.freeze([
  { id: 'frozen', label: 'Mroźnie', center: -10 },
  { id: 'cold', label: 'Zimno', center: 2.5 },
  { id: 'temperate', label: 'Umiarkowanie', center: 15 },
  { id: 'warm', label: 'Ciepło', center: 27.5 },
  { id: 'hot', label: 'Upalnie', center: 40 },
]);

export const MOISTURE_BANDS = Object.freeze([
  { id: 'arid', label: 'Skrajnie sucho', center: 0 },
  { id: 'dry', label: 'Sucho', center: 0.25 },
  { id: 'moderate', label: 'Średnio', center: 0.5 },
  { id: 'humid', label: 'Wilgotno', center: 0.75 },
  { id: 'wet', label: 'Mokro', center: 1 },
]);

export const Biome = Object.freeze({
  POLAR: 'polar',
  TUNDRA: 'tundra',
  TAIGA: 'taiga',
  STEPPE: 'steppe',
  SHRUBLAND: 'shrubland',
  FOREST: 'forest',
  DESERT: 'desert',
  SAVANNA: 'savanna',
  TROPICAL: 'tropical',
});

/* grass = kolor "gruntu" (dawniej zawsze zielona trawa) w tym biomie */
export const BIOMES = Object.freeze({
  [Biome.POLAR]: { label: 'Pustynia lodowa', grass: 0xe8f0f5 },
  [Biome.TUNDRA]: { label: 'Tundra', grass: 0x9aa58a },
  [Biome.TAIGA]: { label: 'Tajga', grass: 0x3f6f48 },
  [Biome.STEPPE]: { label: 'Step', grass: 0xb5b068 },
  [Biome.SHRUBLAND]: { label: 'Zarośla (makia)', grass: 0x8f9a55 },
  [Biome.FOREST]: { label: 'Las umiarkowany', grass: 0x5f9e3d },
  [Biome.DESERT]: { label: 'Pustynia', grass: 0xd9bf7a },
  [Biome.SAVANNA]: { label: 'Sawanna', grass: 0xb9a94b },
  [Biome.TROPICAL]: { label: 'Las tropikalny', grass: 0x3da83a },
});

const B = Biome;

/* MACIERZ KLIMATU: wiersze = temperatura (od najzimniejszej), kolumny = wilgotność.
 *
 *                 arid         dry          moderate     humid        wet
 *   frozen     [ POLAR      , POLAR      , TUNDRA     , TUNDRA     , TUNDRA    ]
 *   cold       [ STEPPE     , STEPPE     , TAIGA      , TAIGA      , TAIGA     ]
 *   temperate  [ SHRUBLAND  , STEPPE     , FOREST     , FOREST     , FOREST    ]
 *   warm       [ DESERT     , SHRUBLAND  , SAVANNA    , TROPICAL   , TROPICAL  ]
 *   hot        [ DESERT     , DESERT     , SAVANNA    , TROPICAL   , TROPICAL  ]
 */
export const BIOME_MATRIX = Object.freeze([
  [B.POLAR, B.POLAR, B.TUNDRA, B.TUNDRA, B.TUNDRA],
  [B.STEPPE, B.STEPPE, B.TAIGA, B.TAIGA, B.TAIGA],
  [B.SHRUBLAND, B.STEPPE, B.FOREST, B.FOREST, B.FOREST],
  [B.DESERT, B.SHRUBLAND, B.SAVANNA, B.TROPICAL, B.TROPICAL],
  [B.DESERT, B.DESERT, B.SAVANNA, B.TROPICAL, B.TROPICAL],
]);

/* Gotowe punkty startowe do prezentacji: [temperatura °C, wilgotność] */
export const CLIMATE_PRESETS = Object.freeze({
  'Las umiarkowany': [15, 0.6],
  'Tajga': [2.5, 0.65],
  'Tundra': [-9, 0.7],
  'Pustynia lodowa': [-10, 0.05],
  'Step': [8, 0.2],
  'Zarośla (makia)': [17, 0.05],
  'Sawanna': [28, 0.5],
  'Las tropikalny': [30, 0.85],
  'Pustynia': [33, 0.05],
});

/* ==========================================================================
 *  GATUNKI
 * ========================================================================== */

export const MODELS = Object.freeze({
  tree: { url: modelUrl('tree.glb'), trunkMaterials: ['Material.005'] },
  bush: { url: modelUrl('bush.glb'), trunkMaterials: ['Wood'] },
});

const G = Soil.GRASSLAND;
const S = Soil.SAND;
const R = Soil.ROCK;
const W = Soil.WETLAND;

const SPECIES_DEFAULTS = {
  layer: 'tree', // 'tree' | 'shrub': tłok liczy się tylko w obrębie własnej warstwy
  proportions: [1, 1, 1], // (szerokość, wysokość, szerokość) całej rośliny
  crownShape: [1, 1, 1], // dodatkowe skalowanie samej korony (parasol, kępa)
  attractsLightning: false,
  germinationAge: 4,
  matureAge: 20,
  lifespan: 120,
  seedChancePerTick: 0.012,
  seedRadius: 7,
  crowdingRadius: 2,
  crowdingMax: 3,
  maxLean: 0.3,
  fallbackRadius: 0.4,
  soils: [G],
  droughtTolerance: 0, // 0 = jak dotąd, 1 = nie cierpi na suszy
  leaf: { strategy: 'evergreen', dropBelowT: 0 },
};

/* leaf.strategy:
 *   deciduous  - zrzuca liście, gdy lokalna temperatura < dropBelowT
 *   drought    - zrzuca liście przy suszy (sawanna)
 *   evergreen  - liście zostają; usychają dopiero przy skrajnie złym klimacie
 *   none       - brak korony do animowania (np. kaktus) */
const makeSpecies = (def) => Object.freeze({ ...SPECIES_DEFAULTS, ...def });

// Kolejność = kolejność kolumn w FLORA_AFFINITY!
export const SPECIES = Object.freeze([
  makeSpecies({
    id: 0, key: 'oak', name: 'Dąb', model: 'tree',
    height: 4.5, attractsLightning: true,
    germinationAge: 5, matureAge: 35, lifespan: 160,
    seedChancePerTick: 0.012, seedRadius: 9, crowdingRadius: 3.2, crowdingMax: 3,
    maxLean: 0.38, fallbackRadius: 0.32,
    leaf: { strategy: 'deciduous', dropBelowT: 7 },
    colors: { trunk: 0x6b4a2b, crown: 0x4c9a3c, autumn: 0xc9772a, seed: 0x7a5c36, deadTrunk: 0x3a2b1d, deadCrown: 0x5a4630 },
  }),
  makeSpecies({
    id: 1, key: 'bush', layer: 'shrub', name: 'Krzew', model: 'bush',
    height: 1.3,
    germinationAge: 3, matureAge: 18, lifespan: 100,
    seedChancePerTick: 0.016, seedRadius: 6, crowdingRadius: 2.2, crowdingMax: 2,
    maxLean: 0.22, fallbackRadius: 0.6, soils: [G, W],
    leaf: { strategy: 'deciduous', dropBelowT: 3 },
    colors: { trunk: 0x6b4a2b, crown: 0x5aa83f, autumn: 0xb5792c, seed: 0x7a5c36, deadTrunk: 0x3a2b1d, deadCrown: 0x4f4128 },
  }),
  makeSpecies({
    id: 2, key: 'pine', name: 'Sosna', model: 'tree',
    height: 4.5, proportions: [0.6, 1.35, 0.6], attractsLightning: true,
    germinationAge: 6, matureAge: 45, lifespan: 220,
    seedChancePerTick: 0.01, seedRadius: 9, crowdingRadius: 2.6, crowdingMax: 3,
    maxLean: 0.3, fallbackRadius: 0.28, soils: [G, R],
    droughtTolerance: 0.3,
    leaf: { strategy: 'evergreen', dropBelowT: 0 },
    colors: { trunk: 0x5a3d26, crown: 0x1f5c3a, autumn: 0x6b6a2c, seed: 0x6a5436, deadTrunk: 0x33271b, deadCrown: 0x3f3626 },
  }),
  makeSpecies({
    id: 3, key: 'palm', name: 'Drzewo tropikalne', model: 'tree',
    height: 5.5, proportions: [0.7, 1.2, 0.7], crownShape: [1.5, 0.55, 1.5], attractsLightning: true,
    germinationAge: 4, matureAge: 25, lifespan: 130,
    seedChancePerTick: 0.016, seedRadius: 10, crowdingRadius: 2.4, crowdingMax: 3,
    maxLean: 0.5, fallbackRadius: 0.25, soils: [G, S],
    droughtTolerance: 0.2,
    leaf: { strategy: 'evergreen', dropBelowT: 0 },
    colors: { trunk: 0x8a6a3c, crown: 0x6fc43a, autumn: 0xb59a2e, seed: 0x8a7040, deadTrunk: 0x3d3020, deadCrown: 0x5c4d2a },
  }),
  makeSpecies({
    id: 4, key: 'acacia', name: 'Akacja', model: 'tree',
    height: 4, proportions: [1.5, 0.8, 1.5], crownShape: [1.3, 0.55, 1.3],
    germinationAge: 4, matureAge: 30, lifespan: 140,
    seedChancePerTick: 0.012, seedRadius: 11, crowdingRadius: 4, crowdingMax: 2,
    maxLean: 0.3, fallbackRadius: 0.4,
    droughtTolerance: 0.7,
    leaf: { strategy: 'drought', dropBelowT: 0 },
    colors: { trunk: 0x8a6a3c, crown: 0xa7a53a, autumn: 0xb88a2a, seed: 0x8a7040, deadTrunk: 0x40321f, deadCrown: 0x5c4a2a },
  }),
  makeSpecies({
    id: 5, key: 'cactus', layer: 'shrub', name: 'Kaktus', model: 'bush',
    height: 2.2, proportions: [0.45, 1.6, 0.45],
    germinationAge: 5, matureAge: 40, lifespan: 220,
    seedChancePerTick: 0.01, seedRadius: 6, crowdingRadius: 2.6, crowdingMax: 1,
    maxLean: 0.05, fallbackRadius: 0.3, soils: [G, S],
    droughtTolerance: 0.95,
    leaf: { strategy: 'none', dropBelowT: 0 },
    colors: { trunk: 0x4d8a45, crown: 0x5f9b52, autumn: 0x9a9a4a, seed: 0x7a8a50, deadTrunk: 0x4a4a30, deadCrown: 0x6a6040 },
  }),
  makeSpecies({
    id: 6, key: 'thornbush', layer: 'shrub', name: 'Krzew suchy', model: 'bush',
    height: 1, proportions: [1.2, 0.8, 1.2],
    germinationAge: 3, matureAge: 15, lifespan: 90,
    seedChancePerTick: 0.018, seedRadius: 6, crowdingRadius: 2.2, crowdingMax: 2,
    maxLean: 0.2, fallbackRadius: 0.5, soils: [G, S, R, W],
    droughtTolerance: 0.8,
    leaf: { strategy: 'evergreen', dropBelowT: 0 },
    colors: { trunk: 0x6b4a2b, crown: 0xb8a85a, autumn: 0x8a7a40, seed: 0x7a6a40, deadTrunk: 0x3a2b1d, deadCrown: 0x5a4a30 },
  }),
  makeSpecies({
    id: 7, key: 'tundrashrub', layer: 'shrub', name: 'Krzewinka tundrowa', model: 'bush',
    height: 0.7, proportions: [1.3, 0.6, 1.3],
    germinationAge: 3, matureAge: 15, lifespan: 80,
    seedChancePerTick: 0.016, seedRadius: 5, crowdingRadius: 2, crowdingMax: 2,
    maxLean: 0.15, fallbackRadius: 0.5, soils: [G, R, W],
    droughtTolerance: 0.4,
    leaf: { strategy: 'evergreen', dropBelowT: 0 },
    colors: { trunk: 0x5a4a3a, crown: 0x6e7a4a, autumn: 0x8a5a3a, seed: 0x6a5a4a, deadTrunk: 0x33291f, deadCrown: 0x4a3f30 },
  }),
]);

/* MACIERZ FLORY: przydatność gatunku (0..1) w danym biomie.
 * Wiersze = biomy, kolumny = gatunki (kolejność jak w SPECIES).
 * Na granicy biomów wagi się mieszają, więc gatunki z obu stron współwystępują.
 *
 *                         oak   bush  pine  palm  acac  cact  thorn tundra */
export const FLORA_AFFINITY = Object.freeze({
  [Biome.POLAR]:     [0,    0,    0,    0,    0,    0,    0,    0   ],
  [Biome.TUNDRA]:    [0,    0.05, 0.2,  0,    0,    0,    0,    1   ],
  [Biome.TAIGA]:     [0.1,  0.3,  1,    0,    0,    0,    0,    0.5 ],
  [Biome.STEPPE]:    [0.25, 0.5,  0.1,  0,    0.15, 0,    0.8,  0.2 ],
  [Biome.SHRUBLAND]: [0.4,  0.6,  0.35, 0,    0.3,  0.1,  1,    0   ],
  [Biome.FOREST]:    [1,    0.7,  0.35, 0,    0,    0,    0,    0   ],
  [Biome.DESERT]:    [0,    0,    0,    0,    0.1,  1,    0.45, 0   ],
  [Biome.SAVANNA]:   [0.05, 0.35, 0,    0.15, 1,    0.2,  0.6,  0   ],
  [Biome.TROPICAL]:  [0.1,  0.8,  0,    1,    0.2,  0,    0,    0   ],
});

export const INITIAL_PLANTS = 200; // liczba prób startowych (rozkład gatunków wynika z klimatu)
