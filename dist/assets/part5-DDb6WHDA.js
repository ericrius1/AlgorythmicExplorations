import{i as ce}from"./siteNav-DaR1fllU.js";import{S as E,g as re,m as fe}from"./demoShell-Btkj803W.js";import{g as ae,c as ie}from"./gpu-DBowy6aD.js";import{m as ue,P as R,b as V,l as O,p as z,a as pe}from"./scrolly-CfS_4Ccm.js";const de=`// Stockham radix-2 FFT: one workgroup per line, the whole transform in
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
`,he=`// Particle-mesh pipeline, everything except the FFT itself (fft.wgsl):
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
`,j=256;class J{dim;spec;paint;stat;dev;params;splatParams;rho;force;pClear;pDeposit;pToSpec;pGreen;pGradient;pGather;pSplat;pFft;gClear;gToSpec;gGreen;gGradient;gSplat;gFft;gDeposit=null;gGather=null;constructor(t,e){if(e&e-1)throw new Error("mesh size must be a power of two");this.dev=t,this.dim=e;const n=e*e;this.params=t.createBuffer({size:48,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.splatParams=t.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});const s=GPUBufferUsage.STORAGE;this.rho=t.createBuffer({size:n*4,usage:s}),this.spec=t.createBuffer({size:n*8,usage:s|GPUBufferUsage.COPY_SRC}),this.force=t.createBuffer({size:n*8,usage:s}),this.paint=t.createBuffer({size:n*4,usage:s|GPUBufferUsage.COPY_DST}),this.stat=t.createBuffer({size:4,usage:s});const c=Math.log2(e),o=de.replaceAll("__N__",String(e)).replaceAll("__HALF__",String(e/2)).replaceAll("__LOGN__",String(c)),r=t.createShaderModule({code:o}),f=t.createShaderModule({code:he}),d=(p,l={})=>t.createComputePipeline({layout:"auto",compute:{module:f,entryPoint:p,constants:l}});this.pClear=d("clear_rho",{DIM:e}),this.pDeposit=d("deposit",{DIM:e}),this.pToSpec=d("to_spec",{DIM:e}),this.pGreen=d("green",{DIM:e}),this.pGradient=d("gradient",{DIM:e}),this.pGather=d("gather",{DIM:e}),this.pSplat=d("splat",{DIM:e}),this.pFft=[0,1].map(p=>[0,1].map(l=>t.createComputePipeline({layout:"auto",compute:{module:r,entryPoint:"fft",constants:{AXIS:p,INV:l}}})));const h=(p,l)=>t.createBindGroup({layout:p.getBindGroupLayout(0),entries:l.map(([u,a])=>({binding:u,resource:{buffer:a}}))});this.gClear=h(this.pClear,[[2,this.rho],[6,this.stat]]),this.gToSpec=h(this.pToSpec,[[0,this.params],[2,this.rho],[3,this.spec],[5,this.paint],[6,this.stat]]),this.gGreen=h(this.pGreen,[[0,this.params],[3,this.spec]]),this.gGradient=h(this.pGradient,[[3,this.spec],[4,this.force],[6,this.stat]]),this.gSplat=h(this.pSplat,[[7,this.splatParams],[5,this.paint]]),this.gFft=this.pFft.map(p=>p.map(l=>h(l,[[0,this.spec]])))}setParticles(t){const e=(n,s)=>this.dev.createBindGroup({layout:n.getBindGroupLayout(0),entries:s.map(([c,o])=>({binding:c,resource:{buffer:o}}))});this.gDeposit=e(this.pDeposit,[[0,this.params],[1,t],[2,this.rho]]),this.gGather=e(this.pGather,[[0,this.params],[1,t],[4,this.force]])}writeParams(t){const e=new DataView(new ArrayBuffer(48));e.setUint32(0,t.count,!0),e.setUint32(4,t.painted?1:0,!0),e.setFloat32(8,t.kick,!0),e.setFloat32(12,t.drift,!0),e.setFloat32(16,t.damp??1,!0);const n=(2*Math.PI*(t.smooth??1)/this.dim)**2;e.setFloat32(20,n,!0),e.setFloat32(24,t.mouseRadius??.05,!0),e.setFloat32(28,t.mouseStrength??0,!0),e.setFloat32(32,t.mouse?.[0]??99,!0),e.setFloat32(36,t.mouse?.[1]??99,!0),e.setFloat32(40,t.mouseVel?.[0]??0,!0),e.setFloat32(44,t.mouseVel?.[1]??0,!0),this.dev.queue.writeBuffer(this.params,0,e.buffer)}encodeSplat(t,e,n,s){this.dev.queue.writeBuffer(this.splatParams,0,new Float32Array([e[0],e[1],n,s]));const c=t.beginComputePass();c.setPipeline(this.pSplat),c.setBindGroup(0,this.gSplat),c.dispatchWorkgroups(Math.ceil(this.dim*this.dim/j)),c.end()}encode(t,e,n=!1){const s=Math.ceil(this.dim*this.dim/j),c=Math.ceil(e/j),o=t.beginComputePass();n||(o.setPipeline(this.pClear),o.setBindGroup(0,this.gClear),o.dispatchWorkgroups(s),o.setPipeline(this.pDeposit),o.setBindGroup(0,this.gDeposit),o.dispatchWorkgroups(c)),o.setPipeline(this.pToSpec),o.setBindGroup(0,this.gToSpec),o.dispatchWorkgroups(s);for(const[r,f]of[[0,0],[1,0]])o.setPipeline(this.pFft[r][f]),o.setBindGroup(0,this.gFft[r][f]),o.dispatchWorkgroups(this.dim);o.setPipeline(this.pGreen),o.setBindGroup(0,this.gGreen),o.dispatchWorkgroups(s);for(const[r,f]of[[0,1],[1,1]])o.setPipeline(this.pFft[r][f]),o.setBindGroup(0,this.gFft[r][f]),o.dispatchWorkgroups(this.dim);o.setPipeline(this.pGradient),o.setBindGroup(0,this.gGradient),o.dispatchWorkgroups(s),o.setPipeline(this.pGather),o.setBindGroup(0,this.gGather),o.dispatchWorkgroups(c),o.end()}dispose(){for(const t of[this.params,this.splatParams,this.rho,this.spec,this.force,this.paint,this.stat])t.destroy()}}function ge(){const i=Math.random()||1e-9,t=Math.random();return Math.sqrt(-2*Math.log(i))*Math.cos(2*Math.PI*t)}function te(i,t,e,n,s,c){for(let o=1,r=0;o<s;o++){let f=s>>1;for(;r&f;f>>=1)r^=f;if(r^=f,o<r){const d=e+o*n,h=e+r*n;[i[d],i[h]]=[i[h],i[d]],[t[d],t[h]]=[t[h],t[d]]}}for(let o=2;o<=s;o<<=1){const r=(c?2:-2)*Math.PI/o,f=Math.cos(r),d=Math.sin(r);for(let h=0;h<s;h+=o){let p=1,l=0;for(let u=0;u<o/2;u++){const a=e+(h+u)*n,x=e+(h+u+o/2)*n,b=i[x]*p-t[x]*l,v=i[x]*l+t[x]*p;i[x]=i[a]-b,t[x]=t[a]-v,i[a]+=b,t[a]+=v;const F=p*f-l*d;l=p*d+l*f,p=F}}}if(c)for(let o=0;o<s;o++)i[e+o*n]/=s,t[e+o*n]/=s}function X(i,t,e,n){for(let s=0;s<e;s++)te(i,t,s*e,1,e,n);for(let s=0;s<e;s++)te(i,t,s,e,e,n)}function me(i){const t=i.grid??256,e=t/2,n=new Float64Array(t*t),s=new Float64Array(t*t);for(let v=0;v<t*t;v++)n[v]=ge();X(n,s,t,!1);const c=new Float64Array(t*t),o=new Float64Array(t*t),r=new Float64Array(t*t),f=new Float64Array(t*t),d=16;for(let v=0;v<t;v++){const F=v<=e?v:v-t;for(let w=0;w<t;w++){const m=w<=e?w:w-t,P=v*t+w,k=m*m+F*F;if(k===0)continue;const y=Math.sqrt(k),S=(k/(k+9))**2,M=Math.pow(y,i.tilt)*Math.exp(-(k/(d*d)))*S,g=Math.sqrt(M)/k;c[P]=-s[P]*m*g,o[P]=n[P]*m*g,r[P]=-s[P]*F*g,f[P]=n[P]*F*g}}X(c,o,t,!0),X(r,f,t,!0);let h=0;for(let v=0;v<t*t;v++)h+=c[v]*c[v]+r[v]*r[v];const p=i.amplitude/Math.sqrt(h/(t*t)),l=i.lattice,u=l*l,a=new Float32Array(u*4),x=Math.pow(i.aInit,1.5)*p,b=i.aInit*p;for(let v=0;v<l;v++)for(let F=0;F<l;F++){const w=(F+.5)/l*t-.5,m=(v+.5)/l*t-.5,P=Math.floor(w),k=Math.floor(m),y=w-P,S=m-k,M=(T,C)=>(C%t+t)%t*t+(T%t+t)%t,g=T=>T[M(P,k)]*(1-y)*(1-S)+T[M(P+1,k)]*y*(1-S)+T[M(P,k+1)]*(1-y)*S+T[M(P+1,k+1)]*y*S,I=g(c),A=g(r),G=(v*l+F)*4,D=T=>T-Math.floor(T);a[G]=D((F+.5)/l+I*b),a[G+1]=D((v+.5)/l+A*b),a[G+2]=I*x,a[G+3]=A*x}return{state:a,count:u}}function ve(i,t,e,n){const s=i*t,c=s*Math.pow(i,.5)*(3/(2*i))*e*e/n*(1/(4*Math.PI*Math.PI)),o=s*Math.pow(i,-1.5);return{kick:c,drift:o,aNext:i+s}}const xe=`// Part five's particle renderer: same additive speed-colored quads as
// render.wgsl, but positions live in box units [0,1) and the box is
// periodic — \`tiles\` instances per particle draw its neighbouring images,
// so a wide canvas shows the universe repeating instead of empty margins.
// tiles = 1 (just the box), 3 (x-row: -1, 0, +1), or 9 (full 3×3).

struct RenderParams {
  scale: f32,
  aspect: f32,
  size: f32,
  colorScale: f32,
  tiles: u32,
  count: u32,
}

@group(0) @binding(0) var<uniform> R: RenderParams;
@group(0) @binding(1) var<storage, read> parts: array<vec4f>;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) color: vec3f,
}

const QUAD = array<vec2f, 6>(
  vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
  vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
);

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  let copy = ii % R.tiles;
  let b = parts[ii / R.tiles];
  var off = vec2f(0.0);
  if (R.tiles == 3u) {
    off = vec2f(f32(copy) - 1.0, 0.0);
  } else if (R.tiles == 9u) {
    off = vec2f(f32(copy % 3u) - 1.0, f32(copy / 3u) - 1.0);
  }
  let q = QUAD[vi];
  let wp = (b.xy - 0.5 + off) * 2.0 * R.scale;
  var o: VOut;
  o.pos = vec4f((wp.x + q.x * R.size) / R.aspect, wp.y + q.y * R.size, 0.0, 1.0);
  o.uv = q;
  let t = clamp(length(b.zw) * R.colorScale, 0.0, 1.0);
  o.color = mix(vec3f(0.25, 0.42, 1.0), vec3f(1.0, 0.42, 0.22), t);
  return o;
}

@fragment
fn fs(in: VOut) -> @location(0) vec4f {
  let d = length(in.uv);
  let a = smoothstep(1.0, 0.0, d);
  return vec4f(in.color * a, a);
}
`,K=.02;class le{dev;ctx;pipeline;params;group=null;constructor(t,e){this.dev=t,this.ctx=e;const n=t.createShaderModule({code:xe});this.pipeline=t.createRenderPipeline({layout:"auto",vertex:{module:n,entryPoint:"vs"},fragment:{module:n,entryPoint:"fs",targets:[{format:navigator.gpu.getPreferredCanvasFormat(),blend:{color:{srcFactor:"src-alpha",dstFactor:"one",operation:"add"},alpha:{srcFactor:"one",dstFactor:"one",operation:"add"}}}]},primitive:{topology:"triangle-list"}}),this.params=t.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST})}bind(t){this.group=this.dev.createBindGroup({layout:this.pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.params}},{binding:1,resource:{buffer:t}}]})}encode(t,e,n={}){const s=this.ctx.canvas,c=n.tiles??1,o=new DataView(new ArrayBuffer(32));o.setFloat32(0,n.scale??1,!0),o.setFloat32(4,s.width/s.height,!0),o.setFloat32(8,n.size??.0022,!0),o.setFloat32(12,n.colorScale??2,!0),o.setUint32(16,c,!0),o.setUint32(20,e,!0),this.dev.queue.writeBuffer(this.params,0,o.buffer);const r=t.beginRenderPass({colorAttachments:[{view:this.ctx.getCurrentTexture().createView(),clearValue:{r:.024,g:.027,b:.043,a:1},loadOp:n.load?"load":"clear",storeOp:"store"}]});r.setPipeline(this.pipeline),r.setBindGroup(0,this.group),r.draw(6,e*c),r.end()}}function be(i){const t=new Float32Array(i*4);for(let e=0;e<i;e++){const n=.17*Math.sqrt(Math.random()),s=Math.random()*Math.PI*2;t[e*4]=.5+Math.cos(s)*n,t[e*4+1]=.5+Math.sin(s)*n}return t}async function Q(i,t){const e=await ae(),n=new E(i,t.hero?.5:.66);if(!e)return re(i);const s=ie(n.canvas,e),c=new le(e,s),o=t.mode==="web";let r=o?512:256,f=t.hero?768:o?512:256,d=.03,h=1,p=o,l=K,u=0,a=new J(e,r),x=null,b=0;const v=()=>{if(x?.destroy(),o){const y=me({lattice:f,aInit:K,amplitude:d,tilt:h});b=y.count,x=e.createBuffer({size:b*16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),e.queue.writeBuffer(x,0,y.state)}else b=f*f,x=e.createBuffer({size:b*16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),e.queue.writeBuffer(x,0,be(b));a.setParticles(x),l=K,u=0},F=y=>{r=y,a.dispose(),a=new J(e,r),a.setParticles(x)};v();const w=n.canvas.width/n.canvas.height;let m=[99,99],P=[0,0],k=0;return n.canvas.addEventListener("pointermove",y=>{const S=n.canvas.getBoundingClientRect(),M=(y.clientX-S.left)/S.width*2-1,g=-((y.clientY-S.top)/S.height*2-1),I=M*w/2+.5,A=g/2+.5,G=performance.now(),D=Math.min((G-k)/1e3,.1)||.016;if(k=G,m[0]<90){const T=(I-m[0])/D,C=(A-m[1])/D,B=Math.hypot(T,C),N=B>2?2/B:1;P=[P[0]*.6+T*N*.4,P[1]*.6+C*N*.4]}m=[I,A]}),n.canvas.addEventListener("pointerleave",()=>{m=[99,99],P=[0,0]}),t.hero||(o?(n.slider({label:"particles",min:256*256,max:1024*1024,step:1,value:f*f,log:!0,format:y=>(Math.round(Math.sqrt(y))**2).toLocaleString(),onInput:y=>{f=Math.min(1024,Math.max(256,Math.round(Math.sqrt(y)))),v()}}),n.slider({label:"ripple strength",min:.015,max:.1,step:.001,value:d,format:y=>y.toFixed(3),onInput:y=>{d=y,v()}}),n.slider({label:"tilt n",min:-1,max:3,step:.1,value:h,format:y=>y.toFixed(1),onInput:y=>{h=y,v()}}),n.button("expansion on/off",()=>p=!p),n.button("big bang again",v)):(n.slider({label:"mesh",min:6,max:9,step:1,value:Math.log2(r),format:y=>`${1<<y}×${1<<y}`,onInput:y=>F(1<<y)}),n.button("re-seed",v))),n.setInfo(()=>{if(!o)return`${b.toLocaleString()} particles · ${r}×${r} mesh · 4 FFTs per step`;const y=Math.max(1/l-1,0),S=p?l>=1?"a = 1.00 · z = 0 — today":`a = ${l.toFixed(2)} · z = ${y.toFixed(1)}`:"expansion off";return`${b.toLocaleString()} particles · ${r}×${r} mesh · ${S}${t.hero?" · stir the universe":""}`}),{frame(){n.tick();const y=e.createCommandEncoder(),S=2;!o&&performance.now()-(u||(u=performance.now()))>14e3&&(v(),u=performance.now()),o&&p&&l>=1&&(u||(u=performance.now()),t.hero&&performance.now()-u>12e3&&(v(),u=0));for(let M=0;M<S;M++){let g,I;if(o&&p){const A=ve(Math.min(l,1),.004,r,b);g=A.kick,I=A.drift,l<1&&(l=A.aNext)}else o?(g=.004*1.5*r*r/b*(1/(4*Math.PI*Math.PI)),I=.004):(g=.012*4*r*r/b*(1/(4*Math.PI*Math.PI)),I=.012);a.writeParams({count:b,kick:g,drift:I,smooth:1,mouseRadius:.06,mouseStrength:.02,mouse:m,mouseVel:P}),a.encode(y,b)}c.bind(x),c.encode(y,b,{scale:o?1:.45,size:t.hero?.0026:.0032,colorScale:o?14:30,tiles:o?3:9}),e.queue.submit([y.finish()])},dispose(){a.dispose(),x?.destroy()}}}const _=256;function ne(i){const t=new Float64Array(_);for(let e=0;e<_;e++){const n=e/_;i==="square"?t[e]=n>.25&&n<.65?.8:-.5:i==="bump"?t[e]=Math.exp(-((n-.45)**2)/.004)-.25:i==="two tones"?t[e]=.5*Math.sin(2*Math.PI*3*n)+.3*Math.sin(2*Math.PI*17*n):t[e]=0}return t}function we(i){const t=new E(i,.62),e=t.canvas.getContext("2d"),n=Math.min(window.devicePixelRatio||1,2);let s=ne("square"),c="square",o=4,r=new Float64Array(_),f=new Float64Array(_);const d=()=>{r=new Float64Array(_),f=new Float64Array(_);for(let l=0;l<_;l++){for(let u=0;u<_;u++){const a=-2*Math.PI*l*u/_;r[l]+=s[u]*Math.cos(a),f[l]+=s[u]*Math.sin(a)}r[l]/=_,f[l]/=_}},h=l=>{if(c=l,s=ne(l),l==="noise"){let u=0;for(let a=0;a<_;a++)u=u*.92+(Math.random()-.5)*.35,s[a]=u*2}d()};h("square");const p=l=>{const u=new Float64Array(_);for(let a=0;a<_;a++)u[a]=r[0];for(let a=1;a<=l&&a<_/2;a++)for(let b=0;b<_;b++){const v=2*Math.PI*a*b/_;u[b]+=2*(r[a]*Math.cos(v)-f[a]*Math.sin(v))}return u};for(const l of["square","bump","two tones","noise"])t.button(l,()=>h(l));return t.slider({label:"waves used",min:1,max:128,step:1,value:o,log:!0,format:l=>String(Math.round(l)),onInput:l=>o=Math.round(l)}),t.setInfo(()=>{const l=c==="square"&&o<60?" · the overshoot at the corners is Gibbs ringing — sharp edges cost waves":"";return`${o} of ${_/2} waves${l}`}),{frame(){t.tick();const{width:l,height:u}=e.canvas;e.fillStyle="#06070b",e.fillRect(0,0,l,u);const a=p(o),x=.06*u,b=.56*u,v=x+b/2,F=g=>v-g*b*.42,w=g=>g/(_-1)*l;e.strokeStyle="rgba(80, 90, 120, 0.3)",e.lineWidth=1,e.beginPath(),e.moveTo(0,v),e.lineTo(l,v),e.stroke(),e.strokeStyle="rgba(215, 219, 230, 0.35)",e.lineWidth=1.5*n,e.beginPath();for(let g=0;g<_;g++)g===0?e.moveTo(w(g),F(s[g])):e.lineTo(w(g),F(s[g]));e.stroke(),e.strokeStyle="rgba(122, 162, 255, 0.95)",e.lineWidth=2*n,e.beginPath();for(let g=0;g<_;g++)g===0?e.moveTo(w(g),F(a[g])):e.lineTo(w(g),F(a[g]));e.stroke();const m=.74*u,P=.2*u,k=_/2,y=l/k;let S=1e-9;const M=[];for(let g=1;g<k;g++){const I=Math.hypot(r[g],f[g]);M.push(I),I>S&&(S=I)}for(let g=1;g<k;g++){const I=M[g-1]/S,A=Math.max(1,I*P);e.fillStyle=g<=o?"rgba(255, 184, 107, 0.9)":"rgba(122, 162, 255, 0.28)",e.fillRect((g-1)*y,m+P-A,Math.max(1,y-1),A)}e.fillStyle="rgba(138, 145, 165, 0.9)",e.font=`${10*n}px ui-monospace, Menlo, monospace`,e.textAlign="left",e.fillText("spectrum — every bar is one wave; lit bars are in use, low frequencies left",6*n,m-5*n)}}}const U=12,L=7;function ye(i){const t=new E(i,.58),e=t.canvas.getContext("2d"),n=Math.min(window.devicePixelRatio||1,2),s=[{x:3.3,y:2.4},{x:7.8,y:4.1},{x:8.4,y:1.7},{x:4.9,y:5.2}];let c=!0,o=-1;const r=()=>e.canvas.width/U,f=()=>e.canvas.height/L,d=h=>{const p=t.canvas.getBoundingClientRect();return[(h.clientX-p.left)/p.width*U,(h.clientY-p.top)/p.height*L]};return t.canvas.addEventListener("pointerdown",h=>{const[p,l]=d(h);let u=1.2;o=-1,s.forEach((a,x)=>{const b=Math.hypot(a.x-p,a.y-l);b<u&&(u=b,o=x)}),o>=0&&t.canvas.setPointerCapture(h.pointerId)}),t.canvas.addEventListener("pointermove",h=>{if(o<0)return;const[p,l]=d(h);s[o].x=Math.min(U-.51,Math.max(.51,p)),s[o].y=Math.min(L-.51,Math.max(.51,l))}),t.canvas.addEventListener("pointerup",()=>o=-1),t.button("CIC — split over 4 cells",()=>c=!0),t.button("NGP — nearest cell only",()=>c=!1),t.setInfo(()=>c?"cloud-in-cell: weights are overlap areas; they always sum to 1 — drag a particle":"nearest grid point: drag slowly across a cell border and watch the mass teleport"),{frame(){t.tick();const{width:h,height:p}=e.canvas;e.fillStyle="#06070b",e.fillRect(0,0,h,p);const l=Array.from({length:L},()=>new Array(U).fill(0)),u=[];for(const a of s)if(c){const x=a.x-.5,b=a.y-.5,v=Math.floor(x),F=Math.floor(b),w=x-v,m=b-F,P=(k,y,S)=>{k>=0&&k<U&&y>=0&&y<L&&S>5e-4&&(l[y][k]+=S,u.push({c:k,r:y,wgt:S,p:a}))};P(v,F,(1-w)*(1-m)),P(v+1,F,w*(1-m)),P(v,F+1,(1-w)*m),P(v+1,F+1,w*m)}else{const x=Math.min(U-1,Math.max(0,Math.floor(a.x))),b=Math.min(L-1,Math.max(0,Math.floor(a.y)));l[b][x]+=1,u.push({c:x,r:b,wgt:1,p:a})}for(let a=0;a<L;a++)for(let x=0;x<U;x++){const b=l[a][x];b>5e-4&&(e.fillStyle=`rgba(122, 162, 255, ${Math.min(.85,b*.55)})`,e.fillRect(x*r(),a*f(),r(),f()))}e.strokeStyle="rgba(80, 90, 120, 0.35)",e.lineWidth=1,e.beginPath();for(let a=0;a<=U;a++)e.moveTo(a*r(),0),e.lineTo(a*r(),p);for(let a=0;a<=L;a++)e.moveTo(0,a*f()),e.lineTo(h,a*f());e.stroke(),e.font=`${11*n}px ui-monospace, Menlo, monospace`,e.textAlign="center";for(const a of u){const x=(a.c+.5)*r(),b=(a.r+.5)*f();e.strokeStyle="rgba(255, 184, 107, 0.35)",e.beginPath(),e.moveTo(a.p.x*r(),a.p.y*f()),e.lineTo(x,b),e.stroke(),e.fillStyle="rgba(240, 243, 250, 0.95)",e.fillText(a.wgt.toFixed(2),x,b+4*n)}for(const a of s)e.fillStyle="#ffb86b",e.beginPath(),e.arc(a.x*r(),a.y*f(),5*n,0,Math.PI*2),e.fill(),e.strokeStyle="rgba(255, 184, 107, 0.5)",e.beginPath(),e.arc(a.x*r(),a.y*f(),8*n,0,Math.PI*2),e.stroke()}}}const Me=`// Fullscreen colormap for the Poisson painter: painted density glows warm,
// the solved potential reads as blue depth with contour lines — a live
// topographic map of the gravity well. stat[0] holds the deepest well
// (written by pm.wgsl's gradient pass) so the palette self-normalizes.

struct FieldParams {
  dim: u32,
  aspect: f32,
  contours: f32,
  _pad: f32,
}

@group(0) @binding(0) var<uniform> F: FieldParams;
@group(0) @binding(1) var<storage, read> spec: array<vec2f>;
@group(0) @binding(2) var<storage, read> paint: array<f32>;
@group(0) @binding(3) var<storage, read> stat: array<u32>;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VOut {
  // one oversized triangle
  let xy = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u)) * 2.0 - 1.0;
  var o: VOut;
  o.pos = vec4f(xy, 0.0, 1.0);
  o.uv = vec2f(xy.x, xy.y) * 0.5 + 0.5;
  return o;
}

// Match BoxRenderer's mapping: the box is centered and fills the canvas
// height; a wide canvas shows the periodic images on either side.
fn cellAt(uv: vec2f) -> u32 {
  let box = fract(vec2f(0.5 + (uv.x - 0.5) * F.aspect, uv.y));
  let c = vec2u(min(box, vec2f(0.9999)) * f32(F.dim));
  return c.y * F.dim + c.x;
}

@fragment
fn fs(in: VOut) -> @location(0) vec4f {
  let i = cellAt(in.uv);
  let deepest = max(f32(stat[0]) / 4096.0, 1.0e-6);
  let depth = clamp(-spec[i].x / deepest, 0.0, 1.0); // 0 flat .. 1 deepest well
  let rho = paint[i];

  // potential: blue, deeper = brighter; contour lines like a topo map
  var col = mix(vec3f(0.024, 0.027, 0.043), vec3f(0.18, 0.38, 0.9), pow(depth, 1.1));
  let line = abs(fract(depth * F.contours) - 0.5);
  col *= 1.0 - 0.65 * smoothstep(0.18, 0.0, line) * step(0.004, depth);

  // painted mass: warm glow on top
  col += vec3f(1.0, 0.55, 0.25) * clamp(rho * 0.25, 0.0, 1.2);
  return vec4f(col, 1.0);
}
`,q=256,W=5e4;function Pe(){const i=new Float32Array(W*4);for(let t=0;t<W;t++)i[t*4]=Math.random(),i[t*4+1]=Math.random();return i}async function ke(i){const t=await ae(),e=new E(i,.62);if(!t)return re(i);const n=ie(e.canvas,t),s=new J(t,q),c=t.createBuffer({size:W*16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),o=()=>{t.queue.writeBuffer(c,0,Pe())};o(),s.setParticles(c);const r=t.createShaderModule({code:Me}),f=t.createRenderPipeline({layout:"auto",vertex:{module:r,entryPoint:"vs"},fragment:{module:r,entryPoint:"fs",targets:[{format:navigator.gpu.getPreferredCanvasFormat()}]},primitive:{topology:"triangle-list"}}),d=t.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),h=new DataView(new ArrayBuffer(16));h.setUint32(0,q,!0),h.setFloat32(4,e.canvas.width/e.canvas.height,!0),h.setFloat32(8,12,!0),t.queue.writeBuffer(d,0,h.buffer);const p=t.createBindGroup({layout:f.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:d}},{binding:1,resource:{buffer:s.spec}},{binding:2,resource:{buffer:s.paint}},{binding:3,resource:{buffer:s.stat}}]}),l=new le(t,n);l.bind(c);let u=null,a=!1,x=!1;const b=e.canvas.width/e.canvas.height,v=w=>{const m=e.canvas.getBoundingClientRect(),P=.5+((w.clientX-m.left)/m.width-.5)*b;return[P-Math.floor(P),1-(w.clientY-m.top)/m.height]};e.canvas.addEventListener("pointerdown",w=>{a=!0,x=w.button===2||w.shiftKey,u=v(w),e.canvas.setPointerCapture(w.pointerId),w.preventDefault()}),e.canvas.addEventListener("pointermove",w=>u=v(w)),e.canvas.addEventListener("pointerup",()=>a=!1),e.canvas.addEventListener("contextmenu",w=>w.preventDefault());let F=.035;return e.slider({label:"brush",min:.015,max:.09,step:.005,value:F,format:w=>w.toFixed(3),onInput:w=>F=w}),e.button("clear mass",()=>{t.queue.writeBuffer(s.paint,0,new Float32Array(q*q)),o()}),e.button("re-scatter tracers",o),e.setInfo(()=>`${q}×${q} mesh · 4 FFTs + 1 divide per frame · drag to paint mass (shift-drag erases)`),{frame(){e.tick();const w=t.createCommandEncoder();a&&u&&s.encodeSplat(w,u,F,x?-.6:.25),s.writeParams({count:W,painted:!0,kick:45e-6*q*q*(1/(4*Math.PI*Math.PI)),drift:.005,damp:.985,smooth:1.5}),s.encode(w,W,!0);const m=w.beginRenderPass({colorAttachments:[{view:n.getCurrentTexture().createView(),clearValue:{r:.024,g:.027,b:.043,a:1},loadOp:"clear",storeOp:"store"}]});m.setPipeline(f),m.setBindGroup(0,p),m.draw(3),m.end(),l.encode(w,W,{scale:1,size:.0028,colorScale:12,tiles:3,load:!0}),t.queue.submit([w.finish()])},dispose(){s.dispose(),c.destroy(),d.destroy()}}}const H=16,Y=4;function Fe(i,t){const e=i.length,n=new Float64Array(e),s=new Float64Array(e);for(let c=0;c<e;c++){let o=0,r=0;for(let f=0;f<e;f++){const d=-2*Math.PI*c*f/e,h=Math.cos(d),p=Math.sin(d);o+=i[f]*h-t[f]*p,r+=i[f]*p+t[f]*h}n[c]=o,s[c]=r}i.set(n),t.set(s)}function Se(i,t){const e=i.length;for(let n=1,s=0;n<e;n++){let c=e>>1;for(;s&c;c>>=1)s^=c;s^=c,n<s&&([i[n],i[s]]=[i[s],i[n]],[t[n],t[s]]=[t[s],t[n]])}for(let n=2;n<=e;n<<=1){const s=-2*Math.PI/n,c=Math.cos(s),o=Math.sin(s);for(let r=0;r<e;r+=n){let f=1,d=0;for(let h=0;h<n/2;h++){const p=r+h,l=r+h+n/2,u=i[l]*f-t[l]*d,a=i[l]*d+t[l]*f;i[l]=i[p]-u,t[l]=t[p]-a,i[p]+=u,t[p]+=a;const x=f*c-d*o;d=f*o+d*c,f=x}}}}const oe=2048;function se(i){const t=new Float64Array(i),e=new Float64Array(i);for(let p=0;p<i;p++)t[p]=Math.random()-.5;const n=i<=4096?20:5;let s=performance.now();for(let p=0;p<n;p++){const l=t.slice(),u=e.slice();Se(l,u)}const c=(performance.now()-s)/n,o=i>oe,r=Math.min(i,oe),f=t.slice(0,r),d=e.slice(0,r);s=performance.now(),Fe(f,d);let h=performance.now()-s;return o&&(h*=(i/r)**2),{n:i,dftMs:h,fftMs:c,extrapolated:o}}function Ie(i){const t=new E(i,.72),e=t.canvas.getContext("2d"),n=Math.min(window.devicePixelRatio||1,2);let s=0,c=0,o=12,r=se(1<<o);t.slider({label:"points",min:8,max:20,step:1,value:o,format:d=>(1<<d).toLocaleString(),onInput:d=>{o=d,r=se(1<<o)}}),t.setInfo(()=>{const d=r.dftMs/Math.max(r.fftMs,1e-6);return`n = ${r.n.toLocaleString()} · direct ${f(r.dftMs)}${r.extrapolated?" (extrapolated)":""} · FFT ${f(r.fftMs)} · ${d>100?Math.round(d).toLocaleString():d.toFixed(1)}× faster`});const f=d=>d<1?`${(d*1e3).toFixed(0)} µs`:d<1e3?`${d.toFixed(1)} ms`:d<12e4?`${(d/1e3).toFixed(1)} s`:`${(d/6e4).toFixed(1)} min`;return{frame(){t.tick(),c++,c>70&&(c=0,s=(s+1)%(Y+1));const{width:d,height:h}=e.canvas;e.fillStyle="#06070b",e.fillRect(0,0,d,h);const p=.06*d,l=m=>p+m/(H-1)*(d-2*p),u=.08*h,a=.13*h;e.font=`${10*n}px ui-monospace, Menlo, monospace`,e.textAlign="center";for(let m=0;m<Y;m++){const P=H>>m+1,k=u+m*a,y=k+a,S=s===m+1;for(let M=0;M<H;M++){const g=M^P;e.strokeStyle=S?M&P?"rgba(255, 184, 107, 0.85)":"rgba(122, 162, 255, 0.85)":"rgba(80, 90, 120, 0.3)",e.lineWidth=S?1.6*n:1,e.beginPath(),e.moveTo(l(M),k),e.lineTo(l(M),y),e.moveTo(l(M),k),e.lineTo(l(g),y),e.stroke()}S&&(e.fillStyle="rgba(255, 205, 80, 0.9)",e.textAlign="left",e.fillText(`layer ${m+1}: pairs ${P} apart — all 8 butterflies at once`,p,k-4*n),e.textAlign="center")}for(let m=0;m<=Y;m++){const P=u+m*a;for(let k=0;k<H;k++)e.fillStyle=m===0?"#ffb86b":"#7aa2ff",e.beginPath(),e.arc(l(k),P,2.4*n,0,Math.PI*2),e.fill()}e.fillStyle="rgba(138, 145, 165, 0.9)",e.textAlign="left",e.fillText("16 numbers in",p,u-16*n),e.fillText("16 frequencies out — 4 layers, every value touched once per layer",p,u+Y*a+16*n);const x=.74*h,b=.07*h,v=Math.max(r.dftMs,r.fftMs),F=m=>Math.max(2*n,Math.log10(1+m)/Math.log10(1+v)*(d-2*p)*.72);e.textAlign="left",e.fillStyle="rgba(215, 219, 230, 0.85)",e.fillText(`direct DFT — n² ${r.extrapolated?"(measured at 2,048, scaled)":""}`,p,x-4*n),e.fillStyle="rgba(255, 107, 107, 0.8)",e.fillRect(p,x,F(r.dftMs),b),e.fillStyle="rgba(215, 219, 230, 0.95)",e.fillText(f(r.dftMs),p+F(r.dftMs)+6*n,x+b*.7);const w=x+b+22*n;e.fillStyle="rgba(215, 219, 230, 0.85)",e.fillText("FFT — n log n",p,w-4*n),e.fillStyle="rgba(122, 162, 255, 0.9)",e.fillRect(p,w,F(r.fftMs),b),e.fillStyle="rgba(215, 219, 230, 0.95)",e.fillText(f(r.fftMs),p+F(r.fftMs)+6*n,w+b*.7)}}}const Z=[{k:1,amp:.42,phi:.4,color:"#7aa2ff"},{k:2,amp:.3,phi:2.1,color:"#7dd6a0"},{k:4,amp:.22,phi:4.4,color:"#ffb86b"},{k:8,amp:.16,phi:1,color:"#ff8585"}];function Ae(i){const t=n=>{let s=0;for(const c of Z)s+=c.amp*Math.sin(c.k*Math.PI*2*n+c.phi);return s},e=n=>{let s=0;for(const c of Z)s+=-c.amp/(c.k*c.k)*Math.sin(c.k*Math.PI*2*n+c.phi);return s};ue(i,{screens:5,aspect:.72,steps:[{at:0,text:"A lumpy density field ρ(x) along one line of the box. Poisson's equation asks: what potential φ has this as its curvature? In position space, every point couples to every point."},{at:.14,text:"Change alphabets. The FFT rewrites the same curve as a sum of sine waves — here four of them, k = 1, 2, 4, 8 ripples per box. Nothing is lost; this is the identical object, re-spelled."},{at:.42,text:"Now solve. A sine wave passes through ∇² unchanged in shape, just scaled by −k². So per wave, the equation is one division: φₖ = −ρₖ / k². Watch the high frequencies flatten — gravity cares about bulk, not detail."},{at:.68,text:"Inverse FFT: sum the scaled waves back up. The jagged density became a smooth potential — the deep well sits under the biggest mass concentration."},{at:.86,text:"Forces are the downhill direction, F = −∇φ: difference neighbouring cells and you're done. A 262,144-unknown system, solved by elementwise division."}],draw(n,s,c,o){const r=Math.max(20,s*.06),f=s-2*r,d=160,h=z(o,0,.12),p=z(o,.14,.4),l=z(o,.42,.66),u=z(o,.68,.84),a=z(o,.86,.98),x=c*.13,b=c*.085,v=c*.3,F=c*.115,w=c*.042,m=c*.88,P=c*.1,k=(M,g,I,A,G,D=1.8,T=1)=>{if(G<=.004)return;n.save(),n.globalAlpha=G,n.strokeStyle=A,n.lineWidth=D,n.beginPath();const C=Math.max(2,Math.floor(d*T));for(let B=0;B<=C;B++){const N=B/d,$=r+N*f,ee=g-M(N)*I;B===0?n.moveTo($,ee):n.lineTo($,ee)}n.stroke(),n.restore()};n.save(),n.globalAlpha=.35,n.strokeStyle=R.grid,n.lineWidth=1,n.beginPath(),n.moveTo(r,x),n.lineTo(r+f,x),n.stroke(),n.restore();const y=h*O(1,.3,p);if(k(t,x,b,R.text,y,2,h),V(n,"density  ρ(x)",r,x-b-10,{color:R.text,size:12,alpha:h}),Z.forEach((M,g)=>{const I=z(p,g*.12,g*.12+.6);if(I<=0)return;const A=v+g*F,G=z(l,g*.1,g*.1+.55),D=O(M.amp,M.amp/(M.k*M.k),G),T=O(1,-1,u),C=O(x,O(A,m,u),I),B=O(b,O(w/.45,P,u),I),N=I*O(1,0,z(u,.75,1));if(k($=>T*D*Math.sin(M.k*Math.PI*2*$+M.phi),C,B,M.color,N,1.6),u<.4){V(n,`k = ${M.k}`,r-6,A,{color:M.color,size:11,align:"right",mono:!0,alpha:I*(1-z(u,0,.4))});const $=G>.3?`÷ ${M.k*M.k} → ${(M.amp/(M.k*M.k)).toFixed(3)}`:`amp ${M.amp.toFixed(2)}`;V(n,$,r+f,A-w-8,{color:G>.3?R.warm:R.muted,size:10,mono:!0,align:"right",alpha:I*(1-z(u,0,.4))})}}),u>.3){const M=z(u,.3,1);n.save(),n.globalAlpha=.35,n.strokeStyle=R.grid,n.beginPath(),n.moveTo(r,m),n.lineTo(r+f,m),n.stroke(),n.restore(),k(e,m,P,R.warm,M,2.2),V(n,"potential  φ(x)",r,m-P-10,{color:R.warm,size:12,alpha:M})}if(a>0){for(let g=1;g<12;g++){const I=g/12,A=.004,D=-((e(I+A)-e(I-A))/(2*A)),T=r+I*f,C=m-e(I)*P-12,B=Math.max(-34,Math.min(34,D*26))*a;Math.abs(B)<3||pe(n,T,C,T+B,C,R.good,1.8,6)}V(n,"F = −∇φ  (downhill)",r+f,m-P-10,{color:R.good,size:11,align:"right",alpha:a})}const S=a>0?"gradient":u>0?"inverse FFT":l>0?"divide by −k²":p>0?"FFT":"";S&&V(n,S,s-16,20,{color:R.muted,size:12,align:"right",mono:!0})}})}ce();const _e={"hero-web":i=>Q(i,{mode:"web",hero:!0}),fourier:we,paint:ke,butterfly:Ie,cic:ye,collapse:i=>Q(i,{mode:"collapse"}),web:i=>Q(i,{mode:"web"})};for(const i of document.querySelectorAll("[data-demo]")){const t=i.dataset.demo,e=_e[t];e&&fe(i,()=>e(i))}const Te={"poisson-waves":Ae};for(const i of document.querySelectorAll("[data-scrolly]"))Te[i.dataset.scrolly]?.(i);
