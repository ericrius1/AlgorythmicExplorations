// Radiance cascades, 2D, vanilla recipe:
//
//   scene (emission rgb, occlusion a)
//     → seed + jump-flood → distance field          (where is the nearest surface?)
//     → cascades, top down                          (march short ray intervals, merge)
//     → composite                                   (average cascade 0 = light at every pixel)
//
// Cascade n: probes every 2·2ⁿ scene pixels, 4ⁿ⁺¹ directions per probe, each
// ray covering the interval [L·(4ⁿ−1)/3, L·(4ⁿ⁺¹−1)/3). Doubling probe
// spacing while quadrupling directions keeps every cascade the same number
// of texels — the trade at the heart of the technique: far light needs
// angular detail, not spatial detail.
//
// Layout is direction-first: cascade n's texture is a 2ⁿ⁺¹ × 2ⁿ⁺¹ grid of
// blocks, one per direction, each block holding the whole probe grid — so a
// single hardware bilinear tap inside a block interpolates the 4 nearest
// probes of one direction for free.

struct FullOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn vsFull(@builtin(vertex_index) vi: u32) -> FullOut {
  var pts = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var out: FullOut;
  out.pos = vec4f(pts[vi], 0.0, 1.0);
  out.uv = pts[vi] * vec2f(0.5, -0.5) + 0.5;
  return out;
}

// ---- seed: occupied pixels point at themselves --------------------------------

@group(0) @binding(1) var sceneTex: texture_2d<f32>;

@fragment
fn fsSeed(in: FullOut) -> @location(0) vec2f {
  let p = vec2i(in.pos.xy);
  let occ = textureLoad(sceneTex, p, 0).a;
  if (occ > 0.5) { return in.pos.xy; }
  return vec2f(-1e4, -1e4);
}

// ---- jump flood: every pixel learns its nearest seed ---------------------------

struct JfaParams { offset: f32, _p0: f32, _p1: f32, _p2: f32 }
@group(0) @binding(6) var<uniform> JU: JfaParams;
@group(0) @binding(5) var jfaTex: texture_2d<f32>;

@fragment
fn fsJfa(in: FullOut) -> @location(0) vec2f {
  let dims = vec2i(textureDimensions(jfaTex));
  let p = vec2i(in.pos.xy);
  var best = vec2f(-1e4, -1e4);
  var bestD = 1e12;
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      let q = clamp(p + vec2i(dx, dy) * i32(JU.offset), vec2i(0), dims - 1);
      let cand = textureLoad(jfaTex, q, 0).xy;
      if (cand.x < -9000.0) { continue; }
      let dd = dot(cand - in.pos.xy, cand - in.pos.xy);
      if (dd < bestD) { bestD = dd; best = cand; }
    }
  }
  return best;
}

@fragment
fn fsDist(in: FullOut) -> @location(0) f32 {
  let seed = textureLoad(jfaTex, vec2i(in.pos.xy), 0).xy;
  if (seed.x < -9000.0) { return 1e4; }
  return length(seed - in.pos.xy);
}

// ---- cascades ------------------------------------------------------------------

struct CascadeParams {
  probes: vec2f,        // probe grid this cascade
  upperProbes: vec2f,
  blocks: f32,          // directions per texture axis (2^(n+1))
  upperBlocks: f32,
  intervalStart: f32,   // scene pixels
  intervalLen: f32,
  isTop: f32,
  ambient: f32,
  _p0: f32,
  _p1: f32,
}

// The environment: what the top cascade merges with instead of darkness.
// strength (sunColor.w) = 0 keeps the old behaviour — a black void with a
// flat ambient term — so existing scenes don't change.
struct SkyParams {
  zenith: vec4f,   // rgb overhead
  horizon: vec4f,  // rgb at the horizon
  sun: vec4f,      // xy direction (scene px space, y down) · z sharpness · w intensity
  sunColor: vec4f, // rgb · w = overall sky strength
}

