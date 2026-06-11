import{g as H,S as V,a as N,c as j,i as fe,m as he}from"./gpu-DqzAFztT.js";import{R as se}from"./radianceCascades-POh41nn6.js";import{m as ge,P as T,b as D,p as E,l as oe}from"./scrolly-Bq15bFnz.js";const ie=`// Lava rendering, stage one: particles become a continuous emissive surface.
//
// 1. vsSplat/fsSplat — every particle splats a smooth radial kernel into a
//    low-res field texture, accumulating (weight, weight·temperature) with
//    additive blending. Classic metaballs: the sum is a scalar field.
// 2. vsFull/fsScene — thresholds that field into wax (occupancy ~ alpha) and
//    shades it by its local mean temperature: cold wax is nearly black and
//    merely blocks light, hot wax *is* a light. The same pass paints the
//    lamp furniture — coil, base, cap — directly into the scene so the
//    radiance cascades see them as emitters and occluders like any other.
// 3. vsDots/fsDots — debug/teaching view: raw particles coloured by
//    temperature, straight to the canvas, no field, no light transport.

struct RenderParams {
  viewScale: vec2f,  // world [-1,1] → clip multiplier (x already aspect-divided)
  res: vec2f,        // scene texture resolution in pixels
  splatRadius: f32,  // kernel support, world units
  threshold: f32,    // field value where wax begins
  time: f32,
  glow: f32,         // emission intensity multiplier
  wallBottom: f32,
  wallTop: f32,
  floorY: f32,
  topY: f32,
  heaterY: f32,
  dotSize: f32,
  lampOn: f32,       // 1: draw coil/base/cap furniture into the scene
  _pad: f32,
}

struct Particle2 {
  pv: vec4f,
  aux: vec4f,
}

@group(0) @binding(0) var<uniform> RP: RenderParams;
@group(0) @binding(1) var<storage, read> parts: array<Particle2>;

// ---- wax palette ------------------------------------------------------------
// Cold wax: deep maroon, almost black. Warm: crimson → orange → amber-white.
fn waxColor(t: f32) -> vec3f {
  let c0 = vec3f(0.05, 0.005, 0.012); // cold, nearly black plum
  let c1 = vec3f(0.55, 0.04, 0.03);   // crimson
  let c2 = vec3f(1.0, 0.36, 0.05);    // orange
  let c3 = vec3f(1.0, 0.85, 0.45);    // amber-white
  let a = smoothstep(0.05, 0.45, t);
  let b = smoothstep(0.40, 0.75, t);
  let c = smoothstep(0.70, 1.05, t);
  return mix(mix(mix(c0, c1, a), c2, b), c3, c);
}

// How much the wax emits, as a function of temperature: cold wax is an
// occluder with a whisper of colour; hot wax glows hard.
fn waxLuminance(t: f32) -> f32 {
  let g = smoothstep(0.14, 0.95, t);
  return 0.02 + g * g * 1.9;
}

// ---- 1. kernel splat ---------------------------------------------------------

struct SplatOut {
  @builtin(position) pos: vec4f,
  @location(0) local: vec2f,
  @location(1) temp: f32,
}

@vertex
fn vsSplat(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> SplatOut {
  var corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
  );
  let p = parts[ii];
  let corner = corners[vi];
  let world = p.pv.xy + corner * RP.splatRadius;
  var out: SplatOut;
  out.pos = vec4f(world * RP.viewScale, 0.0, 1.0);
  out.local = corner;
  out.temp = p.aux.x;
  return out;
}

@fragment
fn fsSplat(in: SplatOut) -> @location(0) vec4f {
  let q2 = dot(in.local, in.local);
  if (q2 > 1.0) { discard; }
  let w = (1.0 - q2) * (1.0 - q2); // smooth poly kernel
  return vec4f(w, w * in.temp, 0.0, 0.0);
}

// ---- fullscreen triangle ------------------------------------------------------

struct FullOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn vsFull(@builtin(vertex_index) vi: u32) -> FullOut {
  var pts = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var out: FullOut;
  out.pos = vec4f(pts[vi], 0.0, 1.0);
  out.uv = pts[vi] * vec2f(0.5, -0.5) + 0.5;
  return out;
}

// ---- 2. field → scene (emission rgb, occlusion a) -----------------------------

@group(0) @binding(2) var fieldTex: texture_2d<f32>;
@group(0) @binding(3) var linSamp: sampler;

fn vesselHalfWidth(y: f32) -> f32 {
  let t = clamp((y - RP.floorY) / (RP.topY - RP.floorY), 0.0, 1.0);
  return mix(RP.wallBottom, RP.wallTop, t);
}

@fragment
fn fsScene(in: FullOut) -> @location(0) vec4f {
  // uv → clip → world (the splat's mapping, inverted)
  let clip = vec2f(in.uv.x * 2.0 - 1.0, 1.0 - in.uv.y * 2.0);
  let world = clip / RP.viewScale;

  let f = textureSampleLevel(fieldTex, linSamp, in.uv, 0.0);
  var cover = smoothstep(RP.threshold - 0.12, RP.threshold + 0.12, f.x);
  if (RP.lampOn > 0.5) {
    // the splat kernel reaches past particle centres; trim the wax surface
    // at the glass so blobs press against it instead of bulging through
    let hw0 = vesselHalfWidth(world.y);
    cover *= 1.0 - smoothstep(hw0 - 0.002, hw0 + 0.012, abs(world.x));
    cover *= 1.0 - smoothstep(RP.topY + 0.004, RP.topY + 0.024, world.y);
    // and never below the base: the pool ends where the coil begins
    cover *= smoothstep(RP.floorY - 0.055, RP.floorY - 0.035, world.y);
  }
  let t = f.y / max(f.x, 1e-4); // field-weighted mean temperature
  var emission = waxColor(t) * waxLuminance(t) * RP.glow * cover;
  var occ = cover;

  if (RP.lampOn > 0.5) {
    let hw = vesselHalfWidth(world.y);
    let inVessel = step(abs(world.x), hw + 0.02);

    // the coil: a row of glowing bumps tucked against the floor of the wax
    let coilTop = RP.floorY + 0.012;
    let coilBot = RP.floorY - 0.05;
    if (world.y < coilTop && world.y > coilBot && abs(world.x) < RP.wallBottom * 0.92) {
      let bump = 0.6 + 0.4 * cos(world.x * 80.0);
      let flicker = 0.92 + 0.08 * sin(RP.time * 5.0 + world.x * 13.0);
      let edge = smoothstep(coilBot, coilBot + 0.02, world.y) *
                 (1.0 - smoothstep(coilTop - 0.02, coilTop, world.y));
      emission += vec3f(1.0, 0.42, 0.08) * 3.2 * bump * flicker * edge * RP.glow;
      occ = max(occ, edge * 0.9);
    }

    // metal base: a dark occluding trapezoid below the coil
    if (world.y < coilBot) {
      let baseHw = mix(RP.wallBottom * 1.25, RP.wallBottom * 0.85, clamp((coilBot - world.y) * 2.2, 0.0, 1.0));
      if (abs(world.x) < baseHw) {
        emission = vec3f(0.012, 0.008, 0.006);
        occ = 1.0;
      }
    }

    // cap: small dark cone above the throat
    if (world.y > RP.topY) {
      let capHw = mix(RP.wallTop * 1.1, RP.wallTop * 0.35, clamp((world.y - RP.topY) * 4.0, 0.0, 1.0));
      if (abs(world.x) < capHw && world.y < RP.topY + 0.18) {
        emission = vec3f(0.012, 0.008, 0.006);
        occ = 1.0;
      }
    }

    // glass: a faint cool sliver along the tapered walls — emissive only,
    // so it reads as a highlight but never blocks the glow
    let wallD = abs(abs(world.x) - hw);
    let glass = (1.0 - smoothstep(0.0, 0.012, wallD)) * inVessel *
                step(RP.floorY - 0.05, world.y) * step(world.y, RP.topY);
    emission += vec3f(0.10, 0.13, 0.18) * 0.4 * glass;
  }

  return vec4f(emission, occ);
}

// ---- 3. raw particle dots (temperature demo) ----------------------------------

struct DotOut {
  @builtin(position) pos: vec4f,
  @location(0) local: vec2f,
  @location(1) temp: f32,
}

@vertex
fn vsDots(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> DotOut {
  var corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
  );
  let p = parts[ii];
  let corner = corners[vi];
  let world = p.pv.xy + corner * RP.dotSize;
  var out: DotOut;
  out.pos = vec4f(world * RP.viewScale, 0.0, 1.0);
  out.local = corner;
  out.temp = p.aux.x;
  return out;
}

@fragment
fn fsDots(in: DotOut) -> @location(0) vec4f {
  let q2 = dot(in.local, in.local);
  if (q2 > 1.0) { discard; }
  let a = (1.0 - q2);
  // brighter palette than the lamp itself: this view is for *reading*
  // temperature, so even cold particles stay visible
  let col = waxColor(in.temp) * (0.35 + waxLuminance(in.temp)) + vec3f(0.03, 0.02, 0.05);
  return vec4f(col * a, a);
}
`,me=`// Lava-lamp SPH: part three's double-density relaxation, plus one new scalar
// per particle — temperature. Heat enters near the coil at the bottom, leaks
// out everywhere (faster near the top), and diffuses between neighbours in
// the same loop that already sums density. Temperature feeds back into the
// dynamics twice: the rest density falls as a particle warms (thermal
// expansion, so hot wax genuinely takes more room) and a direct buoyancy
// term lifts warm particles, because the water the wax floats in is not
// simulated and somebody has to do its job.
//
// The lamp is not a box: walls are a taper, wide at the base, narrow at the
// throat, enforced with the same penalty springs as everywhere else in the
// series.

struct Particle2 {
  pv: vec4f,  // pos.xy, vel.zw
  aux: vec4f, // x: temperature (0 cold .. ~1 hot), yzw free
}

struct LavaParams {
  count: u32,
  grid: u32,
  cell: f32,
  dt: f32,
  gravity: f32,
  stiffness: f32,
  restDensity: f32,
  nearStiffness: f32,
  xsph: f32,
  wallK: f32,
  beta: f32,       // thermal expansion: rest density scales by (1 - beta*T)
  buoyancy: f32,   // direct lift per unit temperature
  heatRate: f32,
  coolRate: f32,
  diffusion: f32,
  heaterY: f32,    // heat is injected below this height
  mouse: vec2f,
  mouseVel: vec2f,
  mouseRadius: f32,
  mouseStrength: f32,
  wallBottom: f32, // half-width of the vessel at floorY
  wallTop: f32,    // half-width at topY
  floorY: f32,
  topY: f32,
  _pad: vec2f,
}

@group(0) @binding(0) var<uniform> LP: LavaParams;
@group(0) @binding(1) var<storage, read_write> parts: array<Particle2>;
@group(0) @binding(2) var<storage, read> cellStart: array<u32>;
@group(0) @binding(3) var<storage, read> cellCount: array<u32>;
@group(0) @binding(4) var<storage, read_write> density: array<vec4f>; // rho, rhoNear, tFlux, _

fn cellCoord(p: vec2f) -> vec2i {
  let g = f32(LP.grid);
  return vec2i(
    i32(clamp((p.x + 1.0) * 0.5 * g, 0.0, g - 1.0)),
    i32(clamp((p.y + 1.0) * 0.5 * g, 0.0, g - 1.0)),
  );
}

// Vessel half-width at height y: linear taper between base and throat.
fn vesselHalfWidth(y: f32) -> f32 {
  let t = clamp((y - LP.floorY) / (LP.topY - LP.floorY), 0.0, 1.0);
  return mix(LP.wallBottom, LP.wallTop, t);
}

@compute @workgroup_size(256)
fn densityPass(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= LP.count) { return; }
  let pi = parts[i].pv.xy;
  let ti = parts[i].aux.x;
  let h = LP.cell;
  let cc = cellCoord(pi);
  var rho = 0.0;
  var rhoNear = 0.0;
  var tFlux = 0.0; // kernel-weighted sum of (T_j - T_i): heat conduction
  for (var oy = -1; oy <= 1; oy++) {
    for (var ox = -1; ox <= 1; ox++) {
      let c = cc + vec2i(ox, oy);
      if (c.x < 0 || c.y < 0 || c.x >= i32(LP.grid) || c.y >= i32(LP.grid)) { continue; }
      let ci = u32(c.y) * LP.grid + u32(c.x);
      let s = cellStart[ci];
      let n = cellCount[ci];
      for (var k = s; k < s + n; k++) {
        let q = length(parts[k].pv.xy - pi) / h;
        if (q < 1.0) {
          let w = 1.0 - q;
          rho += w * w;
          rhoNear += w * w * w;
          tFlux += (parts[k].aux.x - ti) * w;
        }
      }
    }
  }
  density[i] = vec4f(rho, rhoNear, tFlux, 0.0);
}

@compute @workgroup_size(256)
fn forcePass(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= LP.count) { return; }
  var p = parts[i];
  let h = LP.cell;
  let di = density[i];
  let ti = p.aux.x;

  // thermal expansion: a warm particle is satisfied with fewer neighbours
  let restI = LP.restDensity * (1.0 - LP.beta * ti);
  let pressI = LP.stiffness * (di.x - restI);
  let nearI = LP.nearStiffness * di.y;
  let cc = cellCoord(p.pv.xy);

  var acc = vec2f(0.0, -LP.gravity + LP.buoyancy * ti);
  var dv = vec2f(0.0);
  for (var oy = -1; oy <= 1; oy++) {
    for (var ox = -1; ox <= 1; ox++) {
      let c = cc + vec2i(ox, oy);
      if (c.x < 0 || c.y < 0 || c.x >= i32(LP.grid) || c.y >= i32(LP.grid)) { continue; }
      let ci = u32(c.y) * LP.grid + u32(c.x);
      let s = cellStart[ci];
      let n = cellCount[ci];
      for (var k = s; k < s + n; k++) {
        if (k == i) { continue; }
        let d = parts[k].pv.xy - p.pv.xy;
        let r = length(d);
        let q = r / h;
        if (q < 1.0 && r > 1e-7) {
          let dj = density[k];
          let restJ = LP.restDensity * (1.0 - LP.beta * parts[k].aux.x);
          let press = 0.5 * (pressI + LP.stiffness * (dj.x - restJ));
          let near = 0.5 * (nearI + LP.nearStiffness * dj.y);
          let w = 1.0 - q;
          acc -= (d / r) * (press * w + near * w * w);
          dv += (parts[k].pv.zw - p.pv.zw) * w;
        }
      }
    }
  }

  // stirring: cursor drags nearby wax along its own velocity
  let md = p.pv.xy - LP.mouse;
  let mr = length(md);
  if (mr < LP.mouseRadius) {
    acc += LP.mouseVel * LP.mouseStrength * (1.0 - mr / LP.mouseRadius);
  }

  // tapered vessel: penalty springs against a width that depends on height
  let hw = vesselHalfWidth(p.pv.y);
  if (p.pv.x < -hw) { acc.x += (-hw - p.pv.x) * LP.wallK; }
  if (p.pv.x > hw) { acc.x -= (p.pv.x - hw) * LP.wallK; }
  if (p.pv.y < LP.floorY) { acc.y += (LP.floorY - p.pv.y) * LP.wallK; }
  if (p.pv.y > LP.topY) { acc.y -= (p.pv.y - LP.topY) * LP.wallK; }

  // --- temperature update ---------------------------------------------------
  var t = ti + LP.diffusion * di.z; // conduction between neighbours
  // the coil: heat pours in near the floor, fading with height — and the
  // coil sits under the *middle* of the pool, so the centre warms first and
  // plumes detach there instead of crawling up the glass
  let heatZone = LP.heaterY - LP.floorY;
  if (p.pv.y < LP.heaterY) {
    let f = 1.0 - (p.pv.y - LP.floorY) / max(heatZone, 1e-4);
    let cx = p.pv.x / (LP.wallBottom * 0.45);
    let centre = max(1.0 - cx * cx, 0.0);
    t += LP.heatRate * LP.dt * clamp(f, 0.0, 1.0) * centre;
  }
  // radiative loss: mild everywhere so blobs keep their heat while rising,
  // then a hard chill concentrated in the throat so they stall and sink
  let topF = smoothstep(LP.topY - 0.3, LP.topY, p.pv.y);
  let wallF = smoothstep(hw - 0.08, hw, abs(p.pv.x));
  t -= LP.coolRate * LP.dt * t * (0.45 + 4.0 * topF + 0.5 * wallF);
  t = clamp(t, 0.0, 1.15);

  var vel = (p.pv.zw + acc * LP.dt) * 0.9996;
  // viscosity falls as wax warms: cold wax is sluggish, hot wax is runny
  vel += dv * LP.xsph * (1.0 - 0.3 * clamp(t, 0.0, 1.0));
  let speed = length(vel);
  if (speed > 2.2) { vel *= 2.2 / speed; } // CFL safety valve, gooier than water
  parts[i] = Particle2(vec4f(p.pv.xy + vel * LP.dt, vel), vec4f(t, p.aux.yzw));
}
`,ve=`// Part three's counting sort, widened to a 32-byte particle: position and
// velocity in one vec4, auxiliary state (temperature, …) in a second. The
// scatter copies both, so a particle's heat travels with it through the sort.

struct Particle2 {
  pv: vec4f,  // pos.xy, vel.zw
  aux: vec4f, // temp in x, rest free
}

struct GridParams {
  count: u32,
  grid: u32,
  _pad0: u32,
  _pad1: u32,
}

@group(0) @binding(0) var<uniform> GP: GridParams;
@group(0) @binding(1) var<storage, read> partsIn: array<Particle2>;
@group(0) @binding(2) var<storage, read_write> counts: array<atomic<u32>>;
@group(0) @binding(3) var<storage, read_write> starts: array<u32>;
@group(0) @binding(4) var<storage, read_write> blockSums: array<u32>;
@group(0) @binding(5) var<storage, read_write> cursor: array<atomic<u32>>;
@group(0) @binding(6) var<storage, read_write> sorted: array<Particle2>;

fn cellOf(p: vec2f) -> u32 {
  let g = f32(GP.grid);
  let cx = u32(clamp((p.x + 1.0) * 0.5 * g, 0.0, g - 1.0));
  let cy = u32(clamp((p.y + 1.0) * 0.5 * g, 0.0, g - 1.0));
  return cy * GP.grid + cx;
}

// ---- pass 1: histogram -----------------------------------------------------

@compute @workgroup_size(256)
fn count(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= GP.count) { return; }
  atomicAdd(&counts[cellOf(partsIn[gid.x].pv.xy)], 1u);
}

// ---- pass 2: prefix sum (identical to gridsort.wgsl) -----------------------

var<workgroup> sa: array<u32, 256>;
var<workgroup> sb: array<u32, 256>;

fn scanShared(lid: u32) -> u32 {
  var fromA = true;
  var d = 1u;
  loop {
    if (d >= 256u) { break; }
    if (fromA) {
      var v = sa[lid];
      if (lid >= d) { v += sa[lid - d]; }
      sb[lid] = v;
    } else {
      var v = sb[lid];
      if (lid >= d) { v += sb[lid - d]; }
      sa[lid] = v;
    }
    workgroupBarrier();
    fromA = !fromA;
    d = d << 1u;
  }
  return sa[lid];
}

@compute @workgroup_size(256)
fn scan_blocks(
  @builtin(global_invocation_id) gid: vec3u,
  @builtin(local_invocation_id) lid: vec3u,
  @builtin(workgroup_id) wid: vec3u,
) {
  let v0 = atomicLoad(&counts[gid.x]);
  sa[lid.x] = v0;
  workgroupBarrier();
  let inclusive = scanShared(lid.x);
  starts[gid.x] = inclusive - v0;
  if (lid.x == 255u) { blockSums[wid.x] = inclusive; }
}

@compute @workgroup_size(256)
fn scan_sums(@builtin(local_invocation_id) lid: vec3u) {
  let v0 = blockSums[lid.x];
  sa[lid.x] = v0;
  workgroupBarrier();
  let inclusive = scanShared(lid.x);
  blockSums[lid.x] = inclusive - v0;
}

@compute @workgroup_size(256)
fn scan_add(
  @builtin(global_invocation_id) gid: vec3u,
  @builtin(workgroup_id) wid: vec3u,
) {
  starts[gid.x] = starts[gid.x] + blockSums[wid.x];
}

// ---- pass 3: scatter --------------------------------------------------------

@compute @workgroup_size(256)
fn scatter(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= GP.count) { return; }
  let p = partsIn[gid.x];
  let slot = atomicAdd(&cursor[cellOf(p.pv.xy)], 1u);
  sorted[slot] = p;
}
`,W=256,q=W*W,le=256,$=q/le;class be{counts;starts;dev;params;blockSums;cursor;layout;pipes={};constructor(e){this.dev=e;const t=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC;this.params=e.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.counts=e.createBuffer({size:q*4,usage:t}),this.starts=e.createBuffer({size:q*4,usage:t}),this.blockSums=e.createBuffer({size:$*4,usage:t}),this.cursor=e.createBuffer({size:q*4,usage:t});const a=l=>({type:l});this.layout=e.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:a("uniform")},{binding:1,visibility:GPUShaderStage.COMPUTE,buffer:a("read-only-storage")},{binding:2,visibility:GPUShaderStage.COMPUTE,buffer:a("storage")},{binding:3,visibility:GPUShaderStage.COMPUTE,buffer:a("storage")},{binding:4,visibility:GPUShaderStage.COMPUTE,buffer:a("storage")},{binding:5,visibility:GPUShaderStage.COMPUTE,buffer:a("storage")},{binding:6,visibility:GPUShaderStage.COMPUTE,buffer:a("storage")}]});const s=e.createShaderModule({code:ve}),n=e.createPipelineLayout({bindGroupLayouts:[this.layout]});for(const l of["count","scan_blocks","scan_sums","scan_add","scatter"])this.pipes[l]=e.createComputePipeline({layout:n,compute:{module:s,entryPoint:l}})}bindGroup(e,t){return this.dev.createBindGroup({layout:this.layout,entries:[{binding:0,resource:{buffer:this.params}},{binding:1,resource:{buffer:e}},{binding:2,resource:{buffer:this.counts}},{binding:3,resource:{buffer:this.starts}},{binding:4,resource:{buffer:this.blockSums}},{binding:5,resource:{buffer:this.cursor}},{binding:6,resource:{buffer:t}}]})}writeParams(e){this.dev.queue.writeBuffer(this.params,0,new Uint32Array([e,W,0,0]))}encode(e,t,a){const s=Math.ceil(a/le);e.clearBuffer(this.counts);let n=e.beginComputePass();n.setBindGroup(0,t),n.setPipeline(this.pipes.count),n.dispatchWorkgroups(s),n.setPipeline(this.pipes.scan_blocks),n.dispatchWorkgroups($),n.setPipeline(this.pipes.scan_sums),n.dispatchWorkgroups(1),n.setPipeline(this.pipes.scan_add),n.dispatchWorkgroups($),n.end(),e.copyBufferToBuffer(this.starts,0,this.cursor,0,q*4),n=e.beginComputePass(),n.setBindGroup(0,t),n.setPipeline(this.pipes.scatter),n.dispatchWorkgroups(s),n.end()}dispose(){for(const e of[this.params,this.counts,this.starts,this.blockSums,this.cursor])e.destroy()}}const we=256,A=2/W,w={floorY:-.62,topY:.66,wallBottom:.4,wallTop:.26,heaterY:-.56},ce={gravity:3,stiffness:60,restDensity:2.4,nearStiffness:260,xsph:.15,beta:.3,buoyancy:5.2,heatRate:1.1,coolRate:.8,diffusion:.015};function ye(d){const e=Math.min(Math.max((d-w.floorY)/(w.topY-w.floorY),0),1);return w.wallBottom+(w.wallTop-w.wallBottom)*e}function Pe(d){const e=A*.5,t=new Float32Array(d*8);let a=0;for(let s=0;a<d&&s<4e3;s++){const n=w.floorY+e*(s+.7),l=ye(n)-e,v=Math.max(Math.floor(l*2/e),1);for(let u=0;u<v&&a<d;u++,a++)t[a*8]=-l+e*(u+.5)+(Math.random()-.5)*e*.4,t[a*8+1]=n+(Math.random()-.5)*e*.4}return t}class ue{count;params;dev;sort;layout;densityPipe;forcePipe;bufs=[null,null];density=null;sortGroups=[null,null];simGroups=[null,null];cur=0;constructor(e,t){this.dev=e,this.count=t,this.sort=new be(e),this.params=e.createBuffer({size:112,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});const a=l=>({type:l});this.layout=e.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:a("uniform")},{binding:1,visibility:GPUShaderStage.COMPUTE,buffer:a("storage")},{binding:2,visibility:GPUShaderStage.COMPUTE,buffer:a("read-only-storage")},{binding:3,visibility:GPUShaderStage.COMPUTE,buffer:a("read-only-storage")},{binding:4,visibility:GPUShaderStage.COMPUTE,buffer:a("storage")}]});const s=e.createShaderModule({code:me}),n=e.createPipelineLayout({bindGroupLayouts:[this.layout]});this.densityPipe=e.createComputePipeline({layout:n,compute:{module:s,entryPoint:"densityPass"}}),this.forcePipe=e.createComputePipeline({layout:n,compute:{module:s,entryPoint:"forcePass"}}),this.rebuild(t)}rebuild(e){this.count=e;for(const s of this.bufs)s?.destroy();this.density?.destroy();const t=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC;this.bufs=[this.dev.createBuffer({size:e*32,usage:t}),this.dev.createBuffer({size:e*32,usage:t})],this.density=this.dev.createBuffer({size:e*16,usage:GPUBufferUsage.STORAGE}),this.dev.queue.writeBuffer(this.bufs[0],0,Pe(e)),this.sortGroups=[this.sort.bindGroup(this.bufs[0],this.bufs[1]),this.sort.bindGroup(this.bufs[1],this.bufs[0])];const a=s=>this.dev.createBindGroup({layout:this.layout,entries:[{binding:0,resource:{buffer:this.params}},{binding:1,resource:{buffer:s}},{binding:2,resource:{buffer:this.sort.starts}},{binding:3,resource:{buffer:this.sort.counts}},{binding:4,resource:{buffer:this.density}}]});this.simGroups=[a(this.bufs[1]),a(this.bufs[0])],this.cur=0}writeParams(e,t,a,s){const n=new DataView(new ArrayBuffer(112));n.setUint32(0,this.count,!0),n.setUint32(4,W,!0),n.setFloat32(8,A,!0),n.setFloat32(12,t,!0),n.setFloat32(16,e.gravity,!0),n.setFloat32(20,e.stiffness,!0),n.setFloat32(24,e.restDensity,!0),n.setFloat32(28,e.nearStiffness,!0),n.setFloat32(32,e.xsph,!0),n.setFloat32(36,2e3,!0),n.setFloat32(40,e.beta,!0),n.setFloat32(44,e.buoyancy,!0),n.setFloat32(48,e.heatRate,!0),n.setFloat32(52,e.coolRate,!0),n.setFloat32(56,e.diffusion,!0),n.setFloat32(60,w.heaterY,!0),n.setFloat32(64,a[0],!0),n.setFloat32(68,a[1],!0),n.setFloat32(72,s[0],!0),n.setFloat32(76,s[1],!0),n.setFloat32(80,.16,!0),n.setFloat32(84,30,!0),n.setFloat32(88,w.wallBottom,!0),n.setFloat32(92,w.wallTop,!0),n.setFloat32(96,w.floorY,!0),n.setFloat32(100,w.topY,!0),this.dev.queue.writeBuffer(this.params,0,n.buffer)}encodeSteps(e,t){this.sort.writeParams(this.count);const a=Math.ceil(this.count/we);for(let s=0;s<t;s++){this.sort.encode(e,this.sortGroups[this.cur],this.count);const n=e.beginComputePass();n.setBindGroup(0,this.simGroups[this.cur]),n.setPipeline(this.densityPipe),n.dispatchWorkgroups(a),n.setPipeline(this.forcePipe),n.dispatchWorkgroups(a),n.end(),this.cur=1-this.cur}}get current(){return this.bufs[this.cur]}get buffers(){return this.bufs}get currentIndex(){return this.cur}dispose(){this.sort.dispose();for(const e of this.bufs)e?.destroy();this.density?.destroy(),this.params.destroy()}}const re=["final","scene (what the rays see)","occupancy","distance field","light only"];async function ae(d,e){const t=await H(),a=new V(d,e.hero?.52:.66);if(!t)return N(d);const s=j(a.canvas,t),n=a.canvas.width,l=a.canvas.height,v=n/l,u=1.12,p=[u/v,u],g=new se(t,Math.floor(n/2),Math.floor(l/2)),f={...ce};let R=e.hero?9e3:1e4,C=4,x=1,k=1.35,c=0,m=0;const o=new ue(t,R),r=t.createShaderModule({code:ie}),i=t.createTexture({size:[g.width,g.height],format:"rgba16float",usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING}),S=i.createView(),y=t.createSampler({magFilter:"linear",minFilter:"linear"}),P=t.createBuffer({size:64,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),M=t.createRenderPipeline({layout:"auto",vertex:{module:r,entryPoint:"vsSplat"},fragment:{module:r,entryPoint:"fsSplat",targets:[{format:"rgba16float",blend:{color:{srcFactor:"one",dstFactor:"one",operation:"add"},alpha:{srcFactor:"one",dstFactor:"one",operation:"add"}}}]},primitive:{topology:"triangle-list"}}),F=t.createRenderPipeline({layout:"auto",vertex:{module:r,entryPoint:"vsFull"},fragment:{module:r,entryPoint:"fsScene",targets:[{format:"rgba16float"}]},primitive:{topology:"triangle-list"}});let U=[null,null];const O=()=>{U=o.buffers.map(b=>t.createBindGroup({layout:M.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:P}},{binding:1,resource:{buffer:b}}]}))},_=t.createBindGroup({layout:F.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:P}},{binding:2,resource:S},{binding:3,resource:y}]}),B=()=>{const b=new Float32Array([p[0],p[1],g.width,g.height,A*5.2,.8,m,x,w.wallBottom,w.wallTop,w.floorY,w.topY,w.heaterY,A*.7,1,0]);t.queue.writeBuffer(P,0,b)};let L=[99,99],G=[0,0],Y=0;if(a.canvas.addEventListener("pointermove",b=>{const h=a.canvas.getBoundingClientRect(),de=(b.clientX-h.left)/h.width*2-1,pe=-((b.clientY-h.top)/h.height*2-1),K=de/p[0],X=pe/p[1],J=performance.now(),Z=Math.min((J-Y)/1e3,.1)||.016;if(Y=J,L[0]<90){const Q=(K-L[0])/Z,ee=(X-L[1])/Z,te=Math.hypot(Q,ee),ne=te>4?4/te:1;G=[G[0]*.6+Q*ne*.4,G[1]*.6+ee*ne*.4]}L=[K,X]}),a.canvas.addEventListener("pointerleave",()=>{L=[99,99],G=[0,0]}),e.full){a.slider({label:"coil heat",min:.5,max:6,step:.1,value:f.heatRate,onInput:h=>f.heatRate=h}),a.slider({label:"buoyancy",min:3,max:9,step:.1,value:f.buoyancy,onInput:h=>f.buoyancy=h}),a.slider({label:"gooiness (XSPH)",min:0,max:.3,step:.01,value:f.xsph,onInput:h=>f.xsph=h}),a.slider({label:"glow",min:.3,max:2.5,step:.05,value:x,onInput:h=>x=h}),a.button("view: final",function(){c=(c+1)%re.length});const b=a.controls.querySelectorAll("button")[0];b?.addEventListener("click",()=>b.textContent=`view: ${re[c]}`),a.button("re-melt",()=>{o.rebuild(R),O()})}a.setInfo(()=>e.hero?`${R.toLocaleString()} wax particles · ${g.cascadeCount} radiance cascades · stir with your cursor`:`${R.toLocaleString()} particles · ${g.cascadeCount} cascades over a ${g.width}×${g.height} field · stir with your cursor`);{o.writeParams(f,.0016,L,G);for(let b=0;b<6;b++){const h=t.createCommandEncoder();o.encodeSteps(h,250),t.queue.submit([h.finish()])}}return O(),{frame(){a.tick(),m+=1/60,o.writeParams(f,.0016,L,G),B();const b=t.createCommandEncoder();o.encodeSteps(b,C);let h=b.beginRenderPass({colorAttachments:[{view:S,clearValue:{r:0,g:0,b:0,a:0},loadOp:"clear",storeOp:"store"}]});h.setPipeline(M),h.setBindGroup(0,U[o.currentIndex]),h.draw(6,o.count),h.end(),h=b.beginRenderPass({colorAttachments:[{view:g.sceneView,clearValue:{r:0,g:0,b:0,a:0},loadOp:"clear",storeOp:"store"}]}),h.setPipeline(F),h.setBindGroup(0,_),h.draw(3),h.end(),g.encodeGI(b),g.encodeComposite(b,s.getCurrentTexture().createView(),{exposure:k,debugMode:c,emitBoost:.55}),t.queue.submit([b.finish()])},dispose(){o.dispose(),g.dispose(),i.destroy(),P.destroy()}}}async function xe(d){const e=await H(),t=new V(d,.62);if(!e)return N(d);const a=j(t.canvas,e),s=t.canvas.width/t.canvas.height,n=1.12,l=[n/s,n],v={...ce},u=12e3,p=new ue(e,u),g=e.createShaderModule({code:ie}),f=e.createBuffer({size:64,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),R=e.createRenderPipeline({layout:"auto",vertex:{module:g,entryPoint:"vsDots"},fragment:{module:g,entryPoint:"fsDots",targets:[{format:navigator.gpu.getPreferredCanvasFormat(),blend:{color:{srcFactor:"one",dstFactor:"one-minus-src-alpha",operation:"add"},alpha:{srcFactor:"one",dstFactor:"one-minus-src-alpha",operation:"add"}}}]},primitive:{topology:"triangle-list"}}),C=()=>{const r=new Float32Array([l[0],l[1],t.canvas.width,t.canvas.height,A*2.6,.85,0,1,w.wallBottom,w.wallTop,w.floorY,w.topY,w.heaterY,A*.75,0,0]);e.queue.writeBuffer(f,0,r)};let x=[99,99],k=[0,0],c=0;t.canvas.addEventListener("pointermove",r=>{const i=t.canvas.getBoundingClientRect(),S=(r.clientX-i.left)/i.width*2-1,y=-((r.clientY-i.top)/i.height*2-1),P=S/l[0],M=y/l[1],F=performance.now(),U=Math.min((F-c)/1e3,.1)||.016;if(c=F,x[0]<90){const O=(P-x[0])/U,_=(M-x[1])/U,B=Math.hypot(O,_),L=B>4?4/B:1;k=[k[0]*.6+O*L*.4,k[1]*.6+_*L*.4]}x=[P,M]}),t.canvas.addEventListener("pointerleave",()=>{x=[99,99],k=[0,0]}),t.slider({label:"coil heat",min:0,max:6,step:.1,value:v.heatRate,onInput:r=>v.heatRate=r}),t.slider({label:"buoyancy",min:0,max:10,step:.1,value:v.buoyancy,onInput:r=>v.buoyancy=r}),t.slider({label:"thermal expansion β",min:0,max:.6,step:.01,value:v.beta,onInput:r=>v.beta=r}),t.slider({label:"cooling",min:.05,max:1.5,step:.05,value:v.coolRate,onInput:r=>v.coolRate=r});let m=[null,null];const o=()=>{m=p.buffers.map(r=>e.createBindGroup({layout:R.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:f}},{binding:1,resource:{buffer:r}}]}))};return o(),t.button("re-melt",()=>{p.rebuild(u),o()}),t.setInfo(()=>`${u.toLocaleString()} particles · colour = temperature · stir with your cursor`),{frame(){t.tick(),p.writeParams(v,.0016,x,k),C();const r=e.createCommandEncoder();p.encodeSteps(r,4);const i=r.beginRenderPass({colorAttachments:[{view:a.getCurrentTexture().createView(),clearValue:{r:.024,g:.027,b:.043,a:1},loadOp:"clear",storeOp:"store"}]});i.setPipeline(R),i.setBindGroup(0,m[p.currentIndex]),i.draw(6,p.count),i.end(),e.queue.submit([r.finish()])},dispose(){p.dispose(),f.destroy()}}}const z=[{name:"ember",rgb:[3.4,1.3,.25]},{name:"cyan",rgb:[.5,2.6,3.2]},{name:"violet",rgb:[2.6,.7,3.4]},{name:"white",rgb:[3,2.9,2.7]}];async function Se(d){const e=await H(),t=new V(d,.62);if(!e)return N(d);const a=j(t.canvas,e),s=new se(e,Math.floor(t.canvas.width/2),Math.floor(t.canvas.height/2));let n="light",l=0,v=s.cascadeCount,u=0;const p=[];{const o=s.width/2,r=s.height/2;p.push({x:o-s.width*.27,y:r+s.height*.18,radius:10,color:z[0].rgb,occlusion:1},{x:o+s.width*.3,y:r-s.height*.22,radius:8,color:z[1].rgb,occlusion:1});for(let i=0;i<14;i++)p.push({x:o-s.width*.06+i*3,y:r-s.height*.05+i*1.4,radius:5,color:[0,0,0],occlusion:1})}let g=!1,f=null;const R=o=>{const r=t.canvas.getBoundingClientRect();return[(o.clientX-r.left)/r.width*s.width,(o.clientY-r.top)/r.height*s.height]},C=(o,r)=>{const i=n==="erase"?16:n==="wall"?5:9;p.push({x:o,y:r,radius:i,color:n==="light"?z[l].rgb:[0,0,0],occlusion:1,erase:n==="erase",hardness:n==="wall"?.7:.25})};t.canvas.addEventListener("pointerdown",o=>{g=!0,t.canvas.setPointerCapture(o.pointerId);const r=R(o);C(r[0],r[1]),f=r}),t.canvas.addEventListener("pointermove",o=>{if(!g)return;const r=R(o);if(f){const i=Math.hypot(r[0]-f[0],r[1]-f[1]),S=Math.min(Math.ceil(i/3),24);for(let y=1;y<=S;y++)C(f[0]+(r[0]-f[0])*y/S,f[1]+(r[1]-f[1])*y/S)}f=r});const x=()=>{g=!1,f=null};t.canvas.addEventListener("pointerup",x),t.canvas.addEventListener("pointerleave",x);const k={},c=o=>{n=o;for(const[r,i]of Object.entries(k))i.style.borderColor=r===o?"var(--accent)":"var(--border)"},m=(o,r)=>{t.button(r,()=>c(o)),k[o]=t.controls.querySelectorAll("button")[t.controls.querySelectorAll("button").length-1]};return m("light","✦ paint light"),m("wall","▪ paint wall"),m("erase","◌ erase"),t.button(`color: ${z[0].name}`,function(){l=(l+1)%z.length;const o=t.controls.querySelectorAll("button");o[3].textContent=`color: ${z[l].name}`,c("light")}),t.slider({label:"cascades",min:1,max:s.cascadeCount,step:1,value:v,format:o=>`${o} of ${s.cascadeCount}`,onInput:o=>v=Math.round(o)}),t.button("view: final",()=>{u=u===0?3:0;const o=t.controls.querySelectorAll("button");o[4].textContent=u===0?"view: final":"view: distance field"}),t.button("clear",()=>{const o=e.createCommandEncoder();s.clearScene(o),e.queue.submit([o.finish()])}),c("light"),t.setInfo(()=>`${s.cascadeCount} cascades over ${s.width}×${s.height} · draw with your cursor`),{frame(){t.tick();const o=e.createCommandEncoder(),r=Math.min(p.length,60);for(let i=0;i<r;i++)s.brush(o,p[i]);p.splice(0,r),s.encodeGI(o,v),s.encodeComposite(o,a.getCurrentTexture().createView(),{exposure:1.5,emitBoost:.7,debugMode:u}),e.queue.submit([o.finish()])},dispose(){s.dispose()}}}const I=[{rays:8,r0:0,r1:.08},{rays:16,r0:.08,r1:.26},{rays:32,r0:.26,r1:.78}];function Le(d){ge(d,{screens:4.5,aspect:.6,steps:[{at:0,text:"One probe (blue), one hot blob (orange), one cold blob (dark). The probe wants the light arriving from every direction — without marching hundreds of full-length rays."},{at:.08,text:"Cascade 0: a handful of short rays. Near the probe, light changes fast from place to place but barely with direction — so sample space densely (every probe has these) and direction coarsely."},{at:.3,text:"Cascade 1: twice the directions, covering the next annulus. Each ray starts where cascade 0 gave up. Rays that hit the cold blob stop — that's a shadow being born."},{at:.52,text:"Cascade 2: more directions still, reaching across the scene. Far light needs angular precision and almost no spatial — these probes are sparse, so the total cost per level stays constant."},{at:.78,text:"The merge: each ray that hit nothing inherits the radiance of matching directions one level out. Light flows inward through the hierarchy, and the probe ends up knowing the whole scene — shadows included."}],draw(e,t,a,s){const n=t*.36,l=a*.52,v=Math.min(t*.62,a*1.04),u={x:t*.78,y:a*.26,r:Math.min(t,a)*.07},p={x:t*.62,y:a*.66,r:Math.min(t,a)*.085},g=E(s,0,.06),f=E(s,.78,.97);for(let c=0;c<I.length;c++){const m=I[c],o=E(s,.08+c*.22,.08+c*.22+.06);o<=0||(e.save(),e.globalAlpha=.16*o,e.strokeStyle=T.accent,e.setLineDash([4,6]),e.lineWidth=1,e.beginPath(),e.arc(n,l,m.r1*v,0,Math.PI*2),e.stroke(),e.restore())}e.save(),e.globalAlpha=g;const R=e.createRadialGradient(u.x,u.y,0,u.x,u.y,u.r*1.8);R.addColorStop(0,"rgba(255, 200, 120, 0.9)"),R.addColorStop(1,"rgba(255, 200, 120, 0)"),e.fillStyle=R,e.beginPath(),e.arc(u.x,u.y,u.r*1.8,0,Math.PI*2),e.fill(),e.fillStyle="#ffd9a0",e.beginPath(),e.arc(u.x,u.y,u.r,0,Math.PI*2),e.fill(),e.fillStyle="#1c2030",e.strokeStyle="#343b52",e.lineWidth=1.5,e.beginPath(),e.arc(p.x,p.y,p.r,0,Math.PI*2),e.fill(),e.stroke(),e.restore(),D(e,"hot wax (emits)",u.x,u.y-u.r-12,{color:T.warm,size:11,align:"center",alpha:g}),D(e,"cold wax (blocks)",p.x,p.y+p.r+14,{color:T.muted,size:11,align:"center",alpha:g});const C=(c,m,o)=>{const r=o.x-n,i=o.y-l,S=r*c+i*m,y=S*S-(r*r+i*i)+o.r*o.r;if(y<0||S<0)return 1/0;const P=S-Math.sqrt(y);return P>0?P:1/0};for(let c=0;c<I.length;c++){const m=I[c],o=E(s,.08+c*.22,.08+c*.22+.18);if(o<=0)continue;for(let i=0;i<m.rays;i++){const S=(i+.5)/m.rays*Math.PI*2,y=Math.cos(S),P=Math.sin(S),M=m.r0*v,F=m.r1*v,U=C(y,P,u),O=C(y,P,p),_=Math.min(U,O);if(_<M)continue;let B=oe(M,F,o),L="miss";_<B&&(B=_,L=_===U?"light":"block");let G=.4,Y=T.dim;if(L==="light"?(Y=T.warm,G=.85):L==="block"&&(Y="#444c66",G=.5),f>0&&L==="miss"){const b=E(f,(I.length-1-c)*.25,(I.length-1-c)*.25+.5);U<1/0&&U<C(y,P,p)&&b>0&&(Y=T.warm,G=oe(.4,.75,b))}e.save(),e.globalAlpha=G,e.strokeStyle=Y,e.lineWidth=c===0?2:1.3,e.beginPath(),e.moveTo(n+y*M,l+P*M),e.lineTo(n+y*B,l+P*B),e.stroke(),L!=="miss"&&B>=_-.5&&(e.fillStyle=Y,e.globalAlpha=Math.min(1,G+.2),e.beginPath(),e.arc(n+y*B,l+P*B,2.2,0,Math.PI*2),e.fill()),e.restore()}const r=(m.r0+m.r1)/2*v;D(e,`cascade ${c}: ${m.rays} rays`,Math.max(8,n-r*.6),l-r*.78-6,{color:T.accent,size:10,mono:!0,alpha:o*.9})}const x=f;if(x>0){const c=e.createRadialGradient(n,l,0,n,l,26);c.addColorStop(0,`rgba(255, 205, 140, ${.55*x})`),c.addColorStop(1,"rgba(255, 205, 140, 0)"),e.fillStyle=c,e.beginPath(),e.arc(n,l,26,0,Math.PI*2),e.fill()}e.fillStyle=T.accent,e.beginPath(),e.arc(n,l,5,0,Math.PI*2),e.fill(),e.strokeStyle="#fff",e.lineWidth=1,e.stroke(),D(e,"probe",n,l+18,{color:T.accent,size:11,align:"center",alpha:g});const k=I.filter((c,m)=>E(s,.08+m*.22,.08+m*.22+.18)>0).length;k>0&&D(e,`levels: ${k} · cost per level: constant`,t-14,20,{color:T.muted,size:11,align:"right",mono:!0})}})}fe();const Re={"hero-lamp":d=>ae(d,{hero:!0}),temp:xe,paint:Se,lamp:d=>ae(d,{full:!0})};for(const d of document.querySelectorAll("[data-demo]")){const e=d.dataset.demo,t=Re[e];t&&he(d,()=>t(d))}const ke={"cascade-rays":Le};for(const d of document.querySelectorAll("[data-scrolly]"))ke[d.dataset.scrolly]?.(d);
