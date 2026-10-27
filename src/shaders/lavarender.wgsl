// Lava rendering: particles become a continuous emissive surface, the
// radiance cascades light it, and a display pass draws it at full canvas
// resolution.
//
// 1. vsSplat/fsSplat — every particle splats a smooth radial kernel into a
//    low-res field texture, accumulating (weight, weight·temperature) with
//    additive blending. Classic metaballs: the sum is a scalar field.
// 2. vsFull/fsScene — thresholds that field into wax (occupancy ~ alpha) and
//    shades it by its local mean temperature: cold wax is nearly black and
//    only blocks light, hot wax *is* a light. The same pass paints the lamp
//    furniture (coil, base, cap, table) into the scene so the radiance
//    cascades see them as emitters and occluders like anything else.
// 3. fsDisplay — the picture you see. The cascades run at a fraction of the
//    canvas resolution, so instead of upscaling their scene this pass
//    re-thresholds the (smooth) field per canvas pixel for crisp edges, then
//    shades everything with the transported light: air shows the light
//    field, wax is translucent and lit from outside its own surface, metal
//    and the tabletop catch the glow. Output is linear HDR for PostFX.
// 4. vsDots/fsDots — teaching view: raw particles coloured by temperature,
//    straight to the canvas, no field, no light transport.

struct RenderParams {
  viewScale: vec2f,  // world [-1,1] → clip multiplier (x already aspect-divided)
  res: vec2f,        // scene texture resolution in pixels
  splatRadius: f32,  // kernel support, world units
  threshold: f32,    // field value where wax begins
  time: f32,
  glow: f32,         // emission intensity multiplier
  wallBottom: f32,
  wallTop: f32,
  floorY: f32,
  topY: f32,
  heaterY: f32,
  dotSize: f32,
  lampOn: f32,       // 1: draw coil/base/cap furniture into the scene
  viewY: f32,        // world y at the centre of the canvas
}

struct Particle2 {
  pv: vec4f,
  aux: vec4f,
}

@group(0) @binding(0) var<uniform> RP: RenderParams;
@group(0) @binding(1) var<storage, read> parts: array<Particle2>;

// ---- wax palette ------------------------------------------------------------
// Cold wax: deep maroon, almost black. Warm: crimson → orange → amber-white.
fn waxColor(t: f32) -> vec3f {
  let c0 = vec3f(0.05, 0.005, 0.012); // cold, nearly black plum
  let c1 = vec3f(0.6, 0.05, 0.03);    // crimson
  let c2 = vec3f(1.0, 0.36, 0.05);    // orange
  let c3 = vec3f(1.0, 0.82, 0.42);    // amber-white
  let a = smoothstep(0.05, 0.35, t);
  let b = smoothstep(0.30, 0.65, t);
  let c = smoothstep(0.60, 0.98, t);
  return mix(mix(mix(c0, c1, a), c2, b), c3, c);
}

// How much the wax emits, as a function of temperature: cold wax is an
// occluder with a whisper of colour; wax warm enough to rise glows.
fn waxLuminance(t: f32) -> f32 {
  let g = smoothstep(0.1, 0.85, t);
  return 0.02 + g * g * 2.2;
}

// ---- lamp geometry, shared by the scene and display passes -------------------

fn vesselHalfWidth(y: f32) -> f32 {
  let t = clamp((y - RP.floorY) / (RP.topY - RP.floorY), 0.0, 1.0);
  return mix(RP.wallBottom, RP.wallTop, t);
}

const COIL_TOP_OFF: f32 = 0.012;
const COIL_BOT_OFF: f32 = 0.05;
const TABLE_Y: f32 = -0.86;
const CAP_H: f32 = 0.17;

fn coilBot() -> f32 { return RP.floorY - COIL_BOT_OFF; }

// Signed distance (world units, negative inside) to the metal base: a
// truncated cone that widens toward the table, the classic lamp silhouette.
fn baseDist(w: vec2f) -> f32 {
  let top = coilBot();
  let t = clamp((top - w.y) / max(top - TABLE_Y, 1e-3), 0.0, 1.0);
  let hw = mix(RP.wallBottom * 1.04, RP.wallBottom * 1.42, t);
  let dx = abs(w.x) - hw;
  let dy = max(w.y - top, TABLE_Y - w.y);
  return max(dx, dy);
}

