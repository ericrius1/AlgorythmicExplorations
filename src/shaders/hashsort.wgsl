// Counting sort over a *hashed* grid: same histogram / scan / scatter as
// gridsort.wgsl, but the cell index is a hash of the (unbounded) integer
// cell coordinates instead of a position inside a fixed box. Distant cells
// occasionally share a bucket; the force pass's distance test rejects the
// impostors, so the sort doesn't care.

struct HashParams {
  count: u32,
  _pad0: u32,
  cellSize: f32,
  _pad1: f32,
}

override TABLE: u32 = 65536u; // buckets; power of two so modulo is a mask
override FOLD: u32 = 1u;      // block sums owned by each scan_sums thread

@group(0) @binding(0) var<uniform> GP: HashParams;
@group(0) @binding(1) var<storage, read> partsIn: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> counts: array<atomic<u32>>;
@group(0) @binding(3) var<storage, read_write> starts: array<u32>;
@group(0) @binding(4) var<storage, read_write> blockSums: array<u32>;
@group(0) @binding(5) var<storage, read_write> cursor: array<atomic<u32>>;
@group(0) @binding(6) var<storage, read_write> sorted: array<vec4f>;

// Two large odd constants, one per axis; u32 multiply wraps, which is the
// mixing we want. Must match the copy in accretion.wgsl exactly.
fn bucketOf(c: vec2i) -> u32 {
  let h = (u32(c.x) * 0x9E3779B1u) ^ (u32(c.y) * 0x85EBCA77u);
  return h & (TABLE - 1u);
}

fn cellOf(p: vec2f) -> u32 {
  return bucketOf(vec2i(floor(p / GP.cellSize)));
}

// ---- pass 1: histogram -----------------------------------------------------

@compute @workgroup_size(256)
fn count(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= GP.count) { return; }
  atomicAdd(&counts[cellOf(partsIn[gid.x].xy)], 1u);
}

// ---- pass 2: prefix sum (identical to the boxed version) -------------------

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
  let base = lid.x * FOLD;
  var total = 0u;
  for (var j = 0u; j < FOLD; j++) {
    total += blockSums[base + j];
  }
  sa[lid.x] = total;
  workgroupBarrier();
  let inclusive = scanShared(lid.x);
  var run = inclusive - total;
  for (var j = 0u; j < FOLD; j++) {
    let v = blockSums[base + j];
    blockSums[base + j] = run;
    run += v;
  }
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

// ---- pass 3: scatter into bucket order --------------------------------------

@compute @workgroup_size(256)
fn scatter(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= GP.count) { return; }
  let p = partsIn[gid.x];
  let slot = atomicAdd(&cursor[cellOf(p.xy)], 1u);
  sorted[slot] = p;
}
