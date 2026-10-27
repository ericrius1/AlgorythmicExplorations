// The bonfire: free-flying ember particles (no SPH — nothing presses on
// anything) riding curl-noise wind, splatted into the radiance-cascades
// scene as hundreds to thousands of tiny moving lights. The scene pass paints
// the world (ground, pines, log, flame) and closes the multi-bounce loop by
// adding albedo × last frame's light to every surface's emission.
//
// One shader, three worlds, switched by BP.mode:
//   0 — the bonfire: ground, pines, log, flame, embers
//   1 — the counting room: drifting sparks among pillars (the many-lights demo)
//   2 — the bounce room: coloured walls and one draggable lamp, no embers
//
// Solids are signed distance functions. That buys two things: anti-aliased
// edges at any resolution, and a surface normal, so a solid point can be lit
// by the light arriving just *outside* it. (Inside a solid, cascade 0 only
// sees the solid itself, so sampling the light there gives a dark, blocky
// rim at the cascades' resolution.)

struct BonfireParams {
  viewScale: vec2f, // world [-1,1] → clip
  res: vec2f,       // target px (scene texture for the GI path, canvas for display)
  count: u32,
  dt: f32,
  time: f32,
  wind: f32,
  buoyancy: f32,
  drag: f32,
  emberSize: f32,   // world units
  fireScale: f32,
  stir: vec2f,      // cursor/palm, world
  stirVel: vec2f,
  stirRadius: f32,
  stirStrength: f32,
  bounce: f32,      // albedo × fluence feedback strength
  night: f32,       // 0 day … 1 night (stars)
  emit2: vec2f,     // second emitter (index fingertip), world
  emit2On: f32,
  glow: f32,
  probes0: vec2f,   // cascade-0 probe grid, for fluence sampling
  mode: f32,
  emitBoost: f32,   // how much raw emission the display path adds (GI path: 1)
  skyZenith: vec4f, // display backdrop (mode 0): the sky the camera sees, linear
  skyHorizon: vec4f,
}

struct Ember {
  pv: vec4f,  // pos.xy, vel.zw
  aux: vec4f, // life, maxLife, heat, seed
}

@group(0) @binding(0) var<uniform> BP: BonfireParams;
@group(0) @binding(1) var<storage, read_write> embers: array<Ember>;   // compute
@group(0) @binding(2) var fluenceTex: texture_2d<f32>;
@group(0) @binding(3) var linSamp: sampler;
@group(0) @binding(4) var<storage, read> embersR: array<Ember>;        // render (vertex can't take read_write)

// ---- noise -------------------------------------------------------------------

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
  return vnoise(p) * 0.65 + vnoise(p * 2.13 + 7.7) * 0.35;
}

// Curl noise, as in Particle Worlds part six: rotate the gradient of smooth
// noise a quarter turn and the wind can't converge or diverge anywhere.
fn curl(p: vec2f) -> vec2f {
  let e = 0.04;
  let q = p * 2.1 + vec2f(BP.time * 0.07, -BP.time * 0.045);
  let dx = fbm(q + vec2f(e, 0.0)) - fbm(q - vec2f(e, 0.0));
  let dy = fbm(q + vec2f(0.0, e)) - fbm(q - vec2f(0.0, e));
  return vec2f(dy, -dx) / (2.0 * e);
}

// ---- world geometry -------------------------------------------------------------

fn groundY(x: f32) -> f32 {
  return -0.55 + 0.06 * sin(x * 2.3 + 1.7) + 0.03 * sin(x * 5.1 + 0.6);
}

fn sdCapsule(p: vec2f, a: vec2f, b: vec2f, r: f32) -> f32 {
  let pa = p - a;
  let ba = b - a;
  let h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - r;
}

