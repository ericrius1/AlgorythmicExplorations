// Part three: participating media. The scene pass paints emission +
// occlusion exactly as the bonfire's did. What's new is the media pass: it
// renders the fog itself into a second texture, a = extinction density,
// rgb = the light the fog is sitting in (last frame's fluence, softly
// blurred). The cascade march in rc.wgsl attenuates every ray through the
// density and picks up the fog's glow along the way.
//
// One shader, three worlds, switched by FP.mode:
//   0 — the dawn forest: pines, ground mist, a low sun
//   1 — the lamp room: one warm lamp in a closed room of fog, and a pillar
//   2 — the window room: sun outside, two slits in the wall, shafts inside
//
// The display pass draws what a viewer would see: a backdrop (the sky, or the
// room's dim back wall) seen through the fog, plus the fog's own glow, which
// is density × the light it sits in × how much it scatters. Fog in sunlight
// shines; fog in shadow doesn't. Light shafts are that difference.

struct FogParams {
  viewScale: vec2f, // world [-1,1] → clip
  res: vec2f,       // target px (scene texture, or the canvas for display)
  time: f32,
  mode: f32,
  fog: f32,         // fog amount (density multiplier)
  glow: f32,        // lamp brightness
  lamp: vec2f,      // cursor lamp, world (mode 1)
  bounce: f32,
  puffCount: f32,
  probes0: vec2f,   // cascade-0 probe grid, for fluence sampling
  mist: f32,        // mode 0: how high the ground mist reaches
  scatter: f32,     // single-scattering albedo, as on the slider
  sunDir: vec2f,    // toward the sun, world (y up)
  sigma: f32,       // extinction per world unit at density 1
  airGlow: f32,     // display gain for the fog's glow
  zenith: vec4f,    // display backdrop: sky colours (linear)
  horizon: vec4f,
  sunColor: vec4f,  // rgb, w = intensity of the sun's glow in the backdrop
}

struct Puff {
  pos: vec2f,
  radius: f32,
  strength: f32,
}

@group(0) @binding(0) var<uniform> FP: FogParams;
@group(0) @binding(2) var fluenceTex: texture_2d<f32>;
@group(0) @binding(3) var linSamp: sampler;
@group(0) @binding(4) var<storage, read> puffs: array<Puff>;

// ---- noise ------------------------------------------------------------------

fn hash21(p: vec2f) -> f32 {
  var q = fract(p * vec2f(123.34, 456.21));
  q += dot(q, q + 45.32);
  return fract(q.x * q.y);
}

