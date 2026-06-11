// Fullscreen colormap for the Poisson painter: painted density glows warm,
// the solved potential reads as blue depth with contour lines — a live
// topographic map of the gravity well. stat[0] holds the deepest well
// (written by pm.wgsl's gradient pass) so the palette self-normalizes.

struct FieldParams {
  dim: u32,
  aspect: f32,
  contours: f32,
  _pad: f32,
}

@group(0) @binding(0) var<uniform> F: FieldParams;
@group(0) @binding(1) var<storage, read> spec: array<vec2f>;
@group(0) @binding(2) var<storage, read> paint: array<f32>;
@group(0) @binding(3) var<storage, read> stat: array<u32>;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VOut {
  // one oversized triangle
  let xy = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u)) * 2.0 - 1.0;
  var o: VOut;
  o.pos = vec4f(xy, 0.0, 1.0);
  o.uv = vec2f(xy.x, xy.y) * 0.5 + 0.5;
  return o;
}

// Match BoxRenderer's mapping: the box is centered and fills the canvas
// height; a wide canvas shows the periodic images on either side.
fn cellAt(uv: vec2f) -> u32 {
  let box = fract(vec2f(0.5 + (uv.x - 0.5) * F.aspect, uv.y));
  let c = vec2u(min(box, vec2f(0.9999)) * f32(F.dim));
  return c.y * F.dim + c.x;
}

@fragment
fn fs(in: VOut) -> @location(0) vec4f {
  let i = cellAt(in.uv);
  let deepest = max(f32(stat[0]) / 4096.0, 1.0e-6);
  let depth = clamp(-spec[i].x / deepest, 0.0, 1.0); // 0 flat .. 1 deepest well
  let rho = paint[i];

  // potential: blue, deeper = brighter; contour lines like a topo map
  var col = mix(vec3f(0.024, 0.027, 0.043), vec3f(0.18, 0.38, 0.9), pow(depth, 1.1));
  let line = abs(fract(depth * F.contours) - 0.5);
  col *= 1.0 - 0.65 * smoothstep(0.18, 0.0, line) * step(0.004, depth);

  // painted mass: warm glow on top
  col += vec3f(1.0, 0.55, 0.25) * clamp(rho * 0.25, 0.0, 1.2);
  return vec4f(col, 1.0);
}
