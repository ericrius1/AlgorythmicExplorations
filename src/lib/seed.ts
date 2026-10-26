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

// An optional static dark-matter halo: a logarithmic potential whose pull is
// v²·r / (r² + core²), which gives the flat rotation curve real spirals
// have. It's one analytic force on top of the bodies' own gravity, and it's
// what keeps a cold disk from tearing itself apart (Ostriker & Peebles 1973).
export interface Halo {
  v2: number; // asymptotic circular velocity, squared
  core: number; // core radius
}

export const DEFAULT_HALO: Halo = { v2: 0.11, core: 0.3 };
// A halo-supported disk can run much colder (less random motion) without
// breaking up, and a cold disk is what grows spiral arms.
export const HALO_DISPERSION = 0.06;

export function haloAccel(h: Halo, r: number): number {
  return (h.v2 * r) / (r * r + h.core * h.core);
}

export function seedDisk(
  count: number,
  opts: {
    radius?: number;
    spin?: number;
    dispersion?: number;
    softening?: number;
    halo?: Halo;
    // "uniform" spreads mass evenly over the disk; "exponential" piles it up
    // toward the middle the way real disk galaxies do.
    profile?: "uniform" | "exponential";
  } = {},
): Bodies {
  const R = opts.radius ?? 0.9;
  const spin = opts.spin ?? 1.0;
  const disp = opts.dispersion ?? 0.12;
  const eps = opts.softening ?? 0.05;
  const halo = opts.halo;
  const expo = opts.profile === "exponential";
  const Rd = R * 0.24; // exponential scale length

  const state = new Float32Array(count * 4);
  const mass = new Float32Array(count);
  for (let i = 0; i < count; i++) mass[i] = 1 + Math.random() * 3;
  let total = 0;
  for (let i = 0; i < count; i++) total += mass[i];
  const norm = TOTAL_MASS / total;
  for (let i = 0; i < count; i++) mass[i] *= norm;

  for (let i = 0; i < count; i++) {
    let r = R * Math.sqrt(Math.random());
    if (expo) {
      // surface density ∝ e^(-r/Rd), so r follows a gamma(2) distribution
      do r = -Rd * Math.log((Math.random() || 1e-9) * (Math.random() || 1e-9));
      while (r > R);
    }
    const a = Math.random() * Math.PI * 2;
    state[i * 4 + 0] = Math.cos(a) * r;
    state[i * 4 + 1] = Math.sin(a) * r;
  }

  // Put every body on a circular orbit for the pull it will really feel.
  // The usual shortcut, v² = G·M(<r)/r, is right for a sphere but not a
  // thin disk: there the mass outside r pulls outward too, and near the
  // centre the shortcut is 2× too fast, so the core flies apart in the first
  // second. Instead, measure the softened pull at a ring of sample radii
  // (from a subsample of bodies, mass scaled up to match) and interpolate.
  const SAMPLES = 48;
  const stride = Math.max(1, Math.ceil(count / 30000));
  const eps2 = eps * eps;
  const vc2 = new Float64Array(SAMPLES + 1); // vc2[k] at radius R·k/SAMPLES
  for (let k = 1; k <= SAMPLES; k++) {
    const rk = (R * k) / SAMPLES;
    let inward = 0;
    for (let q = 0; q < 4; q++) {
      const px = rk * Math.cos((q * Math.PI) / 2);
      const py = rk * Math.sin((q * Math.PI) / 2);
      let ax = 0;
      let ay = 0;
      for (let j = 0; j < count; j += stride) {
        const dx = state[j * 4] - px;
        const dy = state[j * 4 + 1] - py;
        const r2 = dx * dx + dy * dy + eps2;
        const inv = (G * mass[j] * stride) / (r2 * Math.sqrt(r2));
        ax += dx * inv;
        ay += dy * inv;
      }
      inward -= (ax * px + ay * py) / rk; // pull toward the centre is -a·r̂
    }
    vc2[k] = Math.max(0, rk * (inward / 4 + (halo ? haloAccel(halo, rk) : 0)));
  }

  for (let i = 0; i < count; i++) {
    const x = state[i * 4];
    const y = state[i * 4 + 1];
    const r = Math.hypot(x, y) || 1e-9;
    const f = Math.min(SAMPLES - 1e-6, (r / R) * SAMPLES);
    const k = Math.floor(f);
    const vCirc = Math.sqrt(vc2[k] + (vc2[k + 1] - vc2[k]) * (f - k));
    const v = spin * vCirc;
    state[i * 4 + 2] = (-y / r) * v + randn() * disp * vCirc;
    state[i * 4 + 3] = (x / r) * v + randn() * disp * vCirc;
  }

  // A random sample never has exactly zero net momentum, so the whole disk
  // would slowly drift out of frame. Move it into its own rest frame.
  let cx = 0;
  let cy = 0;
  let px = 0;
  let py = 0;
  for (let i = 0; i < count; i++) {
    cx += mass[i] * state[i * 4];
    cy += mass[i] * state[i * 4 + 1];
    px += mass[i] * state[i * 4 + 2];
    py += mass[i] * state[i * 4 + 3];
  }
  for (let i = 0; i < count; i++) {
    state[i * 4] -= cx / TOTAL_MASS;
    state[i * 4 + 1] -= cy / TOTAL_MASS;
    state[i * 4 + 2] -= px / TOTAL_MASS;
    state[i * 4 + 3] -= py / TOTAL_MASS;
  }
  return { state, mass, count };
}