// A pine: a thin trunk and a crown of stacked tiers, each wide at its base
// and drawn in toward the next, with a ragged needle edge.
fn pineDist(world: vec2f, baseX: f32, h: f32, seed: f32) -> f32 {
  let gy = groundY(baseX);
  let q = world - vec2f(baseX, gy);
  let trunk = sdCapsule(q, vec2f(0.0, -0.05), vec2f(0.0, h * 0.9), 0.008 + 0.012 * h);
  let c0 = 0.05 * h; // the lowest boughs reach almost to the ground
  let t = clamp((q.y - c0) / (h - c0), 0.0, 1.0);
  let tiers = 4.0 + floor(seed * 1.7);
  let saw = fract(t * tiers + seed * 0.37);
  var w = (1.0 - t) * 0.24 * h * mix(1.0, 0.5, saw);
  w *= 1.0 + 0.14 * (vnoise(q * vec2f(55.0, 30.0) + seed * 9.0) - 0.5);
  let crown = max(abs(q.x) - w, max(c0 - q.y, q.y - h)) * 0.75;
  return min(trunk, crown);
}

// Signed distance to every solid in the world, and its albedo. The flame,
// the lamp and the stars are emitters, handled separately.
struct Solid {
  d: f32,
  albedo: vec3f,
}

fn solidAt(world: vec2f) -> Solid {
  let mode = u32(BP.mode);
  var s = Solid(1e3, vec3f(0.0));
  if (mode == 0u) {
    let gd = (world.y - groundY(world.x)) * 0.92;
    s = Solid(gd, vec3f(0.17, 0.14, 0.09));
    // pines around the clearing, two rows: the near row tall, the far row
    // shorter and set back toward the edges
    var td = 1e3;
    td = min(td, pineDist(world, -2.05, 0.95, 0.3));
    td = min(td, pineDist(world, -1.55, 1.2, 0.8));
    td = min(td, pineDist(world, -1.02, 0.9, 0.1));
    td = min(td, pineDist(world, 0.95, 1.02, 0.6));
    td = min(td, pineDist(world, 1.42, 1.26, 0.2));
    td = min(td, pineDist(world, 1.95, 0.88, 0.9));
    td = min(td, pineDist(world, 2.4, 1.1, 0.5));
    td = min(td, pineDist(world, -2.55, 1.15, 0.7));
    if (td < s.d) { s = Solid(td, vec3f(0.06, 0.10, 0.05)); }
    // the log
    let gy0 = groundY(0.0);
    let ld = sdCapsule(world, vec2f(-0.13, gy0 + 0.014), vec2f(0.13, gy0 + 0.006), 0.022);
    if (ld < s.d) { s = Solid(ld, vec3f(0.16, 0.08, 0.04)); }
  } else if (mode == 1u) {
    // the counting room: three pillars
    for (var k = 0; k < 3; k++) {
      let x = -0.55 + f32(k) * 0.55;
      let p = world - vec2f(x, -0.08 + 0.16 * f32(k % 2));
      let pd = max(abs(p.x) - 0.045, abs(p.y) - 0.36);
      if (pd < s.d) { s = Solid(pd, vec3f(0.3, 0.32, 0.38)); }
    }
  } else {
    // the bounce room: walls just inside the canvas edge, crimson on the
    // left, teal on the right, warm grey plaster top and bottom. The room's
    // interior is a box; the walls are everything outside it.
    let inner = 1.0 / BP.viewScale - vec2f(0.2, 0.12);
    let q = abs(world) - inner;
    let box = length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0);
    var col = vec3f(0.74, 0.72, 0.68);  // white plaster, like the Cornell box
    if (q.x > q.y) {
      col = select(vec3f(0.04, 0.66, 0.58), vec3f(0.86, 0.06, 0.07), world.x < 0.0);
    }
    s = Solid(-box, col);
    // a free-standing screen in the middle, so the room has a shadow in it;
    // short enough that the coloured walls can see round it
    let sd = max(abs(world.x - 0.15) - 0.035, abs(world.y + 0.16) - 0.25);
    if (sd < s.d) { s = Solid(sd, vec3f(0.72, 0.7, 0.66)); }
  }
  return s;
}