// The cap: a short cone narrowing upward from the throat.
fn capDist(w: vec2f) -> f32 {
  let t = clamp((w.y - RP.topY) / CAP_H, 0.0, 1.0);
  let hw = mix(RP.wallTop * 1.12, RP.wallTop * 0.42, t);
  let dx = abs(w.x) - hw;
  let dy = max(RP.topY - w.y, w.y - (RP.topY + CAP_H));
  return max(dx, dy);
}

// ---- 1. kernel splat ---------------------------------------------------------

struct SplatOut {
  @builtin(position) pos: vec4f,
  @location(0) local: vec2f,
  @location(1) temp: f32,
}

@vertex
fn vsSplat(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> SplatOut {
  var corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
  );
  let p = parts[ii];
  let corner = corners[vi];
  let world = p.pv.xy + corner * RP.splatRadius;
  var out: SplatOut;
  out.pos = vec4f((world - vec2f(0.0, RP.viewY)) * RP.viewScale, 0.0, 1.0);
  out.local = corner;
  out.temp = p.aux.x;
  return out;
}

@fragment
fn fsSplat(in: SplatOut) -> @location(0) vec4f {
  let q2 = dot(in.local, in.local);
  if (q2 > 1.0) { discard; }
  let w = (1.0 - q2) * (1.0 - q2); // smooth poly kernel
  return vec4f(w, w * in.temp, 0.0, 0.0);
}

// ---- fullscreen triangle ------------------------------------------------------

struct FullOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn vsFull(@builtin(vertex_index) vi: u32) -> FullOut {
  var pts = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var out: FullOut;
  out.pos = vec4f(pts[vi], 0.0, 1.0);
  out.uv = pts[vi] * vec2f(0.5, -0.5) + 0.5;
  return out;
}

fn uvToWorld(uv: vec2f) -> vec2f {
  let clip = vec2f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
  return clip / RP.viewScale + vec2f(0.0, RP.viewY);
}

fn worldToUv(w: vec2f) -> vec2f {
  let c = (w - vec2f(0.0, RP.viewY)) * RP.viewScale;
  return vec2f(c.x * 0.5 + 0.5, 0.5 - c.y * 0.5);
}

// ---- 2. field → scene (emission rgb, occlusion a) -----------------------------

@group(0) @binding(2) var fieldTex: texture_2d<f32>;
@group(0) @binding(3) var linSamp: sampler;

// Wax coverage from the field, trimmed to the inside of the glass.
fn waxCover(f: f32, world: vec2f, aaw: f32) -> f32 {
  var cover = smoothstep(RP.threshold - aaw, RP.threshold + aaw, f);
  if (RP.lampOn > 0.5) {
    // the splat kernel reaches past particle centres; trim the wax surface
    // at the glass so blobs press against it instead of bulging through
    let hw0 = vesselHalfWidth(world.y);
    cover *= 1.0 - smoothstep(hw0 - 0.004, hw0 + 0.006, abs(world.x));
    cover *= 1.0 - smoothstep(RP.topY - 0.004, RP.topY + 0.012, world.y);
    // and never below the floor of the vessel
    cover *= smoothstep(RP.floorY - 0.03, RP.floorY - 0.012, world.y);
  }
  return cover;
}

fn coilEmission(world: vec2f) -> vec3f {
  let top = RP.floorY + COIL_TOP_OFF;
  let bot = coilBot();
  if (world.y > top || world.y < bot || abs(world.x) > RP.wallBottom * 0.96) { return vec3f(0.0); }
  let bump = 0.55 + 0.45 * cos(world.x * 80.0);
  let flicker = 0.94 + 0.06 * sin(RP.time * 3.0 + world.x * 13.0);
  let edge = smoothstep(bot, bot + 0.016, world.y) * (1.0 - smoothstep(top - 0.016, top, world.y));
  let ends = 1.0 - smoothstep(RP.wallBottom * 0.86, RP.wallBottom * 0.96, abs(world.x));
  return vec3f(1.0, 0.42, 0.08) * 3.2 * bump * flicker * edge * ends * RP.glow;
}

