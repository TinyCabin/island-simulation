import { LAKES, WORLD } from '../config.js';
import { SeededRandom } from '../utils/random.js';

/**
 * Generuje baseny-kandydatów z seeda: 0…N, środki poza centrum.
 * Nie gwarantuje wody — tylko dołki; #classify / reguły decydują o Water/Wetland.
 */
export function generateBasins(seed, islandRadius = WORLD.islandRadius) {
  const rng = new SeededRandom((seed ^ 0x51eed) >>> 0);
  const roll = rng.next();
  let n;
  // 0 czasem (rzadziej), często 1–4 — żeby typowy seed miał wodę na mapie
  if (roll < 0.12) n = 0;
  else if (roll < 0.42) n = 1;
  else if (roll < 0.68) n = 2;
  else n = 3 + (rng.next() < 0.5 ? 0 : 1); // 3 lub 4

  const basins = [];
  let attempts = 0;
  while (basins.length < n && attempts < n * 50) {
    attempts++;
    const ang = rng.range(0, Math.PI * 2);
    const dist = rng.range(islandRadius * LAKES.minCenterDist, islandRadius * LAKES.maxCenterDist);
    const x = Math.cos(ang) * dist;
    const z = Math.sin(ang) * dist;
    const large = n === 1;
    const radius = large ? rng.range(8, 14) : rng.range(3.2, 7.5);
    const depth = large ? rng.range(4.2, 6.2) : rng.range(2.0, 4.2);
    // fill 0..1: czasem prawie pusta misa, czasem pełna — deszcz dopełnia
    const fill = rng.range(0.05, 0.75);

    if (basins.some((b) => Math.hypot(b.x - x, b.z - z) < b.radius + radius + 5)) continue;

    basins.push({ x, z, radius, depth, fill });
  }

  return basins;
}

/** Promień lustra wody w basenie zależny od fill. */
export function basinWaterRadius(basin) {
  const t = Math.min(1, Math.max(0, basin.fill ?? 0));
  return basin.radius * (LAKES.fillRadiusMin + (LAKES.fillRadiusMax - LAKES.fillRadiusMin) * t);
}

/** Wpływ basenów na wysokość (suma zagłębień). */
export function basinDigAt(basins, x, z) {
  let dig = 0;
  for (let i = 0; i < basins.length; i++) {
    const b = basins[i];
    const d = Math.hypot(x - b.x, z - b.z);
    const inner = b.radius * 0.35;
    const t = 1 - smooth01((d - inner) / (b.radius - inner || 1e-6));
    dig += b.depth * t;
  }
  return dig;
}

/** Najbliższy basen / null. */
export function nearestBasin(basins, x, z) {
  let best = null;
  let bestD = Infinity;
  for (let i = 0; i < basins.length; i++) {
    const b = basins[i];
    const d = Math.hypot(x - b.x, z - b.z);
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  return best ? { basin: best, dist: bestD } : null;
}

function smooth01(t) {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}