fn vnoise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = hash21(i);
  let b = hash21(i + vec2f(1.0, 0.0));
  let c = hash21(i + vec2f(0.0, 1.0));
  let d = hash21(i + vec2f(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

fn fbm(p: vec2f) -> f32 {
  return vnoise(p) * 0.55 + vnoise(p * 2.13 + 7.7) * 0.3 + vnoise(p * 4.41 + 19.1) * 0.15;
}

// ---- world geometry ------------------------------------------------------------

fn groundY(x: f32) -> f32 {
  return -0.66 + 0.05 * sin(x * 1.9 + 1.2) + 0.025 * sin(x * 4.7 + 0.6);
}

fn sdCapsule(p: vec2f, a: vec2f, b: vec2f, r: f32) -> f32 {
  let pa = p - a;
  let ba = b - a;
  let h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - r;
}

// A pine, as in the bonfire: trunk plus stacked tiers. These are taller and
// their crowns start higher, so the low sun can slip under and between them.
fn pineDist(world: vec2f, baseX: f32, h: f32, seed: f32) -> f32 {
  let gy = groundY(baseX);
  let q = world - vec2f(baseX, gy);
  let trunk = sdCapsule(q, vec2f(0.0, -0.05), vec2f(0.0, h * 0.92), 0.01 + 0.012 * h);
  let c0 = 0.3 * h;
  let t = clamp((q.y - c0) / (h - c0), 0.0, 1.0);
  let tiers = 5.0 + floor(seed * 2.5);
  let saw = fract(t * tiers + seed * 0.37);
  var w = (1.0 - t) * 0.2 * h * mix(1.0, 0.45, saw);
  w *= 1.0 + 0.16 * (vnoise(q * vec2f(60.0, 32.0) + seed * 9.0) - 0.5);
  let crown = max(abs(q.x) - w, max(c0 - q.y, q.y - h)) * 0.75;
  return min(trunk, crown);
}

struct Solid {
  d: f32,
  albedo: vec3f,
}

fn roomInner() -> vec2f {
  return 1.0 / FP.viewScale - vec2f(0.1, 0.1);
}

// Mode 2's window wall: its inner face, and how thick it is.
fn windowWallX() -> f32 { return -roomInner().x + 0.32; }
const WALL_T: f32 = 0.12;

fn solidAt(world: vec2f) -> Solid {
  let mode = u32(FP.mode);
  var s = Solid(1e3, vec3f(0.0));
  if (mode == 0u) {
    s = Solid((world.y - groundY(world.x)) * 0.92, vec3f(0.12, 0.12, 0.09));
    var td = 1e3;
    td = min(td, pineDist(world, -1.95, 1.25, 0.2));
    td = min(td, pineDist(world, -1.35, 1.5, 0.7));
    td = min(td, pineDist(world, -0.78, 1.18, 0.4));
    td = min(td, pineDist(world, -0.12, 1.42, 0.9));
    td = min(td, pineDist(world, 0.5, 1.22, 0.1));
    td = min(td, pineDist(world, 1.08, 1.55, 0.6));
    td = min(td, pineDist(world, 1.7, 1.28, 0.3));
    td = min(td, pineDist(world, 2.3, 1.45, 0.8));
    if (td < s.d) { s = Solid(td, vec3f(0.05, 0.08, 0.045)); }
  } else if (mode == 1u) {
    // the lamp room: walls just inside the canvas, and a pillar
    let q = abs(world) - roomInner();
    let box = length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0);
    s = Solid(-box, vec3f(0.42, 0.42, 0.45));
    let pd = max(abs(world.x - 0.45) - 0.05, abs(world.y + 0.15) - 0.42);
    if (pd < s.d) { s = Solid(pd, vec3f(0.35, 0.37, 0.42)); }
  } else {
    // the window room: floor, ceiling and right wall are plaster; the left
    // wall is pierced by two slits, and beyond it is the open air
    let inner = roomInner();
    let wx = windowWallX();
    var room = min(min(inner.y - world.y, world.y + inner.y), inner.x - world.x);
    if (world.x < wx - WALL_T) { room = 1e3; } // outside: no floor or ceiling
    s = Solid(room, vec3f(0.4, 0.38, 0.35));
    let wallBox = max(abs(world.x - (wx - WALL_T * 0.5)) - WALL_T * 0.5, abs(world.y) - inner.y - 0.2);
    let slits = min(abs(world.y - 0.42) - 0.11, abs(world.y + 0.02) - 0.11);
    let wd = max(wallBox, -slits);
    if (wd < s.d) { s = Solid(wd, vec3f(0.4, 0.38, 0.35)); }
    // a table under the shafts, for the light to land on
    let tdist = max(abs(world.x - 0.2) - 0.36, abs(world.y + inner.y - 0.2) - 0.035);
    let legs = max(abs(abs(world.x - 0.2) - 0.3) - 0.02, abs(world.y + inner.y - 0.1) - 0.1);
    let table = min(tdist, legs);
    if (table < s.d) { s = Solid(table, vec3f(0.36, 0.22, 0.12)); }
  }
  return s;
}

// ---- fluence (last frame's light), for bounce, the fog's glow and display ------------

struct FullOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn vsFullF(@builtin(vertex_index) vi: u32) -> FullOut {
  var pts = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var out: FullOut;
  out.pos = vec4f(pts[vi], 0.0, 1.0);
  out.uv = pts[vi] * vec2f(0.5, -0.5) + 0.5;
  return out;
}

fn uvToWorld(uv: vec2f) -> vec2f {
  return vec2f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0) / FP.viewScale;
}

fn worldToUv(w: vec2f) -> vec2f {
  let c = w * FP.viewScale;
  return vec2f(c.x * 0.5 + 0.5, 0.5 - c.y * 0.5);
}

fn fluenceAt(uv: vec2f) -> vec3f {
  let texFull = vec2f(textureDimensions(fluenceTex));
  let local = clamp(uv, vec2f(0.5) / FP.probes0, 1.0 - vec2f(0.5) / FP.probes0);
  var sum = vec3f(0.0);
  for (var d = 0u; d < 4u; d++) {
    let cb = vec2f(f32(d % 2u), f32(d / 2u));
    let tuv = (cb + local) * FP.probes0 / texFull;
    sum += textureSampleLevel(fluenceTex, linSamp, tuv, 0.0).rgb;
  }
  return sum * 0.25;
}

