// The bonfire, native. Radiance cascades 2D GI ported from the WebGPU blog
// demo to Metal, plus what the browser couldn't afford or couldn't reach:
// EDR output (fire brighter than white), bloom, heat shimmer, a lit smoke
// column, a moon, and a lot more embers.
//
// Pipeline per frame:
//   emberSim (compute)
//   fsScene  → sceneTex (emission rgb, occlusion a; reads last frame's
//              cascade 0 for the one-frame-late multi-bounce)
//   fsEmber  → sceneTex, additive
//   fsSeed → fsJfa ×N → fsDist        (jump flood → distance field)
//   fsCascade, top-down               (sphere-march intervals, merge, sky at top)
//   fsResolve → HDR linear            (fluence + emission + smoke veil)
//   fsBright → MPS blur → bloom
//   fsFinal → drawable                (shimmer, bloom, EDR tonemap, vignette, grain)

#include <metal_stdlib>
using namespace metal;

// ============================ shared types ==================================
// Field order must match the Swift mirror structs exactly.

struct Uniforms {
  float2 viewScale;   // world → clip
  float2 res;         // scene texture px
  float2 stir;        // cursor, world
  float2 stirVel;
  float2 emit2;       // held-click emitter, world
  float2 probes0;     // cascade-0 probe grid
  float4 zenith;      // sky rgb overhead
  float4 horizon;     // sky rgb at horizon
  float4 sun;         // xy dir (scene space, y down) · z sharpness · w intensity
  float4 sunColor;    // rgb · w sky strength
  uint  count;
  float dt;
  float time;
  float wind;
  float buoyancy;
  float drag;
  float emberSize;    // world units
  float fireScale;
  float stirRadius;
  float stirStrength;
  float bounce;       // albedo × fluence feedback
  float night;        // 0 day … 1 night
  float emit2On;
  float glow;
  float worldHalfX;   // aspect-dependent kill bound for embers
  float pad0;
};

struct CascadeParams {
  float2 probes;
  float2 upperProbes;
  float blocks;        // directions per texture axis (2^(n+1))
  float upperBlocks;
  float intervalStart; // scene px
  float intervalLen;
  float isTop;
  float steps;
  float pad0;
  float pad1;
};

struct PostParams {
  float exposure;
  float emitBoost;
  float debugMode;   // 0 final · 1 scene · 2 occupancy · 3 distance · 4 light only
  float edrMax;      // display EDR headroom; 1 = SDR
  float bloom;
  float grain;
  float vignette;
  float shimmer;
  float smoke;
  float nightAir;  // distance absorption of the GI wash in empty pixels
  float pad1;
  float pad2;
};

struct Ember {
  float4 pv;   // pos.xy vel.zw
  float4 aux;  // life, maxLife, heat, seed
};

struct FullOut {
  float4 pos [[position]];
  float2 uv;
};

vertex FullOut vsFull(uint vid [[vertex_id]]) {
  float2 pts[3] = { float2(-1.0, -1.0), float2(3.0, -1.0), float2(-1.0, 3.0) };
  FullOut o;
  o.pos = float4(pts[vid], 0.0, 1.0);
  o.uv = pts[vid] * float2(0.5, -0.5) + 0.5;
  return o;
}

// ============================== noise =======================================

static float hash21(float2 p) {
  float2 q = fract(p * float2(123.34, 456.21));
  q += dot(q, q + 45.32);
  return fract(q.x * q.y);
}

