// Pure WebGPU FlashAttention (online safe softmax) + Naive Causal Attention
// Forward and Backward compute kernels.
// Layout: Q, K, V, O are [B, T, D] where D = nHeads * headDim.
// Each thread computes one (batch, head, query_t) row — streaming K/V in tiles
// with running max m_i and normalizer l_i so the T x T matrix is NEVER stored in VRAM.

struct AttnParams {
  B: u32,
  T: u32,
  nHeads: u32,
  headDim: u32,
  kvLen: u32,     // equals T during training; can be > T with KV cache
  qOffset: u32,   // causal offset for KV-cached single-token decode
  scale: f32,
  saveProbs: u32, // 1 => write last-head attention weights into probsOut for visualization
};

// ---- 1. FlashAttention Forward (online softmax, O(1) extra memory) ---------
@group(0) @binding(0) var<uniform> ap: AttnParams;
@group(0) @binding(1) var<storage, read> Q: array<f32>;
@group(0) @binding(2) var<storage, read> K: array<f32>;
@group(0) @binding(3) var<storage, read> V: array<f32>;
@group(0) @binding(4) var<storage, read_write> O: array<f32>;
@group(0) @binding(5) var<storage, read_write> LSE: array<f32>;      // [B * nHeads * T]
@group(0) @binding(6) var<storage, read_write> probsOut: array<f32>; // [T * T] for b=0, h=0 viz

const MAX_HD: u32 = 32u;

@compute @workgroup_size(64)
fn flash_attn_fwd(@builtin(global_invocation_id) gid: vec3<u32>) {
  let totalRows = ap.B * ap.nHeads * ap.T;
  let rowId = gid.x;
  if (rowId >= totalRows) { return; }

  let T = ap.T;
  let H = ap.nHeads;
  let hd = ap.headDim;
  let D = H * hd;

  let qt = rowId % T;
  let rem = rowId / T;
  let h = rem % H;
  let b = rem / H;

  let qBase = (b * T + qt) * D + h * hd;
  let maxK = min(ap.kvLen, qt + ap.qOffset + 1u);

  // Load query vector into registers
  var qReg: array<f32, 32>;
  var oAcc: array<f32, 32>;
  for (var d: u32 = 0u; d < hd; d = d + 1u) {
    qReg[d] = Q[qBase + d];
    oAcc[d] = 0.0;
  }

  // Online softmax state (Milakov-Gimelshein / FlashAttention)
  var m_i: f32 = -1e30;
  var l_i: f32 = 0.0;

  let kvBaseBatch = b * ap.kvLen * D + h * hd;
  for (var kt: u32 = 0u; kt < maxK; kt = kt + 1u) {
    let kBase = kvBaseBatch + kt * D;
    var score: f32 = 0.0;
    for (var d: u32 = 0u; d < hd; d = d + 1u) {
      score = fma(qReg[d], K[kBase + d], score);
    }
    score = score * ap.scale;

    let m_new = max(m_i, score);
    let alpha = exp(m_i - m_new);
    let p_ij = exp(score - m_new);

    for (var d: u32 = 0u; d < hd; d = d + 1u) {
      oAcc[d] = oAcc[d] * alpha + p_ij * V[kBase + d];
    }
    l_i = l_i * alpha + p_ij;
    m_i = m_new;
  }

  let invL = 1.0 / max(l_i, 1e-20);
  for (var d: u32 = 0u; d < hd; d = d + 1u) {
    O[qBase + d] = oAcc[d] * invL;
  }
  let lse = m_i + log(max(l_i, 1e-20));
  LSE[rowId] = lse;

  // Optional: save normalized attention weights for batch 0, head 0 for live visualization
  if (ap.saveProbs == 1u && b == 0u && h == 0u && ap.kvLen == T) {
    for (var kt: u32 = 0u; kt < T; kt = kt + 1u) {
      if (kt <= qt) {
        let kBase = kvBaseBatch + kt * D;
        var score: f32 = 0.0;
        for (var d: u32 = 0u; d < hd; d = d + 1u) {
          score = fma(qReg[d], K[kBase + d], score);
        }
        probsOut[qt * T + kt] = exp(score * ap.scale - lse);
      } else {
        probsOut[qt * T + kt] = 0.0;
      }
    }
  }
}

// ---- 2. FlashAttention Backward: dQ pass (recomputes P from Q, K, LSE) -----
@group(0) @binding(0) var<uniform> apBwdQ: AttnParams;
@group(0) @binding(1) var<storage, read> bqQ: array<f32>;
@group(0) @binding(2) var<storage, read> bqK: array<f32>;
@group(0) @binding(3) var<storage, read> bqV: array<f32>;
@group(0) @binding(4) var<storage, read> bqO: array<f32>;
@group(0) @binding(5) var<storage, read> bqDO: array<f32>;
@group(0) @binding(6) var<storage, read> bqLSE: array<f32>;
@group(0) @binding(7) var<storage, read_write> bqDQ: array<f32>;

