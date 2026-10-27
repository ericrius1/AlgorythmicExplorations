// Ferrofluid rendering in 2D (Strange Matter parts one and two). Everything
// draws linear HDR light into PostFX's scene target, which adds bloom and
// tone maps it onto the canvas.
//
// 1. vsSplat/fsSplat — every particle adds a small radial bump into a field
//    texture the size of the canvas. The fluid is wherever the sum passes
//    the threshold.
// 2. msCells/msIndirect — marching squares over a coarser lattice sampled
//    from that field. Each cell's four corner signs pick one of sixteen
//    cases, each case emits zero, one or two segments into a buffer through
//    an atomic counter, and a one-thread pass writes the final count into
//    indirect-draw arguments, so the CPU never reads it back to draw.
// 3. fsFill — backdrop, dish, magnet, and the fluid body: a signed distance
//    to the surface from the field and its gradient, a rounded bevel built
//    from that distance, and a small studio reflected in the bevel. Also the
//    field debug view.
// 4. vsSegs/fsSegs — the extracted segments: the bright rim along the top
//    of the fluid in the final view, the mesh itself in the mesh view.
// 5. vsVerts/fsVerts — segment endpoints, for the mesh view.
// 6. vsDots/fsDots — the raw particles.
// 7. vsArrows/fsArrows — magnetic moments (part two).

struct RenderParams {
  center: vec2f,     // world point at the middle of the canvas
  scale: vec2f,      // world → clip multiplier
  res: vec2f,        // field texture size in px (= canvas size)
  msRes: vec2f,      // marching-squares lattice points per axis
  splatRadius: f32,  // world units
  splatNorm: f32,    // kernel weight scale: the bulk of the fluid sums to ~1
  threshold: f32,    // field value at the surface
  time: f32,
  mag: vec2f,        // magnet position, world
  magOn: f32,
  view: f32,         // 0 final · 1 mesh · 2 field · 3 particles · 4 moments
  dotSize: f32,      // world
  maxSegs: f32,
  momentScale: f32,  // |m| → 0..1
  arrowStride: f32,
  tray: vec4f,       // floorY, wallX, rimY, bevel width (world)
  lineWidth: f32,    // px
  pxPerWorld: f32,
  msCell: f32,       // lattice spacing, px
  magGlyph: f32,     // 1 = draw the magnet as a bar, 0 = no glyph
  fieldRes: vec2f,   // field texture size (half the canvas)
  blurSigma: f32,    // field blur, in field texels
  rimY: f32,         // top of the dish walls, world
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
@group(0) @binding(6) var<storage, read_write> indirectArgs: array<u32, 8>;
@group(0) @binding(7) var<storage, read> segsR: array<vec4f>; // same buffer, vertex-stage view
@group(0) @binding(8) var blurSrc: texture_2d<f32>;

const QUAD = array<vec2f, 6>(
  vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
  vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
);

fn worldToClip(p: vec2f) -> vec2f {
  return (p - RP.center) * RP.scale;
}

fn uvToWorld(uv: vec2f) -> vec2f {
  return vec2f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0) / RP.scale + RP.center;
}

fn fieldUv(uv: vec2f) -> f32 {
  return textureSampleLevel(fieldTex, linSamp, uv, 0.0).x;
}

fn wideUv(uv: vec2f) -> f32 {
  return textureSampleLevel(fieldTex, linSamp, uv, 0.0).y;
}

// ---- 1. kernel splat ---------------------------------------------------------

struct SplatOut {
  @builtin(position) pos: vec4f,
  @location(0) local: vec2f,
}