static float vnoise(float2 p) {
  float2 i = floor(p);
  float2 f = fract(p);
  float2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + float2(1.0, 0.0));
  float c = hash21(i + float2(0.0, 1.0));
  float d = hash21(i + float2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// the flame was tuned on two octaves; wind and smoke get a third
static float fbm(float2 p) {
  return vnoise(p) * 0.65 + vnoise(p * 2.13 + 7.7) * 0.35;
}

static float fbm3(float2 p) {
  return vnoise(p) * 0.55 + vnoise(p * 2.13 + 7.7) * 0.3 + vnoise(p * 4.31 + 19.1) * 0.15;
}

// rotate the gradient of smooth noise a quarter turn: divergence-free wind
static float2 curlNoise(float2 p, float time) {
  const float e = 0.04;
  float2 q = p * 2.1 + float2(time * 0.07, -time * 0.045);
  float dx = fbm3(q + float2(e, 0.0)) - fbm3(q - float2(e, 0.0));
  float dy = fbm3(q + float2(0.0, e)) - fbm3(q - float2(0.0, e));
  return float2(dy, -dx) / (2.0 * e);
}

// ============================ world geometry ================================

static float groundY(float x) {
  // lower than the blog's -0.55: fullscreen wants sky, not soil cross-section
  return -0.68 + 0.08 * sin(x * 2.3 + 1.7) + 0.04 * sin(x * 5.1 + 0.6);
}

static float sdCapsule(float2 p, float2 a, float2 b, float r) {
  float2 pa = p - a;
  float2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - r;
}

static float treeDist(float2 world, float baseX, float h, float seed) {
  float gy = groundY(baseX);
  float2 top = float2(baseX + 0.03 * sin(seed * 9.0), gy + h);
  float d = sdCapsule(world, float2(baseX, gy - 0.05), top, 0.020 + 0.012 * h);
  // tiered conifer canopy: three lumpy ellipses narrowing upward —
  // the blog's single lollipop disk reads flat at fullscreen
  for (int k = 0; k < 3; k++) {
    float fk = float(k);
    float2 c = world - (top + float2(0.0, h * (-0.30 + 0.18 * fk)));
    float r = h * (0.30 - 0.075 * fk);
    float lump = 1.0 + 0.35 * (vnoise(world * 9.0 + seed * 13.0 + fk * 4.7) - 0.5);
    d = min(d, length(c * float2(1.0, 1.9)) - r * lump);
  }
  d = min(d, sdCapsule(world, top - float2(0.0, h * 0.55), top + float2(0.15, -h * 0.32), 0.012));
  d = min(d, sdCapsule(world, top - float2(0.0, h * 0.42), top + float2(-0.14, -h * 0.22), 0.012));
  return d;
}

// ============================ ember simulation ==============================

kernel void emberSim(uint i [[thread_position_in_grid]],
                     constant Uniforms& U [[buffer(0)]],
                     device Ember* embers [[buffer(1)]]) {
  if (i >= U.count) { return; }
  Ember e = embers[i];
  float seed = e.aux.w;

  float life = e.aux.x - U.dt;
  float2 pos = e.pv.xy;
  float2 vel = e.pv.zw;
  float heat = e.aux.z;

  if (life <= 0.0) {
    // respawn at the flame (or at the held cursor, when offered)
    float r1 = hash21(float2(seed, U.time));
    float r2 = hash21(float2(U.time * 1.7, seed + 4.2));
    float r3 = hash21(float2(seed * 3.1, U.time * 0.9));
    float2 origin = float2(0.0, groundY(0.0) + 0.06);
    float spreadX = 0.09 * U.fireScale;
    if (U.emit2On > 0.5 && r3 < 0.45) {
      origin = U.emit2;
      spreadX = 0.03;
    }
    pos = origin + float2((r1 - 0.5) * 2.0 * spreadX, r2 * 0.08);
    vel = float2((r1 - 0.5) * 0.18, 0.10 + r2 * 0.16);
    // most embers die young; the rare one rides the heat far up
    life = 0.5 + r1 * r2 * 1.8;
    heat = 0.8 + r2 * 0.35;
    embers[i] = Ember{ float4(pos, vel), float4(life, life, heat, seed) };
    return;
  }

  // wind, lift, drag
  float2 acc = curlNoise(pos, U.time) * U.wind;
  acc += float2(0.0, U.buoyancy * heat);
  // entrainment: the rising plume pulls nearby air inward
  acc.x -= pos.x * 1.1;

  // stirring: the cursor drags nearby air
  float2 md = pos - U.stir;
  float mr = length(md);
  if (mr < U.stirRadius) {
    acc += U.stirVel * U.stirStrength * (1.0 - mr / U.stirRadius);
  }

  vel = (vel + acc * U.dt) * (1.0 - U.drag * U.dt);
  pos += vel * U.dt;
  heat *= exp(-0.7 * U.dt);

  if (pos.y < groundY(pos.x) + 0.01) { life = 0.0; }
  if (abs(pos.x) > U.worldHalfX || pos.y > 1.1) { life = 0.0; }

  embers[i] = Ember{ float4(pos, vel), float4(life, e.aux.y, heat, seed) };
}

// ============================== ember splat =================================

static float3 emberColor(float heat) {
  float a = smoothstep(0.15, 0.55, heat);
  float b = smoothstep(0.5, 0.95, heat);
  float3 cold = float3(0.45, 0.05, 0.012);
  float3 mid = float3(1.0, 0.32, 0.05);
  float3 hot = float3(1.0, 0.68, 0.3);
  return mix(mix(cold, mid, a), hot, b) * (0.08 + 1.5 * heat * heat);
}

struct EmberOut {
  float4 pos [[position]];
  float2 local;
  uint idx [[flat]];
};

vertex EmberOut vsEmber(uint vid [[vertex_id]],
                        uint ii [[instance_id]],
                        constant Uniforms& U [[buffer(0)]],
                        const device Ember* embers [[buffer(1)]]) {
  float2 corners[6] = {
    float2(-1.0, -1.0), float2(1.0, -1.0), float2(-1.0, 1.0),
    float2(-1.0, 1.0), float2(1.0, -1.0), float2(1.0, 1.0),
  };
  Ember e = embers[ii];
  float alive = e.aux.x <= 0.0 ? 0.0 : 1.0;
  // embers shrink as they die instead of popping out
  float fade = 0.35 + 0.65 * smoothstep(0.0, 0.35, clamp(e.aux.x / max(e.aux.y, 1e-3), 0.0, 1.0));
  float jitter = 0.65 + 0.7 * fract(e.aux.w * 5.7);
  float size = U.emberSize * (0.55 + 0.45 * e.aux.z) * alive * fade * jitter;
  float2 world = e.pv.xy + corners[vid] * size;
  EmberOut o;
  o.pos = float4(world * U.viewScale, 0.0, 1.0);
  o.local = corners[vid];
  o.idx = ii;
  return o;
}

fragment float4 fsEmber(EmberOut in [[stage_in]],
                        constant Uniforms& U [[buffer(0)]],
                        const device Ember* embers [[buffer(1)]]) {
  float q2 = dot(in.local, in.local);
  if (q2 > 1.0) { discard_fragment(); }
  Ember e = embers[in.idx];
  float w = (1.0 - q2) * (1.0 - q2);
  float flick = 0.8 + 0.2 * sin(U.time * (6.0 + e.aux.w * 9.0) + e.aux.w * 80.0);
  // fade with remaining life so embers gutter out instead of vanishing
  float fade = smoothstep(0.0, 0.3, clamp(e.aux.x / max(e.aux.y, 1e-3), 0.0, 1.0));
  // fade *in* too: newborn embers are still inside the flame
  fade *= smoothstep(0.0, 0.2, e.aux.y - e.aux.x);
  // and stay dim while overlapping the flame body — dozens of additive
  // splats funneling through the tip otherwise saturate to a white clump
  float2 fc = float2(0.0, groundY(0.0) + 0.12);
  float fr = length((e.pv.xy - fc) * float2(1.3, 0.75)) / max(0.24 * U.fireScale, 0.02);
  fade *= mix(0.18, 1.0, smoothstep(0.5, 1.3, fr));

  float3 col = emberColor(e.aux.z) * U.glow * flick * fade;
  // cooled embers also stop occluding — an opaque dim ember reads as a
  // dark speck punched into the glow behind it
  float occA = 0.25 + 0.75 * smoothstep(0.1, 0.5, e.aux.z);
  return float4(col * w, w * 1.4 * fade * occA); // alpha core ≥ 1: rays must hit
}

// ================================ scene =====================================

// Last frame's light at this pixel: four direction blocks of cascade 0,
// hardware-bilinear, averaged. One frame late — which is exactly what makes
// multi-bounce free: bounce n arrives n frames after the source moves.
static float3 fluenceAt(float2 uv, texture2d<float> casc0, sampler s, float2 probes0) {
  float2 texFull = float2(casc0.get_width(), casc0.get_height());
  float2 local = clamp(uv, 0.5 / probes0, 1.0 - 0.5 / probes0);
  float3 sum = float3(0.0);
  for (uint d = 0u; d < 4u; d++) {
    float2 cb = float2(float(d % 2u), float(d / 2u));
    float2 tuv = (cb + local) * probes0 / texFull;
    sum += casc0.sample(s, tuv, level(0.0)).rgb;
  }
  return sum * 0.25;
}

fragment float4 fsScene(FullOut in [[stage_in]],
                        constant Uniforms& U [[buffer(0)]],
                        texture2d<float> fluenceTex [[texture(0)]],
                        sampler s [[sampler(0)]]) {
  float2 clip = float2(in.uv.x * 2.0 - 1.0, 1.0 - in.uv.y * 2.0);
  float2 world = clip / U.viewScale;
  float3 emission = float3(0.0);
  float3 albedo = float3(0.0);
  float occ = 0.0;

  // ground
  float gy = groundY(world.x);
  if (world.y < gy) {
    occ = 1.0;
    float depth = gy - world.y;
    albedo = mix(float3(0.16, 0.15, 0.09), float3(0.07, 0.06, 0.045), smoothstep(0.0, 0.25, depth));
  }

  // trees — six of them, because fullscreen is wider than a blog column
  float td = treeDist(world, -0.62, 0.55, 1.0);
  td = min(td, treeDist(world, 0.58, 0.68, 2.0));
  td = min(td, treeDist(world, 1.28, 0.45, 3.0));
  td = min(td, treeDist(world, -1.32, 0.62, 4.0));
  td = min(td, treeDist(world, 1.78, 0.58, 5.0));
  td = min(td, treeDist(world, -1.86, 0.5, 6.0));
  if (td < 0.0) {
    occ = 1.0;
    albedo = float3(0.05, 0.09, 0.04); // dark needles drink most of the light
  }

  // the log
  if (sdCapsule(world, float2(-0.12, gy + 0.012), float2(0.12, gy + 0.012), 0.024) < 0.0) {
    occ = 1.0;
    albedo = float3(0.13, 0.07, 0.04);
  }

  // the flame: a licking, noise-eroded teardrop above the log
  float fy = groundY(0.0);
  float fs = max(0.24 * U.fireScale, 0.02);
  float2 fp = (world - float2(0.0, fy + 0.035)) / fs;
  float rise = smoothstep(0.0, 0.7, fp.y);
  fp.x += ((vnoise(float2(fp.y * 3.5 - U.time * 2.6, U.time * 1.4)) - 0.5) * 0.5 +
           (vnoise(float2(fp.y * 8.0 - U.time * 5.2, U.time * 2.1 + 7.0)) - 0.5) * 0.22) * rise;
  float taper = mix(1.5, 4.8, smoothstep(-0.1, 1.0, fp.y));
  float fd = length(fp * float2(taper, 1.05));
  fd += (fbm(fp * float2(2.5, 1.2) + float2(0.0, -U.time * 2.4)) - 0.5) * 0.5;
  float flame = smoothstep(1.05, 0.45, fd) * step(-0.04, fp.y);
  if (flame > 0.02) {
    float core = smoothstep(0.4, 1.0, flame) * smoothstep(0.9, 0.1, fp.y);
    float3 fc = mix(float3(1.0, 0.22, 0.02), float3(1.0, 0.6, 0.16), smoothstep(0.2, 0.8, flame));
    fc = mix(fc, float3(1.0, 0.9, 0.55), core);
    float pulse = 0.85 + 0.15 * vnoise(float2(U.time * 3.1, 4.7));
    emission += fc * flame * 6.5 * pulse * U.glow;
    occ = max(occ, step(0.5, flame));
  }

  // stars: emissive dust that owns no surface (rays never hit it)
  if (occ < 0.5 && U.night > 0.3) {
    float st = hash21(floor(world * 110.0));
    if (st > 0.998) {
      emission += float3(0.5, 0.6, 0.8) * (st - 0.998) * 280.0 * (U.night - 0.3) *
        (0.6 + 0.4 * sin(U.time * 2.0 + st * 900.0));
    }
  }

  // multi-bounce: surfaces re-emit a slice of the light they received last
  // frame. Ground pixels sample the light a whisker above their own surface —
  // a probe buried inside an occluder sees only its own dark interior.
  if (occ > 0.5 && U.bounce > 0.0) {
    float2 fuv = in.uv;
    float depthFade = 1.0;
    if (world.y < gy) {
      float2 surface = float2(world.x, gy + 0.03);
      float2 sclip = surface * U.viewScale;
      fuv = float2(sclip.x * 0.5 + 0.5, 0.5 - sclip.y * 0.5);
      // thin: at fullscreen a deep fade reads as a buried searchlight
      depthFade = smoothstep(0.06, 0.0, gy - world.y);
    }
    emission += albedo * fluenceAt(fuv, fluenceTex, s, U.probes0) * U.bounce * depthFade;
  }
  // surfaces are never *pure* black even unlit
  emission += albedo * 0.012;

  return float4(emission, occ);
}

// ====================== seed → jump flood → distance ========================

fragment float2 fsSeed(FullOut in [[stage_in]],
                       texture2d<float> sceneTex [[texture(0)]]) {
  uint2 p = uint2(in.pos.xy);
  float occ = sceneTex.read(p).a;
  if (occ > 0.5) { return in.pos.xy; }
  return float2(-1e4, -1e4);
}

fragment float2 fsJfa(FullOut in [[stage_in]],
                      constant float& offset [[buffer(1)]],
                      texture2d<float> jfaTex [[texture(0)]]) {
  int2 dims = int2(jfaTex.get_width(), jfaTex.get_height());
  int2 p = int2(in.pos.xy);
  float2 best = float2(-1e4, -1e4);
  float bestD = 1e12;
  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      int2 q = clamp(p + int2(dx, dy) * int(offset), int2(0), dims - 1);
      float2 cand = jfaTex.read(uint2(q)).xy;
      if (cand.x < -9000.0) { continue; }
      float dd = dot(cand - in.pos.xy, cand - in.pos.xy);
      if (dd < bestD) { bestD = dd; best = cand; }
    }
  }
  return best;
}

