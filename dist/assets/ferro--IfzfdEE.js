import{i as ne}from"./siteNav-B-J0B7W8.js";import{S as re,g as ie,m as se}from"./demoShell-Btkj803W.js";import{g as ae,c as oe}from"./gpu-DBowy6aD.js";import{G as le,a as V}from"./gridSort2-zMjTnh0y.js";const ce=`// Ferrofluid rendering: the metaball field again — but this time the field's
// geometry is *extracted*, not just thresholded.
//
// 1. vsSplat/fsSplat — particles splat radial bumps into a field texture
//    (the lava lamp's trick, one channel).
// 2. msCells/msIndirect — marching squares, on the GPU, every frame: each
//    16-cell case becomes 0–2 line segments, appended to a buffer with an
//    atomic counter; a one-thread pass converts the count into indirect-draw
//    arguments so the CPU never learns it.
// 3. vsSegs/fsSegs — the extracted segments, drawn as thin instanced quads.
// 4. vsFull/fsFill — the fluid body: threshold fill shaded by the field's
//    gradient (a pseudo height-field normal), so the liquid reads as glossy
//    ink rather than a flat silhouette. Also the field debug view.
// 5. vsDots/fsDots — raw particles, for the teaching view.

struct RenderParams {
  viewScale: vec2f, // world [-1,1] → clip multiplier
  res: vec2f,       // field texture resolution
  splatRadius: f32, // world units
  threshold: f32,   // field value where the fluid surface lives
  lineWidth: f32,   // mesh line half-width, field pixels
  time: f32,
  mag: vec2f,       // magnet position, world units
  magOn: f32,
  view: f32,        // 0 final · 1 mesh only · 2 field · 3 dots
  dotSize: f32,
  maxSegs: f32,
  _pad: vec2f,
}

struct Particle2 {
  pv: vec4f,
  aux: vec4f,
}

@group(0) @binding(0) var<uniform> RP: RenderParams;
@group(0) @binding(1) var<storage, read> parts: array<Particle2>;
@group(0) @binding(2) var fieldTex: texture_2d<f32>;
@group(0) @binding(3) var linSamp: sampler;
@group(0) @binding(4) var<storage, read_write> segs: array<vec4f>;
@group(0) @binding(5) var<storage, read_write> segCount: atomic<u32>;
@group(0) @binding(6) var<storage, read_write> indirectArgs: array<u32, 4>;
@group(0) @binding(7) var<storage, read> segsR: array<vec4f>; // same buffer, vertex-stage view

// ---- 1. kernel splat ---------------------------------------------------------

struct SplatOut {
  @builtin(position) pos: vec4f,
  @location(0) local: vec2f,
}

@vertex
fn vsSplat(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> SplatOut {
  var corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
  );
  let corner = corners[vi];
  let world = parts[ii].pv.xy + corner * RP.splatRadius;
  var out: SplatOut;
  out.pos = vec4f(world * RP.viewScale, 0.0, 1.0);
  out.local = corner;
  return out;
}

@fragment
fn fsSplat(in: SplatOut) -> @location(0) vec4f {
  let q2 = dot(in.local, in.local);
  if (q2 > 1.0) { discard; }
  let w = (1.0 - q2) * (1.0 - q2);
  return vec4f(w, 0.0, 0.0, 0.0);
}

// ---- 2. marching squares -------------------------------------------------------

fn fieldAt(c: vec2i) -> f32 {
  return textureLoad(fieldTex, c, 0).x;
}

// crossing point on the edge a→b, in texel coordinates
fn cross2(pa: vec2f, pb: vec2f, fa: f32, fb: f32) -> vec2f {
  let t = clamp((RP.threshold - fa) / (fb - fa + 1e-9), 0.0, 1.0);
  return mix(pa, pb, t);
}

fn emit(a: vec2f, b: vec2f) {
  let idx = atomicAdd(&segCount, 1u);
  if (idx < u32(RP.maxSegs)) {
    // store as uv so the renderer is resolution-agnostic
    segs[idx] = vec4f((a + 0.5) / RP.res, (b + 0.5) / RP.res);
  }
}

@compute @workgroup_size(8, 8)
fn msCells(@builtin(global_invocation_id) gid: vec3u) {
  let W = u32(RP.res.x);
  let H = u32(RP.res.y);
  if (gid.x >= W - 1u || gid.y >= H - 1u) { return; }
  let x = i32(gid.x);
  let y = i32(gid.y);
  let f00 = fieldAt(vec2i(x, y));
  let f10 = fieldAt(vec2i(x + 1, y));
  let f11 = fieldAt(vec2i(x + 1, y + 1));
  let f01 = fieldAt(vec2i(x, y + 1));
  let T = RP.threshold;
  var c = 0u;
  if (f00 > T) { c |= 1u; }
  if (f10 > T) { c |= 2u; }
  if (f11 > T) { c |= 4u; }
  if (f01 > T) { c |= 8u; }
  if (c == 0u || c == 15u) { return; }

  let p00 = vec2f(f32(x), f32(y));
  let p10 = vec2f(f32(x + 1), f32(y));
  let p11 = vec2f(f32(x + 1), f32(y + 1));
  let p01 = vec2f(f32(x), f32(y + 1));
  // edge crossings: e0 bottom, e1 right, e2 top, e3 left
  let e0 = cross2(p00, p10, f00, f10);
  let e1 = cross2(p10, p11, f10, f11);
  let e2 = cross2(p01, p11, f01, f11);
  let e3 = cross2(p00, p01, f00, f01);

  switch (c) {
    case 1u: { emit(e3, e0); }
    case 2u: { emit(e0, e1); }
    case 3u: { emit(e3, e1); }
    case 4u: { emit(e1, e2); }
    case 5u: { // saddle: bottom-left and top-right inside
      let inside = (f00 + f10 + f01 + f11) * 0.25 > T;
      if (inside) { emit(e0, e1); emit(e2, e3); }
      else { emit(e0, e3); emit(e1, e2); }
    }
    case 6u: { emit(e0, e2); }
    case 7u: { emit(e3, e2); }
    case 8u: { emit(e2, e3); }
    case 9u: { emit(e0, e2); }
    case 10u: { // saddle: bottom-right and top-left inside
      let inside = (f00 + f10 + f01 + f11) * 0.25 > T;
      if (inside) { emit(e0, e3); emit(e1, e2); }
      else { emit(e0, e1); emit(e2, e3); }
    }
    case 11u: { emit(e1, e2); }
    case 12u: { emit(e3, e1); }
    case 13u: { emit(e0, e1); }
    case 14u: { emit(e3, e0); }
    default: {}
  }
}

@compute @workgroup_size(1)
fn msIndirect() {
  let n = min(atomicLoad(&segCount), u32(RP.maxSegs));
  indirectArgs[0] = 6u; // vertices per segment quad
  indirectArgs[1] = n;  // instances = segments
  indirectArgs[2] = 0u;
  indirectArgs[3] = 0u;
}

// ---- 3. extracted segments as instanced quads ----------------------------------

struct SegOut {
  @builtin(position) pos: vec4f,
  @location(0) v: f32,
}

@vertex
fn vsSegs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> SegOut {
  var ends = array<f32, 6>(0.0, 1.0, 0.0, 0.0, 1.0, 1.0);
  var sides = array<f32, 6>(-1.0, -1.0, 1.0, 1.0, -1.0, 1.0);
  let seg = segsR[ii];
  let apx = seg.xy * RP.res;
  let bpx = seg.zw * RP.res;
  var d = bpx - apx;
  let len = length(d);
  if (len < 1e-6) { d = vec2f(1.0, 0.0); } else { d = d / len; }
  let n = vec2f(-d.y, d.x);
  let endK = ends[vi];
  let px = mix(apx, bpx, endK) + (n * sides[vi] + d * (endK * 2.0 - 1.0)) * RP.lineWidth;
  let uv = px / RP.res;
  var out: SegOut;
  out.pos = vec4f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, 0.0, 1.0);
  out.v = sides[vi];
  return out;
}

@fragment
fn fsSegs(in: SegOut) -> @location(0) vec4f {
  let a = 1.0 - abs(in.v);
  let col = vec3f(0.55, 0.92, 1.0);
  return vec4f(col * a * 0.95, a * 0.95);
}

// ---- fullscreen triangle -------------------------------------------------------

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

// ---- 4. fluid body --------------------------------------------------------------

@fragment
fn fsFill(in: FullOut) -> @location(0) vec4f {
  let bg = vec3f(0.016, 0.018, 0.030);
  let f = textureSampleLevel(fieldTex, linSamp, in.uv, 0.0).x;

  if (RP.view > 1.5) { // field debug view
    let v = clamp(f * 0.55, 0.0, 1.0);
    let band = smoothstep(0.0, 0.015, abs(f - RP.threshold));
    var col = vec3f(v * 0.85, v * 0.9, v);
    col = mix(vec3f(1.0, 0.55, 0.15), col, band); // highlight the threshold contour
    return vec4f(col, 1.0);
  }

  let cover = smoothstep(RP.threshold - 0.07, RP.threshold + 0.05, f);

  // pseudo height-field shading from the field gradient: dense interior =
  // tall, surface = slope, so the liquid picks up a sheen like glossy ink
  let px = 1.0 / RP.res;
  let fx = textureSampleLevel(fieldTex, linSamp, in.uv + vec2f(px.x, 0.0), 0.0).x -
           textureSampleLevel(fieldTex, linSamp, in.uv - vec2f(px.x, 0.0), 0.0).x;
  let fy = textureSampleLevel(fieldTex, linSamp, in.uv + vec2f(0.0, px.y), 0.0).x -
           textureSampleLevel(fieldTex, linSamp, in.uv - vec2f(0.0, px.y), 0.0).x;
  // confine the gloss to the surface band — deep interior is matte black,
  // so splat noise inside the body doesn't read as texture
  let band = 1.0 - smoothstep(RP.threshold, RP.threshold + 0.75, f);
  let n3 = normalize(vec3f(-fx * 9.0 * band, fy * 9.0 * band, 1.0)); // uv y runs down; flip to world-up
  let l = normalize(vec3f(-0.4, 0.75, 0.52));
  let hvec = normalize(l + vec3f(0.0, 0.0, 1.0));
  let spec = pow(max(dot(n3, hvec), 0.0), 28.0);
  let grazing = pow(1.0 - max(n3.z, 0.0), 2.0);

  let body = vec3f(0.020, 0.024, 0.034)            // ferrofluid: very nearly black
           + vec3f(0.10, 0.13, 0.20) * grazing     // cool rim where the surface turns
           + vec3f(0.85, 0.92, 1.0) * spec * 0.45; // gloss

  var col = mix(bg, body, cover);

  // magnet glyph: a small warm ring, drawn in world space
  if (RP.magOn > 0.5) {
    let clip = vec2f(in.uv.x * 2.0 - 1.0, 1.0 - in.uv.y * 2.0);
    let world = clip / RP.viewScale;
    let dm = length(world - RP.mag);
    let ring = smoothstep(0.012, 0.0, abs(dm - 0.045)) * 0.9
             + smoothstep(0.02, 0.0, dm) * 0.6;
    col += vec3f(1.0, 0.62, 0.25) * ring;
  }
  return vec4f(col, 1.0);
}

// ---- 5. raw particle dots --------------------------------------------------------

struct DotOut {
  @builtin(position) pos: vec4f,
  @location(0) local: vec2f,
  @location(1) speed: f32,
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
  out.speed = length(p.pv.zw);
  return out;
}

@fragment
fn fsDots(in: DotOut) -> @location(0) vec4f {
  let q2 = dot(in.local, in.local);
  if (q2 > 1.0) { discard; }
  let a = 1.0 - q2;
  let s = clamp(in.speed * 0.9, 0.0, 1.0);
  let col = mix(vec3f(0.18, 0.24, 0.42), vec3f(0.95, 0.65, 0.35), s);
  return vec4f(col * a, a);
}
`,ue=`// Ferrofluid SPH: the lava lamp's double-density relaxation core, with the
// thermodynamics removed and two forces promoted to stars of the show —
// surface tension (Akinci-style cohesion, the same kernel the lamp uses) and
// a magnet. The magnet force is the gradient of a dipole field's energy
// density, F ∝ ∇|B|²: it pulls fluid toward the magnet, hardest along the
// dipole axis, and sideways *toward* the axis — which is what piles the
// fluid into a spike instead of a blob. Surface tension and gravity push
// back, and the three-way fight is the whole phenomenon.

struct Particle2 {
  pv: vec4f,  // pos.xy, vel.zw
  aux: vec4f, // unused here (kept for layout parity with the sorter)
}

struct FerroParams {
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
  tension: f32,     // pairwise cohesion strength
  magStrength: f32, // magnet pull; 0 = magnet off
  mag: vec2f,       // magnet position, world units
  magDir: vec2f,    // dipole axis, unit vector
  magSoft: f32,     // softening radius so the pull stays finite up close
  floorY: f32,
  wallX: f32,       // tray half-width
  topY: f32,
}

@group(0) @binding(0) var<uniform> FP: FerroParams;
@group(0) @binding(1) var<storage, read_write> parts: array<Particle2>;
@group(0) @binding(2) var<storage, read> cellStart: array<u32>;
@group(0) @binding(3) var<storage, read> cellCount: array<u32>;
@group(0) @binding(4) var<storage, read_write> density: array<vec4f>; // rho, rhoNear, _, _

// Cohesion kernel (Akinci, Akinci & Teschner 2013), normalized so the
// attractive peak at q = 0.5 is exactly 1 and the core bottoms out at -1.
fn cohesionW(q: f32) -> f32 {
  let a = (1.0 - q) * (1.0 - q) * (1.0 - q) * q * q * q;
  if (q < 0.5) { return 64.0 * (2.0 * a - 0.015625); }
  return 64.0 * a;
}

fn cellCoord(p: vec2f) -> vec2i {
  let g = f32(FP.grid);
  return vec2i(
    i32(clamp((p.x + 1.0) * 0.5 * g, 0.0, g - 1.0)),
    i32(clamp((p.y + 1.0) * 0.5 * g, 0.0, g - 1.0)),
  );
}

@compute @workgroup_size(256)
fn densityPass(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= FP.count) { return; }
  let pi = parts[i].pv.xy;
  let h = FP.cell;
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
        let q = length(parts[k].pv.xy - pi) / h;
        if (q < 1.0) {
          let w = 1.0 - q;
          rho += w * w;
          rhoNear += w * w * w;
        }
      }
    }
  }
  density[i] = vec4f(rho, rhoNear, 0.0, 0.0);
}

@compute @workgroup_size(256)
fn forcePass(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= FP.count) { return; }
  var p = parts[i];
  let h = FP.cell;
  let di = density[i];

  let pressI = FP.stiffness * (di.x - FP.restDensity);
  let nearI = FP.nearStiffness * di.y;
  let cc = cellCoord(p.pv.xy);

  var acc = vec2f(0.0, -FP.gravity);
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
        let r = length(d);
        let q = r / h;
        if (q < 1.0 && r > 1e-7) {
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

  // --- the magnet -------------------------------------------------------------
  // F ∝ ∇|B|² for a point dipole. |B|² ∝ (3cos²θ + 1)/r⁶, so the gradient has
  // a radial term (toward the magnet, strongest on-axis) and an angular term
  // (toward the axis). The true 1/r⁷ falloff is too vicious for a toy, so the
  // softened (r²+s²)² stands in — same shape near the magnet, kinder far away.
  if (FP.magStrength > 0.0) {
    let dm = p.pv.xy - FP.mag;
    let r2 = dot(dm, dm) + FP.magSoft * FP.magSoft;
    let rl = sqrt(r2);
    let rhat = dm / rl;
    let cth = dot(FP.magDir, rhat);
    let falloff = 0.001 / (r2 * r2);
    var macc = FP.magStrength * falloff *
      (6.0 * cth * (FP.magDir - cth * rhat) - 6.0 * (3.0 * cth * cth + 1.0) * rhat);
    let ml = length(macc);
    if (ml > 90.0) { macc *= 90.0 / ml; }
    acc += macc;
  }

  // tray: penalty springs, the series' usual walls
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
`,fe=256,B=2/V,x={floorY:-.52,topY:.95,wallX:.8},de={gravity:3,stiffness:80,restDensity:2.6,nearStiffness:260,xsph:.16,tension:3.2,magStrength:30,magSoft:.09};function pe(s){const t=B*.5,e=new Float32Array(s*8);let n=0;for(let i=0;n<s&&i<4e3;i++){const a=x.floorY+t*(i+.7),r=x.wallX-t,w=Math.max(Math.floor(r*2/t),1);for(let m=0;m<w&&n<s;m++,n++)e[n*8]=-r+t*(m+.5)+(Math.random()-.5)*t*.4,e[n*8+1]=a+(Math.random()-.5)*t*.4}return e}class ge{count;params;dev;sort;layout;densityPipe;forcePipe;bufs=[null,null];density=null;sortGroups=[null,null];simGroups=[null,null];cur=0;constructor(t,e){this.dev=t,this.count=e,this.sort=new le(t),this.params=t.createBuffer({size:80,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});const n=r=>({type:r});this.layout=t.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:n("uniform")},{binding:1,visibility:GPUShaderStage.COMPUTE,buffer:n("storage")},{binding:2,visibility:GPUShaderStage.COMPUTE,buffer:n("read-only-storage")},{binding:3,visibility:GPUShaderStage.COMPUTE,buffer:n("read-only-storage")},{binding:4,visibility:GPUShaderStage.COMPUTE,buffer:n("storage")}]});const i=t.createShaderModule({code:ue}),a=t.createPipelineLayout({bindGroupLayouts:[this.layout]});this.densityPipe=t.createComputePipeline({layout:a,compute:{module:i,entryPoint:"densityPass"}}),this.forcePipe=t.createComputePipeline({layout:a,compute:{module:i,entryPoint:"forcePass"}}),this.rebuild(e)}rebuild(t){this.count=t;for(const i of this.bufs)i?.destroy();this.density?.destroy();const e=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC;this.bufs=[this.dev.createBuffer({size:t*32,usage:e}),this.dev.createBuffer({size:t*32,usage:e})],this.density=this.dev.createBuffer({size:t*16,usage:GPUBufferUsage.STORAGE}),this.dev.queue.writeBuffer(this.bufs[0],0,pe(t)),this.sortGroups=[this.sort.bindGroup(this.bufs[0],this.bufs[1]),this.sort.bindGroup(this.bufs[1],this.bufs[0])];const n=i=>this.dev.createBindGroup({layout:this.layout,entries:[{binding:0,resource:{buffer:this.params}},{binding:1,resource:{buffer:i}},{binding:2,resource:{buffer:this.sort.starts}},{binding:3,resource:{buffer:this.sort.counts}},{binding:4,resource:{buffer:this.density}}]});this.simGroups=[n(this.bufs[1]),n(this.bufs[0])],this.cur=0}writeParams(t,e,n,i,a){const r=new DataView(new ArrayBuffer(80));r.setUint32(0,this.count,!0),r.setUint32(4,V,!0),r.setFloat32(8,B,!0),r.setFloat32(12,e,!0),r.setFloat32(16,t.gravity,!0),r.setFloat32(20,t.stiffness,!0),r.setFloat32(24,t.restDensity,!0),r.setFloat32(28,t.nearStiffness,!0),r.setFloat32(32,t.xsph,!0),r.setFloat32(36,2e3,!0),r.setFloat32(40,t.tension,!0),r.setFloat32(44,a?t.magStrength:0,!0),r.setFloat32(48,n[0],!0),r.setFloat32(52,n[1],!0),r.setFloat32(56,i[0],!0),r.setFloat32(60,i[1],!0),r.setFloat32(64,t.magSoft,!0),r.setFloat32(68,x.floorY,!0),r.setFloat32(72,x.wallX,!0),r.setFloat32(76,x.topY,!0),this.dev.queue.writeBuffer(this.params,0,r.buffer)}encodeSteps(t,e){this.sort.writeParams(this.count);const n=Math.ceil(this.count/fe);for(let i=0;i<e;i++){this.sort.encode(t,this.sortGroups[this.cur],this.count);const a=t.beginComputePass();a.setBindGroup(0,this.simGroups[this.cur]),a.setPipeline(this.densityPipe),a.dispatchWorkgroups(n),a.setPipeline(this.forcePipe),a.dispatchWorkgroups(n),a.end(),this.cur=1-this.cur}}get current(){return this.bufs[this.cur]}get buffers(){return this.bufs}get currentIndex(){return this.cur}dispose(){this.sort.dispose();for(const t of this.bufs)t?.destroy();this.density?.destroy(),this.params.destroy()}}const _=["final","mesh only","field + contour","particles"],k=65536;async function A(s,t){const e=await ae(),n=new re(s,t.hero?.5:.62);if(!e)return ie(s);const i=oe(n.canvas,e),a=navigator.gpu.getPreferredCanvasFormat(),r=n.canvas.width,w=n.canvas.height,m=r/w,D=1.04,S=[D/m,D],R=Math.floor(r/2),U=Math.floor(w/2),g={...de},F=t.hero?18e3:22e3;let d=t.view??0,G=0,z=0;const u=new ge(e,F),p=e.createShaderModule({code:ce}),M=e.createTexture({size:[R,U],format:"rgba16float",usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING}),T=M.createView(),$=e.createSampler({magFilter:"linear",minFilter:"linear"}),v=e.createBuffer({size:64,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),O=e.createBuffer({size:k*16,usage:GPUBufferUsage.STORAGE}),y=e.createBuffer({size:4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC}),C=e.createBuffer({size:16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.INDIRECT}),P=e.createBuffer({size:4,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});let b=!1;const E=e.createRenderPipeline({layout:"auto",vertex:{module:p,entryPoint:"vsSplat"},fragment:{module:p,entryPoint:"fsSplat",targets:[{format:"rgba16float",blend:{color:{srcFactor:"one",dstFactor:"one",operation:"add"},alpha:{srcFactor:"one",dstFactor:"one",operation:"add"}}}]},primitive:{topology:"triangle-list"}}),L=e.createRenderPipeline({layout:"auto",vertex:{module:p,entryPoint:"vsFull"},fragment:{module:p,entryPoint:"fsFill",targets:[{format:a}]},primitive:{topology:"triangle-list"}}),I=e.createRenderPipeline({layout:"auto",vertex:{module:p,entryPoint:"vsSegs"},fragment:{module:p,entryPoint:"fsSegs",targets:[{format:a,blend:{color:{srcFactor:"one",dstFactor:"one-minus-src-alpha",operation:"add"},alpha:{srcFactor:"one",dstFactor:"one-minus-src-alpha",operation:"add"}}}]},primitive:{topology:"triangle-list"}}),Y=e.createRenderPipeline({layout:"auto",vertex:{module:p,entryPoint:"vsDots"},fragment:{module:p,entryPoint:"fsDots",targets:[{format:a,blend:{color:{srcFactor:"one",dstFactor:"one-minus-src-alpha",operation:"add"},alpha:{srcFactor:"one",dstFactor:"one-minus-src-alpha",operation:"add"}}}]},primitive:{topology:"triangle-list"}}),N=e.createComputePipeline({layout:"auto",compute:{module:p,entryPoint:"msCells"}}),W=e.createComputePipeline({layout:"auto",compute:{module:p,entryPoint:"msIndirect"}});let X=[null,null],K=[null,null];const H=()=>{X=u.buffers.map(o=>e.createBindGroup({layout:E.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:v}},{binding:1,resource:{buffer:o}}]})),K=u.buffers.map(o=>e.createBindGroup({layout:Y.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:v}},{binding:1,resource:{buffer:o}}]}))};H();const j=e.createBindGroup({layout:L.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:v}},{binding:2,resource:T},{binding:3,resource:$}]}),J=e.createBindGroup({layout:N.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:v}},{binding:2,resource:T},{binding:4,resource:{buffer:O}},{binding:5,resource:{buffer:y}}]}),Q=e.createBindGroup({layout:W.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:v}},{binding:5,resource:{buffer:y}},{binding:6,resource:{buffer:C}}]}),Z=e.createBindGroup({layout:I.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:v}},{binding:7,resource:{buffer:O}}]});let q=null;n.canvas.addEventListener("pointermove",o=>{const l=n.canvas.getBoundingClientRect(),f=(o.clientX-l.left)/l.width*2-1,c=-((o.clientY-l.top)/l.height*2-1);q=[f/S[0],c/S[1]]}),n.canvas.addEventListener("pointerleave",()=>q=null);const ee=()=>[.42*Math.sin(G*.55),-.02+.3*Math.sin(G*.83+1.3)];if(t.full){n.slider({label:"surface tension",min:0,max:8,step:.1,value:g.tension,onInput:l=>g.tension=l}),n.slider({label:"magnet strength",min:0,max:90,step:1,value:g.magStrength,onInput:l=>g.magStrength=l}),n.slider({label:"magnet reach",min:.05,max:.2,step:.005,value:g.magSoft,onInput:l=>g.magSoft=l}),n.button(`view: ${_[d]}`,function(){d=(d+1)%_.length});const o=n.controls.querySelectorAll("button")[0];o?.addEventListener("click",()=>o.textContent=`view: ${_[d]}`),n.button("re-pour",()=>{u.rebuild(F),H()})}n.setInfo(()=>t.hero?`${F.toLocaleString()} particles · surface remeshed every frame · your cursor is the magnet`:`${F.toLocaleString()} particles · ${z.toLocaleString()} segments by marching squares · cursor = magnet`);const te=(o,l)=>{const f=new Float32Array([S[0],S[1],R,U,B*5.4,1.05,.85,G,o[0],o[1],1,d,B*.62,k,0,0]);e.queue.writeBuffer(v,0,f)};{u.writeParams(g,.0016,[0,5],[0,1],!1);for(let o=0;o<3;o++){const l=e.createCommandEncoder();u.encodeSteps(l,200),e.queue.submit([l.finish()])}}return{frame(){n.tick(),G+=1/60;const o=!0,l=q??ee();u.writeParams(g,.0016,l,[0,1],o),te(l);const f=e.createCommandEncoder();u.encodeSteps(f,5);let c=f.beginRenderPass({colorAttachments:[{view:T,clearValue:{r:0,g:0,b:0,a:0},loadOp:"clear",storeOp:"store"}]});c.setPipeline(E),c.setBindGroup(0,X[u.currentIndex]),c.draw(6,u.count),c.end(),f.clearBuffer(y);const h=f.beginComputePass();h.setPipeline(N),h.setBindGroup(0,J),h.dispatchWorkgroups(Math.ceil(R/8),Math.ceil(U/8)),h.setPipeline(W),h.setBindGroup(0,Q),h.dispatchWorkgroups(1),h.end(),b||f.copyBufferToBuffer(y,0,P,0,4),c=f.beginRenderPass({colorAttachments:[{view:i.getCurrentTexture().createView(),clearValue:{r:.016,g:.018,b:.03,a:1},loadOp:"clear",storeOp:"store"}]}),(d===0||d===2)&&(c.setPipeline(L),c.setBindGroup(0,j),c.draw(3)),(d===0||d===1)&&(c.setPipeline(I),c.setBindGroup(0,Z),c.drawIndirect(C,0)),d===3&&(c.setPipeline(Y),c.setBindGroup(0,K[u.currentIndex]),c.draw(6,u.count)),c.end(),e.queue.submit([f.finish()]),b||(b=!0,P.mapAsync(GPUMapMode.READ).then(()=>{z=Math.min(new Uint32Array(P.getMappedRange())[0],k),P.unmap(),b=!1}).catch(()=>b=!1))},dispose(){u.dispose(),M.destroy(),v.destroy(),O.destroy(),y.destroy(),C.destroy(),P.destroy()}}}ne();const ve={"hero-ferro":s=>A(s,{hero:!0}),mesh:s=>A(s,{view:1}),ferro:s=>A(s,{full:!0})};for(const s of document.querySelectorAll("[data-demo]")){const t=s.dataset.demo,e=ve[t];e&&se(s,()=>e(s))}
