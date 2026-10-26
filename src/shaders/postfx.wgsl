// HDR finish for the particle demos: particles add light into a float
// target, a mip chain blurs it into bloom, and one last pass tone maps the
// result down to the 8-bit canvas.
//
// Bloom follows the dual-filter approach from Jimenez's "Next Generation
// Post Processing in Call of Duty: Advanced Warfare" (2014): a 13-tap
// downsample per level, then a 3×3 tent upsample added back up the chain.

struct Post {
  texel: vec2f,    // 1 / size of the level being sampled
  radius: f32,     // upsample filter radius, in source texels
  exposure: f32,
  bloom: f32,      // how much of the blurred chain mixes into the image
  levels: f32,     // number of blurred levels summed into mip 1
  vignette: f32,
  frame: f32,      // dither seed
  bg: vec4f,       // page background, display-encoded
}

@group(0) @binding(0) var<uniform> P: Post;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var src: texture_2d<f32>;
@group(0) @binding(3) var bloomTex: texture_2d<f32>;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VOut {
  // one triangle that covers the screen
  let p = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u));
  var o: VOut;
  o.pos = vec4f(p * 2.0 - 1.0, 0.0, 1.0);
  o.uv = vec2f(p.x, 1.0 - p.y);
  return o;
}

fn tap(uv: vec2f) -> vec3f {
  return textureSampleLevel(src, samp, uv, 0.0).rgb;
}

// 13 taps arranged as five overlapping 2×2 boxes, weighted so the result is
// a smooth, alias-free half-resolution copy.
@fragment
fn down(in: VOut) -> @location(0) vec4f {
  let t = P.texel;
  let uv = in.uv;
  let a = tap(uv + t * vec2f(-2.0, -2.0));
  let b = tap(uv + t * vec2f(0.0, -2.0));
  let c = tap(uv + t * vec2f(2.0, -2.0));
  let d = tap(uv + t * vec2f(-2.0, 0.0));
  let e = tap(uv);
  let f = tap(uv + t * vec2f(2.0, 0.0));
  let g = tap(uv + t * vec2f(-2.0, 2.0));
  let h = tap(uv + t * vec2f(0.0, 2.0));
  let i = tap(uv + t * vec2f(2.0, 2.0));
  let j = tap(uv + t * vec2f(-1.0, -1.0));
  let k = tap(uv + t * vec2f(1.0, -1.0));
  let l = tap(uv + t * vec2f(-1.0, 1.0));
  let m = tap(uv + t * vec2f(1.0, 1.0));
  var o = e * 0.125;
  o += (a + c + g + i) * 0.03125;
  o += (b + d + f + h) * 0.0625;
  o += (j + k + l + m) * 0.125;
  return vec4f(o, 1.0);
}

// 3×3 tent, added (by the blend state) onto the next larger level.
@fragment
fn up(in: VOut) -> @location(0) vec4f {
  let t = P.texel * P.radius;
  let uv = in.uv;
  var o = tap(uv) * 4.0;
  o += (tap(uv + vec2f(-t.x, 0.0)) + tap(uv + vec2f(t.x, 0.0))
      + tap(uv + vec2f(0.0, -t.y)) + tap(uv + vec2f(0.0, t.y))) * 2.0;
  o += tap(uv + vec2f(-t.x, -t.y)) + tap(uv + vec2f(t.x, -t.y))
     + tap(uv + vec2f(-t.x, t.y)) + tap(uv + vec2f(t.x, t.y));
  return vec4f(o / 16.0, 1.0);
}

// ACES filmic fit (Stephen Hill). Bright, dense regions roll off toward
// white instead of clipping to a flat colour.
fn aces(c: vec3f) -> vec3f {
  let m1 = mat3x3f(
    vec3f(0.59719, 0.07600, 0.02840),
    vec3f(0.35458, 0.90834, 0.13383),
    vec3f(0.04823, 0.01566, 0.83777),
  );
  let m2 = mat3x3f(
    vec3f(1.60475, -0.10208, -0.00327),
    vec3f(-0.53108, 1.10813, -0.07276),
    vec3f(-0.07367, -0.00605, 1.07602),
  );
  let v = m1 * c;
  let a = v * (v + 0.0245786) - 0.000090537;
  let b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return clamp(m2 * (a / b), vec3f(0.0), vec3f(1.0));
}

fn toSrgb(c: vec3f) -> vec3f {
  let lo = c * 12.92;
  let hi = 1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055;
  return select(hi, lo, c <= vec3f(0.0031308));
}

fn hash(p: vec2f) -> f32 {
  let q = fract(p * vec2f(0.1031, 0.1030));
  let r = q + dot(q, q.yx + 33.33);
  return fract((r.x + r.y) * r.x);
}

@fragment
fn present(in: VOut) -> @location(0) vec4f {
  let scene = textureSampleLevel(src, samp, in.uv, 0.0).rgb;
  let glow = textureSampleLevel(bloomTex, samp, in.uv, 0.0).rgb / max(P.levels, 1.0);
  var hdr = mix(scene, glow, P.bloom) * P.exposure;
  var c = toSrgb(aces(hdr));
  // a little darkening toward the corners keeps the eye in the middle
  let q = in.uv - 0.5;
  c *= 1.0 - P.vignette * dot(q, q) * 1.6;
  // particles sit on the page background; light only adds
  c = P.bg.rgb + c * (1.0 - P.bg.rgb);
  // triangular dither: soft glows otherwise band in 8 bits
  let n = hash(in.pos.xy + P.frame * 17.0) + hash(in.pos.xy * 1.37 - P.frame * 11.0) - 1.0;
  c += n / 255.0;
  return vec4f(c, 1.0);
}
