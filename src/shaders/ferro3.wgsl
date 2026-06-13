// The ferrofluid in three dimensions: part two's physics — warm-started
// magnetization, current-loop pair forces — ported to a z-up dish, plus a
// volume splat that deposits the particles into a 128³ scalar field for the
// surface extractors in surface3.wgsl.
//
// The magnetic kernels (cubic spline W, its ball-average W̄, the smoothed
// dipole and its gradient) were derived in 3D from the start; the 2D article
// borrowed them, this one uses them in their native dimension. Pair reach is
// truncated at 3h (±3 cells, 343-cell neighborhood) — the near field that
// makes columns gather and the first lobe of far-field repulsion that makes
// them space apart both fit inside.
//
// WGSL has no f32 atomics, so the field is accumulated in fixed point:
// kernel weights scaled by 256 and atomicAdd'ed into a u32 per voxel.

struct Particle3 {
  pos: vec4f,
  vel: vec4f,
  mom: vec4f, // magnetic moment xyz
  acc: vec4f, // cached magnetic acceleration xyz
}

struct FerroParams3 {
  count: u32,
  grid: u32,      // sort grid (64)
  cell: f32,      // SPH kernel radius h = 2/grid (= magnetic smoothing radius)
  dt: f32,
  gravity: f32,
  stiffness: f32,
  restDensity: f32,
  nearStiffness: f32,
  xsph: f32,
  wallK: f32,
  tension: f32,
  chi: f32,
  hExt: f32,      // uniform external field, +z
  magMoment: f32, // cursor dipole moment (vertical), 0 = off
  forceScale: f32,
  kelvin: f32,    // 1 = Kelvin model (drop the bulk term)
  mag: vec4f,     // cursor position xyz, w = cursor smoothing radius
  mMax: f32,
  accClamp: f32,
  floorZ: f32,
  wallXY: f32,    // dish half-width, x and y
  topZ: f32,
  fieldN: u32,    // field resolution per axis (128)
  splatR: f32,    // splat radius, world units
  fieldScale: f32,// fixed-point scale for the u32 field
}

@group(0) @binding(0) var<uniform> FP: FerroParams3;
@group(0) @binding(1) var<storage, read_write> parts: array<Particle3>;
@group(0) @binding(2) var<storage, read> cellStart: array<u32>;
@group(0) @binding(3) var<storage, read> cellCount: array<u32>;
@group(0) @binding(4) var<storage, read_write> density: array<vec2f>; // rho, rhoNear
@group(0) @binding(5) var<storage, read_write> field: array<atomic<u32>>;

const VSIG: f32 = 0.039788735; // (dx/h)³/π with dx = h/2
const MAG_REACH: i32 = 3;      // magnetic cutoff, in cells (= units of h)

// ---- smoothed-dipole kernels (dimensionless, s = r/h) — see part two -------------

fn wk(s: f32) -> f32 {
  if (s < 1.0) { return 1.0 - 1.5 * s * s + 0.75 * s * s * s; }
  if (s < 2.0) { let u = 2.0 - s; return 0.25 * u * u * u; }
  return 0.0;
}