// The flame: a licking, noise-eroded teardrop above the log. Returns its
// emission and its density (the dense core blocks rays; the fringe doesn't).
fn flameAt(world: vec2f) -> vec4f {
  let fy = groundY(0.0);
  let fs = max(0.26 * BP.fireScale, 0.02);
  var fp = (world - vec2f(0.0, fy + 0.03)) / fs;
  if (fp.y < -0.1 || fp.y > 1.6 || abs(fp.x) > 0.8) { return vec4f(0.0); }
  let rise = smoothstep(0.0, 0.7, fp.y);
  // two octaves of sideways licking, stronger toward the tip
  fp.x += ((vnoise(vec2f(fp.y * 3.5 - BP.time * 2.6, BP.time * 1.4)) - 0.5) * 0.5 +
           (vnoise(vec2f(fp.y * 8.0 - BP.time * 5.2, BP.time * 2.1 + 7.0)) - 0.5) * 0.22) * rise;
  let taper = mix(1.5, 4.8, smoothstep(-0.1, 1.0, fp.y));
  var fd = length(fp * vec2f(taper, 1.05));
  fd += (fbm(fp * vec2f(2.5, 1.2) + vec2f(0.0, -BP.time * 2.4)) - 0.5) * 0.5;
  let flame = smoothstep(1.05, 0.45, fd) * step(-0.04, fp.y);
  if (flame <= 0.02) { return vec4f(0.0); }
  // hot near-white core low down; the sheath cools to deep orange-red
  let core = smoothstep(0.4, 1.0, flame) * smoothstep(0.9, 0.1, fp.y);
  var fc = mix(vec3f(1.0, 0.22, 0.02), vec3f(1.0, 0.58, 0.15), smoothstep(0.2, 0.8, flame));
  fc = mix(fc, vec3f(1.0, 0.88, 0.55), core);
  let pulse = 0.88 + 0.12 * vnoise(vec2f(BP.time * 2.4, 4.7));
  return vec4f(fc * flame * 6.5 * pulse * BP.glow, flame);
}

// ---- ember simulation -------------------------------------------------------------

@compute @workgroup_size(256)
fn emberSim(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= BP.count) { return; }
  var e = embers[i];
  let seed = e.aux.w;
  let sparks = BP.mode > 0.5; // mode 1: immortal drifting sparks

  var life = e.aux.x - BP.dt;
  var pos = e.pv.xy;
  var vel = e.pv.zw;
  var heat = e.aux.z;

  if (!sparks && life <= 0.0) {
    // respawn at the flame (or at a fingertip, when a hand offers one)
    let r1 = hash21(vec2f(seed, BP.time));
    let r2 = hash21(vec2f(BP.time * 1.7, seed + 4.2));
    let r3 = hash21(vec2f(seed * 3.1, BP.time * 0.9));
    var origin = vec2f(0.0, groundY(0.0) + 0.06);
    var spreadX = 0.09 * BP.fireScale;
    if (BP.emit2On > 0.5 && r3 < 0.45) {
      origin = BP.emit2;
      spreadX = 0.03;
    }
    pos = origin + vec2f((r1 - 0.5) * 2.0 * spreadX, r2 * 0.08);
    vel = vec2f((r1 - 0.5) * 0.18, 0.10 + r2 * 0.16);
    // most embers die young; the rare one rides the heat far up
    life = 0.5 + r1 * r2 * 1.8;
    heat = 0.8 + r2 * 0.35;
    embers[i] = Ember(vec4f(pos, vel), vec4f(life, life, heat, seed));
    return;
  }

  // wind, lift, drag
  var acc = curl(pos) * BP.wind;
  if (!sparks) {
    acc += vec2f(0.0, BP.buoyancy * heat);
    // entrainment: the rising plume pulls nearby air inward, so embers
    // stay in a loose cone over the fire instead of strewing the sky
    acc.x -= pos.x * 1.1;
  }

  // stirring: cursor or palm drags nearby air
  let md = pos - BP.stir;
  let mr = length(md);
  if (mr < BP.stirRadius) {
    acc += BP.stirVel * BP.stirStrength * (1.0 - mr / BP.stirRadius);
  }

  vel = (vel + acc * BP.dt) * (1.0 - BP.drag * BP.dt);
  pos += vel * BP.dt;
  heat *= exp(-0.7 * BP.dt);

  if (sparks) {
    // immortal: wrap the room, keep a steady glow
    let ext = 1.0 / BP.viewScale + 0.05;
    if (pos.x < -ext.x) { pos.x += 2.0 * ext.x; }
    if (pos.x > ext.x) { pos.x -= 2.0 * ext.x; }
    if (pos.y < -ext.y) { pos.y += 2.0 * ext.y; }
    if (pos.y > ext.y) { pos.y -= 2.0 * ext.y; }
    heat = 0.75 + 0.25 * sin(BP.time * (1.5 + seed * 3.0) + seed * 40.0);
    life = 1.0;
  } else {
    // embers die against the ground or when their time is up
    if (pos.y < groundY(pos.x) + 0.01) { life = 0.0; }
    if (abs(pos.x) > 2.6 || pos.y > 1.3) { life = 0.0; }
  }

  embers[i] = Ember(vec4f(pos, vel), vec4f(life, e.aux.y, heat, seed));
}