@compute @workgroup_size(64)
fn flash_attn_bwd_dq(@builtin(global_invocation_id) gid: vec3<u32>) {
  let totalRows = apBwdQ.B * apBwdQ.nHeads * apBwdQ.T;
  let rowId = gid.x;
  if (rowId >= totalRows) { return; }

  let T = apBwdQ.T;
  let H = apBwdQ.nHeads;
  let hd = apBwdQ.headDim;
  let D = H * hd;

  let qt = rowId % T;
  let rem = rowId / T;
  let h = rem % H;
  let b = rem / H;

  let qBase = (b * T + qt) * D + h * hd;
  let lse = bqLSE[rowId];

  // D_i = dot(dO_i, O_i)
  var dOdotO: f32 = 0.0;
  var qReg: array<f32, 32>;
  var doReg: array<f32, 32>;
  var dqAcc: array<f32, 32>;
  for (var d: u32 = 0u; d < hd; d = d + 1u) {
    let qv = bqQ[qBase + d];
    let dov = bqDO[qBase + d];
    qReg[d] = qv;
    doReg[d] = dov;
    dqAcc[d] = 0.0;
    dOdotO = fma(dov, bqO[qBase + d], dOdotO);
  }

  let batchBase = b * T * D + h * hd;
  for (var kt: u32 = 0u; kt <= qt; kt = kt + 1u) {
    let kBase = batchBase + kt * D;
    var score: f32 = 0.0;
    var dP: f32 = 0.0;
    for (var d: u32 = 0u; d < hd; d = d + 1u) {
      score = fma(qReg[d], bqK[kBase + d], score);
      dP = fma(doReg[d], bqV[kBase + d], dP);
    }
    let p = exp(score * apBwdQ.scale - lse);
    let dS = p * (dP - dOdotO) * apBwdQ.scale;
    for (var d: u32 = 0u; d < hd; d = d + 1u) {
      dqAcc[d] = fma(dS, bqK[kBase + d], dqAcc[d]);
    }
  }

  for (var d: u32 = 0u; d < hd; d = d + 1u) {
    bqDQ[qBase + d] = dqAcc[d];
  }
}

// ---- 3. FlashAttention Backward: dK and dV pass (thread per key position) --
// No atomics needed because each thread owns one (b, h, kt) row!
@group(0) @binding(0) var<uniform> apBwdKV: AttnParams;
@group(0) @binding(1) var<storage, read> bkvQ: array<f32>;
@group(0) @binding(2) var<storage, read> bkvK: array<f32>;
@group(0) @binding(3) var<storage, read> bkvV: array<f32>;
@group(0) @binding(4) var<storage, read> bkvO: array<f32>;
@group(0) @binding(5) var<storage, read> bkvDO: array<f32>;
@group(0) @binding(6) var<storage, read> bkvLSE: array<f32>;
@group(0) @binding(7) var<storage, read_write> bkvDK: array<f32>;
@group(0) @binding(8) var<storage, read_write> bkvDV: array<f32>;

@compute @workgroup_size(64)
fn flash_attn_bwd_dkv(@builtin(global_invocation_id) gid: vec3<u32>) {
  let totalRows = apBwdKV.B * apBwdKV.nHeads * apBwdKV.T;
  let rowId = gid.x;
  if (rowId >= totalRows) { return; }

  let T = apBwdKV.T;
  let H = apBwdKV.nHeads;
  let hd = apBwdKV.headDim;
  let D = H * hd;

  let kt = rowId % T;
  let rem = rowId / T;
  let h = rem % H;
  let b = rem / H;

  let batchBase = b * T * D + h * hd;
  let kBase = batchBase + kt * D;

  var kReg: array<f32, 32>;
  var vReg: array<f32, 32>;
  var dkAcc: array<f32, 32>;
  var dvAcc: array<f32, 32>;
  for (var d: u32 = 0u; d < hd; d = d + 1u) {
    kReg[d] = bkvK[kBase + d];
    vReg[d] = bkvV[kBase + d];
    dkAcc[d] = 0.0;
    dvAcc[d] = 0.0;
  }

  let lseBatchHead = (b * H + h) * T;
  for (var qt: u32 = kt; qt < T; qt = qt + 1u) {
    let qBase = batchBase + qt * D;
    let lse = bkvLSE[lseBatchHead + qt];
    var score: f32 = 0.0;
    var dP: f32 = 0.0;
    var dOdotO: f32 = 0.0;
    for (var d: u32 = 0u; d < hd; d = d + 1u) {
      let qv = bkvQ[qBase + d];
      let dov = bkvDO[qBase + d];
      score = fma(qv, kReg[d], score);
      dP = fma(dov, vReg[d], dP);
      dOdotO = fma(dov, bkvO[qBase + d], dOdotO);
    }
    let p = exp(score * apBwdKV.scale - lse);
    let dS = p * (dP - dOdotO) * apBwdKV.scale;
    for (var d: u32 = 0u; d < hd; d = d + 1u) {
      dvAcc[d] = fma(p, bkvDO[qBase + d], dvAcc[d]);
      dkAcc[d] = fma(dS, bkvQ[qBase + d], dkAcc[d]);
    }
  }

  for (var d: u32 = 0u; d < hd; d = d + 1u) {
    bkvDK[kBase + d] = dkAcc[d];
    bkvDV[kBase + d] = dvAcc[d];
  }
}
