// Part five: a progressive path tracer, aimed at the Cornell box.
// fsTrace adds `spp` fresh Monte Carlo samples per pixel on top of the running
// sum in prevTex (rgba32float: rgb = Σ radiance, a = Σ luminance², which the
// noise readout uses). fsDisplay divides by the sample count, upsamples
// bilinearly to the canvas, and hands linear HDR to PostFX for tone mapping.
//
// Three things keep the figures that aren't about noise quiet:
//   · the first bounce's light sample and direction come from a Halton
//     sequence, rotated per pixel by a blue-noise tile (Cranley–Patterson),
//     so samples within a pixel are stratified and the leftover error is
//     fine and even instead of blotchy
//   · paths that reach the lamp only through the metal sphere after a
//     diffuse bounce (its caustic) are capped, since nothing else can find them
//   · fsFilter, an edge-aware blur that runs only while the sum is young. It
//     never mixes pixels across different surfaces, normals or depths, it
//     backs off where neighbours differ by more than their own noise, and its
//     radius shrinks as samples arrive, so the converged image is unfiltered.
//
// The scene is analytic and tiny: the box (floor, ceiling, three walls, open
// at the front), a ceiling lamp you can move and resize, one matte sphere and
// one sphere whose material is a knob (matte / mirror / glossy). In the hero
// the box also sits on a dark floor, so light spills out of the opening.

struct TraceParams {
  res: vec2f,        // trace buffer size, px
  frame: f32,        // frames since the last reset (0 = start a fresh sum)
  spp: f32,          // samples added per pixel this frame
  lightPos: vec2f,   // lamp centre, xz on the ceiling
  lightSize: vec2f,  // lamp half-extents, xz
  maxBounces: f32,
  nee: f32,          // 1: sample the lamp directly at every diffuse bounce
  matB: f32,         // sphere B: 0 matte · 1 mirror · 2 glossy
  rough: f32,        // glossy blur
  count: f32,        // samples per pixel in the sum being displayed
  lightLe: f32,      // lamp radiance
  stage: f32,        // 1: the box sits on an outside floor
  seed: f32,         // per-frame RNG seed
  eye: vec4f,        // camera position · w: focal length
  look: vec4f,       // look-at point · w: exposure
  opts: vec4f,       // x: 1 = blue-noise Halton sampling · y: filter strength · z: samples before this frame · w: caustic cap (0 = none)
}

@group(0) @binding(0) var<uniform> TP: TraceParams;
@group(0) @binding(1) var prevTex: texture_2d<f32>;
@group(0) @binding(2) var accumTex: texture_2d<f32>;
@group(0) @binding(7) var blueTex: texture_2d<f32>;
@group(0) @binding(8) var guideTex: texture_2d<f32>;

struct FullOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn vsFullC(@builtin(vertex_index) vi: u32) -> FullOut {
  var pts = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var out: FullOut;
  out.pos = vec4f(pts[vi], 0.0, 1.0);
  out.uv = pts[vi] * vec2f(0.5, -0.5) + 0.5;
  return out;
}

// ---- rng: PCG hash, seeded from pixel and frame ----------------------------------

fn pcg(v: u32) -> u32 {
  let s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}

var<private> rngState: u32;

fn rnd() -> f32 {
  rngState = pcg(rngState);
  return f32(rngState >> 8u) / 16777216.0; // 24 bits, so it never rounds up to 1
}

// ---- stratified samples for the first bounce --------------------------------------
// Halton dimensions 0–3 (bases 2, 3, 5, 7), indexed by the sample's number in
// this pixel's sum and shifted by blue noise. Only the first bounce uses them;
// deeper bounces stay with plain random numbers, which keeps every dimension
// independent of the others.

var<private> pixC: vec2u;
var<private> sIdx: u32;

