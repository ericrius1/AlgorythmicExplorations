// GPU-resident Barnes-Hut via an implicit quadtree pyramid.
//
// Per substep: clear_grid -> reduce_bounds -> scatter -> resolve -> reduce
// (finest-1 .. 0) -> force. The tree is a complete quadtree stored level by
// level in `nodes` (vec4f: com.xy, mass, unused); children of (level, ix, iy)
// are (level+1, 2ix+dx, 2iy+dy), so traversal needs no pointers and the whole
// sim stays on the GPU.
//
// FINEST/DIM/FP_SCALE/LEVEL are pipeline-overridable constants baked at
// pipeline creation (they only change when the particle count changes), so
// there is no pyramid uniform buffer and the compiler can fold them.
//
// No kernel reads another particle's body — cross-particle information flows
// only through grid/nodes — so `force` integrates in place and no ping-pong
// body buffer exists.

override FINEST: u32 = 10u;   // pyramid depth; finest grid is DIM x DIM
override DIM: u32 = 1024u;    // 1 << FINEST
override FP_SCALE: f32 = 1.0; // fixed-point scale for mass and offset atomics
override LEVEL: u32 = 0u;     // which level a reduce pipeline writes

struct SimParams {
  count: u32,
  dt: f32,
  g: f32,
  softening: f32,
  theta: f32,
  damping: f32,
  maxSpeed: f32,
  pad1: f32,
}

@group(0) @binding(0) var<uniform> P: SimParams;
@group(0) @binding(1) var<storage, read_write> bodies: array<vec4f>;
@group(0) @binding(3) var<storage, read> mass: array<f32>;
// Fixed-point accumulators, 4 words per finest cell: mass (u32), m*dx (i32
// bits), m*dy (i32 bits), unused.
@group(0) @binding(4) var<storage, read_write> grid: array<atomic<u32>>;
@group(0) @binding(5) var<storage, read_write> nodes: array<vec4f>;
// World bounds as order-preserving u32 keys: minX, minY, maxX, maxY.
@group(0) @binding(6) var<storage, read_write> bounds: array<atomic<u32>, 4>;

// Monotone map f32 -> u32 so atomicMin/Max order like floats.
fn floatToKey(v: f32) -> u32 {
  let u = bitcast<u32>(v);
  return select(u | 0x80000000u, ~u, (u >> 31u) == 1u);
}

fn keyToFloat(k: u32) -> f32 {
  if ((k >> 31u) == 1u) {
    return bitcast<f32>(k ^ 0x80000000u);
  }
  return bitcast<f32>(~k);
}

struct RootBox {
  origin: vec2f,
  size: f32,
}

fn rootBox() -> RootBox {
  let mn = vec2f(keyToFloat(atomicLoad(&bounds[0])), keyToFloat(atomicLoad(&bounds[1])));
  let mx = vec2f(keyToFloat(atomicLoad(&bounds[2])), keyToFloat(atomicLoad(&bounds[3])));
  let c = (mn + mx) * 0.5;
  let half = max(max(mx.x - mn.x, mx.y - mn.y) * 0.5, 1e-6) * 1.0001;
  var r: RootBox;
  r.origin = c - vec2f(half, half);
  r.size = half * 2.0;
  return r;
}

// Nodes of levels 0..l-1 precede level l.
fn levelOffset(l: u32) -> u32 {
  return ((1u << (2u * l)) - 1u) / 3u;
}

@compute @workgroup_size(256)
fn clear_grid(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i < 4u) {
    atomicStore(&bounds[i], select(0u, 0xFFFFFFFFu, i < 2u));
  }
  if (i < DIM * DIM * 4u) {
    atomicStore(&grid[i], 0u);
  }
}

var<workgroup> wmin: array<vec2f, 256>;
var<workgroup> wmax: array<vec2f, 256>;

@compute @workgroup_size(256)
fn reduce_bounds(@builtin(global_invocation_id) gid: vec3u, @builtin(local_invocation_id) lid: vec3u) {
  var lo = vec2f(3.4e38, 3.4e38);
  var hi = vec2f(-3.4e38, -3.4e38);
  if (gid.x < P.count) {
    lo = bodies[gid.x].xy;
    hi = lo;
  }
  wmin[lid.x] = lo;
  wmax[lid.x] = hi;
  workgroupBarrier();
  var s = 128u;
  loop {
    if (s == 0u) {
      break;
    }
    if (lid.x < s) {
      wmin[lid.x] = min(wmin[lid.x], wmin[lid.x + s]);
      wmax[lid.x] = max(wmax[lid.x], wmax[lid.x + s]);
    }
    workgroupBarrier();
    s = s >> 1u;
  }
  if (lid.x == 0u) {
    atomicMin(&bounds[0], floatToKey(wmin[0].x));
    atomicMin(&bounds[1], floatToKey(wmin[0].y));
    atomicMax(&bounds[2], floatToKey(wmax[0].x));
    atomicMax(&bounds[3], floatToKey(wmax[0].y));
  }
}

