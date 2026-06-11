// Part six's instrument: a 64³ velocity field stirred by hands, kept
// incompressible by the same Poisson equation part five solved for gravity,
// and read back by half a million weightless paint particles.
//
// One frame: advect → forces (curl noise + stirrers + buoyancy) → divergence
// → Jacobi pressure sweeps → project → advect particles through the result.

const N: u32 = 64u;          // grid cells per side
const NF: f32 = 64.0;
const CELLS: u32 = N * N * N;
const WORLD: f32 = 1.0;      // box spans [-1, 1]³

struct Stirrer {
  posR: vec4f,   // xyz world position, w gaussian radius
  velS: vec4f,   // xyz world velocity, w push strength
  fx: vec4f,     // x attract (pinch), y dye emission, z spin, w active
}

struct Params {
  dt: f32, time: f32, swirl: f32, noiseScale: f32,   // dt: grid step (may span several frames)
  buoy: f32, centerPull: f32, drag: f32, dyeDecay: f32,
  speedLimit: f32, drift: f32, lifeMin: f32, lifeMax: f32,
  count: u32, nStir: u32, mode: u32, flow: f32,
  axis: vec4f,   // xyz camera forward (vortex axis), w = particle dt (per frame)
  stir: array<Stirrer, 8>,
}

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> velIn: array<vec4f>;        // xyz vel, w dye
@group(0) @binding(2) var<storage, read_write> velOut: array<vec4f>;
@group(0) @binding(3) var<storage, read> prIn: array<f32>;
@group(0) @binding(4) var<storage, read_write> prOut: array<f32>;
@group(0) @binding(5) var<storage, read_write> div: array<f32>;
@group(0) @binding(6) var<storage, read_write> ppos: array<vec4f>;   // xyz pos, w life
@group(0) @binding(7) var<storage, read_write> pvel: array<vec4f>;   // xyz vel, w seed

fn idx(c: vec3u) -> u32 { return c.x + c.y * N + c.z * N * N; }

fn cellCenter(c: vec3u) -> vec3f {
  return (vec3f(c) + 0.5) / NF * 2.0 * WORLD - WORLD;
}

// ---- trilinear sampling (world position → interpolated cell value) --------

fn sampleIn(p: vec3f) -> vec4f {
  let g = clamp((p + WORLD) / (2.0 * WORLD) * NF - 0.5, vec3f(0.0), vec3f(NF - 1.001));
  let i0 = vec3u(g);
  let f = g - vec3f(i0);
  let i1 = min(i0 + 1u, vec3u(N - 1u));
  let c00 = mix(velIn[idx(vec3u(i0.x, i0.y, i0.z))], velIn[idx(vec3u(i1.x, i0.y, i0.z))], f.x);
  let c10 = mix(velIn[idx(vec3u(i0.x, i1.y, i0.z))], velIn[idx(vec3u(i1.x, i1.y, i0.z))], f.x);
  let c01 = mix(velIn[idx(vec3u(i0.x, i0.y, i1.z))], velIn[idx(vec3u(i1.x, i0.y, i1.z))], f.x);
  let c11 = mix(velIn[idx(vec3u(i0.x, i1.y, i1.z))], velIn[idx(vec3u(i1.x, i1.y, i1.z))], f.x);
  return mix(mix(c00, c10, f.y), mix(c01, c11, f.y), f.z);
}

fn sampleOut(p: vec3f) -> vec4f {
  let g = clamp((p + WORLD) / (2.0 * WORLD) * NF - 0.5, vec3f(0.0), vec3f(NF - 1.001));
  let i0 = vec3u(g);
  let f = g - vec3f(i0);
  let i1 = min(i0 + 1u, vec3u(N - 1u));
  let c00 = mix(velOut[idx(vec3u(i0.x, i0.y, i0.z))], velOut[idx(vec3u(i1.x, i0.y, i0.z))], f.x);
  let c10 = mix(velOut[idx(vec3u(i0.x, i1.y, i0.z))], velOut[idx(vec3u(i1.x, i1.y, i0.z))], f.x);
  let c01 = mix(velOut[idx(vec3u(i0.x, i0.y, i1.z))], velOut[idx(vec3u(i1.x, i0.y, i1.z))], f.x);
  let c11 = mix(velOut[idx(vec3u(i0.x, i1.y, i1.z))], velOut[idx(vec3u(i1.x, i1.y, i1.z))], f.x);
  return mix(mix(c00, c10, f.y), mix(c01, c11, f.y), f.z);
}

// ---- curl noise ------------------------------------------------------------

