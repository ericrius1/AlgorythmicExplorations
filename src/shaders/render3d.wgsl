// Perspective particle renderer. Each body is a screen-aligned sprite whose
// size shrinks with distance; additive blending is commutative, so no depth
// sorting is ever needed. Draws into an HDR target (see postfx.wgsl).

struct Camera {
  viewProj: mat4x4f,
  a: vec4f, // x = radius (world), y = speed-to-colour scale, z = intensity, w = min radius (NDC)
  b: vec4f, // x = projection y-scale (1 / tan(fov/2)), y = aspect
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

fn palette(t: f32) -> vec3f {
  let cold = vec3f(0.05, 0.11, 0.80);
  let mid = vec3f(0.42, 0.40, 0.95);
  let hot = vec3f(1.00, 0.42, 0.08);
  return mix(mix(cold, mid, smoothstep(0.0, 0.5, t)), hot, smoothstep(0.45, 1.0, t));
}

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  let q = QUAD[vi];
  var c = C.viewProj * vec4f(pos[ii].xyz, 1.0);
  let w = max(c.w, 1e-4);
  // radius on screen in NDC; grow sub-pixel sprites and dim them to match
  let r = C.a.x * C.b.x / w;
  let rr = max(r, C.a.w);
  var gain = (r * r) / (rr * rr);
  // gentle depth cue: the far side of the scene is a little dimmer
  gain *= mix(1.0, 0.55, smoothstep(1.6, 4.0, w));
  c = vec4f(c.xy + vec2f(q.x * rr / C.b.y, q.y * rr) * w, c.zw);
  var o: VOut;
  o.clip = c;
  o.uv = q;
  let t = clamp(length(vel[ii].xyz) * C.a.y, 0.0, 1.0);
  o.color = palette(t) * C.a.z * gain;
  return o;
}

@fragment
fn fs(in: VOut) -> @location(0) vec4f {
  let d2 = dot(in.uv, in.uv);
  let a = exp(-4.0 * d2) * (1.0 - smoothstep(0.6, 1.0, d2));
  return vec4f(in.color * a, 0.0);
}
