// Pure WebGPU SGEMM kernels for Small Minds:
// 1) naive global-memory matmul (for Part 1 roofline comparison)
// 2) 16x16 workgroup-tiled shared-memory SGEMM: A @ B, A @ B^T, A^T @ B, plus accumulate variants.
// All matrices are row-major f32.

struct MatmulDims {
  M: u32,
  N: u32,
  K: u32,
  alpha: f32, // 0.0 => overwrite C, 1.0 => accumulate into C
};

@group(0) @binding(0) var<uniform> dims: MatmulDims;
@group(0) @binding(1) var<storage, read> A: array<f32>;
@group(0) @binding(2) var<storage, read> B: array<f32>;
@group(0) @binding(3) var<storage, read_write> C: array<f32>;

const TILE: u32 = 16u;

// ---- 1. Naive global-memory C = A[M,K] @ B[K,N] ----------------------------
@compute @workgroup_size(16, 16)
fn matmul_naive(@builtin(global_invocation_id) gid: vec3<u32>) {
  let row = gid.y;
  let col = gid.x;
  if (row >= dims.M || col >= dims.N) { return; }

  var acc: f32 = 0.0;
  for (var k: u32 = 0u; k < dims.K; k = k + 1u) {
    acc = fma(A[row * dims.K + k], B[k * dims.N + col], acc);
  }
  let idx = row * dims.N + col;
  C[idx] = select(acc, C[idx] + acc, dims.alpha > 0.5);
}

// ---- 2. Tiled shared-memory C = A[M,K] @ B[K,N] ----------------------------
var<workgroup> tileA: array<f32, 256>;
var<workgroup> tileB: array<f32, 256>;

@compute @workgroup_size(16, 16)
fn matmul_tiled(
  @builtin(global_invocation_id) gid: vec3<u32>,
  @builtin(local_invocation_id) lid: vec3<u32>,
) {
  let row = gid.y;
  let col = gid.x;
  let lx = lid.x;
  let ly = lid.y;

  var acc: f32 = 0.0;
  let numTiles = (dims.K + TILE - 1u) / TILE;

  for (var t: u32 = 0u; t < numTiles; t = t + 1u) {
    let aCol = t * TILE + lx;
    let bRow = t * TILE + ly;

    var aVal: f32 = 0.0;
    if (row < dims.M && aCol < dims.K) {
      aVal = A[row * dims.K + aCol];
    }
    var bVal: f32 = 0.0;
    if (bRow < dims.K && col < dims.N) {
      bVal = B[bRow * dims.N + col];
    }

    tileA[ly * TILE + lx] = aVal;
    tileB[ly * TILE + lx] = bVal;
    workgroupBarrier();

    for (var k: u32 = 0u; k < TILE; k = k + 1u) {
      acc = fma(tileA[ly * TILE + k], tileB[k * TILE + lx], acc);
    }
    workgroupBarrier();
  }

  if (row < dims.M && col < dims.N) {
    let idx = row * dims.N + col;
    C[idx] = select(acc, C[idx] + acc, dims.alpha > 0.5);
  }
}

// ---- 3. Tiled C[M,N] = A[M,K] @ B[N,K]^T -----------------------------------
@compute @workgroup_size(16, 16)
fn matmul_nt(
  @builtin(global_invocation_id) gid: vec3<u32>,
  @builtin(local_invocation_id) lid: vec3<u32>,
) {
  let row = gid.y;
  let col = gid.x;
  let lx = lid.x;
  let ly = lid.y;

  var acc: f32 = 0.0;
  let numTiles = (dims.K + TILE - 1u) / TILE;

  for (var t: u32 = 0u; t < numTiles; t = t + 1u) {
    let kA = t * TILE + lx;
    let kB = t * TILE + ly;

    var aVal: f32 = 0.0;
    if (row < dims.M && kA < dims.K) {
      aVal = A[row * dims.K + kA];
    }
    // B is [N, K], we want B[col, kB]
    var bVal: f32 = 0.0;
    if (col < dims.N && kB < dims.K) {
      bVal = B[col * dims.K + kB];
    }

    tileA[ly * TILE + lx] = aVal;
    tileB[ly * TILE + lx] = bVal;
    workgroupBarrier();

    for (var k: u32 = 0u; k < TILE; k = k + 1u) {
      acc = fma(tileA[ly * TILE + k], tileB[k * TILE + lx], acc);
    }
    workgroupBarrier();
  }

  if (row < dims.M && col < dims.N) {
    let idx = row * dims.N + col;
    C[idx] = select(acc, C[idx] + acc, dims.alpha > 0.5);
  }
}

// ---- 4. Tiled C[M,N] = A[K,M]^T @ B[K,N] -----------------------------------
@compute @workgroup_size(16, 16)
fn matmul_tn(
  @builtin(global_invocation_id) gid: vec3<u32>,
  @builtin(local_invocation_id) lid: vec3<u32>,
) {
  let row = gid.y;
  let col = gid.x;
  let lx = lid.x;
  let ly = lid.y;

  var acc: f32 = 0.0;
  let numTiles = (dims.K + TILE - 1u) / TILE;

  for (var t: u32 = 0u; t < numTiles; t = t + 1u) {
    let kA = t * TILE + lx;
    let kB = t * TILE + ly;

    // A is [K, M], we want A[kA, row]
    var aVal: f32 = 0.0;
    if (row < dims.M && kA < dims.K) {
      aVal = A[kA * dims.M + row];
    }
    var bVal: f32 = 0.0;
    if (kB < dims.K && col < dims.N) {
      bVal = B[kB * dims.N + col];
    }

    tileA[ly * TILE + lx] = aVal;
    tileB[ly * TILE + lx] = bVal;
    workgroupBarrier();

    for (var k: u32 = 0u; k < TILE; k = k + 1u) {
      acc = fma(tileA[ly * TILE + k], tileB[k * TILE + lx], acc);
    }
    workgroupBarrier();
  }

  if (row < dims.M && col < dims.N) {
    let idx = row * dims.N + col;
    C[idx] = select(acc, C[idx] + acc, dims.alpha > 0.5);
  }
}