// ---- ember splat ----------------------------------------------------------------

fn emberColor(heat: f32, seed: f32) -> vec3f {
  if (BP.mode > 0.5) {
    // sparks: a scatter of hues so the room reads as *many* lights
    let h = fract(seed * 7.31);
    if (h < 0.55) { return vec3f(1.0, 0.55, 0.18) * 1.2; }   // warm
    if (h < 0.8) { return vec3f(0.25, 0.75, 1.0) * 1.1; }    // cyan
    return vec3f(0.85, 0.4, 1.0) * 1.0;                      // violet
  }
  let a = smoothstep(0.15, 0.55, heat);
  let b = smoothstep(0.5, 0.95, heat);
  let cold = vec3f(0.45, 0.05, 0.012);
  let mid = vec3f(1.0, 0.32, 0.05);
  let hot = vec3f(1.0, 0.68, 0.3);
  return mix(mix(cold, mid, a), hot, b) * (0.08 + 1.5 * heat * heat);
}

struct EmberOut {
  @builtin(position) pos: vec4f,
  @location(0) local: vec2f,
  @location(1) @interpolate(flat) idx: u32,
  @location(2) @interpolate(flat) bscale: f32,
}

@vertex
fn vsEmber(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> EmberOut {
  var corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
  );
  let e = embersR[ii];
  let alive = select(1.0, 0.0, e.aux.x <= 0.0 && BP.mode < 0.5);
  // embers shrink as they die instead of popping out; sparks (mode 1) don't age
  var fade = 1.0;
  if (BP.mode < 0.5) {
    fade = 0.35 + 0.65 * smoothstep(0.0, 0.35, clamp(e.aux.x / max(e.aux.y, 1e-3), 0.0, 1.0));
  }
  let jitter = 0.65 + 0.7 * fract(e.aux.w * 5.7);
  var size = BP.emberSize * (0.55 + 0.45 * e.aux.z) * alive * fade * jitter;
  // never let a splat shrink under ~1.5 target pixels: sub-pixel quads shimmer
  // as they drift across pixel centres, and GI rays hit-or-miss them per frame.
  // Clamp the footprint, dim the colour by the area ratio to conserve energy.
  var bscale = 1.0;
  let minSize = 3.0 / (BP.viewScale.y * BP.res.y); // 1.5 px in world units
  if (size > 1e-5 && size < minSize) {
    bscale = (size / minSize) * (size / minSize);
    size = minSize;
  }
  let world = e.pv.xy + corners[vi] * size;
  var out: EmberOut;
  out.pos = vec4f(world * BP.viewScale, 0.0, 1.0);
  out.local = corners[vi];
  out.idx = ii;
  out.bscale = bscale;
  return out;
}