fn hash31(p3: vec3f) -> f32 {
  var q = fract(p3 * vec3f(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

// Analytic gradient of trilinear value noise: the same eight corner hashes
// that interpolation would use, differentiated instead — no finite
// differences, so one call replaces six.
fn vnoiseGrad(p: vec3f) -> vec3f {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let du = 6.0 * f * (1.0 - f);
  let a000 = hash31(i + vec3f(0.0, 0.0, 0.0));
  let a100 = hash31(i + vec3f(1.0, 0.0, 0.0));
  let a010 = hash31(i + vec3f(0.0, 1.0, 0.0));
  let a110 = hash31(i + vec3f(1.0, 1.0, 0.0));
  let a001 = hash31(i + vec3f(0.0, 0.0, 1.0));
  let a101 = hash31(i + vec3f(1.0, 0.0, 1.0));
  let a011 = hash31(i + vec3f(0.0, 1.0, 1.0));
  let a111 = hash31(i + vec3f(1.0, 1.0, 1.0));
  let gx = mix(mix(a100 - a000, a110 - a010, u.y), mix(a101 - a001, a111 - a011, u.y), u.z) * du.x;
  let gy = mix(mix(a010 - a000, a110 - a100, u.x), mix(a011 - a001, a111 - a101, u.x), u.z) * du.y;
  let gz = mix(mix(a001 - a000, a101 - a100, u.x), mix(a011 - a010, a111 - a110, u.x), u.y) * du.z;
  return vec3f(gx, gy, gz);
}

// curl of a three-channel noise potential ψ — divergence-free by identity.
// Three gradient evaluations instead of eighteen noise samples.
fn curlNoise(p: vec3f) -> vec3f {
  let q = p * P.noiseScale + vec3f(0.0, 0.0, P.time * 0.13);
  let gx = vnoiseGrad(q);                            // ∇ψx
  let gy = vnoiseGrad(q + vec3f(31.4, 5.2, 12.9));   // ∇ψy
  let gz = vnoiseGrad(q + vec3f(7.7, 73.1, 49.2));   // ∇ψz
  return vec3f(gz.y - gy.z, gx.z - gz.x, gy.x - gx.y) * P.noiseScale;
}

// ---- grid passes -----------------------------------------------------------

@compute @workgroup_size(4, 4, 4)
fn advect(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= N || gid.y >= N || gid.z >= N) { return; }
  let p = cellCenter(gid);
  let back = p - velIn[idx(gid)].xyz * P.dt;
  var v = sampleIn(back);
  v = vec4f(v.xyz * exp(-P.drag * P.dt), v.w * exp(-P.dyeDecay * P.dt));
  velOut[idx(gid)] = v;
}

@compute @workgroup_size(4, 4, 4)
fn forces(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= N || gid.y >= N || gid.z >= N) { return; }
  let i = idx(gid);
  let p = cellCenter(gid);
  var v = velOut[i].xyz;
  var dye = velOut[i].w;

  // ambient curl-noise wind: keeps the volume alive without ever pooling
  v += curlNoise(p) * P.swirl * P.dt;

  // mode flavour: buoyancy lifts dyed fluid (plus a faint ambient updraft),
  // centerPull cradles it
  v.z += P.buoy * (dye + 0.06) * P.dt;
  v += -p * P.centerPull * P.dt;

  // stirrers: hands, fingertips, cursor, or the idle ghost
  for (var s = 0u; s < P.nStir; s++) {
    let st = P.stir[s];
    if (st.fx.w < 0.5) { continue; }
    let d = p - st.posR.xyz;
    let r = st.posR.w;
    let g = exp(-dot(d, d) / (r * r));
    v += st.velS.xyz * (st.velS.w * g * P.dt);          // push with the motion
    v += cross(P.axis.xyz, d) * (st.fx.z / r * g * P.dt); // swirl around view axis
    v += -d * (st.fx.x * g * P.dt);                      // pinch: draw inward
    dye += st.fx.y * g * P.dt;
  }

  // soft walls: turn flow back before it reaches the box edge
  let edge = smoothstep(vec3f(0.72), vec3f(1.0), abs(p));
  v -= sign(p) * edge * 8.0 * P.dt;

  let sp = length(v);
  if (sp > P.speedLimit) { v *= P.speedLimit / sp; }
  velOut[i] = vec4f(v, min(dye, 3.0));
}

@compute @workgroup_size(4, 4, 4)
fn divergence(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= N || gid.y >= N || gid.z >= N) { return; }
  let xm = velOut[idx(vec3u(max(gid.x, 1u) - 1u, gid.y, gid.z))].x;
  let xp = velOut[idx(vec3u(min(gid.x + 1u, N - 1u), gid.y, gid.z))].x;
  let ym = velOut[idx(vec3u(gid.x, max(gid.y, 1u) - 1u, gid.z))].y;
  let yp = velOut[idx(vec3u(gid.x, min(gid.y + 1u, N - 1u), gid.z))].y;
  let zm = velOut[idx(vec3u(gid.x, gid.y, max(gid.z, 1u) - 1u))].z;
  let zp = velOut[idx(vec3u(gid.x, gid.y, min(gid.z + 1u, N - 1u)))].z;
  let h = 2.0 * WORLD / NF;
  let i = idx(gid);
  div[i] = (xp - xm + yp - ym + zp - zm) / (2.0 * h);
  prOut[i] = 0.0; // jacobi's first read starts from rest
}

