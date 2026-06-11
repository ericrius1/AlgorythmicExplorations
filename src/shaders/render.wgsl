// Minimal additive particle renderer: one instanced quad per body,
// colored by speed.

struct RenderParams {
  scale: f32,
  aspect: f32,
  size: f32,
  colorScale: f32,
}

@group(0) @binding(0) var<uniform> R: RenderParams;
@group(0) @binding(1) var<storage, read> bodies: array<vec4f>;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) color: vec3f,
}

const QUAD = array<vec2f, 6>(
  vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
  vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
);

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  let b = bodies[ii];
  let q = QUAD[vi];
  let wp = b.xy + q * R.size;
  var o: VOut;
  o.pos = vec4f(wp.x * R.scale / R.aspect, wp.y * R.scale, 0.0, 1.0);
  o.uv = q;
  let t = clamp(length(b.zw) * R.colorScale, 0.0, 1.0);
  o.color = mix(vec3f(0.25, 0.42, 1.0), vec3f(1.0, 0.42, 0.22), t);
  return o;
}

@fragment
fn fs(in: VOut) -> @location(0) vec4f {
  let d = length(in.uv);
  let a = smoothstep(1.0, 0.0, d);
  return vec4f(in.color * a, a);
}
