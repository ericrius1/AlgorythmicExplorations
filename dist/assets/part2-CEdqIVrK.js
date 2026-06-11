import{g as q,S as A,a as G,c as U,i as j,m as $}from"./gpu-DqzAFztT.js";import{O as Y}from"./camera3d-_003W6Cq.js";import{G as F,T as B}from"./seed-DVlONlXS.js";import{m as Q,P as p,b as z,a as C,p as E}from"./scrolly-Bq15bFnz.js";const X=`// The part-one tiled O(n²) kernel, in 3D. Mass rides in pos.w, so a tile is
// a single vec4 per body: position and mass in one fetch.

struct SimParams {
  count: u32,
  dt: f32,
  g: f32,
  softening: f32,
}

@group(0) @binding(0) var<uniform> P: SimParams;
@group(0) @binding(1) var<storage, read> inPos: array<vec4f>;
@group(0) @binding(2) var<storage, read> inVel: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> outPos: array<vec4f>;
@group(0) @binding(4) var<storage, read_write> outVel: array<vec4f>;

const TILE: u32 = 256u;
var<workgroup> tile: array<vec4f, 256>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u, @builtin(local_invocation_id) lid: vec3u) {
  let i = gid.x;
  let valid = i < P.count;
  var p = vec4f(0.0);
  var v = vec3f(0.0);
  if (valid) {
    p = inPos[i];
    v = inVel[i].xyz;
  }

  var acc = vec3f(0.0);
  let eps2 = P.softening * P.softening;
  let tiles = (P.count + TILE - 1u) / TILE;

  for (var t: u32 = 0u; t < tiles; t = t + 1u) {
    let j = t * TILE + lid.x;
    if (j < P.count) {
      tile[lid.x] = inPos[j];
    } else {
      tile[lid.x] = vec4f(0.0);
    }
    workgroupBarrier();
    for (var k: u32 = 0u; k < TILE; k = k + 1u) {
      let o = tile[k];
      let d = o.xyz - p.xyz;
      let r2 = dot(d, d) + eps2;
      acc = acc + d * (P.g * o.w / (r2 * sqrt(r2)));
    }
    workgroupBarrier();
  }

  if (valid) {
    v = v + acc * P.dt;
    outPos[i] = vec4f(p.xyz + v * P.dt, p.w);
    outVel[i] = vec4f(v, 0.0);
  }
}
`,Z=`// Perspective billboard renderer. Each body becomes a camera-facing quad;
// additive blending is commutative, so no depth sorting is ever needed.

struct Camera {
  viewProj: mat4x4f,
  right: vec4f, // xyz = camera right, w = particle size
  up: vec4f,    // xyz = camera up,    w = speed-to-color scale
}

@group(0) @binding(0) var<uniform> C: Camera;
@group(0) @binding(1) var<storage, read> pos: array<vec4f>;
@group(0) @binding(2) var<storage, read> vel: array<vec4f>;

struct VOut {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
  @location(1) color: vec3f,
}

const QUAD = array<vec2f, 6>(
  vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
  vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
);

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  let q = QUAD[vi];
  let world = pos[ii].xyz + (C.right.xyz * q.x + C.up.xyz * q.y) * C.right.w;
  var o: VOut;
  o.clip = C.viewProj * vec4f(world, 1.0);
  o.uv = q;
  let t = clamp(length(vel[ii].xyz) * C.up.w, 0.0, 1.0);
  o.color = mix(vec3f(0.22, 0.40, 1.0), vec3f(1.0, 0.45, 0.25), t);
  return o;
}

@fragment
fn fs(in: VOut) -> @location(0) vec4f {
  let d = length(in.uv);
  let a = smoothstep(1.0, 0.0, d);
  return vec4f(in.color * a, a);
}
`;class O{camera=new Y;dev;ctx;pipeline;params;group=null;constructor(n,e){this.dev=n,this.ctx=e;const u=n.createShaderModule({code:Z});this.pipeline=n.createRenderPipeline({layout:"auto",vertex:{module:u,entryPoint:"vs"},fragment:{module:u,entryPoint:"fs",targets:[{format:navigator.gpu.getPreferredCanvasFormat(),blend:{color:{srcFactor:"src-alpha",dstFactor:"one",operation:"add"},alpha:{srcFactor:"one",dstFactor:"one",operation:"add"}}}]},primitive:{topology:"triangle-list"}}),this.params=n.createBuffer({size:96,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST})}bind(n,e){this.group=this.dev.createBindGroup({layout:this.pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.params}},{binding:1,resource:{buffer:n}},{binding:2,resource:{buffer:e}}]})}encode(n,e,u={}){const i=this.ctx.canvas,{viewProj:r,right:s,up:t}=this.camera.matrices(i.width/i.height),a=new Float32Array(24);a.set(r,0),a.set(s,16),a[19]=u.size??.004,a.set(t,20),a[23]=u.colorScale??2,this.dev.queue.writeBuffer(this.params,0,a);const f=n.beginRenderPass({colorAttachments:[{view:this.ctx.getCurrentTexture().createView(),clearValue:{r:.024,g:.027,b:.043,a:1},loadOp:"clear",storeOp:"store"}]});f.setPipeline(this.pipeline),f.setBindGroup(0,this.group),f.draw(6,e),f.end()}}function M(){const o=Math.random()||1e-9,n=Math.random();return Math.sqrt(-2*Math.log(o))*Math.cos(2*Math.PI*n)}function K(o){const n={pos:new Float32Array(o*4),vel:new Float32Array(o*4),count:o};let e=0;for(let i=0;i<o;i++){const r=1+Math.random()*3;n.pos[i*4+3]=r,e+=r}const u=B/e;for(let i=0;i<o;i++)n.pos[i*4+3]*=u;return n}function V(o,n={}){const e=n.radius??.9,u=n.thickness??.06,i=.05,r=K(o);for(let s=0;s<o;s++){const t=e*Math.sqrt(Math.random()),a=Math.random()*Math.PI*2,f=B*(t*t/(e*e)),h=Math.sqrt(F*f/Math.sqrt(t*t+i*i));r.pos[s*4+0]=Math.cos(a)*t,r.pos[s*4+1]=Math.sin(a)*t,r.pos[s*4+2]=M()*u*(1-.6*t/e),r.vel[s*4+0]=-Math.sin(a)*h+M()*.1*h,r.vel[s*4+1]=Math.cos(a)*h+M()*.1*h,r.vel[s*4+2]=M()*.05*h}return r}function H(o,n={}){const e=n.radius??.9,u=n.spin??1,i=K(o);for(let r=0;r<o;r++){const s=Math.random(),t=Math.sqrt(Math.max(0,1-s*s)),a=Math.random()*Math.PI*2,f=Math.cos(a)*t,h=Math.sin(a)*t;i.pos[r*4+0]=f*e,i.pos[r*4+1]=h*e,i.pos[r*4+2]=s*e;const l=t*e,d=Math.sqrt(F*B*.5/Math.sqrt(l*l+.05*.05)),c=u*d*t;i.vel[r*4+0]=-Math.sin(a)*c+M()*.08*d,i.vel[r*4+1]=Math.cos(a)*c+M()*.08*d,i.vel[r*4+2]=M()*.04*d}return i}const J=256;async function ee(o){const n=await q(),e=new A(o);if(!n)return G(o);const u=U(e.canvas,n),i=new O(n,u);i.camera.attach(e.canvas);const r=n.createComputePipeline({layout:"auto",compute:{module:n.createShaderModule({code:X}),entryPoint:"main"}}),s=n.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});let t=25e3,a=[null,null],f=[null,null],h=[null,null],l=0;const d=()=>{const c=V(t);for(const b of[...a,...f])b?.destroy();const g=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST,m=b=>{const y=n.createBuffer({size:t*16,usage:g});return n.queue.writeBuffer(y,0,b),y};a=[m(c.pos),n.createBuffer({size:t*16,usage:g})],f=[m(c.vel),n.createBuffer({size:t*16,usage:g})];const v=(b,y)=>n.createBindGroup({layout:r.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:s}},{binding:1,resource:{buffer:a[b]}},{binding:2,resource:{buffer:f[b]}},{binding:3,resource:{buffer:a[y]}},{binding:4,resource:{buffer:f[y]}}]});h=[v(0,1),v(1,0)],l=0};return d(),e.slider({label:"bodies",min:2e3,max:6e4,step:1e3,value:t,log:!0,format:c=>Math.round(c).toLocaleString(),onInput:c=>{t=Math.round(c),d()}}),e.button("re-seed",d),e.setInfo(()=>"O(n²) in 3D · drag to orbit, ctrl+scroll to zoom"),{frame(){e.tick();const c=new DataView(new ArrayBuffer(16));c.setUint32(0,t,!0),c.setFloat32(4,.016,!0),c.setFloat32(8,F,!0),c.setFloat32(12,.05,!0),n.queue.writeBuffer(s,0,c.buffer);const g=n.createCommandEncoder(),m=g.beginComputePass();m.setPipeline(r),m.setBindGroup(0,h[l]),m.dispatchWorkgroups(Math.ceil(t/J)),m.end(),l=1-l,i.bind(a[l],f[l]),i.encode(g,t,{size:.005}),n.queue.submit([g.finish()])}}}const ne=`// The 2D pyramid from part one, promoted to 3D: quadtree -> octree.
// Children of cell (level, ix, iy, iz) are (level+1, 2ix+dx, 2iy+dy, 2iz+dz).
// Levels are flat slabs of one buffer; level l starts at (8^l - 1) / 7.
//
// Bodies are two buffers: pos = vec4(x, y, z, mass), vel = vec4(vx, vy, vz, 0).
// The force kernel only ever reads its own body, so it integrates in place.
//
// The optional dome constraint is just two more force terms: a spring pulling
// each body radially toward a shell of radius shellR, and a floor spring
// keeping it in the upper hemisphere. shellK = 0 turns the dome off entirely.

override FINEST: u32 = 7u;    // octree depth; finest grid is DIM^3
override DIM: u32 = 128u;     // 1 << FINEST
override FP_SCALE: f32 = 1.0; // fixed-point scale for the atomic accumulators
override LEVEL: u32 = 0u;     // which level a reduce pipeline writes

struct SimParams {
  count: u32,
  dt: f32,
  g: f32,
  softening: f32,
  theta: f32,
  damping: f32,
  shellR: f32,
  shellK: f32,
}

@group(0) @binding(0) var<uniform> P: SimParams;
@group(0) @binding(1) var<storage, read_write> pos: array<vec4f>;  // xyz + mass
@group(0) @binding(2) var<storage, read_write> vel: array<vec4f>;  // xyz + pad
// 4 words per finest cell: mass (u32), m*dx, m*dy, m*dz (i32 bit patterns).
@group(0) @binding(4) var<storage, read_write> grid: array<atomic<u32>>;
// One vec4 per octree node: com.xyz, mass.
@group(0) @binding(5) var<storage, read_write> nodes: array<vec4f>;
// World bounds as order-preserving u32 keys: minX..minZ, maxX..maxZ.
@group(0) @binding(6) var<storage, read_write> bounds: array<atomic<u32>, 8>;

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
  origin: vec3f,
  size: f32,
}

fn rootBox() -> RootBox {
  let mn = vec3f(
    keyToFloat(atomicLoad(&bounds[0])),
    keyToFloat(atomicLoad(&bounds[1])),
    keyToFloat(atomicLoad(&bounds[2])),
  );
  let mx = vec3f(
    keyToFloat(atomicLoad(&bounds[4])),
    keyToFloat(atomicLoad(&bounds[5])),
    keyToFloat(atomicLoad(&bounds[6])),
  );
  let c = (mn + mx) * 0.5;
  let half = max(max(max(mx.x - mn.x, mx.y - mn.y), mx.z - mn.z) * 0.5, 1e-6) * 1.0001;
  var r: RootBox;
  r.origin = c - vec3f(half);
  r.size = half * 2.0;
  return r;
}

// Levels 0..l-1 hold (8^l - 1) / 7 nodes.
fn levelOffset(l: u32) -> u32 {
  return ((1u << (3u * l)) - 1u) / 7u;
}

@compute @workgroup_size(256)
fn clear_grid(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i < 8u) {
    atomicStore(&bounds[i], select(0u, 0xFFFFFFFFu, i < 4u));
  }
  if (i < DIM * DIM * DIM * 4u) {
    atomicStore(&grid[i], 0u);
  }
}

var<workgroup> wmin: array<vec3f, 256>;
var<workgroup> wmax: array<vec3f, 256>;

@compute @workgroup_size(256)
fn reduce_bounds(@builtin(global_invocation_id) gid: vec3u, @builtin(local_invocation_id) lid: vec3u) {
  var lo = vec3f(3.4e38);
  var hi = vec3f(-3.4e38);
  if (gid.x < P.count) {
    lo = pos[gid.x].xyz;
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
    atomicMin(&bounds[2], floatToKey(wmin[0].z));
    atomicMax(&bounds[4], floatToKey(wmax[0].x));
    atomicMax(&bounds[5], floatToKey(wmax[0].y));
    atomicMax(&bounds[6], floatToKey(wmax[0].z));
  }
}

@compute @workgroup_size(256)
fn scatter(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= P.count) {
    return;
  }
  let rb = rootBox();
  let b = pos[i];
  let m = b.w;
  let gf = (b.xyz - rb.origin) / rb.size * f32(DIM);
  let gx = min(u32(max(gf.x, 0.0)), DIM - 1u);
  let gy = min(u32(max(gf.y, 0.0)), DIM - 1u);
  let gz = min(u32(max(gf.z, 0.0)), DIM - 1u);
  let frac = gf - vec3f(f32(gx) + 0.5, f32(gy) + 0.5, f32(gz) + 0.5);
  let c = ((gz * DIM + gy) * DIM + gx) * 4u;
  atomicAdd(&grid[c], u32(round(m * FP_SCALE)));
  atomicAdd(&grid[c + 1u], bitcast<u32>(i32(round(m * frac.x * FP_SCALE))));
  atomicAdd(&grid[c + 2u], bitcast<u32>(i32(round(m * frac.y * FP_SCALE))));
  atomicAdd(&grid[c + 3u], bitcast<u32>(i32(round(m * frac.z * FP_SCALE))));
}

@compute @workgroup_size(256)
fn resolve(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= DIM * DIM * DIM) {
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
  let sz = f32(bitcast<i32>(atomicLoad(&grid[i * 4u + 3u]))) / FP_SCALE;
  let rb = rootBox();
  let cell = rb.size / f32(DIM);
  let ix = i % DIM;
  let iy = (i / DIM) % DIM;
  let iz = i / (DIM * DIM);
  let center = rb.origin + (vec3f(f32(ix), f32(iy), f32(iz)) + 0.5) * cell;
  let com = center + vec3f(sx, sy, sz) / m * cell;
  nodes[out] = vec4f(com, m);
}

@compute @workgroup_size(256)
fn reduce(@builtin(global_invocation_id) gid: vec3u) {
  let dim = 1u << LEVEL;
  let i = gid.x;
  if (i >= dim * dim * dim) {
    return;
  }
  let ix = i % dim;
  let iy = (i / dim) % dim;
  let iz = i / (dim * dim);
  let fineOff = levelOffset(LEVEL + 1u);
  let fdim = dim * 2u;
  var m = 0.0;
  var w = vec3f(0.0);
  for (var q = 0u; q < 8u; q = q + 1u) {
    let cx = ix * 2u + (q & 1u);
    let cy = iy * 2u + ((q >> 1u) & 1u);
    let cz = iz * 2u + (q >> 2u);
    let n = nodes[fineOff + (cz * fdim + cy) * fdim + cx];
    m = m + n.w;
    w = w + n.xyz * n.w;
  }
  var out = vec4f(0.0);
  if (m > 0.0) {
    out = vec4f(w / m, m);
  }
  nodes[levelOffset(LEVEL) + i] = out;
}

@compute @workgroup_size(256)
fn force(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= P.count) {
    return;
  }
  let b = pos[i];
  let p = b.xyz;
  let myMass = b.w;
  var v = vel[i].xyz;

  let rb = rootBox();
  let gf = (p - rb.origin) / rb.size * f32(DIM);
  let myIx = min(u32(max(gf.x, 0.0)), DIM - 1u);
  let myIy = min(u32(max(gf.y, 0.0)), DIM - 1u);
  let myIz = min(u32(max(gf.z, 0.0)), DIM - 1u);

  let eps2 = P.softening * P.softening;
  let theta2 = P.theta * P.theta;
  var acc = vec3f(0.0);

  // Entries pack level (4 bits) | iz | iy | ix (9 bits each). An octree pop
  // pushes 8, so the stack peaks at 7*FINEST+8; 64 covers FINEST = 7.
  var stack: array<u32, 64>;
  var sp: i32 = 1;
  stack[0] = 0u;

  loop {
    if (sp == 0) {
      break;
    }
    sp = sp - 1;
    let e = stack[sp];
    let lvl = e >> 28u;
    let ix = e & 0x1FFu;
    let iy = (e >> 9u) & 0x1FFu;
    let iz = (e >> 18u) & 0x1FFu;
    let ldim = 1u << lvl;
    let n = nodes[levelOffset(lvl) + (iz * ldim + iy) * ldim + ix];
    if (n.w <= 0.0) {
      continue;
    }
    let d0 = n.xyz - p;
    let r2 = dot(d0, d0) + eps2;
    let w = rb.size / f32(ldim);
    if (lvl == FINEST) {
      var m = n.w;
      var com = n.xyz;
      if (ix == myIx && iy == myIy && iz == myIz) {
        m = m - myMass;
        if (m <= 1e-9) {
          continue;
        }
        com = (n.xyz * n.w - p * myMass) / m;
      }
      let d = com - p;
      let rr = dot(d, d) + eps2;
      acc = acc + d * (P.g * m / (rr * sqrt(rr)));
    } else if (w * w < theta2 * r2) {
      acc = acc + d0 * (P.g * n.w / (r2 * sqrt(r2)));
    } else if (sp <= 55) {
      let cl = lvl + 1u;
      let bx = ix * 2u;
      let by = iy * 2u;
      let bz = iz * 2u;
      for (var q = 0u; q < 8u; q = q + 1u) {
        stack[sp] = (cl << 28u)
          | ((bz + (q >> 2u)) << 18u)
          | ((by + ((q >> 1u) & 1u)) << 9u)
          | (bx + (q & 1u));
        sp = sp + 1;
      }
    }
  }

  // The dome: a constraint is just another force. A radial spring holds each
  // body near a shell of radius shellR, and a floor spring keeps it in the
  // upper hemisphere. shellK = 0 disables both and gravity runs free in 3D.
  if (P.shellK > 0.0) {
    let r = length(p);
    let rhat = p / max(r, 1e-6);
    acc = acc - rhat * (r - P.shellR) * P.shellK;
    if (p.z < 0.0) {
      acc.z = acc.z - p.z * P.shellK * 4.0;
    }
  }

  v = (v + acc * P.dt) * P.damping;
  pos[i] = vec4f(p + v * P.dt, myMass);
  vel[i] = vec4f(v, 0.0);
}
`,k=256,te=36e8;function ie(o){return(Math.pow(8,o)-1)/7}function oe(o){const n=Math.ceil(Math.log2(Math.max(o,2))/3);return Math.min(7,Math.max(4,n))}class R{count;finestLevel;gridDim;pos;vel;dt=.016;gScale=1;softening=.05;theta=.8;damping=1;shellR=.9;shellK=0;dev;simParams;grid;nodes;bounds;pClear;pBounds;pScatter;pResolve;pReduce=[];pForce;gClear;gBounds;gScatter;gResolve;gReduce=[];gForce;constructor(n,e){this.dev=n,this.count=e.count,this.finestLevel=oe(e.count),this.gridDim=1<<this.finestLevel;const u=this.gridDim**3,i=te/B,r=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST;this.pos=n.createBuffer({size:e.count*16,usage:r}),this.vel=n.createBuffer({size:e.count*16,usage:r}),n.queue.writeBuffer(this.pos,0,e.pos),n.queue.writeBuffer(this.vel,0,e.vel),this.simParams=n.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.grid=n.createBuffer({size:u*16,usage:GPUBufferUsage.STORAGE}),this.nodes=n.createBuffer({size:ie(this.finestLevel+1)*16,usage:GPUBufferUsage.STORAGE}),this.bounds=n.createBuffer({size:32,usage:GPUBufferUsage.STORAGE});const s=n.createShaderModule({code:ne}),t=(h,l)=>n.createComputePipeline({layout:"auto",compute:{module:s,entryPoint:h,constants:l}}),a={FINEST:this.finestLevel,DIM:this.gridDim,FP_SCALE:i};this.pClear=t("clear_grid",{DIM:this.gridDim}),this.pBounds=t("reduce_bounds",{}),this.pScatter=t("scatter",{DIM:this.gridDim,FP_SCALE:i}),this.pResolve=t("resolve",a),this.pForce=t("force",a);for(let h=0;h<this.finestLevel;h++)this.pReduce.push(t("reduce",{LEVEL:h}));const f=(h,l)=>n.createBindGroup({layout:h.getBindGroupLayout(0),entries:l.map(([d,c])=>({binding:d,resource:{buffer:c}}))});this.gClear=f(this.pClear,[[4,this.grid],[6,this.bounds]]),this.gBounds=f(this.pBounds,[[0,this.simParams],[1,this.pos],[6,this.bounds]]),this.gScatter=f(this.pScatter,[[0,this.simParams],[1,this.pos],[4,this.grid],[6,this.bounds]]),this.gResolve=f(this.pResolve,[[4,this.grid],[5,this.nodes],[6,this.bounds]]);for(let h=0;h<this.finestLevel;h++)this.gReduce.push(f(this.pReduce[h],[[5,this.nodes]]));this.gForce=f(this.pForce,[[0,this.simParams],[1,this.pos],[2,this.vel],[5,this.nodes],[6,this.bounds]])}writeParams(){const n=new ArrayBuffer(32),e=new DataView(n);e.setUint32(0,this.count,!0),e.setFloat32(4,this.dt,!0),e.setFloat32(8,F*this.gScale,!0),e.setFloat32(12,this.softening,!0),e.setFloat32(16,this.theta,!0),e.setFloat32(20,this.damping,!0),e.setFloat32(24,this.shellR,!0),e.setFloat32(28,this.shellK,!0),this.dev.queue.writeBuffer(this.simParams,0,n)}encode(n){const e=this.gridDim**3,u=Math.ceil(this.count/k);n.setPipeline(this.pClear),n.setBindGroup(0,this.gClear),n.dispatchWorkgroups(Math.ceil(e*4/k)),n.setPipeline(this.pBounds),n.setBindGroup(0,this.gBounds),n.dispatchWorkgroups(u),n.setPipeline(this.pScatter),n.setBindGroup(0,this.gScatter),n.dispatchWorkgroups(u),n.setPipeline(this.pResolve),n.setBindGroup(0,this.gResolve),n.dispatchWorkgroups(Math.ceil(e/k));for(let i=this.finestLevel-1;i>=0;i--)n.setPipeline(this.pReduce[i]),n.setBindGroup(0,this.gReduce[i]),n.dispatchWorkgroups(Math.max(1,Math.ceil(8**i/k)));n.setPipeline(this.pForce),n.setBindGroup(0,this.gForce),n.dispatchWorkgroups(u)}dispose(){for(const n of[this.pos,this.vel,this.simParams,this.grid,this.nodes,this.bounds])n.destroy()}}async function D(o,n={}){const e=await q(),u=new A(o,n.hero?.56:.62);if(!e)return G(o);const i=U(u.canvas,e),r=new O(e,i);r.camera.attach(u.canvas),n.dome&&(r.camera.elevation=.55,r.camera.distance=2.4);let s=n.count??2e4,t=n.steps??2,a=n.dome?6:0,f=n.dome&&!n.hero?.999:1;const h=()=>n.dome?H(s):V(s);let l=new R(e,h());n.hero&&(l.gScale=.5),r.bind(l.pos,l.vel);const d=()=>{l.dispose(),l=new R(e,h()),r.bind(l.pos,l.vel)};return n.hero||(u.slider({label:"bodies",min:1e4,max:2e5,step:1e4,value:s,log:!0,format:c=>Math.round(c).toLocaleString(),onInput:c=>{s=Math.round(c),d()}}),n.domeSlider?u.slider({label:"dome strength",min:0,max:20,step:.5,value:a,onInput:c=>{a=c,f=c>0?.999:1}}):u.slider({label:"θ",min:.4,max:1.4,step:.05,value:.8,onInput:c=>l.theta=c}),u.slider({label:"steps / frame",min:1,max:8,step:1,value:t,onInput:c=>t=Math.round(c)}),u.button("re-seed",d)),u.setInfo(()=>n.hero?`${s.toLocaleString()} bodies on a dome · drag to orbit, ctrl+scroll to zoom`:n.domeSlider?`${s.toLocaleString()} bodies · octree ${l.gridDim}³ · drag the dome slider`:`${s.toLocaleString()} bodies · octree pyramid, ${l.gridDim}³ finest grid · drag to orbit`),{frame(){u.tick(),l.shellK=a,l.damping=f,l.writeParams();const c=e.createCommandEncoder(),g=c.beginComputePass();for(let m=0;m<t;m++)l.encode(g);g.end(),r.encode(c,s,{size:s>15e4?.0035:.005}),e.queue.submit([c.finish()])},dispose(){l.dispose()}}}const P=1,S=26,L=1400;function re(){const o=[];let n=-Math.SQRT1_2*P,e=Math.SQRT1_2*P,u=.6,i=.6;const r=1/240;for(let s=0;s<L;s++){if(s===Math.floor(L*.12)){const d=Math.hypot(n,e);u+=n/d*1.5,i+=e/d*1.5}s===Math.floor(L*.52)&&(i-=2.6);const t=Math.hypot(n,e)||1e-6,a=-(n/t)*(t-P)*S,f=-(e/t)*(t-P)*S;let h=0,l=0;e<0&&(l=-e*S*4),u+=(a+h)*r,i+=(f+l)*r,u*=.999,i*=.999,n+=u*r,e+=i*r,o.push({x:n,y:e,fx:a,fy:f,gx:h,gy:l})}return o}function se(o){const n=re();Q(o,{screens:4,aspect:.56,steps:[{at:0,text:"Cross-section of the dome. The dashed arc is the target shell, radius R. The body starts on it, moving along it — the spring is silent while r = R."},{at:.1,text:"A kick sends it outside the shell. Now r > R, and the spring fires: a force pointing radially inward, proportional to how far the rule is broken."},{at:.35,text:"Overshoot, correct, overshoot — the body oscillates around the shell while the spring negotiates it back. Light damping settles the argument."},{at:.52,text:"A second kick slings it around the rim. The spring keeps tugging it back toward the shell the whole way — the force is always proportional to the current violation, nothing more."},{at:.76,text:"It dips below the equator, and the floor spring (4× stiffer) shoves it straight back up. The equator is a hard edge; the shell is a soft preference."},{at:.9,text:"That's the whole constraint: two if-statements producing forces. The integrator and the gravity solver never learn the world became a dome."}],draw(e,u,i,r){const s=u/2,t=i*.78,a=Math.min(u*.32,i*.6),f=E(r,0,.06);e.save(),e.globalAlpha=f,e.strokeStyle=p.grid,e.lineWidth=1.5,e.beginPath(),e.moveTo(s-a*1.45,t),e.lineTo(s+a*1.45,t),e.stroke(),e.setLineDash([6,6]),e.strokeStyle=p.accent,e.globalAlpha=.55*f,e.lineWidth=1.5,e.beginPath(),e.arc(s,t,a*P,Math.PI,0),e.stroke(),e.setLineDash([]),e.restore(),z(e,"shell  r = R",s+a*.74,t-a*.78,{color:p.accent,size:11,alpha:.8*f}),z(e,"equator (floor)",s-a*1.42,t+14,{color:p.muted,size:11,alpha:.8*f});const h=E(r,.02,.98),l=Math.min(n.length-1,Math.floor(h*(n.length-1))),d=n[l],c=x=>[s+x.x*a,t-x.y*a];e.save(),e.strokeStyle=p.dot,e.lineWidth=1.4;const g=220;e.beginPath();for(let x=Math.max(0,l-g);x<=l;x++){const[T,_]=c(n[x]),N=(x-(l-g))/g;x===Math.max(0,l-g)?e.moveTo(T,_):e.lineTo(T,_),e.globalAlpha=.1+.4*N}e.globalAlpha=.45,e.stroke(),e.restore();const[m,v]=c(d),b=Math.hypot(d.x,d.y),y=Math.abs(b-P);y>.02&&d.y>-.02&&(e.save(),e.globalAlpha=.35,e.strokeStyle=p.muted,e.setLineDash([3,4]),e.beginPath(),e.moveTo(s,t),e.lineTo(m,v),e.stroke(),e.setLineDash([]),e.restore());const w=a/S/.55;Math.hypot(d.fx,d.fy)*w>6&&(C(e,m,v,m+d.fx*w,v-d.fy*w,p.warm,2.5,8),z(e,"shell spring  −k·(r−R)·r̂",m+d.fx*w+8,v-d.fy*w,{color:p.warm,size:11})),Math.hypot(d.gx,d.gy)*w>6&&(C(e,m,v,m+d.gx*w*.5,v-d.gy*w*.5,p.red,2.5,8),z(e,"floor spring  −4k·z",m+12,v-d.gy*w*.5-10,{color:p.red,size:11})),e.fillStyle=p.accent,e.beginPath(),e.arc(m,v,5.5,0,Math.PI*2),e.fill(),e.strokeStyle="#fff",e.lineWidth=1,e.stroke();const I=d.y<0,W=I?"below floor":y<.03?"on shell":b>P?"outside shell":"inside shell";z(e,`r − R = ${(b-P).toFixed(2)}   ${W}`,u-16,22,{color:I?p.red:y<.03?p.good:p.warm,size:12,align:"right",mono:!0})}})}j();const ae={"hero-dome":o=>D(o,{count:2e4,steps:2,dome:!0,hero:!0}),"naive-3d":ee,"pyramid-3d":o=>D(o,{count:2e4}),"dome-morph":o=>D(o,{count:2e4,dome:!0,domeSlider:!0})};for(const o of document.querySelectorAll("[data-demo]")){const n=o.dataset.demo,e=ae[n];e&&$(o,()=>e(o))}const le={"dome-spring":se};for(const o of document.querySelectorAll("[data-scrolly]"))le[o.dataset.scrolly]?.(o);