@compute @workgroup_size(4, 4, 4)
fn jacobi(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= N || gid.y >= N || gid.z >= N) { return; }
  let xm = prIn[idx(vec3u(max(gid.x, 1u) - 1u, gid.y, gid.z))];
  let xp = prIn[idx(vec3u(min(gid.x + 1u, N - 1u), gid.y, gid.z))];
  let ym = prIn[idx(vec3u(gid.x, max(gid.y, 1u) - 1u, gid.z))];
  let yp = prIn[idx(vec3u(gid.x, min(gid.y + 1u, N - 1u), gid.z))];
  let zm = prIn[idx(vec3u(gid.x, gid.y, max(gid.z, 1u) - 1u))];
  let zp = prIn[idx(vec3u(gid.x, gid.y, min(gid.z + 1u, N - 1u)))];
  let h = 2.0 * WORLD / NF;
  prOut[idx(gid)] = (xm + xp + ym + yp + zm + zp - div[idx(gid)] * h * h) / 6.0;
}

@compute @workgroup_size(4, 4, 4)
fn project(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= N || gid.y >= N || gid.z >= N) { return; }
  let xm = prIn[idx(vec3u(max(gid.x, 1u) - 1u, gid.y, gid.z))];
  let xp = prIn[idx(vec3u(min(gid.x + 1u, N - 1u), gid.y, gid.z))];
  let ym = prIn[idx(vec3u(gid.x, max(gid.y, 1u) - 1u, gid.z))];
  let yp = prIn[idx(vec3u(gid.x, min(gid.y + 1u, N - 1u), gid.z))];
  let zm = prIn[idx(vec3u(gid.x, gid.y, max(gid.z, 1u) - 1u))];
  let zp = prIn[idx(vec3u(gid.x, gid.y, min(gid.z + 1u, N - 1u)))];
  let h = 2.0 * WORLD / NF;
  let i = idx(gid);
  let grad = vec3f(xp - xm, yp - ym, zp - zm) / (2.0 * h);
  velOut[i] = vec4f(velOut[i].xyz - grad, velOut[i].w);
}

// ---- particles -------------------------------------------------------------

fn rnd(seed: f32, k: f32) -> f32 {
  return hash31(vec3f(seed * 127.1, k * 311.7, P.time * 0.37 + seed));
}

@compute @workgroup_size(256)
fn particles(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= P.count) { return; }
  let pdt = P.axis.w; // particles step every frame; the grid may not
  var p = ppos[i];
  var seed = pvel[i].w;
  var life = p.w - pdt;

  let s = sampleOut(p.xyz);
  // each particle drifts a touch off the grid flow so streams stay feathery
  let wob = vec3f(rnd(seed, 1.0), rnd(seed, 2.0), rnd(seed, 3.0)) - 0.5;
  let v = s.xyz * P.flow + wob * P.drift;
  let np = p.xyz + v * pdt;

  if (life <= 0.0 || any(abs(np) > vec3f(1.05))) {
    // respawn: at a breathing stirrer if one is emitting, else in the ambient volume
    seed = fract(seed + 0.6180339887);
    var origin = vec3f(0.0);
    var spread = 0.9;
    var found = false;
    // roughly half the paint is born at an emitting stirrer, the rest fills
    // the volume — all-at-the-stirrer reads as a knot, not a fluid. embers
    // mostly rise from their bed of coals instead.
    let stirFrac = select(0.55, 0.3, P.mode == 1u);
    if (P.nStir > 0u && rnd(seed, 9.0) < stirFrac) {
      let pick = u32(rnd(seed, 4.0) * f32(P.nStir)) % P.nStir;
      let st = P.stir[pick];
      if (st.fx.w > 0.5 && st.fx.y > 0.01) {
        origin = st.posR.xyz;
        spread = st.posR.w * 1.2;
        found = true;
      }
    }
    if (!found && P.mode == 1u) {
      // embers rise from a bed of coals near the floor
      origin = vec3f(0.0, 0.0, -0.8);
      spread = 0.5;
    }
    let u1 = rnd(seed, 5.0);
    let u2 = rnd(seed, 6.0);
    let u3 = rnd(seed, 7.0);
    let th = u1 * 6.2831853;
    let ph = acos(2.0 * u2 - 1.0);
    let rad = spread * pow(u3, 0.5);
    let off = vec3f(sin(ph) * cos(th), sin(ph) * sin(th), cos(ph)) * rad;
    let sp = clamp(origin + off, vec3f(-0.99), vec3f(0.99));
    life = mix(P.lifeMin, P.lifeMax, rnd(seed, 8.0));
    ppos[i] = vec4f(sp, life);
    pvel[i] = vec4f(0.0, 0.0, 0.0, seed);
    return;
  }

  ppos[i] = vec4f(np, life);
  pvel[i] = vec4f(v, seed);
}
