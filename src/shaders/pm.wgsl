// Particle-mesh pipeline, everything except the FFT itself (fft.wgsl):
//
//   clear     zero the density mesh
//   deposit   CIC: each particle splits its mass over its 4 nearest cells
//   to_spec   density (or a painted field) becomes the complex FFT input
//   green     in frequency space, Poisson collapses to spec *= -1/k²
//   gradient  central differences of the potential -> a force mesh
//   gather    CIC in reverse: interpolate the force, kick-drift, wrap
//
// Positions live in box units [0,1). The box is periodic everywhere: cell
// indices are masked, positions are fract()ed, and the FFT was periodic
// before we asked. kick/drift are precomputed on the CPU and carry every
// physical constant (G-equivalents, scale-factor terms), so the same kernels
// run plain Newtonian collapses and an expanding universe unchanged.

struct PmParams {
  count: u32,
  flags: u32, // 1: to_spec reads the painted field instead of the deposit
  kick: f32,
  drift: f32,
  damp: f32,   // momentum retention; 1 = conservative, <1 for tracer demos
  kSmooth: f32, // k-space gaussian width² (cells), softens mesh-scale noise
  mouseRadius: f32,
  mouseStrength: f32,
  mouse: vec2f,
  mouseVel: vec2f,
}

override DIM: u32 = 512u;
const FP: f32 = 256.0; // fixed-point scale for the atomic deposit

@group(0) @binding(0) var<uniform> P: PmParams;
@group(0) @binding(1) var<storage, read_write> parts: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> rho: array<atomic<u32>>;
@group(0) @binding(3) var<storage, read_write> spec: array<vec2f>;
@group(0) @binding(4) var<storage, read_write> force: array<vec2f>;
@group(0) @binding(5) var<storage, read_write> paint: array<f32>;
@group(0) @binding(6) var<storage, read_write> stat: array<atomic<u32>>;

fn cellIdx(c: vec2i) -> u32 {
  let m = vec2u(c) & vec2u(DIM - 1u); // power-of-two wrap, negatives included
  return m.y * DIM + m.x;
}

// ---- deposit ----------------------------------------------------------------

@compute @workgroup_size(256)
fn clear_rho(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= DIM * DIM) { return; }
  atomicStore(&rho[gid.x], 0u);
  if (gid.x == 0u) { atomicStore(&stat[0], 0u); }
}

@compute @workgroup_size(256)
fn deposit(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= P.count) { return; }
  let g = parts[gid.x].xy * f32(DIM) - 0.5;
  let i0 = vec2i(floor(g));
  let f = g - floor(g);
  let w = vec4f((1.0 - f.x) * (1.0 - f.y), f.x * (1.0 - f.y), (1.0 - f.x) * f.y, f.x * f.y);
  atomicAdd(&rho[cellIdx(i0)], u32(w.x * FP));
  atomicAdd(&rho[cellIdx(i0 + vec2i(1, 0))], u32(w.y * FP));
  atomicAdd(&rho[cellIdx(i0 + vec2i(0, 1))], u32(w.z * FP));
  atomicAdd(&rho[cellIdx(i0 + vec2i(1, 1))], u32(w.w * FP));
}

@compute @workgroup_size(256)
fn to_spec(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= DIM * DIM) { return; }
  if (gid.x == 0u) { atomicStore(&stat[0], 0u); } // painted mode skips clear_rho
  var v = f32(atomicLoad(&rho[gid.x])) / FP;
  if ((P.flags & 1u) != 0u) { v = paint[gid.x]; }
  spec[gid.x] = vec2f(v, 0.0);
}

// ---- the solve, minus the transforms ----------------------------------------

// Integer frequency of mesh index i: 0,1,...,N/2,-(N/2-1),...,-1.
fn freqOf(i: u32) -> f32 {
  return f32(i) - f32(DIM) * step(f32(DIM) * 0.5, f32(i));
}

@compute @workgroup_size(256)
fn green(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= DIM * DIM) { return; }
  let k = vec2f(freqOf(gid.x % DIM), freqOf(gid.x / DIM));
  let k2 = dot(k, k);
  if (k2 == 0.0) {
    spec[gid.x] = vec2f(0.0); // zeroing DC subtracts the mean density
    return;
  }
  spec[gid.x] *= -exp(-k2 * P.kSmooth) / k2;
}

@compute @workgroup_size(256)
fn gradient(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= DIM * DIM) { return; }
  let c = vec2i(i32(gid.x % DIM), i32(gid.x / DIM));
  let dx = spec[cellIdx(c + vec2i(1, 0))].x - spec[cellIdx(c - vec2i(1, 0))].x;
  let dy = spec[cellIdx(c + vec2i(0, 1))].x - spec[cellIdx(c - vec2i(0, 1))].x;
  force[gid.x] = vec2f(dx, dy) * (-0.5) * f32(DIM);
  // track the deepest potential well for the painter's color normalization
  let depth = u32(clamp(-spec[gid.x].x * 4096.0, 0.0, 4.0e9));
  atomicMax(&stat[0], depth);
}

// ---- gather + integrate ------------------------------------------------------

@compute @workgroup_size(256)
fn gather(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= P.count) { return; }
  var p = parts[gid.x];
  let g = p.xy * f32(DIM) - 0.5;
  let i0 = vec2i(floor(g));
  let f = g - floor(g);
  let f00 = force[cellIdx(i0)];
  let f10 = force[cellIdx(i0 + vec2i(1, 0))];
  let f01 = force[cellIdx(i0 + vec2i(0, 1))];
  let f11 = force[cellIdx(i0 + vec2i(1, 1))];
  let fr = mix(mix(f00, f10, f.x), mix(f01, f11, f.x), f.y);

  var vel = p.zw * P.damp + fr * P.kick;
  let d = p.xy - P.mouse;
  let s = exp(-dot(d, d) / (P.mouseRadius * P.mouseRadius));
  vel += P.mouseVel * (s * P.mouseStrength * P.drift);

  p = vec4f(fract(p.xy + vel * P.drift), vel);
  parts[gid.x] = p;
}

// ---- painter -----------------------------------------------------------------

struct SplatParams {
  pos: vec2f,
  radius: f32,
  strength: f32, // mass per frame while the cursor is down; <0 erases
}

@group(0) @binding(7) var<uniform> S: SplatParams;

@compute @workgroup_size(256)
fn splat(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= DIM * DIM) { return; }
  let c = (vec2f(f32(gid.x % DIM), f32(gid.x / DIM)) + 0.5) / f32(DIM);
  var d = abs(c - S.pos);
  d = min(d, 1.0 - d); // periodic distance: blobs painted near an edge wrap
  let r2 = dot(d, d) / (S.radius * S.radius);
  let v = paint[gid.x] + S.strength * exp(-r2 * 4.0);
  paint[gid.x] = max(v, 0.0);
}
