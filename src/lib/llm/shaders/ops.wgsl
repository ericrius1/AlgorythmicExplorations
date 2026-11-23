// Pure WebGPU elementwise, normalization, RoPE, activation, loss, and optimizer
// compute kernels for first-principles Transformer training & inference.

struct OpParams {
  a: u32,
  b: u32,
  c: u32,
  d: u32,
  f0: f32,
  f1: f32,
  f2: f32,
  f3: f32,
};

// ---- 1. Embedding forward: out[n, D] = W[ids[n], D] ------------------------
@group(0) @binding(0) var<uniform> pEmbed: OpParams; // a=N, b=D
@group(0) @binding(1) var<storage, read> embedIds: array<u32>;
@group(0) @binding(2) var<storage, read> embedW: array<f32>;
@group(0) @binding(3) var<storage, read_write> embedOut: array<f32>;

@compute @workgroup_size(256)
fn embed_fwd(@builtin(global_invocation_id) gid: vec3<u32>) {
  let total = pEmbed.a * pEmbed.b;
  let i = gid.x;
  if (i >= total) { return; }
  let tokIdx = i / pEmbed.b;
  let dimIdx = i % pEmbed.b;
  let tok = embedIds[tokIdx];
  embedOut[i] = embedW[tok * pEmbed.b + dimIdx];
}

// ---- 2. Embedding backward: gather over vocabulary rows (no atomics needed) -
// Each thread handles one (vocab_id, dim) entry and sums matching tokens.
@group(0) @binding(0) var<uniform> pEmbedBwd: OpParams; // a=N, b=D, c=V
@group(0) @binding(1) var<storage, read> ebIds: array<u32>;
@group(0) @binding(2) var<storage, read> ebDOut: array<f32>;
@group(0) @binding(3) var<storage, read_write> ebDW: array<f32>;

@compute @workgroup_size(256)
fn embed_bwd(@builtin(global_invocation_id) gid: vec3<u32>) {
  let total = pEmbedBwd.c * pEmbedBwd.b;
  let i = gid.x;
  if (i >= total) { return; }
  let v = i / pEmbedBwd.b;
  let d = i % pEmbedBwd.b;
  var acc: f32 = 0.0;
  for (var n: u32 = 0u; n < pEmbedBwd.a; n = n + 1u) {
    if (ebIds[n] == v) {
      acc = acc + ebDOut[n * pEmbedBwd.b + d];
    }
  }
  ebDW[i] = ebDW[i] + acc;
}

// ---- 3. RMSNorm forward: one workgroup thread per row ----------------------
// y[r, d] = x[r, d] * invRms[r] * w[d]
@group(0) @binding(0) var<uniform> pRms: OpParams; // a=rows, b=D, f0=eps
@group(0) @binding(1) var<storage, read> rmsX: array<f32>;
@group(0) @binding(2) var<storage, read> rmsW: array<f32>;
@group(0) @binding(3) var<storage, read_write> rmsY: array<f32>;
@group(0) @binding(4) var<storage, read_write> rmsInv: array<f32>;

@compute @workgroup_size(64)
fn rmsnorm_fwd(@builtin(global_invocation_id) gid: vec3<u32>) {
  let r = gid.x;
  if (r >= pRms.a) { return; }
  let D = pRms.b;
  let base = r * D;
  var ss: f32 = 0.0;
  for (var d: u32 = 0u; d < D; d = d + 1u) {
    let v = rmsX[base + d];
    ss = fma(v, v, ss);
  }
  let inv = inverseSqrt(ss / f32(D) + pRms.f0);
  rmsInv[r] = inv;
  for (var d: u32 = 0u; d < D; d = d + 1u) {
    rmsY[base + d] = rmsX[base + d] * inv * rmsW[d];
  }
}

