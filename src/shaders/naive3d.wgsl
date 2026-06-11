// The part-one tiled O(n²) kernel, in 3D. Mass rides in pos.w, so a tile is
// a single vec4 per body: position and mass in one fetch.

struct SimParams {
  count: u32,
  dt: f32,
  g: f32,
  softening: f32,
}

@group(0) @binding(0) var<uniform> P: SimParams;
@group(0) @binding(1) var<storage, read> inPos: array<vec4f>;
@group(0) @binding(2) var<storage, read> inVel: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> outPos: array<vec4f>;
@group(0) @binding(4) var<storage, read_write> outVel: array<vec4f>;

const TILE: u32 = 256u;
var<workgroup> tile: array<vec4f, 256>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u, @builtin(local_invocation_id) lid: vec3u) {
  let i = gid.x;
  let valid = i < P.count;
  var p = vec4f(0.0);
  var v = vec3f(0.0);
  if (valid) {
    p = inPos[i];
    v = inVel[i].xyz;
  }

  var acc = vec3f(0.0);
  let eps2 = P.softening * P.softening;
  let tiles = (P.count + TILE - 1u) / TILE;

  for (var t: u32 = 0u; t < tiles; t = t + 1u) {
    let j = t * TILE + lid.x;
    if (j < P.count) {
      tile[lid.x] = inPos[j];
    } else {
      tile[lid.x] = vec4f(0.0);
    }
    workgroupBarrier();
    for (var k: u32 = 0u; k < TILE; k = k + 1u) {
      let o = tile[k];
      let d = o.xyz - p.xyz;
      let r2 = dot(d, d) + eps2;
      acc = acc + d * (P.g * o.w / (r2 * sqrt(r2)));
    }
    workgroupBarrier();
  }

  if (valid) {
    v = v + acc * P.dt;
    outPos[i] = vec4f(p.xyz + v * P.dt, p.w);
    outVel[i] = vec4f(v, 0.0);
  }
}
