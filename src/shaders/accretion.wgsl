// Part four's whole point in one file: both structures over one buffer.
//
// The pyramid passes (clear_grid -> reduce_bounds -> scatter_mass ->
// resolve -> reduce per level) are part one's tree, with every grain
// weighing exactly 1 — uniform mass is what makes the sort invisible to
// gravity, and it deletes the mass buffer too. The force kernel then walks
// the tree for the far field and the 9 hashed buckets for the near field,
// adds the star and the cursor, and integrates in place.
//
// Runs on the *sorted* buffer (hashsort.wgsl's output), so contact
// neighbours are neighbours in memory during the most expensive pass.

override FINEST: u32 = 8u;    // pyramid depth; finest grid is DIM x DIM
override DIM: u32 = 256u;     // 1 << FINEST
override FP_SCALE: f32 = 8192.0;
override LEVEL: u32 = 0u;

const TABLE: u32 = 65536u;

struct AccParams {
  count: u32,
  flags: u32,        // bit 0: gravity on, bit 1: contacts on
  dt: f32,
  gGrain: f32,       // G * (mass of one grain)
  softening: f32,
  theta: f32,
  cellSize: f32,     // hash cell = grain diameter
  stiffness: f32,
  damping: f32,      // contact dashpot — the "stickiness" knob
  starGM: f32,       // 0 disables the central star
  starSoft: f32,
  confineR: f32,     // soft leash: beyond this radius, pull back
  confineK: f32,
  mouseRadius: f32,
  mouseStrength: f32,
  maxSpeed: f32,
  mouse: vec2f,
  mouseVel: vec2f,
}

@group(0) @binding(0) var<uniform> P: AccParams;
@group(0) @binding(1) var<storage, read_write> parts: array<vec4f>;
@group(0) @binding(2) var<storage, read> cellStart: array<u32>;
@group(0) @binding(3) var<storage, read> cellCount: array<u32>;
// Fixed-point accumulators, 4 words per finest cell: count, c*dx, c*dy, unused.
@group(0) @binding(4) var<storage, read_write> grid: array<atomic<u32>>;
@group(0) @binding(5) var<storage, read_write> nodes: array<vec4f>;
// World bounds as order-preserving u32 keys: minX, minY, maxX, maxY.
@group(0) @binding(6) var<storage, read_write> bounds: array<atomic<u32>, 4>;

// ---- hash grid (must match hashsort.wgsl) -----------------------------------

fn bucketOf(c: vec2i) -> u32 {
  let h = (u32(c.x) * 0x9E3779B1u) ^ (u32(c.y) * 0x85EBCA77u);
  return h & (TABLE - 1u);
}

// ---- pyramid plumbing (part one, mass = 1 per grain) ------------------------

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
    lo = parts[gid.x].xy;
    hi = lo;
  }
  wmin[lid.x] = lo;
  wmax[lid.x] = hi;
  workgroupBarrier();
  var s = 128u;
  loop {
    if (s == 0u) { break; }
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
fn scatter_mass(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= P.count) { return; }
  let rb = rootBox();
  let p = parts[i].xy;
  let gf = (p - rb.origin) / rb.size * f32(DIM);
  let gx = min(u32(max(gf.x, 0.0)), DIM - 1u);
  let gy = min(u32(max(gf.y, 0.0)), DIM - 1u);
  let frac = gf - vec2f(f32(gx) + 0.5, f32(gy) + 0.5);
  let c = (gy * DIM + gx) * 4u;
  atomicAdd(&grid[c], u32(round(FP_SCALE)));
  atomicAdd(&grid[c + 1u], bitcast<u32>(i32(round(frac.x * FP_SCALE))));
  atomicAdd(&grid[c + 2u], bitcast<u32>(i32(round(frac.y * FP_SCALE))));
}

@compute @workgroup_size(256)
fn resolve(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= DIM * DIM) { return; }
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
  if (i >= dim * dim) { return; }
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

// ---- the marriage: one force kernel, both structures ------------------------

