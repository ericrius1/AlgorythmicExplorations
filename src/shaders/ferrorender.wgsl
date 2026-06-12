// Ferrofluid rendering: the metaball field again — but this time the field's
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