@fragment
fn fsScene(in: FullOut) -> @location(0) vec4f {
  let world = uvToWorld(in.uv);
  let f = textureSampleLevel(fieldTex, linSamp, in.uv, 0.0);
  let cover = waxCover(f.x, world, 0.08);
  let t = f.y / max(f.x, 1e-4); // field-weighted mean temperature
  var emission = waxColor(t) * waxLuminance(t) * RP.glow * cover;
  var occ = cover;

  if (RP.lampOn > 0.5) {
    let coil = coilEmission(world);
    if (dot(coil, coil) > 0.0) {
      emission += coil;
      occ = max(occ, 0.9);
    }
    // metal base, cap and the table: dark occluders
    let solid = min(min(baseDist(world), capDist(world)), world.y - TABLE_Y);
    if (solid < 0.0) {
      emission = vec3f(0.0);
      occ = 1.0;
    }
  }
  return vec4f(emission, occ);
}

// ---- 3. display: full-resolution shading over the transported light -----------

struct DisplayParams {
  probes0: vec2f,   // cascade-0 probe grid (for fluence lookups)
  canvas: vec2f,    // canvas px
  exposure: f32,
  backdrop: f32,    // how much the wall behind the lamp reflects
  _p0: f32,
  _p1: f32,
}
@group(0) @binding(5) var fluenceTex: texture_2d<f32>;
@group(0) @binding(6) var<uniform> DP: DisplayParams;

// Light arriving at a point, from last frame's cascade 0: four direction
// blocks, hardware bilinear each, averaged.
fn fluenceAt(uv: vec2f) -> vec3f {
  let texFull = vec2f(textureDimensions(fluenceTex));
  let local = clamp(uv, vec2f(0.5) / DP.probes0, 1.0 - vec2f(0.5) / DP.probes0);
  var sum = vec3f(0.0);
  for (var d = 0u; d < 4u; d++) {
    let cb = vec2f(f32(d % 2u), f32(d / 2u));
    let tuv = (cb + local) * DP.probes0 / texFull;
    sum += textureSampleLevel(fluenceTex, linSamp, tuv, 0.0).rgb;
  }
  return sum * 0.25;
}

fn hash12(p: vec2f) -> f32 {
  var q = fract(p * vec2f(123.34, 456.21));
  q += dot(q, q + 45.32);
  return fract(q.x * q.y);
}

