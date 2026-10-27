// Draws the live particle list: one six-vertex billboard per particle,
// stretched along its velocity, added into the HDR target. The instance count
// comes from the indirect draw buffer that finishFrame wrote.

struct Params {
  viewport: vec4f,   // width, height, aspect, image aspect
  timeMouse: vec4f,  // time, dt, mouse x, mouse y
  scene: vec4f,      // parallax strength, depth power, exposure, unused
  launch: vec4f,     // last burst uv (xy), unused
  simA: vec4f,       // seconds since last burst, capacity, gravity, drag
  simB: vec4f,       // wind, curl grid scale, curl strength, shell spin
  renderA: vec4f,    // unused, spark size, rocket size, trail stretch
  renderB: vec4f,    // smoke size, depth occlusion, glow, unused
  systemA: vec4f,    // unused, collapse delay, collapse duration, collapse strength
  systemB: vec4f,    // hash cell size, stickiness, spiral strength, return scatter
  flash: vec4f,      // last burst colour (rgb), unused
}

struct Particle {
  pos: vec2f,
  vel: vec2f,
  color: vec4f,      // rgb, twinkle seed
  ageLife: vec4f,    // age, life, size, kind
  seedLevel: vec4f,  // seed, shell level, depth, hash key
  home: vec4f,       // burst centre (xy), collapse delay, collapse duration
}

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) local: vec2f,
  @location(1) color: vec4f,
  @location(2) ageKind: vec3f,  // age 0..1, kind, stretch
  @location(3) screenUv: vec2f,
  @location(4) particleDepth: f32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> particles: array<Particle>;
@group(0) @binding(2) var depthTex: texture_2d<f32>;
@group(0) @binding(3) var sceneSampler: sampler;

// same crop as the backdrop pass, so the depth lookup lines up with the ridges
fn cover_uv(screenUv: vec2f) -> vec2f {
  let canvasAspect = params.viewport.z;
  let imageAspect = params.viewport.w;
  var uv = screenUv;
  if (canvasAspect > imageAspect) {
    let scale = canvasAspect / imageAspect;
    uv.y = 1.0 - (1.0 - uv.y) / scale;
  } else {
    let scale = imageAspect / canvasAspect;
    uv.x = (uv.x - 0.5) / scale + 0.5;
  }
  return uv;
}

// Positions live in a square-ish space where x and y both run -1..1. Bursts
// are squeezed horizontally about their own centre, so a round shell stays
// round on a wide canvas.
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
    out.ageKind = vec3f(1.0, 0.0, 0.0);
    out.screenUv = vec2f(0.5);
    out.particleDepth = 0.0;
    return out;
  }

  let kind = p.ageLife.w;
  let isSmoke = kind > 3.5 && kind < 4.5;
  let isCollapse = kind > 4.5 && kind < 5.5;
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
  } else if (isCollapse) {
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
  out.local = corner;
  out.color = p.color;
  out.ageKind = vec3f(age01, kind, stretch);
  out.screenUv = vec2f(clipPos.x * 0.5 + 0.5, 0.5 - clipPos.y * 0.5);
  out.particleDepth = p.seedLevel.z;
  return out;
}

@fragment
fn fragment(in: VertexOut) -> @location(0) vec4f {
  let age01 = in.ageKind.x;
  let kind = in.ageKind.y;
  let isSmoke = kind > 3.5 && kind < 4.5;
  let isCollapse = kind > 4.5 && kind < 5.5;
  let local = in.local;
  // In units of the particle's width: x across, y along the velocity, with
  // the head at y = s and the tail trailing back to y = -(1 + s).
  let s = in.ageKind.z;
  let y = local.y * (1.0 + s);
  let head = exp(-(local.x * local.x + (y - s) * (y - s)) * 3.8);
  let tailT = clamp((y + 1.0 + s) / (2.0 * s + 1.0), 0.0, 1.0);
  let tail = exp(-local.x * local.x * 9.0) * tailT * tailT * step(y, s) * 0.75;
  var shape = max(head, tail);
  if (isSmoke) {
    shape = exp(-dot(local, local) * 1.45) * 0.28;
  }

  let twinkle = 0.78 + 0.22 * sin(params.timeMouse.x * 38.0 + in.color.a * 18.0);
  var alpha = shape * pow(1.0 - age01, select(1.45, 0.72, isSmoke)) * twinkle;
  if (isCollapse) {
    let focus = smoothstep(0.48, 0.86, age01) * (1.0 - smoothstep(0.94, 1.0, age01));
    alpha *= 1.12 + focus * 1.9;
  }

  // Hide whatever is behind a ridge. Depth is 0 for the sky and grows toward
  // the nearest ridge; a particle is hidden where the scene is nearer than it.
  let depthUv = clamp(cover_uv(in.screenUv), vec2f(0.001), vec2f(0.999));
  let sceneDepth = pow(textureSample(depthTex, sceneSampler, depthUv).r, params.scene.y);
  let blocked = smoothstep(0.04, 0.22, sceneDepth - in.particleDepth);
  alpha *= 1.0 - params.renderB.y * blocked;

  var color = in.color.rgb * alpha * params.renderB.z;
  // fresh sparks burn white-hot, then cool to their colour
  let hot = select(exp(-age01 * 5.0), 0.0, isSmoke);
  color = mix(color, vec3f(alpha * params.renderB.z), hot * 0.45) * (1.0 + hot * 1.6);
  if (kind < 1.5) {
    color += vec3f(1.0, 0.72, 0.38) * alpha * 0.7;
  } else if (isCollapse) {
    let coreFlash = smoothstep(0.72, 0.9, age01) * (1.0 - smoothstep(0.94, 1.0, age01));
    color += vec3f(0.55, 0.85, 1.0) * alpha * coreFlash * 0.85;
  }
  if (isSmoke) {
    // smoke is lit by the sparks around it, not a light of its own
    color *= 0.35;
  }
  return vec4f(color, alpha);
}
