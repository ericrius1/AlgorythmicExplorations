// Zel'dovich initial conditions, computed on the CPU at seed time.
//
// Recipe: white gaussian noise on a grid → FFT → multiply by √P(k) so the
// ripples get the chosen power spectrum → divide by k² and take a gradient
// (all in frequency space) to turn density ripples into a displacement
// field → inverse FFT → displace a uniform particle lattice along it.
// Velocities point along the same displacement: in a matter-dominated
// universe every growing ripple moves in lockstep (D(a) = a), so position
// offset and momentum share one field. One CPU-side FFT per axis per seed —
// milliseconds, and the GPU never sees any of it.

export interface CosmoIC {
  state: Float32Array; // x, y, px, py interleaved; positions in [0,1)
  count: number;
}

function randn(): number {
  const u = Math.random() || 1e-9;
  const v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// In-place radix-2 complex FFT (split arrays). Plain Cooley-Tukey with bit
// reversal — clarity over speed; this runs once per re-seed, not per frame.
function fft1d(re: Float64Array, im: Float64Array, off: number, stride: number, n: number, inv: boolean): void {
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const a = off + i * stride;
      const b = off + j * stride;
      [re[a], re[b]] = [re[b], re[a]];
      [im[a], im[b]] = [im[b], im[a]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inv ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = off + (i + k) * stride;
        const b = off + (i + k + len / 2) * stride;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
  if (inv) {
    for (let i = 0; i < n; i++) {
      re[off + i * stride] /= n;
      im[off + i * stride] /= n;
    }
  }
}

function fft2d(re: Float64Array, im: Float64Array, n: number, inv: boolean): void {
  for (let r = 0; r < n; r++) fft1d(re, im, r * n, 1, n, inv);
  for (let c = 0; c < n; c++) fft1d(re, im, c, n, n, inv);
}

export interface CosmoSeedOptions {
  lattice: number; // particles per side
  aInit: number; // starting scale factor
  amplitude: number; // rms displacement of the field at a = 1, in box units
  tilt: number; // spectral index n in P(k) ∝ kⁿ
  grid?: number; // IC field resolution (power of two)
}

export function seedZeldovich(o: CosmoSeedOptions): CosmoIC {
  const n = o.grid ?? 256;
  const half = n / 2;

  // White noise, then shape its spectrum: δ_k = noise_k · √P(k).
  const dr = new Float64Array(n * n);
  const di = new Float64Array(n * n);
  for (let i = 0; i < n * n; i++) dr[i] = randn();
  fft2d(dr, di, n, false);

  // Displacement in frequency space: ψ_k = i k δ_k / k².
  const xr = new Float64Array(n * n);
  const xi = new Float64Array(n * n);
  const yr = new Float64Array(n * n);
  const yi = new Float64Array(n * n);
  // With P(k) = kⁿ·exp(-k²/kcut²)·lowCut, the displacement variance per
  // octave is P(k) itself, so this cutoff sets the web's cell size directly.
  const kcut = 16;
  for (let row = 0; row < n; row++) {
    const ky = row <= half ? row : row - n;
    for (let col = 0; col < n; col++) {
      const kx = col <= half ? col : col - n;
      const i = row * n + col;
      const k2 = kx * kx + ky * ky;
      if (k2 === 0) continue;
      const k = Math.sqrt(k2);
      // Spectrum shaping: the chosen tilt, a gaussian cutoff at the grid
      // scale, and a suppression of the box-scale modes (k ≲ 3) — without it
      // the one or two largest waves carry all the displacement and the box
      // collapses into a single pancake instead of a web.
      const lowCut = (k2 / (k2 + 9)) ** 2;
      const p = Math.pow(k, o.tilt) * Math.exp(-(k2 / (kcut * kcut))) * lowCut;
      const s = Math.sqrt(p) / k2; // √P(k) and the 1/k² of the inverse Laplacian
      // multiply δ_k by i·k·s: (re,im) → (-im, re) per axis component
      xr[i] = -di[i] * kx * s;
      xi[i] = dr[i] * kx * s;
      yr[i] = -di[i] * ky * s;
      yi[i] = dr[i] * ky * s;
    }
  }
  fft2d(xr, xi, n, true);
  fft2d(yr, yi, n, true);

  // Normalize the field to the requested rms displacement at a = 1.
  let ms = 0;
  for (let i = 0; i < n * n; i++) ms += xr[i] * xr[i] + yr[i] * yr[i];
  const norm = o.amplitude / Math.sqrt(ms / (n * n));

  // Uniform lattice, displaced. Momentum p = a²ẋ = a^{3/2}ψ in a matter-
  // dominated universe (D = a, ȧ = a^{-1/2} with H₀ = 1).
  const m = o.lattice;
  const count = m * m;
  const state = new Float32Array(count * 4);
  const pNorm = Math.pow(o.aInit, 1.5) * norm;
  const xNorm = o.aInit * norm;
  for (let j = 0; j < m; j++) {
    for (let i = 0; i < m; i++) {
      // bilinear sample of the displacement field at the lattice point
      const gx = ((i + 0.5) / m) * n - 0.5;
      const gy = ((j + 0.5) / m) * n - 0.5;
      const ix = Math.floor(gx);
      const iy = Math.floor(gy);
      const fx = gx - ix;
      const fy = gy - iy;
      const c = (a: number, b: number): number => (((b % n) + n) % n) * n + (((a % n) + n) % n);
      const lerp2 = (f: Float64Array): number =>
        f[c(ix, iy)] * (1 - fx) * (1 - fy) +
        f[c(ix + 1, iy)] * fx * (1 - fy) +
        f[c(ix, iy + 1)] * (1 - fx) * fy +
        f[c(ix + 1, iy + 1)] * fx * fy;
      const px = lerp2(xr);
      const py = lerp2(yr);
      const idx = (j * m + i) * 4;
      const wrap = (v: number): number => v - Math.floor(v);
      state[idx] = wrap((i + 0.5) / m + px * xNorm);
      state[idx + 1] = wrap((j + 0.5) / m + py * xNorm);
      state[idx + 2] = px * pNorm;
      state[idx + 3] = py * pNorm;
    }
  }
  return { state, count };
}

// The scale-factor bookkeeping for an Einstein-de Sitter (matter only,
// H₀ = 1, box length 1) universe, stepped in equal increments of ln a.
// With momenta p = a²ẋ the Hubble drag vanishes (ṗ = -∇φ exactly), and
// since ȧ = a^{-1/2} in EdS:
//   dx/da = p/(a²ȧ) = p · a^{-1/2} / a²   (drift)
//   dp/da = -∇φ/ȧ  = -∇φ · a^{+1/2}      with  ∇²φ = (3/2a) δ  (kick)
// Our mesh solve returns χ with ∇²χ = (2π)²·(ρ - ρ̄), so the kick folds in
// (3/2a)·(DIM²/count)·1/(2π)² to turn χ's gradient into φ's. These choices
// reproduce linear growth D(a) = a exactly: x = q + aψ, p = a^{3/2}ψ.
export function edsCoefficients(
  a: number,
  dlna: number,
  dim: number,
  count: number,
): { kick: number; drift: number; aNext: number } {
  const da = a * dlna;
  const kick = ((da * Math.pow(a, 0.5) * (3 / (2 * a)) * dim * dim) / count) * (1 / (4 * Math.PI * Math.PI));
  const drift = da * Math.pow(a, -1.5);
  return { kick, drift, aNext: a + da };
}