fragment float fsDist(FullOut in [[stage_in]],
                      texture2d<float> jfaTex [[texture(0)]]) {
  float2 seed = jfaTex.read(uint2(in.pos.xy)).xy;
  if (seed.x < -9000.0) { return 1e4; }
  return length(seed - in.pos.xy);
}

// =============================== cascades ===================================

// The environment: what the top cascade merges with instead of darkness.
static float3 skyRadiance(float2 dir, constant Uniforms& U) {
  float strength = U.sunColor.w;
  if (strength <= 0.0) { return float3(0.0); }
  float up = -dir.y; // texture y runs down; up is where the sky lives
  float3 base = mix(U.horizon.rgb, U.zenith.rgb, smoothstep(-0.05, 0.8, up));
  float aboveGround = smoothstep(-0.5, -0.05, up);
  float3 col = base * aboveGround;
  float s = max(dot(dir, normalize(U.sun.xy)), 0.0);
  col += U.sunColor.rgb * pow(s, max(U.sun.z, 1.0)) * U.sun.w;
  // moonlight: a dim, narrow directional source. In this 2D side-view the
  // sky shows fluence (an average over all directions), so a bright "disk"
  // never reads as a disk — it only washes the whole sky gray. Keep the
  // mean tiny; the win is cool rim light and a second set of soft shadows.
  if (U.night > 0.05) {
    float m = max(dot(dir, normalize(float2(-0.55, -1.0))), 0.0);
    col += float3(0.6, 0.7, 1.0) * (pow(m, 800.0) * 0.5 + pow(m, 100.0) * 0.012) * U.night;
  }
  return col * strength;
}