fn radInv(i: u32, b: u32) -> f32 {
  var r = 0.0;
  var f = 1.0 / f32(b);
  var n = i;
  for (var k = 0; k < 20; k++) {
    if (n == 0u) { break; }
    r += f * f32(n % b);
    n = n / b;
    f = f / f32(b);
  }
  return r;
}

fn lds(d: u32) -> f32 {
  if (TP.opts.x < 0.5) { return rnd(); }
  let i = sIdx + 1u;
  var h = 0.0;
  var o = vec2u(0u, 0u);
  if (d == 0u) { h = f32(reverseBits(i) >> 8u) / 16777216.0; }
  else if (d == 1u) { h = radInv(i, 3u); o = vec2u(32u, 0u); }
  else if (d == 2u) { h = radInv(i, 5u); o = vec2u(0u, 32u); }
  else { h = radInv(i, 7u); o = vec2u(32u, 32u); }
  let shift = textureLoad(blueTex, vec2i((pixC + o) & vec2u(63u)), 0).r;
  return min(fract(h + shift), 0.99999994);
}

// ---- scene ------------------------------------------------------------------------
// the box: x ∈ [−1,1], y ∈ [0,2], z ∈ [−1,1], open toward +z

const WHITE: vec3f = vec3f(0.73);
const RED: vec3f = vec3f(0.63, 0.065, 0.05);
const GREEN: vec3f = vec3f(0.14, 0.45, 0.091);
const OUTSIDE: vec3f = vec3f(0.2, 0.19, 0.18);   // the box's outer skin
const STAGE: vec3f = vec3f(0.23, 0.22, 0.21);    // the floor it stands on
const SPHERE_A: vec4f = vec4f(-0.45, 0.5, -0.35, 0.5);
const SPHERE_B: vec4f = vec4f(0.5, 0.35, 0.35, 0.35);

struct Hit {
  t: f32,
  n: vec3f,       // faces the incoming ray
  albedo: vec3f,
  mat: i32,       // 0 diffuse · 1 mirror · 2 glossy · 3 lamp · −1 nothing
}

fn hitSphere(ro: vec3f, rd: vec3f, s: vec4f) -> f32 {
  let oc = ro - s.xyz;
  let b = dot(oc, rd);
  let det = b * b - (dot(oc, oc) - s.w * s.w);
  if (det < 0.0) { return -1.0; }
  let r = sqrt(det);
  let t1 = -b - r;
  if (t1 > 1e-4) { return t1; }
  let t2 = -b + r;
  if (t2 > 1e-4) { return t2; }
  return -1.0;
}

// distance along the ray to the plane p[axis] = c, or −1
fn planeT(ro: vec3f, rd: vec3f, axis: i32, c: f32) -> f32 {
  let d = rd[axis];
  if (abs(d) < 1e-7) { return -1.0; }
  let t = (c - ro[axis]) / d;
  return select(-1.0, t, t > 1e-4);
}

