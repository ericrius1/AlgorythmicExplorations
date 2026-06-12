import{i as ve}from"./siteNav-DaR1fllU.js";import{S as ge,g as be,m as we}from"./demoShell-Btkj803W.js";import{g as ye,c as xe}from"./gpu-DBowy6aD.js";import{R as Be}from"./radianceCascades-siyOW2Rq.js";import{H as Pe}from"./hands-BijGc3zx.js";const Se=`// The bonfire: free-flying ember particles (no SPH — nothing presses on
// anything) riding curl-noise wind, splatted into the radiance-cascades
// scene as thousands of tiny moving lights. The scene pass paints the world
// — ground, trees, flame — and closes the multi-bounce loop by adding
// albedo × last frame's fluence to every surface's emission.
//
// One shader, three worlds, switched by BP.mode:
//   0 — the bonfire: terrain, trees, flame, embers
//   1 — the counting room: drifting sparks among pillars (the many-lights demo)
//   2 — the bounce room: colored walls and one draggable light, no embers

struct BonfireParams {
  viewScale: vec2f, // world [-1,1] → clip
  res: vec2f,       // scene texture px
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
  night: f32,       // 0 day … 1 night (stars, ember prominence)
  emit2: vec2f,     // second emitter (index fingertip), world
  emit2On: f32,
  glow: f32,
  probes0: vec2f,   // cascade-0 probe grid, for fluence sampling
  mode: f32,
  emitBoost: f32,   // how much raw emission the display path adds (GI path: 1)
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
@group(0) @binding(5) var hdrTex: texture_2d<f32>;                     // tonemap input (display path)

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

// Part six's lesson, miniaturized: rotate the gradient of smooth noise a
// quarter turn and the wind never pools.
fn curl(p: vec2f) -> vec2f {
  let e = 0.04;
  let q = p * 2.1 + vec2f(BP.time * 0.07, -BP.time * 0.045);
  let dx = fbm(q + vec2f(e, 0.0)) - fbm(q - vec2f(e, 0.0));
  let dy = fbm(q + vec2f(0.0, e)) - fbm(q - vec2f(0.0, e));
  return vec2f(dy, -dx) / (2.0 * e);
}

// ---- world geometry -------------------------------------------------------------

fn groundY(x: f32) -> f32 {
  return -0.55 + 0.08 * sin(x * 2.3 + 1.7) + 0.04 * sin(x * 5.1 + 0.6);
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
    // immortal: wrap the box, keep a steady glow
    if (pos.x < -1.05) { pos.x += 2.1; }
    if (pos.x > 1.05) { pos.x -= 2.1; }
    if (pos.y < -1.05) { pos.y += 2.1; }
    if (pos.y > 1.05) { pos.y -= 2.1; }
    heat = 0.75 + 0.25 * sin(BP.time * (1.5 + seed * 3.0) + seed * 40.0);
    life = 1.0;
  } else {
    // embers die against the ground or when their time is up
    if (pos.y < groundY(pos.x) + 0.01) { life = 0.0; }
    if (abs(pos.x) > 1.1 || pos.y > 1.1) { life = 0.0; }
  }

  embers[i] = Ember(vec4f(pos, vel), vec4f(life, e.aux.y, heat, seed));
}

// ---- ember splat ----------------------------------------------------------------

fn emberColor(heat: f32, seed: f32) -> vec3f {
  if (BP.mode > 0.5) {
    // sparks: a scatter of hues so the room reads as *many* lights
    let h = fract(seed * 7.31);
    if (h < 0.55) { return vec3f(1.0, 0.55, 0.18) * 2.4; }   // warm
    if (h < 0.8) { return vec3f(0.25, 0.75, 1.0) * 2.2; }    // cyan
    return vec3f(0.85, 0.4, 1.0) * 2.0;                      // violet
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
  // as they drift across pixel centers, and GI rays hit-or-miss them per frame.
  // Clamp the footprint, dim the color by the area ratio to conserve energy.
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
    // and stay dim while overlapping the flame body — dozens of additive
    // splats funneling through the tip otherwise saturate to a white clump
    let fc = vec2f(0.0, groundY(0.0) + 0.12);
    let fr = length((e.pv.xy - fc) * vec2f(1.3, 0.75)) / max(0.24 * BP.fireScale, 0.02);
    fade *= mix(0.18, 1.0, smoothstep(0.5, 1.3, fr));
  }
  let col = emberColor(e.aux.z, e.aux.w) * BP.glow * flick * fade * in.bscale * BP.emitBoost;
  // cooled embers also stop occluding — an opaque dim ember reads as a
  // dark speck punched into the glow behind it
  var occA = 1.0;
  if (BP.mode < 0.5) { occA = 0.25 + 0.75 * smoothstep(0.1, 0.5, e.aux.z); }
  return vec4f(col * w, w * 1.4 * fade * occA); // alpha core ≥ 1: rays must be able to hit a spark
}

// ---- scene -----------------------------------------------------------------------

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

// Last frame's light at this pixel: four direction blocks of cascade 0,
// hardware-bilinear, averaged. One frame late, which is exactly what makes
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

// capsule SDF, for trunks and branches
fn sdCapsule(p: vec2f, a: vec2f, b: vec2f, r: f32) -> f32 {
  let pa = p - a;
  let ba = b - a;
  let h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - r;
}

fn treeDist(world: vec2f, baseX: f32, h: f32, seed: f32) -> f32 {
  let gy = groundY(baseX);
  let top = vec2f(baseX + 0.03 * sin(seed * 9.0), gy + h);
  var d = sdCapsule(world, vec2f(baseX, gy - 0.05), top, 0.022 + 0.012 * h);
  // canopy: a lumpy ellipse around the crown
  let c = world - (top + vec2f(0.0, 0.06));
  let lump = 1.0 + 0.3 * (vnoise(world * 7.0 + seed * 13.0) - 0.5);
  d = min(d, length(c * vec2f(1.1, 1.7)) - 0.3 * h * lump);
  // one branch each side
  d = min(d, sdCapsule(world, top - vec2f(0.0, h * 0.45), top + vec2f(0.14, -h * 0.2), 0.012));
  d = min(d, sdCapsule(world, top - vec2f(0.0, h * 0.3), top + vec2f(-0.13, -h * 0.1), 0.012));
  return d;
}

// The world, evaluated at any resolution. The GI path calls this at scene-
// texture resolution (the rays don't need more); the display path calls it
// again per *canvas* pixel, so silhouettes stay crisp no matter how far the
// GI is downscaled. \`aa\` is one pixel in world units — SDF edges resolve to
// smooth coverage instead of a hard threshold, which is anti-aliasing for free.
struct SceneEval {
  emission: vec3f,
  albedo: vec3f,
  occ: f32,
}

fn evalScene(world: vec2f, aa: f32) -> SceneEval {
  var emission = vec3f(0.0);
  var albedo = vec3f(0.0);
  var occ = 0.0;
  let mode = u32(BP.mode);

  if (mode == 0u) {
    // ---- the bonfire ---------------------------------------------------------
    let gy = groundY(world.x);
    let gcov = smoothstep(aa, -aa, world.y - gy);
    if (gcov > 0.0) {
      occ = gcov;
      // mossy soil, a little lighter right at the surface
      let depth = gy - world.y;
      albedo = mix(vec3f(0.16, 0.15, 0.09), vec3f(0.07, 0.06, 0.045), smoothstep(0.0, 0.25, depth)) * gcov;
    }
    // trees
    let t1 = treeDist(world, -0.62, 0.55, 1.0);
    let t2 = treeDist(world, 0.58, 0.68, 2.0);
    let t3 = treeDist(world, 1.28, 0.45, 3.0);
    let t4 = treeDist(world, -1.32, 0.62, 4.0);
    let td = min(min(t1, t2), min(t3, t4));
    let tcov = smoothstep(aa, -aa, td);
    if (tcov > 0.0) {
      occ = max(occ, tcov);
      albedo = mix(albedo, vec3f(0.05, 0.09, 0.04), tcov); // dark needles drink most of the light
    }
    // the log
    let lcov = smoothstep(aa, -aa, sdCapsule(world, vec2f(-0.12, gy + 0.012), vec2f(0.12, gy + 0.012), 0.024));
    if (lcov > 0.0) {
      occ = max(occ, lcov);
      albedo = mix(albedo, vec3f(0.13, 0.07, 0.04), lcov);
    }
    // the flame: a licking, noise-eroded teardrop above the log
    let fy = groundY(0.0);
    let fs = max(0.24 * BP.fireScale, 0.02);
    var fp = (world - vec2f(0.0, fy + 0.035)) / fs;
    let rise = smoothstep(0.0, 0.7, fp.y);
    // two octaves of sideways licking, stronger toward the tip
    fp.x += ((vnoise(vec2f(fp.y * 3.5 - BP.time * 2.6, BP.time * 1.4)) - 0.5) * 0.5 +
             (vnoise(vec2f(fp.y * 8.0 - BP.time * 5.2, BP.time * 2.1 + 7.0)) - 0.5) * 0.22) * rise;
    // teardrop silhouette whose edge is eaten by upward-scrolling noise,
    // so the outline flickers instead of reading as a smooth blob
    let taper = mix(1.5, 4.8, smoothstep(-0.1, 1.0, fp.y));
    var fd = length(fp * vec2f(taper, 1.05));
    fd += (fbm(fp * vec2f(2.5, 1.2) + vec2f(0.0, -BP.time * 2.4)) - 0.5) * 0.5;
    let flame = smoothstep(1.05, 0.45, fd) * step(-0.04, fp.y);
    if (flame > 0.02) {
      // hot near-white core sits low; the sheath cools to deep orange-red
      let core = smoothstep(0.4, 1.0, flame) * smoothstep(0.9, 0.1, fp.y);
      var fc = mix(vec3f(1.0, 0.22, 0.02), vec3f(1.0, 0.6, 0.16), smoothstep(0.2, 0.8, flame));
      fc = mix(fc, vec3f(1.0, 0.9, 0.55), core);
      let pulse = 0.85 + 0.15 * vnoise(vec2f(BP.time * 3.1, 4.7));
      emission += fc * flame * 6.5 * pulse * BP.glow;
      occ = max(occ, step(0.5, flame));
    }
    // stars: emissive dust that owns no surface (rays never hit it)
    if (occ < 0.5 && BP.night > 0.3) {
      let s = hash21(floor(world * 110.0));
      if (s > 0.998) {
        emission += vec3f(0.5, 0.6, 0.8) * (s - 0.998) * 280.0 * (BP.night - 0.3) *
          (0.6 + 0.4 * sin(BP.time * 2.0 + s * 900.0));
      }
    }
  } else if (mode == 1u) {
    // ---- the counting room: three pillars, nothing else ----------------------
    for (var k = 0; k < 3; k++) {
      let x = -0.5 + f32(k) * 0.5;
      let p = world - vec2f(x, -0.1 + 0.15 * f32(k % 2));
      let pd = max(abs(p.x) - 0.05, abs(p.y) - 0.38);
      let pcov = smoothstep(aa, -aa, pd);
      if (pcov > 0.0) {
        occ = max(occ, pcov);
        albedo = mix(albedo, vec3f(0.22, 0.24, 0.3), pcov);
      }
    }
  } else {
    // ---- the bounce room ------------------------------------------------------
    let b = 0.92;
    let wcov = smoothstep(-aa, aa, max(abs(world.x), abs(world.y)) - b);
    if (wcov > 0.0) {
      occ = max(occ, wcov);
      var wc = vec3f(0.4, 0.38, 0.35);              // neutral plaster
      if (world.x < -b) { wc = vec3f(0.75, 0.08, 0.1); }  // crimson
      if (world.x > b) { wc = vec3f(0.07, 0.6, 0.52); }   // teal
      albedo = mix(albedo, wc, wcov);
    }
    // the lamp: one warm disk that follows the cursor
    let ld = length(world - BP.stir);
    let lampCov = smoothstep(aa, -aa, ld - 0.06);
    if (lampCov > 0.0) {
      occ = max(occ, lampCov);
      albedo = mix(albedo, vec3f(0.0), lampCov);
      emission = vec3f(1.0, 0.82, 0.6) * 6.0 * BP.glow * smoothstep(0.06, 0.02, ld);
    }
  }

  return SceneEval(emission, albedo, occ);
}

// multi-bounce: surfaces re-emit a slice of the light they received last frame.
// A probe buried inside an occluder sees only its own dark interior, so
// ground pixels sample the light a whisker above their own surface.
fn bounceLight(world: vec2f, uv: vec2f, albedo: vec3f, occ: f32) -> vec3f {
  // surfaces are never *pure* black even unlit — a whisper of base color
  // keeps silhouettes readable when the bounce is switched off
  var out = albedo * 0.012;
  if (occ > 0.5 && BP.bounce > 0.0) {
    var fuv = uv;
    var depthFade = 1.0;
    if (u32(BP.mode) == 0u && world.y < groundY(world.x)) {
      let surface = vec2f(world.x, groundY(world.x) + 0.03);
      let sclip = surface * BP.viewScale;
      fuv = vec2f(sclip.x * 0.5 + 0.5, 0.5 - sclip.y * 0.5);
      // light only skims the topsoil — without this the whole column of
      // dirt under the flame glows like a buried searchlight
      depthFade = smoothstep(0.18, 0.0, groundY(world.x) - world.y);
    }
    out += albedo * fluenceAt(fuv) * BP.bounce * depthFade;
  }
  return out;
}

@fragment
fn fsScene(in: FullOut) -> @location(0) vec4f {
  let clip = vec2f(in.uv.x * 2.0 - 1.0, 1.0 - in.uv.y * 2.0);
  let world = clip / BP.viewScale;
  let aa = 2.0 / (BP.viewScale.y * BP.res.y); // one pixel, world units
  let s = evalScene(world, aa);
  let emission = s.emission + bounceLight(world, in.uv, s.albedo, s.occ);
  return vec4f(emission, s.occ);
}

// ---- display path -----------------------------------------------------------------
//
// The GI runs on a downscaled scene texture (light is low-frequency; the
// cascades don't care). But upscaling that texture to the canvas blurs
// *geometry* too. So the display path re-evaluates the procedural scene per
// canvas pixel — crisp anti-aliased silhouettes — and adds the upsampled
// cascade-0 fluence on top. Bound with a uniform buffer whose res/emitBoost
// are the canvas's, not the scene texture's.

@fragment
fn fsCompositeB(in: FullOut) -> @location(0) vec4f {
  let clip = vec2f(in.uv.x * 2.0 - 1.0, 1.0 - in.uv.y * 2.0);
  let world = clip / BP.viewScale;
  let aa = 2.0 / (BP.viewScale.y * BP.res.y);
  let s = evalScene(world, aa);
  // air shows the light field itself; solid pixels show their own shading
  // (albedo × incident light — bounceLight already computes it). Gating by
  // the full-res occupancy is what keeps silhouettes crisp: raw fluence's
  // air/interior boundary only exists at probe resolution and would smear
  // a blurred halo over every edge.
  let shade = bounceLight(world, in.uv, s.albedo, s.occ);
  let solid = smoothstep(0.35, 0.65, s.occ);
  let col = mix(fluenceAt(in.uv), shade * 4.0, solid) + s.emission * BP.emitBoost;
  return vec4f(col, 1.0);
}

// embers are splatted into hdrTex additively between fsCompositeB and this,
// so they ride the same exposure curve instead of clipping against it
@fragment
fn fsTonemapB(in: FullOut) -> @location(0) vec4f {
  var col = textureSampleLevel(hdrTex, linSamp, in.uv, 0.0).rgb;
  col *= 1.5;                              // exposure, matching the debug path
  col = col / (1.0 + col);                 // gentle reinhard
  col = pow(col, vec3f(0.4545));           // to gamma
  // ±half an 8-bit step of dither: the night sky's slow gradient otherwise
  // quantizes into visible bands
  col += (hash21(in.pos.xy) - 0.5) / 255.0;
  return vec4f(col, 1.0);
}
`,oe=["final","scene (what the rays see)","occupancy","distance field","light only"],ke={zenith:[.004,.006,.016],horizon:[.012,.016,.035],sunDir:[.3,-1],sunIntensity:0,sunSharpness:40,sunColor:[1,1,1]},re={zenith:[.02,.03,.09],horizon:[.5,.2,.07],sunDir:[.92,-.2],sunIntensity:1.3,sunSharpness:48,sunColor:[1,.45,.15]},ze={zenith:[.12,.24,.5],horizon:[.55,.6,.66],sunDir:[.35,-1],sunIntensity:1.7,sunSharpness:90,sunColor:[1,.95,.85]};function L(s,o,n){return[s[0]+(o[0]-s[0])*n,s[1]+(o[1]-s[1])*n,s[2]+(o[2]-s[2])*n]}function Ce(s){const[o,n,r]=s<.5?[ke,re,s*2]:[re,ze,(s-.5)*2];return{zenith:L(o.zenith,n.zenith,r),horizon:L(o.horizon,n.horizon,r),sunDir:[o.sunDir[0]+(n.sunDir[0]-o.sunDir[0])*r,o.sunDir[1]+(n.sunDir[1]-o.sunDir[1])*r],sunIntensity:o.sunIntensity+(n.sunIntensity-o.sunIntensity)*r,sunSharpness:o.sunSharpness+(n.sunSharpness-o.sunSharpness)*r,sunColor:L(o.sunColor,n.sunColor,r)}}async function G(s,o){const n=await ye(),r=new ge(s,o.mode==="hero"?.52:.62);if(!n)return be(s);const Y=xe(r.canvas,n),O=o.mode==="hero"||o.mode==="full"||o.mode==="dusk",v=O?0:o.mode==="sparks"?1:2,T=r.canvas.width,D=r.canvas.height,se=T/D,_=O?1:.98,h=[_/se,_],l=new Be(n,Math.floor(T/2.5),Math.floor(D/2.5),4,v===2?0:.2);let c=o.mode==="sparks"?1024:o.mode==="room"?0:o.mode==="hero"?380:500;const w=8192;let y=v===1?.5:.25,x=v===2?1:v===1?.4:.7,M=!0,ae=1,ie=1,g=o.mode==="dusk"?.5:.07,B=0,q=0,V=performance.now();const f=n.createShaderModule({code:Se}),P=n.createBuffer({size:112,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),I=n.createBuffer({size:112,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),A=n.createSampler({magFilter:"linear",minFilter:"linear"}),N=n.createTexture({size:[T,D],format:"rgba16float",usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING}),E=N.createView(),S=n.createBuffer({size:w*32,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});{const e=new Float32Array(w*8);for(let t=0;t<w;t++)e[t*8]=Math.random()*2-1,e[t*8+1]=Math.random()*2-1,e[t*8+4]=Math.random()*4,e[t*8+5]=4,e[t*8+6]=Math.random(),e[t*8+7]=Math.random();n.queue.writeBuffer(S,0,e)}const X=n.createComputePipeline({layout:"auto",compute:{module:f,entryPoint:"emberSim"}}),F=n.createRenderPipeline({layout:"auto",vertex:{module:f,entryPoint:"vsEmber"},fragment:{module:f,entryPoint:"fsEmber",targets:[{format:"rgba16float",blend:{color:{srcFactor:"one",dstFactor:"one",operation:"add"},alpha:{srcFactor:"one",dstFactor:"one",operation:"add"}}}]},primitive:{topology:"triangle-list"}}),H=n.createRenderPipeline({layout:"auto",vertex:{module:f,entryPoint:"vsFullB"},fragment:{module:f,entryPoint:"fsScene",targets:[{format:"rgba16float"}]},primitive:{topology:"triangle-list"}}),$=n.createRenderPipeline({layout:"auto",vertex:{module:f,entryPoint:"vsFullB"},fragment:{module:f,entryPoint:"fsCompositeB",targets:[{format:"rgba16float"}]},primitive:{topology:"triangle-list"}}),W=n.createRenderPipeline({layout:"auto",vertex:{module:f,entryPoint:"vsFullB"},fragment:{module:f,entryPoint:"fsTonemapB",targets:[{format:navigator.gpu.getPreferredCanvasFormat()}]},primitive:{topology:"triangle-list"}}),le=n.createBindGroup({layout:X.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:P}},{binding:1,resource:{buffer:S}}]}),ce=n.createBindGroup({layout:F.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:P}},{binding:4,resource:{buffer:S}}]}),ue=n.createBindGroup({layout:H.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:P}},{binding:2,resource:l.fluence.view},{binding:3,resource:A}]}),de=n.createBindGroup({layout:F.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:I}},{binding:4,resource:{buffer:S}}]}),fe=n.createBindGroup({layout:$.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:I}},{binding:2,resource:l.fluence.view},{binding:3,resource:A}]}),me=n.createBindGroup({layout:W.getBindGroupLayout(0),entries:[{binding:3,resource:A},{binding:5,resource:E}]});let m=[99,99],u=[0,0],j=0,K=0;r.canvas.addEventListener("pointermove",e=>{const t=r.canvas.getBoundingClientRect(),i=(e.clientX-t.left)/t.width*2-1,a=-((e.clientY-t.top)/t.height*2-1),d=i/h[0],z=a/h[1],b=performance.now(),C=Math.min((b-j)/1e3,.1)||.016;if(j=b,K=b,m[0]<90){const Z=(d-m[0])/C,ee=(z-m[1])/C,ne=Math.hypot(Z,ee),te=ne>5?5/ne:1;u=[u[0]*.6+Z*te*.4,u[1]*.6+ee*te*.4]}m=[d,z]}),r.canvas.addEventListener("pointerleave",()=>{m=[99,99],u=[0,0]});let p=null,R=[99,99],U=0,k=null;const J=(e,t)=>[(e*2-1)/h[0],(1-t*2)/h[1]],pe=e=>{if(U=0,!p?.running||p.hands.length===0){k=null;return}const t=p.hands[0],i=J(t.palm[0],t.palm[1]);if(k){const d=(i[0]-k[0])/Math.max(e,.001),z=(i[1]-k[1])/Math.max(e,.001),b=Math.hypot(d,z),C=b>5?5/b:1;u=[u[0]*.5+d*C*.5,u[1]*.5+z*C*.5],m=i}k=i,R=J(t.lm[8*3],t.lm[8*3+1]),U=1};o.mode==="sparks"&&(r.slider({label:"lights",min:16,max:w,step:16,value:c,log:!0,format:e=>Math.round(e).toLocaleString(),onInput:e=>c=Math.round(e)}),r.slider({label:"wind",min:0,max:1.5,step:.05,value:y,onInput:e=>y=e})),o.mode==="room"&&(r.button("bounce: on",function(){M=!M;const e=r.controls.querySelectorAll("button")[0];e.textContent=M?"bounce: on":"bounce: off"}),r.slider({label:"bounce strength",min:0,max:2.5,step:.05,value:x,onInput:e=>x=e})),o.mode==="dusk"&&r.slider({label:"time of day",min:0,max:1,step:.01,value:g,format:e=>e<.25?"night":e<.45?"late dusk":e<.62?"dusk":e<.85?"morning":"day",onInput:e=>g=e}),o.mode==="full"&&(r.slider({label:"embers",min:200,max:w,step:100,value:c,log:!0,format:e=>Math.round(e).toLocaleString(),onInput:e=>c=Math.round(e)}),r.slider({label:"wind",min:0,max:1.5,step:.05,value:y,onInput:e=>y=e}),r.slider({label:"bounce",min:0,max:2,step:.05,value:x,onInput:e=>x=e}),r.slider({label:"time of day",min:0,max:1,step:.01,value:g,onInput:e=>g=e}),r.button("view: final",function(){B=(B+1)%oe.length;const e=r.controls.querySelectorAll("button")[0];e.textContent=`view: ${oe[B]}`}),r.button("✋ hands",()=>{if(p?.running||p?.starting){p.stop();const e=r.controls.querySelectorAll("button")[1];e.textContent="✋ hands"}else p??=new Pe,p.start().then(()=>{const e=r.controls.querySelectorAll("button")[1];e.textContent="✋ tracking — wave at the fire"})})),r.setInfo(()=>o.mode==="sparks"?`${c.toLocaleString()} lights · one render cost · drag to stir`:o.mode==="room"?`1 light · ${l.cascadeCount} cascades · move the lamp with your cursor`:`${c.toLocaleString()} embers · ${l.cascadeCount} cascades · stir with your cursor`);const he=e=>{const t=new Float32Array(28);t.set([h[0],h[1],l.width,l.height]);const i=new Uint32Array(t.buffer);i[4]=c,t[5]=e,t[6]=q,t[7]=y,t.set([O?.55:0,O?.55:.25,.013,ie],8),t.set([m[0],m[1],u[0],u[1]],12),t.set([.28,4,M?x:0,Math.max(0,1-g*2.2)],16),t.set([R[0],R[1],U,ae],20),t.set([l.fluence.probes[0],l.fluence.probes[1],v,1],24),n.queue.writeBuffer(P,0,t),t.set([h[0],h[1],T,D]),t[27]=.7,n.queue.writeBuffer(I,0,t)},Q=()=>{if(v!==0){l.setSky({zenith:[0,0,0],horizon:[0,0,0],strength:0});return}const e=Ce(g);l.setSky({zenith:e.zenith,horizon:e.horizon,sunDir:e.sunDir,sunIntensity:e.sunIntensity,sunSharpness:e.sunSharpness,sunColor:e.sunColor,strength:1})};return Q(),{frame(){r.tick();const e=performance.now(),t=Math.min((e-V)/1e3,1/30);V=e,q+=t,pe(t),v===2&&e-K>2500&&(m=[.55*Math.sin(q*.4),.5*Math.sin(q*.27+1.3)],u=[0,0]),he(t),Q();const i=n.createCommandEncoder();if(c>0){const d=i.beginComputePass();d.setPipeline(X),d.setBindGroup(0,le),d.dispatchWorkgroups(Math.ceil(c/256)),d.end()}let a=i.beginRenderPass({colorAttachments:[{view:l.sceneView,clearValue:{r:0,g:0,b:0,a:0},loadOp:"clear",storeOp:"store"}]});a.setPipeline(H),a.setBindGroup(0,ue),a.draw(3),a.end(),c>0&&(a=i.beginRenderPass({colorAttachments:[{view:l.sceneView,loadOp:"load",storeOp:"store"}]}),a.setPipeline(F),a.setBindGroup(0,ce),a.draw(6,c),a.end()),l.encodeGI(i),B>0?l.encodeComposite(i,Y.getCurrentTexture().createView(),{exposure:1.5,debugMode:B,emitBoost:.7}):(a=i.beginRenderPass({colorAttachments:[{view:E,clearValue:{r:0,g:0,b:0,a:1},loadOp:"clear",storeOp:"store"}]}),a.setPipeline($),a.setBindGroup(0,fe),a.draw(3),a.end(),c>0&&(a=i.beginRenderPass({colorAttachments:[{view:E,loadOp:"load",storeOp:"store"}]}),a.setPipeline(F),a.setBindGroup(0,de),a.draw(6,c),a.end()),a=i.beginRenderPass({colorAttachments:[{view:Y.getCurrentTexture().createView(),clearValue:{r:0,g:0,b:0,a:1},loadOp:"clear",storeOp:"store"}]}),a.setPipeline(W),a.setBindGroup(0,me),a.draw(3),a.end()),n.queue.submit([i.finish()])},dispose(){p?.stop(),l.dispose(),S.destroy(),P.destroy(),I.destroy(),N.destroy()}}}ve();const Ge={"hero-fire":s=>G(s,{mode:"hero"}),sparks:s=>G(s,{mode:"sparks"}),room:s=>G(s,{mode:"room"}),dusk:s=>G(s,{mode:"dusk"}),fire:s=>G(s,{mode:"full"})};for(const s of document.querySelectorAll("[data-demo]")){const o=s.dataset.demo,n=Ge[o];n&&we(s,()=>n(s))}
