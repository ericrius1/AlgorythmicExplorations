// Perspective billboard renderer. Each body becomes a camera-facing quad;
// additive blending is commutative, so no depth sorting is ever needed.

struct Camera {
  viewProj: mat4x4f,
  right: vec4f, // xyz = camera right, w = particle size
  up: vec4f,    // xyz = camera up,    w = speed-to-color scale
}

@group(0) @binding(0) var<uniform> C: Camera;
@group(0) @binding(1) var<storage, read> pos: array<vec4f>;
@group(0) @binding(2) var<storage, read> vel: array<vec4f>;

struct VOut {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
  @location(1) color: vec3f,
}

const QUAD = array<vec2f, 6>(
  vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
  vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
);

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  let q = QUAD[vi];
  let world = pos[ii].xyz + (C.right.xyz * q.x + C.up.xyz * q.y) * C.right.w;
  var o: VOut;
  o.clip = C.viewProj * vec4f(world, 1.0);
  o.uv = q;
  let t = clamp(length(vel[ii].xyz) * C.up.w, 0.0, 1.0);
  o.color = mix(vec3f(0.22, 0.40, 1.0), vec3f(1.0, 0.45, 0.25), t);
  return o;
}

@fragment
fn fs(in: VOut) -> @location(0) vec4f {
  let d = length(in.uv);
  let a = smoothstep(1.0, 0.0, d);
  return vec4f(in.color * a, a);
}
