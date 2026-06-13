// Ferrofluid, second pass: the fluid becomes the magnet (Shao, Huang &
// Michels 2022). Part one's heuristic ∇|B|² pull is gone. Instead:
//
//   1. magnetizePass — each particle carries a magnetic moment m. The moment
//      is set by the field at the particle, and the field is set by everyone
//      else's moments — a linear system, relaxed one warm-started iteration
//      per frame instead of solved to convergence.
//   2. magForcePass — pairwise magnetic forces. The Kelvin term is the
//      kernel-smoothed dipole gradient (Huang et al. 2019, eqs. 31–33); the
//      current loop model adds an attractive bulk term μ0(∇M)·M that flips
//      the near field from outward (levitation) to inward (stable spikes).
//      A `kelvin` flag drops the extra term so the article can stage the duel.
//   3. densityPass / forcePass — the part-one SPH core, unchanged except the
//      force pass now just adds the cached magnetic acceleration.
//
// All magnetic kernels use the 3D cubic spline smoothed over a ball
// (W and W̄ below), which makes the dipole field finite at r = 0 — SPH's
// favorite trick, applied to magnetostatics.

struct Particle2 {
  pv: vec4f,  // pos.xy, vel.zw
  aux: vec4f, // moment.xy, cached magnetic acceleration.zw
}

struct FerroParams2 {
  count: u32,
  grid: u32,
  cell: f32,       // SPH kernel radius h (= grid cell, = magnetic smoothing radius)
  dt: f32,
  gravity: f32,
  stiffness: f32,
  restDensity: f32,
  nearStiffness: f32,
  xsph: f32,
  wallK: f32,
  tension: f32,
  chi: f32,        // susceptibility; kappa = chi/(1+chi)
  hExt: f32,       // uniform external field strength, +y
  magMoment: f32,  // cursor dipole moment (0 = no cursor magnet)
  mag: vec2f,      // cursor position, world units
  forceScale: f32, // pair-force → acceleration scale
  kelvin: f32,     // 1 = Kelvin model (drop the bulk term), 0 = current loop
  mMax: f32,       // moment clamp
  accClamp: f32,   // magnetic acceleration clamp
  floorY: f32,
  wallX: f32,
  topY: f32,
  cursorH: f32,    // cursor magnet smoothing radius, world units
}

@group(0) @binding(0) var<uniform> FP: FerroParams2;
@group(0) @binding(1) var<storage, read_write> parts: array<Particle2>;
@group(0) @binding(2) var<storage, read> cellStart: array<u32>;
@group(0) @binding(3) var<storage, read> cellCount: array<u32>;
@group(0) @binding(4) var<storage, read_write> density: array<vec4f>; // rho, rhoNear, _, _

// particle volume × kernel normalization, dx = h/2 → (h/2)³/(πh³) = 1/(8π)
const VSIG: f32 = 0.039788735;
const MAG_REACH: i32 = 4; // pair interactions truncated at 4h (paper's lookup range)

// ---- smoothed-dipole kernels (dimensionless, s = r/h) ----------------------------
// w: 3D cubic spline (×πh³). wavr: its average over the ball of radius r —
// the W̄ of Huang et al.'s smoothed dipole. Beyond the support, wavr decays
// as 3/(4s³) and the smoothed dipole becomes the exact point dipole.

fn wk(s: f32) -> f32 {
  if (s < 1.0) { return 1.0 - 1.5 * s * s + 0.75 * s * s * s; }
  if (s < 2.0) { let u = 2.0 - s; return 0.25 * u * u * u; }
  return 0.0;
}

fn wkp(s: f32) -> f32 { // dw/ds
  if (s < 1.0) { return -3.0 * s + 2.25 * s * s; }
  if (s < 2.0) { let u = 2.0 - s; return -0.75 * u * u; }
  return 0.0;
}

fn wavr(s: f32) -> f32 {
  if (s < 1.0) { return 1.0 - 0.9 * s * s + 0.375 * s * s * s; }
  if (s < 2.0) {
    let f = 2.6666667 * s * s * s - 3.0 * s * s * s * s + 1.2 * s * s * s * s * s
          - 0.16666667 * s * s * s * s * s * s;
    let iint = 0.6333333 + f - 0.7;
    return 0.75 * iint / (s * s * s);
  }
  return 0.75 / (s * s * s);
}

// A(r) = (W̄ − W)/r² — finite at r → 0 because W̄(0) = W(0)
fn magA(s: f32) -> f32 {
  if (s < 1.0) { return 0.6 - 0.375 * s; }
  return (wavr(s) - wk(s)) / (s * s);
}

// A'(r) per eq. 33 — the 1/s singularities cancel analytically below s = 1
fn magAp(s: f32) -> f32 {
  if (s < 1.0) { return -0.375; }
  return 5.0 * (wk(s) - wavr(s)) / (s * s * s) - wkp(s) / (s * s);
}

