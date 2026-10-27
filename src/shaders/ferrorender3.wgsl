// Rendering for the 3D ferrofluid (Strange Matter part three), in linear HDR
// for PostFX: the extracted mesh shaded as glossy black liquid,
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

// A small studio for the fluid to reflect, the 3D twin of part one's: a
// crisp softbox overhead, a warm strip on the viewer's left, a cool one on
// the right, a dim horizon and a dark floor. Up is world z; left and right
// are taken from the camera so the strips stay put while you orbit.
fn env(r: vec3f) -> vec3f {
  let up = r.z;
  let side = dot(r, RP.right.xyz);
  let fwd = dot(r, normalize(cross(RP.right.xyz, vec3f(0.0, 0.0, 1.0))));
  var c = vec3f(0.002, 0.0025, 0.004);
  c += vec3f(0.03, 0.038, 0.06) * exp(-abs(up - 0.04) * 6.0);
  // overhead softbox: a hard-edged rectangle, so highlights read as wet
  let box = smoothstep(0.72, 0.76, up)
          * (1.0 - smoothstep(0.36, 0.40, abs(side + 0.06)))
          * (1.0 - smoothstep(0.48, 0.53, abs(fwd)));
  c += vec3f(2.6, 2.7, 2.9) * box;
  c += vec3f(0.05, 0.06, 0.09) * smoothstep(0.1, 0.9, up);
  let band = smoothstep(0.14, 0.04, abs(up - 0.2));
  c += vec3f(1.5, 1.0, 0.62) * smoothstep(0.74, 0.82, -side) * band;
  c += vec3f(0.5, 0.68, 1.3) * smoothstep(0.74, 0.82, side) * band;
  return c;
}

@fragment
fn fsMesh(in: MeshOut) -> @location(0) vec4f {
  let V = normalize(RP.eye.xyz - in.wp);
  var n = normalize(in.nrm);
  if (dot(n, V) < 0.0) { n = -n; }
  let ndv = max(dot(n, V), 0.0);

  // ferrofluid is an oil full of soot-black magnetite: the body absorbs
  // nearly everything, so what you see is the surface reflecting the room
  let fres = 0.06 + 0.94 * pow(1.0 - ndv, 5.0);
  let r = reflect(-V, n);
  var col = vec3f(0.0015, 0.0017, 0.0024) + env(r) * fres;
  // a hard key light for the pin highlight on every tip
  let l1 = normalize(vec3f(-0.35, 0.25, 0.9));
  col += vec3f(3.2, 3.3, 3.5) * pow(max(dot(n, normalize(l1 + V)), 0.0), 160.0);
  return vec4f(col, 1.0);
}

// ---- backdrop: a dark studio wall with a soft pool of light behind the dish ---

struct BackOut {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn vsBack(@builtin(vertex_index) vi: u32) -> BackOut {
  var pts = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var out: BackOut;
  out.clip = vec4f(pts[vi], 1.0, 1.0);
  out.uv = pts[vi];
  return out;
}

@fragment
fn fsBack(in: BackOut) -> @location(0) vec4f {
  var c = mix(vec3f(0.002, 0.0024, 0.004), vec3f(0.006, 0.007, 0.011), smoothstep(-1.0, 1.0, in.uv.y));
  let q = (in.uv - vec2f(0.0, 0.25)) * vec2f(0.8, 1.3);
  c += vec3f(0.020, 0.024, 0.038) * exp(-dot(q, q) * 1.6);
  return vec4f(c, 1.0);
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
    let col = mix(vec3f(0.010, 0.012, 0.018), vec3f(0.004, 0.0045, 0.007), smoothstep(0.3, 1.0, r));
    return vec4f(col, 1.0);
  }
  // walls: a breath of glass — brighter along the rim
  let rim = smoothstep(0.9, 1.0, in.local.y);
  let edge = smoothstep(0.94, 1.0, abs(in.local.x));
  let a = 0.025 + rim * 0.06 + edge * 0.03;
  return vec4f(vec3f(0.30, 0.38, 0.55) * a, a);
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
