// Balanced spinning-disk initial conditions, shared by every demo.
//
// Total mass is constant no matter how many particles sample it, so particle
// count is a resolution knob: the same galaxy, sampled coarsely or finely.

export const TOTAL_MASS = 40960;
export const G = 0.0000016;

export interface Bodies {
  // x, y, vx, vy interleaved
  state: Float32Array;
  mass: Float32Array;
  count: number;
}

function randn(): number {
  const u = Math.random() || 1e-9;
  const v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function seedDisk(
  count: number,
  opts: { radius?: number; spin?: number; dispersion?: number; softening?: number } = {},
): Bodies {
  const R = opts.radius ?? 0.9;
  const spin = opts.spin ?? 1.0;
  const disp = opts.dispersion ?? 0.12;
  const eps = opts.softening ?? 0.05;

  const state = new Float32Array(count * 4);
  const mass = new Float32Array(count);
  for (let i = 0; i < count; i++) mass[i] = 1 + Math.random() * 3;
  let total = 0;
  for (let i = 0; i < count; i++) total += mass[i];
  const norm = TOTAL_MASS / total;
  for (let i = 0; i < count; i++) mass[i] *= norm;

  for (let i = 0; i < count; i++) {
    const r = R * Math.sqrt(Math.random());
    const a = Math.random() * Math.PI * 2;
    const mEnc = TOTAL_MASS * ((r * r) / (R * R));
    const vCirc = Math.sqrt((G * mEnc) / Math.sqrt(r * r + eps * eps));
    const v = spin * vCirc;
    state[i * 4 + 0] = Math.cos(a) * r;
    state[i * 4 + 1] = Math.sin(a) * r;
    state[i * 4 + 2] = -Math.sin(a) * v + randn() * disp * vCirc;
    state[i * 4 + 3] = Math.cos(a) * v + randn() * disp * vCirc;
  }
  return { state, mass, count };
}