@compute @workgroup_size(256)
fn scatter(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= P.count) {
    return;
  }
  let rb = rootBox();
  let p = bodies[i].xy;
  let m = mass[i];
  let gf = (p - rb.origin) / rb.size * f32(DIM);
  let gx = min(u32(max(gf.x, 0.0)), DIM - 1u);
  let gy = min(u32(max(gf.y, 0.0)), DIM - 1u);
  // Offset from cell center in cell units, in [-0.5, 0.5].
  let frac = gf - vec2f(f32(gx) + 0.5, f32(gy) + 0.5);
  let c = (gy * DIM + gx) * 4u;
  atomicAdd(&grid[c], u32(round(m * FP_SCALE)));
  // u32 wrap-around addition is exact two's-complement i32 summation.
  atomicAdd(&grid[c + 1u], bitcast<u32>(i32(round(m * frac.x * FP_SCALE))));
  atomicAdd(&grid[c + 2u], bitcast<u32>(i32(round(m * frac.y * FP_SCALE))));
}

@compute @workgroup_size(256)
fn resolve(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= DIM * DIM) {
    return;
  }
  let out = levelOffset(FINEST) + i;
  let mU = atomicLoad(&grid[i * 4u]);
  if (mU == 0u) {
    nodes[out] = vec4f(0.0);
    return;
  }
  let m = f32(mU) / FP_SCALE;
  let sx = f32(bitcast<i32>(atomicLoad(&grid[i * 4u + 1u]))) / FP_SCALE;
  let sy = f32(bitcast<i32>(atomicLoad(&grid[i * 4u + 2u]))) / FP_SCALE;
  let rb = rootBox();
  let cell = rb.size / f32(DIM);
  let center = rb.origin + vec2f((f32(i % DIM) + 0.5) * cell, (f32(i / DIM) + 0.5) * cell);
  let com = center + vec2f(sx, sy) / m * cell;
  nodes[out] = vec4f(com, m, 0.0);
}

@compute @workgroup_size(256)
fn reduce(@builtin(global_invocation_id) gid: vec3u) {
  let dim = 1u << LEVEL;
  let i = gid.x;
  if (i >= dim * dim) {
    return;
  }
  let ix = i % dim;
  let iy = i / dim;
  let fineOff = levelOffset(LEVEL + 1u);
  let fdim = dim * 2u;
  var m = 0.0;
  var w = vec2f(0.0);
  for (var q = 0u; q < 4u; q = q + 1u) {
    let n = nodes[fineOff + (iy * 2u + (q >> 1u)) * fdim + ix * 2u + (q & 1u)];
    m = m + n.z;
    w = w + n.xy * n.z;
  }
  var out = vec4f(0.0);
  if (m > 0.0) {
    out = vec4f(w / m, m, 0.0);
  }
  nodes[levelOffset(LEVEL) + i] = out;
}

@compute @workgroup_size(256)
fn force(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= P.count) {
    return;
  }
  let b = bodies[i];
  let pos = b.xy;
  var vel = b.zw;
  let myMass = mass[i];

  let rb = rootBox();
  let gf = (pos - rb.origin) / rb.size * f32(DIM);
  let myIx = min(u32(max(gf.x, 0.0)), DIM - 1u);
  let myIy = min(u32(max(gf.y, 0.0)), DIM - 1u);

  let eps2 = P.softening * P.softening;
  let theta2 = P.theta * P.theta;
  var acc = vec2f(0.0);

  // Entries pack level (4 bits) | iy (14 bits) | ix (14 bits). Depth-first
  // stack peaks at 3*level+4, so 44 covers the deepest pyramid (level 10).
  var stack: array<u32, 44>;
  var sp: i32 = 1;
  stack[0] = 0u;

  loop {
    if (sp == 0) {
      break;
    }
    sp = sp - 1;
    let e = stack[sp];
    let lvl = e >> 28u;
    let ix = e & 0x3FFFu;
    let iy = (e >> 14u) & 0x3FFFu;
    let ldim = 1u << lvl;
    let n = nodes[levelOffset(lvl) + iy * ldim + ix];
    if (n.z <= 0.0) {
      continue;
    }
    let d0 = n.xy - pos;
    let r2 = dot(d0, d0) + eps2;
    let w = rb.size / f32(ldim);
    if (lvl == FINEST) {
      var m = n.z;
      var com = n.xy;
      if (ix == myIx && iy == myIy) {
        // Remove self from the cell's lump before applying its pull.
        m = m - myMass;
        if (m <= 1e-9) {
          continue;
        }
        com = (n.xy * n.z - pos * myMass) / m;
      }
      let d = com - pos;
      let rr = dot(d, d) + eps2;
      acc = acc + d * (P.g * m / (rr * sqrt(rr)));
    } else if (w * w < theta2 * r2) {
      acc = acc + d0 * (P.g * n.z / (r2 * sqrt(r2)));
    } else if (sp <= 40) {
      let cl = lvl + 1u;
      let bx = ix * 2u;
      let by = iy * 2u;
      stack[sp] = (cl << 28u) | (by << 14u) | bx;
      stack[sp + 1] = (cl << 28u) | (by << 14u) | (bx + 1u);
      stack[sp + 2] = (cl << 28u) | ((by + 1u) << 14u) | bx;
      stack[sp + 3] = (cl << 28u) | ((by + 1u) << 14u) | (bx + 1u);
      sp = sp + 4;
    }
  }

  vel = (vel + acc * P.dt) * P.damping;
  let spd = length(vel);
  if (spd > P.maxSpeed) {
    vel = vel * (P.maxSpeed / spd);
  }
  // Only this thread touches bodies[i], so integrate in place.
  bodies[i] = vec4f(pos + vel * P.dt, vel);
}
