function hash(ix, iz) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const smooth = (t) => t * t * (3 - 2 * t);
const mix = (a, b, t) => a + (b - a) * t;

export function valueNoise(x, z) {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const u = smooth(x - x0);
  const v = smooth(z - z0);
  const top = mix(hash(x0, z0), hash(x0 + 1, z0), u);
  const bottom = mix(hash(x0, z0 + 1), hash(x0 + 1, z0 + 1), u);
  return mix(top, bottom, v);
}

export function fbm(x, z, octaves = 4) {
  let sum = 0;
  let norm = 0;
  let amplitude = 0.5;
  let frequency = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amplitude * valueNoise(x * frequency + o * 19.19, z * frequency - o * 7.37);
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2.1;
  }
  return sum / norm;
}