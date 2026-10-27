// Part six: the spectral path tracer. Same progressive engine as part five,
// plus four things:
//   · glass: Schlick-weighted dice choose reflect or refract
//   · one wavelength per path: a path stays white until it refracts through
//     dispersive glass, then it picks a random λ and bends by n(λ)
//   · a beam light: sunlight through a slot, leaving within a small cone of
//     one direction
//   · light tracing: a compute pass follows paths from the beam through the
//     glass to the floor and splats them straight onto the camera's pixels.
//     Camera paths can't find a narrow beam through glass; the beam can.
//
// The camera tracer (fsTraceP) and the light tracer (lightTrace) split the
// work so nothing is counted twice. Light tracing owns paths that leave the
// beam, pass through glass, land on the floor and go straight to the camera.
// Camera paths own everything else.

struct PrismParams {
  res: vec2f,        // trace buffer size, px
  frame: f32,        // frames since the last reset
  spp: f32,          // camera samples per pixel this frame
  beamDir: vec4f,    // xyz: direction the light travels · w: cos of the cone half-angle
  beamPos: vec4f,    // xyz: centre of the emitting slot · w: irradiance across the beam
  beamSize: vec4f,   // x: slot half-width · y: half-height · z: cone solid angle · w: light tracing on
  prism: vec4f,      // x, z: centre · rotation · height (0 = no prism)
  sphere: vec4f,     // centre xyz · radius (0 = no sphere)
  optics: vec4f,     // Cauchy B (dispersion) · aperture radius · focus distance · exposure
  eye: vec4f,        // camera position · w: focal length
  look: vec4f,       // look-at point · w: camera samples per pixel in the sum
  misc: vec4f,       // x: frames of light tracing in the sum · y: seed · z: light paths this frame
}

@group(0) @binding(0) var<uniform> PP: PrismParams;
@group(0) @binding(1) var prevCam: texture_2d<f32>;
@group(0) @binding(2) var prevLight: texture_2d<f32>;
@group(0) @binding(3) var<storage, read_write> splatW: array<atomic<u32>>;
@group(0) @binding(4) var<storage, read> splatR: array<u32>;
@group(0) @binding(5) var camTex: texture_2d<f32>;
@group(0) @binding(6) var lightTex: texture_2d<f32>;

const SPLAT_SCALE: f32 = 4096.0;
const PI: f32 = 3.14159265;
const FLOOR_ALBEDO: f32 = 0.72;
const IOR_BASE: f32 = 1.5;

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

// ---- rng ----------------------------------------------------------------------

fn pcg(v: u32) -> u32 {
  let s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}

var<private> rngState: u32;

fn rnd() -> f32 {
  rngState = pcg(rngState);
  return f32(rngState >> 8u) / 16777216.0;
}

// ---- colour: one wavelength → linear sRGB --------------------------------------
// The CIE 1931 matching functions as Wyman, Sloan & Shirley's piecewise
// Gaussian fits, converted to linear sRGB, clipped at zero, and scaled so a
// flat spectrum from 380 to 720 nm averages to exactly (1, 1, 1).

fn g2(x: f32, mu: f32, s1: f32, s2: f32) -> f32 {
  let d = (x - mu) / select(s2, s1, x < mu);
  return exp(-0.5 * d * d);
}

fn wavelengthRGB(l: f32) -> vec3f {
  let x = 1.056 * g2(l, 599.8, 37.9, 31.0) + 0.362 * g2(l, 442.0, 16.0, 26.7) - 0.065 * g2(l, 501.1, 20.4, 26.2);
  let y = 0.821 * g2(l, 568.8, 46.9, 40.5) + 0.286 * g2(l, 530.9, 16.3, 31.1);
  let z = 1.217 * g2(l, 437.0, 11.8, 36.0) + 0.681 * g2(l, 459.0, 26.0, 13.8);
  let rgb = vec3f(
    3.2406 * x - 1.5372 * y - 0.4986 * z,
    -0.9689 * x + 1.8758 * y + 0.0415 * z,
    0.0557 * x - 0.2040 * y + 1.0570 * z,
  );
  return max(rgb, vec3f(0.0)) * vec3f(1.92985, 2.94689, 3.11081);
}

