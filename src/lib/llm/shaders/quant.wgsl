// Pure WebGPU Quantized Inference Kernels (Part 4: Inference & Quantization Lab)
// Compares memory-bandwidth-bound decode GEMV across:
//   - FP32 (32 bits/weight)
//   - Group-wise INT8 (8 bits/weight packed 4 per u32 + 1 f32 scale per 32 weights)
//   - Group-wise INT4 (4 bits/weight packed 8 per u32 + 1 f32 scale per 32 weights)
// Dequantization happens on the fly inside GPU registers so VRAM traffic shrinks 4x–8x!

struct QuantParams {
  rows: u32,
  cols: u32,
  groupSize: u32,
  pad: u32,
};

// ---- 1. FP32 baseline GEMV: y[r] = dot(W[r, :], x[:]) ----------------------
@group(0) @binding(0) var<uniform> qpFp32: QuantParams;
@group(0) @binding(1) var<storage, read> wFp32: array<f32>;
@group(0) @binding(2) var<storage, read> xFp32: array<f32>;
@group(0) @binding(3) var<storage, read_write> yFp32: array<f32>;

@compute @workgroup_size(64)
fn gemv_fp32(@builtin(global_invocation_id) gid: vec3<u32>) {
  let r = gid.x;
  if (r >= qpFp32.rows) { return; }
  let cols = qpFp32.cols;
  let base = r * cols;
  var acc: f32 = 0.0;
  for (var c: u32 = 0u; c < cols; c = c + 1u) {
    acc = fma(wFp32[base + c], xFp32[c], acc);
  }
  yFp32[r] = acc;
}

// ---- 2. Packed INT8 group-wise GEMV (4 signed bytes per u32) ---------------
@group(0) @binding(0) var<uniform> qpQ8: QuantParams;
@group(0) @binding(1) var<storage, read> wQ8: array<u32>;
@group(0) @binding(2) var<storage, read> scalesQ8: array<f32>;
@group(0) @binding(3) var<storage, read> xQ8: array<f32>;
@group(0) @binding(4) var<storage, read_write> yQ8: array<f32>;

fn unpack_i8(word: u32, lane: u32) -> f32 {
  let byte = (word >> (lane * 8u)) & 0xFFu;
  let signedVal = select(i32(byte), i32(byte) - 256, byte >= 128u);
  return f32(signedVal);
}

@compute @workgroup_size(64)
fn gemv_int8(@builtin(global_invocation_id) gid: vec3<u32>) {
  let r = gid.x;
  if (r >= qpQ8.rows) { return; }
  let cols = qpQ8.cols;
  let gs = qpQ8.groupSize;
  let wordsPerRow = cols / 4u;
  let groupsPerRow = cols / gs;
  let wordBase = r * wordsPerRow;
  let scaleBase = r * groupsPerRow;

  var acc: f32 = 0.0;
  for (var g: u32 = 0u; g < groupsPerRow; g = g + 1u) {
    let sc = scalesQ8[scaleBase + g];
    let wStart = g * (gs / 4u);
    var gAcc: f32 = 0.0;
    for (var w: u32 = 0u; w < gs / 4u; w = w + 1u) {
      let packed = wQ8[wordBase + wStart + w];
      let c0 = (wStart + w) * 4u;
      gAcc = fma(unpack_i8(packed, 0u), xQ8[c0], gAcc);
      gAcc = fma(unpack_i8(packed, 1u), xQ8[c0 + 1u], gAcc);
      gAcc = fma(unpack_i8(packed, 2u), xQ8[c0 + 2u], gAcc);
      gAcc = fma(unpack_i8(packed, 3u), xQ8[c0 + 3u], gAcc);
    }
    acc = fma(gAcc, sc, acc);
  }
  yQ8[r] = acc;
}

// ---- 3. Packed INT4 group-wise GEMV (8 signed nibbles per u32) -------------
@group(0) @binding(0) var<uniform> qpQ4: QuantParams;
@group(0) @binding(1) var<storage, read> wQ4: array<u32>;
@group(0) @binding(2) var<storage, read> scalesQ4: array<f32>;
@group(0) @binding(3) var<storage, read> xQ4: array<f32>;
@group(0) @binding(4) var<storage, read_write> yQ4: array<f32>;

fn unpack_i4(word: u32, lane: u32) -> f32 {
  let nib = (word >> (lane * 4u)) & 0xFu;
  return f32(i32(nib) - 8); // stored with +8 bias in [0..15] -> [-8..+7]
}

@compute @workgroup_size(64)
fn gemv_int4(@builtin(global_invocation_id) gid: vec3<u32>) {
  let r = gid.x;
  if (r >= qpQ4.rows) { return; }
  let cols = qpQ4.cols;
  let gs = qpQ4.groupSize;
  let wordsPerRow = cols / 8u;
  let groupsPerRow = cols / gs;
  let wordBase = r * wordsPerRow;
  let scaleBase = r * groupsPerRow;

  var acc: f32 = 0.0;
  for (var g: u32 = 0u; g < groupsPerRow; g = g + 1u) {
    let sc = scalesQ4[scaleBase + g];
    let wStart = g * (gs / 8u);
    var gAcc: f32 = 0.0;
    for (var w: u32 = 0u; w < gs / 8u; w = w + 1u) {
      let packed = wQ4[wordBase + wStart + w];
      let c0 = (wStart + w) * 8u;
      for (var lane: u32 = 0u; lane < 8u; lane = lane + 1u) {
        gAcc = fma(unpack_i4(packed, lane), xQ4[c0 + lane], gAcc);
      }
    }
    acc = fma(gAcc, sc, acc);
  }
  yQ4[r] = acc;
}