@vertex
fn vsSplat(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> SplatOut {
  let corner = QUAD[vi];
  let world = parts[ii].pv.xy + corner * RP.splatRadius;
  var out: SplatOut;
  out.pos = vec4f(worldToClip(world), 0.0, 1.0);
  out.local = corner;
  return out;
}

@fragment
fn fsSplat(in: SplatOut) -> @location(0) vec4f {
  let q2 = dot(in.local, in.local);
  if (q2 >= 1.0) { discard; }
  let w = (1.0 - q2) * (1.0 - q2);
  return vec4f(w * RP.splatNorm, 0.0, 0.0, 0.0);
}

// ---- 1b. blur ----------------------------------------------------------------------
// Two separable Gaussians over the field in one go. The narrow one (red)
// takes the particle-scale noise off the surface; that's what gets
// thresholded and meshed. The wide one (green) is a soft height map, used
// only to bend the shading normal so the fluid looks rounded.

fn blur(pos: vec2f, dir: vec2i, vertical: bool) -> vec2f {
  let p = vec2i(pos);
  let size = vec2i(textureDimensions(blurSrc));
  let s1 = max(RP.blurSigma, 0.3);
  let s2 = s1 * 3.2;
  let r = i32(ceil(s2 * 2.5));
  var sum = vec2f(0.0);
  var wsum = vec2f(0.0);
  for (var k = -r; k <= r; k++) {
    let q = clamp(p + dir * k, vec2i(0), size - 1);
    let k2 = f32(k * k);
    let w = vec2f(exp(-k2 / (2.0 * s1 * s1)), exp(-k2 / (2.0 * s2 * s2)));
    let v = textureLoad(blurSrc, q, 0);
    // first pass blurs the raw splat twice; second pass blurs each channel
    sum += select(vec2f(v.x), v.xy, vertical) * w;
    wsum += w;
  }
  return sum / wsum;
}

@fragment
fn fsBlurH(in: FullOut) -> @location(0) vec4f {
  return vec4f(blur(in.pos.xy, vec2i(1, 0), false), 0.0, 0.0);
}

@fragment
fn fsBlurV(in: FullOut) -> @location(0) vec4f {
  return vec4f(blur(in.pos.xy, vec2i(0, 1), true), 0.0, 0.0);
}

// ---- 2. marching squares -------------------------------------------------------

fn fieldAt(p: vec2f) -> f32 { // p in lattice coordinates
  return fieldUv(p * RP.msCell / RP.res);
}

// crossing point on the edge a→b, lattice coordinates
fn cross2(pa: vec2f, pb: vec2f, fa: f32, fb: f32) -> vec2f {
  let t = clamp((RP.threshold - fa) / (fb - fa + 1e-9), 0.0, 1.0);
  return mix(pa, pb, t);
}

fn emit(a: vec2f, b: vec2f) {
  let idx = atomicAdd(&segCount, 1u);
  if (idx < u32(RP.maxSegs)) {
    segs[idx] = vec4f(a, b) * RP.msCell; // stored in px
  }
}

@compute @workgroup_size(8, 8)
fn msCells(@builtin(global_invocation_id) gid: vec3u) {
  let nx = u32(RP.msRes.x) - 1u;
  let ny = u32(RP.msRes.y) - 1u;
  if (gid.x >= nx || gid.y >= ny) { return; }
  let p00 = vec2f(f32(gid.x), f32(gid.y));
  let p10 = p00 + vec2f(1.0, 0.0);
  let p11 = p00 + vec2f(1.0, 1.0);
  let p01 = p00 + vec2f(0.0, 1.0);
  let f00 = fieldAt(p00);
  let f10 = fieldAt(p10);
  let f11 = fieldAt(p11);
  let f01 = fieldAt(p01);
  let T = RP.threshold;
  var c = 0u;
  if (f00 > T) { c |= 1u; }
  if (f10 > T) { c |= 2u; }
  if (f11 > T) { c |= 4u; }
  if (f01 > T) { c |= 8u; }
  if (c == 0u || c == 15u) { return; }

  // edge crossings: e0 = 00–10, e1 = 10–11, e2 = 01–11, e3 = 00–01
  let e0 = cross2(p00, p10, f00, f10);
  let e1 = cross2(p10, p11, f10, f11);
  let e2 = cross2(p01, p11, f01, f11);
  let e3 = cross2(p00, p01, f00, f01);

  switch (c) {
    case 1u, 14u: { emit(e3, e0); }
    case 2u, 13u: { emit(e0, e1); }
    case 3u, 12u: { emit(e3, e1); }
    case 4u, 11u: { emit(e1, e2); }
    case 6u, 9u: { emit(e0, e2); }
    case 7u, 8u: { emit(e3, e2); }
    case 5u: { // saddle: 00 and 11 inside. Sample the middle to choose.
      if (fieldAt(p00 + vec2f(0.5)) > T) { emit(e0, e1); emit(e2, e3); }
      else { emit(e3, e0); emit(e1, e2); }
    }
    case 10u: { // saddle: 10 and 01 inside
      if (fieldAt(p00 + vec2f(0.5)) > T) { emit(e3, e0); emit(e1, e2); }
      else { emit(e0, e1); emit(e2, e3); }
    }
    default: {}
  }
}

@compute @workgroup_size(1)
fn msIndirect() {
  let n = min(atomicLoad(&segCount), u32(RP.maxSegs));
  indirectArgs[0] = 6u; // segment quads: 6 vertices, one instance per segment
  indirectArgs[1] = n;
  indirectArgs[2] = 0u;
  indirectArgs[3] = 0u;
  indirectArgs[4] = 6u; // endpoint dots: two per segment
  indirectArgs[5] = n * 2u;
  indirectArgs[6] = 0u;
  indirectArgs[7] = 0u;
}

// ---- lighting ----------------------------------------------------------------------

// A small studio for the fluid to reflect: a big softbox overhead, a warm
// strip on the left, a cool one on the right, a dim horizon and a dark floor.
// r: reflection direction, x right, y up, z toward the viewer.
fn env(r: vec3f) -> vec3f {
  var c = vec3f(0.002, 0.0025, 0.004);
  c += vec3f(0.025, 0.032, 0.05) * exp(-abs(r.y - 0.05) * 5.0);
  // overhead softbox: a crisp-edged rectangle, so highlights read as wet
  let top = smoothstep(0.93, 0.96, r.y) * (1.0 - smoothstep(0.22, 0.27, abs(r.x + 0.05)));
  c += vec3f(2.2, 2.3, 2.5) * top;
  // a broad dim fill above, so the upper surfaces never go fully dead
  c += vec3f(0.05, 0.06, 0.09) * smoothstep(0.1, 0.9, r.y);
  // warm strip on the left, cool on the right
  let side = smoothstep(0.2, 0.06, abs(r.y - 0.12));
  c += vec3f(1.15, 0.68, 0.36) * smoothstep(0.62, 0.75, -r.x) * side;
  c += vec3f(0.36, 0.52, 1.0) * smoothstep(0.66, 0.8, r.x) * side;
  return c;
}

fn backdrop(world: vec2f, uv: vec2f) -> vec3f {
  // a dark studio wall, a little lighter toward the top, with a soft pool
  // of light behind the middle of the dish so black liquid reads against it
  var c = mix(vec3f(0.012, 0.014, 0.022), vec3f(0.003, 0.0035, 0.006), smoothstep(0.0, 1.0, uv.y));
  let q = (world - vec2f(0.0, RP.tray.x + 0.32)) * vec2f(0.9, 1.7);
  c += vec3f(0.022, 0.026, 0.040) * exp(-dot(q, q) * 2.2);
  return c;
}

// the glass dish, edge-on: a floor slab and two thin walls
fn dish(world: vec2f, c: vec3f) -> vec3f {
  let px = 1.0 / RP.pxPerWorld;
  let floorTop = RP.tray.x - RP.splatRadius * 0.55;
  let slab = 0.022;
  var col = c;
  let wx = RP.tray.y + RP.splatRadius * 0.55;
  if (abs(world.x) < wx + 0.012 && world.y < floorTop && world.y > floorTop - slab) {
    let t = (floorTop - world.y) / slab;
    col = mix(vec3f(0.05, 0.058, 0.08), vec3f(0.012, 0.014, 0.02), t);
    col += vec3f(0.5, 0.55, 0.65) * smoothstep(1.5 * px, 0.0, floorTop - world.y) * 0.5;
  }
  // walls: a hairline of lit glass from the slab up to the rim
  let inWall = world.y > floorTop - slab && world.y < RP.rimY;
  let dw = abs(abs(world.x) - (wx + 0.006));
  if (inWall) {
    let fade = smoothstep(RP.rimY, RP.rimY - 0.12, world.y);
    col += vec3f(0.16, 0.19, 0.26) * smoothstep(1.6 * px, 0.0, dw) * (0.35 + 0.65 * fade);
  }
  return col;
}

// the magnet: a small steel bar with a glowing pole face at the bottom
fn magnetGlyph(world: vec2f, c: vec3f) -> vec3f {
  let hw = 0.022;
  let hh = 0.05;
  let p = world - (RP.mag + vec2f(0.0, hh));
  let q = abs(p) - vec2f(hw, hh) + 0.008;
  let sd = length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - 0.008;
  let px = 1.0 / RP.pxPerWorld;
  var col = c;
  // glow under the pole
  let gd = length((world - RP.mag) * vec2f(1.0, 1.4));
  col += vec3f(1.0, 0.45, 0.12) * 0.05 * exp(-gd * gd * 900.0);
  let cover = smoothstep(px, -px, sd);
  if (cover > 0.0) {
    let nx = clamp(p.x / hw, -1.0, 1.0);
    let n = vec3f(nx, 0.0, sqrt(1.0 - nx * nx));
    let r = reflect(vec3f(0.0, 0.0, -1.0), n);
    // brushed steel: the studio's brightness without its colour
    var steel = vec3f(0.03, 0.032, 0.038) + vec3f(dot(env(r), vec3f(0.3, 0.5, 0.2))) * 0.3;
    let pole = smoothstep(-hh + 0.022, -hh + 0.016, p.y);
    steel = mix(steel, vec3f(1.6, 0.62, 0.2), pole * 0.85);
    col = mix(col, steel, cover);
  }
  return col;
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

fn heat(t: f32) -> vec3f {
  let x = clamp(t, 0.0, 1.0);
  let a = vec3f(0.010, 0.006, 0.040);
  let b = vec3f(0.30, 0.02, 0.18);
  let c = vec3f(0.95, 0.24, 0.03);
  let d = vec3f(1.0, 0.85, 0.35);
  if (x < 0.4) { return mix(a, b, x / 0.4); }
  if (x < 0.75) { return mix(b, c, (x - 0.4) / 0.35); }
  return mix(c, d, (x - 0.75) / 0.25);
}

// ---- 3. fluid body ----------------------------------------------------------------

@fragment
fn fsFill(in: FullOut) -> @location(0) vec4f {
  let world = uvToWorld(in.uv);
  let px = 1.0 / RP.fieldRes;
  let f = fieldUv(in.uv);
  let T = RP.threshold;

  // field gradient per canvas px, oriented world-up (uv y runs down)
  let g = vec2f(
    fieldUv(in.uv + vec2f(px.x, 0.0)) - fieldUv(in.uv - vec2f(px.x, 0.0)),
    fieldUv(in.uv - vec2f(0.0, px.y)) - fieldUv(in.uv + vec2f(0.0, px.y)),
  ) * 0.5 * (RP.fieldRes.x / RP.res.x);
  let gl = length(g);
  // signed distance to the surface in px, positive inside. First-order, so
  // only trustworthy within a few px of the surface, which is all it's for.
  let d = (f - T) / max(gl, 1e-5);

  if (RP.view > 1.5 && RP.view < 2.5) { // field debug view
    var col = heat(f / (T * 2.2)) * 0.9;
    col = mix(col, vec3f(1.6, 1.8, 2.0), smoothstep(1.3, 0.4, abs(d)));
    return vec4f(col, 1.0);
  }

  var col = dish(world, backdrop(world, in.uv));
  if (RP.view > 2.5 && RP.view < 3.5) { // particles view: no fluid body
    return vec4f(col, 1.0);
  }

  let cover = smoothstep(-0.75, 0.75, d);
  if (cover > 0.0) {
    var body: vec3f;
    if (RP.view > 0.5 && RP.view < 1.5) {
      body = vec3f(0.010, 0.012, 0.018); // mesh view: a flat silhouette
    } else {
      // the shading normal leans outward wherever the wide field slopes:
      // flat facing you deep inside, nearly edge-on at the silhouette
      let pw = 1.0 / RP.fieldRes;
      let gw = vec2f(
        wideUv(in.uv + vec2f(pw.x, 0.0)) - wideUv(in.uv - vec2f(pw.x, 0.0)),
        wideUv(in.uv - vec2f(0.0, pw.y)) - wideUv(in.uv + vec2f(0.0, pw.y)),
      ) * 0.5;
      let gwl = length(gw);
      let outDir = -gw / max(gwl, 1e-6);
      // only within a bevel's width of the surface: deep inside, the
      // wide field's ripples would show up as smudges on the black
      let bevel = exp(-max(d, 0.0) / (0.06 * RP.pxPerWorld));
      let tilt = min(0.97, 1.0 - exp(-gwl * RP.tray.w)) * bevel;
      let n = vec3f(outDir * tilt, sqrt(1.0 - tilt * tilt));
      let r = reflect(vec3f(0.0, 0.0, -1.0), n);
      let fres = 0.05 + 0.95 * pow(1.0 - n.z, 4.0);
      body = vec3f(0.0012, 0.0014, 0.002) + env(r) * (0.1 + 0.9 * fres);
      // a hard key light for a wet pin highlight
      let h = normalize(normalize(vec3f(-0.55, 0.55, 0.62)) + vec3f(0.0, 0.0, 1.0));
      body += vec3f(3.0, 3.1, 3.3) * pow(max(dot(n, h), 0.0), 90.0);
      if (RP.view > 3.5) { body *= 0.5; } // moments view: dim the fluid under the arrows
    }
    col = mix(col, body, cover);
  }

  if (RP.view > 0.5 && RP.view < 1.5) { // mesh view: the lattice the cells live on
    let lp = in.uv * RP.res / RP.msCell;
    let gd = abs(fract(lp + 0.5) - 0.5) * RP.msCell;
    col += vec3f(0.035, 0.045, 0.07) * smoothstep(1.0, 0.0, min(gd.x, gd.y));
  }

  if (RP.magOn > 0.5 && RP.magGlyph > 0.5) { col = magnetGlyph(world, col); }
  return vec4f(col, 1.0);
}

// ---- 4. extracted segments ---------------------------------------------------------

struct SegOut {
  @builtin(position) pos: vec4f,
  @location(0) v: f32,
  @location(1) color: vec3f,
}

fn pxToClip(p: vec2f) -> vec2f {
  let uv = p / RP.res;
  return vec2f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
}

@vertex
fn vsSegs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> SegOut {
  var ends = array<f32, 6>(0.0, 1.0, 0.0, 0.0, 1.0, 1.0);
  var sides = array<f32, 6>(-1.0, -1.0, 1.0, 1.0, -1.0, 1.0);
  let seg = segsR[ii];
  let a = seg.xy;
  let b = seg.zw;
  var d = b - a;
  let len = length(d);
  if (len < 1e-6) { d = vec2f(1.0, 0.0); } else { d = d / len; }
  let n = vec2f(-d.y, d.x);
  let endK = ends[vi];
  let w = RP.lineWidth + 1.0;
  let p = mix(a, b, endK) + (n * sides[vi] + d * (endK * 2.0 - 1.0) * 0.5) * w;

  var out: SegOut;
  out.pos = vec4f(pxToClip(p), 0.0, 1.0);
  out.v = sides[vi] * w;
  if (RP.view > 0.5 && RP.view < 1.5) {
    out.color = vec3f(0.25, 0.75, 1.3);
  } else {
    // rim light: the edge reflects whatever its outward normal faces, so the
    // top of the fluid catches the softbox and the underside stays dark
    let mid = (a + b) * 0.5 / RP.res;
    let px = 1.0 / RP.fieldRes;
    let g = vec2f(
      fieldUv(mid + vec2f(px.x, 0.0)) - fieldUv(mid - vec2f(px.x, 0.0)),
      fieldUv(mid - vec2f(0.0, px.y)) - fieldUv(mid + vec2f(0.0, px.y)),
    );
    let o = -g / max(length(g), 1e-6);
    out.color = env(normalize(vec3f(o * 0.8, 0.45))) * 0.32;
  }
  return out;
}

@fragment
fn fsSegs(in: SegOut) -> @location(0) vec4f {
  let w = RP.lineWidth;
  let a = clamp(w + 0.5 - abs(in.v), 0.0, 1.0) / max(w, 1.0);
  return vec4f(in.color * a, a * 0.9);
}

struct VertOut {
  @builtin(position) pos: vec4f,
  @location(0) local: vec2f,
}

@vertex
fn vsVerts(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VertOut {
  let seg = segsR[ii / 2u];
  let p = select(seg.xy, seg.zw, (ii & 1u) == 1u);
  let corner = QUAD[vi];
  let r = RP.lineWidth * 2.2 + 1.0;
  var out: VertOut;
  out.pos = vec4f(pxToClip(p + corner * r), 0.0, 1.0);
  out.local = corner * r;
  return out;
}

@fragment
fn fsVerts(in: VertOut) -> @location(0) vec4f {
  let r = RP.lineWidth * 2.2;
  let a = clamp(r + 0.5 - length(in.local), 0.0, 1.0);
  return vec4f(vec3f(0.85, 1.0, 1.25) * a, a);
}

// ---- 6. raw particle dots --------------------------------------------------------

fn toLinear(c: vec3f) -> vec3f {
  return pow(c / 255.0, vec3f(2.2));
}

// the site's speed ramp: slow deep blue, middling pale violet, fast amber
fn speedColor(t: f32) -> vec3f {
  let x = clamp(t, 0.0, 1.0);
  if (x < 0.5) { return mix(toLinear(vec3f(52.0, 86.0, 235.0)), toLinear(vec3f(178.0, 174.0, 255.0)), x * 2.0); }
  return mix(toLinear(vec3f(178.0, 174.0, 255.0)), toLinear(vec3f(255.0, 168.0, 92.0)), x * 2.0 - 1.0);
}

struct DotOut {
  @builtin(position) pos: vec4f,
  @location(0) local: vec2f,
  @location(1) speed: f32,
}

@vertex
fn vsDots(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> DotOut {
  let p = parts[ii];
  let corner = QUAD[vi];
  let world = p.pv.xy + corner * RP.dotSize;
  var out: DotOut;
  out.pos = vec4f(worldToClip(world), 0.0, 1.0);
  out.local = corner;
  out.speed = length(p.pv.zw);
  return out;
}

@fragment
fn fsDots(in: DotOut) -> @location(0) vec4f {
  let q2 = dot(in.local, in.local);
  if (q2 > 1.0) { discard; }
  let a = (1.0 - q2) * 0.9;
  let col = speedColor(in.speed * 1.4) * 0.9;
  return vec4f(col * a, a);
}

// ---- 7. magnetic moments as arrows (part two) -------------------------------------
// aux.xy is each particle's magnetic moment. Every k-th particle draws.

struct ArrowOut {
  @builtin(position) pos: vec4f,
  @location(0) local: vec2f, // x along the moment, y across
  @location(1) mag: f32,     // |m|, scaled to 0..1
}

@vertex
fn vsArrows(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> ArrowOut {
  let stride = max(u32(RP.arrowStride), 1u);
  let p = parts[ii * stride];
  let corner = QUAD[vi];
  let m = p.aux.xy;
  let ml = length(m);
  var dir = vec2f(0.0, 1.0);
  if (ml > 1e-6) { dir = m / ml; }
  let mag = clamp(ml * RP.momentScale, 0.0, 1.0);
  let len = RP.dotSize * (0.8 + 1.6 * mag);
  let wd = RP.dotSize * 0.5;
  let perp = vec2f(-dir.y, dir.x);
  let world = p.pv.xy + dir * corner.x * len + perp * corner.y * wd;
  var out: ArrowOut;
  out.pos = vec4f(worldToClip(world), 0.0, 1.0);
  out.local = corner;
  out.mag = mag;
  return out;
}

@fragment
fn fsArrows(in: ArrowOut) -> @location(0) vec4f {
  // taper to a point at the head and fade the tail: reads as an arrow
  // without extra geometry
  let head = (in.local.x + 1.0) * 0.5;
  let halfW = 1.0 - head * head;
  if (abs(in.local.y) > halfW) { discard; }
  let a = (0.3 + 0.7 * head) * (0.4 + 0.6 * in.mag);
  let col = mix(vec3f(0.06, 0.09, 0.3), vec3f(1.5, 0.55, 0.14), in.mag);
  return vec4f(col * a, a);
}
