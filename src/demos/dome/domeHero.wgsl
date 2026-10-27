// The Dome Projection heroes: a planetarium seen from a seat near the back,
// ray traced per pixel. The dome is a unit hemisphere centred on the origin,
// z up, sitting on a short cylindrical wall. Whatever is "projected" on it is
// a function of direction from the dome centre, the same way a fulldome
// master is. Each page adds its own overlay:
//   0 circle    polar grid, one swept radius and its angle
//   1 fisheye   the view morphs into the fisheye master and back
//   2 cubemap   cube faces, their edges and per-face grids
//   3 show      three projectors' thirds of the dome, overlaps then blended
//   4 realtime  three projector frusta, each re-rendering its view

struct U {
  res: vec2f,
  time: f32,
  mode: f32,
  morph: f32,    // fisheye page: 0 = room view, 1 = fisheye master
  blend: f32,    // show page: 0 = raw overlaps, 1 = blended
  yaw: f32,
  pitch: f32,
  bandTop: f32,     // fisheye page: the visible band between the nav and
  bandBottom: f32,  // an overlaid title, in -1..1 vertical units
  _pad1: f32,
  _pad2: f32,
}

@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var skyCube: texture_cube<f32>;
@group(0) @binding(2) var skySampler: sampler;

const PI = 3.14159265;
const TAU = 6.2831853;
const FLOOR_Z = -0.3;
const CAM = vec3f(0.0, -0.46, 0.02);

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VOut {
  let p = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u));
  var o: VOut;
  o.pos = vec4f(p * 2.0 - 1.0, 0.0, 1.0);
  o.uv = p;
  return o;
}

// ---- noise ---------------------------------------------------------------

fn hash13(p: vec3f) -> f32 {
  var q = fract(p * 0.1031);
  q += dot(q, q.zyx + 31.32);
  return fract((q.x + q.y) * q.z);
}

