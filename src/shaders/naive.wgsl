// Direct O(n²) summation with workgroup-shared tiling.
// One thread per body; the workgroup cooperatively stages 256 bodies at a
// time in fast shared memory so each position is fetched from global memory
// once per workgroup instead of once per thread.

struct SimParams {
  count: u32,
  dt: f32,
  g: f32,
  softening: f32,
}

@group(0) @binding(0) var<uniform> P: SimParams;
@group(0) @binding(1) var<storage, read> inBodies: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> outBodies: array<vec4f>;
@group(0) @binding(3) var<storage, read> mass: array<f32>;

const TILE: u32 = 256u;
var<workgroup> shared_pos: array<vec3f, 256>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u, @builtin(local_invocation_id) lid: vec3u) {
  let i = gid.x;
  let valid = i < P.count;
  var pos = vec2f(0.0);
  var vel = vec2f(0.0);
  if (valid) {
    let b = inBodies[i];
    pos = b.xy;
    vel = b.zw;
  }

  var acc = vec2f(0.0);
  let eps2 = P.softening * P.softening;
  let tiles = (P.count + TILE - 1u) / TILE;

  for (var t: u32 = 0u; t < tiles; t = t + 1u) {
    let j = t * TILE + lid.x;
    if (j < P.count) {
      shared_pos[lid.x] = vec3f(inBodies[j].xy, mass[j]);
    } else {
      shared_pos[lid.x] = vec3f(0.0);
    }
    workgroupBarrier();
    for (var k: u32 = 0u; k < TILE; k = k + 1u) {
      let o = shared_pos[k];
      let d = o.xy - pos;
      let r2 = dot(d, d) + eps2;
      acc = acc + d * (P.g * o.z / (r2 * sqrt(r2)));
    }
    workgroupBarrier();
  }

  if (valid) {
    vel = vel + acc * P.dt;
    outBodies[i] = vec4f(pos + vel * P.dt, vel);
  }
}