fragment float4 fsCascade(FullOut in [[stage_in]],
                          constant Uniforms& U [[buffer(0)]],
                          constant CascadeParams& C [[buffer(1)]],
                          texture2d<float> sceneTex [[texture(0)]],
                          texture2d<float> distTex [[texture(1)]],
                          texture2d<float> upperTex [[texture(2)]],
                          sampler s [[sampler(0)]]) {
  uint2 texel = uint2(in.pos.xy);
  uint2 probesU = uint2(C.probes);
  uint2 probe = texel % probesU;          // which probe (within a direction block)
  uint2 block = texel / probesU;          // which direction block
  uint blocks = uint(C.blocks);
  uint dirIdx = block.y * blocks + block.x;
  float dirCount = float(blocks * blocks);

  float2 sceneRes = float2(distTex.get_width(), distTex.get_height());
  float2 spacing = sceneRes / C.probes;
  float2 origin = (float2(probe) + 0.5) * spacing;

  float ang = 6.28318530718 * (float(dirIdx) + 0.5) / dirCount;
  float2 dir = float2(cos(ang), sin(ang));

  // sphere-march the interval against the distance field
  float t = C.intervalStart;
  float3 radiance = float3(0.0);
  bool hit = false;
  float tEnd = C.intervalStart + C.intervalLen;
  bool escaped = false;
  int steps = int(C.steps);
  for (int i = 0; i < steps; i++) {
    float2 pos = origin + dir * t;
    if (pos.x < 0.0 || pos.y < 0.0 || pos.x >= sceneRes.x || pos.y >= sceneRes.y) {
      escaped = true;
      break; // off the canvas: a miss — let the cascade above (or the sky) answer
    }
    float2 uv = pos / sceneRes;
    float d = distTex.sample(s, uv, level(0.0)).r;
    if (d < 1.0) {
      radiance = sceneTex.sample(s, uv, level(0.0)).rgb;
      hit = true;
      break;
    }
    t += max(d, 1.0);
    if (t >= tEnd) { break; }
  }
  (void)escaped;

  // miss → this interval saw nothing; defer to the cascade above
  if (!hit) {
    if (C.isTop > 0.5) {
      radiance = skyRadiance(dir, U);
    } else {
      float2 texFull = float2(upperTex.get_width(), upperTex.get_height());
      float2 probeUV = (float2(probe) + 0.5) / C.probes;
      float2 local = clamp(probeUV, 0.5 / C.upperProbes, 1.0 - 0.5 / C.upperProbes);
      uint ublocks = uint(C.upperBlocks);
      float3 sum = float3(0.0);
      for (uint k = 0u; k < 4u; k++) {
        uint child = dirIdx * 4u + k;
        float2 cb = float2(float(child % ublocks), float(child / ublocks));
        float2 uv = (cb + local) * C.upperProbes / texFull;
        sum += upperTex.sample(s, uv, level(0.0)).rgb;
      }
      radiance = sum * 0.25;
    }
  }
  return float4(radiance, 1.0);
}