fn hash33(p: vec3f) -> vec3f {
  var q = fract(p * vec3f(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yxz + 33.33);
  return fract((q.xxy + q.yxx) * q.zyx);
}

fn vnoise(p: vec3f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let w = f * f * (3.0 - 2.0 * f);
  let a = mix(mix(hash13(i), hash13(i + vec3f(1.0, 0.0, 0.0)), w.x),
              mix(hash13(i + vec3f(0.0, 1.0, 0.0)), hash13(i + vec3f(1.0, 1.0, 0.0)), w.x), w.y);
  let b = mix(mix(hash13(i + vec3f(0.0, 0.0, 1.0)), hash13(i + vec3f(1.0, 0.0, 1.0)), w.x),
              mix(hash13(i + vec3f(0.0, 1.0, 1.0)), hash13(i + vec3f(1.0, 1.0, 1.0)), w.x), w.y);
  return mix(a, b, w.z);
}

fn fbm(p: vec3f) -> f32 {
  var s = 0.0;
  var a = 0.5;
  var q = p;
  for (var i = 0; i < 5; i++) {
    s += a * vnoise(q);
    q = q * 2.03 + vec3f(1.7, 9.2, 3.4);
    a *= 0.5;
  }
  return s;
}

// ---- the sky that's "projected" on the dome ------------------------------

fn rotate_axis(v: vec3f, axis: vec3f, a: f32) -> vec3f {
  let c = cos(a);
  let s = sin(a);
  return v * c + cross(axis, v) * s + axis * dot(axis, v) * (1.0 - c);
}

// Stars in a 3D grid of cells. Each cell may own one star, placed on the
// sphere; a cell only keeps its star if the star lands inside it, so the 2x2x2
// cells around a point always contain every star near it.
fn stars(d: vec3f, pix: f32) -> vec3f {
  let n = 46.0;
  let p = d * n;
  let base = floor(p - 0.5);
  var col = vec3f(0.0);
  for (var i = 0; i < 8; i++) {
    let cell = base + vec3f(f32(i & 1), f32((i >> 1) & 1), f32((i >> 2) & 1));
    let h = hash33(cell);
    if (h.x > 0.3) {
      continue;
    }
    let q = normalize(cell + 0.1 + 0.8 * hash33(cell + 17.0)) * n;
    if (any(floor(q) != cell)) {
      continue;
    }
    let dist = length(p - q);
    let sigma = max(pix * n * 0.55, 0.012);
    let mag = pow(h.y, 5.0);
    // keep a star's total light the same however wide the pixel footprint is
    let energy = (0.012 * 0.012) / (sigma * sigma);
    let g = exp(-dist * dist / (2.0 * sigma * sigma)) * energy;
    let tint = mix(vec3f(0.75, 0.82, 1.0), vec3f(1.0, 0.86, 0.68), h.z);
    col += tint * g * (0.25 + 9.0 * mag);
  }
  return col;
}

// The diffuse part of the sky (Milky Way, nebulae) is expensive noise, so it
// is baked once into a cubemap by fs_bake and only sampled per frame.
fn sky_diffuse(d: vec3f) -> vec3f {
  // Milky Way: a band about a great circle, with dust lanes
  let band = normalize(vec3f(0.75, -0.6, 0.28));
  let b = dot(d, band);
  let structure = fbm(d * 3.2);
  let fine = fbm(d * 9.0 + 4.0);
  var glow = exp(-b * b / 0.03) * (0.35 + 0.9 * structure * structure);
  glow *= 1.0 - 0.75 * smoothstep(0.42, 0.7, fine) * exp(-b * b / 0.006);
  var col = mix(vec3f(0.22, 0.26, 0.42), vec3f(0.55, 0.42, 0.34), smoothstep(0.3, 0.75, structure)) * glow * 0.2;
  // two faint nebulae
  let n1 = exp(-dot(d - normalize(vec3f(-0.5, 0.4, 0.75)), d - normalize(vec3f(-0.5, 0.4, 0.75))) / 0.05);
  let n2 = exp(-dot(d - normalize(vec3f(0.55, 0.55, 0.45)), d - normalize(vec3f(0.55, 0.55, 0.45))) / 0.03);
  col += vec3f(0.5, 0.12, 0.38) * n1 * fbm(d * 5.0 + 2.0) * 0.2;
  col += vec3f(0.1, 0.35, 0.42) * n2 * fbm(d * 6.0 + 7.0) * 0.2;
  return col;
}

fn sky(dDome: vec3f, pix: f32) -> vec3f {
  // the planetarium sky turns slowly about a tilted pole
  let pole = normalize(vec3f(0.0, 0.55, 0.83));
  let d = rotate_axis(dDome, pole, u.time * 0.012);
  var col = textureSampleLevel(skyCube, skySampler, d, 0.0).rgb;
  col += stars(d, pix);
  // twilight along the springline, the way a dome show often opens
  let low = 1.0 - smoothstep(0.0, 0.45, dDome.z);
  col += mix(vec3f(0.02, 0.03, 0.07), vec3f(0.12, 0.06, 0.08), low) * low * 0.6;
  col += vec3f(0.006, 0.008, 0.018);
  return col;
}

// ---- overlays -------------------------------------------------------------

// A line `px` pixels wide, from a distance measured in the same units as pix.
fn aline(dist: f32, pix: f32, px: f32) -> f32 {
  return 1.0 - smoothstep(px * 0.5, px * 0.5 + 1.2, abs(dist) / max(pix, 1e-6));
}

fn zen_az(d: vec3f) -> vec2f {
  return vec2f(acos(clamp(d.z, -1.0, 1.0)), atan2(d.y, d.x));
}

fn wrap_pi(a: f32) -> f32 {
  return a - TAU * floor((a + PI) / TAU);
}

fn polar_grid(d: vec3f, pix: f32, ringStep: f32, spokes: f32) -> f32 {
  let za = zen_az(d);
  let ringD = (fract(za.x / ringStep + 0.5) - 0.5) * ringStep;
  let spokeStep = TAU / spokes;
  let spokeD = (fract(za.y / spokeStep + 0.5) - 0.5) * spokeStep * sin(za.x);
  let fadeCentre = smoothstep(0.02, 0.12, za.x);
  return max(aline(ringD, pix, 0.6), aline(spokeD, pix, 0.6) * fadeCentre);
}

const PROJ_COLORS = array<vec3f, 3>(vec3f(0.48, 0.64, 1.0), vec3f(1.0, 0.72, 0.42), vec3f(0.49, 0.84, 0.63));

struct Proj {
  pos: vec3f,
  fwd: vec3f,
  right: vec3f,
  up: vec3f,
}

const PROJ_AZ0 = -PI * 0.5 + 0.35;

// Three projectors on the rim, each throwing across the dome to the far side.
fn projector(i: i32) -> Proj {
  let a = PROJ_AZ0 + f32(i) * TAU / 3.0;
  var p: Proj;
  p.pos = vec3f(cos(a) * 0.9, sin(a) * 0.9, 0.04);
  let aim = vec3f(cos(a + PI) * 0.5, sin(a + PI) * 0.5, 0.78);
  p.fwd = normalize(aim - p.pos);
  p.right = normalize(cross(p.fwd, vec3f(0.0, 0.0, 1.0)));
  p.up = cross(p.right, p.fwd);
  return p;
}

// Where a dome point lands in projector i's image, -1..1 on each axis.
fn proj_uv(pr: Proj, x: vec3f) -> vec3f {
  let v = x - pr.pos;
  let z = dot(v, pr.fwd);
  let tanH = 1.05;
  let tanV = 0.72;
  return vec3f(dot(v, pr.right) / (z * tanH), dot(v, pr.up) / (z * tanV), z);
}

fn edge_weight(q: vec3f) -> f32 {
  if (q.z <= 0.0) {
    return 0.0;
  }
  let e = min(1.0 - abs(q.x), 1.0 - abs(q.y));
  return smoothstep(0.0, 0.14, e);
}

// ---- the room ------------------------------------------------------------

struct Hit {
  p: vec3f,
  dome: bool,
}

fn trace(ro: vec3f, rd: vec3f) -> Hit {
  var h: Hit;
  let b = dot(ro, rd);
  let c = dot(ro, ro) - 1.0;
  let t = -b + sqrt(max(b * b - c, 0.0));
  let p = ro + rd * t;
  if (p.z >= 0.0) {
    h.p = p;
    h.dome = true;
    return h;
  }
  // below the springline: the wall, then the floor
  let a2 = dot(rd.xy, rd.xy);
  let b2 = dot(ro.xy, rd.xy);
  let c2 = dot(ro.xy, ro.xy) - 1.0;
  let tw = (-b2 + sqrt(max(b2 * b2 - a2 * c2, 0.0))) / max(a2, 1e-6);
  let pw = ro + rd * tw;
  if (pw.z >= FLOOR_Z) {
    h.p = pw;
  } else {
    h.p = ro + rd * ((FLOOR_Z - ro.z) / rd.z);
  }
  h.dome = false;
  return h;
}

fn room(p: vec3f) -> vec3f {
  // dark wall and floor, lit a little by the dome above them
  let r = length(p.xy);
  let cove = exp(-abs(p.z) * 18.0) * step(0.98, r);
  return vec3f(0.006, 0.007, 0.011) + vec3f(0.018, 0.014, 0.026) * cove;
}

@fragment
fn fs(v: VOut) -> @location(0) vec4f {
  let aspect = u.res.x / u.res.y;
  let q = (v.uv * 2.0 - 1.0) * vec2f(aspect, 1.0);

  // camera: a seat behind the centre, looking forward and up
  let cy = cos(u.yaw);
  let sy = sin(u.yaw);
  // narrow screens see more floor, so look a little higher
  let pitch = u.pitch + select(0.1, 0.0, aspect > 1.4);
  let cp = cos(pitch);
  let sp = sin(pitch);
  let fwd = vec3f(sy * cp, cy * cp, sp);
  let right = normalize(vec3f(cy, -sy, 0.0));
  let up = cross(right, fwd);
  let tanHalf = tan(0.5 * select(1.18, 1.05, aspect > 1.4));
  let rd = normalize(fwd + (q.x * right + q.y * up) * tanHalf);
  let hit = trace(CAM, rd);

  // how much dome one pixel covers, in radians, for line widths and stars
  var dir = select(normalize(vec3f(hit.p.xy, 0.0)), hit.p, hit.dome);
  var mask = select(0.0, 1.0, hit.dome);

  if (u.mode > 0.5 && u.mode < 1.5) {
    // fisheye page: slide every pixel's direction toward the one it has in an
    // equidistant 180-degree fisheye master, fitted inside the part of the
    // frame that the nav and the title don't cover
    let radius = max(0.2, (u.bandTop - u.bandBottom) * 0.46);
    let f = (q - vec2f(0.0, 0.5 * (u.bandTop + u.bandBottom))) / radius;
    let rho = length(f);
    let zen = min(rho, 1.0) * PI * 0.5;
    let az = atan2(-f.y, f.x);
    let dirF = vec3f(sin(zen) * cos(az), sin(zen) * sin(az), cos(zen));
    let k = u.morph;
    dir = normalize(mix(dir, dirF, k) + vec3f(0.0, 0.0, 1e-4));
    let inDisc = 1.0 - smoothstep(1.0 - 2.0 / u.res.y, 1.0 + 2.0 / u.res.y, rho);
    mask = mix(mask, inDisc, k);
  }

  let pix = length(fwidth(dir));
  var col = sky(dir, pix) * mask;

  if (u.mode < 0.5) {
    // circle page: rings every 15 degrees, spokes every 30, one radius swept
    let g = polar_grid(dir, pix, PI / 12.0, 12.0);
    col += vec3f(0.3, 0.42, 0.85) * g * 0.13 * mask;
    let za = zen_az(dir);
    let sweep = u.time * 0.21;
    let along = wrap_pi(za.y - sweep);
    let ray = aline(along * sin(za.x), pix, 1.2) * step(abs(along), 1.0) * smoothstep(0.0, 0.03, za.x);
    col += vec3f(1.0, 0.68, 0.32) * ray * 0.8 * mask;
    // the angle swept so far, as an arc at 20 degrees from the zenith
    let arcR = 0.35;
    let swept = fract(sweep / TAU) * TAU;
    let azPos = fract(za.y / TAU) * TAU;
    let onArc = aline(za.x - arcR, pix, 1.2) * step(azPos, swept);
    col += vec3f(0.49, 0.84, 0.63) * onArc * 0.7 * mask;
    // a point riding out and back along the swept radius
    let rr = (0.5 + 0.42 * sin(u.time * 0.33)) * PI * 0.5;
    let pd = vec3f(sin(rr) * cos(sweep), sin(rr) * sin(sweep), cos(rr));
    let dp = length(dir - pd) / max(pix, 1e-6);
    col += vec3f(0.6, 0.75, 1.0) * (exp(-dp * dp / 18.0) * 2.5 + exp(-dp / 14.0) * 0.25) * mask;
  } else if (u.mode < 1.5) {
    // fisheye page: rings every 10 degrees, evenly spaced in the master
    let g = polar_grid(dir, pix, PI / 18.0, 12.0);
    col += vec3f(0.3, 0.42, 0.85) * g * (0.12 + 0.16 * u.morph) * mask;
    let horizon = aline(dir.z, pix, 1.6);
    col += vec3f(0.48, 0.64, 1.0) * horizon * 0.5 * mask;
  } else if (u.mode < 2.5) {
    // cubemap page: which face of a cube each direction falls on
    let a = abs(dir);
    var face = 0;
    var uvf = vec2f(0.0);
    if (a.z >= a.x && a.z >= a.y) {
      face = 4;
      uvf = dir.xy / a.z;
    } else if (a.x >= a.y) {
      face = select(1, 0, dir.x > 0.0);
      uvf = dir.yz / a.x;
    } else {
      face = select(3, 2, dir.y > 0.0);
      uvf = dir.xz / a.y;
    }
    let tint = array<vec3f, 5>(
      vec3f(1.0, 0.55, 0.3), vec3f(0.35, 0.85, 0.6), vec3f(0.45, 0.6, 1.0), vec3f(0.85, 0.5, 1.0), vec3f(1.0, 0.85, 0.45));
    // the face being "rendered" right now gets a brighter wash
    let current = i32(floor(u.time / 1.6)) % 5;
    let lit = select(0.05, 0.16, face == current);
    let uvPix = length(fwidth(uvf));
    let gx = (fract(uvf * 4.0 + 0.5) - 0.5) / 4.0;
    let grid = max(aline(gx.x, uvPix, 1.0), aline(gx.y, uvPix, 1.0));
    let edge = max(aline(1.0 - abs(uvf.x), uvPix, 2.2), aline(1.0 - abs(uvf.y), uvPix, 2.2));
    col = col * (1.0 - lit * 0.3) + tint[face] * (lit * 0.18 + grid * 0.12 + edge * 0.75) * mask;
  } else {
    // show and realtime pages: three projectors
    var wsum = 0.0;
    var tintSum = vec3f(0.0);
    var outline = vec3f(0.0);
    var fill = vec3f(0.0);
    for (var i = 0; i < 3; i++) {
      let pr = projector(i);
      let pq = proj_uv(pr, dir);
      let w = edge_weight(pq);
      wsum += w;
      tintSum += mix(vec3f(1.0), PROJ_COLORS[i], 0.75) * w;
      fill += PROJ_COLORS[i] * w;
      let qpix = length(fwidth(pq.xy));
      if (u.mode > 3.5 && pq.z > 0.0) {
        let box = max(abs(pq.x), abs(pq.y));
        outline += PROJ_COLORS[i] * aline(1.0 - box, qpix, 1.2);
        // a scanline sweeping down each projector's image: it re-renders
        // its own camera view every frame
        let scan = fract(u.time * 0.45 + f32(i) * 0.33) * 2.0 - 1.0;
        let inside = step(box, 1.0);
        outline += PROJ_COLORS[i] * aline(pq.y + scan, qpix, 1.4) * inside * 0.55;
      }
    }
    if (u.mode < 3.5) {
      // Show page: each projector covers a third of the dome around the far
      // side from where it sits, plus an overlap band into its neighbours.
      // Unblended, each adds its whole image in its own tint, so the overlaps
      // come out twice as bright; blended, the sum is one even sky.
      let za = zen_az(dir);
      // the show content: the sky plus a grid, so you can see it run
      // unbroken across the seams once the blend is on
      let g = polar_grid(dir, pix, PI / 12.0, 12.0);
      col += vec3f(0.6, 0.65, 0.8) * g * 0.09 * mask;
      var rawSum = vec3f(0.0);
      for (var i = 0; i < 3; i++) {
        let aimAz = PROJ_AZ0 + f32(i) * TAU / 3.0 + PI;
        let d = abs(wrap_pi(za.y - aimAz));
        let edge = (d - (PI / 3.0 + 0.16)) * sin(za.x) / max(pix, 1e-6);
        let cover = clamp(0.5 - edge, 0.0, 1.0);
        rawSum += mix(vec3f(1.0), PROJ_COLORS[i], 0.9) * cover;
      }
      let raw = col * rawSum + rawSum * 0.035 * mask;
      col = mix(raw, col, u.blend);
    } else {
      col += outline * 0.5 * mask + fill * 0.008 * mask;
    }
  }

  if (!hit.dome) {
    if (u.mode > 0.5 && u.mode < 1.5) {
      col += room(hit.p) * (1.0 - u.morph) * (1.0 - mask);
    } else {
      col = room(hit.p);
    }
  }

  return vec4f(col, 1.0);
}

// ---- baking the diffuse sky into a cubemap ------------------------------

// Direction through texel (s, t) of cube face `face`, both -1..1, t down.
// Faces in WebGPU order: +X, -X, +Y, -Y, +Z, -Z.
fn cube_dir(face: i32, s: f32, t: f32) -> vec3f {
  switch face {
    case 0: { return vec3f(1.0, -t, -s); }
    case 1: { return vec3f(-1.0, -t, s); }
    case 2: { return vec3f(s, 1.0, t); }
    case 3: { return vec3f(s, -1.0, -t); }
    case 4: { return vec3f(s, -t, 1.0); }
    default: { return vec3f(-s, -t, -1.0); }
  }
}

@fragment
fn fs_bake(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let st = pos.xy / u.res * 2.0 - 1.0;
  let d = normalize(cube_dir(i32(u.mode), st.x, st.y));
  return vec4f(sky_diffuse(d), 1.0);
}
