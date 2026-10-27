// Shared colouring for the flat maps in this series: an elevation ramp
// (dark low ground to pale peaks) times a hillshade lit from the upper left,
// the way printed relief maps are drawn.

const RAMP: [number, number, number, number][] = [
  [0.0, 24, 30, 48],
  [0.22, 52, 64, 78],
  [0.45, 104, 108, 104],
  [0.7, 172, 166, 150],
  [1.0, 244, 240, 232],
];

export function rampRgb(t: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, t));
  for (let k = 1; k < RAMP.length; k++) {
    if (x <= RAMP[k][0]) {
      const [t0, r0, g0, b0] = RAMP[k - 1];
      const [t1, r1, g1, b1] = RAMP[k];
      const f = (x - t0) / (t1 - t0);
      return [r0 + (r1 - r0) * f, g0 + (g1 - g0) * f, b0 + (b1 - b0) * f];
    }
  }
  return [244, 240, 232];
}

// Lambert shading of the height grid from the north-west, 45° up, relative
// to flat ground (flat = 1). `cellOverAmp` converts grid steps into slope.
const L = (() => {
  const x = -0.5, y = 0.7071, z = -0.5;
  const n = Math.hypot(x, y, z);
  return [x / n, y / n, z / n];
})();

export function hillshade(hs: Float32Array, W: number, H: number, i: number, j: number, cellOverAmp: number, exaggerate = 1.2): number {
  const i0 = Math.max(0, i - 1), i1 = Math.min(W - 1, i + 1);
  const j0 = Math.max(0, j - 1), j1 = Math.min(H - 1, j + 1);
  const dx = ((hs[i1 + j * W] - hs[i0 + j * W]) / ((i1 - i0) * cellOverAmp)) * exaggerate;
  const dz = ((hs[i + j1 * W] - hs[i + j0 * W]) / ((j1 - j0) * cellOverAmp)) * exaggerate;
  const inv = 1 / Math.hypot(dx, 1, dz);
  const d = (-dx * L[0] + L[1] - dz * L[2]) * inv;
  return Math.max(0, d) / L[1];
}

export function reliefRgb(hs: Float32Array, W: number, H: number, i: number, j: number, cellOverAmp: number): [number, number, number] {
  const [r, g, b] = rampRgb(hs[i + j * W]);
  const s = 0.5 + 0.5 * hillshade(hs, W, H, i, j, cellOverAmp);
  return [Math.min(255, r * s), Math.min(255, g * s), Math.min(255, b * s)];
}
