// Part three: participating media. The world here is mostly inherited — the
// scene pass paints emission + occlusion exactly as the bonfire did. What's
// new is the media pass: it renders the fog itself into a second texture,
// a = extinction density, rgb = the fog's *glow* (density × last frame's
// fluence × the fog's albedo). The cascade march in rc.wgsl then attenuates
// every ray through the density and picks up the glow along the way.
//
// One shader, three worlds, switched by FP.mode:
//   0 — the dawn forest: trees, ground, a low sun, ground mist
//   1 — the lamp room: one warm lamp in a closed dark room of uniform fog
//   2 — the window room: sun outside, two slits in the wall, shafts inside

struct FogParams {
  viewScale: vec2f, // world [-1,1] → clip
  res: vec2f,       // scene texture px
  time: f32,
  mode: f32,
  fog: f32,         // fog amount knob (density multiplier)
  glow: f32,        // lamp brightness
  lamp: vec2f,      // cursor lamp, world (mode 1)
  bounce: f32,
  puffCount: f32,
  probes0: vec2f,   // cascade-0 probe grid, for fluence sampling
  mist: f32,        // mode 0: how high the ground mist sits
  _p0: f32,
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
  return -0.62 + 0.07 * sin(x * 1.9 + 1.2) + 0.035 * sin(x * 4.7 + 0.6);
}

fn sdCapsule(p: vec2f, a: vec2f, b: vec2f, r: f32) -> f32 {
  let pa = p - a;
  let ba = b - a;
  let h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - r;
}

// pines: a trunk and a heavy crown. The crowns matter more than the trunks —
// god rays need *wide* occluders with gaps between them, and a crown is the
// widest thing a forest owns.
fn treeDist(world: vec2f, baseX: f32, h: f32, seed: f32) -> f32 {
  let gy = groundY(baseX);
  let sway = 0.02 * sin(seed * 9.0);
  let top = vec2f(baseX + sway, gy + h);
  var d = sdCapsule(world, vec2f(baseX, gy - 0.05), top, 0.022 + 0.014 * h);
  // crown: a lumpy ellipse, big enough to cast a shadow the upper cascades
  // can't interpolate away
  let c = world - (top + vec2f(0.0, 0.08));
  let lump = 1.0 + 0.5 * (vnoise(world * 9.0 + seed * 13.0) - 0.5);
  d = min(d, length(c * vec2f(1.25, 1.7)) - 0.26 * h * lump);
  let m1 = mix(gy, gy + h, 0.6);
  d = min(d, sdCapsule(world, vec2f(baseX + sway * 0.5, m1), vec2f(baseX + 0.16 * h, m1 + 0.22 * h), 0.011));
  return d;
}

// ---- scene (emission + occlusion), same contract as parts one and two ---------------

struct SceneEval {
  emission: vec3f,
  albedo: vec3f,
  occ: f32,
}

fn evalScene(world: vec2f, aa: f32) -> SceneEval {
  var emission = vec3f(0.0);
  var albedo = vec3f(0.0);
  var occ = 0.0;
  let mode = u32(FP.mode);

  if (mode == 0u) {
    // ---- the dawn forest ------------------------------------------------------
    let gy = groundY(world.x);
    let gcov = smoothstep(aa, -aa, world.y - gy);
    if (gcov > 0.0) {
      occ = gcov;
      let depth = gy - world.y;
      albedo = mix(vec3f(0.13, 0.13, 0.10), vec3f(0.05, 0.05, 0.045), smoothstep(0.0, 0.25, depth)) * gcov;
    }
    let t1 = treeDist(world, -1.05, 0.9, 1.0);
    let t2 = treeDist(world, -0.42, 1.1, 2.0);
    let t3 = treeDist(world, 0.3, 0.85, 3.0);
    let t4 = treeDist(world, 0.95, 1.15, 4.0);
    let t5 = treeDist(world, 1.55, 0.9, 5.0);
    let td = min(min(min(t1, t2), min(t3, t4)), t5);
    let tcov = smoothstep(aa, -aa, td);
    if (tcov > 0.0) {
      occ = max(occ, tcov);
      albedo = mix(albedo, vec3f(0.05, 0.075, 0.04), tcov);
    }
  } else if (mode == 1u) {
    // ---- the lamp room ----------------------------------------------------------
    let b = 0.92;
    let wcov = smoothstep(-aa, aa, max(abs(world.x), abs(world.y)) - b);
    if (wcov > 0.0) {
      occ = max(occ, wcov);
      albedo = mix(albedo, vec3f(0.30, 0.30, 0.33), wcov);
    }
    // a pillar, so the fog has a shadow to make visible
    let pd = max(abs(world.x - 0.45) - 0.045, abs(world.y + 0.18) - 0.42);
    let pcov = smoothstep(aa, -aa, pd);
    if (pcov > 0.0) {
      occ = max(occ, pcov);
      albedo = mix(albedo, vec3f(0.22, 0.24, 0.3), pcov);
    }
    // the lamp follows the cursor. Kept deliberately fat: a near-point
    // source beads the low cascades' sparse directions into visible dots,
    // and a wide soft emitter is the honest fix.
    let ld = length(world - FP.lamp);
    let lampCov = smoothstep(aa, -aa, ld - 0.09);
    if (lampCov > 0.0) {
      occ = max(occ, lampCov);
      albedo = mix(albedo, vec3f(0.0), lampCov);
      emission = vec3f(1.0, 0.8, 0.55) * 4.5 * FP.glow * smoothstep(0.09, 0.025, ld);
    }
  } else {
    // ---- the window room ----------------------------------------------------------
    // floor, ceiling, right wall: plain plaster. The left wall is thicker
    // and pierced by two slits — the slits carve all the way through, so
    // the sky's sun can pour in.
    let b = 0.92;
    var wallCov = step(0.0, max(abs(world.x), abs(world.y)) - b);
    if (world.x < -b + 0.10) {
      let slit = abs(world.y - 0.44) < 0.115 || abs(world.y - 0.0) < 0.115;
      wallCov = select(1.0, 0.0, slit);
    }
    if (wallCov > 0.0) {
      occ = max(occ, wallCov);
      albedo = mix(albedo, vec3f(0.30, 0.29, 0.27), wallCov);
    }
    // a table under the shafts — something for the light to land on
    let td = max(abs(world.x - 0.18) - 0.34, abs(world.y + 0.62) - 0.05);
    let tcov = smoothstep(aa, -aa, td);
    if (tcov > 0.0) {
      occ = max(occ, tcov);
      albedo = mix(albedo, vec3f(0.32, 0.2, 0.1), tcov);
    }
  }

  return SceneEval(emission, albedo, occ);
}

