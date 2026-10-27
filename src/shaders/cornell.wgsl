// Part five: a progressive path tracer, aimed at the Cornell box.
// fsTrace adds `spp` fresh Monte Carlo samples per pixel on top of the running
// sum in prevTex (rgba32float: rgb = Σ radiance, a = Σ luminance², which the
// noise readout uses). fsDisplay divides by the sample count, upsamples
// bilinearly to the canvas, and hands linear HDR to PostFX for tone mapping.
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
}

@group(0) @binding(0) var<uniform> TP: TraceParams;
@group(0) @binding(1) var prevTex: texture_2d<f32>;
@group(0) @binding(2) var accumTex: texture_2d<f32>;

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
  let r1 = rnd() * 6.28318530718;
  let r2 = rnd();
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
        radiance += throughput * lightLe();
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
    if (TP.nee > 0.5) {
      let lp = vec3f(
        TP.lightPos.x + (rnd() * 2.0 - 1.0) * TP.lightSize.x,
        2.0,
        TP.lightPos.y + (rnd() * 2.0 - 1.0) * TP.lightSize.y,
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
    rd = cosineDir(h.n);
    specularLast = false;

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

@fragment
fn fsTrace(in: FullOut) -> @location(0) vec4f {
  let pix = vec2u(in.pos.xy);
  rngState = pcg(pix.x + pcg(pix.y + pcg(u32(TP.seed))));

  var prev = vec4f(0.0);
  if (TP.frame > 0.5) {
    prev = textureLoad(prevTex, vec2i(pix), 0);
  }

  var sum = vec3f(0.0);
  var sumSq = 0.0;
  let n = i32(TP.spp);
  for (var s = 0; s < 16; s++) {
    if (s >= n) { break; }
    // a random point inside the pixel each time: antialiasing for free
    let ray = cameraRay(vec2f(pix) + vec2f(rnd(), rnd()));
    let L = tracePath(ray[0], ray[1]);
    sum += L;
    let lum = dot(L, vec3f(0.2126, 0.7152, 0.0722));
    sumSq += lum * lum;
  }

  return vec4f(prev.rgb + sum, prev.a + sumSq);
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
