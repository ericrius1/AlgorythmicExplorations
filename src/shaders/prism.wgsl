// Part six: the spectral path tracer. Same progressive engine as part five,
// three upgrades: rays refract through glass (Fresnel-weighted dice), every
// sample carries one random wavelength (so dispersion and rainbow caustics
// are just Snell's law told the truth), and the camera is a thin lens
// (aperture + focus — depth of field as one more integral).
//
// Scene: a dark studio. Glass prism on the left, glass sphere on the right,
// pale floor to catch the caustics, one small bright panel overhead that the
// pointer drags around.

struct PrismParams {
  res: vec2f,
  frame: f32,
  spp: f32,
  lightPos: vec2f,   // xz of the panel
  lightSize: f32,
  dispersion: f32,   // Cauchy B, exaggerated: 0 = colorless glass
  aperture: f32,     // lens radius; 0 = pinhole
  focusDist: f32,
  maxBounces: f32,
  exposure: f32,
  sphereOn: f32,
  prismOn: f32,
  lightBoost: f32,
  _p0: f32,
}

@group(0) @binding(0) var<uniform> PP: PrismParams;
@group(0) @binding(1) var prevTex: texture_2d<f32>;
@group(0) @binding(2) var accumTex: texture_2d<f32>;

struct FullOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn vsFullP(@builtin(vertex_index) vi: u32) -> FullOut {
  var pts = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var out: FullOut;
  out.pos = vec4f(pts[vi], 0.0, 1.0);
  out.uv = pts[vi] * vec2f(0.5, -0.5) + 0.5;
  return out;
}

var<private> rngState: u32;

fn rnd() -> f32 {
  rngState = rngState * 747796405u + 2891336453u;
  var w = ((rngState >> ((rngState >> 28u) + 4u)) ^ rngState) * 277803737u;
  w = (w >> 22u) ^ w;
  return f32(w) / 4294967296.0;
}

// ---- wavelength → linear sRGB (Wyman/Sloan/Shirley gaussian fits, symmetrized) -----

fn gauss(x: f32, mu: f32, s: f32) -> f32 {
  let d = (x - mu) / s;
  return exp(-0.5 * d * d);
}

fn wavelengthRGB(l: f32) -> vec3f {
  let x = 1.056 * gauss(l, 599.8, 32.0) + 0.362 * gauss(l, 442.0, 21.0) - 0.065 * gauss(l, 501.1, 26.0);
  let y = 0.821 * gauss(l, 568.8, 43.0) + 0.286 * gauss(l, 530.9, 27.0);
  let z = 1.217 * gauss(l, 437.0, 15.0) + 0.681 * gauss(l, 459.0, 30.0);
  var rgb = vec3f(
    3.2406 * x - 1.5372 * y - 0.4986 * z,
    -0.9689 * x + 1.8758 * y + 0.0415 * z,
    0.0557 * x - 0.2040 * y + 1.0570 * z,
  );
  rgb = max(rgb, vec3f(0.0));
  // normalize so a uniform spread of wavelengths averages to white-ish
  return rgb * 2.6;
}

// Cauchy's empirical law (1836): higher n for shorter waves. The dispersion
// knob scales B far past real crown glass, because a browser-sized prism
// needs a theatrical rainbow.
fn iorAt(l: f32) -> f32 {
  let um = l / 1000.0;
  return 1.45 + PP.dispersion * 0.012 / (um * um);
}

// ---- scene ---------------------------------------------------------------------

struct Hit {
  t: f32,
  n: vec3f,
  mat: i32, // 0 floor · 1 glass · 3 light · −1 void
}

