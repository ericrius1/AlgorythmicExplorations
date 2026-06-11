// Part five's particle renderer: same additive speed-colored quads as
// render.wgsl, but positions live in box units [0,1) and the box is
// periodic — `tiles` instances per particle draw its neighbouring images,
// so a wide canvas shows the universe repeating instead of empty margins.
// tiles = 1 (just the box), 3 (x-row: -1, 0, +1), or 9 (full 3×3).

struct RenderParams {
  scale: f32,
  aspect: f32,
  size: f32,
  colorScale: f32,
  tiles: u32,
  count: u32,
}

@group(0) @binding(0) var<uniform> R: RenderParams;
@group(0) @binding(1) var<storage, read> parts: array<vec4f>;

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
  let copy = ii % R.tiles;
  let b = parts[ii / R.tiles];
  var off = vec2f(0.0);
  if (R.tiles == 3u) {
    off = vec2f(f32(copy) - 1.0, 0.0);
  } else if (R.tiles == 9u) {
    off = vec2f(f32(copy % 3u) - 1.0, f32(copy / 3u) - 1.0);
  }
  let q = QUAD[vi];
  let wp = (b.xy - 0.5 + off) * 2.0 * R.scale;
  var o: VOut;
  o.pos = vec4f((wp.x + q.x * R.size) / R.aspect, wp.y + q.y * R.size, 0.0, 1.0);
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
