// Additive particle renderer: one instanced quad per body, coloured by
// speed, drawn into an HDR target (see postfx.wgsl). Addition doesn't care
// about draw order, so nothing is sorted.

struct RenderParams {
  scale: f32,
  aspect: f32,
  size: f32,       // radius in world units
  colorScale: f32, // speed that maps to the hot end of the palette
  intensity: f32,
  minRadius: f32,  // smallest radius in clip units (about one pixel)
  palette: f32,    // 0 = cold→hot, 1 = galaxy (warm core, blue disk), 2 = water
  offsetY: f32,    // shift the scene up (clip units), e.g. to clear a hero title
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

// slow: deep blue · middling: pale violet-white · fast: amber (linear light)
fn palette(t: f32) -> vec3f {
  let cold = vec3f(0.05, 0.11, 0.80);
  let mid = vec3f(0.42, 0.40, 0.95);
  let hot = vec3f(1.00, 0.42, 0.08);
  return mix(mix(cold, mid, smoothstep(0.0, 0.5, t)), hot, smoothstep(0.45, 1.0, t));
}

// Still water is deep blue; anything moving fast turns to pale foam.
fn waterPalette(t: f32) -> vec3f {
  let deep = vec3f(0.010, 0.050, 0.32);
  let mid = vec3f(0.030, 0.30, 0.80);
  let foam = vec3f(0.70, 0.88, 1.00);
  return mix(mix(deep, mid, smoothstep(0.0, 0.45, t)), foam, smoothstep(0.4, 1.0, t));
}

// Still keyed to speed, but laid out like a photograph of a spiral: the
// slow-turning core reads gold, the fast disk blue-white.
fn galaxyPalette(t: f32) -> vec3f {
  let core = vec3f(1.00, 0.58, 0.24);
  let mid = vec3f(0.62, 0.66, 1.00);
  let disk = vec3f(0.26, 0.42, 1.00);
  return mix(mix(core, mid, smoothstep(0.0, 0.5, t)), disk, smoothstep(0.45, 1.0, t));
}

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  let b = bodies[ii];
  let q = QUAD[vi];
  let r = R.size * R.scale;
  // Sub-pixel sprites flicker as they cross pixel boundaries. Grow them to
  // about a pixel and dim them by the same area, so total light is unchanged.
  let rr = max(r, R.minRadius);
  let gain = (r * r) / (rr * rr);
  let c = b.xy * R.scale;
  var o: VOut;
  o.pos = vec4f((c.x + q.x * rr) / R.aspect, c.y + q.y * rr + R.offsetY, 0.0, 1.0);
  o.uv = q;
  let t = clamp(length(b.zw) * R.colorScale, 0.0, 1.0);
  var col = palette(t);
  if (R.palette > 1.5) {
    col = waterPalette(t);
  } else if (R.palette > 0.5) {
    col = galaxyPalette(t);
  }
  o.color = col * R.intensity * gain;
  return o;
}

@fragment
fn fs(in: VOut) -> @location(0) vec4f {
  let d2 = dot(in.uv, in.uv);
  // gaussian core, faded to zero at the quad edge
  let a = exp(-4.0 * d2) * (1.0 - smoothstep(0.6, 1.0, d2));
  return vec4f(in.color * a, 0.0);
}