fn wkp(s: f32) -> f32 {
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

fn magA(s: f32) -> f32 {
  if (s < 1.0) { return 0.6 - 0.375 * s; }
  return (wavr(s) - wk(s)) / (s * s);
}

fn magAp(s: f32) -> f32 {
  if (s < 1.0) { return -0.375; }
  return 5.0 * (wk(s) - wavr(s)) / (s * s * s) - wkp(s) / (s * s);
}

fn hferro(u: vec3f, m: vec3f) -> vec3f {
  let s = length(u);
  if (s < 1e-5) { return -m * 0.33333333; }
  let uh = u / s;
  return uh * (dot(uh, m) * (wavr(s) - wk(s))) - m * (wavr(s) / 3.0);
}

fn fKelvin(u: vec3f, ms: vec3f, mt: vec3f) -> vec3f {
  let s = length(u);
  if (s < 1e-5) { return vec3f(0.0); }
  let a = magA(s);
  let ap = magAp(s);
  let ums = dot(u, ms);
  let umt = dot(u, mt);
  return (mt * ums + u * dot(ms, mt) + ms * umt) * a + u * (ums * umt * ap / s);
}

fn fBulk(u: vec3f, ms: vec3f, mt: vec3f) -> vec3f {
  let s = length(u);
  if (s < 1e-5 || s >= 2.0) { return vec3f(0.0); }
  return (u / s) * (wkp(s) * dot(ms, mt));
}

fn cellCoord(p: vec3f) -> vec3i {
  let g = f32(FP.grid);
  return vec3i(
    i32(clamp((p.x + 1.0) * 0.5 * g, 0.0, g - 1.0)),
    i32(clamp((p.y + 1.0) * 0.5 * g, 0.0, g - 1.0)),
    i32(clamp((p.z + 1.0) * 0.5 * g, 0.0, g - 1.0)),
  );
}

fn cellIndex(c: vec3i) -> u32 {
  return (u32(c.z) * FP.grid + u32(c.y)) * FP.grid + u32(c.x);
}

fn externalH(p: vec3f) -> vec3f {
  var h = vec3f(0.0, 0.0, FP.hExt);
  if (FP.magMoment > 0.0) {
    h += hferro((p - FP.mag.xyz) / FP.mag.w, vec3f(0.0, 0.0, FP.magMoment));
  }
  return h;
}

// ---- magnetization: one warm-started relaxed sweep per cadence -------------------

@compute @workgroup_size(256)
fn magnetizePass(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= FP.count) { return; }
  let p = parts[i];
  let pi = p.pos.xyz;
  let mi = p.mom.xyz;
  let h = FP.cell;
  let cc = cellCoord(pi);
  let g = i32(FP.grid);

  var b = externalH(pi) + mi * (VSIG * 0.66666667);
  for (var oz = -MAG_REACH; oz <= MAG_REACH; oz++) {
    for (var oy = -MAG_REACH; oy <= MAG_REACH; oy++) {
      for (var ox = -MAG_REACH; ox <= MAG_REACH; ox++) {
        let c = cc + vec3i(ox, oy, oz);
        if (any(c < vec3i(0)) || any(c >= vec3i(g))) { continue; }
        let ci = cellIndex(c);
        let st = cellStart[ci];
        let n = cellCount[ci];
        for (var k = st; k < st + n; k++) {
          if (k == i) { continue; }
          let u = (pi - parts[k].pos.xyz) / h;
          let s = length(u);
          if (s < f32(MAG_REACH)) {
            let mj = parts[k].mom.xyz;
            b += (hferro(u, mj) + mj * wk(s)) * VSIG;
          }
        }
      }
    }
  }

  let kappa = FP.chi / (1.0 + FP.chi);
  var m = mix(mi, kappa * b, 0.6);
  let ml = length(m);
  if (ml > FP.mMax) { m *= FP.mMax / ml; }
  parts[i].mom = vec4f(m, 0.0);
}

// ---- pairwise magnetic force, cached in the acc lane ------------------------------

@compute @workgroup_size(256)
fn magForcePass(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= FP.count) { return; }
  let p = parts[i];
  let pi = p.pos.xyz;
  let mi = p.mom.xyz;
  let h = FP.cell;
  let cc = cellCoord(pi);
  let g = i32(FP.grid);
  let useBulk = FP.kelvin < 0.5;

  var f = vec3f(0.0);
  for (var oz = -MAG_REACH; oz <= MAG_REACH; oz++) {
    for (var oy = -MAG_REACH; oy <= MAG_REACH; oy++) {
      for (var ox = -MAG_REACH; ox <= MAG_REACH; ox++) {
        let c = cc + vec3i(ox, oy, oz);
        if (any(c < vec3i(0)) || any(c >= vec3i(g))) { continue; }
        let ci = cellIndex(c);
        let st = cellStart[ci];
        let n = cellCount[ci];
        for (var k = st; k < st + n; k++) {
          if (k == i) { continue; }
          let u = (pi - parts[k].pos.xyz) / h;
          if (length(u) < f32(MAG_REACH)) {
            let mj = parts[k].mom.xyz;
            f += fKelvin(u, mj, mi);
            if (useBulk) { f += fBulk(u, mj, mi); }
          }
        }
      }
    }
  }

  if (FP.magMoment > 0.0) {
    f += fKelvin((pi - FP.mag.xyz) / FP.mag.w, vec3f(0.0, 0.0, FP.magMoment), mi) * 0.2;
  }

  var acc = f * FP.forceScale;
  let al = length(acc);
  if (al > FP.accClamp) { acc *= FP.accClamp / al; }
  parts[i].acc = vec4f(acc, 0.0);
}