@fragment
fn fsDisplay(in: FullOut) -> @location(0) vec4f {
  let world = uvToWorld(in.uv);
  let px = 2.0 / (RP.viewScale.y * DP.canvas.y); // one canvas pixel, world units
  let fres = vec2f(textureDimensions(fieldTex));

  // the field, its gradient (field texels) and an anti-aliased edge
  let f = textureSampleLevel(fieldTex, linSamp, in.uv, 0.0);
  let e = 1.0 / fres;
  let fx = textureSampleLevel(fieldTex, linSamp, in.uv + vec2f(e.x, 0.0), 0.0).x -
           textureSampleLevel(fieldTex, linSamp, in.uv - vec2f(e.x, 0.0), 0.0).x;
  let fy = textureSampleLevel(fieldTex, linSamp, in.uv + vec2f(0.0, e.y), 0.0).x -
           textureSampleLevel(fieldTex, linSamp, in.uv - vec2f(0.0, e.y), 0.0).x;
  let grad = vec2f(fx, fy) * 0.5;            // per field texel, uv-space axes
  let gl = max(length(grad), 1e-4);
  let texPerPx = fres.y / DP.canvas.y;       // field texels per canvas pixel
  let aaw = max(gl * texPerPx * 0.9, 0.004);
  var cover = waxCover(f.x, world, aaw);
  // pinholes: where the field dips just under the threshold inside a blob,
  // the gap would show the light trapped inside it as a bright speck. If
  // the field a few texels around is solidly wax, treat the pinhole as wax.
  let r3 = 3.0 * e;
  let around = (textureSampleLevel(fieldTex, linSamp, in.uv + vec2f(r3.x, r3.y), 0.0).x +
                textureSampleLevel(fieldTex, linSamp, in.uv + vec2f(-r3.x, r3.y), 0.0).x +
                textureSampleLevel(fieldTex, linSamp, in.uv + vec2f(r3.x, -r3.y), 0.0).x +
                textureSampleLevel(fieldTex, linSamp, in.uv + vec2f(-r3.x, -r3.y), 0.0).x) * 0.25;
  let pinhole = smoothstep(RP.threshold, RP.threshold * 1.4, around) *
                smoothstep(RP.threshold * 0.35, RP.threshold * 0.8, f.x);
  cover = max(cover, pinhole * waxCover(RP.threshold * 2.0, world, aaw));
  // and specks: a few stray particles make islands too small to read as wax
  cover *= smoothstep(RP.threshold * 0.45, RP.threshold * 0.85, around);

  let hw = vesselHalfWidth(world.y);
  let inVessel = abs(world.x) < hw && world.y > RP.floorY - 0.02 && world.y < RP.topY;

  // ---- air: the light field itself, on a dark wall (or in the lamp's water)
  let here = fluenceAt(in.uv);
  var col = here * DP.backdrop;
  if (inVessel) {
    // the water is faintly warm and catches more light than the wall
    col = here * vec3f(0.55, 0.42, 0.36) + vec3f(0.006, 0.002, 0.002);
  }

  // ---- wax: translucent, lit from outside its own surface
  if (cover > 0.0) {
    let t = f.y / max(f.x, 1e-4);
    let emit = waxColor(t) * waxLuminance(t) * RP.glow;
    let nOut = -grad / gl;                         // uv-space, pointing out of the blob
    let depth = max(max(f.x, around * pinhole) - RP.threshold, 0.0) / gl; // texels below the surface
    let outUv = in.uv + nOut * (depth + 3.0) * e;
    let incident = fluenceAt(outUv);
    let albedo = vec3f(0.9, 0.2, 0.1);
    let sss = exp(-depth / 16.0);                  // light soaks some way in
    let body = vec3f(0.035, 0.004, 0.006);         // cold wax is never quite black
    // a bright rim where the surface faces the light, like the edge of a
    // backlit gummy sweet
    let rim = exp(-depth / 2.5);
    let wax = emit * 1.1 + albedo * incident * (0.15 + 0.85 * sss + 0.8 * rim) + body;
    col = mix(col, wax, cover);
  }

  if (RP.lampOn > 0.5) {
    // the coil
    col += coilEmission(world);

    // glass: a thin cool edge that brightens where light falls on it, plus
    // a soft reflected streak down one side
    let wallD = abs(abs(world.x) - hw);
    let inSpan = step(RP.floorY - 0.05, world.y) * step(world.y, RP.topY);
    let edge = (1.0 - smoothstep(0.0, max(px * 1.6, 0.003), wallD)) * inSpan;
    col += (vec3f(0.05, 0.06, 0.08) + here * 0.9) * edge;
    let streakX = -hw * 0.72;
    let streak = exp(-pow((world.x - streakX) / (hw * 0.07), 2.0)) * inSpan *
      smoothstep(RP.floorY, RP.floorY + 0.25, world.y) * (1.0 - smoothstep(RP.topY - 0.2, RP.topY, world.y));
    col += (here * 0.18 + vec3f(0.006, 0.007, 0.01)) * streak;

    // metal base: lit from above by the coil, falling off down the cone,
    // with a cylindrical sheen across it and a bright lip under the coil
    let bd = baseDist(world);
    if (bd < px) {
      let a = smoothstep(px, -px, bd);
      let coilAvg = vec3f(1.0, 0.42, 0.08) * 3.2 * 0.55 * RP.glow;
      let side = fluenceAt(worldToUv(vec2f(sign(world.x) * RP.wallBottom * 1.6, world.y)));
      let fromTop = coilBot() - world.y;
      let down = exp(-fromTop * 7.0);
      let across = world.x / max(RP.wallBottom * 1.42, 1e-3);
      let sheen = 0.25 + 0.75 * pow(max(1.0 - abs(across + 0.3), 0.0), 3.0);
      let lip = exp(-fromTop * 90.0);
      var metal = vec3f(0.008, 0.007, 0.008) + coilAvg * vec3f(0.035, 0.028, 0.025) * down * sheen;
      metal += coilAvg * 0.18 * lip + side * 0.06 * sheen;
      col = mix(col, metal, a);
    }
    // cap: lit from below by the top of the lamp
    let cd = capDist(world);
    if (cd < px) {
      let a = smoothstep(px, -px, cd);
      let lightBot = fluenceAt(worldToUv(vec2f(world.x * 0.8, RP.topY - 0.03)));
      let up = exp(-(world.y - RP.topY) * 12.0);
      let across = world.x / max(RP.wallTop * 1.12, 1e-3);
      let sheen = 0.3 + 0.7 * pow(max(1.0 - abs(across + 0.3), 0.0), 3.0);
      let metal = vec3f(0.010, 0.009, 0.010) + lightBot * vec3f(0.5, 0.42, 0.38) * up * sheen +
        lightBot * 0.6 * exp(-(world.y - RP.topY) * 120.0);
      col = mix(col, metal, a);
    }
    // the tabletop: catches the glow along its edge, dark below
    let td = world.y - TABLE_Y;
    if (td < px) {
      let a = smoothstep(px, -px, td);
      let lightAbove = fluenceAt(worldToUv(vec2f(world.x, TABLE_Y + 0.03)));
      let fall = exp(td * 22.0);
      let wood = vec3f(0.010, 0.007, 0.006) + lightAbove * vec3f(0.42, 0.30, 0.22) * fall;
      col = mix(col, wood, a);
    }
  }

  // a little film grain keeps the dark gradients from banding
  col += (hash12(in.pos.xy + RP.time * 61.0) - 0.5) * 0.002;
  return vec4f(max(col, vec3f(0.0)) * DP.exposure, 1.0);
}

