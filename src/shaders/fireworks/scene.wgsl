// The painted backdrop behind the fireworks: a sky and three mountain ridges,
// drawn once into a texture on the CPU, plus a matching depth texture
// (0 = far sky, 1 = nearest ridge). This pass shifts the layers against each
// other with the pointer for a little parallax, and lets the most recent burst
// light up the sky around it. Output is linear light into the HDR target.

struct Params {
  viewport: vec4f,   // width, height, aspect, image aspect
  timeMouse: vec4f,  // time, dt, mouse x, mouse y
  scene: vec4f,      // parallax strength, depth power, exposure, unused
  launch: vec4f,     // last burst uv (xy), last burst colour hue (z), unused
  simA: vec4f,       // seconds since last burst, capacity, gravity, drag
  simB: vec4f,       // wind, curl grid scale, curl strength, shell spin
  renderA: vec4f,    // unused, spark size, rocket size, trail stretch
  renderB: vec4f,    // smoke size, depth occlusion, glow, unused
  systemA: vec4f,    // unused, collapse delay, collapse duration, collapse strength
  systemB: vec4f,    // hash cell size, stickiness, spiral strength, return scatter
  flash: vec4f,      // last burst colour (rgb), unused
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var backdropTex: texture_2d<f32>;
@group(0) @binding(2) var depthTex: texture_2d<f32>;
@group(0) @binding(3) var sceneSampler: sampler;

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn vertex(@builtin(vertex_index) vertexIndex: u32) -> VertexOut {
  var positions = array<vec2f, 3>(
    vec2f(-1.0, -1.0),
    vec2f(3.0, -1.0),
    vec2f(-1.0, 3.0)
  );
  let pos = positions[vertexIndex];
  var out: VertexOut;
  out.position = vec4f(pos, 0.0, 1.0);
  out.uv = vec2f(pos.x * 0.5 + 0.5, 0.5 - pos.y * 0.5);
  return out;
}

// The backdrop is drawn at 16:9. Crop it to cover the canvas, keeping the
// bottom edge (the mountains) anchored when the canvas is wider.
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

@fragment
fn fragment(in: VertexOut) -> @location(0) vec4f {
  let baseUv = cover_uv(in.uv);
  let depth = pow(clamp(textureSample(depthTex, sceneSampler, baseUv).r, 0.0, 1.0), params.scene.y);
  let mouse = params.timeMouse.zw;
  // near layers slide one way, the sky the other
  let offset = vec2f(mouse.x, -mouse.y * 0.36) * params.scene.x * (depth - 0.36);
  let uv = clamp(baseUv + offset, vec2f(0.001), vec2f(0.999));

  // the texture is rgba8unorm-srgb, so this sample is already linear
  var color = textureSample(backdropTex, sceneSampler, uv).rgb * params.scene.z;

  // the newest burst lights the sky around it, and the ridge tops a little
  let age = params.simA.x;
  if (age < 3.0) {
    let d = (in.uv - params.launch.xy) * vec2f(params.viewport.z, 1.0);
    let falloff = exp(-dot(d, d) * 7.0);
    let fade = exp(-age * 3.0) * (1.0 - exp(-age * 30.0));
    let sky = 1.0 - smoothstep(0.25, 0.6, depth);
    color += params.flash.rgb * falloff * fade * 0.03 * (0.5 + sky);
  }
  return vec4f(color, 1.0);
}