// ---- fluence (last frame's light), for bounce and for the fog's glow -----------------

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

@fragment
fn fsSceneF(in: FullOut) -> @location(0) vec4f {
  let clip = vec2f(in.uv.x * 2.0 - 1.0, 1.0 - in.uv.y * 2.0);
  let world = clip / FP.viewScale;
  let aa = 2.0 / (FP.viewScale.y * FP.res.y);
  let s = evalScene(world, aa);
  var emission = s.emission + s.albedo * 0.012;
  if (s.occ > 0.5 && FP.bounce > 0.0) {
    emission += s.albedo * fluenceAt(in.uv) * FP.bounce;
  }
  return vec4f(emission, s.occ);
}

// ---- media: the fog itself ------------------------------------------------------------
// Density is procedural mist plus cursor-blown smoke puffs; the glow channel
// multiplies that density by last frame's fluence. Fog that light reaches
// shines; fog in shadow stays dark — god rays are exactly this difference.

fn fogDensity(world: vec2f, uv: vec2f) -> f32 {
  let mode = u32(FP.mode);
  var dens = 0.0;

  if (mode == 0u) {
    // ground mist: dense at the floor, thinning with height, drifting east
    let gy = groundY(world.x);
    let h = world.y - gy;
    let band = exp(-max(h, 0.0) / max(FP.mist, 0.05));
    let drift = fbm(world * vec2f(1.4, 2.2) + vec2f(-FP.time * 0.05, FP.time * 0.012));
    dens = FP.fog * band * (0.35 + 0.85 * drift);
    // thin haze everywhere, so even the canopy gaps participate a little
    dens += FP.fog * 0.10 * fbm(world * 0.9 + vec2f(FP.time * 0.02, 0.0));
    if (world.y < gy) { dens = 0.0; }
  } else {
    // rooms: near-uniform fog with a slow large-scale stir
    let wobble = 0.85 + 0.3 * (fbm(world * 1.3 + vec2f(FP.time * 0.04, -FP.time * 0.03)) - 0.5);
    dens = FP.fog * wobble;
    if (max(abs(world.x), abs(world.y)) > 0.92) { dens = 0.0; }
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
  let clip = vec2f(in.uv.x * 2.0 - 1.0, 1.0 - in.uv.y * 2.0);
  let world = clip / FP.viewScale;
  let dens = fogDensity(world, in.uv);
  // the glow channel holds the local light field (last frame's fluence) with
  // a slightly warm tint — droplets scatter sunrise light amber-ish. The
  // march multiplies in the density's (1 − e^(−σρΔs)) itself, so density is
  // NOT folded in here. The wide 5-tap blur matters: near a bright source
  // the cascades' probe grid leaves faint rings, and glowing fog is a
  // magnifying glass for them — fog is allowed to be blurry.
  let res = vec2f(FP.res);
  let o1 = vec2f(9.0, 3.0) / res;
  let o2 = vec2f(-3.0, 9.0) / res;
  let tint = vec3f(1.0, 0.93, 0.82);
  let glow = (fluenceAt(in.uv) + fluenceAt(in.uv + o1) + fluenceAt(in.uv - o1) +
              fluenceAt(in.uv + o2) + fluenceAt(in.uv - o2)) * 0.2 * tint;
  return vec4f(glow, dens);
}