fn intersect(ro: vec3f, rd: vec3f) -> Hit {
  var h: Hit;
  h.t = 1e9;
  h.mat = -1;

  // walls are two-sided: light from outside must not leak through them
  // floor y = 0 (inside the box, plus the stage floor around it in the hero)
  var t = planeT(ro, rd, 1, 0.0);
  if (t > 0.0 && t < h.t && rd.y < 0.0) {
    let p = ro + rd * t;
    let inBox = abs(p.x) < 1.0 && abs(p.z) < 1.0;
    if (inBox || (TP.stage > 0.5 && abs(p.x) < 40.0 && p.z < 40.0)) {
      h.t = t; h.n = vec3f(0.0, 1.0, 0.0); h.mat = 0;
      h.albedo = select(STAGE, WHITE, inBox);
    }
  }
  // ceiling y = 2, with the lamp cut into its underside
  t = planeT(ro, rd, 1, 2.0);
  if (t > 0.0 && t < h.t) {
    let p = ro + rd * t;
    if (abs(p.x) < 1.0 && abs(p.z) < 1.0) {
      let below = rd.y > 0.0;
      h.t = t; h.n = vec3f(0.0, select(1.0, -1.0, below), 0.0); h.mat = 0;
      h.albedo = select(OUTSIDE, WHITE, below);
      if (below && abs(p.x - TP.lightPos.x) < TP.lightSize.x && abs(p.z - TP.lightPos.y) < TP.lightSize.y) {
        h.mat = 3;
      }
    }
  }
  // back wall z = −1
  t = planeT(ro, rd, 2, -1.0);
  if (t > 0.0 && t < h.t) {
    let p = ro + rd * t;
    if (abs(p.x) < 1.0 && p.y > 0.0 && p.y < 2.0) {
      let inside = rd.z < 0.0;
      h.t = t; h.n = vec3f(0.0, 0.0, select(-1.0, 1.0, inside)); h.mat = 0;
      h.albedo = select(OUTSIDE, WHITE, inside);
    }
  }
  // left wall x = −1: red on the inside
  t = planeT(ro, rd, 0, -1.0);
  if (t > 0.0 && t < h.t) {
    let p = ro + rd * t;
    if (p.y > 0.0 && p.y < 2.0 && abs(p.z) < 1.0) {
      let inside = rd.x < 0.0;
      h.t = t; h.n = vec3f(select(-1.0, 1.0, inside), 0.0, 0.0); h.mat = 0;
      h.albedo = select(OUTSIDE, RED, inside);
    }
  }
  // right wall x = 1: green on the inside
  t = planeT(ro, rd, 0, 1.0);
  if (t > 0.0 && t < h.t) {
    let p = ro + rd * t;
    if (p.y > 0.0 && p.y < 2.0 && abs(p.z) < 1.0) {
      let inside = rd.x > 0.0;
      h.t = t; h.n = vec3f(select(1.0, -1.0, inside), 0.0, 0.0); h.mat = 0;
      h.albedo = select(OUTSIDE, GREEN, inside);
    }
  }

  // sphere A: matte, rear left
  t = hitSphere(ro, rd, SPHERE_A);
  if (t > 0.0 && t < h.t) {
    h.t = t;
    h.n = normalize(ro + rd * t - SPHERE_A.xyz);
    h.albedo = WHITE;
    h.mat = 0;
  }
  // sphere B: the material knob, front right
  t = hitSphere(ro, rd, SPHERE_B);
  if (t > 0.0 && t < h.t) {
    h.t = t;
    h.n = normalize(ro + rd * t - SPHERE_B.xyz);
    h.mat = i32(TP.matB);
    h.albedo = select(vec3f(0.9, 0.72, 0.42), WHITE, h.mat == 0); // gold when it's metal
  }
  return h;
}

fn lightLe() -> vec3f {
  return vec3f(1.0, 0.86, 0.68) * TP.lightLe;
}

// cosine-weighted hemisphere around n: importance sampling the Lambert lobe
fn cosineDir(n: vec3f) -> vec3f {
  return cosineDirU(n, rnd(), rnd());
}

fn cosineDirU(n: vec3f, u1: f32, u2: f32) -> vec3f {
  let r1 = u1 * 6.28318530718;
  let r2 = u2;
  let sr2 = sqrt(r2);
  let u = normalize(cross(n, select(vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), abs(n.y) > 0.9)));
  let v = cross(n, u);
  return normalize(u * (cos(r1) * sr2) + v * (sin(r1) * sr2) + n * sqrt(1.0 - r2));
}

fn inUnitSphere() -> vec3f {
  let z = rnd() * 2.0 - 1.0;
  let a = rnd() * 6.28318530718;
  let r = sqrt(max(1.0 - z * z, 0.0));
  return vec3f(r * cos(a), r * sin(a), z) * pow(rnd(), 1.0 / 3.0);
}

