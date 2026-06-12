// Part five: a progressive path tracer, aimed at the Cornell box.
// fsTrace adds `spp` fresh Monte Carlo samples per pixel per frame on top of
// the running sum in prevTex (rgba32float: rgb = radiance sum, a = sample
// count); fsDisplay divides, tonemaps, and shows the estimate so far.
//
// The scene is analytic and tiny: five walls, a ceiling light you can move
// and resize, one diffuse sphere, and one sphere whose material is a knob
// (diffuse / mirror / glossy). Everything else is the estimator.

struct TraceParams {
  res: vec2f,        // accumulation buffer px
  frame: f32,        // frame index since last reset (0 = discard prevTex)
  spp: f32,          // samples added per frame
  lightPos: vec2f,   // light center, xz on the ceiling
  lightSize: vec2f,  // light half-extents, xz
  maxBounces: f32,
  nee: f32,          // 1: sample the light directly at every diffuse bounce
  matB: f32,         // sphere B: 0 diffuse · 1 mirror · 2 glossy
  rough: f32,        // glossy cone width
  exposure: f32,
  lightBoost: f32,
  _p0: f32,
  _p1: f32,
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

// ---- rng: one u32 of state per pixel-sample, PCG-style ----------------------------

var<private> rngState: u32;

fn rnd() -> f32 {
  rngState = rngState * 747796405u + 2891336453u;
  var w = ((rngState >> ((rngState >> 28u) + 4u)) ^ rngState) * 277803737u;
  w = (w >> 22u) ^ w;
  return f32(w) / 4294967296.0;
}

// ---- scene ------------------------------------------------------------------------
// the box: x ∈ [−1,1], y ∈ [0,2], z ∈ [−1,1]; camera looks down −z.

const EMIT_SCALE: f32 = 1.0;

struct Hit {
  t: f32,
  n: vec3f,
  albedo: vec3f,
  mat: i32, // 0 diffuse · 1 mirror · 2 glossy · 3 light
}

fn hitSphere(ro: vec3f, rd: vec3f, c: vec3f, r: f32) -> f32 {
  let oc = ro - c;
  let b = dot(oc, rd);
  let det = b * b - (dot(oc, oc) - r * r);
  if (det < 0.0) { return -1.0; }
  let s = sqrt(det);
  let t1 = -b - s;
  if (t1 > 1e-3) { return t1; }
  let t2 = -b + s;
  if (t2 > 1e-3) { return t2; }
  return -1.0;
}

fn intersect(ro: vec3f, rd: vec3f) -> Hit {
  var h: Hit;
  h.t = 1e9;
  h.mat = -1;

  // axis planes; each checked against the box cross-section
  // floor y=0
  if (rd.y < -1e-6) {
    let t = (0.0 - ro.y) / rd.y;
    if (t > 1e-3 && t < h.t) {
      let p = ro + rd * t;
      if (abs(p.x) < 1.0 && abs(p.z) < 1.0) {
        h.t = t; h.n = vec3f(0.0, 1.0, 0.0); h.albedo = vec3f(0.73); h.mat = 0;
      }
    }
  }
  // ceiling y=2 (and the light cut into it)
  if (rd.y > 1e-6) {
    let t = (2.0 - ro.y) / rd.y;
    if (t > 1e-3 && t < h.t) {
      let p = ro + rd * t;
      if (abs(p.x) < 1.0 && abs(p.z) < 1.0) {
        h.t = t; h.n = vec3f(0.0, -1.0, 0.0); h.albedo = vec3f(0.73); h.mat = 0;
        if (abs(p.x - TP.lightPos.x) < TP.lightSize.x && abs(p.z - TP.lightPos.y) < TP.lightSize.y) {
          h.mat = 3;
        }
      }
    }
  }
  // back wall z=−1
  if (rd.z < -1e-6) {
    let t = (-1.0 - ro.z) / rd.z;
    if (t > 1e-3 && t < h.t) {
      let p = ro + rd * t;
      if (abs(p.x) < 1.0 && p.y > 0.0 && p.y < 2.0) {
        h.t = t; h.n = vec3f(0.0, 0.0, 1.0); h.albedo = vec3f(0.73); h.mat = 0;
      }
    }
  }
  // left wall x=−1: the famous red
  if (rd.x < -1e-6) {
    let t = (-1.0 - ro.x) / rd.x;
    if (t > 1e-3 && t < h.t) {
      let p = ro + rd * t;
      if (p.y > 0.0 && p.y < 2.0 && abs(p.z) < 1.0) {
        h.t = t; h.n = vec3f(1.0, 0.0, 0.0); h.albedo = vec3f(0.65, 0.06, 0.06); h.mat = 0;
      }
    }
  }
  // right wall x=1: the famous green
  if (rd.x > 1e-6) {
    let t = (1.0 - ro.x) / rd.x;
    if (t > 1e-3 && t < h.t) {
      let p = ro + rd * t;
      if (p.y > 0.0 && p.y < 2.0 && abs(p.z) < 1.0) {
        h.t = t; h.n = vec3f(-1.0, 0.0, 0.0); h.albedo = vec3f(0.12, 0.45, 0.15); h.mat = 0;
      }
    }
  }

  // sphere A: matte, rear left
  let tA = hitSphere(ro, rd, vec3f(-0.45, 0.5, -0.35), 0.5);
  if (tA > 0.0 && tA < h.t) {
    h.t = tA;
    h.n = normalize(ro + rd * tA - vec3f(-0.45, 0.5, -0.35));
    h.albedo = vec3f(0.73);
    h.mat = 0;
  }
  // sphere B: the material knob, front right
  let tB = hitSphere(ro, rd, vec3f(0.5, 0.35, 0.35), 0.35);
  if (tB > 0.0 && tB < h.t) {
    h.t = tB;
    h.n = normalize(ro + rd * tB - vec3f(0.5, 0.35, 0.35));
    h.albedo = vec3f(0.85, 0.65, 0.35);
    h.mat = i32(TP.matB);
    if (h.mat == 0) { h.albedo = vec3f(0.73); }
  }
  return h;
}

fn lightLe() -> vec3f {
  // radiance, not power: shrink the panel and it stays the same brightness
  // per unit area, the room just gets darker
  return vec3f(1.0, 0.82, 0.6) * 22.0 * TP.lightBoost;
}

// cosine-weighted hemisphere around n — importance sampling the Lambert lobe
fn cosineDir(n: vec3f) -> vec3f {
  let r1 = rnd() * 6.28318530718;
  let r2 = rnd();
  let sr2 = sqrt(r2);
  var u = normalize(cross(n, select(vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), abs(n.y) > 0.9)));
  let v = cross(n, u);
  return normalize(u * cos(r1) * sr2 + v * sin(r1) * sr2 + n * sqrt(1.0 - r2));
}

