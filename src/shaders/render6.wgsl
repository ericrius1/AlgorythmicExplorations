// Part six's paint layer. Particles render as velocity-stretched capsules
// into a persistent HDR accumulation texture; a fade pass dims last frame's
// light instead of clearing it, which is where the silk trails come from;
// a final blit tonemaps the accumulated energy onto the canvas. Hands show
// up as additive glow lines drawn into the same accumulation.

struct R {
  viewProj: mat4x4f,
  right: vec4f,   // xyz camera right, w particle half-size (ndc-ish)
  up: vec4f,      // xyz camera up,    w velocity stretch (seconds of tail)
  colA: vec4f,    // slow color,  w speed-to-color scale
  colB: vec4f,    // mid color,   w unused
  colC: vec4f,    // fast color,  w unused
  misc: vec4f,    // x exposure, y aspect, z time, w glow gain
}

@group(0) @binding(0) var<uniform> U: R;
@group(0) @binding(1) var<storage, read> pos: array<vec4f>;
@group(0) @binding(2) var<storage, read> vel: array<vec4f>;

struct VOut {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
  @location(1) color: vec3f,
  @location(2) core: f32, // |uv.x| below this is the segment, above is cap
}

const QUAD = array<vec2f, 6>(
  vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
  vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
);

fn palette(t: f32) -> vec3f {
  if (t < 0.5) { return mix(U.colA.rgb, U.colB.rgb, t * 2.0); }
  return mix(U.colB.rgb, U.colC.rgb, (t - 0.5) * 2.0);
}

@vertex
fn vsParticle(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  let q = QUAD[vi];
  let p = pos[ii];
  let v = vel[ii].xyz;
  let head = p.xyz;
  let tail = p.xyz - v * U.up.w;

  let c0 = U.viewProj * vec4f(head, 1.0);
  let c1 = U.viewProj * vec4f(tail, 1.0);
  // screen-space geometry: aspect-corrected ndc so widths are isotropic
  let sxy = vec2f(U.misc.y, 1.0);
  let s0 = c0.xy / max(c0.w, 0.01) * sxy;
  let s1 = c1.xy / max(c1.w, 0.01) * sxy;
  let d = s1 - s0;
  let len = length(d);
  var dir = vec2f(1.0, 0.0);
  if (len > 1e-5) { dir = d / len; }
  let perp = vec2f(-dir.y, dir.x);

  // pick this vertex's end of the capsule; size shrinks with distance via w
  let cEnd = select(c0, c1, q.x > 0.0);
  let sEnd = select(s0, s1, q.x > 0.0);
  let halfW = U.right.w / max(cEnd.w, 0.2);
  let sPos = sEnd + dir * q.x * halfW + perp * q.y * halfW;

  var o: VOut;
  o.clip = vec4f(sPos / sxy * cEnd.w, cEnd.z, cEnd.w);
  o.uv = q * vec2f((len * 0.5 + halfW) / halfW, 1.0); // uv.x in capsule units
  o.core = len * 0.5 / halfW;
  let t = clamp(length(v) * U.colA.w, 0.0, 1.0);
  let lifeFade = smoothstep(0.0, 0.7, p.w);
  o.color = palette(t) * lifeFade;
  return o;
}

@fragment
fn fsParticle(in: VOut) -> @location(0) vec4f {
  // capsule falloff: distance to the segment, in cap-radius units
  let dc = length(vec2f(max(abs(in.uv.x) - in.core, 0.0), in.uv.y));
  let a = pow(max(1.0 - dc, 0.0), 2.0);
  return vec4f(in.color * a * U.misc.w, a);
}

// ---- hand skeleton: additive glow lines ------------------------------------

@group(0) @binding(3) var<storage, read> lines: array<vec4f>; // xyz pos, w alpha

struct LOut {
  @builtin(position) clip: vec4f,
  @location(0) alpha: f32,
}

@vertex
fn vsLine(@builtin(vertex_index) vi: u32) -> LOut {
  let l = lines[vi];
  var o: LOut;
  o.clip = U.viewProj * vec4f(l.xyz, 1.0);
  o.alpha = l.w;
  return o;
}

@fragment
fn fsLine(in: LOut) -> @location(0) vec4f {
  let c = vec3f(0.65, 0.85, 1.0) * in.alpha * 0.5;
  return vec4f(c, in.alpha * 0.5);
}

// ---- fade pass: multiply the accumulation by a constant (the trail knob) ---

@vertex
fn vsFade(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  // fullscreen triangle
  let xy = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u)) * 2.0 - 1.0;
  return vec4f(xy, 0.0, 1.0);
}

@fragment
fn fsFade() -> @location(0) vec4f {
  // blend is (src * 0 + dst * blendConstant); output value is irrelevant
  return vec4f(0.0);
}

// ---- blit: tonemap accumulated light onto the canvas ------------------------

@group(0) @binding(0) var accumTex: texture_2d<f32>;
@group(0) @binding(1) var accumSamp: sampler;
@group(0) @binding(2) var<uniform> B: R;

struct BOut {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn vsBlit(@builtin(vertex_index) vi: u32) -> BOut {
  let xy = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u)) * 2.0 - 1.0;
  var o: BOut;
  o.clip = vec4f(xy, 0.0, 1.0);
  o.uv = vec2f(xy.x, -xy.y) * 0.5 + 0.5;
  return o;
}

@fragment
fn fsBlit(in: BOut) -> @location(0) vec4f {
  let hdr = textureSample(accumTex, accumSamp, in.uv).rgb;
  var c = vec3f(1.0) - exp(-hdr * B.misc.x);
  // deep-space backdrop with a gentle vignette so trails read as glow
  let r = length(in.uv - 0.5);
  let bg = mix(vec3f(0.030, 0.032, 0.052), vec3f(0.008, 0.008, 0.016), smoothstep(0.1, 0.75, r));
  c = bg + c;
  return vec4f(pow(c, vec3f(0.92)), 1.0);
}