// ---- the SPH core, one more axis ----------------------------------------------------

@compute @workgroup_size(256)
fn densityPass(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= FP.count) { return; }
  let pi = parts[i].pos.xyz;
  let h = FP.cell;
  let h2 = h * h;
  let cc = cellCoord(pi);
  let g = i32(FP.grid);
  var rho = 0.0;
  var rhoNear = 0.0;
  for (var oz = -1; oz <= 1; oz++) {
    for (var oy = -1; oy <= 1; oy++) {
      for (var ox = -1; ox <= 1; ox++) {
        let c = cc + vec3i(ox, oy, oz);
        if (any(c < vec3i(0)) || any(c >= vec3i(g))) { continue; }
        let ci = cellIndex(c);
        let st = cellStart[ci];
        let n = cellCount[ci];
        for (var k = st; k < st + n; k++) {
          let d = parts[k].pos.xyz - pi;
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
  }
  density[i] = vec2f(rho, rhoNear);
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
  let cc = cellCoord(p.pos.xyz);
  let g = i32(FP.grid);

  var acc = vec3f(0.0, 0.0, -FP.gravity) + p.acc.xyz;
  var dv = vec3f(0.0);
  for (var oz = -1; oz <= 1; oz++) {
    for (var oy = -1; oy <= 1; oy++) {
      for (var ox = -1; ox <= 1; ox++) {
        let c = cc + vec3i(ox, oy, oz);
        if (any(c < vec3i(0)) || any(c >= vec3i(g))) { continue; }
        let ci = cellIndex(c);
        let st = cellStart[ci];
        let n = cellCount[ci];
        for (var k = st; k < st + n; k++) {
          if (k == i) { continue; }
          let d = parts[k].pos.xyz - p.pos.xyz;
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
            dv += (parts[k].vel.xyz - p.vel.xyz) * w;
          }
        }
      }
    }
  }

  // the dish: penalty springs on five faces
  if (p.pos.x < -FP.wallXY) { acc.x += (-FP.wallXY - p.pos.x) * FP.wallK; }
  if (p.pos.x > FP.wallXY) { acc.x -= (p.pos.x - FP.wallXY) * FP.wallK; }
  if (p.pos.y < -FP.wallXY) { acc.y += (-FP.wallXY - p.pos.y) * FP.wallK; }
  if (p.pos.y > FP.wallXY) { acc.y -= (p.pos.y - FP.wallXY) * FP.wallK; }
  if (p.pos.z < FP.floorZ) { acc.z += (FP.floorZ - p.pos.z) * FP.wallK; }
  if (p.pos.z > FP.topZ) { acc.z -= (p.pos.z - FP.topZ) * FP.wallK; }

  var vel = (p.vel.xyz + acc * FP.dt) * 0.9994;
  vel += dv * FP.xsph;
  let speed = length(vel);
  if (speed > 2.5) { vel *= 2.5 / speed; }
  parts[i].pos = vec4f(p.pos.xyz + vel * FP.dt, 0.0);
  parts[i].vel = vec4f(vel, 0.0);
}

// ---- volume splat: particles → fixed-point density field --------------------------

@compute @workgroup_size(256)
fn splatPass(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= FP.count) { return; }
  let p = parts[i].pos.xyz;
  let nf = f32(FP.fieldN);
  let voxel = 2.0 / nf;
  let R = FP.splatR;
  let rv = i32(ceil(R / voxel));
  let pc = vec3i(floor((p + 1.0) * 0.5 * nf));
  let ni = i32(FP.fieldN);

  for (var oz = -rv; oz <= rv; oz++) {
    for (var oy = -rv; oy <= rv; oy++) {
      for (var ox = -rv; ox <= rv; ox++) {
        let v = pc + vec3i(ox, oy, oz);
        if (any(v < vec3i(0)) || any(v >= vec3i(ni))) { continue; }
        let center = -1.0 + (vec3f(v) + 0.5) * voxel;
        let q2 = dot(center - p, center - p) / (R * R);
        if (q2 >= 1.0) { continue; }
        let w = (1.0 - q2) * (1.0 - q2);
        let vi = (u32(v.z) * FP.fieldN + u32(v.y)) * FP.fieldN + u32(v.x);
        atomicAdd(&field[vi], u32(w * FP.fieldScale));
      }
    }
  }
}
