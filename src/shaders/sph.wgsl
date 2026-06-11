// Smoothed-particle hydrodynamics on a grid-sorted particle buffer.
// Two neighbour passes: density (sum overlapping kernels), then force
// (pressure + near-pressure + XSPH smoothing) with in-place integration.
// Kernel support radius equals one grid cell, so 3×3 cells cover it.

struct SphParams {
  count: u32,
  grid: u32,
  cell: f32,
  dt: f32,
  gravity: f32,
  stiffness: f32,
  restDensity: f32,
  nearStiffness: f32,
  xsph: f32,
  wallK: f32,
  mouseRadius: f32,
  mouseStrength: f32,
  mouse: vec2f,
  mouseVel: vec2f,
  wall: vec2f, // half-extent of the box: |x| < wall.x, wall.y is the floor/top
  _pad: vec2f,
}

@group(0) @binding(0) var<uniform> SP: SphParams;
@group(0) @binding(1) var<storage, read_write> parts: array<vec4f>;
@group(0) @binding(2) var<storage, read> cellStart: array<u32>;
@group(0) @binding(3) var<storage, read> cellCount: array<u32>;
@group(0) @binding(4) var<storage, read_write> density: array<vec2f>;

fn cellCoord(p: vec2f) -> vec2i {
  let g = f32(SP.grid);
  return vec2i(
    i32(clamp((p.x + 1.0) * 0.5 * g, 0.0, g - 1.0)),
    i32(clamp((p.y + 1.0) * 0.5 * g, 0.0, g - 1.0)),
  );
}

@compute @workgroup_size(256)
fn densityPass(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= SP.count) { return; }
  let pi = parts[i].xy;
  let h = SP.cell;
  let cc = cellCoord(pi);
  var rho = 0.0;
  var rhoNear = 0.0;
  for (var oy = -1; oy <= 1; oy++) {
    for (var ox = -1; ox <= 1; ox++) {
      let c = cc + vec2i(ox, oy);
      if (c.x < 0 || c.y < 0 || c.x >= i32(SP.grid) || c.y >= i32(SP.grid)) { continue; }
      let ci = u32(c.y) * SP.grid + u32(c.x);
      let s = cellStart[ci];
      let n = cellCount[ci];
      for (var k = s; k < s + n; k++) {
        let q = length(parts[k].xy - pi) / h;
        if (q < 1.0) {
          let w = 1.0 - q;
          rho += w * w;
          rhoNear += w * w * w;
        }
      }
    }
  }
  density[i] = vec2f(rho, rhoNear);
}

@compute @workgroup_size(256)
fn forcePass(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= SP.count) { return; }
  var p = parts[i];
  let h = SP.cell;
  let di = density[i];
  let pressI = SP.stiffness * (di.x - SP.restDensity);
  let nearI = SP.nearStiffness * di.y;
  let cc = cellCoord(p.xy);

  var acc = vec2f(0.0, -SP.gravity);
  var dv = vec2f(0.0);
  for (var oy = -1; oy <= 1; oy++) {
    for (var ox = -1; ox <= 1; ox++) {
      let c = cc + vec2i(ox, oy);
      if (c.x < 0 || c.y < 0 || c.x >= i32(SP.grid) || c.y >= i32(SP.grid)) { continue; }
      let ci = u32(c.y) * SP.grid + u32(c.x);
      let s = cellStart[ci];
      let n = cellCount[ci];
      for (var k = s; k < s + n; k++) {
        if (k == i) { continue; }
        let d = parts[k].xy - p.xy;
        let r = length(d);
        let q = r / h;
        if (q < 1.0 && r > 1e-7) {
          let dj = density[k];
          let press = 0.5 * (pressI + SP.stiffness * (dj.x - SP.restDensity));
          let near = 0.5 * (nearI + SP.nearStiffness * dj.y);
          let w = 1.0 - q;
          acc -= (d / r) * (press * w + near * w * w);
          dv += (parts[k].zw - p.zw) * w;
        }
      }
    }
  }

  // stirring: cursor drags nearby fluid along its own velocity
  let md = p.xy - SP.mouse;
  let mr = length(md);
  if (mr < SP.mouseRadius) {
    acc += SP.mouseVel * SP.mouseStrength * (1.0 - mr / SP.mouseRadius);
  }

  // the box is three penalty springs, exactly the dome trick from part two
  if (p.x < -SP.wall.x) { acc.x += (-SP.wall.x - p.x) * SP.wallK; }
  if (p.x > SP.wall.x) { acc.x -= (p.x - SP.wall.x) * SP.wallK; }
  if (p.y < -SP.wall.y) { acc.y += (-SP.wall.y - p.y) * SP.wallK; }
  if (p.y > 0.95) { acc.y -= (p.y - 0.95) * SP.wallK; }

  var vel = (p.zw + acc * SP.dt) * 0.9998;
  vel += dv * SP.xsph;
  let speed = length(vel);
  if (speed > 3.0) { vel *= 3.0 / speed; } // CFL safety valve
  parts[i] = vec4f(p.xy + vel * SP.dt, vel);
}
