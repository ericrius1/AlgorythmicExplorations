// Baked light for a height grid: where the sun can't reach, and how tucked
// in each point is. Both are computed once on the CPU when a mesh is built
// and stored per vertex (aLight = sun visibility, occlusion), so the shader
// gets long ridge shadows and dark gullies for the price of one attribute.

export type HeightSampler = (x: number, z: number) => number;

// Bilinear reads from a regular grid; anything outside goes to `outside`
// (the pure height function, usually) or clamps to the border.
export function gridSampler(
  heights: Float32Array,
  cols: number,
  rows: number,
  x0: number,
  z0: number,
  step: number,
  outside?: HeightSampler,
): HeightSampler {
  return (x: number, z: number): number => {
    const gx = (x - x0) / step, gz = (z - z0) / step;
    if (outside && (gx < 0 || gz < 0 || gx > cols - 1 || gz > rows - 1)) return outside(x, z);
    const cx = Math.min(cols - 1.001, Math.max(0, gx));
    const cz = Math.min(rows - 1.001, Math.max(0, gz));
    const i = Math.floor(cx), j = Math.floor(cz);
    const fx = cx - i, fz = cz - j;
    const k = i + j * cols;
    return (
      heights[k] * (1 - fx) * (1 - fz) +
      heights[k + 1] * fx * (1 - fz) +
      heights[k + cols] * (1 - fx) * fz +
      heights[k + cols + 1] * fx * fz
    );
  };
}

export interface BakeOptions {
  reach?: number; // how far toward the sun to look for blockers (world units)
  outside?: HeightSampler; // heights beyond this grid (a coarser ring, or the pure function)
  softness?: number; // larger = harder shadow edges
  aoRadii?: number[]; // occlusion scales in world units
  aoStrength?: number;
}

// Returns interleaved (sunVisibility, occlusion) per grid point.
export function bakeLight(
  heights: Float32Array,
  cols: number,
  rows: number,
  x0: number,
  z0: number,
  step: number,
  sunDir: { x: number; y: number; z: number },
  opts: BakeOptions = {},
): Float32Array {
  const out = new Float32Array(cols * rows * 2);
  bakeSun(heights, cols, rows, x0, z0, step, sunDir, out, opts);
  bakeOcclusion(heights, cols, rows, step, out, opts);
  return out;
}

// Sun visibility into out[v * 2]: march from each point toward the sun and
// keep the closest call (soft shadows). `rowFrom`/`rowTo` limit the work to a
// band of rows, so a changing grid can be re-lit a slice at a time.
export function bakeSun(
  heights: Float32Array,
  cols: number,
  rows: number,
  x0: number,
  z0: number,
  step: number,
  sunDir: { x: number; y: number; z: number },
  out: Float32Array,
  opts: BakeOptions & { rowFrom?: number; rowTo?: number } = {},
): void {
  const sample = gridSampler(heights, cols, rows, x0, z0, step, opts.outside);
  const reach = opts.reach ?? 30;
  const k = opts.softness ?? 7;
  const hl = Math.hypot(sunDir.x, sunDir.z) || 1;
  const sx = sunDir.x / hl, sz = sunDir.z / hl;
  const rise = sunDir.y / hl; // ray climb per unit of horizontal travel
  const j0 = opts.rowFrom ?? 0, j1 = Math.min(rows, opts.rowTo ?? rows);
  for (let j = j0; j < j1; j++) {
    for (let i = 0; i < cols; i++) {
      const v = i + j * cols;
      const x = x0 + i * step, z = z0 + j * step;
      const h = heights[v] + 0.03;
      let res = 1;
      let t = step * 0.8;
      while (t < reach) {
        const d = h + t * rise - sample(x + sx * t, z + sz * t);
        const r = (k * d) / t;
        if (r < res) {
          res = r;
          if (res < 0) break;
        }
        t += Math.max(step * 0.75, t * 0.06);
      }
      const s = Math.min(1, Math.max(0, res));
      out[v * 2] = s * s * (3 - 2 * s);
    }
  }
}

// Occlusion into out[v * 2 + 1]: how far each point sits below the average
// of its neighbourhood, at a couple of scales (box averages from a
// summed-area table, so any radius costs the same).
export function bakeOcclusion(heights: Float32Array, cols: number, rows: number, step: number, out: Float32Array, opts: BakeOptions = {}): void {
  const W1 = cols + 1;
  const sat = new Float64Array(W1 * (rows + 1));
  for (let j = 0; j < rows; j++) {
    let rowSum = 0;
    for (let i = 0; i < cols; i++) {
      rowSum += heights[i + j * cols];
      sat[i + 1 + (j + 1) * W1] = sat[i + 1 + j * W1] + rowSum;
    }
  }
  const boxAvg = (i: number, j: number, r: number): number => {
    const a = Math.max(0, i - r), b = Math.max(0, j - r);
    const c = Math.min(cols - 1, i + r) + 1, d = Math.min(rows - 1, j + r) + 1;
    const sum = sat[c + d * W1] - sat[a + d * W1] - sat[c + b * W1] + sat[a + b * W1];
    return sum / ((c - a) * (d - b));
  };
  const radii = (opts.aoRadii ?? [0.8, 3.5]).map((rw) => ({ r: Math.max(1, Math.round(rw / step)) }));
  const strength = opts.aoStrength ?? 1.4;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const v = i + j * cols;
      let ao = 1;
      for (const { r } of radii) {
        const cavity = boxAvg(i, j, r) - heights[v];
        ao *= Math.min(1, Math.max(0.35, 1 - (strength * cavity) / (r * step)));
      }
      out[v * 2 + 1] = ao;
    }
  }
}