fn tracePath(ro0: vec3f, rd0: vec3f) -> vec3f {
  var ro = ro0;
  var rd = rd0;
  var throughput = vec3f(1.0);
  var radiance = vec3f(0.0);
  // the camera counts as specular: looking straight at the lamp must show it
  var specularLast = true;
  var diffuseSeen = false;

  let bounces = i32(TP.maxBounces);
  for (var b = 0; b < 12; b++) {
    if (b >= bounces) { break; }
    let h = intersect(ro, rd);
    if (h.mat < 0) { break; } // out of the open front, into the dark

    let p = ro + rd * h.t;

    if (h.mat == 3) {
      // hit the lamp. If light sampling already paid for this path at the
      // last diffuse bounce, counting it again would double it; after a
      // mirror, light sampling couldn't see the lamp, so this is the only way
      if (TP.nee < 0.5 || specularLast) {
        var add = throughput * lightLe();
        // diffuse → metal → lamp: the sphere's caustic. Light sampling can't
        // see through a mirror, so these paths are rare and very bright.
        let cap = TP.opts.w;
        if (cap > 0.0 && diffuseSeen && TP.nee > 0.5) {
          let l = dot(add, vec3f(0.2126, 0.7152, 0.0722));
          if (l > cap) { add *= cap / l; }
        }
        radiance += add;
      }
      break;
    }

    if (h.mat == 1 || h.mat == 2) {
      // mirror, or a mirror with its reflection scattered into a blur
      var r = reflect(rd, h.n);
      if (h.mat == 2) {
        r = normalize(r + inUnitSphere() * TP.rough);
        if (dot(r, h.n) <= 0.0) { r = reflect(r, h.n); }
      }
      throughput *= h.albedo;
      ro = p + h.n * 1e-4;
      rd = r;
      specularLast = true;
      continue;
    }

    // diffuse. Next-event estimation: ask the lamp directly.
    let first = b == 0;
    if (TP.nee > 0.5) {
      let u0 = select(rnd(), lds(0u), first);
      let u1 = select(rnd(), lds(1u), first);
      let lp = vec3f(
        TP.lightPos.x + (u0 * 2.0 - 1.0) * TP.lightSize.x,
        2.0,
        TP.lightPos.y + (u1 * 2.0 - 1.0) * TP.lightSize.y,
      );
      let toL = lp - p;
      let d2 = dot(toL, toL);
      let ld = toL * inverseSqrt(d2);
      let cosS = dot(h.n, ld);
      let cosL = ld.y; // the lamp faces straight down
      if (cosS > 0.0 && cosL > 0.0) {
        let sh = intersect(p + h.n * 1e-4, ld);
        if (sh.mat == 3) {
          // pdf is 1/area over the lamp; convert to solid angle: d² / (cosL · area)
          let area = 4.0 * TP.lightSize.x * TP.lightSize.y;
          radiance += throughput * (h.albedo / 3.14159265) * lightLe() * (cosS * cosL * area / d2);
        }
      }
    }

    // continue: cosine sampling cancels the cosθ/π of the Lambert BRDF,
    // so the throughput just picks up the surface colour
    throughput *= h.albedo;
    ro = p + h.n * 1e-4;
    if (first) {
      let u2 = lds(2u);
      let u3 = lds(3u);
      rd = cosineDirU(h.n, u2, u3);
    } else {
      rd = cosineDir(h.n);
    }
    specularLast = false;
    diffuseSeen = true;

    // russian roulette after a few bounces keeps deep paths cheap and unbiased
    if (b > 2) {
      let q = min(max(throughput.x, max(throughput.y, throughput.z)), 0.95);
      if (rnd() > q) { break; }
      throughput /= q;
    }
  }
  return radiance;
}

fn cameraRay(pix: vec2f) -> array<vec3f, 2> {
  let eye = TP.eye.xyz;
  let fwd = normalize(TP.look.xyz - eye);
  let right = normalize(cross(fwd, vec3f(0.0, 1.0, 0.0)));
  let up = cross(right, fwd);
  let uv = pix / TP.res;
  let aspect = TP.res.x / TP.res.y;
  let px = (uv.x * 2.0 - 1.0) * aspect;
  let py = 1.0 - uv.y * 2.0;
  return array<vec3f, 2>(eye, normalize(fwd * TP.eye.w + right * px + up * py));
}