@fragment
fn fsEmber(in: EmberOut) -> @location(0) vec4f {
  let q2 = dot(in.local, in.local);
  if (q2 > 1.0) { discard; }
  let e = embersR[in.idx];
  let w = (1.0 - q2) * (1.0 - q2);
  let flick = 0.8 + 0.2 * sin(BP.time * (6.0 + e.aux.w * 9.0) + e.aux.w * 80.0);
  // fade with remaining life so embers gutter out instead of vanishing
  var fade = 1.0;
  if (BP.mode < 0.5) {
    fade = smoothstep(0.0, 0.3, clamp(e.aux.x / max(e.aux.y, 1e-3), 0.0, 1.0));
    // fade *in* too: newborn embers are still inside the flame, and showing
    // them there piles a white dot-clump on the flame's tip
    fade *= smoothstep(0.0, 0.2, e.aux.y - e.aux.x);
    // and stay dim while overlapping the flame body
    let fc = vec2f(0.0, groundY(0.0) + 0.12);
    let fr = length((e.pv.xy - fc) * vec2f(1.3, 0.75)) / max(0.24 * BP.fireScale, 0.02);
    fade *= mix(0.18, 1.0, smoothstep(0.5, 1.3, fr));
  }
  let col = emberColor(e.aux.z, e.aux.w) * BP.glow * flick * fade * in.bscale * BP.emitBoost;
  // cooled embers also stop occluding — an opaque dim ember reads as a
  // dark speck punched into the glow behind it
  var occA = 1.0;
  if (BP.mode < 0.5) {
    occA = 0.25 + 0.75 * smoothstep(0.1, 0.5, e.aux.z);
    // in daylight an ember's own light is nothing next to the sky's, but as
    // an occluder it would still cast a dark ring around itself in the
    // light field: past dusk, embers stop taking part in the lighting
    occA *= smoothstep(0.0, 0.35, BP.night);
  }
  return vec4f(col * w, w * 1.4 * fade * occA); // alpha core ≥ 1: rays must be able to hit a spark
}

// ---- light lookups -----------------------------------------------------------------

struct FullOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn vsFullB(@builtin(vertex_index) vi: u32) -> FullOut {
  var pts = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var out: FullOut;
  out.pos = vec4f(pts[vi], 0.0, 1.0);
  out.uv = pts[vi] * vec2f(0.5, -0.5) + 0.5;
  return out;
}

fn worldToUv(w: vec2f) -> vec2f {
  let c = w * BP.viewScale;
  return vec2f(c.x * 0.5 + 0.5, 0.5 - c.y * 0.5);
}

// Last frame's light at a point: four direction blocks of cascade 0,
// hardware-bilinear, averaged. One frame late, which is what makes
// multi-bounce free: bounce n arrives n frames after the source moves.
fn fluenceAt(uv: vec2f) -> vec3f {
  let texFull = vec2f(textureDimensions(fluenceTex));
  let local = clamp(uv, vec2f(0.5) / BP.probes0, 1.0 - vec2f(0.5) / BP.probes0);
  var sum = vec3f(0.0);
  for (var d = 0u; d < 4u; d++) {
    let cb = vec2f(f32(d % 2u), f32(d / 2u));
    let tuv = (cb + local) * BP.probes0 / texFull;
    sum += textureSampleLevel(fluenceTex, linSamp, tuv, 0.0).rgb;
  }
  return sum * 0.25;
}

// Light arriving at a solid point, from outside the solid: step out along the
// surface normal past the surface, by a couple of probe spacings, and read
// the light there. `depth` fades it with distance under the surface.
fn probeSpacing() -> f32 {
  return 2.0 / (BP.viewScale.y * BP.probes0.y); // one cascade-0 probe spacing, world units
}

