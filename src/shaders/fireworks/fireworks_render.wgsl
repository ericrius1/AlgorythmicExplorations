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

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) local: vec2f,
  @location(1) color: vec4f,
  @location(2) ageKind: vec2f,
  @location(3) screenUv: vec2f,
  @location(4) particleDepth: f32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> particles: array<Particle>;
@group(0) @binding(2) var depthTex: texture_2d<f32>;
@group(0) @binding(3) var sceneSampler: sampler;

fn cover_uv(screenUv: vec2f) -> vec2f {
  let canvasAspect = params.viewport.z;
  let imageAspect = params.viewport.w;
  var uv = screenUv;
  if (canvasAspect > imageAspect) {
    let scale = canvasAspect / imageAspect;
    uv.y = (uv.y - 0.5) / scale + 0.5;
  } else {
    let scale = imageAspect / canvasAspect;
    uv.x = (uv.x - 0.5) / scale + 0.5;
  }
  return uv;
}

fn aspect_corrected_particle_pos(pos: vec2f, anchor: vec2f) -> vec2f {
  let aspect = max(params.viewport.z, 0.001);
  return vec2f(anchor.x + (pos.x - anchor.x) / aspect, pos.y);
}

@vertex
fn vertex(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> VertexOut {
  let corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0),
    vec2f(1.0, -1.0),
    vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0),
    vec2f(1.0, -1.0),
    vec2f(1.0, 1.0)
  );

  let p = particles[instanceIndex];
  let corner = corners[vertexIndex];
  var out: VertexOut;

  if (p.ageLife.y <= 0.0) {
    out.position = vec4f(2.0, 2.0, 0.0, 1.0);
    out.local = corner;
    out.color = vec4f(0.0);
    out.ageKind = vec2f(1.0, 0.0);
    out.screenUv = vec2f(0.5);
    out.particleDepth = 0.0;
    return out;
  }

  let kind = p.ageLife.w;
  let isSmoke = kind > 3.5 && kind < 4.5;
  let isAccretion = kind > 4.5 && kind < 5.5;
  let age01 = clamp(p.ageLife.x / max(p.ageLife.y, 0.0001), 0.0, 1.0);
  let speed = length(p.vel);
  var dir = vec2f(0.0, 1.0);
  if (speed > 0.0001) {
    dir = p.vel / speed;
  }
  let side = vec2f(-dir.y, dir.x);

  var globalSize = params.renderA.y;
  var stretch = params.renderA.w * clamp(speed * 0.65, 0.0, 1.5);
  if (kind < 1.5) {
    globalSize = params.renderA.z;
    stretch *= 1.9;
  } else if (isSmoke) {
    globalSize = params.renderB.x;
    stretch = 0.12;
  } else if (isAccretion) {
    globalSize = params.renderA.y * 1.35;
    stretch *= 1.45;
  }

  let fadeShrink = mix(1.0, 0.25, age01);
  let width = p.ageLife.z * globalSize * fadeShrink;
  let lengthScale = width * (1.0 + stretch);
  var pos = p.pos + side * corner.x * width + dir * corner.y * lengthScale;
  pos.x += params.timeMouse.z * params.scene.x * (p.seedLevel.z - 0.36) * 0.42;
  let clipPos = aspect_corrected_particle_pos(pos, p.home.xy);

  out.position = vec4f(clipPos, 0.0, 1.0);
  out.local = vec2f(corner.x, corner.y / max(1.0 + stretch, 1.0));
  out.color = p.color;
  out.ageKind = vec2f(age01, kind);
  out.screenUv = vec2f(clipPos.x * 0.5 + 0.5, 0.5 - clipPos.y * 0.5);
  out.particleDepth = p.seedLevel.z;
  return out;
}

@fragment
fn fragment(in: VertexOut) -> @location(0) vec4f {
  let age01 = in.ageKind.x;
  let kind = in.ageKind.y;
  let isSmoke = kind > 3.5 && kind < 4.5;
  let isAccretion = kind > 4.5 && kind < 5.5;
  let local = in.local;
  let core = exp(-dot(local, local) * 3.8);
  let streak = exp(-(local.x * local.x * 7.0 + abs(local.y) * 1.25));
  var shape = max(core * 0.85, streak);
  if (isSmoke) {
    shape = exp(-dot(local, local) * 1.45) * 0.28;
  }

  let twinkle = 0.78 + 0.22 * sin(params.timeMouse.x * 38.0 + in.color.a * 18.0);
  var alpha = shape * pow(1.0 - age01, select(1.45, 0.72, isSmoke)) * twinkle;
  if (isAccretion) {
    let focus = smoothstep(0.48, 0.86, age01) * (1.0 - smoothstep(0.94, 1.0, age01));
    alpha *= 1.12 + focus * 1.9;
  }

  let depthUv = clamp(cover_uv(in.screenUv), vec2f(0.001), vec2f(0.999));
  let sceneDepth = pow(textureSample(depthTex, sceneSampler, depthUv).r, params.scene.y);
  let blocked = smoothstep(0.04, 0.22, sceneDepth - in.particleDepth);
  alpha *= 1.0 - params.renderB.y * blocked;

  var color = in.color.rgb * alpha * params.renderB.z;
  if (kind < 1.5) {
    color += vec3f(1.0, 0.72, 0.38) * alpha * 0.7;
  } else if (isAccretion) {
    let coreFlash = smoothstep(0.72, 0.9, age01) * (1.0 - smoothstep(0.94, 1.0, age01));
    color += vec3f(0.55, 0.85, 1.0) * alpha * coreFlash * 0.85;
  }
  return vec4f(color, alpha);
}