struct TraceOut {
  @location(0) sum: vec4f,
  @location(1) guide: vec4f,
}

// octahedral normal encoding, for the guide buffer
fn octEncode(n: vec3f) -> vec2f {
  let p = n.xy / (abs(n.x) + abs(n.y) + abs(n.z));
  if (n.z >= 0.0) { return p; }
  return (1.0 - abs(p.yx)) * select(vec2f(-1.0), vec2f(1.0), p >= vec2f(0.0));
}

fn octDecode(e: vec2f) -> vec3f {
  var n = vec3f(e, 1.0 - abs(e.x) - abs(e.y));
  if (n.z < 0.0) {
    let xy = (1.0 - abs(n.yx)) * select(vec2f(-1.0), vec2f(1.0), n.xy >= vec2f(0.0));
    n = vec3f(xy, n.z);
  }
  return normalize(n);
}

// a number that is equal only for the same material and surface colour
fn surfaceKey(h: Hit) -> f32 {
  if (h.mat < 0) { return -1.0; }
  return f32(h.mat) * 10000.0 + round(h.albedo.r * 99.0) * 100.0 + round(h.albedo.g * 99.0);
}

@fragment
fn fsTrace(in: FullOut) -> TraceOut {
  let pix = vec2u(in.pos.xy);
  rngState = pcg(pix.x + pcg(pix.y + pcg(u32(TP.seed))));
  pixC = pix;

  var prev = vec4f(0.0);
  if (TP.frame > 0.5) {
    prev = textureLoad(prevTex, vec2i(pix), 0);
  }

  var sum = vec3f(0.0);
  var sumSq = 0.0;
  let n = i32(TP.spp);
  for (var s = 0; s < 16; s++) {
    if (s >= n) { break; }
    sIdx = u32(TP.opts.z) + u32(s);
    // a random point inside the pixel each time: antialiasing for free
    let ray = cameraRay(vec2f(pix) + vec2f(rnd(), rnd()));
    let L = tracePath(ray[0], ray[1]);
    sum += L;
    let lum = dot(L, vec3f(0.2126, 0.7152, 0.0722));
    sumSq += lum * lum;
  }

  // what the pixel centre sees first, for the filter
  let c = cameraRay(vec2f(pix) + 0.5);
  let h = intersect(c[0], c[1]);
  var out: TraceOut;
  out.sum = vec4f(prev.rgb + sum, prev.a + sumSq);
  out.guide = vec4f(octEncode(h.n), h.t, surfaceKey(h));
  return out;
}

// ---- the edge-aware filter (young sums only) ---------------------------------------

fn lumOf(c: vec3f) -> f32 {
  return dot(c, vec3f(0.2126, 0.7152, 0.0722));
}