// ============================ resolve (HDR) =================================

fragment float4 fsResolve(FullOut in [[stage_in]],
                          constant Uniforms& U [[buffer(0)]],
                          constant PostParams& P [[buffer(1)]],
                          texture2d<float> casc0 [[texture(0)]],
                          texture2d<float> sceneTex [[texture(1)]],
                          sampler s [[sampler(0)]]) {
  float3 fl = fluenceAt(in.uv, casc0, s, U.probes0);
  float4 scene = sceneTex.sample(s, in.uv, level(0.0));
  float2 clip = float2(in.uv.x * 2.0 - 1.0, 1.0 - in.uv.y * 2.0);
  float2 world = clip / U.viewScale;

  // night air: in 2D radiance cascades a hit returns full emission at any
  // distance, so the fire's glow never falls off and the night sky washes
  // gray. Absorb the long-range wash in *empty* pixels — surfaces keep
  // their light, and emission (stars, embers) is added after, untouched.
  if (P.nightAir > 0.001 && scene.a < 0.5 && uint(P.debugMode) == 0u) {
    float2 fireC = float2(0.0, groundY(0.0) + 0.15 * U.fireScale);
    float d = length(world - fireC);
    float atten = exp(-max(d - 0.3, 0.0) * 2.0 * P.nightAir);
    fl *= mix(1.0, atten, U.night);
  }

  float3 col;
  if (uint(P.debugMode) == 4u) {
    col = fl; // light only: everything you see arrived from somewhere else
  } else {
    col = fl + scene.rgb * P.emitBoost;
  }

  // the smoke column the blog post promised for "next part": a cheap lit
  // veil, not true participating media — tinted by the local fluence so the
  // fire glows through its own smoke
  if (P.smoke > 0.001 && uint(P.debugMode) == 0u) {
    float gy = groundY(world.x);
    float flameTop = groundY(0.0) + 0.30 * U.fireScale;
    float riseAmt = world.y - flameTop;
    if (riseAmt > -0.15 && world.y > gy) {
      float sway = 0.22 * (fbm3(float2(world.y * 1.3 - U.time * 0.21, 3.7)) - 0.5);
      sway += riseAmt * 0.12 * sin(U.time * 0.13 + 2.0);
      float width = 0.16 * U.fireScale + 0.36 * max(riseAmt, 0.0);
      float core = exp(-pow((world.x - sway) / max(width, 1e-3), 2.0) * 1.6);
      float2 sp = float2(world.x * 2.0, world.y * 1.6 - U.time * 0.55);
      float puff = fbm3(sp * 2.4) * 0.65 + fbm3(sp * 5.1 + 13.7) * 0.35;
      float density = core
        * smoothstep(-0.15, 0.25, riseAmt)
        * smoothstep(2.4, 0.7, riseAmt)
        * smoothstep(0.32, 0.72, puff);
      float a = clamp(density * P.smoke, 0.0, 0.7);
      // smoke mostly absorbs; it re-emits only a desaturated whisper of the
      // local light, or it reads as a red column over the fire
      float3 lit = fl * 0.3;
      float3 smokeCol = mix(lit, float3(dot(lit, float3(0.333))), 0.6) + float3(0.006, 0.006, 0.008);
      col = mix(col, smokeCol, a);
    }
  }

  return float4(col, 1.0);
}