// field of a smoothed dipole with moment m at offset u = r/h (eq. 18)
fn hferro(u: vec2f, m: vec2f) -> vec2f {
  let s = length(u);
  if (s < 1e-5) { return -m * 0.33333333; } // W̄(0)/3, the self-demagnetizing limit
  let uh = u / s;
  return uh * (dot(uh, m) * (wavr(s) - wk(s))) - m * (wavr(s) / 3.0);
}

// Kelvin pair force ∇H(u, ms)·mt (eqs. 31–33), u = (target − source)/h.
// Antisymmetric in u and symmetric under ms↔mt: momentum is conserved.
fn fKelvin(u: vec2f, ms: vec2f, mt: vec2f) -> vec2f {
  let s = length(u);
  if (s < 1e-5) { return vec2f(0.0); }
  let a = magA(s);
  let ap = magAp(s);
  let ums = dot(u, ms);
  let umt = dot(u, mt);
  return (mt * ums + u * dot(ms, mt) + ms * umt) * a + u * (ums * umt * ap / s);
}

// current loop bulk term μ0(∇M)·M, collocated: attractive for aligned pairs
fn fBulk(u: vec2f, ms: vec2f, mt: vec2f) -> vec2f {
  let s = length(u);
  if (s < 1e-5 || s >= 2.0) { return vec2f(0.0); }
  return (u / s) * (wkp(s) * dot(ms, mt));
}

fn cellCoord(p: vec2f) -> vec2i {
  let g = f32(FP.grid);
  return vec2i(
    i32(clamp((p.x + 1.0) * 0.5 * g, 0.0, g - 1.0)),
    i32(clamp((p.y + 1.0) * 0.5 * g, 0.0, g - 1.0)),
  );
}

// external field at a point: uniform vertical + the cursor magnet, which is
// just one more smoothed dipole — a big one, with its own smoothing radius
fn externalH(p: vec2f) -> vec2f {
  var h = vec2f(0.0, FP.hExt);
  if (FP.magMoment > 0.0) {
    h += hferro((p - FP.mag) / FP.cursorH, vec2f(0.0, FP.magMoment));
  }
  return h;
}

// ---- 1. magnetization ------------------------------------------------------------
// One relaxed fixed-point iteration of the linear system per frame. Last
// frame's moments are the starting guess; the answer is never finished, only
// chased — and the crown grows over dozens of frames, so it never catches up
// by enough to matter.

@compute @workgroup_size(256)
fn magnetizePass(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= FP.count) { return; }
  let p = parts[i];
  let pi = p.pv.xy;
  let mi = p.aux.xy;
  let h = FP.cell;
  let cc = cellCoord(pi);

  var b = externalH(pi) + mi * (VSIG * 0.66666667); // self term, W̄(0) = W(0)
  for (var oy = -MAG_REACH; oy <= MAG_REACH; oy++) {
    for (var ox = -MAG_REACH; ox <= MAG_REACH; ox++) {
      let c = cc + vec2i(ox, oy);
      if (c.x < 0 || c.y < 0 || c.x >= i32(FP.grid) || c.y >= i32(FP.grid)) { continue; }
      let ci = u32(c.y) * FP.grid + u32(c.x);
      let st = cellStart[ci];
      let n = cellCount[ci];
      for (var k = st; k < st + n; k++) {
        if (k == i) { continue; }
        let u = (pi - parts[k].pv.xy) / h;
        let s = length(u);
        if (s < f32(MAG_REACH)) {
          let mj = parts[k].aux.xy;
          b += (hferro(u, mj) + mj * wk(s)) * VSIG;
        }
      }
    }
  }

  let kappa = FP.chi / (1.0 + FP.chi);
  var m = mix(mi, kappa * b, 0.6); // under-relaxed so the fixed point can't ring
  let ml = length(m);
  if (ml > FP.mMax) { m *= FP.mMax / ml; }
  parts[i] = Particle2(p.pv, vec4f(m, p.aux.zw));
}

// ---- 2. magnetic pair forces -----------------------------------------------------
// Computed once per frame and cached in aux.zw; positions barely move within
// a frame's five substeps, so the cache is honest.