fn normalAt(world: vec2f) -> vec2f {
  let e = probeSpacing() * 0.5;
  return normalize(vec2f(
    solidAt(world + vec2f(e, 0.0)).d - solidAt(world - vec2f(e, 0.0)).d,
    solidAt(world + vec2f(0.0, e)).d - solidAt(world - vec2f(0.0, e)).d,
  ) + vec2f(0.0, 1e-6));
}

fn incidentAt(world: vec2f, d: f32) -> vec3f {
  let probeW = probeSpacing();
  let n = normalAt(world);
  let out = world + n * (max(-d, 0.0) + probeW * 1.5);
  // soft-limit: a surface touching the flame would otherwise read the
  // flame's own emission and glow like a lamp
  let f = fluenceAt(worldToUv(out));
  if (u32(BP.mode) != 0u) { return f; }
  return f / (1.0 + max(max(f.r, f.g), f.b) * 0.6);
}

// How far light soaks under each kind of surface before it's dark: thin
// things (needles, the screen) are lit through; soil and walls only skin-deep.
fn soak(world: vec2f, d: f32) -> f32 {
  let mode = u32(BP.mode);
  var depthScale = 0.025;
  if (mode == 0u) { depthScale = select(0.06, 0.08, world.y > groundY(world.x) + 0.004); }
  if (mode == 2u) { depthScale = 0.3; }
  return exp(min(d, 0.0) / depthScale);
}

fn starsAt(world: vec2f) -> vec3f {
  if (BP.night <= 0.3 || u32(BP.mode) != 0u) { return vec3f(0.0); }
  let cell = floor(world * 70.0);
  let s = hash21(cell);
  if (s < 0.985) { return vec3f(0.0); }
  // a soft point somewhere inside the cell, twinkling slowly
  let c = (cell + vec2f(hash21(cell + 3.1), hash21(cell + 7.7)) * 0.6 + 0.2) / 70.0;
  let r = length(world - c) * 70.0 * 6.0;
  let tw = 0.65 + 0.35 * sin(BP.time * (0.6 + s * 1.3) + s * 900.0);
  let mag = (s - 0.985) / 0.015;
  return vec3f(0.6, 0.7, 1.0) * exp(-r * r) * (0.25 + mag * mag * 2.5) * tw * (BP.night - 0.3) * 1.4;
}

// ---- the bounce room's extras ---------------------------------------------------------

// A dim window in the top wall, right of centre: cool evening light, so the
// warm lamp has something to play against and the screen's shadow isn't void.
fn roomWindow(world: vec2f, aa: f32) -> vec4f {
  if (u32(BP.mode) != 2u) { return vec4f(0.0); }
  let inner = 1.0 / BP.viewScale - vec2f(0.2, 0.12);
  let wx = abs(world.x - inner.x * 0.55) - inner.x * 0.22;
  let wy = abs(world.y - (inner.y + 0.03)) - 0.03;
  let cov = smoothstep(aa, -aa, max(wx, wy));
  return vec4f(vec3f(0.30, 0.48, 0.95) * 1.1, cov);
}

fn lampCover(world: vec2f, aa: f32) -> f32 {
  return smoothstep(aa, -aa, length(world - BP.stir) - 0.075);
}

// Irradiance for the room's floor, smoothed: nine taps over about one
// cascade-1 probe cell, skipping taps that land inside a solid so the
// blur never reaches through a wall or the screen. This softens the last
// of the probe-grid pattern without smearing the shadow edge much.
fn smoothFluence(world: vec2f, uv: vec2f) -> vec3f {
  let r = probeSpacing() * 2.2;
  var sum = fluenceAt(uv) * 2.0;
  var wsum = 2.0;
  for (var k = 0; k < 8; k++) {
    let a = f32(k) * 0.7853981634 + 0.3926990817;
    let p = world + vec2f(cos(a), sin(a)) * r;
    if (solidAt(p).d > 0.0) {
      sum += fluenceAt(worldToUv(p));
      wsum += 1.0;
    }
  }
  return sum / wsum;
}