// ========================== bloom bright pass ===============================

fragment float4 fsBright(FullOut in [[stage_in]],
                         texture2d<float> hdrTex [[texture(0)]],
                         sampler s [[sampler(0)]]) {
  float3 c = hdrTex.sample(s, in.uv, level(0.0)).rgb;
  float l = dot(c, float3(0.2126, 0.7152, 0.0722));
  return float4(c * smoothstep(0.7, 1.8, l), 1.0);
}

// ============================== final =======================================
// Drawable is rgba16Float in extended linear Display P3: values > 1 are
// brighter than SDR white. Extended Reinhard maps the open-ended HDR range
// to the display's actual EDR headroom.

fragment float4 fsFinal(FullOut in [[stage_in]],
                        constant Uniforms& U [[buffer(0)]],
                        constant PostParams& P [[buffer(1)]],
                        texture2d<float> hdrTex [[texture(0)]],
                        texture2d<float> bloomTex [[texture(1)]],
                        texture2d<float> sceneTex [[texture(2)]],
                        texture2d<float> distTex [[texture(3)]],
                        sampler s [[sampler(0)]]) {
  uint mode = uint(P.debugMode);
  if (mode == 1u) { // scene (what the rays see)
    return float4(sceneTex.sample(s, in.uv, level(0.0)).rgb, 1.0);
  }
  if (mode == 2u) { // occupancy
    return float4(float3(sceneTex.sample(s, in.uv, level(0.0)).a), 1.0);
  }
  if (mode == 3u) { // distance field
    float d = distTex.sample(s, in.uv, level(0.0)).r;
    float3 c = float3(fract(d / 32.0)) * float3(0.6, 0.75, 1.0);
    return float4(c * c, 1.0); // square ≈ gamma decode, to match the web look
  }

  float2 uv = in.uv;
  float3 bl = bloomTex.sample(s, uv, level(0.0)).rgb;

  // heat shimmer: refract the image where the bloom says it's hot
  if (P.shimmer > 0.001) {
    float heat = smoothstep(0.3, 2.2, dot(bl, float3(0.333)));
    float n1 = vnoise(float2(uv.x * 140.0, uv.y * 90.0 + U.time * 2.8));
    float n2 = vnoise(float2(uv.x * 140.0 + 31.0, uv.y * 90.0 + U.time * 2.8));
    uv += (float2(n1, n2) - 0.5) * 0.006 * P.shimmer * heat;
    bl = bloomTex.sample(s, uv, level(0.0)).rgb;
  }

  float3 col = hdrTex.sample(s, uv, level(0.0)).rgb;
  col += bl * P.bloom;
  col *= P.exposure;

  // extended Reinhard: peaks land at the display's EDR ceiling
  float peak = max(P.edrMax, 1.0);
  col = col * (1.0 + col / (peak * peak)) / (1.0 + col);

  float vd = distance(in.uv, float2(0.5));
  col *= 1.0 - P.vignette * smoothstep(0.35, 0.85, vd);

  float g = hash21(in.uv * 913.7 + fract(U.time) * 101.0);
  col *= 1.0 + (g - 0.5) * P.grain;

  return float4(max(col, float3(0.0)), 1.0);
}