// ---- 4. RMSNorm backward (dX per row) --------------------------------------
@group(0) @binding(0) var<uniform> pRmsBwd: OpParams; // a=rows, b=D
@group(0) @binding(1) var<storage, read> rbX: array<f32>;
@group(0) @binding(2) var<storage, read> rbW: array<f32>;
@group(0) @binding(3) var<storage, read> rbInv: array<f32>;
@group(0) @binding(4) var<storage, read> rbDY: array<f32>;
@group(0) @binding(5) var<storage, read_write> rbDX: array<f32>;

@compute @workgroup_size(64)
fn rmsnorm_bwd_x(@builtin(global_invocation_id) gid: vec3<u32>) {
  let r = gid.x;
  if (r >= pRmsBwd.a) { return; }
  let D = pRmsBwd.b;
  let base = r * D;
  let inv = rbInv[r];
  var dotVal: f32 = 0.0;
  for (var d: u32 = 0u; d < D; d = d + 1u) {
    dotVal = fma(rbDY[base + d] * rbW[d], rbX[base + d], dotVal);
  }
  let scale = (inv * inv * inv) * dotVal / f32(D);
  for (var d: u32 = 0u; d < D; d = d + 1u) {
    rbDX[base + d] = rbDY[base + d] * rbW[d] * inv - rbX[base + d] * scale;
  }
}

// ---- 5. RMSNorm backward (dW per feature dim, no atomics) ------------------
@group(0) @binding(0) var<uniform> pRmsDW: OpParams; // a=rows, b=D
@group(0) @binding(1) var<storage, read> rdwX: array<f32>;
@group(0) @binding(2) var<storage, read> rdwInv: array<f32>;
@group(0) @binding(3) var<storage, read> rdwDY: array<f32>;
@group(0) @binding(4) var<storage, read_write> rdwDW: array<f32>;

@compute @workgroup_size(64)
fn rmsnorm_bwd_w(@builtin(global_invocation_id) gid: vec3<u32>) {
  let d = gid.x;
  if (d >= pRmsDW.b) { return; }
  let D = pRmsDW.b;
  var acc: f32 = 0.0;
  for (var r: u32 = 0u; r < pRmsDW.a; r = r + 1u) {
    acc = fma(rdwDY[r * D + d], rdwX[r * D + d] * rdwInv[r], acc);
  }
  rdwDW[d] = rdwDW[d] + acc;
}

// ---- 6. Rotary Positional Embeddings (RoPE) forward & backward -------------
// Operates in-place on [B, T, H, hd] flattened as [B*T, D], rotating adjacent pairs.
// f0 = theta base (e.g. 10000.0), f1 = +1.0 for forward, -1.0 for backward, c = posOffset
@group(0) @binding(0) var<uniform> pRope: OpParams; // a=B*T, b=T, c=posOffset, d=headDim, f0=theta, f1=sign, f2=nHeads
@group(0) @binding(1) var<storage, read_write> ropeBuf: array<f32>;

@compute @workgroup_size(256)
fn rope_apply(@builtin(global_invocation_id) gid: vec3<u32>) {
  let hd = pRope.d;
  let nHeads = u32(pRope.f2);
  let D = nHeads * hd;
  let halfHd = hd / 2u;
  let totalPairs = pRope.a * nHeads * halfHd;
  let idx = gid.x;
  if (idx >= totalPairs) { return; }

  let pairInHead = idx % halfHd;
  let rem = idx / halfHd;
  let h = rem % nHeads;
  let bt = rem / nHeads;
  let t = (bt % pRope.b) + pRope.c;

  let freq = pow(pRope.f0, -f32(2u * pairInHead) / f32(hd));
  let angle = f32(t) * freq * pRope.f1;
  let cs = cos(angle);
  let sn = sin(angle);

  let base = bt * D + h * hd + pairInHead * 2u;
  let x0 = ropeBuf[base];
  let x1 = ropeBuf[base + 1u];
  ropeBuf[base] = x0 * cs - x1 * sn;
  ropeBuf[base + 1u] = x0 * sn + x1 * cs;
}