@group(0) @binding(0) var<uniform> CU: CascadeParams;
@group(0) @binding(2) var distTex: texture_2d<f32>;
@group(0) @binding(3) var upperTex: texture_2d<f32>;
@group(0) @binding(4) var linSamp: sampler;
@group(0) @binding(10) var<uniform> SU: SkyParams;

fn skyRadiance(dir: vec2f) -> vec3f {
  let strength = SU.sunColor.w;
  if (strength <= 0.0) { return vec3f(CU.ambient); }
  let up = -dir.y; // texture y runs down; up is where the sky lives
  let base = mix(SU.horizon.rgb, SU.zenith.rgb, smoothstep(-0.05, 0.8, up));
  let aboveGround = smoothstep(-0.5, -0.05, up); // fade to dark underfoot
  var col = base * aboveGround;
  let s = max(dot(dir, normalize(SU.sun.xy)), 0.0);
  col += SU.sunColor.rgb * pow(s, max(SU.sun.z, 1.0)) * SU.sun.w;
  return col * strength;
}

@fragment
fn fsCascade(in: FullOut) -> @location(0) vec4f {
  let texel = vec2u(in.pos.xy);
  let probesU = vec2u(CU.probes);
  let probe = texel % probesU;          // which probe (within a direction block)
  let block = texel / probesU;          // which direction block
  let blocks = u32(CU.blocks);
  let dirIdx = block.y * blocks + block.x;
  let dirCount = f32(blocks * blocks);

  let sceneRes = vec2f(textureDimensions(distTex));
  let spacing = sceneRes / CU.probes;
  let origin = (vec2f(probe) + 0.5) * spacing;

  let ang = 6.28318530718 * (f32(dirIdx) + 0.5) / dirCount;
  let dir = vec2f(cos(ang), sin(ang));

  // sphere-march the interval against the distance field
  var t = CU.intervalStart;
  var radiance = vec3f(0.0);
  var hit = false;
  let tEnd = CU.intervalStart + CU.intervalLen;
  for (var s = 0; s < 28; s++) {
    let pos = origin + dir * t;
    if (pos.x < 0.0 || pos.y < 0.0 || pos.x >= sceneRes.x || pos.y >= sceneRes.y) {
      break; // off the canvas: a miss — let the cascade above (or the sky) answer
    }
    let uv = pos / sceneRes;
    let d = textureSampleLevel(distTex, linSamp, uv, 0.0).r;
    if (d < 1.0) {
      radiance = textureSampleLevel(sceneTex, linSamp, uv, 0.0).rgb;
      hit = true;
      break;
    }
    t += max(d, 1.0);
    if (t >= tEnd) { break; }
  }

  // miss → this interval saw nothing; defer to the cascade above
  if (!hit) {
    if (CU.isTop > 0.5) {
      radiance = skyRadiance(dir);
    } else {
      let texFull = vec2f(textureDimensions(upperTex));
      let probeUV = (vec2f(probe) + 0.5) / CU.probes;
      let local = clamp(probeUV, vec2f(0.5) / CU.upperProbes, 1.0 - vec2f(0.5) / CU.upperProbes);
      let ublocks = u32(CU.upperBlocks);
      var sum = vec3f(0.0);
      for (var k = 0u; k < 4u; k++) {
        let child = dirIdx * 4u + k;
        let cb = vec2f(f32(child % ublocks), f32(child / ublocks));
        let uv = (cb + local) * CU.upperProbes / texFull;
        sum += textureSampleLevel(upperTex, linSamp, uv, 0.0).rgb;
      }
      radiance = sum * 0.25;
    }
  }
  return vec4f(radiance, 1.0);
}

// ---- composite -------------------------------------------------------------------

struct CompositeParams {
  probes0: vec2f,
  exposure: f32,
  debugMode: f32, // 0 final · 1 scene · 2 occupancy · 3 distance · 4 light only
  emitBoost: f32,
  _p0: f32,
  _p1: f32,
  _p2: f32,
}

