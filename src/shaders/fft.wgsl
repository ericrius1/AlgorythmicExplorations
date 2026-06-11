// Stockham radix-2 FFT: one workgroup per line, the whole transform in
// shared memory, no bit-reversal (Stockham's indexing is self-sorting).
// __N__ / __LOGN__ / __HALF__ are substituted at module build time so one
// source serves every mesh size; AXIS and INV are pipeline constants, so a
// solver owns four pipelines: rows/cols × forward/inverse.
//
// Each thread owns one butterfly per stage. A line is loaded once, folded
// log2(N) times between two shared arrays, and written back in place — a
// workgroup owns its entire line, so the global buffer needs no ping-pong.

const N: u32 = __N__u;
const HALF: u32 = __HALF__u;
const LOGN: u32 = __LOGN__u;
const TAU: f32 = 6.283185307179586;

override AXIS: u32 = 0u; // 0: transform rows, 1: transform columns
override INV: u32 = 0u;  // 1: conjugate twiddles and scale by 1/N

@group(0) @binding(0) var<storage, read_write> data: array<vec2f>;

var<workgroup> sA: array<vec2f, N>;
var<workgroup> sB: array<vec2f, N>;

fn cmul(a: vec2f, b: vec2f) -> vec2f {
  return vec2f(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
}

fn idxOf(line: u32, i: u32) -> u32 {
  if (AXIS == 0u) { return line * N + i; }
  return i * N + line;
}

@compute @workgroup_size(__HALF__)
fn fft(@builtin(workgroup_id) wid: vec3u, @builtin(local_invocation_id) lid: vec3u) {
  let line = wid.x;
  let t = lid.x;
  sA[t] = data[idxOf(line, t)];
  sA[t + HALF] = data[idxOf(line, t + HALF)];
  workgroupBarrier();

  let sign = select(-1.0, 1.0, INV == 1u);
  var ns = 1u;
  var fromA = true;
  for (var s = 0u; s < LOGN; s++) {
    let k = t % ns;
    let base = (t / ns) * (ns * 2u) + k;
    let ang = sign * TAU * f32(k) / f32(ns * 2u);
    let w = vec2f(cos(ang), sin(ang));
    if (fromA) {
      let v0 = sA[t];
      let v1 = cmul(w, sA[t + HALF]);
      sB[base] = v0 + v1;
      sB[base + ns] = v0 - v1;
    } else {
      let v0 = sB[t];
      let v1 = cmul(w, sB[t + HALF]);
      sA[base] = v0 + v1;
      sA[base + ns] = v0 - v1;
    }
    workgroupBarrier();
    fromA = !fromA;
    ns = ns * 2u;
  }

  let scale = select(1.0, 1.0 / f32(N), INV == 1u);
  if (fromA) {
    data[idxOf(line, t)] = sA[t] * scale;
    data[idxOf(line, t + HALF)] = sA[t + HALF] * scale;
  } else {
    data[idxOf(line, t)] = sB[t] * scale;
    data[idxOf(line, t + HALF)] = sB[t + HALF] * scale;
  }
}
