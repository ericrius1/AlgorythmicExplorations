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

fn segment_distance(p: vec2f, a: vec2f, b: vec2f) -> f32 {
  let pa = p - a;
  let ba = b - a;
  let h = clamp(dot(pa, ba) / max(dot(ba, ba), 0.00001), 0.0, 1.0);
  return length(pa - ba * h);
}

fn cross_marker(p: vec2f, c: vec2f, size: f32) -> f32 {
  let d = abs(p - c);
  let h = 1.0 - smoothstep(0.0, 0.003, min(abs(d.x - size), abs(d.y)));
  let v = 1.0 - smoothstep(0.0, 0.003, min(abs(d.y - size), abs(d.x)));
  let box = step(d.x, size) * step(d.y, size);
  return max(h, v) * box;
}

fn aspect_delta(p: vec2f, c: vec2f) -> vec2f {
  return vec2f((p.x - c.x) * params.viewport.z, p.y - c.y);
}

fn ring_marker(p: vec2f, c: vec2f, radius: f32, width: f32) -> f32 {
  let d = abs(length(aspect_delta(p, c)) - radius);
  return 1.0 - smoothstep(width, width * 2.4, d);
}

fn grid_line(v: f32, cellSize: f32) -> f32 {
  let f = abs(fract(v / max(cellSize, 0.001)) - 0.5);
  return smoothstep(0.47, 0.5, f);
}

@fragment
fn fragment(in: VertexOut) -> @location(0) vec4f {
  let baseUv = cover_uv(in.uv);
  let rawDepth = textureSample(depthTex, sceneSampler, baseUv).r;
  let depth = pow(clamp(rawDepth, 0.0, 1.0), params.scene.y);
  let mouse = params.timeMouse.zw;
  let relDepth = depth - 0.36;
  let offset = vec2f(mouse.x, -mouse.y * 0.36) * params.scene.x * relDepth;
  let uv = clamp(baseUv + offset, vec2f(0.001), vec2f(0.999));

  var color = textureSample(backdropTex, sceneSampler, uv).rgb * params.scene.z;
  let vignette = smoothstep(0.92, 0.18, length(in.uv - vec2f(0.5)));
  color *= mix(0.62, 1.04, vignette);

  if (params.renderB.w > 0.5) {
    color = vec3f(depth);
  }

  if (params.scene.w > 0.5) {
    let contour = 1.0 - smoothstep(0.008, 0.018, abs(fract(depth * 11.0) - 0.5));
    let grid = max(
      1.0 - smoothstep(0.0, 0.002, abs(fract(in.uv.x * 16.0) - 0.5)),
      1.0 - smoothstep(0.0, 0.002, abs(fract(in.uv.y * 9.0) - 0.5))
    ) * 0.24;
    color = mix(color, vec3f(0.12, 0.54, 1.0), contour * 0.28 + grid);

    let launchAge = params.simA.x;
    if (launchAge < 3.0) {
      let fade = 1.0 - smoothstep(0.0, 3.0, launchAge);
      let a = params.launch.xy;
      let b = params.launch.zw;
      let line = 1.0 - smoothstep(0.002, 0.008, segment_distance(in.uv, a, b));
      let start = cross_marker(in.uv, a, 0.018);
      let burstMark = cross_marker(in.uv, b, 0.024);
      color += vec3f(0.2, 0.92, 1.0) * (line * 0.42 + start + burstMark) * fade;
    }
  }

  let launchAge = params.simA.x;
  if (params.systemA.x > 0.5 && launchAge < 5.0) {
    let center = params.launch.zw;
    let rel = aspect_delta(in.uv, center);
    let fade = 1.0 - smoothstep(4.1, 5.0, launchAge);
    let collapse01 = clamp((launchAge - params.systemA.y) / max(params.systemA.z, 0.001), 0.0, 1.0);

    if (params.debugA.x > 0.5) {
      let extent = 0.36;
      let mask = 1.0 - smoothstep(extent, extent + 0.035, max(abs(rel.x), abs(rel.y)));
      let grid = max(grid_line(rel.x, params.systemB.x), grid_line(rel.y, params.systemB.x)) * mask;
      color += vec3f(0.08, 0.72, 1.0) * grid * 0.34 * fade;
    }

    if (params.debugA.z > 0.5) {
      let shells = max(params.debugA.w, 1.0);
      let shellCoord = length(rel) / 0.32 * shells;
      let shellLine = 1.0 - smoothstep(0.0, 0.055, abs(fract(shellCoord) - 0.5));
      color += vec3f(0.95, 0.42, 1.0) * shellLine * 0.28 * fade;
    }

    if (params.debugA.y > 0.5) {
      let radius = mix(0.28, 0.026, smoothstep(0.0, 1.0, collapse01));
      let pull = ring_marker(in.uv, center, radius, 0.004);
      let core = ring_marker(in.uv, center, 0.024, 0.003);
      color += vec3f(0.35, 1.0, 0.82) * (pull * 0.55 + core * 0.7) * fade;
    }
  }

  return vec4f(color, 1.0);
}