@group(0) @binding(7) var<uniform> CP: CompositeParams;
@group(0) @binding(8) var cascade0Tex: texture_2d<f32>;

fn hashRC(p: vec2f) -> f32 {
  var q = fract(p * vec2f(123.34, 456.21));
  q += dot(q, q + 45.32);
  return fract(q.x * q.y);
}

@fragment
fn fsComposite(in: FullOut) -> @location(0) vec4f {
  let texFull = vec2f(textureDimensions(cascade0Tex));
  let local = clamp(in.uv, vec2f(0.5) / CP.probes0, 1.0 - vec2f(0.5) / CP.probes0);
  var fluence = vec3f(0.0);
  for (var d = 0u; d < 4u; d++) {
    let cb = vec2f(f32(d % 2u), f32(d / 2u));
    let uv = (cb + local) * CP.probes0 / texFull;
    fluence += textureSampleLevel(cascade0Tex, linSamp, uv, 0.0).rgb;
  }
  fluence *= 0.25;

  let scene = textureSampleLevel(sceneTex, linSamp, in.uv, 0.0);

  let mode = u32(CP.debugMode);
  if (mode == 1u) { return vec4f(pow(scene.rgb, vec3f(0.4545)), 1.0); }
  if (mode == 2u) { return vec4f(vec3f(scene.a), 1.0); }
  if (mode == 3u) {
    let d = textureSampleLevel(distTex, linSamp, in.uv, 0.0).r;
    return vec4f(vec3f(fract(d / 32.0)) * vec3f(0.6, 0.75, 1.0), 1.0);
  }

  var col = fluence;
  if (mode == 0u) { col = fluence + scene.rgb * CP.emitBoost; }
  col *= CP.exposure;
  col = col / (1.0 + col);                 // gentle reinhard
  col = pow(col, vec3f(0.4545));           // to gamma
  // ±half an 8-bit step of dither breaks banding in slow gradients
  col += (hashRC(in.pos.xy) - 0.5) / 255.0;
  return vec4f(col, 1.0);
}

// ---- temporal accumulation ---------------------------------------------------------
// Exponential moving average over cascade 0. The GI's noise — embers winking
// in and out of rays, the one-frame bounce feedback — is zero-mean frame to
// frame, so a short history integrates it away almost free.

struct TemporalParams { alpha: f32, _p0: f32, _p1: f32, _p2: f32 }
@group(0) @binding(11) var histTex: texture_2d<f32>;
@group(0) @binding(12) var<uniform> TU: TemporalParams;

@fragment
fn fsTemporal(in: FullOut) -> @location(0) vec4f {
  let p = vec2i(in.pos.xy);
  let cur = textureLoad(cascade0Tex, p, 0);
  let hist = textureLoad(histTex, p, 0);
  return mix(hist, cur, TU.alpha);
}

// ---- brush (paint demo): stamp emission / walls / eraser into the scene -----------

struct BrushParams {
  center: vec2f, // scene pixels
  res: vec2f,
  radius: f32,
  hardness: f32,
  _p0: f32,
  _p1: f32,
  color: vec4f,  // rgb emission, a occlusion
}

@group(0) @binding(9) var<uniform> BU: BrushParams;

struct BrushOut {
  @builtin(position) pos: vec4f,
  @location(0) local: vec2f,
}

@vertex
fn vsBrush(@builtin(vertex_index) vi: u32) -> BrushOut {
  var corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
  );
  let c = corners[vi];
  let px = BU.center + c * BU.radius;
  var out: BrushOut;
  out.pos = vec4f(px / BU.res * 2.0 - 1.0, 0.0, 1.0);
  out.pos.y = -out.pos.y; // pixel y runs down, clip y runs up
  out.local = c;
  return out;
}

@fragment
fn fsBrush(in: BrushOut) -> @location(0) vec4f {
  let q = length(in.local);
  if (q > 1.0) { discard; }
  let a = 1.0 - smoothstep(BU.hardness, 1.0, q);
  return vec4f(BU.color.rgb * a, BU.color.a * a);
}