// ---- 7. SwiGLU / GELU gated FFN forward & backward -------------------------
// a = total elements, b = mode (0 = SwiGLU: silu(gate)*up, 1 = GELU: gelu(gate)*up)
@group(0) @binding(0) var<uniform> pAct: OpParams;
@group(0) @binding(1) var<storage, read> actGate: array<f32>;
@group(0) @binding(2) var<storage, read> actUp: array<f32>;
@group(0) @binding(3) var<storage, read_write> actOut: array<f32>;

fn sigmoid(x: f32) -> f32 {
  return 1.0 / (1.0 + exp(-clamp(x, -20.0, 20.0)));
}

@compute @workgroup_size(256)
fn gated_act_fwd(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= pAct.a) { return; }
  let g = actGate[i];
  let u = actUp[i];
  if (pAct.b == 0u) {
    // SwiGLU: silu(g) * u
    let s = sigmoid(g);
    actOut[i] = (g * s) * u;
  } else {
    // GeGLU / GELU approx: 0.5 * g * (1 + tanh(sqrt(2/pi) * (g + 0.044715 * g^3))) * u
    let k = 0.7978845608 * (g + 0.044715 * g * g * g);
    let gelu = 0.5 * g * (1.0 + tanh(clamp(k, -10.0, 10.0)));
    actOut[i] = gelu * u;
  }
}

@group(0) @binding(0) var<uniform> pActBwd: OpParams;
@group(0) @binding(1) var<storage, read> abGate: array<f32>;
@group(0) @binding(2) var<storage, read> abUp: array<f32>;
@group(0) @binding(3) var<storage, read> abDOut: array<f32>;
@group(0) @binding(4) var<storage, read_write> abDGate: array<f32>;
@group(0) @binding(5) var<storage, read_write> abDUp: array<f32>;

@compute @workgroup_size(256)
fn gated_act_bwd(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= pActBwd.a) { return; }
  let g = abGate[i];
  let u = abUp[i];
  let dout = abDOut[i];
  if (pActBwd.b == 0u) {
    let s = sigmoid(g);
    let silu = g * s;
    let dsilu = s * (1.0 + g * (1.0 - s));
    abDUp[i] = dout * silu;
    abDGate[i] = dout * u * dsilu;
  } else {
    let g2 = g * g;
    let inner = clamp(0.7978845608 * (g + 0.044715 * g * g2), -10.0, 10.0);
    let th = tanh(inner);
    let sech2 = 1.0 - th * th;
    let gelu = 0.5 * g * (1.0 + th);
    let dgelu = 0.5 * (1.0 + th) + 0.5 * g * sech2 * 0.7978845608 * (1.0 + 0.134145 * g2);
    abDUp[i] = dout * gelu;
    abDGate[i] = dout * u * dgelu;
  }
}

// ---- 8. Residual Add & Zero-Buffer utilities -------------------------------
@group(0) @binding(0) var<uniform> pAdd: OpParams; // a = count
@group(0) @binding(1) var<storage, read> addA: array<f32>;
@group(0) @binding(2) var<storage, read> addB: array<f32>;
@group(0) @binding(3) var<storage, read_write> addOut: array<f32>;

@compute @workgroup_size(256)
fn vec_add(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= pAdd.a) { return; }
  addOut[i] = addA[i] + addB[i];
}

@group(0) @binding(0) var<uniform> pAddIn: OpParams; // a = count
@group(0) @binding(1) var<storage, read_write> addInDst: array<f32>;
@group(0) @binding(2) var<storage, read> addInSrc: array<f32>;

@compute @workgroup_size(256)
fn vec_add_inplace(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= pAddIn.a) { return; }
  addInDst[i] = addInDst[i] + addInSrc[i];
}

@group(0) @binding(0) var<uniform> pZero: OpParams; // a = count
@group(0) @binding(1) var<storage, read_write> zeroBuf: array<f32>;

@compute @workgroup_size(256)
fn vec_zero(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= pZero.a) { return; }
  zeroBuf[i] = 0.0;
}

