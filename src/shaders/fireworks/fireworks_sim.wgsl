struct Params {
  viewport: vec4f,
  timeMouse: vec4f,
  scene: vec4f,
  launch: vec4f,
  simA: vec4f,
  simB: vec4f,
  renderA: vec4f,
  renderB: vec4f,
  systemA: vec4f,
  systemB: vec4f,
  debugA: vec4f,
}

struct Particle {
  pos: vec2f,
  vel: vec2f,
  color: vec4f,
  ageLife: vec4f,
  seedLevel: vec4f,
  home: vec4f,
}

struct EmitCommand {
  header: vec4u,      // kind, count, start, aux
  posScaleSeed: vec4f,
  velLifeSize: vec4f,
  color: vec4f,
  accent: vec4f,
  homeParams: vec4f,
}

struct Counters {
  live: atomic<u32>,
  write: atomic<u32>,
  commandCount: atomic<u32>,
  totalEmit: atomic<u32>,
  overflow: atomic<u32>,
  pad0: atomic<u32>,
  pad1: atomic<u32>,
  pad2: atomic<u32>,
}

struct DrawArgs {
  vertexCount: u32,
  instanceCount: u32,
  firstVertex: u32,
  firstInstance: u32,
}

struct DispatchArgs {
  x: u32,
  y: u32,
  z: u32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> particlesIn: array<Particle>;
@group(0) @binding(2) var<storage, read_write> particlesOut: array<Particle>;
@group(0) @binding(3) var<storage, read_write> counters: Counters;
@group(0) @binding(4) var<storage, read> commands: array<EmitCommand>;
@group(0) @binding(5) var<storage, read_write> drawArgs: DrawArgs;
@group(0) @binding(6) var<storage, read_write> dispatchArgs: DispatchArgs;

const KIND_ROCKET: f32 = 1.0;
const KIND_SPARK: f32 = 2.0;
const KIND_EMBER: f32 = 3.0;
const KIND_SMOKE: f32 = 4.0;
const KIND_ACCRETION: f32 = 5.0;
const TAU: f32 = 6.28318530718;
const WG: u32 = 256u;
const HASH_TABLE_MASK: u32 = 65535u;

fn hash11(n: f32) -> f32 {
  return fract(sin(n * 12.9898 + 78.233) * 43758.5453);
}

fn hash21(p: vec2f) -> f32 {
  let q = fract(vec2f(dot(p, vec2f(127.1, 311.7)), dot(p, vec2f(269.5, 183.3))));
  return fract(sin(q.x + q.y) * 43758.5453);
}

fn bucket_of(c: vec2i) -> u32 {
  let h = (u32(c.x) * 0x9E3779B1u) ^ (u32(c.y) * 0x85EBCA77u);
  return h & HASH_TABLE_MASK;
}

fn rand(seed: f32, salt: f32) -> f32 {
  return hash11(seed + salt * 19.193);
}

fn mix_color(a: vec3f, b: vec3f, t: f32) -> vec3f {
  return a + (b - a) * clamp(t, 0.0, 1.0);
}

fn safe_norm(v: vec2f) -> vec2f {
  let l = length(v);
  if (l < 0.00001) {
    return vec2f(0.0, 1.0);
  }
  return v / l;
}

fn grid_curl(pos: vec2f, time: f32, scale: f32) -> vec2f {
  let p = (pos * 0.5 + vec2f(0.5)) * scale;
  let cell = floor(p);
  let local = fract(p) - vec2f(0.5);
  let h = hash21(cell + floor(time * 0.85));
  let a = h * TAU + time * (0.7 + h);
  let base = vec2f(cos(a), sin(a));
  let swirl = vec2f(-local.y, local.x) * (0.45 + h);
  return safe_norm(base + swirl + vec2f(0.0001));
}

fn write_particle(index: u32, p: Particle) {
  let capacity = arrayLength(&particlesOut);
  if (index < capacity) {
    particlesOut[index] = p;
  } else {
    atomicAdd(&counters.overflow, 1u);
  }
}

fn append_particle(p: Particle) {
  let outIndex = atomicAdd(&counters.write, 1u);
  write_particle(outIndex, p);
}

fn make_particle(
  pos: vec2f,
  vel: vec2f,
  color: vec3f,
  seed: f32,
  life: f32,
  size: f32,
  kind: f32,
  level: f32,
  parallax: f32,
  home: vec2f,
) -> Particle {
  return make_particle_ext(pos, vel, color, seed, life, size, kind, level, parallax, home, vec2f(0.0), 0.0);
}

fn make_particle_ext(
  pos: vec2f,
  vel: vec2f,
  color: vec3f,
  seed: f32,
  life: f32,
  size: f32,
  kind: f32,
  level: f32,
  parallax: f32,
  home: vec2f,
  homeExtra: vec2f,
  gridKey: f32,
) -> Particle {
  var p: Particle;
  p.pos = pos;
  p.vel = vel;
  p.color = vec4f(color, seed);
  p.ageLife = vec4f(0.0, life, size, kind);
  p.seedLevel = vec4f(seed, level, parallax, gridKey);
  p.home = vec4f(home, homeExtra);
  return p;
}

fn simulate_particle(pIn: Particle) -> Particle {
  var p = pIn;
  let dt = min(params.timeMouse.y, 0.033);
  p.ageLife.x += dt;

  let kind = p.ageLife.w;
  let age01 = clamp(p.ageLife.x / max(p.ageLife.y, 0.0001), 0.0, 1.0);
  let isAccretion = kind > 4.5 && kind < 5.5;
  var accel = vec2f(params.simB.x * 0.025, -params.simA.z);
  var drag = params.simA.w;

  if (kind < 1.5) {
    accel.y *= 0.13;
    drag = 0.996;
  } else if (kind > 3.5 && kind < 4.5) {
    accel = vec2f(params.simB.x * 0.045, 0.05);
    drag = 0.972;
  } else if (isAccretion) {
    accel = vec2f(params.simB.x * 0.012, -params.simA.z * 0.18);
    drag = 0.992;
  }

  let curl = grid_curl(p.pos + p.seedLevel.x * 0.017, params.timeMouse.x, params.simB.y);
  let gridFactor = select(0.55, 0.18, kind < 1.5);
  accel += curl * params.simB.z * gridFactor * (1.0 - age01 * 0.35);

  let rel = p.pos - p.home.xy;
  let dist = length(rel);
  if (kind > 1.5 && kind < 3.6 && dist > 0.0001) {
    let tangent = vec2f(-rel.y, rel.x) / dist;
    let shell = 0.25 + p.seedLevel.y * 0.16;
    accel += tangent * params.simB.w * shell * exp(-dist * 2.4) * (1.0 - age01);
  }

  if (isAccretion && dist > 0.0001) {
    let collapseStart = max(p.home.z, 0.05);
    let collapseDuration = max(p.home.w, 0.08);
    let collapseAge = p.ageLife.x - collapseStart;
    let collapse01 = clamp(collapseAge / collapseDuration, 0.0, 1.0);
    let collapseGate = smoothstep(0.0, 0.18, collapse01);
    let toHome = -rel / dist;
    let tangent = vec2f(-toHome.y, toHome.x);
    let cellSize = max(params.systemB.x, 0.006);
    let cell = vec2i(floor(rel / cellSize));
    let bucket = bucket_of(cell);
    let bucket01 = f32(bucket & 1023u) / 1023.0;
    let level = max(p.seedLevel.y, 1.0);

    if (collapseAge <= 0.0) {
      let preCurl = grid_curl(p.pos + vec2f(bucket01, p.seedLevel.w) * 0.11, params.timeMouse.x, 20.0);
      accel += preCurl * params.simB.z * 0.28;
      accel += tangent * params.systemB.z * (0.05 + level * 0.015);
    } else {
      let spring = params.systemA.w * (0.32 + dist * 1.65) * (0.72 + bucket01 * 0.42);
      let radialSpeed = dot(p.vel, toHome);
      accel += toHome * spring * collapseGate;
      accel -= toHome * max(radialSpeed, 0.0) * params.systemB.y * collapseGate;
      accel -= p.vel * params.systemB.y * 0.18 * collapseGate;
      accel += tangent * params.systemB.z * (1.0 - collapse01) * (0.35 + level * 0.04);

      let shock = smoothstep(0.72, 0.9, collapse01) * (1.0 - smoothstep(0.93, 1.0, collapse01));
      accel += rel / dist * params.systemB.w * shock * (0.28 + bucket01 * 0.85);
      drag = mix(0.988, 0.948, collapseGate);
    }
  }

  p.vel += accel * dt;
  p.vel *= pow(drag, dt * 60.0);
  p.pos += p.vel * dt;
  return p;
}

fn command_for_emit(globalEmitIndex: u32) -> EmitCommand {
  let commandCount = atomicLoad(&counters.commandCount);
  var lo = 0u;
  var hi = commandCount;
  loop {
    if (lo + 1u >= hi) {
      break;
    }
    let mid = (lo + hi) / 2u;
    if (commands[mid].header.z <= globalEmitIndex) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return commands[lo];
}

fn emit_rocket(cmd: EmitCommand, local: u32) -> Particle {
  let seed = cmd.posScaleSeed.w + f32(local) * 0.000001;
  return make_particle(
    cmd.posScaleSeed.xy,
    cmd.velLifeSize.xy,
    cmd.color.rgb,
    seed,
    cmd.velLifeSize.z,
    cmd.velLifeSize.w,
    KIND_ROCKET,
    0.0,
    cmd.homeParams.z,
    cmd.homeParams.xy,
  );
}

fn emit_trail(cmd: EmitCommand, local: u32) -> Particle {
  let mode = cmd.header.w;
  let seed = cmd.posScaleSeed.w + params.timeMouse.x * 0.001 + f32(local) * 0.713;
  let back = safe_norm(-cmd.velLifeSize.xy);
  let baseAngle = atan2(back.y, back.x);
  let color = mix_color(cmd.color.rgb, cmd.accent.rgb, rand(seed, 4.0) * 0.75);
  var pos = cmd.posScaleSeed.xy;
  var vel = vec2f(0.0);
  var life = 0.55;
  var size = 0.003;
  var kind = KIND_SPARK;
  var level = 1.0;
  var parallax = cmd.homeParams.z;

  if (mode == 0u) {
    let angle = baseAngle + (rand(seed, 1.0) * 1.6 - 0.8);
    let speed = 0.08 + rand(seed, 2.0) * 0.26;
    pos += vec2f(rand(seed, 3.0) * 0.024 - 0.012, rand(seed, 4.0) * 0.016 - 0.004);
    vel = vec2f(cos(angle), sin(angle)) * speed;
    life = 0.35 + rand(seed, 5.0) * 0.55;
    size = 0.0024 + rand(seed, 6.0) * 0.0034;
    kind = select(KIND_SPARK, KIND_SMOKE, rand(seed, 7.0) > 0.82);
    level = 0.0;
  } else if (local < 3u) {
    let angle = baseAngle + (rand(seed, 1.0) * 1.1 - 0.55);
    let speed = 0.035 + rand(seed, 2.0) * 0.095;
    pos += vec2f(rand(seed, 3.0) * 0.012 - 0.006, rand(seed, 4.0) * 0.012 - 0.006);
    vel = vec2f(cos(angle) * speed + rand(seed, 5.0) * 0.05 - 0.025, sin(angle) * speed);
    life = 0.42 + rand(seed, 6.0) * 0.48;
    size = 0.0018 + rand(seed, 7.0) * 0.0026;
  } else {
    vel = vec2f(rand(seed, 1.0) * 0.04 - 0.02, rand(seed, 2.0) * 0.06 - 0.015);
    life = 0.7 + rand(seed, 3.0) * 0.65;
    size = 0.007 + rand(seed, 4.0) * 0.007;
    kind = KIND_SMOKE;
    level = 0.0;
    parallax = max(parallax, 0.52);
  }

  return make_particle(pos, vel, color, seed, life, size, kind, level, parallax, cmd.homeParams.xy);
}

fn emit_explosion(cmd: EmitCommand, local: u32) -> Particle {
  let scale = cmd.posScaleSeed.z;
  let seed = cmd.posScaleSeed.w + params.timeMouse.x * 0.001 + f32(local) * 0.193;
  let sparkCount = cmd.header.w;
  let crackleCount = u32(max(cmd.velLifeSize.z, 0.0));
  let emberCount = u32(max(cmd.velLifeSize.w, 0.0));
  let smokeCount = u32(max(cmd.homeParams.w, 0.0));
  let burstSpeed = cmd.velLifeSize.x;
  let levels = max(cmd.velLifeSize.y, 2.0);
  let parallax = cmd.homeParams.z;
  let center = cmd.posScaleSeed.xy;

  if (local == 0u) {
    return make_particle(center, vec2f(0.0), cmd.accent.rgb, seed, 0.42, 0.035 * scale, KIND_SPARK, levels, parallax, center);
  }

  let sparkLocal = local - 1u;
  if (sparkLocal < sparkCount) {
    let u = (f32(sparkLocal) + 0.5) / max(f32(sparkCount), 1.0);
    let shell = sqrt(u);
    let level = floor(shell * levels);
    let snap = round(u * 4.0) / 4.0;
    let pyramidU = mix(u, snap, 0.045 + shell * 0.08);
    let jitter = (rand(seed, 1.0) * 0.036 - 0.018) * TAU;
    let angle = pyramidU * TAU + level * 0.71 + jitter;
    let speed = burstSpeed * (0.32 + shell * 0.95) * (0.72 + rand(seed, 2.0) * 0.46) * scale;
    let upward = select(0.0, 0.04 * shell, sin(angle) > 0.0);
    let pos = center + vec2f(rand(seed, 3.0) * 0.012 - 0.006, rand(seed, 4.0) * 0.012 - 0.006);
    let vel = vec2f(cos(angle) * speed, sin(angle) * speed * 0.88 + upward);
    let color = mix_color(cmd.color.rgb, cmd.accent.rgb, rand(seed, 5.0));
    let life = 0.95 + rand(seed, 6.0) * 0.85 + shell * 0.45;
    let size = (0.0024 + rand(seed, 7.0) * 0.0032) * (1.0 + shell * 0.35) * scale;
    return make_particle(pos, vel, color, seed, life, size, KIND_SPARK, level, parallax, center);
  }

  let crackleLocal = sparkLocal - sparkCount;
  if (crackleLocal < crackleCount) {
    let a = rand(seed, 1.0) * TAU;
    let ring = 0.55 + rand(seed, 2.0) * 0.45;
    let dir = safe_norm(vec2f(cos(a), sin(a)) * ring + vec2f(rand(seed, 3.0) - 0.5, rand(seed, 4.0) - 0.5) * 0.12);
    let speed = burstSpeed * scale * (0.16 + rand(seed, 5.0) * 0.22);
    let color = mix_color(cmd.color.rgb, cmd.accent.rgb, rand(seed, 6.0));
    let life = 0.55 + rand(seed, 7.0) * 0.6;
    let size = (0.0018 + rand(seed, 8.0) * 0.002) * scale;
    return make_particle(center + dir * 0.006, dir * speed, color, seed, life, size, KIND_SPARK, 4.0 * ring, parallax, center);
  }

  let emberLocal = crackleLocal - crackleCount;
  if (emberLocal < emberCount) {
    let angle = 0.1 * 3.14159 + rand(seed, 1.0) * 0.8 * 3.14159;
    let speed = (0.04 + rand(seed, 2.0) * 0.24) * scale;
    let vel = vec2f(cos(angle) * speed, sin(angle) * speed * 0.32 - (0.02 + rand(seed, 3.0) * 0.16));
    let color = mix_color(cmd.color.rgb, cmd.accent.rgb, rand(seed, 4.0) * 0.45);
    let life = 1.1 + rand(seed, 5.0) * 1.6;
    let size = (0.0025 + rand(seed, 6.0) * 0.003) * scale;
    return make_particle(center, vel, color, seed, life, size, KIND_EMBER, 1.0, parallax + 0.04, center);
  }

  let smokeSeed = seed + f32(smokeCount) * 0.37;
  let pos = center + vec2f(rand(smokeSeed, 1.0) * 0.024 - 0.012, rand(smokeSeed, 2.0) * 0.024 - 0.012);
  let vel = vec2f(rand(smokeSeed, 3.0) * 0.07 - 0.035, rand(smokeSeed, 4.0) * 0.08);
  let life = 1.1 + rand(smokeSeed, 5.0) * 0.9;
  let size = (0.012 + rand(smokeSeed, 6.0) * 0.02) * scale;
  return make_particle(pos, vel, vec3f(0.35, 0.25, 0.24), smokeSeed, life, size, KIND_SMOKE, 0.0, parallax + 0.08, center);
}

fn emit_accretion_collapse(cmd: EmitCommand, local: u32) -> Particle {
  let scale = cmd.posScaleSeed.z;
  let seed = cmd.posScaleSeed.w + params.timeMouse.x * 0.001 + f32(local) * 0.271;
  let grainCount = cmd.header.w;
  let burstSpeed = cmd.velLifeSize.x;
  let levels = max(cmd.velLifeSize.y, 3.0);
  let collapseDelay = max(cmd.velLifeSize.z, 0.08);
  let collapseDuration = max(cmd.velLifeSize.w, 0.12);
  let hashCell = max(params.systemB.x, 0.006);
  let parallax = cmd.homeParams.z;
  let center = cmd.posScaleSeed.xy;
  let lifePad = select(0.75, 0.5, cmd.homeParams.w > 0.5);

  if (local == 0u) {
    return make_particle_ext(
      center,
      vec2f(0.0),
      cmd.accent.rgb,
      seed,
      collapseDelay + collapseDuration + lifePad,
      0.026 * scale,
      KIND_ACCRETION,
      levels,
      parallax,
      center,
      vec2f(collapseDelay, collapseDuration),
      0.0,
    );
  }

  let grainLocal = local - 1u;
  let u = (f32(grainLocal) + 0.5) / max(f32(grainCount), 1.0);
  let shell = sqrt(u);
  let level = floor(shell * levels);
  let levelNorm = level / max(levels - 1.0, 1.0);
  let slots = max(9.0, (level + 2.0) * 7.0);
  let snapped = (floor(u * slots) + rand(seed, 1.0) * 0.24) / slots;
  let jitter = (rand(seed, 2.0) * 0.05 - 0.025) * TAU;
  let angle = snapped * TAU + level * 0.63 + jitter;
  let dir = vec2f(cos(angle), sin(angle));
  let tangent = vec2f(-dir.y, dir.x);
  let targetOffset = dir * (0.055 + shell * 0.22) * scale;
  let cell = vec2i(floor(targetOffset / hashCell));
  let bucket = bucket_of(cell);
  let bucket01 = f32(bucket) / f32(HASH_TABLE_MASK);
  let bucketWave = bucket01 * 0.22;
  let speed = burstSpeed * (0.36 + shell * 1.18) * (0.82 + rand(seed, 3.0) * 0.38) * scale;
  let spiral = params.systemB.z * (0.07 + shell * 0.05);
  let pos = center + vec2f(rand(seed, 4.0) * 0.012 - 0.006, rand(seed, 5.0) * 0.012 - 0.006);
  let upward = select(0.0, 0.035 * shell, dir.y > 0.0);
  let vel = dir * speed + tangent * spiral + vec2f(0.0, upward);
  let color = mix_color(cmd.color.rgb, cmd.accent.rgb, 0.2 + rand(seed, 6.0) * 0.8);
  let life = collapseDelay + collapseDuration + lifePad + rand(seed, 7.0) * 0.55 + levelNorm * 0.24;
  let size = (0.0022 + rand(seed, 8.0) * 0.0036) * (1.0 + shell * 0.45) * scale;

  return make_particle_ext(
    pos,
    vel,
    color,
    seed,
    life,
    size,
    KIND_ACCRETION,
    level,
    parallax,
    center,
    vec2f(collapseDelay + bucketWave, collapseDuration),
    bucket01,
  );
}

@compute @workgroup_size(1)
fn beginFrame(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x != 0u) {
    return;
  }
  atomicStore(&counters.write, 0u);
  atomicStore(&counters.overflow, 0u);
  drawArgs.vertexCount = 6u;
  drawArgs.instanceCount = 0u;
  drawArgs.firstVertex = 0u;
  drawArgs.firstInstance = 0u;
}

@compute @workgroup_size(256)
fn simulateCompact(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  let activeCount = atomicLoad(&counters.live);
  if (i >= activeCount) {
    return;
  }

  let p = simulate_particle(particlesIn[i]);
  if (p.ageLife.x >= p.ageLife.y || p.ageLife.y <= 0.0) {
    return;
  }
  append_particle(p);
}

@compute @workgroup_size(256)
fn emitParticles(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  let totalEmit = atomicLoad(&counters.totalEmit);
  if (i >= totalEmit) {
    return;
  }

  let cmd = command_for_emit(i);
  let local = i - cmd.header.z;
  var p: Particle;
  if (cmd.header.x == 1u) {
    p = emit_rocket(cmd, local);
  } else if (cmd.header.x == 2u) {
    p = emit_trail(cmd, local);
  } else if (cmd.header.x == 3u) {
    p = emit_explosion(cmd, local);
  } else {
    p = emit_accretion_collapse(cmd, local);
  }
  append_particle(p);
}

@compute @workgroup_size(1)
fn finishFrame(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x != 0u) {
    return;
  }
  let live = min(atomicLoad(&counters.write), u32(params.simA.y));
  atomicStore(&counters.live, live);
  drawArgs.vertexCount = 6u;
  drawArgs.instanceCount = live;
  drawArgs.firstVertex = 0u;
  drawArgs.firstInstance = 0u;
  dispatchArgs.x = (live + WG - 1u) / WG;
  dispatchArgs.y = 1u;
  dispatchArgs.z = 1u;
}