fn tracePath(ro0: vec3f, rd0: vec3f) -> vec3f {
  var ro = ro0;
  var rd = rd0;
  var throughput = vec3f(1.0);
  var radiance = vec3f(0.0);
  var specularLast = true; // the camera counts as specular: a direct view of the light must show it

  let bounces = i32(TP.maxBounces);
  for (var b = 0; b < 12; b++) {
    if (b >= bounces) { break; }
    let h = intersect(ro, rd);
    if (h.mat < 0) { break; } // out the open front: black studio

    let p = ro + rd * h.t;

    if (h.mat == 3) {
      // hitting the panel: count it only if no NEE already paid this path,
      // or the previous bounce was specular (NEE can't see through mirrors)
      if (TP.nee < 0.5 || specularLast) {
        radiance += throughput * lightLe();
      }
      break;
    }

    if (h.mat == 1 || h.mat == 2) {
      // mirror / glossy: reflect, optionally jitter inside a cone
      var r = reflect(rd, h.n);
      if (h.mat == 2) {
        let j = vec3f(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5) * 2.0;
        r = normalize(r + j * TP.rough);
        if (dot(r, h.n) < 0.0) { r = reflect(r, h.n); }
      }
      throughput *= h.albedo;
      ro = p + h.n * 1e-3;
      rd = r;
      specularLast = true;
      continue;
    }

    // diffuse. Next-event estimation: ask the lamp directly.
    if (TP.nee > 0.5) {
      let lp = vec3f(
        TP.lightPos.x + (rnd() * 2.0 - 1.0) * TP.lightSize.x,
        2.0 - 1e-4,
        TP.lightPos.y + (rnd() * 2.0 - 1.0) * TP.lightSize.y,
      );
      let toL = lp - p;
      let d2 = dot(toL, toL);
      let ld = normalize(toL);
      let cosS = dot(h.n, ld);
      let cosL = ld.y; // cos at the panel: dot((0,−1,0), −ld) — it faces down
      if (cosS > 0.0 && cosL > 0.0) {
        let sh = intersect(p + h.n * 1e-3, ld);
        // unoccluded iff the first thing in that direction is the panel
        if (sh.mat == 3) {
          let area = 4.0 * TP.lightSize.x * TP.lightSize.y;
          radiance += throughput * h.albedo * lightLe() * (cosS * cosL * area / (3.14159265 * d2));
        }
      }
    }

    throughput *= h.albedo;
    ro = p + h.n * 1e-3;
    rd = cosineDir(h.n);
    specularLast = false;

    // russian roulette after a few bounces keeps deep paths cheap
    if (b > 3) {
      let q = max(throughput.x, max(throughput.y, throughput.z));
      if (rnd() > q) { break; }
      throughput /= max(q, 1e-3);
    }
  }
  return radiance;
}