@compute @workgroup_size(256)
fn force(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= P.count) { return; }
  let b = parts[i];
  let pos = b.xy;
  var vel = b.zw;
  var acc = vec2f(0.0);

  // -- far field: walk part one's pyramid (node mass = grain count) --
  if ((P.flags & 1u) != 0u) {
    let rb = rootBox();
    let gf = (pos - rb.origin) / rb.size * f32(DIM);
    let myIx = min(u32(max(gf.x, 0.0)), DIM - 1u);
    let myIy = min(u32(max(gf.y, 0.0)), DIM - 1u);
    let eps2 = P.softening * P.softening;
    let theta2 = P.theta * P.theta;

    var stack: array<u32, 44>;
    var sp: i32 = 1;
    stack[0] = 0u;
    loop {
      if (sp == 0) { break; }
      sp = sp - 1;
      let e = stack[sp];
      let lvl = e >> 28u;
      let ix = e & 0x3FFFu;
      let iy = (e >> 14u) & 0x3FFFu;
      let ldim = 1u << lvl;
      let n = nodes[levelOffset(lvl) + iy * ldim + ix];
      if (n.z <= 0.0) { continue; }
      let d0 = n.xy - pos;
      let r2 = dot(d0, d0) + eps2;
      let w = rb.size / f32(ldim);
      if (lvl == FINEST) {
        var m = n.z;
        var com = n.xy;
        if (ix == myIx && iy == myIy) {
          // Remove self (one grain) from the cell's lump.
          m = m - 1.0;
          if (m <= 1e-6) { continue; }
          com = (n.xy * n.z - pos) / m;
        }
        let d = com - pos;
        let rr = dot(d, d) + eps2;
        acc = acc + d * (P.gGrain * m / (rr * sqrt(rr)));
      } else if (w * w < theta2 * r2) {
        acc = acc + d0 * (P.gGrain * n.z / (r2 * sqrt(r2)));
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
  }

  // -- the star: one heavy body, applied analytically, pinned at the origin --
  if (P.starGM > 0.0) {
    let r2 = dot(pos, pos) + P.starSoft * P.starSoft;
    acc = acc - pos * (P.starGM / (r2 * sqrt(r2)));
  }

  // -- near field: part three's 9-cell query, through the hash --
  if ((P.flags & 2u) != 0u) {
    let dia = P.cellSize;
    let cc = vec2i(floor(pos / dia));
    // Two of my 9 cells can hash to the same bucket; visiting it twice would
    // double every contact in it, so dedupe the bucket list first.
    var seen: array<u32, 9>;
    var ns = 0;
    for (var oy = -1; oy <= 1; oy++) {
      for (var ox = -1; ox <= 1; ox++) {
        let bkt = bucketOf(cc + vec2i(ox, oy));
        var dup = false;
        for (var k = 0; k < ns; k++) {
          if (seen[k] == bkt) { dup = true; }
        }
        if (dup) { continue; }
        seen[ns] = bkt;
        ns = ns + 1;
        let s = cellStart[bkt];
        let n = cellCount[bkt];
        for (var k = s; k < s + n; k++) {
          if (k == i) { continue; }
          let d = pos - parts[k].xy;
          let r = length(d);
          // The distance test is also the impostor filter: a grain from a
          // far-away cell sharing this bucket can never pass it.
          if (r < dia && r > 1e-7) {
            let nrm = d / r;
            acc += nrm * (dia - r) * P.stiffness;
            let vn = dot(vel - parts[k].zw, nrm);
            acc -= nrm * vn * P.damping;
          }
        }
      }
    }
  }

  // -- cursor stir + soft leash so ejecta can't drag the root box away --
  let md = pos - P.mouse;
  let mr = length(md);
  if (mr < P.mouseRadius) {
    acc += P.mouseVel * P.mouseStrength * (1.0 - mr / P.mouseRadius);
  }
  let rad = length(pos);
  if (rad > P.confineR) {
    acc -= pos / rad * (rad - P.confineR) * P.confineK;
  }

  vel = vel + acc * P.dt;
  let spd = length(vel);
  if (spd > P.maxSpeed) {
    vel = vel * (P.maxSpeed / spd);
  }
  parts[i] = vec4f(pos + vel * P.dt, vel);
}
