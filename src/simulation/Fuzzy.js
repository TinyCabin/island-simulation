/**
 * Lekki silnik fuzzy (bez biblioteki): trapezy przynależności + reguły AND=min,
 * wyjście = średnia ważona wartości "then" (sugeno-lite).
 */

const clamp01 = (v) => Math.min(1, Math.max(0, v));

/** Trapez [a,b,c,d]: 0 poza [a,d], liniowo w górę a→b, 1 na [b,c], w dół c→d. */
export function trapMembership(x, [a, b, c, d]) {
  if (x <= a || x >= d) return 0;
  if (x >= b && x <= c) return 1;
  if (x < b) return (x - a) / (b - a || 1e-6);
  return (d - x) / (d - c || 1e-6);
}

/**
 * @param {Record<string, number>} inputs  np. { temp, airM, soilM, wind, season }
 * @param {Record<string, Record<string, number[]>>} sets  WEATHER_SETS
 * @param {Array<{ when: object, then: object, weight?: number }>} rules
 * @returns {Record<string, number>} zagregowane wyjścia 0..1 (brak reguły → 0.5 jako neutral)
 */
export function evaluateRules(inputs, sets, rules) {
  const sums = Object.create(null);
  const weights = Object.create(null);

  for (let r = 0; r < rules.length; r++) {
    const rule = rules[r];
    let firing = 1;
    const when = rule.when;
    for (const key of Object.keys(when)) {
      const label = when[key];
      const set = sets[key]?.[label];
      if (!set) {
        firing = 0;
        break;
      }
      const mu = trapMembership(inputs[key], set);
      if (mu < firing) firing = mu;
      if (firing <= 0) break;
    }
    if (firing <= 0) continue;

    const w = firing * (rule.weight ?? 1);
    const then = rule.then;
    for (const out of Object.keys(then)) {
      sums[out] = (sums[out] ?? 0) + w * then[out];
      weights[out] = (weights[out] ?? 0) + w;
    }
  }

  const result = Object.create(null);
  for (const out of Object.keys(sums)) {
    result[out] = weights[out] > 0 ? clamp01(sums[out] / weights[out]) : 0.5;
  }
  return result;
}
