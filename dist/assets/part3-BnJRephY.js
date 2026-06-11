import{S as ae,g as ue,a as fe,c as de,i as pe,m as ge}from"./gpu-DqzAFztT.js";import{s as ie,c as he,a as ye,i as me,d as be,m as ve}from"./contactsCpu-BIPXdeBX.js";import{P as Se}from"./particleRenderer-LiyiEjJ-.js";import{m as Pe,P as R,b as N,p as K,a as we,l as V,r as xe}from"./scrolly-Bq15bFnz.js";const m=24,ke=.92,$=3500;function Me(S){const o=new ae(S),e=o.canvas.getContext("2d");let s=ie($),G=new Float32Array($),u=new Float32Array($),f=!0,p=0;const L=he(o),B=new Int32Array(m*m),C=new Int32Array(m*m+1),t=new Int32Array($),T=(c,g)=>{const a=Math.min(m-1,Math.max(0,Math.floor((c+1)/2*m)));return Math.min(m-1,Math.max(0,Math.floor((g+1)/2*m)))*m+a};return o.button("toggle grid lines",()=>f=!f),o.button("re-seed",()=>s=ie($)),o.setInfo(()=>`${p.toLocaleString()} candidate pairs this step — the all-pairs loop would check ${($*($-1)/2/1e6).toFixed(1)}M`),{frame(){o.tick();const c=s.state;B.fill(0);for(let l=0;l<$;l++)B[T(c[l*4],c[l*4+1])]++;let g=0;for(let l=0;l<m*m;l++)C[l]=g,g+=B[l];C[m*m]=g;const a=C.slice(0,m*m);for(let l=0;l<$;l++)t[a[T(c[l*4],c[l*4+1])]++]=l;G.fill(0),u.fill(0),p=0;for(let l=0;l<$;l++){const _=Math.min(m-1,Math.max(0,Math.floor((c[l*4]+1)/2*m))),i=Math.min(m-1,Math.max(0,Math.floor((c[l*4+1]+1)/2*m)));for(let d=-1;d<=1;d++)for(let y=-1;y<=1;y++){const v=_+y,P=i+d;if(v<0||P<0||v>=m||P>=m)continue;const r=P*m+v;for(let k=C[r];k<C[r+1];k++){const n=t[k];n<=l||(p++,ye(c,l,n,G,u))}}}me(c,$,G,u,{dt:.016,mouse:L.get()}),be(e,s,null);const{width:z,height:A}=e.canvas,h=Math.min(z,A)/2*ke,b=z/2,x=A/2,M=h*2/m;if(f){e.strokeStyle="rgba(80, 90, 120, 0.22)",e.lineWidth=1,e.beginPath();for(let l=0;l<=m;l++)e.moveTo(b-h+l*M,x-h),e.lineTo(b-h+l*M,x+h),e.moveTo(b-h,x-h+l*M),e.lineTo(b+h,x-h+l*M);e.stroke()}const F=L.get();if(F&&Math.abs(F[0])<1&&Math.abs(F[1])<1){const l=Math.min(m-1,Math.max(0,Math.floor((F[0]+1)/2*m))),_=Math.min(m-1,Math.max(0,Math.floor((F[1]+1)/2*m)));e.strokeStyle="rgba(255, 205, 80, 0.55)",e.fillStyle="rgba(255, 205, 80, 0.06)";let i=0;e.beginPath();for(let d=-1;d<=1;d++)for(let y=-1;y<=1;y++){const v=l+y,P=_+d;v<0||P<0||v>=m||P>=m||(e.rect(b-h+v*M,x+h-(P+1)*M,M,M),i+=C[P*m+v+1]-C[P*m+v])}e.fill(),e.stroke(),e.fillStyle="rgb(255, 220, 110)",e.beginPath();for(let d=-1;d<=1;d++)for(let y=-1;y<=1;y++){const v=l+y,P=_+d;if(v<0||P<0||v>=m||P>=m)continue;const r=P*m+v;for(let k=C[r];k<C[r+1];k++){const n=t[k],w=b+c[n*4]*h,D=x-c[n*4+1]*h;e.moveTo(w+2.2,D),e.arc(w,D,2.2,0,Math.PI*2)}}e.fill(),o.readout.textContent=`cursor's query: ${i} candidates of ${$.toLocaleString()} particles`}}}}const q=16,te=56,ne=4,oe=S=>`hsl(${S*360/q+10}, 65%, 62%)`;function Ge(S){const o=new ae(S,.7),e=o.canvas.getContext("2d"),s=Math.min(window.devicePixelRatio||1,2);let G=[],u=[],f=[],p=0,L=!0,B=0;const C=()=>{G=[];for(let c=0;c<te;c++){const g=Math.random();G.push({x:g,jy:Math.random(),cell:Math.min(q-1,Math.floor(g*q))})}u=new Array(q).fill(0);for(const c of G)u[c.cell]++;f=u.slice(),p=0,B=0};C();const t=()=>{if(p++,p>6){C();return}if(p>=1&&p<=ne){const c=1<<p-1,g=f.slice();for(let a=0;a<q;a++)a>=c&&(g[a]=f[a]+f[a-c]);f=g}else p===5&&(f=[0,...f.slice(0,q-1)])};o.button("step",()=>{L=!1,t()}),o.button("auto-play",()=>L=!L),o.button("shuffle",C);const T=()=>{if(p===0)return"histogram: count the particles in each cell";if(p<=ne){const c=1<<p-1;return`scan pass ${p}/4 (d=${c}): every cell adds the value ${c} to its left — in parallel`}return p===5?"shift right one cell: each cell's start index in the sorted array":"scatter: every particle copied to start[cell] + slots already claimed"};return o.setInfo(T),{frame(){o.tick(),L&&(B++,B>(p===6?200:95)&&(B=0,t()));const{width:c,height:g}=e.canvas;e.fillStyle="#06070b",e.fillRect(0,0,c,g);const a=c/q,z=`${11*s}px ui-monospace, Menlo, monospace`;e.font=z,e.textAlign="center";const A=.04*g,h=.13*g;e.strokeStyle="rgba(80, 90, 120, 0.25)",e.lineWidth=1,e.beginPath();for(let i=0;i<=q;i++)e.moveTo(i*a,A-4),e.lineTo(i*a,A+h+4);e.stroke();for(const i of G)e.fillStyle=oe(i.cell),e.beginPath(),e.arc(i.x*c,A+i.jy*h,2.4*s,0,Math.PI*2),e.fill();const b=.66*g,x=.26*g,M=Math.max(...f,1),F=a*.62;for(let i=0;i<q;i++){const d=(b-x)*f[i]/M,y=i*a+(a-F)/2;e.fillStyle=p===0?oe(i):"rgba(122, 162, 255, 0.75)",e.fillRect(y,b-d,F,d),e.fillStyle="#d7dbe6",e.fillText(String(f[i]),i*a+a/2,b+14*s)}if(p>=1&&p<=ne){const i=1<<p-1;e.strokeStyle="rgba(255, 205, 80, 0.5)",e.fillStyle="rgba(255, 205, 80, 0.9)";for(let d=i;d<q;d++){const y=(d-i)*a+a/2,v=d*a+a/2,P=x-8*s-d%2*8*s;e.beginPath(),e.moveTo(y,P),e.lineTo(v-4*s,P),e.stroke(),e.beginPath(),e.moveTo(v,P),e.lineTo(v-5*s,P-3*s),e.lineTo(v-5*s,P+3*s),e.fill()}}const l=.8*g,_=.1*g;if(e.strokeStyle="rgba(80, 90, 120, 0.4)",e.strokeRect(.5,l,c-1,_),p>=5){const i=te;for(let d=0;d<q;d++){const y=f[d],v=y/i*c;e.strokeStyle="rgba(122, 162, 255, 0.5)",e.beginPath(),e.moveTo(v,l),e.lineTo(v,l+_),e.stroke(),u[d]>0&&(e.fillStyle="rgba(215, 219, 230, 0.55)",e.fillText(String(y),v+2+8*s,l+_+13*s))}}if(p===6){const i=te;let d=0;for(let y=0;y<q;y++)for(let v=0;v<u[y];v++){const P=(f[y]+v+.5)/i*c;e.fillStyle=oe(y),e.beginPath(),e.arc(P,l+_/2,2.6*s,0,Math.PI*2),e.fill(),d++}e.fillStyle="rgba(215, 219, 230, 0.7)",e.textAlign="left",e.fillText(`${d} particles, grouped by cell, zero pointers`,6*s,l-5*s),e.textAlign="center"}}}}const _e=`// Smoothed-particle hydrodynamics on a grid-sorted particle buffer.
// Two neighbour passes: density (sum overlapping kernels), then force
// (pressure + near-pressure + XSPH smoothing) with in-place integration.
// Kernel support radius equals one grid cell, so 3×3 cells cover it.

struct SphParams {
  count: u32,
  grid: u32,
  cell: f32,
  dt: f32,
  gravity: f32,
  stiffness: f32,
  restDensity: f32,
  nearStiffness: f32,
  xsph: f32,
  wallK: f32,
  mouseRadius: f32,
  mouseStrength: f32,
  mouse: vec2f,
  mouseVel: vec2f,
  wall: vec2f, // half-extent of the box: |x| < wall.x, wall.y is the floor/top
  _pad: vec2f,
}

@group(0) @binding(0) var<uniform> SP: SphParams;
@group(0) @binding(1) var<storage, read_write> parts: array<vec4f>;
@group(0) @binding(2) var<storage, read> cellStart: array<u32>;
@group(0) @binding(3) var<storage, read> cellCount: array<u32>;
@group(0) @binding(4) var<storage, read_write> density: array<vec2f>;

fn cellCoord(p: vec2f) -> vec2i {
  let g = f32(SP.grid);
  return vec2i(
    i32(clamp((p.x + 1.0) * 0.5 * g, 0.0, g - 1.0)),
    i32(clamp((p.y + 1.0) * 0.5 * g, 0.0, g - 1.0)),
  );
}

@compute @workgroup_size(256)
fn densityPass(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= SP.count) { return; }
  let pi = parts[i].xy;
  let h = SP.cell;
  let cc = cellCoord(pi);
  var rho = 0.0;
  var rhoNear = 0.0;
  for (var oy = -1; oy <= 1; oy++) {
    for (var ox = -1; ox <= 1; ox++) {
      let c = cc + vec2i(ox, oy);
      if (c.x < 0 || c.y < 0 || c.x >= i32(SP.grid) || c.y >= i32(SP.grid)) { continue; }
      let ci = u32(c.y) * SP.grid + u32(c.x);
      let s = cellStart[ci];
      let n = cellCount[ci];
      for (var k = s; k < s + n; k++) {
        let q = length(parts[k].xy - pi) / h;
        if (q < 1.0) {
          let w = 1.0 - q;
          rho += w * w;
          rhoNear += w * w * w;
        }
      }
    }
  }
  density[i] = vec2f(rho, rhoNear);
}

@compute @workgroup_size(256)
fn forcePass(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= SP.count) { return; }
  var p = parts[i];
  let h = SP.cell;
  let di = density[i];
  let pressI = SP.stiffness * (di.x - SP.restDensity);
  let nearI = SP.nearStiffness * di.y;
  let cc = cellCoord(p.xy);

  var acc = vec2f(0.0, -SP.gravity);
  var dv = vec2f(0.0);
  for (var oy = -1; oy <= 1; oy++) {
    for (var ox = -1; ox <= 1; ox++) {
      let c = cc + vec2i(ox, oy);
      if (c.x < 0 || c.y < 0 || c.x >= i32(SP.grid) || c.y >= i32(SP.grid)) { continue; }
      let ci = u32(c.y) * SP.grid + u32(c.x);
      let s = cellStart[ci];
      let n = cellCount[ci];
      for (var k = s; k < s + n; k++) {
        if (k == i) { continue; }
        let d = parts[k].xy - p.xy;
        let r = length(d);
        let q = r / h;
        if (q < 1.0 && r > 1e-7) {
          let dj = density[k];
          let press = 0.5 * (pressI + SP.stiffness * (dj.x - SP.restDensity));
          let near = 0.5 * (nearI + SP.nearStiffness * dj.y);
          let w = 1.0 - q;
          acc -= (d / r) * (press * w + near * w * w);
          dv += (parts[k].zw - p.zw) * w;
        }
      }
    }
  }

  // stirring: cursor drags nearby fluid along its own velocity
  let md = p.xy - SP.mouse;
  let mr = length(md);
  if (mr < SP.mouseRadius) {
    acc += SP.mouseVel * SP.mouseStrength * (1.0 - mr / SP.mouseRadius);
  }

  // the box is three penalty springs, exactly the dome trick from part two
  if (p.x < -SP.wall.x) { acc.x += (-SP.wall.x - p.x) * SP.wallK; }
  if (p.x > SP.wall.x) { acc.x -= (p.x - SP.wall.x) * SP.wallK; }
  if (p.y < -SP.wall.y) { acc.y += (-SP.wall.y - p.y) * SP.wallK; }
  if (p.y > 0.95) { acc.y -= (p.y - 0.95) * SP.wallK; }

  var vel = (p.zw + acc * SP.dt) * 0.9998;
  vel += dv * SP.xsph;
  let speed = length(vel);
  if (speed > 3.0) { vel *= 3.0 / speed; } // CFL safety valve
  parts[i] = vec4f(p.xy + vel * SP.dt, vel);
}
`,Ce=`// Granular contacts on a grid-sorted particle buffer: one neighbour pass.
// Each grain is a disc of radius cell/2, so touching pairs are always in
// the same or adjacent cells. Spring-dashpot contact, then integrate.

struct GrainParams {
  count: u32,
  grid: u32,
  cell: f32,
  dt: f32,
  gravity: f32,
  stiffness: f32,
  damping: f32,
  _pad0: f32,
  _pad1: f32,
  wallK: f32,
  mouseRadius: f32,
  mouseStrength: f32,
  mouse: vec2f,
  mouseVel: vec2f,
  wall: vec2f,
  _pad2: vec2f,
}

@group(0) @binding(0) var<uniform> SP: GrainParams;
@group(0) @binding(1) var<storage, read_write> parts: array<vec4f>;
@group(0) @binding(2) var<storage, read> cellStart: array<u32>;
@group(0) @binding(3) var<storage, read> cellCount: array<u32>;
@group(0) @binding(4) var<storage, read_write> density: array<vec2f>; // unused; layout shared with sph

fn cellCoord(p: vec2f) -> vec2i {
  let g = f32(SP.grid);
  return vec2i(
    i32(clamp((p.x + 1.0) * 0.5 * g, 0.0, g - 1.0)),
    i32(clamp((p.y + 1.0) * 0.5 * g, 0.0, g - 1.0)),
  );
}

@compute @workgroup_size(256)
fn forcePass(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= SP.count) { return; }
  var p = parts[i];
  let dia = SP.cell;
  let cc = cellCoord(p.xy);

  var acc = vec2f(0.0, -SP.gravity);
  for (var oy = -1; oy <= 1; oy++) {
    for (var ox = -1; ox <= 1; ox++) {
      let c = cc + vec2i(ox, oy);
      if (c.x < 0 || c.y < 0 || c.x >= i32(SP.grid) || c.y >= i32(SP.grid)) { continue; }
      let ci = u32(c.y) * SP.grid + u32(c.x);
      let s = cellStart[ci];
      let n = cellCount[ci];
      for (var k = s; k < s + n; k++) {
        if (k == i) { continue; }
        let d = p.xy - parts[k].xy;
        let r = length(d);
        if (r < dia && r > 1e-7) {
          let nrm = d / r;
          acc += nrm * (dia - r) * SP.stiffness;            // spring: push apart
          let vn = dot(p.zw - parts[k].zw, nrm);
          acc -= nrm * vn * SP.damping;                     // dashpot: kill bounce
        }
      }
    }
  }

  let md = p.xy - SP.mouse;
  let mr = length(md);
  if (mr < SP.mouseRadius) {
    acc += SP.mouseVel * SP.mouseStrength * (1.0 - mr / SP.mouseRadius);
  }

  if (p.x < -SP.wall.x) { acc.x += (-SP.wall.x - p.x) * SP.wallK; }
  if (p.x > SP.wall.x) { acc.x -= (p.x - SP.wall.x) * SP.wallK; }
  if (p.y < -SP.wall.y) { acc.y += (-SP.wall.y - p.y) * SP.wallK; }
  if (p.y > 0.95) { acc.y -= (p.y - 0.95) * SP.wallK; }

  var vel = (p.zw + acc * SP.dt) * 0.999;
  let speed = length(vel);
  if (speed > 3.0) { vel *= 3.0 / speed; }
  parts[i] = vec4f(p.xy + vel * SP.dt, vel);
}
`,Te=`// GPU counting sort over a uniform grid: histogram, three-dispatch prefix
// sum (workgroup scans + block-sum scan + add-back), then scatter into
// cell order. After this runs, every cell's particles sit contiguously in
// the sorted buffer, with starts[] saying where each cell begins.

struct GridParams {
  count: u32,
  grid: u32,
  _pad0: u32,
  _pad1: u32,
}

@group(0) @binding(0) var<uniform> GP: GridParams;
@group(0) @binding(1) var<storage, read> partsIn: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> counts: array<atomic<u32>>;
@group(0) @binding(3) var<storage, read_write> starts: array<u32>;
@group(0) @binding(4) var<storage, read_write> blockSums: array<u32>;
@group(0) @binding(5) var<storage, read_write> cursor: array<atomic<u32>>;
@group(0) @binding(6) var<storage, read_write> sorted: array<vec4f>;

fn cellOf(p: vec2f) -> u32 {
  let g = f32(GP.grid);
  let cx = u32(clamp((p.x + 1.0) * 0.5 * g, 0.0, g - 1.0));
  let cy = u32(clamp((p.y + 1.0) * 0.5 * g, 0.0, g - 1.0));
  return cy * GP.grid + cx;
}

// ---- pass 1: histogram -----------------------------------------------------

@compute @workgroup_size(256)
fn count(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= GP.count) { return; }
  atomicAdd(&counts[cellOf(partsIn[gid.x].xy)], 1u);
}

// ---- pass 2: prefix sum (Hillis-Steele inside each 256-wide workgroup) ----

var<workgroup> sa: array<u32, 256>;
var<workgroup> sb: array<u32, 256>;

// Inclusive scan of the 256 values staged in sa. Ping-pongs between two
// shared arrays so each pass reads only values the previous pass finished.
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
  return sa[lid]; // 8 passes: result lands back in sa
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
  starts[gid.x] = inclusive - v0; // exclusive: cells before me, within this block
  if (lid.x == 255u) { blockSums[wid.x] = inclusive; }
}

@compute @workgroup_size(256)
fn scan_sums(@builtin(local_invocation_id) lid: vec3u) {
  let v0 = blockSums[lid.x];
  sa[lid.x] = v0;
  workgroupBarrier();
  let inclusive = scanShared(lid.x);
  blockSums[lid.x] = inclusive - v0; // exclusive scan of the block totals
}

@compute @workgroup_size(256)
fn scan_add(
  @builtin(global_invocation_id) gid: vec3u,
  @builtin(workgroup_id) wid: vec3u,
) {
  starts[gid.x] = starts[gid.x] + blockSums[wid.x];
}

// ---- pass 3: scatter into cell order ---------------------------------------
// cursor starts as a copy of starts[]; each particle claims the next slot in
// its cell with one atomicAdd. The full state is copied (not an index) so
// neighbours in space become neighbours in memory.

@compute @workgroup_size(256)
fn scatter(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= GP.count) { return; }
  let p = partsIn[gid.x];
  let slot = atomicAdd(&cursor[cellOf(p.xy)], 1u);
  sorted[slot] = p;
}
`,Q=256,j=Q*Q,le=256,se=j/le;class Ue{counts;starts;dev;params;blockSums;cursor;layout;pipes={};constructor(o){this.dev=o;const e=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC;this.params=o.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.counts=o.createBuffer({size:j*4,usage:e}),this.starts=o.createBuffer({size:j*4,usage:e}),this.blockSums=o.createBuffer({size:se*4,usage:e}),this.cursor=o.createBuffer({size:j*4,usage:e});const s=f=>({type:f});this.layout=o.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:s("uniform")},{binding:1,visibility:GPUShaderStage.COMPUTE,buffer:s("read-only-storage")},{binding:2,visibility:GPUShaderStage.COMPUTE,buffer:s("storage")},{binding:3,visibility:GPUShaderStage.COMPUTE,buffer:s("storage")},{binding:4,visibility:GPUShaderStage.COMPUTE,buffer:s("storage")},{binding:5,visibility:GPUShaderStage.COMPUTE,buffer:s("storage")},{binding:6,visibility:GPUShaderStage.COMPUTE,buffer:s("storage")}]});const G=o.createShaderModule({code:Te}),u=o.createPipelineLayout({bindGroupLayouts:[this.layout]});for(const f of["count","scan_blocks","scan_sums","scan_add","scatter"])this.pipes[f]=o.createComputePipeline({layout:u,compute:{module:G,entryPoint:f}})}bindGroup(o,e){return this.dev.createBindGroup({layout:this.layout,entries:[{binding:0,resource:{buffer:this.params}},{binding:1,resource:{buffer:o}},{binding:2,resource:{buffer:this.counts}},{binding:3,resource:{buffer:this.starts}},{binding:4,resource:{buffer:this.blockSums}},{binding:5,resource:{buffer:this.cursor}},{binding:6,resource:{buffer:e}}]})}writeParams(o){this.dev.queue.writeBuffer(this.params,0,new Uint32Array([o,Q,0,0]))}encode(o,e,s){const G=Math.ceil(s/le);o.clearBuffer(this.counts);let u=o.beginComputePass();u.setBindGroup(0,e),u.setPipeline(this.pipes.count),u.dispatchWorkgroups(G),u.setPipeline(this.pipes.scan_blocks),u.dispatchWorkgroups(se),u.setPipeline(this.pipes.scan_sums),u.dispatchWorkgroups(1),u.setPipeline(this.pipes.scan_add),u.dispatchWorkgroups(se),u.end(),o.copyBufferToBuffer(this.starts,0,this.cursor,0,j*4),u=o.beginComputePass(),u.setBindGroup(0,e),u.setPipeline(this.pipes.scatter),u.dispatchWorkgroups(G),u.end()}dispose(){for(const o of[this.params,this.counts,this.starts,this.blockSums,this.cursor])o.destroy()}}const Ae=256,ce=2/Q;function Be(S,o){const e=ce*.5,s=Math.floor(1.3/e),G=new Float32Array(S*4);for(let u=0;u<S;u++){const f=u%s,p=Math.floor(u/s);G[u*4]=-.93+f*e+(Math.random()-.5)*e*.4,G[u*4+1]=o+e*(p+.7)+(Math.random()-.5)*e*.4}return G}function ze(S,o){const e=new Float32Array(S*4);for(let s=0;s<S;s++)e[s*4]=(Math.random()*2-1)*.9,e[s*4+1]=o+.25+Math.random()*(.9-o-.27);return e}async function re(S,o){const e=await ue(),s=new ae(S,o.hero?.5:.62);if(!e)return fe(S);const G=de(s.canvas,e),u=new Se(e,G),f=new Ue(e),p=o.mode==="sph",L=s.canvas.width/s.canvas.height,B=1.03*L,C=-.95/B,t=e.createBuffer({size:80,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),T=e.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:{type:"uniform"}},{binding:1,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}},{binding:2,visibility:GPUShaderStage.COMPUTE,buffer:{type:"read-only-storage"}},{binding:3,visibility:GPUShaderStage.COMPUTE,buffer:{type:"read-only-storage"}},{binding:4,visibility:GPUShaderStage.COMPUTE,buffer:{type:"storage"}}]}),c=e.createPipelineLayout({bindGroupLayouts:[T]}),g=e.createShaderModule({code:p?_e:Ce}),a=r=>e.createComputePipeline({layout:c,compute:{module:g,entryPoint:r}}),z=p?a("densityPass"):null,A=a("forcePass");let h=o.count??(p?5e4:12e3),b=o.steps??5,x=[null,null],M=null,F=[null,null],l=[null,null],_=0;const i=()=>{for(const n of x)n?.destroy();M?.destroy();const r=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC;x=[e.createBuffer({size:h*16,usage:r}),e.createBuffer({size:h*16,usage:r})],M=e.createBuffer({size:h*8,usage:GPUBufferUsage.STORAGE}),e.queue.writeBuffer(x[0],0,(p?Be:ze)(h,C)),F=[f.bindGroup(x[0],x[1]),f.bindGroup(x[1],x[0])];const k=n=>e.createBindGroup({layout:T,entries:[{binding:0,resource:{buffer:t}},{binding:1,resource:{buffer:n}},{binding:2,resource:{buffer:f.starts}},{binding:3,resource:{buffer:f.counts}},{binding:4,resource:{buffer:M}}]});l=[k(x[1]),k(x[0])],_=0};i();let d=[99,99],y=[0,0],v=0;s.canvas.addEventListener("pointermove",r=>{const k=s.canvas.getBoundingClientRect(),n=(r.clientX-k.left)/k.width*2-1,w=-((r.clientY-k.top)/k.height*2-1),D=n*L/B,U=w/B,E=performance.now(),I=Math.min((E-v)/1e3,.1)||.016;if(v=E,d[0]<90){const O=(D-d[0])/I,H=(U-d[1])/I,X=Math.hypot(O,H),J=X>4?4/X:1;y=[y[0]*.6+O*J*.4,y[1]*.6+H*J*.4]}d=[D,U]}),s.canvas.addEventListener("pointerleave",()=>{d=[99,99],y=[0,0]}),o.hero||(s.slider({label:"particles",min:p?1e4:2e3,max:p?8e4:3e4,step:1e3,value:h,log:!0,format:r=>Math.round(r).toLocaleString(),onInput:r=>{h=Math.round(r),i()}}),s.slider({label:"steps / frame",min:1,max:8,step:1,value:b,onInput:r=>b=Math.round(r)}),s.button("re-pour",i)),s.setInfo(()=>o.hero?`${h.toLocaleString()} particles of ${p?"water":"sand"} — stir with your cursor`:`${h.toLocaleString()} particles · sorted into ${j.toLocaleString()} cells ${b}× per frame · stir with your cursor`);const P=()=>{const r=new DataView(new ArrayBuffer(80));r.setUint32(0,h,!0),r.setUint32(4,Q,!0),r.setFloat32(8,ce,!0),r.setFloat32(12,.0016,!0),p?(r.setFloat32(16,3,!0),r.setFloat32(20,60,!0),r.setFloat32(24,2.2,!0),r.setFloat32(28,240,!0),r.setFloat32(32,.03,!0)):(r.setFloat32(16,3,!0),r.setFloat32(20,4e3,!0),r.setFloat32(24,50,!0)),r.setFloat32(36,2e3,!0),r.setFloat32(40,.18,!0),r.setFloat32(44,60,!0),r.setFloat32(48,d[0],!0),r.setFloat32(52,d[1],!0),r.setFloat32(56,y[0],!0),r.setFloat32(60,y[1],!0),r.setFloat32(64,.95,!0),r.setFloat32(68,-C,!0),e.queue.writeBuffer(t,0,r.buffer)};return{frame(){s.tick(),P(),f.writeParams(h);const r=Math.ceil(h/Ae),k=e.createCommandEncoder();for(let n=0;n<b;n++){f.encode(k,F[_],h);const w=k.beginComputePass();w.setBindGroup(0,l[_]),z&&(w.setPipeline(z),w.dispatchWorkgroups(r)),w.setPipeline(A),w.dispatchWorkgroups(r),w.end(),_=1-_}u.bind(x[_]),u.encode(k,h,{scale:B,size:p?.0035:.005,colorScale:.9}),e.queue.submit([k.finish()])},dispose(){f.dispose();for(const r of x)r?.destroy();M?.destroy(),t.destroy()}}}const W=6,Y=18,Z=["#7aa2ff","#7dd6a0","#ffb86b","#ff8585","#c79bff","#6ad4d4"];function Oe(S){const o=xe(7),e=[],s=[],G=[];for(let t=0;t<Y;t++){const T=Math.floor(o()*W);e.push(T),s.push((T+.15+o()*.7)/W),G.push(.2+o()*.6)}const u=new Array(W).fill(0);for(const t of e)u[t]++;const f=[u.slice()];for(let t=1;t<W;t*=2){const T=f[f.length-1],c=T.slice();for(let g=t;g<W;g++)c[g]=T[g]+T[g-t];f.push(c)}const L=[0,...f[f.length-1].slice(0,-1)],B=new Array(W).fill(0),C=[];for(let t=0;t<Y;t++)C.push(L[e[t]]+B[e[t]]++);Pe(S,{screens:5,aspect:.66,steps:[{at:0,text:"18 particles in a strip of 6 cells, coloured by which cell they fall in. The goal: every cell's particles contiguous in one array, no lists, no pointers."},{at:.14,text:"Pass 1 — histogram. Every particle atomically bumps its cell's counter. Thousands of threads can do this at once; order doesn't matter, only the totals."},{at:.34,text:"Pass 2 — scan. Where does each cell's run start? That's the running total of all counts before it. Hillis–Steele: every element adds the value 1 to its left, then 2, then 4. After log₂(n) rounds, done — all elements in parallel each round."},{at:.72,text:"Pass 3 — scatter. Each particle claims a slot: start of its cell's run, plus an atomic ticket. One copy, and the array is sorted."},{at:.92,text:"Neighbours in space are now neighbours in memory. The 3×3 query reads each cell as one clean contiguous run."}],draw(t,T,c,g){const a=Math.max(56,T*.08),z=T-2*a,A=c*.05,h=c*.24,b=z/W,x=K(g,0,.1),M=K(g,.14,.32),F=K(g,.34,.4),l=K(g,.72,.92);t.save(),t.globalAlpha=x,t.strokeStyle=R.grid,t.lineWidth=1;for(let n=0;n<=W;n++)t.beginPath(),t.moveTo(a+n*b,A),t.lineTo(a+n*b,A+h),t.stroke();t.strokeRect(a,A,z,h);for(let n=0;n<W;n++)N(t,`cell ${n}`,a+n*b+b/2,A-10,{color:R.muted,size:10,align:"center",alpha:x});t.restore();const _=A+h+c*.07,i=c*.075;if(M>0||g>=.32){for(let n=0;n<W;n++){const w=Math.round(u[n]*Math.min(1,M*1.6));t.globalAlpha=Math.min(1,M*2),t.strokeStyle=R.grid,t.strokeRect(a+n*b+4,_,b-8,i),N(t,String(w),a+n*b+b/2,_+i/2,{color:R.text,size:13,align:"center",mono:!0,alpha:Math.min(1,M*2)})}N(t,"counts",a-8,_+i/2,{color:R.muted,size:10,align:"right",alpha:Math.min(1,M*2)}),t.globalAlpha=1}const d=_+i+c*.04,y=i+c*.025,v=f.length-1;for(let n=1;n<=v;n++){const w=.4+(n-1)/v*.3,D=.4+n/v*.3,U=K(g,w,D);if(U<=0)continue;const E=d+(n-1)*y,I=1<<n-1;for(let O=0;O<W;O++){t.globalAlpha=U,t.strokeStyle=R.grid,t.strokeRect(a+O*b+4,E,b-8,i);const H=U>.6?f[n][O]:f[n-1][O];if(N(t,String(H),a+O*b+b/2,E+i/2,{color:O>=I&&U>.6?R.warm:R.text,size:13,align:"center",mono:!0,alpha:U}),O>=I&&U>.15&&U<.85){const X=a+(O-I)*b+b/2,J=E-y+i,ee=K(U,.15,.6);t.globalAlpha=ee*(1-K(U,.7,.85)),we(t,X,J,V(X,a+O*b+b/2,ee),V(J,E,ee),R.accent,1.2,5)}}N(t,`+${I}`,a-8,E+i/2,{color:R.accent,size:11,align:"right",mono:!0,alpha:U}),t.globalAlpha=1}F>0&&N(t,"scan: running totals in log₂ rounds",a+z,d-8,{color:R.muted,size:10,align:"right",alpha:F*(1-K(g,.85,.95))});const P=d+v*y+c*.02,r=z/Y,k=K(g,.68,.74);if(k>0){t.globalAlpha=k,t.strokeStyle=R.grid;for(let n=0;n<Y;n++)t.strokeRect(a+n*r,P,r,i);for(let n=0;n<W;n++){const w=a+L[n]*r;t.strokeStyle=Z[n],t.beginPath(),t.moveTo(w,P-5),t.lineTo(w,P+i+5),t.stroke(),N(t,String(L[n]),w+3,P+i+12,{color:Z[n],size:9,mono:!0,alpha:k})}N(t,"sorted",a-8,P+i/2,{color:R.muted,size:10,align:"right",alpha:k}),t.globalAlpha=1}for(let n=0;n<Y;n++){const w=a+s[n]*z,D=A+G[n]*h,U=a+C[n]*r+r/2,E=P+i/2,I=K(l,n/Y*.5,n/Y*.5+.5),O=V(w,U,I),H=V(D,E,I)-Math.sin(I*Math.PI)*18;t.globalAlpha=x,t.fillStyle=Z[e[n]],t.beginPath(),t.arc(O,H,4.4,0,Math.PI*2),t.fill()}if(t.globalAlpha=1,M>0&&M<1){t.save();for(let n=0;n<Y;n++){const w=K(M,n/Y*.7,n/Y*.7+.3);if(w<=0||w>=1)continue;const D=a+s[n]*z,U=A+G[n]*h,E=a+e[n]*b+b/2,I=_;t.globalAlpha=.6*Math.sin(w*Math.PI),t.fillStyle=Z[e[n]],t.beginPath(),t.arc(V(D,E,w),V(U,I,w),2,0,Math.PI*2),t.fill()}t.restore()}}})}pe();const Le={"hero-fluid":S=>re(S,{mode:"sph",count:45e3,hero:!0}),"naive-contacts":ve,"grid-cursor":Me,scan:Ge,grains:S=>re(S,{mode:"grains",count:12e3}),sph:S=>re(S,{mode:"sph",count:5e4})};for(const S of document.querySelectorAll("[data-demo]")){const o=S.dataset.demo,e=Le[o];e&&ge(S,()=>e(S))}const Fe={"sort-pipeline":Oe};for(const S of document.querySelectorAll("[data-scrolly]"))Fe[S.dataset.scrolly]?.(S);