@fragment
fn fsTrace(in: FullOut) -> @location(0) vec4f {
  let pix = vec2u(in.pos.xy);
  rngState = pix.x * 1973u + pix.y * 9277u + u32(TP.frame) * 26699u + 1u;
  // scramble a little — low frame indices correlate otherwise
  rngState = rngState ^ (rngState >> 16u);

  var prev = vec4f(0.0);
  if (TP.frame > 0.5) {
    prev = textureLoad(prevTex, vec2i(pix), 0);
  }

  let aspect = TP.res.x / TP.res.y;
  var sum = vec3f(0.0);
  let n = i32(TP.spp);
  for (var s = 0; s < 8; s++) {
    if (s >= n) { break; }
    // jittered pinhole camera at the open face of the box
    let jitter = vec2f(rnd(), rnd());
    let uv = (in.pos.xy + jitter - 0.5) / TP.res;
    let px = (uv.x * 2.0 - 1.0) * aspect;
    let py = 1.0 - uv.y * 2.0;
    let ro = vec3f(0.0, 1.0, 3.6);
    let rd = normalize(vec3f(px * 0.78, py * 0.78, -2.0));
    sum += tracePath(ro, rd);
  }

  return vec4f(prev.rgb + sum, prev.a + f32(n));
}

// ---- display -------------------------------------------------------------------

fn hashC(p: vec2f) -> f32 {
  var q = fract(p * vec2f(123.34, 456.21));
  q += dot(q, q + 45.32);
  return fract(q.x * q.y);
}

@fragment
fn fsDisplay(in: FullOut) -> @location(0) vec4f {
  let dims = vec2f(textureDimensions(accumTex));
  let pix = vec2i(in.uv * dims);
  let acc = textureLoad(accumTex, clamp(pix, vec2i(0), vec2i(dims) - 1), 0);
  var col = acc.rgb / max(acc.a, 1.0);
  col *= TP.exposure;
  col = col / (1.0 + col);
  col = pow(col, vec3f(0.4545));
  col += (hashC(in.pos.xy) - 0.5) / 255.0;
  return vec4f(col, 1.0);
}