// ---- 9. Fused Softmax + Cross-Entropy Forward & Backward -------------------
// Computes per-token loss[n] and dLogits[n, V] = (softmax(logits) - onehot) / N
@group(0) @binding(0) var<uniform> pCe: OpParams; // a=N, b=V, c=computeGrad (1 or 0)
@group(0) @binding(1) var<storage, read> ceLogits: array<f32>;
@group(0) @binding(2) var<storage, read> ceTargets: array<u32>;
@group(0) @binding(3) var<storage, read_write> ceDLogits: array<f32>;
@group(0) @binding(4) var<storage, read_write> ceLosses: array<f32>;

@compute @workgroup_size(64)
fn cross_entropy_fwd_bwd(@builtin(global_invocation_id) gid: vec3<u32>) {
  let n = gid.x;
  if (n >= pCe.a) { return; }
  let V = pCe.b;
  let base = n * V;
  let tgtId = ceTargets[n];

  var maxVal: f32 = -1e30;
  for (var v: u32 = 0u; v < V; v = v + 1u) {
    maxVal = max(maxVal, ceLogits[base + v]);
  }
  var sumExp: f32 = 0.0;
  for (var v: u32 = 0u; v < V; v = v + 1u) {
    sumExp = sumExp + exp(ceLogits[base + v] - maxVal);
  }
  let logSum = maxVal + log(max(sumExp, 1e-20));
  let tgtLogit = ceLogits[base + tgtId];
  ceLosses[n] = logSum - tgtLogit;

  if (pCe.c == 1u) {
    let invN = 1.0 / f32(pCe.a);
    let invSum = 1.0 / max(sumExp, 1e-20);
    for (var v: u32 = 0u; v < V; v = v + 1u) {
      let prob = exp(ceLogits[base + v] - maxVal) * invSum;
      let y = select(0.0, 1.0, v == tgtId);
      ceDLogits[base + v] = (prob - y) * invN;
    }
  }
}

// ---- 10. AdamW & Muon-style RMS-normalized Momentum Optimizer --------------
// a = count, b = mode (0 = AdamW, 1 = Muon-inspired RMS-steered Nesterov),
// f0 = lr, f1 = weightDecay, f2 = beta1, f3 = beta2 (and c = step >= 1)
@group(0) @binding(0) var<uniform> pOpt: OpParams;
@group(0) @binding(1) var<storage, read_write> optParam: array<f32>;
@group(0) @binding(2) var<storage, read_write> optGrad: array<f32>;
@group(0) @binding(3) var<storage, read_write> optM: array<f32>;
@group(0) @binding(4) var<storage, read_write> optV: array<f32>;

@compute @workgroup_size(256)
fn optimizer_step(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= pOpt.a) { return; }

  // Soft gradient clipping per element for rock-solid browser training stability
  let rawG = optGrad[i];
  let g = clamp(select(0.0, rawG, rawG == rawG), -2.5, 2.5);
  var w = optParam[i];

  let lr = pOpt.f0;
  let wd = pOpt.f1;
  let b1 = pOpt.f2;
  let b2 = pOpt.f3;
  let step = max(1.0, f32(pOpt.c));

  var m = b1 * optM[i] + (1.0 - b1) * g;
  var v = b2 * optV[i] + (1.0 - b2) * g * g;
  optM[i] = m;
  optV[i] = v;

  if (pOpt.b == 0u) {
    // Decoupled AdamW
    let mHat = m / (1.0 - pow(b1, step));
    let vHat = v / (1.0 - pow(b2, step));
    w = w * (1.0 - lr * wd) - lr * mHat / (sqrt(vHat) + 1e-8);
  } else {
    // Muon-inspired Nesterov + sign/RMS spectral-step normalization
    let nesterov = b1 * m + (1.0 - b1) * g;
    let rms = sqrt(v / (1.0 - pow(b2, step)) + 1e-8);
    let stepDir = tanh(nesterov / (rms + 1e-5));
    w = w * (1.0 - lr * wd * 0.5) - lr * 0.72 * stepDir;
  }

  optParam[i] = clamp(w, -8.0, 8.0);
  optGrad[i] = 0.0;
}
