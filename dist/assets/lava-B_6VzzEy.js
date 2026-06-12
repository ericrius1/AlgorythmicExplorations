import{i as ue}from"./siteNav-RZaw0VT9.js";import{S as z,g as H,m as de}from"./demoShell-Btkj803W.js";import{g as $,c as V}from"./gpu-DBowy6aD.js";import{G as pe,a as oe}from"./gridSort2-zMjTnh0y.js";import{R as ae}from"./radianceCascades-siyOW2Rq.js";import{m as fe,P as T,l as _,p as E,b as ee}from"./scrolly-CD69uhsv.js";const re=`// Lava rendering, stage one: particles become a continuous emissive surface.
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
  var cover = smoothstep(RP.threshold - 0.09, RP.threshold + 0.07, f.x);
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
`,he=`// Lava-lamp SPH: part three's double-density relaxation, plus one new scalar
// per particle — temperature. Heat enters near the coil at the bottom, leaks
// out everywhere (faster near the top), and diffuses between neighbours in
// the same loop that already sums density. Temperature feeds back into the
// dynamics twice: the rest density falls as a particle warms (thermal
// expansion, so hot wax genuinely takes more room) and a direct buoyancy
// term lifts warm particles, because the water the wax floats in is not
// simulated and somebody has to do its job. A pairwise cohesion force
// (Akinci-style spline) plays the part of surface tension: the wax–water
// interface costs energy, so blobs round off and necks pinch.
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
  tension: f32,    // surface tension: pairwise cohesion strength
  _pad: f32,
}

@group(0) @binding(0) var<uniform> LP: LavaParams;
@group(0) @binding(1) var<storage, read_write> parts: array<Particle2>;
@group(0) @binding(2) var<storage, read> cellStart: array<u32>;
@group(0) @binding(3) var<storage, read> cellCount: array<u32>;
@group(0) @binding(4) var<storage, read_write> density: array<vec4f>; // rho, rhoNear, tFlux, _

// Cohesion kernel (Akinci, Akinci & Teschner 2013), normalized so the
// attractive peak at q = 0.5 is exactly 1 and the core bottoms out at -1.
// Pressure only objects to crowding; this is what makes the wax *want* to
// stay in one piece — the particle-level stand-in for the wax–water
// interface costing energy.
fn cohesionW(q: f32) -> f32 {
  let a = (1.0 - q) * (1.0 - q) * (1.0 - q) * q * q * q;
  if (q < 0.5) { return 64.0 * (2.0 * a - 0.015625); }
  return 64.0 * a;
}

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
          // surface tension: mid-range attraction rounds blobs and pinches
          // necks; the repulsive core keeps it from fighting near-pressure
          acc += (d / r) * (LP.tension * cohesionW(q));
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
    let cx = p.pv.x / (LP.wallBottom * 0.35);
    let centre = max(1.0 - cx * cx, 0.0);
    t += LP.heatRate * LP.dt * clamp(f, 0.0, 1.0) * centre;
  }
  // radiative loss: almost nothing mid-flight so blobs ride the full height,
  // then a hard chill concentrated in the throat so they stall and sink
  let topF = smoothstep(LP.topY - 0.28, LP.topY, p.pv.y);
  let wallF = smoothstep(hw - 0.08, hw, abs(p.pv.x));
  t -= LP.coolRate * LP.dt * t * (0.35 + 5.0 * topF + 0.4 * wallF);
  t = clamp(t, 0.0, 1.15);

  var vel = (p.pv.zw + acc * LP.dt) * 0.9996;
  // viscosity falls as wax warms: cold wax is sluggish, hot wax is runny
  vel += dv * LP.xsph * (1.0 - 0.3 * clamp(t, 0.0, 1.0));
  let speed = length(vel);
  if (speed > 2.2) { vel *= 2.2 / speed; } // CFL safety valve, gooier than water
  parts[i] = Particle2(vec4f(p.pv.xy + vel * LP.dt, vel), vec4f(t, p.aux.yzw));
}
`,me=256,D=2/oe,y={floorY:-.62,topY:.66,wallBottom:.4,wallTop:.26,heaterY:-.56},se={gravity:3,stiffness:80,restDensity:2.4,nearStiffness:260,xsph:.22,beta:.2,buoyancy:5,heatRate:1.5,coolRate:1.1,diffusion:.02,tension:2};function ge(p){const e=Math.min(Math.max((p-y.floorY)/(y.topY-y.floorY),0),1);return y.wallBottom+(y.wallTop-y.wallBottom)*e}function ve(p){const e=D*.5,t=new Float32Array(p*8);let r=0;for(let s=0;r<p&&s<4e3;s++){const n=y.floorY+e*(s+.7),u=ge(n)-e,v=Math.max(Math.floor(u*2/e),1);for(let c=0;c<v&&r<p;c++,r++)t[r*8]=-u+e*(c+.5)+(Math.random()-.5)*e*.4,t[r*8+1]=n+(Math.random()-.5)*e*.4}return t}class ie{count;params;dev;sort;layout;densityPipe;forcePipe;bufs=[null,null];density=null;sortGroups=[null,null];simGroups=[null,null];cur=0;constructor(e,t){this.dev=e,this.count=t,this.sort=new pe(e),this.params=e.createBuffer({size:112,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});const r=u=>({type:u});this.layout=e.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:r("uniform")},{binding:1,visibility:GPUShaderStage.COMPUTE,buffer:r("storage")},{binding:2,visibility:GPUShaderStage.COMPUTE,buffer:r("read-only-storage")},{binding:3,visibility:GPUShaderStage.COMPUTE,buffer:r("read-only-storage")},{binding:4,visibility:GPUShaderStage.COMPUTE,buffer:r("storage")}]});const s=e.createShaderModule({code:he}),n=e.createPipelineLayout({bindGroupLayouts:[this.layout]});this.densityPipe=e.createComputePipeline({layout:n,compute:{module:s,entryPoint:"densityPass"}}),this.forcePipe=e.createComputePipeline({layout:n,compute:{module:s,entryPoint:"forcePass"}}),this.rebuild(t)}rebuild(e){this.count=e;for(const s of this.bufs)s?.destroy();this.density?.destroy();const t=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC;this.bufs=[this.dev.createBuffer({size:e*32,usage:t}),this.dev.createBuffer({size:e*32,usage:t})],this.density=this.dev.createBuffer({size:e*16,usage:GPUBufferUsage.STORAGE}),this.dev.queue.writeBuffer(this.bufs[0],0,ve(e)),this.sortGroups=[this.sort.bindGroup(this.bufs[0],this.bufs[1]),this.sort.bindGroup(this.bufs[1],this.bufs[0])];const r=s=>this.dev.createBindGroup({layout:this.layout,entries:[{binding:0,resource:{buffer:this.params}},{binding:1,resource:{buffer:s}},{binding:2,resource:{buffer:this.sort.starts}},{binding:3,resource:{buffer:this.sort.counts}},{binding:4,resource:{buffer:this.density}}]});this.simGroups=[r(this.bufs[1]),r(this.bufs[0])],this.cur=0}writeParams(e,t,r,s){const n=new DataView(new ArrayBuffer(112));n.setUint32(0,this.count,!0),n.setUint32(4,oe,!0),n.setFloat32(8,D,!0),n.setFloat32(12,t,!0),n.setFloat32(16,e.gravity,!0),n.setFloat32(20,e.stiffness,!0),n.setFloat32(24,e.restDensity,!0),n.setFloat32(28,e.nearStiffness,!0),n.setFloat32(32,e.xsph,!0),n.setFloat32(36,2e3,!0),n.setFloat32(40,e.beta,!0),n.setFloat32(44,e.buoyancy,!0),n.setFloat32(48,e.heatRate,!0),n.setFloat32(52,e.coolRate,!0),n.setFloat32(56,e.diffusion,!0),n.setFloat32(60,y.heaterY,!0),n.setFloat32(64,r[0],!0),n.setFloat32(68,r[1],!0),n.setFloat32(72,s[0],!0),n.setFloat32(76,s[1],!0),n.setFloat32(80,.16,!0),n.setFloat32(84,30,!0),n.setFloat32(88,y.wallBottom,!0),n.setFloat32(92,y.wallTop,!0),n.setFloat32(96,y.floorY,!0),n.setFloat32(100,y.topY,!0),n.setFloat32(104,e.tension,!0),this.dev.queue.writeBuffer(this.params,0,n.buffer)}encodeSteps(e,t){this.sort.writeParams(this.count);const r=Math.ceil(this.count/me);for(let s=0;s<t;s++){this.sort.encode(e,this.sortGroups[this.cur],this.count);const n=e.beginComputePass();n.setBindGroup(0,this.simGroups[this.cur]),n.setPipeline(this.densityPipe),n.dispatchWorkgroups(r),n.setPipeline(this.forcePipe),n.dispatchWorkgroups(r),n.end(),this.cur=1-this.cur}}get current(){return this.bufs[this.cur]}get buffers(){return this.bufs}get currentIndex(){return this.cur}dispose(){this.sort.dispose();for(const e of this.bufs)e?.destroy();this.density?.destroy(),this.params.destroy()}}const te=["final","scene (what the rays see)","occupancy","distance field","light only"];async function ne(p,e){const t=await $(),r=new z(p,e.hero?.52:.66);if(!t)return H(p);const s=V(r.canvas,t),n=r.canvas.width,u=r.canvas.height,v=n/u,c=1.12,f=[c/v,c],m=new ae(t,Math.floor(n/2),Math.floor(u/2)),d={...se};let R=e.hero?9e3:1e4,F=4,x=1,k=1.35,l=0,g=0;const o=new ie(t,R),a=t.createShaderModule({code:re}),i=t.createTexture({size:[m.width,m.height],format:"rgba16float",usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING}),S=i.createView(),b=t.createSampler({magFilter:"linear",minFilter:"linear"}),P=t.createBuffer({size:64,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),Y=t.createRenderPipeline({layout:"auto",vertex:{module:a,entryPoint:"vsSplat"},fragment:{module:a,entryPoint:"fsSplat",targets:[{format:"rgba16float",blend:{color:{srcFactor:"one",dstFactor:"one",operation:"add"},alpha:{srcFactor:"one",dstFactor:"one",operation:"add"}}}]},primitive:{topology:"triangle-list"}}),U=t.createRenderPipeline({layout:"auto",vertex:{module:a,entryPoint:"vsFull"},fragment:{module:a,entryPoint:"fsScene",targets:[{format:"rgba16float"}]},primitive:{topology:"triangle-list"}});let M=[null,null];const O=()=>{M=o.buffers.map(w=>t.createBindGroup({layout:Y.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:P}},{binding:1,resource:{buffer:w}}]}))},G=t.createBindGroup({layout:U.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:P}},{binding:2,resource:S},{binding:3,resource:b}]}),B=()=>{const w=new Float32Array([f[0],f[1],m.width,m.height,D*6.2,1.1,g,x,y.wallBottom,y.wallTop,y.floorY,y.topY,y.heaterY,D*.7,1,0]);t.queue.writeBuffer(P,0,w)};let L=[99,99],C=[0,0],I=0;if(r.canvas.addEventListener("pointermove",w=>{const h=r.canvas.getBoundingClientRect(),le=(w.clientX-h.left)/h.width*2-1,ce=-((w.clientY-h.top)/h.height*2-1),W=le/f[0],N=ce/f[1],j=performance.now(),K=Math.min((j-I)/1e3,.1)||.016;if(I=j,L[0]<90){const X=(W-L[0])/K,J=(N-L[1])/K,Z=Math.hypot(X,J),Q=Z>4?4/Z:1;C=[C[0]*.6+X*Q*.4,C[1]*.6+J*Q*.4]}L=[W,N]}),r.canvas.addEventListener("pointerleave",()=>{L=[99,99],C=[0,0]}),e.full){r.slider({label:"coil heat",min:.5,max:6,step:.1,value:d.heatRate,onInput:h=>d.heatRate=h}),r.slider({label:"buoyancy",min:3,max:9,step:.1,value:d.buoyancy,onInput:h=>d.buoyancy=h}),r.slider({label:"surface tension",min:0,max:8,step:.1,value:d.tension,onInput:h=>d.tension=h}),r.slider({label:"gooiness (XSPH)",min:0,max:.3,step:.01,value:d.xsph,onInput:h=>d.xsph=h}),r.slider({label:"glow",min:.3,max:2.5,step:.05,value:x,onInput:h=>x=h}),r.button("view: final",function(){l=(l+1)%te.length});const w=r.controls.querySelectorAll("button")[0];w?.addEventListener("click",()=>w.textContent=`view: ${te[l]}`),r.button("re-melt",()=>{o.rebuild(R),O()})}r.setInfo(()=>e.hero?`${R.toLocaleString()} wax particles · ${m.cascadeCount} radiance cascades · stir with your cursor`:`${R.toLocaleString()} particles · ${m.cascadeCount} cascades over a ${m.width}×${m.height} field · stir with your cursor`);{o.writeParams(d,.0016,L,C);for(let w=0;w<6;w++){const h=t.createCommandEncoder();o.encodeSteps(h,250),t.queue.submit([h.finish()])}}return O(),{frame(){r.tick(),g+=1/60,o.writeParams(d,.0016,L,C),B();const w=t.createCommandEncoder();o.encodeSteps(w,F);let h=w.beginRenderPass({colorAttachments:[{view:S,clearValue:{r:0,g:0,b:0,a:0},loadOp:"clear",storeOp:"store"}]});h.setPipeline(Y),h.setBindGroup(0,M[o.currentIndex]),h.draw(6,o.count),h.end(),h=w.beginRenderPass({colorAttachments:[{view:m.sceneView,clearValue:{r:0,g:0,b:0,a:0},loadOp:"clear",storeOp:"store"}]}),h.setPipeline(U),h.setBindGroup(0,G),h.draw(3),h.end(),m.encodeGI(w),m.encodeComposite(w,s.getCurrentTexture().createView(),{exposure:k,debugMode:l,emitBoost:.55}),t.queue.submit([w.finish()])},dispose(){o.dispose(),m.dispose(),i.destroy(),P.destroy()}}}async function we(p){const e=await $(),t=new z(p,.62);if(!e)return H(p);const r=V(t.canvas,e),s=t.canvas.width/t.canvas.height,n=1.12,u=[n/s,n],v={...se},c=12e3,f=new ie(e,c),m=e.createShaderModule({code:re}),d=e.createBuffer({size:64,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),R=e.createRenderPipeline({layout:"auto",vertex:{module:m,entryPoint:"vsDots"},fragment:{module:m,entryPoint:"fsDots",targets:[{format:navigator.gpu.getPreferredCanvasFormat(),blend:{color:{srcFactor:"one",dstFactor:"one-minus-src-alpha",operation:"add"},alpha:{srcFactor:"one",dstFactor:"one-minus-src-alpha",operation:"add"}}}]},primitive:{topology:"triangle-list"}}),F=()=>{const a=new Float32Array([u[0],u[1],t.canvas.width,t.canvas.height,D*2.6,.85,0,1,y.wallBottom,y.wallTop,y.floorY,y.topY,y.heaterY,D*.75,0,0]);e.queue.writeBuffer(d,0,a)};let x=[99,99],k=[0,0],l=0;t.canvas.addEventListener("pointermove",a=>{const i=t.canvas.getBoundingClientRect(),S=(a.clientX-i.left)/i.width*2-1,b=-((a.clientY-i.top)/i.height*2-1),P=S/u[0],Y=b/u[1],U=performance.now(),M=Math.min((U-l)/1e3,.1)||.016;if(l=U,x[0]<90){const O=(P-x[0])/M,G=(Y-x[1])/M,B=Math.hypot(O,G),L=B>4?4/B:1;k=[k[0]*.6+O*L*.4,k[1]*.6+G*L*.4]}x=[P,Y]}),t.canvas.addEventListener("pointerleave",()=>{x=[99,99],k=[0,0]}),t.slider({label:"coil heat",min:0,max:6,step:.1,value:v.heatRate,onInput:a=>v.heatRate=a}),t.slider({label:"buoyancy",min:0,max:10,step:.1,value:v.buoyancy,onInput:a=>v.buoyancy=a}),t.slider({label:"thermal expansion β",min:0,max:.6,step:.01,value:v.beta,onInput:a=>v.beta=a}),t.slider({label:"cooling",min:.05,max:1.5,step:.05,value:v.coolRate,onInput:a=>v.coolRate=a});let g=[null,null];const o=()=>{g=f.buffers.map(a=>e.createBindGroup({layout:R.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:d}},{binding:1,resource:{buffer:a}}]}))};return o(),t.button("re-melt",()=>{f.rebuild(c),o()}),t.setInfo(()=>`${c.toLocaleString()} particles · colour = temperature · stir with your cursor`),{frame(){t.tick(),f.writeParams(v,.0016,x,k),F();const a=e.createCommandEncoder();f.encodeSteps(a,4);const i=a.beginRenderPass({colorAttachments:[{view:r.getCurrentTexture().createView(),clearValue:{r:.024,g:.027,b:.043,a:1},loadOp:"clear",storeOp:"store"}]});i.setPipeline(R),i.setBindGroup(0,g[f.currentIndex]),i.draw(6,f.count),i.end(),e.queue.submit([a.finish()])},dispose(){f.dispose(),d.destroy()}}}const A=[{name:"ember",rgb:[3.4,1.3,.25]},{name:"cyan",rgb:[.5,2.6,3.2]},{name:"violet",rgb:[2.6,.7,3.4]},{name:"white",rgb:[3,2.9,2.7]}];async function ye(p){const e=await $(),t=new z(p,.62);if(!e)return H(p);const r=V(t.canvas,e),s=new ae(e,Math.floor(t.canvas.width/2),Math.floor(t.canvas.height/2));let n="light",u=0,v=s.cascadeCount,c=0;const f=[];{const o=s.width/2,a=s.height/2;f.push({x:o-s.width*.27,y:a+s.height*.18,radius:10,color:A[0].rgb,occlusion:1},{x:o+s.width*.3,y:a-s.height*.22,radius:8,color:A[1].rgb,occlusion:1});for(let i=0;i<14;i++)f.push({x:o-s.width*.06+i*3,y:a-s.height*.05+i*1.4,radius:5,color:[0,0,0],occlusion:1})}let m=!1,d=null;const R=o=>{const a=t.canvas.getBoundingClientRect();return[(o.clientX-a.left)/a.width*s.width,(o.clientY-a.top)/a.height*s.height]},F=(o,a)=>{const i=n==="erase"?16:n==="wall"?5:9;f.push({x:o,y:a,radius:i,color:n==="light"?A[u].rgb:[0,0,0],occlusion:1,erase:n==="erase",hardness:n==="wall"?.7:.25})};t.canvas.addEventListener("pointerdown",o=>{m=!0,t.canvas.setPointerCapture(o.pointerId);const a=R(o);F(a[0],a[1]),d=a}),t.canvas.addEventListener("pointermove",o=>{if(!m)return;const a=R(o);if(d){const i=Math.hypot(a[0]-d[0],a[1]-d[1]),S=Math.min(Math.ceil(i/3),24);for(let b=1;b<=S;b++)F(d[0]+(a[0]-d[0])*b/S,d[1]+(a[1]-d[1])*b/S)}d=a});const x=()=>{m=!1,d=null};t.canvas.addEventListener("pointerup",x),t.canvas.addEventListener("pointerleave",x);const k={},l=o=>{n=o;for(const[a,i]of Object.entries(k))i.style.borderColor=a===o?"var(--accent)":"var(--border)"},g=(o,a)=>{t.button(a,()=>l(o)),k[o]=t.controls.querySelectorAll("button")[t.controls.querySelectorAll("button").length-1]};return g("light","✦ paint light"),g("wall","▪ paint wall"),g("erase","◌ erase"),t.button(`color: ${A[0].name}`,function(){u=(u+1)%A.length;const o=t.controls.querySelectorAll("button");o[3].textContent=`color: ${A[u].name}`,l("light")}),t.slider({label:"cascades",min:1,max:s.cascadeCount,step:1,value:v,format:o=>`${o} of ${s.cascadeCount}`,onInput:o=>v=Math.round(o)}),t.button("view: final",()=>{c=c===0?3:0;const o=t.controls.querySelectorAll("button");o[4].textContent=c===0?"view: final":"view: distance field"}),t.button("clear",()=>{const o=e.createCommandEncoder();s.clearScene(o),e.queue.submit([o.finish()])}),l("light"),t.setInfo(()=>`${s.cascadeCount} cascades over ${s.width}×${s.height} · draw with your cursor`),{frame(){t.tick();const o=e.createCommandEncoder(),a=Math.min(f.length,60);for(let i=0;i<a;i++)s.brush(o,f[i]);f.splice(0,a),s.encodeGI(o,v),s.encodeComposite(o,r.getCurrentTexture().createView(),{exposure:1.5,emitBoost:.7,debugMode:c}),e.queue.submit([o.finish()])},dispose(){s.dispose()}}}const q=[{rays:8,r0:0,r1:.08},{rays:16,r0:.08,r1:.26},{rays:32,r0:.26,r1:.78}];function be(p){fe(p,{screens:4.5,aspect:.6,steps:[{at:0,text:"One probe (blue), one hot blob (orange), one cold blob (dark). The probe wants the light arriving from every direction — without marching hundreds of full-length rays."},{at:.08,text:"Cascade 0: a handful of short rays. Near the probe, light changes fast from place to place but barely with direction — so sample space densely (every probe has these) and direction coarsely."},{at:.3,text:"Cascade 1: twice the directions, covering the next annulus. Each ray starts where cascade 0 gave up. Rays that hit the cold blob stop — that's a shadow being born."},{at:.52,text:"Cascade 2: more directions still, reaching across the scene. Far light needs angular precision and almost no spatial — these probes are sparse, so the total cost per level stays constant."},{at:.78,text:"The merge: each ray that hit nothing inherits the radiance of matching directions one level out. Light flows inward through the hierarchy, and the probe ends up knowing the whole scene — shadows included."}],draw(e,t,r,s){const n=t*.36,u=r*.52,v=Math.min(t*.62,r*1.04),c={x:t*.78,y:r*.26,r:Math.min(t,r)*.07},f={x:t*.62,y:r*.66,r:Math.min(t,r)*.085},m=E(s,0,.06),d=E(s,.78,.97);for(let l=0;l<q.length;l++){const g=q[l],o=E(s,.08+l*.22,.08+l*.22+.06);o<=0||(e.save(),e.globalAlpha=.16*o,e.strokeStyle=T.accent,e.setLineDash([4,6]),e.lineWidth=1,e.beginPath(),e.arc(n,u,g.r1*v,0,Math.PI*2),e.stroke(),e.restore())}e.save(),e.globalAlpha=m;const R=e.createRadialGradient(c.x,c.y,0,c.x,c.y,c.r*1.8);R.addColorStop(0,"rgba(255, 200, 120, 0.9)"),R.addColorStop(1,"rgba(255, 200, 120, 0)"),e.fillStyle=R,e.beginPath(),e.arc(c.x,c.y,c.r*1.8,0,Math.PI*2),e.fill(),e.fillStyle="#ffd9a0",e.beginPath(),e.arc(c.x,c.y,c.r,0,Math.PI*2),e.fill(),e.fillStyle="#1c2030",e.strokeStyle="#343b52",e.lineWidth=1.5,e.beginPath(),e.arc(f.x,f.y,f.r,0,Math.PI*2),e.fill(),e.stroke(),e.restore(),_(e,"hot wax (emits)",c.x,c.y-c.r-12,{color:T.warm,size:11,align:"center",alpha:m}),_(e,"cold wax (blocks)",f.x,f.y+f.r+14,{color:T.muted,size:11,align:"center",alpha:m});const F=(l,g,o)=>{const a=o.x-n,i=o.y-u,S=a*l+i*g,b=S*S-(a*a+i*i)+o.r*o.r;if(b<0||S<0)return 1/0;const P=S-Math.sqrt(b);return P>0?P:1/0};for(let l=0;l<q.length;l++){const g=q[l],o=E(s,.08+l*.22,.08+l*.22+.18);if(o<=0)continue;for(let i=0;i<g.rays;i++){const S=(i+.5)/g.rays*Math.PI*2,b=Math.cos(S),P=Math.sin(S),Y=g.r0*v,U=g.r1*v,M=F(b,P,c),O=F(b,P,f),G=Math.min(M,O);if(G<Y)continue;let B=ee(Y,U,o),L="miss";G<B&&(B=G,L=G===M?"light":"block");let C=.4,I=T.dim;if(L==="light"?(I=T.warm,C=.85):L==="block"&&(I="#444c66",C=.5),d>0&&L==="miss"){const w=E(d,(q.length-1-l)*.25,(q.length-1-l)*.25+.5);M<1/0&&M<F(b,P,f)&&w>0&&(I=T.warm,C=ee(.4,.75,w))}e.save(),e.globalAlpha=C,e.strokeStyle=I,e.lineWidth=l===0?2:1.3,e.beginPath(),e.moveTo(n+b*Y,u+P*Y),e.lineTo(n+b*B,u+P*B),e.stroke(),L!=="miss"&&B>=G-.5&&(e.fillStyle=I,e.globalAlpha=Math.min(1,C+.2),e.beginPath(),e.arc(n+b*B,u+P*B,2.2,0,Math.PI*2),e.fill()),e.restore()}const a=(g.r0+g.r1)/2*v;_(e,`cascade ${l}: ${g.rays} rays`,Math.max(8,n-a*.6),u-a*.78-6,{color:T.accent,size:10,mono:!0,alpha:o*.9})}const x=d;if(x>0){const l=e.createRadialGradient(n,u,0,n,u,26);l.addColorStop(0,`rgba(255, 205, 140, ${.55*x})`),l.addColorStop(1,"rgba(255, 205, 140, 0)"),e.fillStyle=l,e.beginPath(),e.arc(n,u,26,0,Math.PI*2),e.fill()}e.fillStyle=T.accent,e.beginPath(),e.arc(n,u,5,0,Math.PI*2),e.fill(),e.strokeStyle="#fff",e.lineWidth=1,e.stroke(),_(e,"probe",n,u+18,{color:T.accent,size:11,align:"center",alpha:m});const k=q.filter((l,g)=>E(s,.08+g*.22,.08+g*.22+.18)>0).length;k>0&&_(e,`levels: ${k} · cost per level: constant`,t-14,20,{color:T.muted,size:11,align:"right",mono:!0})}})}ue();const Pe={"hero-lamp":p=>ne(p,{hero:!0}),temp:we,paint:ye,lamp:p=>ne(p,{full:!0})};for(const p of document.querySelectorAll("[data-demo]")){const e=p.dataset.demo,t=Pe[e];t&&de(p,()=>t(p))}const xe={"cascade-rays":be};for(const p of document.querySelectorAll("[data-scrolly]"))xe[p.dataset.scrolly]?.(p);