fn probeSpacing() -> f32 {
  return 2.0 / (FP.viewScale.y * FP.probes0.y);
}

fn normalAt(world: vec2f) -> vec2f {
  let e = probeSpacing() * 0.5;
  return normalize(vec2f(
    solidAt(world + vec2f(e, 0.0)).d - solidAt(world - vec2f(e, 0.0)).d,
    solidAt(world + vec2f(0.0, e)).d - solidAt(world - vec2f(0.0, e)).d,
  ) + vec2f(0.0, 1e-6));
}

// Light arriving at a solid point from outside it (see bonfire.wgsl).
fn incidentAt(world: vec2f, d: f32) -> vec3f {
  let out = world + normalAt(world) * (max(-d, 0.0) + probeSpacing() * 1.5);
  return fluenceAt(worldToUv(out));
}

// Light in the air at a point, nudged clear of any solid it's touching.
fn airLightAt(world: vec2f, uv: vec2f, d: f32) -> vec3f {
  let reach = probeSpacing() * 1.5;
  if (d > 0.0 && d < reach) {
    return fluenceAt(worldToUv(world + normalAt(world) * (reach - d)));
  }
  return fluenceAt(uv);
}

fn lampAt(world: vec2f, aa: f32) -> vec4f {
  if (u32(FP.mode) != 1u) { return vec4f(0.0); }
  // kept fat on purpose: a near-point source beads the low cascades' sparse
  // directions into dots
  let ld = length(world - FP.lamp);
  let cov = smoothstep(aa, -aa, ld - 0.085);
  // flat out to the edge: rays only ever read a light at its surface
  return vec4f(vec3f(1.0, 0.8, 0.55) * 6.0 * FP.glow, cov);
}

@fragment
fn fsSceneF(in: FullOut) -> @location(0) vec4f {
  let world = uvToWorld(in.uv);
  let aa = 2.0 / (FP.viewScale.y * FP.res.y);
  let s = solidAt(world);
  let cov = smoothstep(aa, -aa, s.d);
  var emission = vec3f(0.0);
  if (cov > 0.0) {
    emission = s.albedo * 0.004;
    if (FP.bounce > 0.0) {
      emission += s.albedo * incidentAt(world, s.d) * exp(min(s.d, 0.0) / 0.06) * FP.bounce;
    }
    emission *= cov;
  }
  let lamp = lampAt(world, aa);
  emission = mix(emission, lamp.rgb, lamp.a);
  return vec4f(emission, max(cov, lamp.a));
}

// ---- media: the fog itself ------------------------------------------------------------
// Density is procedural mist plus cursor-blown smoke puffs.

fn fogDensity(world: vec2f) -> f32 {
  let mode = u32(FP.mode);
  var dens = 0.0;

  if (mode == 0u) {
    // ground mist: dense at the floor, thinning with height (one exponential,
    // like a real atmosphere), drifting east
    let gy = groundY(world.x);
    let h = world.y - gy;
    let band = exp(-max(h, 0.0) / max(FP.mist, 0.05));
    let drift = fbm(world * vec2f(1.4, 2.2) + vec2f(-FP.time * 0.05, FP.time * 0.012));
    dens = FP.fog * band * (0.35 + 0.85 * drift);
    // haze everywhere, thicker under the canopy, so the gaps between the
    // crowns have something for the sun to light
    let canopy = smoothstep(1.1, 0.2, h);
    dens += FP.fog * (0.12 + 0.3 * canopy) * fbm(world * vec2f(0.9, 1.6) + vec2f(FP.time * 0.02, 0.0));
    if (world.y < gy) { dens = 0.0; }
  } else {
    // rooms: near-uniform fog with a slow large-scale stir
    let wobble = 0.85 + 0.3 * (fbm(world * 1.3 + vec2f(FP.time * 0.04, -FP.time * 0.03)) - 0.5);
    dens = FP.fog * wobble;
    let inner = roomInner();
    if (abs(world.y) > inner.y || world.x > inner.x) { dens = 0.0; }
    if (mode == 1u && world.x < -inner.x) { dens = 0.0; }
    if (mode == 2u && world.x < windowWallX()) { dens = 0.0; }
  }

  // smoke puffs (cursor-blown)
  for (var i = 0u; i < u32(FP.puffCount); i++) {
    let p = puffs[i];
    let r = length(world - p.pos) / max(p.radius, 1e-3);
    dens += p.strength * exp(-r * r * 2.0);
  }
  return clamp(dens, 0.0, 2.5);
}

