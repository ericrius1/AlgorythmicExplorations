// A 64×64 blue-noise tile (Ulichney's void-and-cluster, 1993), computed once
// per page load and shared by the path tracers in parts five and six.
//
// The path tracers use it to rotate their sample sequences per pixel
// (Cranley–Patterson rotation). Each pixel still averages correctly, but
// neighbouring pixels get very different samples, so the leftover error looks
// like fine, even grain instead of blotches.

const N = 64;
const SIGMA = 1.5;

let cached: Float32Array<ArrayBuffer> | null = null;

export const BLUE_NOISE_SIZE = N;

/** Values in [0, 1), one per texel, row-major. */
export function blueNoise(): Float32Array<ArrayBuffer> {
  if (cached) return cached;
  const n = N * N;
  // toroidal Gaussian splat, precomputed for every offset
  const lut = new Float32Array(n);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const dx = Math.min(x, N - x);
      const dy = Math.min(y, N - y);
      lut[y * N + x] = Math.exp(-(dx * dx + dy * dy) / (2 * SIGMA * SIGMA));
    }
  }
  const energy = new Float32Array(n);
  const on = new Uint8Array(n);
  const splat = (i: number, sign: number): void => {
    const ix = i % N;
    const iy = (i / N) | 0;
    for (let y = 0; y < N; y++) {
      const row = ((y - iy) & (N - 1)) * N;
      const out = y * N;
      for (let x = 0; x < N; x++) energy[out + x] += sign * lut[row + ((x - ix) & (N - 1))];
    }
  };
  // tightest cluster among the ones (or largest void among the zeros)
  const pick = (want: number): number => {
    let best = -1;
    let bestE = want === 1 ? -Infinity : Infinity;
    for (let i = 0; i < n; i++) {
      if (on[i] !== want) continue;
      const e = energy[i];
      if (want === 1 ? e > bestE : e < bestE) {
        bestE = e;
        best = i;
      }
    }
    return best;
  };

  // a seeded random start, about a tenth of the pixels
  let s = 12345;
  const rand = (): number => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const initial = Math.round(n * 0.1);
  for (let k = 0; k < initial; ) {
    const i = (rand() * n) | 0;
    if (on[i]) continue;
    on[i] = 1;
    splat(i, 1);
    k++;
  }
  // relax: move the tightest cluster into the largest void until it settles
  for (let iter = 0; iter < n; iter++) {
    const c = pick(1);
    on[c] = 0;
    splat(c, -1);
    const v = pick(0);
    on[v] = 1;
    splat(v, 1);
    if (v === c) break;
  }

  const rank = new Int32Array(n);
  // phase 1: rank the initial points by removing clusters
  const saveOn = on.slice();
  const saveE = energy.slice();
  for (let r = initial - 1; r >= 0; r--) {
    const c = pick(1);
    on[c] = 0;
    splat(c, -1);
    rank[c] = r;
  }
  on.set(saveOn);
  energy.set(saveE);
  // phases 2 and 3: fill the largest voids, in order
  for (let r = initial; r < n; r++) {
    const v = pick(0);
    on[v] = 1;
    splat(v, 1);
    rank[v] = r;
  }

  cached = new Float32Array(n);
  for (let i = 0; i < n; i++) cached[i] = (rank[i] + 0.5) / n;
  return cached;
}

/** The tile as an r32float texture. */
export function blueNoiseTexture(dev: GPUDevice): GPUTexture {
  const tex = dev.createTexture({
    size: [N, N],
    format: "r32float",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  dev.queue.writeTexture({ texture: tex }, blueNoise(), { bytesPerRow: N * 4 }, [N, N]);
  return tex;
}
