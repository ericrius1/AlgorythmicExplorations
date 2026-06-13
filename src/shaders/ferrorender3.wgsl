// Rendering for the 3D ferrofluid: the extracted mesh shaded as glossy ink,
// a dish to keep it from floating in the void, particle billboards for the
// teaching view (brightness = magnetization), and a small glyph for the
// cursor magnet. No culling anywhere — extractors emit unwound triangles and
// the fragment shader flips normals toward the eye instead.

struct RP3 {
  viewProj: mat4x4f,
  eye: vec4f,   // xyz, w = time
  right: vec4f, // xyz, w = dot size
  up: vec4f,    // xyz, w = moment → brightness scale
  mag: vec4f,   // cursor magnet xyz, w = on/off
  dish: vec4f,  // wallXY, floorZ, rimZ, unused
}

struct MeshVert {
  pos: vec4f,
  nrm: vec4f,
}

struct Particle3 {
  pos: vec4f,
  vel: vec4f,
  mom: vec4f,
  acc: vec4f,
}

@group(0) @binding(0) var<uniform> RP: RP3;
@group(0) @binding(1) var<storage, read> verts: array<MeshVert>;
@group(0) @binding(2) var<storage, read> parts: array<Particle3>;

// ---- the fluid mesh -----------------------------------------------------------

struct MeshOut {
  @builtin(position) clip: vec4f,
  @location(0) wp: vec3f,
  @location(1) nrm: vec3f,
}

@vertex
fn vsMesh(@builtin(vertex_index) vi: u32) -> MeshOut {
  let v = verts[vi];
  var out: MeshOut;
  out.clip = RP.viewProj * vec4f(v.pos.xyz, 1.0);
  out.wp = v.pos.xyz;
  out.nrm = v.nrm.xyz;
  return out;
}

@fragment
fn fsMesh(in: MeshOut) -> @location(0) vec4f {
  let V = normalize(RP.eye.xyz - in.wp);
  var n = normalize(in.nrm);
  if (dot(n, V) < 0.0) { n = -n; }

  let base = vec3f(0.016, 0.019, 0.028); // ferrofluid: very nearly black

  let l1 = normalize(vec3f(-0.45, 0.30, 0.83));
  let h1 = normalize(l1 + V);
  let spec1 = pow(max(dot(n, h1), 0.0), 70.0);

  let l2 = normalize(vec3f(0.60, -0.50, 0.35));
  let h2 = normalize(l2 + V);
  let spec2 = pow(max(dot(n, h2), 0.0), 22.0);

  let fres = pow(1.0 - max(dot(n, V), 0.0), 3.0);
  let refl = reflect(-V, n);
  let sky = smoothstep(-0.3, 1.0, refl.z);

  let col = base
          + vec3f(0.85, 0.92, 1.00) * spec1 * 1.15
          + vec3f(0.95, 0.80, 0.62) * spec2 * 0.16
          + vec3f(0.11, 0.14, 0.22) * fres * 1.55
          + vec3f(0.05, 0.065, 0.095) * sky * 0.95;
  return vec4f(col, 1.0);
}

// ---- the dish: an opaque floor slab and four translucent walls -------------------

struct DishOut {
  @builtin(position) clip: vec4f,
  @location(0) face: f32,
  @location(1) local: vec2f,
}

@vertex
fn vsDish(@builtin(vertex_index) vi: u32) -> DishOut {
  let face = vi / 6u;
  let k = vi % 6u;
  var corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
  );
  let c = corners[k];
  let w = RP.dish.x + 0.025;
  let fz = RP.dish.y - 0.004;
  let rz = RP.dish.z;
  var p: vec3f;
  switch (face) {
    case 0u: { p = vec3f(c.x * w, c.y * w, fz); }                       // floor
    case 1u: { p = vec3f(c.x * w, -w, mix(fz, rz, c.y * 0.5 + 0.5)); }  // -y wall
    case 2u: { p = vec3f(c.x * w, w, mix(fz, rz, c.y * 0.5 + 0.5)); }   // +y wall
    case 3u: { p = vec3f(-w, c.x * w, mix(fz, rz, c.y * 0.5 + 0.5)); }  // -x wall
    default: { p = vec3f(w, c.x * w, mix(fz, rz, c.y * 0.5 + 0.5)); }   // +x wall
  }
  var out: DishOut;
  out.clip = RP.viewProj * vec4f(p, 1.0);
  out.face = f32(face);
  out.local = c;
  return out;
}

@fragment
fn fsDish(in: DishOut) -> @location(0) vec4f {
  if (in.face < 0.5) {
    // floor: dark slab, faint vignette toward the rim
    let r = max(abs(in.local.x), abs(in.local.y));
    let col = mix(vec3f(0.052, 0.058, 0.082), vec3f(0.030, 0.034, 0.050), smoothstep(0.4, 1.0, r));
    return vec4f(col, 1.0);
  }
  // walls: a breath of glass — brighter along the rim
  let rim = smoothstep(0.72, 1.0, in.local.y);
  let a = 0.035 + rim * 0.05;
  return vec4f(vec3f(0.35, 0.45, 0.65) * a, a);
}

// ---- particle billboards (brightness = |moment|) ------------------------------------

struct DotOut {
  @builtin(position) clip: vec4f,
  @location(0) local: vec2f,
  @location(1) mag: f32,
}

@vertex
fn vsDots3(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> DotOut {
  var corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
  );
  let p = parts[ii];
  let c = corners[vi];
  let world = p.pos.xyz + (RP.right.xyz * c.x + RP.up.xyz * c.y) * RP.right.w;
  var out: DotOut;
  out.clip = RP.viewProj * vec4f(world, 1.0);
  out.local = c;
  out.mag = clamp(length(p.mom.xyz) * RP.up.w, 0.0, 1.0);
  return out;
}

@fragment
fn fsDots3(in: DotOut) -> @location(0) vec4f {
  let q2 = dot(in.local, in.local);
  if (q2 > 1.0) { discard; }
  let a = (1.0 - q2) * 0.85;
  let col = mix(vec3f(0.16, 0.22, 0.40), vec3f(1.0, 0.62, 0.25), in.mag);
  return vec4f(col * a, a);
}

// ---- cursor magnet glyph --------------------------------------------------------------

struct GlyphOut {
  @builtin(position) clip: vec4f,
  @location(0) local: vec2f,
}

@vertex
fn vsGlyph(@builtin(vertex_index) vi: u32) -> GlyphOut {
  var corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
  );
  let c = corners[vi];
  let world = RP.mag.xyz + (RP.right.xyz * c.x + RP.up.xyz * c.y) * 0.05;
  var out: GlyphOut;
  out.clip = RP.viewProj * vec4f(world, 1.0);
  out.local = c;
  return out;
}

@fragment
fn fsGlyph(in: GlyphOut) -> @location(0) vec4f {
  let r = length(in.local);
  if (r > 1.0) { discard; }
  let ring = smoothstep(0.16, 0.0, abs(r - 0.62)) * 0.9;
  let core = smoothstep(0.3, 0.0, r) * 0.7;
  let a = (ring + core) * RP.mag.w;
  return vec4f(vec3f(1.0, 0.62, 0.25) * a, a);
}