// The floor, seen from above: pale boards with a little grain, so light
// falling on it reads as light on a surface rather than as fog.
fn floorAlbedo(world: vec2f) -> vec3f {
  let boardW = 0.2;
  let boardL = 1.3;
  let row = floor(world.y / boardW);
  let x = world.x + hash21(vec2f(row, 3.0)) * boardL;
  let seg = floor(x / boardL);
  let tone = 0.9 + 0.1 * hash21(vec2f(row, seg));
  let grain = 0.95 + 0.05 * vnoise(vec2f(x * 30.0, world.y * 5.0 + row * 13.0));
  let fy = fract(world.y / boardW);
  let fx = fract(x / boardL);
  let seam = min(smoothstep(0.0, 0.02, fy) * smoothstep(1.0, 0.98, fy), smoothstep(0.0, 0.003, fx) * smoothstep(1.0, 0.997, fx));
  return vec3f(0.60, 0.54, 0.46) * tone * grain * mix(0.86, 1.0, seam);
}

// ---- GI path: emission + occlusion for the cascades ------------------------------

@fragment
fn fsScene(in: FullOut) -> @location(0) vec4f {
  let clip = vec2f(in.uv.x * 2.0 - 1.0, 1.0 - in.uv.y * 2.0);
  let world = clip / BP.viewScale;
  let aa = 2.0 / (BP.viewScale.y * BP.res.y); // one pixel, world units
  let s = solidAt(world);
  let cov = smoothstep(aa, -aa, s.d);
  var emission = vec3f(0.0);
  var occ = cov;
  if (cov > 0.0) {
    // multi-bounce: surfaces re-emit a slice of the light they received
    // last frame, plus a whisper of base colour so silhouettes stay readable
    var bounce = s.albedo * 0.004;
    if (BP.bounce > 0.0) {
      bounce += 2.0 * s.albedo * incidentAt(world, s.d) * soak(world, s.d) * BP.bounce;
    }
    emission = bounce * cov;
  }
  if (u32(BP.mode) == 0u) {
    let fl = flameAt(world);
    emission += fl.rgb;
    occ = max(occ, step(0.5, fl.a));
  } else if (u32(BP.mode) == 2u) {
    // the lamp: one warm disc that follows the cursor
    let lampCov = lampCover(world, aa);
    if (lampCov > 0.0) {
      occ = max(occ, lampCov);
      emission = mix(emission, vec3f(1.0, 0.78, 0.5) * 7.0 * BP.glow, lampCov);
    }
    let win = roomWindow(world, aa);
    emission = mix(emission, win.rgb, win.a);
  }
  return vec4f(emission, occ);
}

// ---- display path ---------------------------------------------------------------
//
// The GI runs on a downscaled scene texture (light is low-frequency; the
// cascades don't care). Upscaling that texture to the canvas would blur the
// geometry too, so the display re-evaluates the world per canvas pixel and
// lights it with the upsampled cascade-0 light. Bound with a uniform buffer
// whose res is the canvas's. Output is linear HDR, for PostFX.