fn hitSphereT(ro: vec3f, rd: vec3f, c: vec3f, r: f32) -> f32 {
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

const NPLANES: i32 = 5;

// prism: a convex wedge — triangular cross-section in xy, capped in z
fn prismPlane(i: i32) -> vec4f {
  // xy triangle: A(−0.62,0) B(0.62,0) C(0,1.05), shifted to x = −0.85
  // planes as (normal, d): inside when dot(p, n) < d
  let cx = -0.85;
  if (i == 0) { return vec4f(0.0, -1.0, 0.0, 0.0); }                       // bottom (y > 0)
  if (i == 1) { return vec4f(0.0, 0.0, 1.0, 0.55); }                        // z cap
  if (i == 2) { return vec4f(0.0, 0.0, -1.0, 0.55); }                       // z cap
  if (i == 3) {
    let n = normalize(vec2f(1.05, 0.62));                                   // right face of triangle
    return vec4f(n.x, n.y, 0.0, n.x * (cx + 0.62));
  }
  let n = normalize(vec2f(-1.05, 0.62));                                    // left face
  return vec4f(n.x, n.y, 0.0, n.x * (cx - 0.62));
}

fn hitPrism(ro: vec3f, rd: vec3f) -> vec2f {
  // convex slab test. Returns (t, plane index); t < 0 on miss. Works from
  // inside too — refracted rays need the exit face.
  var tEnter = -1e9;
  var tExit = 1e9;
  var iEnter = -1;
  var iExit = -1;
  for (var i = 0; i < NPLANES; i++) {
    let pl = prismPlane(i);
    let n = pl.xyz;
    let denom = dot(rd, n);
    let dist = pl.w - dot(ro, n);
    if (abs(denom) < 1e-7) {
      if (dist < 0.0) { return vec2f(-1.0, 0.0); }
      continue;
    }
    let t = dist / denom;
    if (denom > 0.0) {
      if (t < tExit) { tExit = t; iExit = i; }
    } else {
      if (t > tEnter) { tEnter = t; iEnter = i; }
    }
  }
  if (tEnter > tExit || tExit < 1e-3) { return vec2f(-1.0, 0.0); }
  if (tEnter > 1e-3) { return vec2f(tEnter, f32(iEnter)); }
  return vec2f(tExit, f32(iExit));
}

const SPHERE_C: vec3f = vec3f(0.8, 0.62, 0.1);
const SPHERE_R: f32 = 0.62;

fn intersect(ro: vec3f, rd: vec3f) -> Hit {
  var h: Hit;
  h.t = 1e9;
  h.mat = -1;

  // floor
  if (rd.y < -1e-6) {
    let t = -ro.y / rd.y;
    if (t > 1e-3 && t < h.t) {
      let p = ro + rd * t;
      if (abs(p.x) < 3.2 && abs(p.z) < 3.2) {
        h.t = t; h.n = vec3f(0.0, 1.0, 0.0); h.mat = 0;
      }
    }
  }
  // the panel light, floating face-down
  if (rd.y > 1e-6) {
    let t = (2.3 - ro.y) / rd.y;
    if (t > 1e-3 && t < h.t) {
      let p = ro + rd * t;
      if (abs(p.x - PP.lightPos.x) < PP.lightSize && abs(p.z - PP.lightPos.y) < PP.lightSize) {
        h.t = t; h.n = vec3f(0.0, -1.0, 0.0); h.mat = 3;
      }
    }
  }
  // glass sphere
  if (PP.sphereOn > 0.5) {
    let t = hitSphereT(ro, rd, SPHERE_C, SPHERE_R);
    if (t > 0.0 && t < h.t) {
      h.t = t;
      h.n = normalize(ro + rd * t - SPHERE_C);
      h.mat = 1;
    }
  }
  // glass prism
  if (PP.prismOn > 0.5) {
    let pr = hitPrism(ro, rd);
    if (pr.x > 0.0 && pr.x < h.t) {
      h.t = pr.x;
      h.n = prismPlane(i32(pr.y)).xyz;
      h.mat = 1;
    }
  }
  return h;
}

fn lightLe() -> f32 {
  return 34.0 * PP.lightBoost;
}

fn cosineDir(n: vec3f) -> vec3f {
  let r1 = rnd() * 6.28318530718;
  let r2 = rnd();
  let sr2 = sqrt(r2);
  var u = normalize(cross(n, select(vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), abs(n.y) > 0.9)));
  let v = cross(n, u);
  return normalize(u * cos(r1) * sr2 + v * sin(r1) * sr2 + n * sqrt(1.0 - r2));
}

