// Gradient noise from scratch — the raw material of every landscape in this
// series. No permutation tables, no stored state: a small integer hash turns
// (lattice point, seed) into a repeatable "random" gradient, Perlin's fade
// curve blends between them, and fBm stacks octaves into terrain.

// ---- the hash: deterministic chaos ------------------------------------------------
// A few rounds of multiply-and-xor (the finalizer from murmur3). Same inputs,
// same output, forever — which is the whole trick: the mountain at (1402, 88)
// is "random", but it is the same mountain every time you look.
export function hash2(ix: number, iy: number, seed: number): number {
  let h = (Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ Math.imul(seed, 0x9e3779b9)) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296; // [0, 1)
}

// Perlin's quintic fade: zero first *and* second derivative at the lattice,
// so neither value nor curvature betrays the grid.
const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

// ---- 1D gradient noise -------------------------------------------------------------
// Each integer gets a random slope; the curve must pass through zero at every
// lattice point with exactly that slope. Range roughly [-1, 1].
export function perlin1(x: number, seed: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const g0 = hash2(i, 0, seed) * 2 - 1;
  const g1 = hash2(i + 1, 0, seed) * 2 - 1;
  return lerp(g0 * f, g1 * (f - 1), fade(f)) * 2;
}

// ---- 2D gradient noise -------------------------------------------------------------
// Random unit gradient at each lattice corner, dotted with the offset to the
// sample point, blended with the fade. Scaled to roughly [-1, 1].
export function perlin2(x: number, y: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;

  const grad = (cx: number, cy: number, dx: number, dy: number): number => {
    const a = hash2(cx, cy, seed) * Math.PI * 2;
    return Math.cos(a) * dx + Math.sin(a) * dy;
  };
  const d00 = grad(ix, iy, fx, fy);
  const d10 = grad(ix + 1, iy, fx - 1, fy);
  const d01 = grad(ix, iy + 1, fx, fy - 1);
  const d11 = grad(ix + 1, iy + 1, fx - 1, fy - 1);

  const u = fade(fx), v = fade(fy);
  return lerp(lerp(d00, d10, u), lerp(d01, d11, u), v) * 1.414;
}

// ---- fractional Brownian motion -----------------------------------------------------
// The fractal sum: each octave doubles the frequency (lacunarity) and halves
// the amplitude (gain). `ridge` bends each octave toward 1 − 2|n|, which folds
// the noise at zero into sharp crests. The lattice is rotated a little between
// octaves so their grids never line up.
export interface FbmParams {
  octaves: number;
  lacunarity?: number;
  gain?: number;
  ridge?: number; // 0 = plain fBm, 1 = fully ridged
  seed?: number;
}

const ROT_C = Math.cos(0.5), ROT_S = Math.sin(0.5);

export function fbm2(x: number, y: number, p: FbmParams): number {
  const lac = p.lacunarity ?? 2;
  const gain = p.gain ?? 0.5;
  const ridge = p.ridge ?? 0;
  const seed = p.seed ?? 0;
  let sum = 0;
  let amp = 1;
  let norm = 0;
  for (let o = 0; o < p.octaves; o++) {
    let n = perlin2(x, y, seed + o * 131);
    if (ridge > 0) n = lerp(n, 1 - 2 * Math.abs(n), ridge);
    sum += n * amp;
    norm += amp;
    amp *= gain;
    const nx = x * ROT_C - y * ROT_S;
    y = (x * ROT_S + y * ROT_C) * lac;
    x = nx * lac;
  }
  return sum / norm; // roughly [-1, 1]
}