@compute @workgroup_size(256)
fn magForcePass(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= FP.count) { return; }
  let p = parts[i];
  let pi = p.pv.xy;
  let mi = p.aux.xy;
  let h = FP.cell;
  let cc = cellCoord(pi);
  let useBulk = FP.kelvin < 0.5;

  var f = vec2f(0.0);
  for (var oy = -MAG_REACH; oy <= MAG_REACH; oy++) {
    for (var ox = -MAG_REACH; ox <= MAG_REACH; ox++) {
      let c = cc + vec2i(ox, oy);
      if (c.x < 0 || c.y < 0 || c.x >= i32(FP.grid) || c.y >= i32(FP.grid)) { continue; }
      let ci = u32(c.y) * FP.grid + u32(c.x);
      let st = cellStart[ci];
      let n = cellCount[ci];
      for (var k = st; k < st + n; k++) {
        if (k == i) { continue; }
        let u = (pi - parts[k].pv.xy) / h;
        if (length(u) < f32(MAG_REACH)) {
          let mj = parts[k].aux.xy;
          f += fKelvin(u, mj, mi);
          if (useBulk) { f += fBulk(u, mj, mi); }
        }
      }
    }
  }

  // the cursor magnet's gradient pulls too (uniform field has no gradient)
  if (FP.magMoment > 0.0) {
    f += fKelvin((pi - FP.mag) / FP.cursorH, vec2f(0.0, FP.magMoment), mi) * 0.2;
  }

  var acc = f * FP.forceScale;
  let al = length(acc);
  if (al > FP.accClamp) { acc *= FP.accClamp / al; }
  parts[i] = Particle2(p.pv, vec4f(p.aux.xy, acc));
}

// ---- 3. the part-one SPH core ------------------------------------------------------

@compute @workgroup_size(256)
fn densityPass(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= FP.count) { return; }
  let pi = parts[i].pv.xy;
  let h = FP.cell;
  let h2 = h * h;
  let cc = cellCoord(pi);
  var rho = 0.0;
  var rhoNear = 0.0;
  for (var oy = -1; oy <= 1; oy++) {
    for (var ox = -1; ox <= 1; ox++) {
      let c = cc + vec2i(ox, oy);
      if (c.x < 0 || c.y < 0 || c.x >= i32(FP.grid) || c.y >= i32(FP.grid)) { continue; }
      let ci = u32(c.y) * FP.grid + u32(c.x);
      let s = cellStart[ci];
      let n = cellCount[ci];
      for (var k = s; k < s + n; k++) {
        let d = parts[k].pv.xy - pi;
        let r2 = dot(d, d);
        if (r2 < h2) {
          let q = sqrt(r2) / h;
          let w = 1.0 - q;
          rho += w * w;
          rhoNear += w * w * w;
        }
      }
    }
  }
  density[i] = vec4f(rho, rhoNear, 0.0, 0.0);
}

fn cohesionW(q: f32) -> f32 {
  let a = (1.0 - q) * (1.0 - q) * (1.0 - q) * q * q * q;
  if (q < 0.5) { return 64.0 * (2.0 * a - 0.015625); }
  return 64.0 * a;
}

@compute @workgroup_size(256)
fn forcePass(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= FP.count) { return; }
  var p = parts[i];
  let h = FP.cell;
  let h2 = h * h;
  let di = density[i];

  let pressI = FP.stiffness * (di.x - FP.restDensity);
  let nearI = FP.nearStiffness * di.y;
  let cc = cellCoord(p.pv.xy);

  var acc = vec2f(0.0, -FP.gravity) + p.aux.zw; // cached magnetic acceleration
  var dv = vec2f(0.0);
  for (var oy = -1; oy <= 1; oy++) {
    for (var ox = -1; ox <= 1; ox++) {
      let c = cc + vec2i(ox, oy);
      if (c.x < 0 || c.y < 0 || c.x >= i32(FP.grid) || c.y >= i32(FP.grid)) { continue; }
      let ci = u32(c.y) * FP.grid + u32(c.x);
      let s = cellStart[ci];
      let n = cellCount[ci];
      for (var k = s; k < s + n; k++) {
        if (k == i) { continue; }
        let d = parts[k].pv.xy - p.pv.xy;
        let r2 = dot(d, d);
        if (r2 < h2 && r2 > 1e-14) {
          let r = sqrt(r2);
          let q = r / h;
          let dj = density[k];
          let press = 0.5 * (pressI + FP.stiffness * (dj.x - FP.restDensity));
          let near = 0.5 * (nearI + FP.nearStiffness * dj.y);
          let w = 1.0 - q;
          acc -= (d / r) * (press * w + near * w * w);
          acc += (d / r) * (FP.tension * cohesionW(q));
          dv += (parts[k].pv.zw - p.pv.zw) * w;
        }
      }
    }
  }

  if (p.pv.x < -FP.wallX) { acc.x += (-FP.wallX - p.pv.x) * FP.wallK; }
  if (p.pv.x > FP.wallX) { acc.x -= (p.pv.x - FP.wallX) * FP.wallK; }
  if (p.pv.y < FP.floorY) { acc.y += (FP.floorY - p.pv.y) * FP.wallK; }
  if (p.pv.y > FP.topY) { acc.y -= (p.pv.y - FP.topY) * FP.wallK; }

  var vel = (p.pv.zw + acc * FP.dt) * 0.9994;
  vel += dv * FP.xsph;
  let speed = length(vel);
  if (speed > 2.5) { vel *= 2.5 / speed; }
  parts[i] = Particle2(vec4f(p.pv.xy + vel * FP.dt, vel), p.aux);
}
