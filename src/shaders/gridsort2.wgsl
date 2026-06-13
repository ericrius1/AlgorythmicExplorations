// Part three's counting sort, widened to a 32-byte particle: position and
// velocity in one vec4, auxiliary state (temperature, …) in a second. The
// scatter copies both, so a particle's heat travels with it through the sort.

struct Particle2 {
  pv: vec4f,  // pos.xy, vel.zw
  aux: vec4f, // temp in x, rest free
}

struct GridParams {
  count: u32,
  grid: u32,
  _pad0: u32,
  _pad1: u32,
}

@group(0) @binding(0) var<uniform> GP: GridParams;
@group(0) @binding(1) var<storage, read> partsIn: array<Particle2>;
@group(0) @binding(2) var<storage, read_write> counts: array<atomic<u32>>;
@group(0) @binding(3) var<storage, read_write> starts: array<u32>;
@group(0) @binding(4) var<storage, read_write> blockSums: array<u32>;
@group(0) @binding(5) var<storage, read_write> cursor: array<atomic<u32>>;
@group(0) @binding(6) var<storage, read_write> sorted: array<Particle2>;

fn cellOf(p: vec2f) -> u32 {
  let g = f32(GP.grid);
  let cx = u32(clamp((p.x + 1.0) * 0.5 * g, 0.0, g - 1.0));
  let cy = u32(clamp((p.y + 1.0) * 0.5 * g, 0.0, g - 1.0));
  return cy * GP.grid + cx;
}

// ---- pass 1: histogram -----------------------------------------------------

@compute @workgroup_size(256)
fn count(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= GP.count) { return; }
  atomicAdd(&counts[cellOf(partsIn[gid.x].pv.xy)], 1u);
}

// ---- pass 2: prefix sum (identical to gridsort.wgsl) -----------------------

var<workgroup> sa: array<u32, 256>;
var<workgroup> sb: array<u32, 256>;

fn scanShared(lid: u32) -> u32 {
  var fromA = true;
  var d = 1u;
  loop {
    if (d >= 256u) { break; }
    if (fromA) {
      var v = sa[lid];
      if (lid >= d) { v += sa[lid - d]; }
      sb[lid] = v;
    } else {
      var v = sb[lid];
      if (lid >= d) { v += sb[lid - d]; }
      sa[lid] = v;
    }
    workgroupBarrier();
    fromA = !fromA;
    d = d << 1u;
  }
  return sa[lid];
}

@compute @workgroup_size(256)
fn scan_blocks(
  @builtin(global_invocation_id) gid: vec3u,
  @builtin(local_invocation_id) lid: vec3u,
  @builtin(workgroup_id) wid: vec3u,
) {
  let v0 = atomicLoad(&counts[gid.x]);
  sa[lid.x] = v0;
  workgroupBarrier();
  let inclusive = scanShared(lid.x);
  starts[gid.x] = inclusive - v0;
  if (lid.x == 255u) { blockSums[wid.x] = inclusive; }
}

@compute @workgroup_size(256)
fn scan_sums(@builtin(local_invocation_id) lid: vec3u) {
  let v0 = blockSums[lid.x];
  sa[lid.x] = v0;
  workgroupBarrier();
  let inclusive = scanShared(lid.x);
  blockSums[lid.x] = inclusive - v0;
}

@compute @workgroup_size(256)
fn scan_add(
  @builtin(global_invocation_id) gid: vec3u,
  @builtin(workgroup_id) wid: vec3u,
) {
  let start = starts[gid.x] + blockSums[wid.x];
  starts[gid.x] = start;
  atomicStore(&cursor[gid.x], start);
}

// ---- pass 3: scatter --------------------------------------------------------

@compute @workgroup_size(256)
fn scatter(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= GP.count) { return; }
  let p = partsIn[gid.x];
  let slot = atomicAdd(&cursor[cellOf(p.pv.xy)], 1u);
  sorted[slot] = p;
}
