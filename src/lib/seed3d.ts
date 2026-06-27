// 3D initial conditions. Same constant total mass as part one — particle
// count stays a resolution knob in any number of dimensions.

import { TOTAL_MASS, G } from "./seed";

export interface Bodies3D {
  pos: Float32Array; // x, y, z, mass
  vel: Float32Array; // vx, vy, vz, 0
  count: number;
}

function randn(): number {
  const u = Math.random() || 1e-9;
  const v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function alloc(count: number): Bodies3D {
  const b: Bodies3D = { pos: new Float32Array(count * 4), vel: new Float32Array(count * 4), count };
  let total = 0;
  for (let i = 0; i < count; i++) {
    const m = 1 + Math.random() * 3;
    b.pos[i * 4 + 3] = m;
    total += m;
  }
  const norm = TOTAL_MASS / total;
  for (let i = 0; i < count; i++) b.pos[i * 4 + 3] *= norm;
  return b;
}

// A thin spinning disk in the xy plane — a toy spiral galaxy with depth.
export function seedDisk3D(count: number, opts: { radius?: number; thickness?: number } = {}): Bodies3D {
  const R = opts.radius ?? 0.9;
  const thick = opts.thickness ?? 0.06;
  const eps = 0.05;
  const b = alloc(count);
  for (let i = 0; i < count; i++) {
    const r = R * Math.sqrt(Math.random());
    const a = Math.random() * Math.PI * 2;
    const mEnc = TOTAL_MASS * ((r * r) / (R * R));
    const vCirc = Math.sqrt((G * mEnc) / Math.sqrt(r * r + eps * eps));
    b.pos[i * 4 + 0] = Math.cos(a) * r;
    b.pos[i * 4 + 1] = Math.sin(a) * r;
    b.pos[i * 4 + 2] = randn() * thick * (1 - (0.6 * r) / R);
    b.vel[i * 4 + 0] = -Math.sin(a) * vCirc + randn() * 0.1 * vCirc;
    b.vel[i * 4 + 1] = Math.cos(a) * vCirc + randn() * 0.1 * vCirc;
    b.vel[i * 4 + 2] = randn() * 0.05 * vCirc;
  }
  return b;
}

// Bodies scattered over the upper hemisphere of a shell, swirling around the
// vertical axis. The dome spring keeps them on the shell; gravity does the rest.
export function seedDome(count: number, opts: { radius?: number; spin?: number } = {}): Bodies3D {
  const R = opts.radius ?? 0.9;
  const spin = opts.spin ?? 1.0;
  const b = alloc(count);
  for (let i = 0; i < count; i++) {
    // uniform area on the upper hemisphere
    const z = Math.random();
    const rho = Math.sqrt(Math.max(0, 1 - z * z));
    const a = Math.random() * Math.PI * 2;
    const px = Math.cos(a) * rho;
    const py = Math.sin(a) * rho;
    b.pos[i * 4 + 0] = px * R;
    b.pos[i * 4 + 1] = py * R;
    b.pos[i * 4 + 2] = z * R;
    // swirl about the z axis, faster near the rim, plus a little noise
    const ringR = rho * R;
    const vCirc = Math.sqrt((G * TOTAL_MASS * 0.5) / Math.sqrt(ringR * ringR + 0.05 * 0.05));
    const v = spin * vCirc * rho;
    b.vel[i * 4 + 0] = -Math.sin(a) * v + randn() * 0.08 * vCirc;
    b.vel[i * 4 + 1] = Math.cos(a) * v + randn() * 0.08 * vCirc;
    b.vel[i * 4 + 2] = randn() * 0.04 * vCirc;
  }
  return b;
}

// A pool of fluid resting in the lower dome. The SPH gravity points along -z and
// the shell has a floor at z = 0, so particles seeded as a half-ball sitting on
// that floor settle into a still pool. Start near rest; tiny jitter breaks the
// sampling lattice so the solver doesn't lock into a frozen grid.
export function seedDomeFluid(count: number, opts: { radius?: number } = {}): Bodies3D {
  const R = opts.radius ?? 0.83;
  const b = alloc(count);
  for (let i = 0; i < count; i++) {
    // rejection-sample a uniform point in the unit ball, fold to the upper half
    let x: number, y: number, z: number;
    do {
      x = Math.random() * 2 - 1;
      y = Math.random() * 2 - 1;
      z = Math.random() * 2 - 1;
    } while (x * x + y * y + z * z > 1);
    b.pos[i * 4 + 0] = x * R;
    b.pos[i * 4 + 1] = y * R;
    b.pos[i * 4 + 2] = Math.abs(z) * R;
    b.vel[i * 4 + 0] = randn() * 0.02;
    b.vel[i * 4 + 1] = randn() * 0.02;
    b.vel[i * 4 + 2] = randn() * 0.02;
  }
  return b;
}