// ---- 4. raw particle dots (temperature demo) ----------------------------------

struct DotOut {
  @builtin(position) pos: vec4f,
  @location(0) local: vec2f,
  @location(1) temp: f32,
}

@vertex
fn vsDots(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> DotOut {
  var corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
  );
  let p = parts[ii];
  let corner = corners[vi];
  let world = p.pv.xy + corner * RP.dotSize;
  var out: DotOut;
  out.pos = vec4f((world - vec2f(0.0, RP.viewY)) * RP.viewScale, 0.0, 1.0);
  out.local = corner;
  out.temp = p.aux.x;
  return out;
}

// Temperature ramp for reading, not for looks: deep violet (cold) through
// magenta and red to orange and pale yellow (hot). Matches heatRgb() in
// palette.ts, so the legend drawn on the canvas agrees with the dots.
fn heatRamp(t: f32) -> vec3f {
  let x = clamp(t, 0.0, 1.0) * 4.0;
  let s0 = vec3f(22.0, 14.0, 52.0) / 255.0;
  let s1 = vec3f(96.0, 28.0, 110.0) / 255.0;
  let s2 = vec3f(196.0, 58.0, 82.0) / 255.0;
  let s3 = vec3f(246.0, 128.0, 44.0) / 255.0;
  let s4 = vec3f(252.0, 226.0, 120.0) / 255.0;
  if (x < 1.0) { return mix(s0, s1, x); }
  if (x < 2.0) { return mix(s1, s2, x - 1.0); }
  if (x < 3.0) { return mix(s2, s3, x - 2.0); }
  return mix(s3, s4, x - 3.0);
}

@fragment
fn fsDots(in: DotOut) -> @location(0) vec4f {
  let q2 = dot(in.local, in.local);
  if (q2 > 1.0) { discard; }
  let a = smoothstep(1.0, 0.55, q2);
  // lift the coldest end a touch so cold wax still reads against the
  // background (the canvas is sRGB; these are display colours)
  let col = heatRamp(in.temp) * 1.25 + vec3f(0.04, 0.03, 0.07);
  return vec4f(col * a, a);
}
