import{g as re,S as te,a as ae,c as ie,i as le,m as ce}from"./gpu-BLPsBJnk.js";import{P as Q}from"./particleRenderer-LiyiEjJ-.js";import{s as Z,c as ue,a as de,i as fe,d as he}from"./contactsCpu-CPaXehhf.js";import{m as ge,P as U,a as K,l as H,p as Y,r as me}from"./scrolly-CD69uhsv.js";const pe=`// Part four's whole point in one file: both structures over one buffer.
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
`,be=`// Counting sort over a *hashed* grid: same histogram / scan / scatter as
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

const TABLE: u32 = 65536u; // buckets; power of two so modulo is a mask

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
  let v0 = blockSums[lid.x];
  sa[lid.x] = v0;
  workgroupBarrier();
  let inclusive = scanShared(lid.x);
  blockSums[lid.x] = inclusive - v0;
}

@compute @workgroup_size(256)
fn scan_add(
  @builtin(global_invocation_id) gid: vec3u,
  @builtin(workgroup_id) wid: vec3u,
) {
  starts[gid.x] = starts[gid.x] + blockSums[wid.x];
}

// ---- pass 3: scatter into bucket order --------------------------------------

@compute @workgroup_size(256)
fn scatter(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= GP.count) { return; }
  let p = partsIn[gid.x];
  let slot = atomicAdd(&cursor[cellOf(p.xy)], 1u);
  sorted[slot] = p;
}
`,$=65536,ne=256,J=$/ne;class ye{counts;starts;dev;params;blockSums;cursor;layout;pipes={};constructor(t){this.dev=t;const e=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC;this.params=t.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.counts=t.createBuffer({size:$*4,usage:e}),this.starts=t.createBuffer({size:$*4,usage:e}),this.blockSums=t.createBuffer({size:J*4,usage:e}),this.cursor=t.createBuffer({size:$*4,usage:e});const r=o=>({type:o});this.layout=t.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:r("uniform")},{binding:1,visibility:GPUShaderStage.COMPUTE,buffer:r("read-only-storage")},{binding:2,visibility:GPUShaderStage.COMPUTE,buffer:r("storage")},{binding:3,visibility:GPUShaderStage.COMPUTE,buffer:r("storage")},{binding:4,visibility:GPUShaderStage.COMPUTE,buffer:r("storage")},{binding:5,visibility:GPUShaderStage.COMPUTE,buffer:r("storage")},{binding:6,visibility:GPUShaderStage.COMPUTE,buffer:r("storage")}]});const d=t.createShaderModule({code:be}),s=t.createPipelineLayout({bindGroupLayouts:[this.layout]});for(const o of["count","scan_blocks","scan_sums","scan_add","scatter"])this.pipes[o]=t.createComputePipeline({layout:s,compute:{module:d,entryPoint:o}})}bindGroup(t,e){return this.dev.createBindGroup({layout:this.layout,entries:[{binding:0,resource:{buffer:this.params}},{binding:1,resource:{buffer:t}},{binding:2,resource:{buffer:this.counts}},{binding:3,resource:{buffer:this.starts}},{binding:4,resource:{buffer:this.blockSums}},{binding:5,resource:{buffer:this.cursor}},{binding:6,resource:{buffer:e}}]})}writeParams(t,e){const r=new DataView(new ArrayBuffer(16));r.setUint32(0,t,!0),r.setFloat32(8,e,!0),this.dev.queue.writeBuffer(this.params,0,r.buffer)}encode(t,e,r){const d=Math.ceil(r/ne);t.clearBuffer(this.counts);let s=t.beginComputePass();s.setBindGroup(0,e),s.setPipeline(this.pipes.count),s.dispatchWorkgroups(d),s.setPipeline(this.pipes.scan_blocks),s.dispatchWorkgroups(J),s.setPipeline(this.pipes.scan_sums),s.dispatchWorkgroups(1),s.setPipeline(this.pipes.scan_add),s.dispatchWorkgroups(J),s.end(),t.copyBufferToBuffer(this.starts,0,this.cursor,0,$*4),s=t.beginComputePass(),s.setBindGroup(0,e),s.setPipeline(this.pipes.scatter),s.dispatchWorkgroups(d),s.end()}dispose(){for(const t of[this.params,this.counts,this.starts,this.blockSums,this.cursor])t.destroy()}}const X=256,V=8,N=1<<V,ee=8192;function ve(p){return((1<<2*p)-1)/3}class ke{sort;dev;params;grid;nodes;bounds;pClear;pBounds;pScatter;pResolve;pReduce=[];pForce;gClear;gResolve;gReduce=[];gBounds=[];gScatter=[];gForce=[];gSort=[];constructor(t){this.dev=t,this.sort=new ye(t),this.params=t.createBuffer({size:80,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC});const e=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC;this.grid=t.createBuffer({size:N*N*16,usage:e}),this.nodes=t.createBuffer({size:ve(V+1)*16,usage:e}),this.bounds=t.createBuffer({size:16,usage:e});const r=t.createShaderModule({code:pe}),d=(i,b={})=>t.createComputePipeline({layout:"auto",compute:{module:r,entryPoint:i,constants:b}}),s={FINEST:V,DIM:N,FP_SCALE:ee};this.pClear=d("clear_grid",{DIM:N}),this.pBounds=d("reduce_bounds"),this.pScatter=d("scatter_mass",{DIM:N,FP_SCALE:ee}),this.pResolve=d("resolve",s),this.pForce=d("force",s);for(let i=0;i<V;i++)this.pReduce.push(d("reduce",{LEVEL:i}));const o=(i,b)=>t.createBindGroup({layout:i.getBindGroupLayout(0),entries:b.map(([F,_])=>({binding:F,resource:{buffer:_}}))});this.gClear=o(this.pClear,[[4,this.grid],[6,this.bounds]]),this.gResolve=o(this.pResolve,[[4,this.grid],[5,this.nodes],[6,this.bounds]]);for(let i=0;i<V;i++)this.gReduce.push(o(this.pReduce[i],[[5,this.nodes]]))}setBuffers(t){const e=(r,d)=>this.dev.createBindGroup({layout:r.getBindGroupLayout(0),entries:d.map(([s,o])=>({binding:s,resource:{buffer:o}}))});this.gSort=[this.sort.bindGroup(t[0],t[1]),this.sort.bindGroup(t[1],t[0])],this.gBounds=[],this.gScatter=[],this.gForce=[];for(const r of t)this.gBounds.push(e(this.pBounds,[[0,this.params],[1,r],[6,this.bounds]])),this.gScatter.push(e(this.pScatter,[[0,this.params],[1,r],[4,this.grid],[6,this.bounds]])),this.gForce.push(e(this.pForce,[[0,this.params],[1,r],[2,this.sort.starts],[3,this.sort.counts],[5,this.nodes],[6,this.bounds]]))}writeParams(t){this.sort.writeParams(t.count,t.cellSize);const e=new DataView(new ArrayBuffer(80));e.setUint32(0,t.count,!0),e.setUint32(4,(t.gravity?1:0)|(t.contacts?2:0),!0),e.setFloat32(8,t.dt,!0),e.setFloat32(12,t.gGrain,!0),e.setFloat32(16,t.softening,!0),e.setFloat32(20,t.theta,!0),e.setFloat32(24,t.cellSize,!0),e.setFloat32(28,t.stiffness,!0),e.setFloat32(32,t.damping,!0),e.setFloat32(36,t.starGM,!0),e.setFloat32(40,t.starSoft,!0),e.setFloat32(44,t.confineR,!0),e.setFloat32(48,t.confineK,!0),e.setFloat32(52,t.mouseRadius,!0),e.setFloat32(56,t.mouseStrength,!0),e.setFloat32(60,t.maxSpeed,!0),e.setFloat32(64,t.mouse[0],!0),e.setFloat32(68,t.mouse[1],!0),e.setFloat32(72,t.mouseVel[0],!0),e.setFloat32(76,t.mouseVel[1],!0),this.dev.queue.writeBuffer(this.params,0,e.buffer)}encode(t,e,r){const d=1-e;this.sort.encode(t,this.gSort[e],r);const s=Math.ceil(r/X),o=N*N,i=t.beginComputePass();i.setPipeline(this.pClear),i.setBindGroup(0,this.gClear),i.dispatchWorkgroups(Math.ceil(o*4/X)),i.setPipeline(this.pBounds),i.setBindGroup(0,this.gBounds[d]),i.dispatchWorkgroups(s),i.setPipeline(this.pScatter),i.setBindGroup(0,this.gScatter[d]),i.dispatchWorkgroups(s),i.setPipeline(this.pResolve),i.setBindGroup(0,this.gResolve),i.dispatchWorkgroups(Math.ceil(o/X));for(let b=V-1;b>=0;b--)i.setPipeline(this.pReduce[b]),i.setBindGroup(0,this.gReduce[b]),i.dispatchWorkgroups(Math.max(1,Math.ceil((1<<2*b)/X)));return i.setPipeline(this.pForce),i.setBindGroup(0,this.gForce[d]),i.dispatchWorkgroups(s),i.end(),d}dispose(){this.sort.dispose();for(const t of[this.params,this.grid,this.nodes,this.bounds])t.destroy()}}const we=.004,Pe=.007;function Se(p){const t=new Float32Array(p*4),e=.55,r=.35;for(let d=0;d<p;d++){const s=e*Math.sqrt(Math.random()),o=Math.random()*Math.PI*2,i=Math.cos(o)*s,b=Math.sin(o)*s;t[d*4]=i,t[d*4+1]=b,t[d*4+2]=-b*r+(Math.random()-.5)*.02,t[d*4+3]=i*r+(Math.random()-.5)*.02}return t}function xe(p,t){const e=new Float32Array(p*4),r=.32,d=.85;for(let s=0;s<p;s++){const o=Math.sqrt(r*r+(d*d-r*r)*Math.random()),i=Math.random()*Math.PI*2,b=Math.sqrt(t/o)*(1+(Math.random()-.5)*.02)*0,F=Math.cos(i)*o,_=Math.sin(i)*o;e[s*4]=F+(Math.random()-.5)*.004,e[s*4+1]=_+(Math.random()-.5)*.004,e[s*4+2]=-_/o*b,e[s*4+3]=F/o*b}return e}window.__ACC_VERSION="debug-isolate-1";async function j(p,t){const e=await re(),r=new te(p,t.hero?.5:.7);if(!e)return ae(p);const d=ie(r.canvas,e),s=new Q(e,d),o=new ke(e),i=t.mode==="disk",b=r.canvas.width/r.canvas.height,F=i?1.05:1.45,_=.12,n=0,T=i?we:Pe;let x=t.count??8e3,h=4,L=30,v=t.physics!=="contacts",E=t.physics==="contacts"||(t.physics??"both")==="both",A=[null,null],l=0;const u=()=>{for(const M of A)M?.destroy();const g=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC;A=[e.createBuffer({size:x*16,usage:g}),e.createBuffer({size:x*16,usage:g})],e.queue.writeBuffer(A[0],0,i?xe(x,n):Se(x)),o.setBuffers(A),l=0};u();const k=e.createBuffer({size:16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});e.queue.writeBuffer(k,0,new Float32Array([0,0,6,0]));const I=i?new Q(e,d):null;I?.bind(k);let B=[99,99],G=[0,0],W=0;if(r.canvas.addEventListener("pointermove",g=>{const M=r.canvas.getBoundingClientRect(),z=(g.clientX-M.left)/M.width*2-1,R=-((g.clientY-M.top)/M.height*2-1),q=z*b/F,a=R/F,m=performance.now(),y=Math.min((m-W)/1e3,.1)||.016;if(W=m,B[0]<90){const c=(q-B[0])/y,w=(a-B[1])/y,S=Math.hypot(c,w),f=S>4?4/S:1;G=[G[0]*.6+c*f*.4,G[1]*.6+w*f*.4]}B=[q,a]}),r.canvas.addEventListener("pointerleave",()=>{B=[99,99],G=[0,0]}),!t.hero){if(t.mode==="collapse"){const g=(M,z,R)=>r.button(M,()=>{v=z,E=R,u()});g("gravity only",!0,!1),g("contacts only",!1,!0),g("both",!0,!0)}else r.slider({label:"grains",min:1e4,max:11e4,step:1e3,value:x,log:!0,format:g=>Math.round(g).toLocaleString(),onInput:g=>{x=Math.round(g),u()}});r.slider({label:"stickiness",min:0,max:80,step:1,value:L,format:g=>String(Math.round(g)),onInput:g=>L=g}),r.button("re-seed",u)}return r.setInfo(()=>{if(t.hero)return`${x.toLocaleString()} dust grains around one star — stir the ring`;const g=v&&E?"tree + grid":v?"tree only — ghosts":"grid only — loose sand";return`${x.toLocaleString()} grains · ${g} · sorted into ${$.toLocaleString()} buckets ${h}× per frame · stir with your cursor`}),t.hero||(window[`__ACC_${t.mode}`]={dev:e,solver:o,bufs:()=>A,cur:()=>l,count:()=>x}),{frame(){r.tick(),o.writeParams({count:x,gravity:v,contacts:E,dt:.0022,gGrain:_/x,softening:i?.012:.02,theta:.75,cellSize:T,stiffness:3e3,damping:L,starGM:n,starSoft:.05,confineR:i?1.4:.85,confineK:4,mouseRadius:.15,mouseStrength:40,maxSpeed:3,mouse:B,mouseVel:G});const g=e.createCommandEncoder();for(let M=0;M<h;M++)l=o.encode(g,l,x);s.bind(A[l]),s.encode(g,x,{scale:F,size:i?.0028:.0042,colorScale:i?1.4:2.5}),I?.encode(g,1,{scale:F,size:.035,colorScale:.2,load:!0}),e.queue.submit([g.finish()])},dispose(){o.dispose();for(const g of A)g?.destroy();k.destroy()}}}const C=24,Me=.92,O=3500;function _e(p){const t=new te(p),e=t.canvas.getContext("2d");let r=Z(O);const d=new Float32Array(O),s=new Float32Array(O);let o=128;const i=ue(t),b=(h,L)=>[Math.min(C-1,Math.max(0,Math.floor((h+1)/2*C))),Math.min(C-1,Math.max(0,Math.floor((L+1)/2*C)))],F=(h,L)=>((Math.imul(h,2654435761)^Math.imul(L,2246822519))>>>0)%o;let _=new Int32Array(o),n=new Int32Array(o+1);const T=new Int32Array(O),x=()=>{_=new Int32Array(o),n=new Int32Array(o+1)};return t.slider({label:"hash table buckets",min:32,max:4096,step:1,value:o,log:!0,format:h=>String(1<<Math.round(Math.log2(h))),onInput:h=>{o=1<<Math.round(Math.log2(h)),x()}}),t.button("re-seed",()=>r=Z(O)),{frame(){t.tick();const h=r.state;_.fill(0);for(let a=0;a<O;a++){const[m,y]=b(h[a*4],h[a*4+1]);_[F(m,y)]++}let L=0;for(let a=0;a<o;a++)n[a]=L,L+=_[a];n[o]=L;const v=n.slice(0,o);for(let a=0;a<O;a++){const[m,y]=b(h[a*4],h[a*4+1]);T[v[F(m,y)]++]=a}d.fill(0),s.fill(0);for(let a=0;a<O;a++){const[m,y]=b(h[a*4],h[a*4+1]),c=[];for(let w=-1;w<=1;w++)for(let S=-1;S<=1;S++){const f=F(m+S,y+w);if(!c.includes(f)){c.push(f);for(let P=n[f];P<n[f+1];P++){const D=T[P];D<=a||de(h,a,D,d,s)}}}}fe(h,O,d,s,{dt:.016,mouse:i.get()}),he(e,r,null);const{width:E,height:A}=e.canvas,l=Math.min(E,A)/2*Me,u=E/2,k=A/2,I=l*2/C;e.strokeStyle="rgba(80, 90, 120, 0.22)",e.lineWidth=1,e.beginPath();for(let a=0;a<=C;a++)e.moveTo(u-l+a*I,k-l),e.lineTo(u-l+a*I,k+l),e.moveTo(u-l,k-l+a*I),e.lineTo(u+l,k-l+a*I);e.stroke();const B=i.get();if(!B||Math.abs(B[0])>=1||Math.abs(B[1])>=1){t.readout.textContent=`${O.toLocaleString()} discs · ${C*C} cells share ${o} buckets — point at the pile`;return}const[G,W]=b(B[0],B[1]),g=new Set,M=new Set;for(let a=-1;a<=1;a++)for(let m=-1;m<=1;m++){const y=G+m,c=W+a;y<0||c<0||y>=C||c>=C||(g.add(c*C+y),M.add(F(y,c)))}e.strokeStyle="rgba(255, 95, 95, 0.5)",e.fillStyle="rgba(255, 95, 95, 0.07)",e.beginPath();for(let a=0;a<C;a++)for(let m=0;m<C;m++)g.has(a*C+m)||!M.has(F(m,a))||e.rect(u-l+m*I,k+l-(a+1)*I,I,I);e.fill(),e.stroke(),e.strokeStyle="rgba(255, 205, 80, 0.55)",e.fillStyle="rgba(255, 205, 80, 0.06)",e.beginPath();for(const a of g){const m=a%C,y=Math.floor(a/C);e.rect(u-l+m*I,k+l-(y+1)*I,I,I)}e.fill(),e.stroke();let z=0,R=0;const q=a=>{const m=u+h[a*4]*l,y=k-h[a*4+1]*l;e.moveTo(m+2.2,y),e.arc(m,y,2.2,0,Math.PI*2)};e.fillStyle="rgb(255, 220, 110)",e.beginPath();for(const a of M)for(let m=n[a];m<n[a+1];m++){const y=T[m],[c,w]=b(h[y*4],h[y*4+1]);g.has(w*C+c)&&(z++,q(y))}e.fill(),e.fillStyle="rgb(255, 110, 110)",e.beginPath();for(const a of M)for(let m=n[a];m<n[a+1];m++){const y=T[m],[c,w]=b(h[y*4],h[y*4+1]);g.has(w*C+c)||(R++,q(y))}e.fill(),t.readout.textContent=`9 cells → ${M.size} buckets → ${z+R} candidates: ${z} real, ${R} impostors for the distance test to discard`}}}function Be(p){const t=me(23),e=[],r=[],d=.34;for(let n=0;n<420;n++){const T=t()*Math.PI*2,x=Math.sin(T*3+1.2)*.5+.5,h=d+(t()-.5)*(.05+.05*(1-x));e.push(.5+Math.cos(T)*h),r.push(.5+Math.sin(T)*h*.92)}const s=.5+d,o=.5;for(let n=0;n<7;n++)e.push(s+(t()-.5)*.045),r.push(o+(t()-.5)*.045);const i=e.length,b=[],F=7;for(let n=0;n<F;n++){const T=Math.PI*.25+n/F*Math.PI*1.5,x=Math.PI*.25+(n+1)/F*Math.PI*1.5;let h=0,L=0,v=0,E=1,A=1,l=0,u=0;for(let k=0;k<i;k++){const B=(Math.atan2(r[k]-.5,e[k]-.5)-Math.PI*.25+Math.PI*4)%(Math.PI*2);B<(T-Math.PI*.25+Math.PI*4)%(Math.PI*2)||B>=(x-Math.PI*.25+Math.PI*4)%(Math.PI*2)||(h+=e[k],L+=r[k],v++,E=Math.min(E,e[k]),A=Math.min(A,r[k]),l=Math.max(l,e[k]),u=Math.max(u,r[k]))}v>4&&b.push({cx:h/v,cy:L/v,count:v,boxX:E-.01,boxY:A-.01,boxW:l-E+.02,boxH:u-A+.02})}const _=.03;ge(p,{screens:4,aspect:.62,steps:[{at:0,text:"A ring of dust around a star. Follow one grain (blue). Each substep it needs two answers: the pull of the whole ring, and the shove of whatever it's touching."},{at:.18,text:"Far field — the pyramid. Distant stretches of ring collapse into single point masses (orange), part one's tree walk. The star isn't even in the buffer: one analytic GM/r² term."},{at:.48,text:"Near field — the hash grid. Cells one grain-diameter wide; only the 3×3 block around the grain is searched. Touching neighbours push back, and the dashpot in that push bleeds off energy."},{at:.78,text:"One kernel asks both structures, adds the arrows, integrates. The structures never talk to each other — they don't even use the same cell size."}],draw(n,T,x,h){const v=Math.min(T-20,x-20),E=(T-v)/2,A=(x-v)/2,l=c=>E+c*v,u=c=>A+c*v,k=Y(h,0,.1),I=Y(h,.18,.46),B=Y(h,.48,.76),G=Y(h,.78,.97);n.save(),n.globalAlpha=k;const W=n.createRadialGradient(l(.5),u(.5),0,l(.5),u(.5),v*.05);W.addColorStop(0,"#fff6da"),W.addColorStop(1,"rgba(255, 214, 130, 0)"),n.fillStyle=W,n.beginPath(),n.arc(l(.5),u(.5),v*.05,0,Math.PI*2),n.fill(),n.restore();for(let c=0;c<i;c++)n.globalAlpha=.8*k,n.fillStyle=U.dot,n.beginPath(),n.arc(l(e[c]),u(r[c]),1.6,0,Math.PI*2),n.fill();n.globalAlpha=1;let g=0,M=0;b.forEach((c,w)=>{const S=Y(I,w/b.length*.7,w/b.length*.7+.3);if(S<=0)return;const f=Math.hypot(c.cx-s,c.cy-o),P=c.count/(f*f+.05);g+=(c.cx-s)/f*P,M+=(c.cy-o)/f*P,n.save(),n.globalAlpha=.7*S*(1-.7*G),n.strokeStyle=U.warm,n.lineWidth=1,n.strokeRect(l(c.boxX),u(c.boxY),c.boxW*v,c.boxH*v),n.fillStyle=U.warm,n.beginPath(),n.arc(l(c.cx),u(c.cy),2+2.2*S*Math.sqrt(c.count/80),0,Math.PI*2),n.fill(),n.globalAlpha=.4*S*(1-.7*G),n.strokeStyle=U.warm,n.setLineDash([3,5]),n.beginPath(),n.moveTo(l(c.cx),u(c.cy)),n.lineTo(l(s),u(o)),n.stroke(),n.restore()});const z=Math.hypot(.5-s,.5-o),R=700/(z*z);g+=(.5-s)/z*R*.004,M+=(.5-o)/z*R*.004;let q=0,a=0;if(B>0){const c=Math.floor(s/_)*_,w=Math.floor(o/_)*_;n.save();for(let f=-1;f<=1;f++)for(let P=-1;P<=1;P++){const D=Y(B,0,.4);n.globalAlpha=.8*D*(1-.5*G),n.strokeStyle=U.accent,n.lineWidth=1,n.strokeRect(l(c+P*_),u(w+f*_),_*v,_*v)}n.restore();const S=Y(B,.4,1);for(let f=0;f<i;f++){const P=Math.hypot(e[f]-s,r[f]-o);if(P<1e-6||P>.028)continue;const D=(.028-P)/.028;if(q-=(e[f]-s)/P*D*3,a-=(r[f]-o)/P*D*3,S>0){n.save(),n.globalAlpha=S*(1-.5*G),n.fillStyle=U.red,n.beginPath(),n.arc(l(e[f]),u(r[f]),2.6,0,Math.PI*2),n.fill();const se=l(s)-(e[f]-s)/P*D*v*.06,oe=u(o)-(r[f]-o)/P*D*v*.06;K(n,l(s),u(o),se,oe,U.red,1.6,6),n.restore()}}}const m=(c,w,S)=>{const f=Math.hypot(c,w)||1;return[c/f*S,w/f*S]};if(G>0){const c=v*.13,[w,S]=m(g,M,c*G),[f,P]=m(q,a,c*.7*G);K(n,l(s),u(o),l(s)+w,u(o)+S,U.warm,2,7),K(n,l(s),u(o),l(s)+f,u(o)+P,U.red,2,7),n.save(),n.globalAlpha=.35*G,n.strokeStyle=U.muted,n.setLineDash([3,4]),n.beginPath(),n.moveTo(l(s)+w,u(o)+S),n.lineTo(l(s)+w+f,u(o)+S+P),n.moveTo(l(s)+f,u(o)+P),n.lineTo(l(s)+w+f,u(o)+S+P),n.stroke(),n.restore(),K(n,l(s),u(o),l(s)+w+f,u(o)+S+P,"#ffffff",2.6,9),H(n,"gravity (pyramid)",l(s)+w+6,u(o)+S+10,{color:U.warm,size:10,alpha:G}),H(n,"contact (grid)",l(s)+f+6,u(o)+P-8,{color:U.red,size:10,alpha:G})}n.fillStyle=U.accent,n.beginPath(),n.arc(l(s),u(o),4.5,0,Math.PI*2),n.fill(),n.strokeStyle="#fff",n.lineWidth=1,n.stroke();const y=G>0?"force = far + near":B>0?"near field: 3×3 cells":I>0?"far field: tree walk":"";y&&H(n,y,T-16,22,{color:U.muted,size:12,align:"right",mono:!0})}})}le();const Fe={"hero-disk":p=>j(p,{mode:"disk",hero:!0}),ghosts:p=>j(p,{mode:"collapse",physics:"gravity"}),hash:_e,collapse:p=>j(p,{mode:"collapse",physics:"both"}),disk:p=>j(p,{mode:"disk"})};for(const p of document.querySelectorAll("[data-demo]")){const t=p.dataset.demo,e=Fe[t];e&&ce(p,()=>e(p))}const Ie={"two-structures":Be};for(const p of document.querySelectorAll("[data-scrolly]"))Ie[p.dataset.scrolly]?.(p);
