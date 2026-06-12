// Lava rendering, stage one: particles become a continuous emissive surface.
//
// 1. vsSplat/fsSplat — every particle splats a smooth radial kernel into a
//    low-res field texture, accumulating (weight, weight·temperature) with
//    additive blending. Classic metaballs: the sum is a scalar field.
// 2. vsFull/fsScene — thresholds that field into wax (occupancy ~ alpha) and
//    shades it by its local mean temperature: cold wax is nearly black and
//    merely blocks light, hot wax *is* a light. The same pass paints the
//    lamp furniture — coil, base, cap — directly into the scene so the
//    radiance cascades see them as emitters and occluders like any other.
// 3. vsDots/fsDots — debug/teaching view: raw particles coloured by
//    temperature, straight to the canvas, no field, no light transport.

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
  _pad: f32,
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
  let c1 = vec3f(0.55, 0.04, 0.03);   // crimson
  let c2 = vec3f(1.0, 0.36, 0.05);    // orange
  let c3 = vec3f(1.0, 0.85, 0.45);    // amber-white
  let a = smoothstep(0.05, 0.45, t);
  let b = smoothstep(0.40, 0.75, t);
  let c = smoothstep(0.70, 1.05, t);
  return mix(mix(mix(c0, c1, a), c2, b), c3, c);
}

// How much the wax emits, as a function of temperature: cold wax is an
// occluder with a whisper of colour; hot wax glows hard.
fn waxLuminance(t: f32) -> f32 {
  let g = smoothstep(0.14, 0.95, t);
  return 0.02 + g * g * 1.9;
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
  out.pos = vec4f(world * RP.viewScale, 0.0, 1.0);
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

// ---- 2. field → scene (emission rgb, occlusion a) -----------------------------

@group(0) @binding(2) var fieldTex: texture_2d<f32>;
@group(0) @binding(3) var linSamp: sampler;

fn vesselHalfWidth(y: f32) -> f32 {
  let t = clamp((y - RP.floorY) / (RP.topY - RP.floorY), 0.0, 1.0);
  return mix(RP.wallBottom, RP.wallTop, t);
}

@fragment
fn fsScene(in: FullOut) -> @location(0) vec4f {
  // uv → clip → world (the splat's mapping, inverted)
  let clip = vec2f(in.uv.x * 2.0 - 1.0, 1.0 - in.uv.y * 2.0);
  let world = clip / RP.viewScale;

  let f = textureSampleLevel(fieldTex, linSamp, in.uv, 0.0);
  var cover = smoothstep(RP.threshold - 0.09, RP.threshold + 0.07, f.x);
  if (RP.lampOn > 0.5) {
    // the splat kernel reaches past particle centres; trim the wax surface
    // at the glass so blobs press against it instead of bulging through
    let hw0 = vesselHalfWidth(world.y);
    cover *= 1.0 - smoothstep(hw0 - 0.002, hw0 + 0.012, abs(world.x));
    cover *= 1.0 - smoothstep(RP.topY + 0.004, RP.topY + 0.024, world.y);
    // and never below the base: the pool ends where the coil begins
    cover *= smoothstep(RP.floorY - 0.055, RP.floorY - 0.035, world.y);
  }
  let t = f.y / max(f.x, 1e-4); // field-weighted mean temperature
  var emission = waxColor(t) * waxLuminance(t) * RP.glow * cover;
  var occ = cover;

  if (RP.lampOn > 0.5) {
    let hw = vesselHalfWidth(world.y);
    let inVessel = step(abs(world.x), hw + 0.02);

    // the coil: a row of glowing bumps tucked against the floor of the wax
    let coilTop = RP.floorY + 0.012;
    let coilBot = RP.floorY - 0.05;
    if (world.y < coilTop && world.y > coilBot && abs(world.x) < RP.wallBottom * 0.92) {
      let bump = 0.6 + 0.4 * cos(world.x * 80.0);
      let flicker = 0.92 + 0.08 * sin(RP.time * 5.0 + world.x * 13.0);
      let edge = smoothstep(coilBot, coilBot + 0.02, world.y) *
                 (1.0 - smoothstep(coilTop - 0.02, coilTop, world.y));
      emission += vec3f(1.0, 0.42, 0.08) * 3.2 * bump * flicker * edge * RP.glow;
      occ = max(occ, edge * 0.9);
    }

    // metal base: a dark occluding trapezoid below the coil
    if (world.y < coilBot) {
      let baseHw = mix(RP.wallBottom * 1.25, RP.wallBottom * 0.85, clamp((coilBot - world.y) * 2.2, 0.0, 1.0));
      if (abs(world.x) < baseHw) {
        emission = vec3f(0.012, 0.008, 0.006);
        occ = 1.0;
      }
    }

    // cap: small dark cone above the throat
    if (world.y > RP.topY) {
      let capHw = mix(RP.wallTop * 1.1, RP.wallTop * 0.35, clamp((world.y - RP.topY) * 4.0, 0.0, 1.0));
      if (abs(world.x) < capHw && world.y < RP.topY + 0.18) {
        emission = vec3f(0.012, 0.008, 0.006);
        occ = 1.0;
      }
    }

    // glass: a faint cool sliver along the tapered walls — emissive only,
    // so it reads as a highlight but never blocks the glow
    let wallD = abs(abs(world.x) - hw);
    let glass = (1.0 - smoothstep(0.0, 0.012, wallD)) * inVessel *
                step(RP.floorY - 0.05, world.y) * step(world.y, RP.topY);
    emission += vec3f(0.10, 0.13, 0.18) * 0.4 * glass;
  }

  return vec4f(emission, occ);
}

// ---- 3. raw particle dots (temperature demo) ----------------------------------

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
  out.pos = vec4f(world * RP.viewScale, 0.0, 1.0);
  out.local = corner;
  out.temp = p.aux.x;
  return out;
}

@fragment
fn fsDots(in: DotOut) -> @location(0) vec4f {
  let q2 = dot(in.local, in.local);
  if (q2 > 1.0) { discard; }
  let a = (1.0 - q2);
  // brighter palette than the lamp itself: this view is for *reading*
  // temperature, so even cold particles stay visible
  let col = waxColor(in.temp) * (0.35 + waxLuminance(in.temp)) + vec3f(0.03, 0.02, 0.05);
  return vec4f(col * a, a);
}