@fragment
fn fsFilter(in: FullOut) -> @location(0) vec4f {
  let p = vec2i(in.pos.xy);
  let mx = vec2i(textureDimensions(accumTex)) - 1;
  let c = textureLoad(accumTex, p, 0);
  let g = textureLoad(guideTex, p, 0);
  let strength = TP.opts.y;
  let mat = floor(g.w / 10000.0);
  // the lamp and the open front stay as traced
  if (strength <= 0.0 || g.w < 0.0 || mat > 2.5) { return c; }

  let n = max(TP.count, 1.0);
  let np = octDecode(g.xy);
  let rp = cameraRay(vec2f(p) + 0.5);
  let xp = rp[0] + rp[1] * g.z;
  // this pixel's own noise: the standard error of its mean luminance
  let mean = lumOf(c.rgb) / n;
  let var1 = max(c.a / n - mean * mean, 0.0) * n / max(n - 1.0, 1.0);
  let se = sqrt(var1 / n);
  // how different two pixels may be, relative to their brightness, before
  // the difference counts as real: a few times this pixel's own noise
  let lumTol = 2.5 * se + 0.03 * mean + 1e-4;
  let relTol = 2.5 * se / max(mean, 1e-4) + 0.04;
  let metal = mat > 0.5;
  let sigma = 2.0 * strength;
  let planeTol = 0.01 * g.z;

  var acc = c;
  var wsum = 1.0;
  for (var dy = -3; dy <= 3; dy++) {
    for (var dx = -3; dx <= 3; dx++) {
      if (dx == 0 && dy == 0) { continue; }
      let d = vec2i(dx, dy);
      let q = clamp(p + d, vec2i(0), mx);
      let gq = textureLoad(guideTex, q, 0);
      if (abs(gq.w - g.w) > 0.5) { continue; }
      let wn = pow(max(dot(np, octDecode(gq.xy)), 0.0), 32.0);
      let rq = cameraRay(vec2f(q) + 0.5);
      let xq = rq[0] + rq[1] * gq.z;
      let wp = exp(-abs(dot(np, xq - xp)) / planeTol);
      let cq = textureLoad(accumTex, q, 0);
      var wl = exp(-abs(lumOf(cq.rgb) / n - mean) / lumTol);
      if (metal) {
        // in the metal, compare colour too: the red wall and the green one
        // it reflects can be equally bright
        let dc = 2.0 * abs(cq.rgb - c.rgb) / (cq.rgb + c.rgb + 1e-4 * n);
        wl *= exp(-max(dc.r, max(dc.g, dc.b)) / relTol);
      }
      let dd = vec2f(d);
      let ws = exp(-dot(dd, dd) / (2.0 * sigma * sigma));
      let w = ws * wn * wp * wl;
      acc += cq * w;
      wsum += w;
    }
  }
  return acc / wsum;
}

// ---- display -------------------------------------------------------------------

fn texel(p: vec2i) -> vec3f {
  let mx = vec2i(textureDimensions(accumTex)) - 1;
  return textureLoad(accumTex, clamp(p, vec2i(0), mx), 0).rgb;
}

@fragment
fn fsDisplay(in: FullOut) -> @location(0) vec4f {
  // the trace buffer is coarser than the canvas: filter it bilinearly
  let f = in.uv * vec2f(textureDimensions(accumTex)) - 0.5;
  let i = vec2i(floor(f));
  let w = fract(f);
  let top = mix(texel(i), texel(i + vec2i(1, 0)), w.x);
  let bot = mix(texel(i + vec2i(0, 1)), texel(i + vec2i(1, 1)), w.x);
  let col = mix(top, bot, w.y) / max(TP.count, 1.0);
  return vec4f(col * TP.look.w, 1.0);
}

// ---- noise readout: a sparse grid of pixels reports its standard error ---------

@group(0) @binding(3) var statTex: texture_2d<f32>;
@group(0) @binding(4) var<storage, read_write> stats: array<atomic<u32>, 2>;

@compute @workgroup_size(8, 8)
fn noiseStats(@builtin(global_invocation_id) id: vec3u) {
  let dims = vec2u(textureDimensions(statTex));
  let p = id.xy * 3u;
  if (p.x >= dims.x || p.y >= dims.y) { return; }
  let a = textureLoad(statTex, vec2i(p), 0);
  let n = TP.count;
  if (n < 1.5) { return; }
  let mean = dot(a.rgb, vec3f(0.2126, 0.7152, 0.0722)) / n;
  // unbiased sample variance of one sample, then the error of the mean of n
  let variance = max(a.a - n * mean * mean, 0.0) / (n - 1.0);
  let se = sqrt(variance / n);
  atomicAdd(&stats[0], u32(min(se, 4.0) * 8192.0));
  atomicAdd(&stats[1], u32(min(mean, 4.0) * 8192.0));
}