@fragment
fn fsMedia(in: FullOut) -> @location(0) vec4f {
  let world = uvToWorld(in.uv);
  let dens = fogDensity(world);
  // The glow channel holds the local light field (last frame's fluence)
  // with a slightly warm tint. The march multiplies in (1 − e^(−σρΔs))
  // itself, so density is NOT folded in here. A wide 5-tap blur: near a
  // bright source the probe grid leaves faint rings, and glowing fog
  // magnifies them. Fog is allowed to be blurry.
  let res = vec2f(FP.res);
  let o1 = vec2f(9.0, 3.0) / res;
  let o2 = vec2f(-3.0, 9.0) / res;
  let tint = vec3f(1.0, 0.95, 0.88);
  let glow = (fluenceAt(in.uv) + fluenceAt(in.uv + o1) + fluenceAt(in.uv - o1) +
              fluenceAt(in.uv + o2) + fluenceAt(in.uv - o2)) * 0.2 * tint;
  return vec4f(glow, dens);
}

// ---- display ---------------------------------------------------------------------------

fn backdrop(world: vec2f, uv: vec2f, light: vec3f) -> vec3f {
  let mode = u32(FP.mode);
  if (mode == 1u) {
    // the room's back wall, dimly lit by whatever light reaches it
    return light * 0.3;
  }
  if (mode == 2u && world.x > windowWallX()) {
    return light * 0.3;
  }
  // open sky: zenith to horizon, with the sun's glow toward its direction
  var sky = mix(FP.horizon.rgb, FP.zenith.rgb, smoothstep(0.92, 0.02, uv.y));
  let sunAt = normalize(FP.sunDir) * 1.15 / FP.viewScale * FP.viewScale.y;
  let ds = length((world - sunAt) * vec2f(1.0, 1.0));
  sky += FP.sunColor.rgb * FP.sunColor.w * (exp(-ds * ds * 9.0) * 0.6 + exp(-ds * 2.2) * 0.12);
  // a far row of pines, lost in the haze: drawn only, never lit or occluding
  // (they stand somewhere behind the plane the light lives in)
  if (mode == 0u) {
    var fd = 1e3;
    for (var k = 0; k < 9; k++) {
      let bx = -2.4 + f32(k) * 0.6 + 0.17 * sin(f32(k) * 7.1);
      let gy = groundY(bx) + 0.12;
      let h = 0.55 + 0.25 * fract(sin(f32(k) * 12.9) * 43.7);
      let q = world - vec2f(bx, gy);
      let t = clamp(q.y / h, 0.0, 1.0);
      let w = (1.0 - t) * 0.14 * h * mix(1.0, 0.55, fract(t * 5.0)) + 0.008;
      fd = min(fd, max(abs(q.x) - w, max(-q.y - 0.3, q.y - h)));
    }
    let far = smoothstep(0.003, -0.003, fd);
    sky = mix(sky, FP.horizon.rgb * 0.45 + FP.zenith.rgb * 0.3, far * 0.85);
  }
  return sky;
}

@fragment
fn fsDisplayF(in: FullOut) -> @location(0) vec4f {
  let world = uvToWorld(in.uv);
  let aa = 2.0 / (FP.viewScale.y * FP.res.y);
  let s = solidAt(world);
  let light = airLightAt(world, in.uv, s.d);

  // the air: backdrop seen through the fog, plus the fog's own glow
  let dens = fogDensity(world);
  let thick = dens * FP.sigma * 0.35;           // how much fog stands between you and the backdrop
  var col = backdrop(world, in.uv, light) * exp(-thick);
  col += light * dens * FP.scatter * FP.airGlow;

  // solids: albedo × the light reaching their surface
  let cov = smoothstep(aa, -aa, s.d);
  if (cov > 0.0) {
    let lit = s.albedo * incidentAt(world, s.d) * exp(min(s.d, 0.0) / 0.05) * 1.4 + s.albedo * 0.004;
    // fog in front of a solid still glows a little
    col = mix(col, lit * exp(-thick * 0.5) + light * dens * FP.scatter * FP.airGlow * 0.3, cov);
  }
  let lamp = lampAt(world, aa);
  col = mix(col, lamp.rgb * 0.6, lamp.a);
  return vec4f(col, 1.0);
}
