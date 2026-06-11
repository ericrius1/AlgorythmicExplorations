import{S as U,g as ce,a as ue,c as fe,i as pe,m as ye}from"./gpu-B6g-pxzC.js";import{G as $,s as C,T as ve}from"./seed-DVlONlXS.js";import{P as de}from"./particleRenderer-LiyiEjJ-.js";import{m as be,P as A,l as q,p as R,a as ne,b as oe,r as xe}from"./scrolly-Bq15bFnz.js";const se=.066;function we(y){const t=new U(y,.62),n=t.canvas.getContext("2d");let f=.06,a=1,c=[{x:.55,y:0,vx:0,vy:Math.sqrt(se/.55)}];t.slider({label:"gravity ×",min:.2,max:3,step:.05,value:a,onInput:l=>a=l}),t.slider({label:"softening ε",min:.01,max:.3,step:.005,value:f,onInput:l=>f=l}),t.button("clear",()=>{c=[]}),t.setInfo(()=>`${c.length} bodies · drag on the canvas to launch one`);let o=null;const r=l=>{const i=t.canvas.getBoundingClientRect(),d=Math.min(i.width,i.height)/2/1.2;return[(l.clientX-i.left-i.width/2)/d,-(l.clientY-i.top-i.height/2)/d]};t.canvas.addEventListener("pointerdown",l=>{const[i,d]=r(l);o={x:i,y:d,cx:i,cy:d},t.canvas.setPointerCapture(l.pointerId)}),t.canvas.addEventListener("pointermove",l=>{if(!o)return;const[i,d]=r(l);o.cx=i,o.cy=d}),t.canvas.addEventListener("pointerup",()=>{o&&(c.length<24&&c.push({x:o.x,y:o.y,vx:(o.cx-o.x)*1.2,vy:(o.cy-o.y)*1.2}),o=null)});const{width:h,height:s}=n.canvas;return n.fillStyle="#06070b",n.fillRect(0,0,h,s),{frame(){t.tick();const l=se*a,i=f*f,d=.004;for(let b=0;b<4;b++){for(const k of c){let S=k.x*k.x+k.y*k.y+i,x=l/(S*Math.sqrt(S)),B=-k.x*x,g=-k.y*x;for(const m of c){if(m===k)continue;const w=m.x-k.x,M=m.y-k.y;S=w*w+M*M+i,x=l*.02/(S*Math.sqrt(S)),B+=w*x,g+=M*x}k.vx+=B*d,k.vy+=g*d}for(const k of c)k.x+=k.vx*d,k.y+=k.vy*d}c=c.filter(b=>Math.abs(b.x)<6&&Math.abs(b.y)<6),n.fillStyle="rgba(6, 7, 11, 0.08)",n.fillRect(0,0,h,s);const u=Math.min(h,s)/2/1.2,e=h/2,p=s/2,P=n.createRadialGradient(e,p,0,e,p,14);P.addColorStop(0,"rgba(255, 235, 180, 1)"),P.addColorStop(1,"rgba(255, 235, 180, 0)"),n.fillStyle=P,n.fillRect(e-14,p-14,28,28),n.fillStyle="rgb(140, 180, 255)";for(const b of c)n.beginPath(),n.arc(e+b.x*u,p-b.y*u,2.4,0,Math.PI*2),n.fill();o&&(n.strokeStyle="rgba(255, 220, 120, 0.9)",n.lineWidth=1.5,n.beginPath(),n.moveTo(e+o.x*u,p-o.y*u),n.lineTo(e+o.cx*u,p-o.cy*u),n.stroke())}}}function Pe(y,t){const{state:n,mass:f,count:a}=y,c=t.softening*t.softening;for(let o=0;o<a;o++){const r=n[o*4],h=n[o*4+1];let s=0,l=0;for(let i=0;i<a;i++){const d=n[i*4]-r,u=n[i*4+1]-h,e=d*d+u*u+c,p=$*f[i]/(e*Math.sqrt(e));s+=d*p,l+=u*p}n[o*4+2]+=s*t.dt,n[o*4+3]+=l*t.dt}for(let o=0;o<a;o++)n[o*4]+=n[o*4+2]*t.dt,n[o*4+1]+=n[o*4+3]*t.dt;return a*a}const Me=18;function me(y){const{state:t,mass:n,count:f}=y;let a=1/0,c=1/0,o=-1/0,r=-1/0;for(let x=0;x<f;x++){const B=t[x*4],g=t[x*4+1];B<a&&(a=B),g<c&&(c=g),B>o&&(o=B),g>r&&(r=g)}isFinite(a)||(a=-1,c=-1,o=1,r=1);const h=Math.max(o-a,r-c,1e-6)*.5*1.0001,s=f*4+64,l=new Float64Array(s),i=new Float64Array(s),d=new Float64Array(s),u=new Int32Array(s*4).fill(-1),e=new Int32Array(s).fill(-1);l[0]=(a+o)*.5,i[0]=(c+r)*.5,d[0]=h;let p=1;const P=(x,B,g,m)=>(x>=g?1:0)+(B>=m?2:0);for(let x=0;x<f;x++){const B=t[x*4],g=t[x*4+1];let m=0,w=0;for(;;){if(u[m*4]===-1){if(e[m]===-1){e[m]=x;break}if(w>=Me||p+4>s)break;const M=e[m];e[m]=-1;const I=d[m]*.5;for(let _=0;_<4;_++){const L=p++;l[L]=l[m]+(_&1?I:-I),i[L]=i[m]+(_&2?I:-I),d[L]=I,u[m*4+_]=L}e[u[m*4+P(t[M*4],t[M*4+1],l[m],i[m])]]=M}m=u[m*4+P(B,g,l[m],i[m])],w++}}const b=new Float64Array(p),k=new Float64Array(p),S=new Float64Array(p);for(let x=p-1;x>=0;x--)if(u[x*4]===-1){const B=e[x];B>=0&&(S[x]=n[B],b[x]=t[B*4],k[x]=t[B*4+1])}else{let B=0,g=0,m=0;for(let w=0;w<4;w++){const M=u[x*4+w];M>=0&&S[M]>0?(B+=S[M],g+=b[M]*S[M],m+=k[M]*S[M]):u[x*4+w]=-1}S[x]=B,b[x]=B>0?g/B:l[x],k[x]=B>0?m/B:i[x]}return{nodeCount:p,cx:l,cy:i,half:d,child:u,comX:b,comY:k,mass:S}}function he(y,t,n,f,a,c,o){const r=f*f,h=a*a;let s=0;c.ax=0,c.ay=0;const l=[0];for(;l.length>0;){const i=l.pop();if(y.mass[i]<=0)continue;const d=y.comX[i]-t,u=y.comY[i]-n,e=d*d+u*u+h,p=y.half[i]*2;if(y.child[i*4]===-1||p*p<r*e){const b=$*y.mass[i]/(e*Math.sqrt(e));c.ax+=d*b,c.ay+=u*b,s++,o?.(i)}else for(let b=0;b<4;b++){const k=y.child[i*4+b];k>=0&&l.push(k)}}return s}function ge(y,t,n){const f=me(y),{state:a,count:c}=y,o={ax:0,ay:0};let r=0;for(let h=0;h<c;h++)r+=he(f,a[h*4],a[h*4+1],n,t.softening,o),a[h*4+2]+=o.ax*t.dt,a[h*4+3]+=o.ay*t.dt;for(let h=0;h<c;h++)a[h*4]+=a[h*4+2]*t.dt,a[h*4+1]+=a[h*4+3]*t.dt;return{tree:f,checks:r}}function J(y,t,n,f="rgba(140, 170, 255, 0.8)"){const{width:a,height:c}=y.canvas;y.fillStyle="#06070b",y.fillRect(0,0,a,c),y.fillStyle=f;const o=Math.min(a,c)/2*n.scale,r=a/2,h=c/2;for(let s=0;s<t.count;s++){const l=r+t.state[s*4]*o,i=h-t.state[s*4+1]*o;y.fillRect(l,i,1.5,1.5)}}function ke(y){const t=new U(y),n=t.canvas.getContext("2d");let f=1500,a=C(f),c=0,o=0;return t.slider({label:"bodies",min:100,max:8e3,step:100,value:f,log:!0,format:r=>String(Math.round(r)),onInput:r=>{f=Math.round(r),a=C(f)}}),t.button("re-seed",()=>{a=C(f)}),t.setInfo(()=>`${o.toLocaleString()} pair forces/step · ${c.toFixed(1)} ms/step on the CPU`),{frame(){t.tick();const r=performance.now();o=Pe(a,{dt:.016,softening:.05}),c=performance.now()-r,J(n,a,{scale:.8})}}}const Se=`// Direct O(n²) summation with workgroup-shared tiling.
// One thread per body; the workgroup cooperatively stages 256 bodies at a
// time in fast shared memory so each position is fetched from global memory
// once per workgroup instead of once per thread.

struct SimParams {
  count: u32,
  dt: f32,
  g: f32,
  softening: f32,
}

@group(0) @binding(0) var<uniform> P: SimParams;
@group(0) @binding(1) var<storage, read> inBodies: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> outBodies: array<vec4f>;
@group(0) @binding(3) var<storage, read> mass: array<f32>;

const TILE: u32 = 256u;
var<workgroup> shared_pos: array<vec3f, 256>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u, @builtin(local_invocation_id) lid: vec3u) {
  let i = gid.x;
  let valid = i < P.count;
  var pos = vec2f(0.0);
  var vel = vec2f(0.0);
  if (valid) {
    let b = inBodies[i];
    pos = b.xy;
    vel = b.zw;
  }

  var acc = vec2f(0.0);
  let eps2 = P.softening * P.softening;
  let tiles = (P.count + TILE - 1u) / TILE;

  for (var t: u32 = 0u; t < tiles; t = t + 1u) {
    let j = t * TILE + lid.x;
    if (j < P.count) {
      shared_pos[lid.x] = vec3f(inBodies[j].xy, mass[j]);
    } else {
      shared_pos[lid.x] = vec3f(0.0);
    }
    workgroupBarrier();
    for (var k: u32 = 0u; k < TILE; k = k + 1u) {
      let o = shared_pos[k];
      let d = o.xy - pos;
      let r2 = dot(d, d) + eps2;
      acc = acc + d * (P.g * o.z / (r2 * sqrt(r2)));
    }
    workgroupBarrier();
  }

  if (valid) {
    vel = vel + acc * P.dt;
    outBodies[i] = vec4f(pos + vel * P.dt, vel);
  }
}
`,Be=256;async function Ie(y){const t=await ce(),n=new U(y);if(!t)return ue(y);const f=fe(n.canvas,t),a=new de(t,f),c=t.createComputePipeline({layout:"auto",compute:{module:t.createShaderModule({code:Se}),entryPoint:"main"}}),o=t.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});let r=3e4,h=[null,null],s=null,l=[null,null],i=0;const d=()=>{const u=C(r);for(const P of h)P?.destroy();s?.destroy();const e=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST;h=[t.createBuffer({size:r*16,usage:e}),t.createBuffer({size:r*16,usage:e})],t.queue.writeBuffer(h[0],0,u.state),s=t.createBuffer({size:r*4,usage:e}),t.queue.writeBuffer(s,0,u.mass);const p=(P,b)=>t.createBindGroup({layout:c.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:o}},{binding:1,resource:{buffer:P}},{binding:2,resource:{buffer:b}},{binding:3,resource:{buffer:s}}]});l=[p(h[0],h[1]),p(h[1],h[0])],i=0};return d(),n.slider({label:"bodies",min:1e3,max:12e4,step:1e3,value:r,log:!0,format:u=>Math.round(u).toLocaleString(),onInput:u=>{r=Math.round(u),d()}}),n.button("re-seed",d),n.setInfo(()=>`${(r*r/1e6).toFixed(0)}M pair forces per step, every step`),{frame(){n.tick();const u=new DataView(new ArrayBuffer(16));u.setUint32(0,r,!0),u.setFloat32(4,.016,!0),u.setFloat32(8,$,!0),u.setFloat32(12,.05,!0),t.queue.writeBuffer(o,0,u.buffer);const e=t.createCommandEncoder(),p=e.beginComputePass();p.setPipeline(c),p.setBindGroup(0,l[i]),p.dispatchWorkgroups(Math.ceil(r/Be)),p.end(),i=1-i,a.bind(h[i]),a.encode(e,r,{scale:1}),t.queue.submit([e.finish()])}}}const O=3e3,H=.8;function Fe(y){const t=new U(y),n=t.canvas.getContext("2d");let f=C(O),a=.8,c=!1,o=0,r=[.4,.25];t.slider({label:"θ (accuracy ↔ speed)",min:.1,max:2,step:.05,value:a,onInput:s=>a=s}),t.button("toggle full tree",()=>c=!c),t.button("re-seed",()=>f=C(O)),t.setInfo(()=>`cursor's force sum: ${o} clusters instead of ${O.toLocaleString()} bodies (${(o/O*100).toFixed(1)}% of the work)`),t.canvas.addEventListener("pointermove",s=>{const l=t.canvas.getBoundingClientRect(),i=Math.min(l.width,l.height)/2*H;r=[(s.clientX-l.left-l.width/2)/i,-(s.clientY-l.top-l.height/2)/i]}),t.canvas.addEventListener("pointerleave",()=>r=null);const h=(s,l,i,d,u,e)=>{n.strokeStyle=i;const p=s.half[l]*d;n.strokeRect(u+(s.cx[l]-s.half[l])*d,e-(s.cy[l]+s.half[l])*d,p*2,p*2)};return{frame(){t.tick();const{tree:s}=ge(f,{dt:.016,softening:.05},a);J(n,f,{scale:H});const{width:l,height:i}=n.canvas,d=Math.min(l,i)/2*H,u=l/2,e=i/2;if(n.lineWidth=1,c){const p=me(f);for(let P=0;P<p.nodeCount;P++)p.mass[P]<=0||h(p,P,"rgba(60, 200, 110, 0.18)",d,u,e)}if(r){const p={ax:0,ay:0},P=[];o=he(s,r[0],r[1],a,.05,p,b=>P.push(b));for(const b of P)h(s,b,"rgba(255, 205, 80, 0.5)",d,u,e),n.strokeStyle="rgba(255, 205, 80, 0.16)",n.beginPath(),n.moveTo(u+r[0]*d,e-r[1]*d),n.lineTo(u+s.comX[b]*d,e-s.comY[b]*d),n.stroke();n.fillStyle="rgb(255, 230, 120)",n.beginPath(),n.arc(u+r[0]*d,e-r[1]*d,4,0,Math.PI*2),n.fill()}}}}const ie=4e3,j=7,re=.8;function Le(y){const t=new U(y),n=t.canvas.getContext("2d");let f=C(ie),a=4;return t.slider({label:"pyramid level",min:0,max:j,step:1,value:a,format:c=>`${c} (${1<<c}×${1<<c} cells)`,onInput:c=>a=Math.round(c)}),t.button("re-seed",()=>f=C(ie)),t.setInfo(()=>{const c=1<<a;return`level ${a}: ${(c*c).toLocaleString()} cells · each cell = mass + centre of mass`}),{frame(){t.tick(),ge(f,{dt:.016,softening:.05},.8),J(n,f,{scale:re},"rgba(120, 150, 235, 0.35)");let c=1/0,o=1/0,r=-1/0,h=-1/0;for(let g=0;g<f.count;g++){const m=f.state[g*4],w=f.state[g*4+1];m<c&&(c=m),w<o&&(o=w),m>r&&(r=m),w>h&&(h=w)}const s=Math.max(r-c,h-o,1e-6)*.5*1.0001,l=(c+r)*.5-s,i=(o+h)*.5-s,d=s*2;let u=1<<j,e=new Float32Array(u*u*3);for(let g=0;g<f.count;g++){const m=Math.min(u-1,Math.max(0,Math.floor((f.state[g*4]-l)/d*u))),w=Math.min(u-1,Math.max(0,Math.floor((f.state[g*4+1]-i)/d*u))),M=f.mass[g],I=(w*u+m)*3;e[I]+=M,e[I+1]+=M*f.state[g*4],e[I+2]+=M*f.state[g*4+1]}for(let g=j-1;g>=a;g--){const m=1<<g,w=new Float32Array(m*m*3);for(let M=0;M<m;M++)for(let I=0;I<m;I++){const _=(M*m+I)*3;for(let L=0;L<4;L++){const G=((M*2+(L>>1))*m*2+I*2+(L&1))*3;w[_]+=e[G],w[_+1]+=e[G+1],w[_+2]+=e[G+2]}}e=w,u=m}const{width:p,height:P}=n.canvas,b=Math.min(p,P)/2*re,k=p/2,S=P/2,x=d/u*b;let B=0;for(let g=0;g<e.length;g+=3)e[g]>B&&(B=e[g]);for(let g=0;g<u;g++)for(let m=0;m<u;m++){const w=e[(g*u+m)*3];if(w<=0)continue;const M=Math.pow(w/B,.4),I=k+(l+m/u*d)*b,_=S-(i+(g+1)/u*d)*b;n.fillStyle=`rgba(${90+M*165}, ${200-M*60}, ${120-M*60}, ${.1+M*.35})`,n.fillRect(I,_,x,x),n.strokeStyle="rgba(80, 220, 130, 0.25)",n.strokeRect(I,_,x,x)}n.fillStyle="rgba(255, 90, 220, 0.9)";for(let g=0;g<u;g++)for(let m=0;m<u;m++){const w=(g*u+m)*3;if(e[w]<=0)continue;const M=e[w+1]/e[w],I=e[w+2]/e[w];n.fillRect(k+M*b-1.5,S-I*b-1.5,3,3)}}}}const _e=`// GPU-resident Barnes-Hut via an implicit quadtree pyramid.
//
// Per substep: clear_grid -> reduce_bounds -> scatter -> resolve -> reduce
// (finest-1 .. 0) -> force. The tree is a complete quadtree stored level by
// level in \`nodes\` (vec4f: com.xy, mass, unused); children of (level, ix, iy)
// are (level+1, 2ix+dx, 2iy+dy), so traversal needs no pointers and the whole
// sim stays on the GPU.
//
// FINEST/DIM/FP_SCALE/LEVEL are pipeline-overridable constants baked at
// pipeline creation (they only change when the particle count changes), so
// there is no pyramid uniform buffer and the compiler can fold them.
//
// No kernel reads another particle's body — cross-particle information flows
// only through grid/nodes — so \`force\` integrates in place and no ping-pong
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
`,Y=256,Ee=36e8;function Te(y){return((1<<2*y)-1)/3}function Ae(y){const t=Math.ceil(Math.log2(Math.max(y,2))/2);return Math.min(10,Math.max(5,t))}class ae{count;finestLevel;gridDim;bodies;dt=.016;softening=.05;theta=.75;dev;simParams;grid;nodes;bounds;mass;pClear;pBounds;pScatter;pResolve;pReduce=[];pForce;gClear;gBounds;gScatter;gResolve;gReduce=[];gForce;constructor(t,n){this.dev=t,this.count=n.count,this.finestLevel=Ae(n.count),this.gridDim=1<<this.finestLevel;const f=this.gridDim*this.gridDim,a=Ee/ve;this.bodies=t.createBuffer({size:n.count*16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),t.queue.writeBuffer(this.bodies,0,n.state),this.mass=t.createBuffer({size:n.count*4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),t.queue.writeBuffer(this.mass,0,n.mass),this.simParams=t.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.grid=t.createBuffer({size:f*16,usage:GPUBufferUsage.STORAGE}),this.nodes=t.createBuffer({size:Te(this.finestLevel+1)*16,usage:GPUBufferUsage.STORAGE}),this.bounds=t.createBuffer({size:16,usage:GPUBufferUsage.STORAGE});const c=t.createShaderModule({code:_e}),o=(s,l)=>t.createComputePipeline({layout:"auto",compute:{module:c,entryPoint:s,constants:l}}),r={FINEST:this.finestLevel,DIM:this.gridDim,FP_SCALE:a};this.pClear=o("clear_grid",{DIM:this.gridDim}),this.pBounds=o("reduce_bounds",{}),this.pScatter=o("scatter",{DIM:this.gridDim,FP_SCALE:a}),this.pResolve=o("resolve",r),this.pForce=o("force",r);for(let s=0;s<this.finestLevel;s++)this.pReduce.push(o("reduce",{LEVEL:s}));const h=(s,l)=>t.createBindGroup({layout:s.getBindGroupLayout(0),entries:l.map(([i,d])=>({binding:i,resource:{buffer:d}}))});this.gClear=h(this.pClear,[[4,this.grid],[6,this.bounds]]),this.gBounds=h(this.pBounds,[[0,this.simParams],[1,this.bodies],[6,this.bounds]]),this.gScatter=h(this.pScatter,[[0,this.simParams],[1,this.bodies],[3,this.mass],[4,this.grid],[6,this.bounds]]),this.gResolve=h(this.pResolve,[[4,this.grid],[5,this.nodes],[6,this.bounds]]);for(let s=0;s<this.finestLevel;s++)this.gReduce.push(h(this.pReduce[s],[[5,this.nodes]]));this.gForce=h(this.pForce,[[0,this.simParams],[1,this.bodies],[3,this.mass],[5,this.nodes],[6,this.bounds]])}writeParams(){const t=new ArrayBuffer(32),n=new DataView(t);n.setUint32(0,this.count,!0),n.setFloat32(4,this.dt,!0),n.setFloat32(8,$,!0),n.setFloat32(12,this.softening,!0),n.setFloat32(16,this.theta,!0),n.setFloat32(20,1,!0),n.setFloat32(24,10,!0),this.dev.queue.writeBuffer(this.simParams,0,t)}encode(t){const n=this.gridDim*this.gridDim,f=Math.ceil(this.count/Y);t.setPipeline(this.pClear),t.setBindGroup(0,this.gClear),t.dispatchWorkgroups(Math.ceil(n*4/Y)),t.setPipeline(this.pBounds),t.setBindGroup(0,this.gBounds),t.dispatchWorkgroups(f),t.setPipeline(this.pScatter),t.setBindGroup(0,this.gScatter),t.dispatchWorkgroups(f),t.setPipeline(this.pResolve),t.setBindGroup(0,this.gResolve),t.dispatchWorkgroups(Math.ceil(n/Y));for(let a=this.finestLevel-1;a>=0;a--)t.setPipeline(this.pReduce[a]),t.setBindGroup(0,this.gReduce[a]),t.dispatchWorkgroups(Math.max(1,Math.ceil((1<<2*a)/Y)));t.setPipeline(this.pForce),t.setBindGroup(0,this.gForce),t.dispatchWorkgroups(f)}dispose(){for(const t of[this.bodies,this.mass,this.simParams,this.grid,this.nodes,this.bounds])t.destroy()}}async function le(y,t={}){const n=await ce(),f=new U(y,t.hero?.56:.62);if(!n)return ue(y);const a=fe(f.canvas,n),c=new de(n,a);let o=t.count??2e4,r=t.steps??2,h=.75,s=new ae(n,C(o));c.bind(s.bodies);const l=()=>{s.dispose(),s=new ae(n,C(o)),c.bind(s.bodies)};return t.hero||(f.slider({label:"bodies",min:1e4,max:3e5,step:1e4,value:o,log:!0,format:i=>Math.round(i).toLocaleString(),onInput:i=>{o=Math.round(i),l()}}),f.slider({label:"steps / frame",min:1,max:16,step:1,value:r,onInput:i=>r=Math.round(i)}),f.slider({label:"θ",min:.3,max:1.5,step:.05,value:h,onInput:i=>h=i}),f.button("re-seed",l)),f.setInfo(()=>t.hero?`${o.toLocaleString()} bodies, live in your browser`:`${o.toLocaleString()} bodies × ${r} steps/frame · tree rebuilt every step, on the GPU`),{frame(){f.tick(),s.theta=h,s.writeParams();const i=n.createCommandEncoder(),d=i.beginComputePass();for(let u=0;u<r;u++)s.encode(d);d.end(),c.encode(i,o,{scale:.9,size:o>4e5?.0012:o>1e5?.002:.003}),n.queue.submit([i.finish()])},dispose(){s.dispose()}}}const K=.85,Q=5;function Ce(y,t){const n=(f,a,c,o,r)=>{let h=0,s=0;for(const d of r)h+=y[d],s+=t[d];const l=r.length,i={x:f,y:a,size:c,depth:o,comX:l?h/l:f+c/2,comY:l?s/l:a+c/2,count:l,children:null,points:r};if(l>1&&o<Q){const d=c/2,u=[[],[],[],[]];for(const e of r){const p=y[e]>=f+d?1:0,P=t[e]>=a+d?1:0;u[P*2+p].push(e)}i.children=[];for(let e=0;e<4;e++)u[e].length!==0&&i.children.push(n(f+e%2*d,a+Math.floor(e/2)*d,d,o+1,u[e]));i.points=[]}return i};return n(0,0,1,0,y.map((f,a)=>a))}function De(y){const t=xe(41),n=[],f=[],a=(e,p,P,b)=>{for(let k=0;k<b;k++){const S=t()*Math.PI*2,x=P*Math.sqrt(t());n.push(e+Math.cos(S)*x),f.push(p+Math.sin(S)*x*.85)}};a(.72,.42,.2,150),a(.55,.78,.12,70),a(.35,.25,.1,45);for(let e=0;e<55;e++)n.push(t()),f.push(t());const c=n.length,o=.12,r=.6,h=Ce(n,f),s=[],l=[],i=e=>{const p=Math.hypot(e.comX-o,e.comY-r);if(e.children===null){e.count>0&&(e.count===1?l.push(e.points[0]):e.size<K*p?s.push(e):l.push(...e.points));return}if(e.size<K*p){s.push(e);return}for(const P of e.children)i(P)};i(h),s.sort((e,p)=>{const P=Math.hypot(e.comX-o,e.comY-r);return Math.hypot(p.comX-o,p.comY-r)-P});const d=[],u=e=>{if(d.push(e),e.children)for(const p of e.children)u(p)};u(h),be(y,{screens:4,aspect:.62,steps:[{at:0,text:"One body, asking for its force. The honest answer: one line to every other body — 320 of them here, 300,000 in the hero demo."},{at:.2,text:"Build the quadtree: split any square holding more than one body, recursively. Every cell stores its total mass and centre of mass."},{at:.42,text:"The walk. Each cell takes one test: width < θ × distance? If yes, the whole cell collapses into a single point mass (orange dot, one arrow). Far cells pass easily; near cells split open."},{at:.78,text:"Result: a few dozen cluster terms plus a handful of exact near neighbours, summed into one acceleration — within a fraction of a percent of the exact answer."}],draw(e,p,P,b){const S=Math.min(p-28,P-28),x=(p-S)/2,B=(P-S)/2,g=v=>x+v*S,m=v=>B+v*S,w=R(b,.02,.16),M=R(b,.2,.3),I=R(b,.2,.42),_=R(b,.42,.78),L=R(b,.78,.97),G=v=>R(_,v/s.length*.85,v/s.length*.85+.15),W=new Float32Array(c);s.forEach((v,F)=>{const E=G(F);if(E<=0)return;const T=z=>{if(z.children)for(const D of z.children)T(D);else for(const D of z.points)W[D]=Math.max(W[D],E)};T(v)});const Z=w*(1-M);if(Z>.005){e.save(),e.globalAlpha=.3*Z,e.strokeStyle=A.accent,e.lineWidth=.6;for(let v=0;v<c;v+=2){const F=R(w,v/c*.6,v/c*.6+.4);F<=0||(e.beginPath(),e.moveTo(g(o),m(r)),e.lineTo(q(g(o),g(n[v]),F),q(m(r),m(f[v]),F)),e.stroke())}e.restore()}if(I>0){e.save();for(const v of d){const F=R(I,v.depth/(Q+1),(v.depth+1)/(Q+1));F<=0||(e.globalAlpha=.5*F*(1-.75*L),e.strokeStyle=A.grid,e.lineWidth=1,e.strokeRect(g(v.x),m(v.y),v.size*S,v.size*S))}e.restore()}for(let v=0;v<c;v++){const F=W[v];e.globalAlpha=q(.9,.18,F),e.fillStyle=A.dot,e.beginPath(),e.arc(g(n[v]),m(f[v]),1.7,0,Math.PI*2),e.fill()}e.globalAlpha=1;let X=0,N=0;if(s.forEach((v,F)=>{const E=G(F);if(E<=0)return;const T=g(v.comX),z=m(v.comY),D=Math.hypot(v.comX-o,v.comY-r),te=v.count/(D*D+.02);X+=(v.comX-o)/D*te,N+=(v.comY-r)/D*te,e.save(),e.globalAlpha=E*(1-.85*L),e.strokeStyle=A.warm,e.lineWidth=1.2,e.strokeRect(g(v.x),m(v.y),v.size*S,v.size*S),e.globalAlpha=E*(1-.5*L),e.fillStyle=A.warm,e.beginPath(),e.arc(T,z,2+2.5*Math.sqrt(v.count/40)*E,0,Math.PI*2),e.fill(),e.globalAlpha=.5*E*(1-L),ne(e,T,z,q(T,g(o),.92),q(z,m(r),.92),A.warm,1,5),e.restore()}),_>.6){const v=R(_,.6,1);e.save(),e.globalAlpha=.65*v*(1-.6*L),e.strokeStyle=A.accent,e.lineWidth=1;for(const F of l)e.beginPath(),e.moveTo(g(o),m(r)),e.lineTo(g(n[F]),m(f[F])),e.stroke();e.restore()}if(L>0){const v=Math.hypot(X,N)||1,F=X/v,E=N/v,T=S*.16*L;ne(e,g(o),m(r),g(o)+F*T,m(r)+E*T,"#ffffff",2.5,9)}e.fillStyle=A.accent,e.beginPath(),e.arc(g(o),m(r),5,0,Math.PI*2),e.fill(),e.strokeStyle="#fff",e.lineWidth=1,e.stroke();const ee=c-1;let V=ee;if(b>.42){let v=0;s.forEach((E,T)=>{G(T)>.5&&v++});const F=s.length-v;V=Math.round(q(ee,s.length+l.length,v/Math.max(1,s.length))),F===0&&(V=s.length+l.length)}oe(e,`force terms: ${V}`,p-16,22,{color:A.warm,size:13,align:"right",mono:!0}),b>.42&&oe(e,`θ = ${K}`,p-16,40,{color:A.muted,size:11,align:"right",mono:!0})}})}pe();const Re={hero:y=>le(y,{count:2e4,steps:2,hero:!0}),slingshot:we,"naive-cpu":ke,"naive-gpu":Ie,"barnes-hut":Fe,"pyramid-levels":Le,"pyramid-gpu":y=>le(y)};for(const y of document.querySelectorAll("[data-demo]")){const t=y.dataset.demo,n=Re[t];n&&ye(y,()=>n(y))}const Ge={"bh-walk":De};for(const y of document.querySelectorAll("[data-scrolly]"))Ge[y.dataset.scrolly]?.(y);
