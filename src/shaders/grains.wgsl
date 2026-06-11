// Granular contacts on a grid-sorted particle buffer: one neighbour pass.
// Each grain is a disc of radius cell/2, so touching pairs are always in
// the same or adjacent cells. Spring-dashpot contact, then integrate.

struct GrainParams {
  count: u32,
  grid: u32,
  cell: f32,
  dt: f32,
  gravity: f32,
  stiffness: f32,
  damping: f32,
  _pad0: f32,
  _pad1: f32,
  wallK: f32,
  mouseRadius: f32,
  mouseStrength: f32,
  mouse: vec2f,
  mouseVel: vec2f,
  wall: vec2f,
  _pad2: vec2f,
}

@group(0) @binding(0) var<uniform> SP: GrainParams;
@group(0) @binding(1) var<storage, read_write> parts: array<vec4f>;
@group(0) @binding(2) var<storage, read> cellStart: array<u32>;
@group(0) @binding(3) var<storage, read> cellCount: array<u32>;
@group(0) @binding(4) var<storage, read_write> density: array<vec2f>; // unused; layout shared with sph

fn cellCoord(p: vec2f) -> vec2i {
  let g = f32(SP.grid);
  return vec2i(
    i32(clamp((p.x + 1.0) * 0.5 * g, 0.0, g - 1.0)),
    i32(clamp((p.y + 1.0) * 0.5 * g, 0.0, g - 1.0)),
  );
}

@compute @workgroup_size(256)
fn forcePass(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= SP.count) { return; }
  var p = parts[i];
  let dia = SP.cell;
  let cc = cellCoord(p.xy);

  var acc = vec2f(0.0, -SP.gravity);
  for (var oy = -1; oy <= 1; oy++) {
    for (var ox = -1; ox <= 1; ox++) {
      let c = cc + vec2i(ox, oy);
      if (c.x < 0 || c.y < 0 || c.x >= i32(SP.grid) || c.y >= i32(SP.grid)) { continue; }
      let ci = u32(c.y) * SP.grid + u32(c.x);
      let s = cellStart[ci];
      let n = cellCount[ci];
      for (var k = s; k < s + n; k++) {
        if (k == i) { continue; }
        let d = p.xy - parts[k].xy;
        let r = length(d);
        if (r < dia && r > 1e-7) {
          let nrm = d / r;
          acc += nrm * (dia - r) * SP.stiffness;            // spring: push apart
          let vn = dot(p.zw - parts[k].zw, nrm);
          acc -= nrm * vn * SP.damping;                     // dashpot: kill bounce
        }
      }
    }
  }

  let md = p.xy - SP.mouse;
  let mr = length(md);
  if (mr < SP.mouseRadius) {
    acc += SP.mouseVel * SP.mouseStrength * (1.0 - mr / SP.mouseRadius);
  }

  if (p.x < -SP.wall.x) { acc.x += (-SP.wall.x - p.x) * SP.wallK; }
  if (p.x > SP.wall.x) { acc.x -= (p.x - SP.wall.x) * SP.wallK; }
  if (p.y < -SP.wall.y) { acc.y += (-SP.wall.y - p.y) * SP.wallK; }
  if (p.y > 0.95) { acc.y -= (p.y - 0.95) * SP.wallK; }

  var vel = (p.zw + acc * SP.dt) * 0.999;
  let speed = length(vel);
  if (speed > 3.0) { vel *= 3.0 / speed; }
  parts[i] = vec4f(p.xy + vel * SP.dt, vel);
}