// one path, one wavelength. Returns scalar radiance — the caller colors it.
fn tracePath(ro0: vec3f, rd0: vec3f, ior: f32) -> f32 {
  var ro = ro0;
  var rd = rd0;
  var throughput = 1.0;
  var radiance = 0.0;
  var specularLast = true;

  let bounces = i32(PP.maxBounces);
  for (var b = 0; b < 14; b++) {
    if (b >= bounces) { break; }
    let h = intersect(ro, rd);
    if (h.mat < 0) { break; }
    let p = ro + rd * h.t;

    if (h.mat == 3) {
      if (specularLast) { radiance += throughput * lightLe(); }
      break;
    }

    if (h.mat == 1) {
      // glass: Fresnel decides reflect vs refract, per ray, per wavelength
      var n = h.n;
      var eta = 1.0 / ior;
      var cosI = -dot(rd, n);
      if (cosI < 0.0) { // leaving the glass
        n = -n;
        eta = ior;
        cosI = -cosI;
      }
      let sin2T = eta * eta * (1.0 - cosI * cosI);
      var reflectP = 1.0; // total internal reflection unless proven otherwise
      if (sin2T < 1.0) {
        let cosT = sqrt(1.0 - sin2T);
        // Schlick, with the exact normal-incidence term for this ior
        let r0 = (1.0 - ior) / (1.0 + ior);
        let R0 = r0 * r0;
        let c = select(cosI, cosT, eta > 1.0);
        reflectP = R0 + (1.0 - R0) * pow(1.0 - c, 5.0);
      }
      if (rnd() < reflectP) {
        rd = reflect(rd, n);
      } else {
        let cosT = sqrt(1.0 - sin2T);
        rd = normalize(rd * eta + n * (eta * cosI - cosT));
      }
      throughput *= 0.985; // a faint gray tint per interface
      ro = p + rd * 2e-3;  // offset along the new ray: it may have gone inside
      specularLast = true;
      continue;
    }

    // the floor: matte, with direct light sampling
    {
      let lp = vec3f(
        PP.lightPos.x + (rnd() * 2.0 - 1.0) * PP.lightSize,
        2.3 - 1e-4,
        PP.lightPos.y + (rnd() * 2.0 - 1.0) * PP.lightSize,
      );
      let toL = lp - p;
      let d2 = dot(toL, toL);
      let ld = normalize(toL);
      let cosS = dot(h.n, ld);
      let cosL = ld.y;
      if (cosS > 0.0 && cosL > 0.0) {
        let sh = intersect(p + h.n * 1e-3, ld);
        if (sh.mat == 3) {
          let area = 4.0 * PP.lightSize * PP.lightSize;
          radiance += throughput * 0.78 * lightLe() * (cosS * cosL * area / (3.14159265 * d2));
        }
      }
    }
    throughput *= 0.78;
    ro = p + h.n * 1e-3;
    rd = cosineDir(h.n);
    specularLast = false;

    if (b > 3) {
      if (rnd() > throughput) { break; }
      throughput = 1.0;
    }
  }
  return radiance;
}

@fragment
fn fsTraceP(in: FullOut) -> @location(0) vec4f {
  let pix = vec2u(in.pos.xy);
  rngState = pix.x * 1973u + pix.y * 9277u + u32(PP.frame) * 26699u + 7u;
  rngState = rngState ^ (rngState >> 16u);

  var prev = vec4f(0.0);
  if (PP.frame > 0.5) {
    prev = textureLoad(prevTex, vec2i(pix), 0);
  }

  let aspect = PP.res.x / PP.res.y;
  var sum = vec3f(0.0);
  let n = i32(PP.spp);
  for (var s = 0; s < 8; s++) {
    if (s >= n) { break; }

    // one wavelength per sample — the whole secret of spectral rendering
    let lambda = 380.0 + rnd() * 340.0;
    let weight = wavelengthRGB(lambda);
    let ior = iorAt(lambda);

    let jitter = vec2f(rnd(), rnd());
    let uv = (in.pos.xy + jitter - 0.5) / PP.res;
    let px = (uv.x * 2.0 - 1.0) * aspect;
    let py = 1.0 - uv.y * 2.0;

    // thin lens: pick a point on the aperture, aim at the focal plane
    let eye = vec3f(0.0, 1.5, 4.3);
    let fwd = normalize(vec3f(0.0, 0.62, 0.0) - eye);
    let right = normalize(cross(fwd, vec3f(0.0, 1.0, 0.0)));
    let up = cross(right, fwd);
    var rd = normalize(fwd * 1.85 + right * px + up * py);
    var ro = eye;
    if (PP.aperture > 1e-4) {
      let a = rnd() * 6.28318530718;
      let r = sqrt(rnd()) * PP.aperture;
      let focus = eye + rd * (PP.focusDist / dot(rd, fwd));
      ro = eye + right * (cos(a) * r) + up * (sin(a) * r);
      rd = normalize(focus - ro);
    }

    sum += weight * tracePath(ro, rd, ior);
  }

  return vec4f(prev.rgb + sum, prev.a + f32(n));
}

// ---- display ------------------------------------------------------------------

fn hashP(p: vec2f) -> f32 {
  var q = fract(p * vec2f(123.34, 456.21));
  q += dot(q, q + 45.32);
  return fract(q.x * q.y);
}

@fragment
fn fsDisplayP(in: FullOut) -> @location(0) vec4f {
  let dims = vec2f(textureDimensions(accumTex));
  let pix = vec2i(in.uv * dims);
  let acc = textureLoad(accumTex, clamp(pix, vec2i(0), vec2i(dims) - 1), 0);
  var col = acc.rgb / max(acc.a, 1.0);
  col *= PP.exposure;
  col = col / (1.0 + col);
  col = pow(col, vec3f(0.4545));
  col += (hashP(in.pos.xy) - 0.5) / 255.0;
  return vec4f(col, 1.0);
}