@fragment
fn fsCompositeB(in: FullOut) -> @location(0) vec4f {
  let clip = vec2f(in.uv.x * 2.0 - 1.0, 1.0 - in.uv.y * 2.0);
  let world = clip / BP.viewScale;
  let aa = 2.0 / (BP.viewScale.y * BP.res.y);
  let mode = u32(BP.mode);

  // air shows the light passing through it
  var airGain = 0.6;
  if (mode == 1u) { airGain = 0.8; }
  if (mode == 2u) { airGain = 0.55; }
  // Air right next to a solid would interpolate between probes outside and
  // probes buried in the solid, which draws a dark, stair-stepped seam along
  // every edge; nudge those lookups out to clean air.
  let s = solidAt(world);
  var airUv = in.uv;
  let reach = probeSpacing() * 1.5;
  if (s.d > 0.0 && s.d < reach) {
    airUv = worldToUv(world + normalAt(world) * (reach - s.d));
  }
  var col = fluenceAt(airUv) * airGain + starsAt(world);
  if (mode == 2u) {
    // a diffuse floor under the light: re-emits 2·albedo·fluence (see fsScene)
    col = floorAlbedo(world) * smoothFluence(world, airUv) * 2.0;
  }
  if (mode == 0u) {
    // Outdoors, the air the camera looks through isn't one flat sheet: the
    // firelight lives in a layer of haze and smoke near the ground, and
    // above it you see the sky itself. Drawing all of the air at one gain
    // turns every tree's shadow into a black wedge reaching for the stars.
    let h = world.y - groundY(world.x);
    var haze = 0.1 + 0.9 * exp(-max(h, 0.0) / 0.42);
    // a column of smoke over the fire, drifting up and leaning with the wind
    let lean = world.x - 0.12 * BP.wind * h - 0.05 * sin(BP.time * 0.3 + h * 2.0);
    let width = 0.03 + 0.3 * h;
    let column = exp(-lean * lean / (width * width)) * smoothstep(0.08, 0.4, h) * exp(-h / 0.8);
    // billows: noise that rises with the smoke, thresholded into puffs
    let billow = smoothstep(0.35, 0.8, fbm(vec2f(lean * 5.0 / (0.4 + h), h * 2.6 - BP.time * 0.4)));
    haze += column * billow * 1.6;
    let uvy = clamp(in.uv.y, 0.0, 1.0);
    let backdrop = mix(BP.skyZenith.rgb, BP.skyHorizon.rgb, smoothstep(0.0, 0.85, uvy));
    col = backdrop + fluenceAt(airUv) * airGain * haze + starsAt(world) * (1.0 - column);
  }

  let cov = smoothstep(aa, -aa, s.d);
  if (cov > 0.0) {
    // solids show albedo × the light reaching their surface (bounce on or
    // off: this is what the eye sees, not what gets re-emitted)
    var albedo = s.albedo;
    if (mode == 0u && world.y < groundY(world.x) + 0.004) {
      // soil: a little grain and some scattered stones, so the firelit
      // ground has something for the light to rake across
      albedo *= 0.7 + 0.5 * fbm(world * vec2f(26.0, 40.0));
    }
    var inc = incidentAt(world, s.d);
    if (mode == 0u && s.d < -0.01) {
      // under the soil's surface, average the light above a short stretch of
      // ground, so the glow under the fire is a pool rather than a pillar
      let o = vec2f(0.09, 0.0);
      inc = (inc + incidentAt(world + o, solidAt(world + o).d) + incidentAt(world - o, solidAt(world - o).d)) / 3.0;
    }
    // (outdoors the eye adapts to the firelight: surfaces read a bit brighter)
    var gain = select(1.6, 2.6, mode == 0u);
    if (mode == 2u) { gain = 2.0; }
    let lit = albedo * inc * soak(world, s.d) * gain + albedo * 0.006;
    col = mix(col, lit, cov);
  }
  if (mode == 0u) {
    // the flame replaces what's behind it rather than adding to it: inside
    // its core the light field already holds the flame's own emission
    let fl = flameAt(world);
    col = col * (1.0 - smoothstep(0.2, 0.8, fl.a)) + fl.rgb * BP.emitBoost;
  } else if (mode == 2u) {
    let win = roomWindow(world, aa);
    col = mix(col, win.rgb * 1.6, win.a);
    // the lamp: a hot white core fading to its warm rim, bright enough in
    // HDR for the bloom to give it a glow
    let ld = length(world - BP.stir) / 0.075;
    let core = mix(vec3f(1.0, 0.95, 0.85) * 26.0, vec3f(1.0, 0.72, 0.42) * 9.0, smoothstep(0.2, 1.0, ld));
    col = mix(col, core * BP.glow, lampCover(world, aa));
  }
  return vec4f(col, 1.0);
}
