// The counting sort, promoted to three dimensions and a 64-byte particle:
// position, velocity, magnetic moment, and cached magnetic acceleration each
// ride in their own vec4 lane, and the scatter carries all four. Same
// histogram / scan / scatter as gridsort2.wgsl; the only structural change is
// that 64³ = 262,144 cells produce 1,024 scan blocks, so the block-sum scan
// has each of its 256 threads fold four blocks instead of one.

struct Particle3 {
  pos: vec4f, // xyz, w spare
  vel: vec4f, // xyz, w spare
  mom: vec4f, // magnetic moment xyz
  acc: vec4f, // cached magnetic acceleration xyz
}

struct GridParams {
  count: u32,
  grid: u32,
  _pad0: u32,
  _pad1: u32,
}

@group(0) @binding(0) var<uniform> GP: GridParams;
@group(0) @binding(1) var<storage, read> partsIn: array<Particle3>;
@group(0) @binding(2) var<storage, read_write> counts: array<atomic<u32>>;
@group(0) @binding(3) var<storage, read_write> starts: array<u32>;
@group(0) @binding(4) var<storage, read_write> blockSums: array<u32>;
@group(0) @binding(5) var<storage, read_write> cursor: array<atomic<u32>>;
@group(0) @binding(6) var<storage, read_write> sorted: array<Particle3>;

fn cellOf(p: vec3f) -> u32 {
  let g = f32(GP.grid);
  let cx = u32(clamp((p.x + 1.0) * 0.5 * g, 0.0, g - 1.0));
  let cy = u32(clamp((p.y + 1.0) * 0.5 * g, 0.0, g - 1.0));
  let cz = u32(clamp((p.z + 1.0) * 0.5 * g, 0.0, g - 1.0));
  return (cz * GP.grid + cy) * GP.grid + cx;
}

// ---- pass 1: histogram -----------------------------------------------------

@compute @workgroup_size(256)
fn count(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= GP.count) { return; }
  atomicAdd(&counts[cellOf(partsIn[gid.x].pos.xyz)], 1u);
}

// ---- pass 2: prefix sum ------------------------------------------------------

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

// 1,024 block sums, 256 threads: each thread owns four consecutive blocks —
// fold them, scan the folded totals, then unfold serially within the four.
@compute @workgroup_size(256)
fn scan_sums(@builtin(local_invocation_id) lid: vec3u) {
  let base = lid.x * 4u;
  let b0 = blockSums[base];
  let b1 = blockSums[base + 1u];
  let b2 = blockSums[base + 2u];
  let b3 = blockSums[base + 3u];
  let v0 = b0 + b1 + b2 + b3;
  sa[lid.x] = v0;
  workgroupBarrier();
  let inclusive = scanShared(lid.x);
  var run = inclusive - v0;
  blockSums[base] = run;
  run += b0;
  blockSums[base + 1u] = run;
  run += b1;
  blockSums[base + 2u] = run;
  run += b2;
  blockSums[base + 3u] = run;
}

@compute @workgroup_size(256)
fn scan_add(
  @builtin(global_invocation_id) gid: vec3u,
  @builtin(workgroup_id) wid: vec3u,
) {
  starts[gid.x] = starts[gid.x] + blockSums[wid.x];
}

// ---- pass 3: scatter ----------------------------------------------------------

@compute @workgroup_size(256)
fn scatter(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= GP.count) { return; }
  let p = partsIn[gid.x];
  let slot = atomicAdd(&cursor[cellOf(p.pos.xyz)], 1u);
  sorted[slot] = p;
}