// Cauchy's empirical law (1836): n(λ) = A + B/λ², λ in micrometres.
// Crown glass has B ≈ 0.004 µm², dense flint about 0.016.
fn iorAt(l: f32) -> f32 {
  let um = l / 1000.0;
  return IOR_BASE + PP.optics.x / (um * um);
}

fn iorMean() -> f32 {
  return iorAt(550.0);
}

// ---- scene -----------------------------------------------------------------------

struct Hit {
  t: f32,
  n: vec3f,     // outward surface normal
  mat: i32,     // 0 floor · 1 glass · 3 the beam's slot · −1 nothing
}

fn hitSphere(ro: vec3f, rd: vec3f) -> f32 {
  let s = PP.sphere;
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

// the prism stands upright: an equilateral triangle in xz, extruded in y.
// planes as (outward normal, d): inside when dot(p, n) < d
fn prismPlane(i: i32) -> vec4f {
  let pr = PP.prism;
  if (i == 3) { return vec4f(0.0, 1.0, 0.0, pr.w); }     // top
  if (i == 4) { return vec4f(0.0, -1.0, 0.0, -0.001); }  // bottom, a hair above the floor
  let a = pr.z + f32(i) * 2.0943951;
  let n = vec3f(cos(a), 0.0, sin(a));
  // apothem 0.3: a triangle with 1.04-unit sides
  return vec4f(n, dot(n, vec3f(pr.x, 0.0, pr.y)) + 0.3);
}

// convex slab test; works from inside too (refracted rays need the exit face)
fn hitPrism(ro: vec3f, rd: vec3f) -> vec2f {
  var tEnter = -1e9;
  var tExit = 1e9;
  var iEnter = -1;
  var iExit = -1;
  for (var i = 0; i < 5; i++) {
    let pl = prismPlane(i);
    let denom = dot(rd, pl.xyz);
    let dist = pl.w - dot(ro, pl.xyz);
    if (abs(denom) < 1e-8) {
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
  if (tEnter > tExit || tExit < 1e-4) { return vec2f(-1.0, 0.0); }
  if (tEnter > 1e-4) { return vec2f(tEnter, f32(iEnter)); }
  return vec2f(tExit, f32(iExit));
}

// the slot's in-plane axes
fn slotU() -> vec3f { return normalize(cross(PP.beamDir.xyz, vec3f(0.0, 1.0, 0.0))); }
fn slotV() -> vec3f { return cross(slotU(), PP.beamDir.xyz); }

// is a point of the slot's plane inside the slot (a rectangle, or a disc)
fn onSlot(q: vec3f) -> bool {
  let p = q - PP.beamPos.xyz;
  let pu = dot(p, slotU());
  let pv = dot(p, slotV());
  if (PP.misc.w > 0.5) { return pu * pu + pv * pv < PP.beamSize.x * PP.beamSize.x; }
  return abs(pu) < PP.beamSize.x && abs(pv) < PP.beamSize.y;
}

fn slotArea() -> f32 {
  if (PP.misc.w > 0.5) { return PI * PP.beamSize.x * PP.beamSize.x; }
  return 4.0 * PP.beamSize.x * PP.beamSize.y;
}

// distance along the ray to the slot, from its emitting side only
fn slotT(ro: vec3f, rd: vec3f) -> f32 {
  let a = PP.beamDir.xyz;
  let den = dot(rd, a);
  if (den > -1e-6) { return -1.0; } // only from the front: travelling against the beam
  let t = dot(PP.beamPos.xyz - ro, a) / den;
  if (t < 1e-4) { return -1.0; }
  if (!onSlot(ro + rd * t)) { return -1.0; }
  return t;
}

fn intersect(ro: vec3f, rd: vec3f, withSlot: bool) -> Hit {
  var h: Hit;
  h.t = 1e9;
  h.mat = -1;
  if (rd.y < -1e-7) {
    let t = -ro.y / rd.y;
    if (t > 1e-4 && t < 60.0) { h.t = t; h.n = vec3f(0.0, 1.0, 0.0); h.mat = 0; }
  }
  if (PP.sphere.w > 0.0) {
    let t = hitSphere(ro, rd);
    if (t > 0.0 && t < h.t) { h.t = t; h.n = normalize(ro + rd * t - PP.sphere.xyz); h.mat = 1; }
  }
  if (PP.prism.w > 0.0) {
    let pr = hitPrism(ro, rd);
    if (pr.x > 0.0 && pr.x < h.t) { h.t = pr.x; h.n = prismPlane(i32(pr.y)).xyz; h.mat = 1; }
  }
  if (withSlot) {
    let t = slotT(ro, rd);
    if (t > 0.0 && t < h.t) { h.t = t; h.n = -PP.beamDir.xyz; h.mat = 3; }
  }
  return h;
}

// a dark studio: a softbox high behind the set (the prism's top face
// reflects it) and a long strip light low behind, for edges on the glass
const SOFT_AXIS: vec3f = vec3f(-0.29, 0.79, -0.53);
const SOFT_COS: f32 = 0.982;

fn softbox(rd: vec3f) -> f32 {
  return smoothstep(SOFT_COS, 0.99, dot(rd, SOFT_AXIS)) * 1.6;
}

fn envRest(rd: vec3f) -> f32 {
  let strip = smoothstep(-0.55, -0.75, rd.z) * smoothstep(0.04, 0.1, rd.y) * smoothstep(0.42, 0.3, rd.y) * 0.3;
  return 0.018 + 0.015 * max(rd.y, 0.0) + strip;
}

// radiance of the slot along a direction: it only shines inside its cone
fn beamLe(dirOfTravel: vec3f) -> f32 {
  if (dot(dirOfTravel, PP.beamDir.xyz) < PP.beamDir.w) { return 0.0; }
  return PP.beamPos.w / PP.beamSize.z; // irradiance ÷ cone solid angle
}

// a direction inside a cone, uniform in solid angle
fn coneAround(a: vec3f, cosMax: f32) -> vec3f {
  let cosT = mix(1.0, cosMax, rnd());
  let sinT = sqrt(max(1.0 - cosT * cosT, 0.0));
  let phi = rnd() * 6.28318530718;
  let u = normalize(cross(a, select(vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), abs(a.y) > 0.9)));
  let v = cross(a, u);
  return normalize(a * cosT + (u * cos(phi) + v * sin(phi)) * sinT);
}

fn coneDir() -> vec3f {
  return coneAround(PP.beamDir.xyz, PP.beamDir.w);
}

fn cosineDir(n: vec3f) -> vec3f {
  let r1 = rnd() * 6.28318530718;
  let r2 = rnd();
  let sr2 = sqrt(r2);
  let u = normalize(cross(n, select(vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), abs(n.y) > 0.9)));
  let v = cross(n, u);
  return normalize(u * (cos(r1) * sr2) + v * (sin(r1) * sr2) + n * sqrt(1.0 - r2));
}

// ---- glass, one wavelength at a time --------------------------------------------

struct Spectral {
  locked: bool, // false: the path still carries the whole (white) spectrum
  lambda: f32,
  weight: f32,
}

fn schlick(cosI: f32, eta: f32, ior: f32) -> f32 {
  let sin2T = eta * eta * (1.0 - cosI * cosI);
  if (sin2T >= 1.0) { return 1.0; } // total internal reflection
  let cosT = sqrt(1.0 - sin2T);
  let r0 = (1.0 - ior) / (1.0 + ior);
  let R0 = r0 * r0;
  // Schlick wants the angle on the thin side of the interface
  let c = select(cosI, cosT, eta > 1.0);
  return R0 + (1.0 - R0) * pow(1.0 - c, 5.0);
}

// Reflect or refract; returns the new direction and updates the spectrum.
// Camera paths pick reflection at least a quarter of the time (and weight
// the result to match): a 4% reflection of a bright softbox otherwise stays
// grainy for thousands of samples.
fn glass(rd: vec3f, nOut: vec3f, sp: ptr<function, Spectral>, camPath: bool) -> vec3f {
  var n = nOut;
  var cosI = -dot(rd, n);
  let entering = cosI > 0.0;
  if (!entering) { n = -n; cosI = -cosI; }

  // a white path decides with the mean index; a locked one with its own
  let iorDecide = select(iorMean(), iorAt((*sp).lambda), (*sp).locked);
  let etaDecide = select(iorDecide, 1.0 / iorDecide, entering);
  let F = schlick(cosI, etaDecide, iorDecide);
  let P = select(F, clamp(F, 0.25, 0.75), camPath && F < 1.0);
  if (rnd() < P) {
    (*sp).weight *= F / P;
    return reflect(rd, n);
  }
  (*sp).weight *= (1.0 - F) / (1.0 - P);
  // refraction: the first dispersive one fixes the wavelength
  var ior = iorDecide;
  if (!(*sp).locked && PP.optics.x > 0.0) {
    (*sp).locked = true;
    (*sp).lambda = 380.0 + rnd() * 340.0;
    ior = iorAt((*sp).lambda);
    let eta = select(ior, 1.0 / ior, entering);
    // re-weight from the mean-index odds to this wavelength's own
    let Fl = schlick(cosI, eta, ior);
    (*sp).weight *= (1.0 - Fl) / max(1.0 - F, 1e-4);
  }
  let eta = select(ior, 1.0 / ior, entering);
  let sin2T = eta * eta * (1.0 - cosI * cosI);
  if (sin2T >= 1.0) {
    (*sp).weight = 0.0;
    return reflect(rd, n);
  }
  return normalize(rd * eta + n * (eta * cosI - sqrt(1.0 - sin2T)));
}

fn spectralColor(sp: Spectral) -> vec3f {
  if (!sp.locked) { return vec3f(sp.weight); }
  return wavelengthRGB(sp.lambda) * sp.weight;
}

// ---- camera ------------------------------------------------------------------------

struct Cam {
  eye: vec3f,
  fwd: vec3f,
  right: vec3f,
  up: vec3f,
  focal: f32,
  aspect: f32,
}

fn camera() -> Cam {
  var c: Cam;
  c.eye = PP.eye.xyz;
  c.fwd = normalize(PP.look.xyz - c.eye);
  c.right = normalize(cross(c.fwd, vec3f(0.0, 1.0, 0.0)));
  c.up = cross(c.right, c.fwd);
  c.focal = PP.eye.w;
  c.aspect = PP.res.x / PP.res.y;
  return c;
}

fn lensPoint(c: Cam) -> vec3f {
  if (PP.optics.y <= 0.0) { return c.eye; }
  let a = rnd() * 6.28318530718;
  let r = sqrt(rnd()) * PP.optics.y;
  return c.eye + c.right * (cos(a) * r) + c.up * (sin(a) * r);
}

// ---- camera paths ---------------------------------------------------------------------

fn tracePath(ro0: vec3f, rd0: vec3f) -> vec3f {
  var ro = ro0;
  var rd = rd0;
  var throughput = 1.0;
  var sp: Spectral;
  sp.locked = false;
  sp.lambda = 550.0;
  sp.weight = 1.0;
  var radiance = vec3f(0.0);
  var specularLast = true;
  var diffuseCount = 0;
  var firstDiffuse = false;
  let lightTracing = PP.beamSize.w > 0.5;

  for (var b = 0; b < 14; b++) {
    // the slot only matters to a path that can still count it; after a
    // diffuse bounce, light sampling has it covered, so look straight past it
    let h = intersect(ro, rd, specularLast);
    if (h.mat < 0) {
      // after a diffuse bounce the softbox was already sampled directly
      let env = envRest(rd) + select(0.0, softbox(rd), specularLast);
      radiance += throughput * env * spectralColor(sp);
      break;
    }
    let p = ro + rd * h.t;

    if (h.mat == 3) {
      // reached the slot. Light sampling already counted it if the last
      // bounce was diffuse; light tracing owns floor → glass → slot when the
      // floor was the first thing the camera saw
      let caustic = diffuseCount == 1 && firstDiffuse;
      if (specularLast && !(lightTracing && caustic)) {
        var c = throughput * beamLe(-rd) * spectralColor(sp);
        // Glints of the sun in the glass, and caustics seen through glass,
        // are found only by luck from this side. Clamp them so they settle
        // in seconds; that dims them a little. Floor caustics stay exact
        // (light tracing does them, or with it off, nothing is clamped).
        if (!caustic) { c = min(c, vec3f(40.0)); }
        radiance += c;
      }
      break;
    }

    if (h.mat == 1) {
      rd = glass(rd, h.n, &sp, true);
      ro = p + rd * 2e-4;
      specularLast = true;
      if (sp.weight <= 0.0) { break; }
      continue;
    }

    // the floor. Light sampling with the beam: pick a direction in its cone,
    // follow it back to the slot, check nothing is in the way.
    if (b == 0) { firstDiffuse = true; }
    diffuseCount++;
    {
      let w = coneDir();
      let toL = -w;
      let cosS = dot(h.n, toL);
      let a = PP.beamDir.xyz;
      let tSlot = dot(p - PP.beamPos.xyz, a) / dot(w, a);
      if (cosS > 0.0 && tSlot > 0.0) {
        if (onSlot(p + toL * tSlot)) {
          let sh = intersect(p + h.n * 1e-4, toL, false);
          if (sh.mat < 0 || sh.t > tSlot) {
            // f · Le · cos / pdf, with pdf = 1/Ω and Le = E/Ω
            radiance += throughput * (FLOOR_ALBEDO / PI) * PP.beamPos.w * cosS * spectralColor(sp);
          }
        }
      }
    }

    // and the softbox, sampled the same way
    {
      let w = coneAround(SOFT_AXIS, SOFT_COS);
      let cosS = dot(h.n, w);
      if (cosS > 0.0) {
        let sh = intersect(p + h.n * 1e-4, w, false);
        if (sh.mat < 0) {
          let omega = 6.28318530718 * (1.0 - SOFT_COS);
          radiance += throughput * (FLOOR_ALBEDO / PI) * softbox(w) * cosS * omega * spectralColor(sp);
        }
      }
    }

    throughput *= FLOOR_ALBEDO;
    ro = p + h.n * 1e-4;
    rd = cosineDir(h.n);
    specularLast = false;

    if (b > 2) {
      let q = min(throughput, 0.95);
      if (rnd() > q) { break; }
      throughput /= q;
    }
  }
  return radiance;
}

struct TraceOut {
  @location(0) cam: vec4f,
  @location(1) light: vec4f,
}

@fragment
fn fsTraceP(in: FullOut) -> TraceOut {
  let pix = vec2u(in.pos.xy);
  rngState = pcg(pix.x + pcg(pix.y + pcg(u32(PP.misc.y))));
  let c = camera();

  var sum = vec3f(0.0);
  let n = i32(PP.spp);
  for (var s = 0; s < 16; s++) {
    if (s >= n) { break; }
    let uv = (vec2f(pix) + vec2f(rnd(), rnd())) / PP.res;
    let px = (uv.x * 2.0 - 1.0) * c.aspect;
    let py = 1.0 - uv.y * 2.0;
    var rd = normalize(c.fwd * c.focal + c.right * px + c.up * py);
    var ro = c.eye;
    if (PP.optics.y > 0.0) {
      // thin lens: start somewhere on the aperture, aim at the focal plane
      let focus = c.eye + rd * (PP.optics.z / dot(rd, c.fwd));
      ro = lensPoint(c);
      rd = normalize(focus - ro);
    }
    sum += tracePath(ro, rd);
  }

  var out: TraceOut;
  out.cam = vec4f(sum, 0.0);
  // this frame's light-tracing splats for this pixel, back to float
  let i = (pix.y * u32(PP.res.x) + pix.x) * 3u;
  out.light = vec4f(f32(splatR[i]), f32(splatR[i + 1u]), f32(splatR[i + 2u]), 0.0) / SPLAT_SCALE;
  if (PP.frame > 0.5) {
    out.cam += textureLoad(prevCam, vec2i(pix), 0);
    out.light += textureLoad(prevLight, vec2i(pix), 0);
  }
  return out;
}

// ---- light paths ------------------------------------------------------------------------

@compute @workgroup_size(64)
fn lightTrace(@builtin(global_invocation_id) id: vec3u) {
  let count = u32(PP.misc.z);
  if (id.x >= count) { return; }
  rngState = pcg(id.x + pcg(u32(PP.misc.y) * 7919u + 17u));

  // a point on the slot and a direction in the cone
  let a = PP.beamDir.xyz;
  var off = vec2f(rnd() * 2.0 - 1.0, rnd() * 2.0 - 1.0) * PP.beamSize.xy;
  if (PP.misc.w > 0.5) {
    let r = sqrt(rnd()) * PP.beamSize.x;
    let ang = rnd() * 6.28318530718;
    off = vec2f(cos(ang), sin(ang)) * r;
  }
  var ro = PP.beamPos.xyz + slotU() * off.x + slotV() * off.y;
  var rd = coneDir();
  // flux carried by this path: Le · cos · area · Ω = E · area · cos
  var power = PP.beamPos.w * slotArea() * dot(rd, a);
  var sp: Spectral;
  sp.locked = false;
  sp.lambda = 550.0;
  sp.weight = 1.0;
  var through = false; // has it been through glass yet

  let c = camera();
  let aImg = 4.0 * c.aspect / (c.focal * c.focal); // image plane area at distance 1
  let npix = PP.res.x * PP.res.y;

  for (var b = 0; b < 14; b++) {
    let h = intersect(ro, rd, false);
    if (h.mat < 0) { return; }
    let p = ro + rd * h.t;
    if (h.mat == 1) {
      rd = glass(rd, h.n, &sp, false);
      ro = p + rd * 2e-4;
      through = true;
      if (sp.weight <= 0.0) { return; }
      continue;
    }
    // the floor. Direct light is the camera's job; this path only counts
    // if it came through glass
    if (!through) { return; }

    let lens = lensPoint(c);
    let toCam = lens - p;
    let dist = length(toCam);
    let dc = toCam / dist;
    let cosX = dc.y; // floor normal is +y
    let cosC = dot(-dc, c.fwd);
    if (cosX <= 0.0 || cosC <= 0.0) { return; }
    let occ = intersect(p + vec3f(0.0, 1e-4, 0.0), dc, false);
    if (occ.mat >= 0 && occ.t < dist) { return; }

    // which pixel: where the lens ray through p crosses the focal plane,
    // seen from the lens centre
    var f = p;
    if (PP.optics.y > 0.0) {
      f = lens + (p - lens) * (PP.optics.z / dot(p - lens, c.fwd));
    }
    let q = f - c.eye;
    let zc = dot(q, c.fwd);
    let sx = c.focal * dot(q, c.right) / zc;
    let sy = c.focal * dot(q, c.up) / zc;
    let uv = vec2f((sx / c.aspect + 1.0) * 0.5, (1.0 - sy) * 0.5);
    if (uv.x < 0.0 || uv.x >= 1.0 || uv.y < 0.0 || uv.y >= 1.0) { return; }
    let px = vec2u(uv * PP.res);

    // the camera's importance for this point, per pixel, per light path
    let We = npix / (aImg * cosC * cosC * cosC * dist * dist);
    let value = power * (FLOOR_ALBEDO / PI) * cosX * We / f32(count);
    let col = min(spectralColor(sp) * value, vec3f(256.0)) * SPLAT_SCALE + 0.5;
    let i = (px.y * u32(PP.res.x) + px.x) * 3u;
    atomicAdd(&splatW[i], u32(col.r));
    atomicAdd(&splatW[i + 1u], u32(col.g));
    atomicAdd(&splatW[i + 2u], u32(col.b));
    return;
  }
}

// ---- display ---------------------------------------------------------------------------

fn texelP(p: vec2i) -> vec3f {
  let mx = vec2i(textureDimensions(camTex)) - 1;
  let q = clamp(p, vec2i(0), mx);
  let cam = textureLoad(camTex, q, 0).rgb / max(PP.look.w, 1.0);
  let light = textureLoad(lightTex, q, 0).rgb / max(PP.misc.x, 1.0);
  return cam + light;
}

@fragment
fn fsDisplayP(in: FullOut) -> @location(0) vec4f {
  let f = in.uv * vec2f(textureDimensions(camTex)) - 0.5;
  let i = vec2i(floor(f));
  let w = fract(f);
  let top = mix(texelP(i), texelP(i + vec2i(1, 0)), w.x);
  let bot = mix(texelP(i + vec2i(0, 1)), texelP(i + vec2i(1, 1)), w.x);
  return vec4f(mix(top, bot, w.y) * PP.optics.w, 1.0);
}
