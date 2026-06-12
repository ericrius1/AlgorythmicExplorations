import{i as qe}from"./siteNav-DaR1fllU.js";import{S as Ae,g as He,m as Ve}from"./demoShell-Btkj803W.js";import{B as ve,_ as Je,H as Ye}from"./hands-BijGc3zx.js";import{g as Xe,c as Qe}from"./gpu-DBowy6aD.js";import{O as Ke}from"./camera3d-_003W6Cq.js";import{m as Ze,l as Ce,b as Re,a as et,p as Pe,P as Ne}from"./scrolly-CfS_4Ccm.js";const tt=`// Part six's instrument: a 64³ velocity field stirred by hands, kept
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
`,nt=`// Part six's paint layer. Particles render as velocity-stretched capsules
// into a persistent HDR accumulation texture; a fade pass dims last frame's
// light instead of clearing it, which is where the silk trails come from;
// a final blit tonemaps the accumulated energy onto the canvas. Hands show
// up as additive glow lines drawn into the same accumulation.

struct R {
  viewProj: mat4x4f,
  right: vec4f,   // xyz camera right, w particle half-size (ndc-ish)
  up: vec4f,      // xyz camera up,    w velocity stretch (seconds of tail)
  colA: vec4f,    // slow color,  w speed-to-color scale
  colB: vec4f,    // mid color,   w unused
  colC: vec4f,    // fast color,  w unused
  misc: vec4f,    // x exposure, y aspect, z time, w glow gain
}

@group(0) @binding(0) var<uniform> U: R;
@group(0) @binding(1) var<storage, read> pos: array<vec4f>;
@group(0) @binding(2) var<storage, read> vel: array<vec4f>;

struct VOut {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
  @location(1) color: vec3f,
  @location(2) core: f32, // |uv.x| below this is the segment, above is cap
}

const QUAD = array<vec2f, 6>(
  vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
  vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
);

fn palette(t: f32) -> vec3f {
  if (t < 0.5) { return mix(U.colA.rgb, U.colB.rgb, t * 2.0); }
  return mix(U.colB.rgb, U.colC.rgb, (t - 0.5) * 2.0);
}

@vertex
fn vsParticle(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  let q = QUAD[vi];
  let p = pos[ii];
  let v = vel[ii].xyz;
  let head = p.xyz;
  let tail = p.xyz - v * U.up.w;

  let c0 = U.viewProj * vec4f(head, 1.0);
  let c1 = U.viewProj * vec4f(tail, 1.0);
  // screen-space geometry: aspect-corrected ndc so widths are isotropic
  let sxy = vec2f(U.misc.y, 1.0);
  let s0 = c0.xy / max(c0.w, 0.01) * sxy;
  let s1 = c1.xy / max(c1.w, 0.01) * sxy;
  let d = s1 - s0;
  let len = length(d);
  var dir = vec2f(1.0, 0.0);
  if (len > 1e-5) { dir = d / len; }
  let perp = vec2f(-dir.y, dir.x);

  // pick this vertex's end of the capsule; size shrinks with distance via w
  let cEnd = select(c0, c1, q.x > 0.0);
  let sEnd = select(s0, s1, q.x > 0.0);
  let halfW = U.right.w / max(cEnd.w, 0.2);
  let sPos = sEnd + dir * q.x * halfW + perp * q.y * halfW;

  var o: VOut;
  o.clip = vec4f(sPos / sxy * cEnd.w, cEnd.z, cEnd.w);
  o.uv = q * vec2f((len * 0.5 + halfW) / halfW, 1.0); // uv.x in capsule units
  o.core = len * 0.5 / halfW;
  let t = clamp(length(v) * U.colA.w, 0.0, 1.0);
  let lifeFade = smoothstep(0.0, 0.7, p.w);
  o.color = palette(t) * lifeFade;
  return o;
}

@fragment
fn fsParticle(in: VOut) -> @location(0) vec4f {
  // capsule falloff: distance to the segment, in cap-radius units
  let dc = length(vec2f(max(abs(in.uv.x) - in.core, 0.0), in.uv.y));
  let a = pow(max(1.0 - dc, 0.0), 2.0);
  return vec4f(in.color * a * U.misc.w, a);
}

// ---- hand skeleton: additive glow lines ------------------------------------

@group(0) @binding(3) var<storage, read> lines: array<vec4f>; // xyz pos, w alpha

struct LOut {
  @builtin(position) clip: vec4f,
  @location(0) alpha: f32,
}

@vertex
fn vsLine(@builtin(vertex_index) vi: u32) -> LOut {
  let l = lines[vi];
  var o: LOut;
  o.clip = U.viewProj * vec4f(l.xyz, 1.0);
  o.alpha = l.w;
  return o;
}

@fragment
fn fsLine(in: LOut) -> @location(0) vec4f {
  let c = vec3f(0.65, 0.85, 1.0) * in.alpha * 0.5;
  return vec4f(c, in.alpha * 0.5);
}

// ---- fade pass: multiply the accumulation by a constant (the trail knob) ---

@vertex
fn vsFade(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  // fullscreen triangle
  let xy = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u)) * 2.0 - 1.0;
  return vec4f(xy, 0.0, 1.0);
}

@fragment
fn fsFade() -> @location(0) vec4f {
  // blend is (src * 0 + dst * blendConstant); output value is irrelevant
  return vec4f(0.0);
}

// ---- blit: tonemap accumulated light onto the canvas ------------------------

@group(0) @binding(0) var accumTex: texture_2d<f32>;
@group(0) @binding(1) var accumSamp: sampler;
@group(0) @binding(2) var<uniform> B: R;

struct BOut {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn vsBlit(@builtin(vertex_index) vi: u32) -> BOut {
  let xy = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u)) * 2.0 - 1.0;
  var o: BOut;
  o.clip = vec4f(xy, 0.0, 1.0);
  o.uv = vec2f(xy.x, -xy.y) * 0.5 + 0.5;
  return o;
}

@fragment
fn fsBlit(in: BOut) -> @location(0) vec4f {
  let hdr = textureSample(accumTex, accumSamp, in.uv).rgb;
  var c = vec3f(1.0) - exp(-hdr * B.misc.x);
  // deep-space backdrop with a gentle vignette so trails read as glow
  let r = length(in.uv - 0.5);
  let bg = mix(vec3f(0.030, 0.032, 0.052), vec3f(0.008, 0.008, 0.016), smoothstep(0.1, 0.75, r));
  c = bg + c;
  return vec4f(pow(c, vec3f(0.92)), 1.0);
}
`,ze=64,pe=ze*ze*ze,R=ze/4,it=10,at=8,rt=Math.tan(.45),Ue=[{name:"ink",mode:0,swirl:1.1,noiseScale:1.7,buoy:0,centerPull:.06,drag:.5,dyeDecay:.45,speedLimit:2.6,drift:.05,flow:1,lifeMin:3,lifeMax:8,colA:[.05,.16,.55],colB:[.1,.55,.95],colC:[.85,.98,1],colorScale:.85,size:.01,stretch:.055,fade:.86,exposure:.8,glow:.32},{name:"embers",mode:1,swirl:.55,noiseScale:2.3,buoy:3.4,centerPull:0,drag:.85,dyeDecay:.7,speedLimit:2.4,drift:.1,flow:1,lifeMin:1.5,lifeMax:4.5,colA:[.45,.05,.01],colB:[1,.45,.08],colC:[1,.92,.55],colorScale:1,size:.008,stretch:.045,fade:.84,exposure:1,glow:.55},{name:"nebula",mode:2,swirl:.6,noiseScale:1.2,buoy:.15,centerPull:.2,drag:.22,dyeDecay:.3,speedLimit:1.7,drift:.03,flow:1,lifeMin:4,lifeMax:10,colA:[.22,.04,.45],colB:[.75,.15,.65],colC:[.45,.95,.9],colorScale:.55,size:.012,stretch:.09,fade:.9,exposure:.75,glow:.28}];class ot{live=new Map;set(a,e,i,b){const c=this.live.get(a);if(c){const s=1/Math.max(b,.001);for(let n=0;n<3;n++){const M=(e[n]-c.pos[n])*s;c.vel[n]+=(Math.max(-5,Math.min(5,M))-c.vel[n])*.35}c.pos=e.slice(),c.shape=i,c.seen=performance.now()}else this.live.set(a,{pos:e.slice(),vel:[0,0,0],shape:i,seen:performance.now()})}drop(a){this.live.delete(a)}pack(a,e){const i=performance.now();let b=0;for(const[c,s]of this.live){if(i-s.seen>250){this.live.delete(c);continue}if(b>=at)break;const n=e+b*12;a[n]=s.pos[0],a[n+1]=s.pos[1],a[n+2]=s.pos[2],a[n+3]=s.shape.radius,a[n+4]=s.vel[0],a[n+5]=s.vel[1],a[n+6]=s.vel[2],a[n+7]=s.shape.push,a[n+8]=s.shape.attract,a[n+9]=s.shape.emit,a[n+10]=s.shape.spin,a[n+11]=1,b++}return b}get count(){return this.live.size}}async function Ee(f,a={}){const e=await Xe(),i=new Ae(f,a.hero?.52:.66);if(!e)return He(f);const b=1280;i.canvas.width>b&&(i.canvas.height=Math.round(i.canvas.height*(b/i.canvas.width)),i.canvas.width=b);const c=Qe(i.canvas,e),s=navigator.gpu.getPreferredCanvasFormat(),n=new Ke;n.distance=2.9,n.autoSpin=9e-4,n.attach(i.canvas);const M=e.createShaderModule({code:tt}),p=e.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform"}},{binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:"read-only-storage"}},{binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}},{binding:3,visibility:GPUShaderStage.COMPUTE,buffer:{type:"read-only-storage"}},{binding:4,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}},{binding:5,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}},{binding:6,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}},{binding:7,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}}]}),w=e.createPipelineLayout({bindGroupLayouts:[p]}),m=r=>e.createComputePipeline({layout:w,compute:{module:M,entryPoint:r}}),I=m("advect"),A=m("forces"),E=m("divergence"),T=m("jacobi"),t=m("project"),o=m("particles"),y=e.createBuffer({size:464,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),u=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST,v=[e.createBuffer({size:pe*16,usage:u}),e.createBuffer({size:pe*16,usage:u})],z=[e.createBuffer({size:pe*4,usage:u}),e.createBuffer({size:pe*4,usage:u})],S=e.createBuffer({size:pe*4,usage:u}),O=e.createBuffer({size:2*ve.length*2*16,usage:u});let P=a.count??(a.hero?11e4:24e4),B=null,F=null,$=[],j=0;const H=e.createShaderModule({code:nt}),re=e.createBuffer({size:160,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),ge={color:{srcFactor:"one",dstFactor:"one",operation:"add"},alpha:{srcFactor:"one",dstFactor:"one",operation:"add"}},L=e.createRenderPipeline({layout:"auto",vertex:{module:H,entryPoint:"vsParticle"},fragment:{module:H,entryPoint:"fsParticle",targets:[{format:"rgba16float",blend:ge}]},primitive:{topology:"triangle-list"}}),_=e.createRenderPipeline({layout:"auto",vertex:{module:H,entryPoint:"vsLine"},fragment:{module:H,entryPoint:"fsLine",targets:[{format:"rgba16float",blend:ge}]},primitive:{topology:"line-list"}}),q=e.createRenderPipeline({layout:"auto",vertex:{module:H,entryPoint:"vsFade"},fragment:{module:H,entryPoint:"fsFade",targets:[{format:"rgba16float",blend:{color:{srcFactor:"zero",dstFactor:"constant",operation:"add"},alpha:{srcFactor:"zero",dstFactor:"constant",operation:"add"}}}]},primitive:{topology:"triangle-list"}}),ae=e.createRenderPipeline({layout:"auto",vertex:{module:H,entryPoint:"vsBlit"},fragment:{module:H,entryPoint:"fsBlit",targets:[{format:s}]},primitive:{topology:"triangle-list"}}),te=e.createTexture({size:[i.canvas.width,i.canvas.height],format:"rgba16float",usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING}),V=te.createView(),Q=e.createSampler({magFilter:"linear",minFilter:"linear"}),K=e.createBindGroup({layout:ae.getBindGroupLayout(0),entries:[{binding:0,resource:V},{binding:1,resource:Q},{binding:2,resource:{buffer:re}}]}),Y=e.createBindGroup({layout:_.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:re}},{binding:3,resource:{buffer:O}}]});let Fe=null;const Le=()=>{B?.destroy(),F?.destroy(),B=e.createBuffer({size:P*16,usage:u}),F=e.createBuffer({size:P*16,usage:u});const r=new Float32Array(P*4),d=new Float32Array(P*4);for(let h=0;h<P;h++){const C=Math.random()*Math.PI*2,W=Math.acos(Math.random()*2-1),ee=.85*Math.cbrt(Math.random());r[h*4]=Math.sin(W)*Math.cos(C)*ee,r[h*4+1]=Math.sin(W)*Math.sin(C)*ee,r[h*4+2]=Math.cos(W)*ee,r[h*4+3]=Math.random()*6,d[h*4+3]=Math.random()}e.queue.writeBuffer(B,0,r),e.queue.writeBuffer(F,0,d);const G=(h,C)=>e.createBindGroup({layout:p,entries:[{binding:0,resource:{buffer:y}},{binding:1,resource:{buffer:v[h]}},{binding:2,resource:{buffer:v[1-h]}},{binding:3,resource:{buffer:z[C]}},{binding:4,resource:{buffer:z[1-C]}},{binding:5,resource:{buffer:S}},{binding:6,resource:{buffer:B}},{binding:7,resource:{buffer:F}}]});$=[[G(0,0),G(0,1)],[G(1,0),G(1,1)]],Fe=e.createBindGroup({layout:L.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:re}},{binding:1,resource:{buffer:B}},{binding:2,resource:{buffer:F}}]})};Le();let x=Ue[0];const N={colA:[...x.colA],colB:[...x.colB],colC:[...x.colC],exposure:x.exposure,fade:x.fade},ne=new ot;let Me=0,he=!1,me=[1,0,0],xe=[0,0,1],X=[0,1,0];const fe=(r,d,G)=>{const h=n.distance*rt,C=i.canvas.width/i.canvas.height;return[me[0]*r*h*C+xe[0]*d*h-X[0]*G,me[1]*r*h*C+xe[1]*d*h-X[1]*G,me[2]*r*h*C+xe[2]*d*h-X[2]*G]};let ie=1/60;i.canvas.addEventListener("pointerdown",()=>he=!0),i.canvas.addEventListener("pointerup",()=>he=!1),i.canvas.addEventListener("pointercancel",()=>he=!1),i.canvas.addEventListener("pointermove",r=>{if(he)return;const d=i.canvas.getBoundingClientRect(),G=(r.clientX-d.left)/d.width*2-1,h=-((r.clientY-d.top)/d.height*2-1);ne.set("cursor",fe(G,h,0),{radius:.3,push:16,emit:2.2,attract:0,spin:.6},ie),Me=performance.now()}),i.canvas.addEventListener("pointerleave",()=>ne.drop("cursor"));let J=null,de=!1,Z=null;const ue=new Float32Array(2*ve.length*2*4),_e=async()=>{if(de&&J){J.stop(),de=!1,Z&&(Z.textContent="✋ enable hands");return}Z&&(Z.textContent="✋ starting…");try{const{HandTracker:r}=await Je(()=>import("./hands-BijGc3zx.js").then(d=>d.h),[]);J??=new r,await J.start(),de=!0,Z&&(Z.textContent="✋ hands on — click to stop")}catch(r){console.error("hand tracking failed",r),Z&&(Z.textContent="✋ camera blocked")}},ye=(r,d)=>[(r*2-1)*1.25,-(d*2-1)*1.25],We=()=>{let r=0;if(ue.fill(0),!(!de||!J))for(const d of J.hands){const G=d.handedness,[h,C]=ye(d.palm[0],d.palm[1]),W=Math.max(-.5,Math.min(.5,d.palm[2]*2));ne.set(`${G}-palm`,fe(h,C,W),{radius:.34,push:13+d.spread*8,emit:1.6,attract:0,spin:.4},ie);const[ee,Be]=ye(d.lm[8*3],d.lm[8*3+1]);if(ne.set(`${G}-index`,fe(ee,Be,W),{radius:.15,push:20,emit:3.5,attract:0,spin:0},ie),d.pinch>.45){const l=(d.lm[12]+d.lm[24])/2,oe=(d.lm[4*3+1]+d.lm[8*3+1])/2,[se,le]=ye(l,oe),we=(d.pinch-.45)/.55;ne.set(`${G}-pinch`,fe(se,le,W),{radius:.42,push:2,emit:.5,attract:10*we,spin:7*we},ie)}else ne.drop(`${G}-pinch`);Me=performance.now();for(const[l,oe]of ve)for(const se of[l,oe]){const[le,we]=ye(d.lm[se*3],d.lm[se*3+1]),ke=fe(le,we,W);ue[r*4]=ke[0],ue[r*4+1]=ke[1],ue[r*4+2]=ke[2],ue[r*4+3]=.35,r++}}},$e=r=>{if(performance.now()-Me<2500){ne.drop("ghost");return}const d=[.68*Math.sin(r*.63),.68*Math.sin(r*.41+1.3),.55*Math.sin(r*.52+2.6)];ne.set("ghost",d,{radius:.3,push:11,emit:1.2,attract:0,spin:1.2},ie)};let Ge=null,Se=null;const Ie=[],je=r=>{x=r,Se?.()};if(a.hero)i.button("✋ hands",()=>void _e()),Z=i.controls.lastElementChild;else{for(const r of Ue)i.button(r.name,()=>je(r)),Ie.push(i.controls.lastElementChild);Se=()=>{Ue.forEach((r,d)=>{Ie[d].textContent=r===x?`● ${r.name}`:r.name})},Se(),i.slider({label:"particles",min:5e4,max:1e6,step:1e4,value:P,log:!0,format:r=>Math.round(r).toLocaleString(),onInput:r=>{P=Math.round(r),Le()}}),i.slider({label:"trails",min:.5,max:.97,step:.01,value:.88,format:r=>`${Math.round(r*100)}%`,onInput:r=>Ge=r}),i.button("✋ enable hands",()=>void _e()),Z=i.controls.lastElementChild}i.setInfo(()=>{const r=de?` · ${J?.hands.length??0} hand${J?.hands.length===1?"":"s"}`:"";return`${P.toLocaleString()} particles · ${x.name}${r} — wave, pinch, stir`});const k=new Float32Array(464/4),Oe=new Uint32Array(k.buffer),D=new Float32Array(160/4);let be=0,Te=performance.now();return{frame(){i.tick();const r=performance.now();ie=Math.min(Math.max((r-Te)/1e3,1/240),1/30),Te=r,be+=ie;const d=i.canvas.width/i.canvas.height,{viewProj:G,right:h,up:C}=n.matrices(d);me=h,xe=C,X=[C[1]*h[2]-C[2]*h[1],C[2]*h[0]-C[0]*h[2],C[0]*h[1]-C[1]*h[0]],X=[-X[0],-X[1],-X[2]],We(),$e(be),k[0]=ie,k[1]=be,k[2]=x.swirl,k[3]=x.noiseScale,k[4]=x.buoy,k[5]=x.centerPull,k[6]=x.drag,k[7]=x.dyeDecay,k[8]=x.speedLimit,k[9]=x.drift,k[10]=x.lifeMin,k[11]=x.lifeMax,Oe[12]=P,Oe[14]=x.mode,k[15]=x.flow,k[16]=X[0],k[17]=X[1],k[18]=X[2],k[19]=0,Oe[13]=ne.pack(k,20),e.queue.writeBuffer(y,0,k);const W=1-Math.exp(-ie*3);for(let l=0;l<3;l++)N.colA[l]+=(x.colA[l]-N.colA[l])*W,N.colB[l]+=(x.colB[l]-N.colB[l])*W,N.colC[l]+=(x.colC[l]-N.colC[l])*W;N.exposure+=(x.exposure-N.exposure)*W,N.fade+=((Ge??x.fade)-N.fade)*W,D.set(G,0),D.set(h,16),D[19]=x.size,D.set(C,20),D[23]=x.stretch,D.set(N.colA,24),D[27]=x.colorScale,D.set(N.colB,28),D.set(N.colC,32),D[36]=N.exposure,D[37]=d,D[38]=be,D[39]=x.glow*9e3/P,e.queue.writeBuffer(re,0,D),e.queue.writeBuffer(O,0,ue);const ee=e.createCommandEncoder();{const l=ee.beginComputePass(),oe=$[j][0],se=$[j][1];l.setBindGroup(0,oe),l.setPipeline(I),l.dispatchWorkgroups(R,R,R),l.setPipeline(A),l.dispatchWorkgroups(R,R,R),l.setPipeline(E),l.dispatchWorkgroups(R,R,R),l.setPipeline(T);for(let le=0;le<it;le++)l.setBindGroup(0,le%2===0?se:oe),l.dispatchWorkgroups(R,R,R);l.setBindGroup(0,se),l.setPipeline(t),l.dispatchWorkgroups(R,R,R),l.setBindGroup(0,oe),l.setPipeline(o),l.dispatchWorkgroups(Math.ceil(P/256)),l.end()}{const l=ee.beginRenderPass({colorAttachments:[{view:V,loadOp:"load",storeOp:"store"}]});l.setPipeline(q),l.setBlendConstant({r:N.fade,g:N.fade,b:N.fade,a:N.fade}),l.draw(3),l.setPipeline(L),l.setBindGroup(0,Fe),l.draw(6,P),de&&J&&J.hands.length>0&&(l.setPipeline(_),l.setBindGroup(0,Y),l.draw(J.hands.length*ve.length*2)),l.end()}{const l=ee.beginRenderPass({colorAttachments:[{view:c.getCurrentTexture().createView(),clearValue:{r:0,g:0,b:0,a:1},loadOp:"clear",storeOp:"store"}]});l.setPipeline(ae),l.setBindGroup(0,K),l.draw(3),l.end()}e.queue.submit([ee.finish()]);const Be=performance.now();e.queue.onSubmittedWorkDone().then(()=>{window.__gpuMs=performance.now()-Be}),j=1-j},dispose(){J?.stop();for(const r of[...v,...z,S,O,y,re])r.destroy();B?.destroy(),F?.destroy(),te.destroy()}}}const ce=2600;function st(){const f=new Uint8Array(512),a=new Uint8Array(256).map((c,s)=>s);for(let c=255;c>0;c--){const s=Math.floor(Math.random()*(c+1));[a[c],a[s]]=[a[s],a[c]]}f.set(a),f.set(a,256);const e=c=>(c&1?1:-1)*.7,i=c=>c*c*(3-2*c),b=(c,s)=>{const n=Math.floor(c)&255,M=Math.floor(s)&255,p=c-Math.floor(c),w=s-Math.floor(s),m=i(p),I=i(w),A=f[f[n]+M],E=f[f[n+1]+M],T=f[f[n]+M+1],t=f[f[n+1]+M+1],o=(y,u,v)=>y+(u-y)*v;return o(o(e(A)*p+e(A>>1)*w,e(E)*(p-1)+e(E>>1)*w,m),o(e(T)*p+e(T>>1)*(w-1),e(t)*(p-1)+e(t>>1)*(w-1),m),I)};return(c,s,n)=>b(c+n*.18,s+n*.11)+.5*b(c*2.1+13.7-n*.07,s*2.1+5.3)}function lt(f){const a=new Ae(f,.56),e=a.canvas.getContext("2d"),i=a.canvas.width,b=a.canvas.height,c=st();let s=!0,n=2.4,M=0;const p=new Float32Array(ce),w=new Float32Array(ce),m=new Float32Array(ce),I=t=>{p[t]=Math.random(),w[t]=Math.random(),m[t]=2+Math.random()*6};for(let t=0;t<ce;t++)I(t);let A,E;const T=()=>{A.textContent=s?"● curl (swirls)":"curl (swirls)",E.textContent=s?"downhill (sinks)":"● downhill (sinks)"};return a.button("curl",()=>{s=!0,T()}),A=a.controls.lastElementChild,a.button("downhill",()=>{s=!1,T()}),E=a.controls.lastElementChild,T(),a.slider({label:"noise scale",min:1,max:6,step:.1,value:n,onInput:t=>n=t}),a.setInfo(()=>s?`${ce.toLocaleString()} tracers · rotate the gradient 90° and no point gains or loses flow`:`${ce.toLocaleString()} tracers · follow the gradient and everything pools at the peaks`),e.fillStyle="#06070d",e.fillRect(0,0,i,b),{frame(){a.tick(),M+=1/60,e.fillStyle="rgba(6, 7, 13, 0.08)",e.fillRect(0,0,i,b),e.lineWidth=Math.max(1,i/900);const t=.012;for(let o=0;o<ce;o++){const y=p[o],u=w[o],v=(c((y+t)*n,u*n,M)-c((y-t)*n,u*n,M))/(2*t),z=(c(y*n,(u+t)*n,M)-c(y*n,(u-t)*n,M))/(2*t);let S,O;s?(S=z,O=-v):(S=v,O=z);const P=.0035,B=y+S*P,F=u+O*P,$=Math.min(Math.hypot(S,O)*.55,1);e.strokeStyle=`hsla(${205+$*110}, 85%, ${45+$*35}%, 0.55)`,e.beginPath(),e.moveTo(y*i,u*b),e.lineTo(B*i,F*b),e.stroke(),p[o]=B,w[o]=F,m[o]-=1/60;const j=!s&&$<.02;(m[o]<0||j||B<0||B>1||F<0||F>1)&&I(o)}}}}function ct(f){const a=new Ae(f,.62),e=a.canvas.getContext("2d"),i=a.canvas.width,b=a.canvas.height,c=new Ye;let s="idle",n;a.button("📷 start hand tracking",()=>{if(s==="on"){c.stop(),s="idle",n.textContent="📷 start hand tracking";return}s="starting",n.textContent="loading model…",c.start().then(()=>{s="on",n.textContent="stop"}).catch(p=>{console.error("hand tracking failed",p),s="blocked",n.textContent="camera unavailable"})}),n=a.controls.lastElementChild,a.setInfo(()=>{if(s!=="on")return"21 landmarks · 7.7 MB of weights, fetched on demand";const p=c.hands;return p.length===0?"looking for hands…":p.map(w=>`${w.handedness}: pinch ${(w.pinch*100).toFixed(0)}% · spread ${(w.spread*100).toFixed(0)}%`).join(" · ")});const M=[4,8,12,16,20];return{frame(){if(a.tick(),e.fillStyle="#06070d",e.fillRect(0,0,i,b),s!=="on"){e.fillStyle="#5b647f",e.font=`${Math.round(i/38)}px system-ui, sans-serif`,e.textAlign="center",e.fillText(s==="blocked"?"Camera permission was denied — the cursor still works everywhere below.":s==="starting"?"Fetching weights and compiling the WebGPU pipeline…":"Click “start hand tracking”. The video never leaves your machine —",i/2,b/2-10),s==="idle"&&e.fillText("inference runs in this tab, on your GPU.",i/2,b/2+i/30);return}const p=b*(4/3),w=(i-p)/2;e.save(),e.globalAlpha=.5,e.translate(w+p,0),e.scale(-1,1),e.drawImage(c.video,0,0,p,b),e.restore();for(const m of c.hands){const I=v=>[w+m.lm[v*3]*p,m.lm[v*3+1]*b],A=m.handedness==="left"?195:330;e.strokeStyle=`hsla(${A}, 90%, 65%, 0.85)`,e.lineWidth=Math.max(2,i/500),e.beginPath();for(const[v,z]of ve){const[S,O]=I(v),[P,B]=I(z);e.moveTo(S,O),e.lineTo(P,B)}e.stroke();for(let v=0;v<21;v++){const[z,S]=I(v),O=M.includes(v);e.fillStyle=O?`hsl(${A}, 100%, 80%)`:`hsla(${A}, 80%, 60%, 0.9)`,e.beginPath(),e.arc(z,S,O?i/180:i/280,0,Math.PI*2),e.fill()}const[E,T]=I(4),[t,o]=I(8);e.strokeStyle=`hsla(${A}, 100%, 75%, ${.25+m.pinch*.75})`,e.lineWidth=Math.max(2,i/400)*(1+m.pinch*2),e.beginPath(),e.moveTo(E,T),e.lineTo(t,o),e.stroke(),m.pinch>.6&&(e.fillStyle=`hsla(${A}, 100%, 85%, ${m.pinch})`,e.beginPath(),e.arc((E+t)/2,(T+o)/2,i/90*m.pinch,0,Math.PI*2),e.fill());const[y,u]=I(0);e.fillStyle=`hsla(${A}, 70%, 75%, 0.9)`,e.font=`${Math.round(i/50)}px system-ui, sans-serif`,e.textAlign="center",e.fillText(m.handedness,y,u+i/28)}},dispose(){c.stop()}}}const g=22,U=14,dt=16,De=5;function ut(f){const a=new Float32Array(g*U),e=new Float32Array(g*U),i=g*.32,b=U*.55,c=g*.68,s=U*.4;for(let t=0;t<U;t++)for(let o=0;o<g;o++){const y=t*g+o,u=o-i,v=t-b,z=Math.hypot(u,v)+.001,S=Math.exp(-(z*z)/30)*1.4;a[y]+=-v/z*S,e[y]+=u/z*S;const O=o-c,P=t-s,B=Math.hypot(O,P)+.001,F=Math.exp(-(B*B)/14)*1.7;a[y]+=O/B*F,e[y]+=P/B*F}const n=(t,o,y)=>t[Math.min(U-1,Math.max(0,y))*g+Math.min(g-1,Math.max(0,o))],M=new Float32Array(g*U);for(let t=0;t<U;t++)for(let o=0;o<g;o++)M[t*g+o]=(n(a,o+1,t)-n(a,o-1,t)+n(e,o,t+1)-n(e,o,t-1))/2;const p=[];let w=new Float32Array(g*U);p.push(w.slice());for(let t=0;t<dt;t++){for(let o=0;o<De;o++){const y=new Float32Array(g*U);for(let u=0;u<U;u++)for(let v=0;v<g;v++)y[u*g+v]=(n(w,v-1,u)+n(w,v+1,u)+n(w,v,u-1)+n(w,v,u+1)-M[u*g+v])/4;w=y}p.push(w.slice())}const m=p[p.length-1],I=new Float32Array(g*U),A=new Float32Array(g*U);for(let t=0;t<U;t++)for(let o=0;o<g;o++)I[t*g+o]=a[t*g+o]-(n(m,o+1,t)-n(m,o-1,t))/2,A[t*g+o]=e[t*g+o]-(n(m,o,t+1)-n(m,o,t-1))/2;let E=0;for(const t of m)E=Math.max(E,Math.abs(t));let T=0;for(const t of M)T=Math.max(T,Math.abs(t));Ze(f,{screens:4,aspect:.6,steps:[{at:0,text:"A velocity field after stirring: a vortex on the left, and an illegal pile-up on the right where flow pours outward from nothing. Real incompressible fluid forbids that."},{at:.16,text:"Measure the crime: divergence. Red cells create fluid, blue cells swallow it. The vortex barely registers — rotation is legal. The source glows red."},{at:.38,text:"Solve ∇²p = ∇·u for pressure. Here it's Jacobi relaxation: every cell repeatedly averages its neighbours. Scrub slowly — you're watching the pressure field negotiate itself into shape, sweep by sweep."},{at:.68,text:"Subtract the pressure gradient. The outflow collapses, the divergence map goes dark, and what's left is pure swirl — the part of the motion that reads as fluid."}],draw(t,o,y,u){const z=(o-24)/g,S=(y-2*12-16)/U,O=12,P=12,B=Pe(u,0,.1),F=Pe(u,.16,.34),$=Pe(u,.38,.66),j=Pe(u,.68,.92),H=F*(1-j);if(H>.01)for(let L=0;L<U;L++)for(let _=0;_<g;_++){const q=M[L*g+_]/T;Math.abs(q)<.04||(t.fillStyle=q>0?`rgba(255, 110, 110, ${.45*q*H})`:`rgba(100, 150, 255, ${-.45*q*H})`,t.fillRect(O+_*z,P+L*S,z,S))}if($>0){const L=$*(p.length-1),_=Math.floor(L),q=Math.min(p.length-1,_+1),ae=L-_,te=Math.min(1,$*3)*(1-.55*j);for(let Q=0;Q<U;Q++)for(let K=0;K<g;K++){const Y=Ce(p[_][Q*g+K],p[q][Q*g+K],ae)/(E||1);Math.abs(Y)<.05||(t.fillStyle=Y>0?`rgba(255, 184, 107, ${.4*Math.min(1,Y)*te})`:`rgba(125, 214, 160, ${.4*Math.min(1,-Y)*te})`,t.fillRect(O+K*z,P+Q*S,z,S))}const V=Math.round(L*De);Re(t,`jacobi sweeps: ${V}`,o-14,y-10,{color:Ne.muted,size:11,align:"right",mono:!0,alpha:Math.min(1,$*3)*(1-j)})}const re=2;for(let L=0;L<U;L+=1)for(let _=0;_<g;_+=1){if((_+L)%re!==0)continue;const q=L*g+_,ae=Ce(a[q],I[q],j),te=Ce(e[q],A[q],j),V=Math.hypot(ae,te);if(V<.05)continue;const Q=O+(_+.5)*z,K=P+(L+.5)*S,Y=Math.min(z*1.5,V*z*.9);t.globalAlpha=B*Math.min(1,.35+V*.5),et(t,Q-ae/V*Y*.5,K-te/V*Y*.5,Q+ae/V*Y*.5,K+te/V*Y*.5,Ne.dot,1.3,4.5)}t.globalAlpha=1;const ge=j>0?"u ← u − ∇p":$>0?"∇²p = ∇·u":F>0?"measure divergence":"raw velocity field";Re(t,ge,o-14,20,{color:Ne.muted,size:12,align:"right",mono:!0})}})}qe();const ft={"hero-toy":f=>Ee(f,{hero:!0}),flow:lt,hand:ct,playground:f=>Ee(f,{})};for(const f of document.querySelectorAll("[data-demo]")){const a=f.dataset.demo,e=ft[a];e&&Ve(f,()=>e(f))}const pt={projection:ut};for(const f of document.querySelectorAll("[data-scrolly]"))pt[f.dataset.scrolly]?.(f);
