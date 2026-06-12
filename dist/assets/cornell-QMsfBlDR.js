import{g as W,S as $,a as H,c as V,i as X,m as Y}from"./gpu-BLPsBJnk.js";import{m as J,P as u,l as L,c as G,p as I}from"./scrolly-CD69uhsv.js";const K=`// Part five: a progressive path tracer, aimed at the Cornell box.
// fsTrace adds \`spp\` fresh Monte Carlo samples per pixel per frame on top of
// the running sum in prevTex (rgba32float: rgb = radiance sum, a = sample
// count); fsDisplay divides, tonemaps, and shows the estimate so far.
//
// The scene is analytic and tiny: five walls, a ceiling light you can move
// and resize, one diffuse sphere, and one sphere whose material is a knob
// (diffuse / mirror / glossy). Everything else is the estimator.

struct TraceParams {
  res: vec2f,        // accumulation buffer px
  frame: f32,        // frame index since last reset (0 = discard prevTex)
  spp: f32,          // samples added per frame
  lightPos: vec2f,   // light center, xz on the ceiling
  lightSize: vec2f,  // light half-extents, xz
  maxBounces: f32,
  nee: f32,          // 1: sample the light directly at every diffuse bounce
  matB: f32,         // sphere B: 0 diffuse · 1 mirror · 2 glossy
  rough: f32,        // glossy cone width
  exposure: f32,
  lightBoost: f32,
  _p0: f32,
  _p1: f32,
}

@group(0) @binding(0) var<uniform> TP: TraceParams;
@group(0) @binding(1) var prevTex: texture_2d<f32>;
@group(0) @binding(2) var accumTex: texture_2d<f32>;

struct FullOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn vsFullC(@builtin(vertex_index) vi: u32) -> FullOut {
  var pts = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var out: FullOut;
  out.pos = vec4f(pts[vi], 0.0, 1.0);
  out.uv = pts[vi] * vec2f(0.5, -0.5) + 0.5;
  return out;
}

// ---- rng: one u32 of state per pixel-sample, PCG-style ----------------------------

var<private> rngState: u32;

fn rnd() -> f32 {
  rngState = rngState * 747796405u + 2891336453u;
  var w = ((rngState >> ((rngState >> 28u) + 4u)) ^ rngState) * 277803737u;
  w = (w >> 22u) ^ w;
  return f32(w) / 4294967296.0;
}

// ---- scene ------------------------------------------------------------------------
// the box: x ∈ [−1,1], y ∈ [0,2], z ∈ [−1,1]; camera looks down −z.

const EMIT_SCALE: f32 = 1.0;

struct Hit {
  t: f32,
  n: vec3f,
  albedo: vec3f,
  mat: i32, // 0 diffuse · 1 mirror · 2 glossy · 3 light
}

fn hitSphere(ro: vec3f, rd: vec3f, c: vec3f, r: f32) -> f32 {
  let oc = ro - c;
  let b = dot(oc, rd);
  let det = b * b - (dot(oc, oc) - r * r);
  if (det < 0.0) { return -1.0; }
  let s = sqrt(det);
  let t1 = -b - s;
  if (t1 > 1e-3) { return t1; }
  let t2 = -b + s;
  if (t2 > 1e-3) { return t2; }
  return -1.0;
}

fn intersect(ro: vec3f, rd: vec3f) -> Hit {
  var h: Hit;
  h.t = 1e9;
  h.mat = -1;

  // axis planes; each checked against the box cross-section
  // floor y=0
  if (rd.y < -1e-6) {
    let t = (0.0 - ro.y) / rd.y;
    if (t > 1e-3 && t < h.t) {
      let p = ro + rd * t;
      if (abs(p.x) < 1.0 && abs(p.z) < 1.0) {
        h.t = t; h.n = vec3f(0.0, 1.0, 0.0); h.albedo = vec3f(0.73); h.mat = 0;
      }
    }
  }
  // ceiling y=2 (and the light cut into it)
  if (rd.y > 1e-6) {
    let t = (2.0 - ro.y) / rd.y;
    if (t > 1e-3 && t < h.t) {
      let p = ro + rd * t;
      if (abs(p.x) < 1.0 && abs(p.z) < 1.0) {
        h.t = t; h.n = vec3f(0.0, -1.0, 0.0); h.albedo = vec3f(0.73); h.mat = 0;
        if (abs(p.x - TP.lightPos.x) < TP.lightSize.x && abs(p.z - TP.lightPos.y) < TP.lightSize.y) {
          h.mat = 3;
        }
      }
    }
  }
  // back wall z=−1
  if (rd.z < -1e-6) {
    let t = (-1.0 - ro.z) / rd.z;
    if (t > 1e-3 && t < h.t) {
      let p = ro + rd * t;
      if (abs(p.x) < 1.0 && p.y > 0.0 && p.y < 2.0) {
        h.t = t; h.n = vec3f(0.0, 0.0, 1.0); h.albedo = vec3f(0.73); h.mat = 0;
      }
    }
  }
  // left wall x=−1: the famous red
  if (rd.x < -1e-6) {
    let t = (-1.0 - ro.x) / rd.x;
    if (t > 1e-3 && t < h.t) {
      let p = ro + rd * t;
      if (p.y > 0.0 && p.y < 2.0 && abs(p.z) < 1.0) {
        h.t = t; h.n = vec3f(1.0, 0.0, 0.0); h.albedo = vec3f(0.65, 0.06, 0.06); h.mat = 0;
      }
    }
  }
  // right wall x=1: the famous green
  if (rd.x > 1e-6) {
    let t = (1.0 - ro.x) / rd.x;
    if (t > 1e-3 && t < h.t) {
      let p = ro + rd * t;
      if (p.y > 0.0 && p.y < 2.0 && abs(p.z) < 1.0) {
        h.t = t; h.n = vec3f(-1.0, 0.0, 0.0); h.albedo = vec3f(0.12, 0.45, 0.15); h.mat = 0;
      }
    }
  }

  // sphere A: matte, rear left
  let tA = hitSphere(ro, rd, vec3f(-0.45, 0.5, -0.35), 0.5);
  if (tA > 0.0 && tA < h.t) {
    h.t = tA;
    h.n = normalize(ro + rd * tA - vec3f(-0.45, 0.5, -0.35));
    h.albedo = vec3f(0.73);
    h.mat = 0;
  }
  // sphere B: the material knob, front right
  let tB = hitSphere(ro, rd, vec3f(0.5, 0.35, 0.35), 0.35);
  if (tB > 0.0 && tB < h.t) {
    h.t = tB;
    h.n = normalize(ro + rd * tB - vec3f(0.5, 0.35, 0.35));
    h.albedo = vec3f(0.85, 0.65, 0.35);
    h.mat = i32(TP.matB);
    if (h.mat == 0) { h.albedo = vec3f(0.73); }
  }
  return h;
}

fn lightLe() -> vec3f {
  // radiance, not power: shrink the panel and it stays the same brightness
  // per unit area, the room just gets darker
  return vec3f(1.0, 0.82, 0.6) * 22.0 * TP.lightBoost;
}

// cosine-weighted hemisphere around n — importance sampling the Lambert lobe
fn cosineDir(n: vec3f) -> vec3f {
  let r1 = rnd() * 6.28318530718;
  let r2 = rnd();
  let sr2 = sqrt(r2);
  var u = normalize(cross(n, select(vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), abs(n.y) > 0.9)));
  let v = cross(n, u);
  return normalize(u * cos(r1) * sr2 + v * sin(r1) * sr2 + n * sqrt(1.0 - r2));
}

fn tracePath(ro0: vec3f, rd0: vec3f) -> vec3f {
  var ro = ro0;
  var rd = rd0;
  var throughput = vec3f(1.0);
  var radiance = vec3f(0.0);
  var specularLast = true; // the camera counts as specular: a direct view of the light must show it

  let bounces = i32(TP.maxBounces);
  for (var b = 0; b < 12; b++) {
    if (b >= bounces) { break; }
    let h = intersect(ro, rd);
    if (h.mat < 0) { break; } // out the open front: black studio

    let p = ro + rd * h.t;

    if (h.mat == 3) {
      // hitting the panel: count it only if no NEE already paid this path,
      // or the previous bounce was specular (NEE can't see through mirrors)
      if (TP.nee < 0.5 || specularLast) {
        radiance += throughput * lightLe();
      }
      break;
    }

    if (h.mat == 1 || h.mat == 2) {
      // mirror / glossy: reflect, optionally jitter inside a cone
      var r = reflect(rd, h.n);
      if (h.mat == 2) {
        let j = vec3f(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5) * 2.0;
        r = normalize(r + j * TP.rough);
        if (dot(r, h.n) < 0.0) { r = reflect(r, h.n); }
      }
      throughput *= h.albedo;
      ro = p + h.n * 1e-3;
      rd = r;
      specularLast = true;
      continue;
    }

    // diffuse. Next-event estimation: ask the lamp directly.
    if (TP.nee > 0.5) {
      let lp = vec3f(
        TP.lightPos.x + (rnd() * 2.0 - 1.0) * TP.lightSize.x,
        2.0 - 1e-4,
        TP.lightPos.y + (rnd() * 2.0 - 1.0) * TP.lightSize.y,
      );
      let toL = lp - p;
      let d2 = dot(toL, toL);
      let ld = normalize(toL);
      let cosS = dot(h.n, ld);
      let cosL = ld.y; // cos at the panel: dot((0,−1,0), −ld) — it faces down
      if (cosS > 0.0 && cosL > 0.0) {
        let sh = intersect(p + h.n * 1e-3, ld);
        // unoccluded iff the first thing in that direction is the panel
        if (sh.mat == 3) {
          let area = 4.0 * TP.lightSize.x * TP.lightSize.y;
          radiance += throughput * h.albedo * lightLe() * (cosS * cosL * area / (3.14159265 * d2));
        }
      }
    }

    throughput *= h.albedo;
    ro = p + h.n * 1e-3;
    rd = cosineDir(h.n);
    specularLast = false;

    // russian roulette after a few bounces keeps deep paths cheap
    if (b > 3) {
      let q = max(throughput.x, max(throughput.y, throughput.z));
      if (rnd() > q) { break; }
      throughput /= max(q, 1e-3);
    }
  }
  return radiance;
}

@fragment
fn fsTrace(in: FullOut) -> @location(0) vec4f {
  let pix = vec2u(in.pos.xy);
  rngState = pix.x * 1973u + pix.y * 9277u + u32(TP.frame) * 26699u + 1u;
  // scramble a little — low frame indices correlate otherwise
  rngState = rngState ^ (rngState >> 16u);

  var prev = vec4f(0.0);
  if (TP.frame > 0.5) {
    prev = textureLoad(prevTex, vec2i(pix), 0);
  }

  let aspect = TP.res.x / TP.res.y;
  var sum = vec3f(0.0);
  let n = i32(TP.spp);
  for (var s = 0; s < 8; s++) {
    if (s >= n) { break; }
    // jittered pinhole camera at the open face of the box
    let jitter = vec2f(rnd(), rnd());
    let uv = (in.pos.xy + jitter - 0.5) / TP.res;
    let px = (uv.x * 2.0 - 1.0) * aspect;
    let py = 1.0 - uv.y * 2.0;
    let ro = vec3f(0.0, 1.0, 3.6);
    let rd = normalize(vec3f(px * 0.78, py * 0.78, -2.0));
    sum += tracePath(ro, rd);
  }

  return vec4f(prev.rgb + sum, prev.a + f32(n));
}

// ---- display -------------------------------------------------------------------

fn hashC(p: vec2f) -> f32 {
  var q = fract(p * vec2f(123.34, 456.21));
  q += dot(q, q + 45.32);
  return fract(q.x * q.y);
}

@fragment
fn fsDisplay(in: FullOut) -> @location(0) vec4f {
  let dims = vec2f(textureDimensions(accumTex));
  let pix = vec2i(in.uv * dims);
  let acc = textureLoad(accumTex, clamp(pix, vec2i(0), vec2i(dims) - 1), 0);
  var col = acc.rgb / max(acc.a, 1.0);
  col *= TP.exposure;
  col = col / (1.0 + col);
  col = pow(col, vec3f(0.4545));
  col += (hashC(in.pos.xy) - 0.5) / 255.0;
  return vec4f(col, 1.0);
}
`,N=["matte","mirror","glossy"];async function M(a,s){const l=await W(),o=new $(a,s.mode==="hero"?.56:.62);if(!l)return H(a);const F=V(o.canvas,l),k=o.canvas.width,P=o.canvas.height,e=Math.floor(k/2),z=Math.floor(P/2);let y=0,m=0,r=s.mode==="noise"?1:2,t=!1,x=s.mode!=="nee",g=s.mode==="bounces"?2:6,v=s.mode==="full"?1:0,w=.18,b=[0,0],d=s.mode==="nee"?.16:.3,c=1;const i=()=>{y=0,m=0},h=l.createShaderModule({code:K}),p=l.createBuffer({size:64,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),S=[0,1].map(()=>l.createTexture({size:[e,z],format:"rgba32float",usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING})),T=S.map(n=>n.createView()),B=l.createRenderPipeline({layout:"auto",vertex:{module:h,entryPoint:"vsFullC"},fragment:{module:h,entryPoint:"fsTrace",targets:[{format:"rgba32float"}]},primitive:{topology:"triangle-list"}}),O=l.createRenderPipeline({layout:"auto",vertex:{module:h,entryPoint:"vsFullC"},fragment:{module:h,entryPoint:"fsDisplay",targets:[{format:navigator.gpu.getPreferredCanvasFormat()}]},primitive:{topology:"triangle-list"}}),U=[0,1].map(n=>l.createBindGroup({layout:B.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:p}},{binding:1,resource:T[n]}]})),_=[0,1].map(n=>l.createBindGroup({layout:O.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:p}},{binding:2,resource:T[n]}]}));let E=!1;const D=n=>{const f=o.canvas.getBoundingClientRect(),A=(n.clientX-f.left)/f.width*2-1,R=(n.clientY-f.top)/f.height*2-1;b=[Math.max(-.95+d,Math.min(.95-d,A*1.2)),Math.max(-.8,Math.min(.95,R*1.4))],i()};if(s.mode==="full"){o.canvas.addEventListener("pointerdown",f=>{E=!0,D(f)}),o.canvas.addEventListener("pointermove",f=>{E&&D(f)});const n=()=>{E=!1};o.canvas.addEventListener("pointerup",n),o.canvas.addEventListener("pointerleave",n)}s.mode==="noise"&&(o.slider({label:"samples per frame",min:1,max:8,step:1,value:r,format:n=>String(Math.round(n)),onInput:n=>r=Math.round(n)}),o.button("pause accumulation",function(){t=!t;const n=o.controls.querySelectorAll("button")[0];n.textContent=t?"resume accumulation":"pause accumulation"}),o.button("restart",i)),s.mode==="nee"&&(o.button("light sampling: off",function(){x=!x;const n=o.controls.querySelectorAll("button")[0];n.textContent=x?"light sampling: on":"light sampling: off",i()}),o.button("restart",i)),s.mode==="bounces"&&o.slider({label:"max bounces",min:1,max:8,step:1,value:g,format:n=>n<1.5?"1 (direct only)":String(Math.round(n)),onInput:n=>{g=Math.round(n),i()}}),s.mode==="full"&&(o.button(`sphere: ${N[v]}`,function(){v=(v+1)%3;const n=o.controls.querySelectorAll("button")[0];n.textContent=`sphere: ${N[v]}`,i()}),o.slider({label:"roughness",min:0,max:.6,step:.01,value:w,onInput:n=>{w=n,i()}}),o.slider({label:"light size",min:.05,max:.7,step:.01,value:d,onInput:n=>{d=n,i()}})),o.setInfo(()=>{const n=m.toLocaleString();return s.mode==="full"?`${n} spp · drag to move the light`:s.mode==="noise"&&t?`${n} spp · frozen — this is what one moment of dice looks like`:`${n} samples per pixel so far`});const j=()=>{const n=new Float32Array(16);n.set([e,z,y,r]),n.set([b[0],b[1],d,d],4),n.set([g,x?1:0,v,w],8),n.set([1.35,c,0,0],12),l.queue.writeBuffer(p,0,n)};return{frame(){o.tick();const n=l.createCommandEncoder(),f=y%2,A=1-f;if(j(),!t){const C=n.beginRenderPass({colorAttachments:[{view:T[A],loadOp:"clear",storeOp:"store"}]});C.setPipeline(B),C.setBindGroup(0,U[f]),C.draw(3),C.end()}const R=t?f:A,q=n.beginRenderPass({colorAttachments:[{view:F.getCurrentTexture().createView(),clearValue:{r:0,g:0,b:0,a:1},loadOp:"clear",storeOp:"store"}]});q.setPipeline(O),q.setBindGroup(0,_[R]),q.draw(3),q.end(),l.queue.submit([n.finish()]),t||(y++,m+=r)},dispose(){for(const n of S)n.destroy();p.destroy()}}}function Q(a){const k=[{x:.02,y:.42},{x:.62,y:.88},{x:.22,y:.52},{x:.56,y:.62},{x:.66,y:.14}],P=[1,.73,.47,.34];J(a,{screens:4,aspect:.56,steps:[{at:0,text:'The rendering equation, in one sentence: light leaving a point = light it <em>emits</em> + light <em>arriving</em> from every direction, dimmed by the surface color. The "every direction" makes it an integral — and the integrand contains the equation itself, recursively.'},{at:.2,text:"Monte Carlo's bargain: don't integrate over every direction. Follow <em>one</em> random direction, honestly weighted — here, a camera ray hits the floor and rolls dice for its next direction."},{at:.45,text:"Each bounce multiplies the path's <em>throughput</em> by the surface's color — the path dims as it goes, which is why deep bounces matter less and why the series converges."},{at:.7,text:"This path got lucky: it found the lamp. Its whole journey lights up that first floor pixel — tinted by everything it touched on the way. Most paths find only darkness; they contribute zero."},{at:.88,text:"One path is a terrible estimate. But its <em>expected value</em> is the exact integral — so average a few hundred lucky and unlucky paths per pixel and the truth emerges out of static. That is the whole algorithm."}],draw(e,z,y,m){const r=c=>c*z,t=c=>c*y;e.lineWidth=3,e.strokeStyle=u.dim,e.beginPath(),e.moveTo(r(.22),t(.14)),e.lineTo(r(.95),t(.14)),e.stroke(),e.beginPath(),e.moveTo(r(.22),t(.88)),e.lineTo(r(.95),t(.88)),e.stroke(),e.strokeStyle=u.red,e.beginPath(),e.moveTo(r(.22),t(.14)),e.lineTo(r(.22),t(.88)),e.stroke(),e.strokeStyle=u.good,e.beginPath(),e.moveTo(r(.95),t(.14)),e.lineTo(r(.95),t(.88)),e.stroke(),e.strokeStyle=u.warm,e.lineWidth=5,e.beginPath(),e.moveTo(r(.58),t(.14)),e.lineTo(r(.74),t(.14)),e.stroke(),L(e,"lamp",r(.66),t(.14)-12,{color:u.warm,align:"center"}),e.beginPath(),e.arc(r(.56),t(.68),.085*y,0,Math.PI*2),e.fillStyle="#1d2233",e.fill(),e.strokeStyle=u.dim,e.lineWidth=1.5,e.stroke(),L(e,"📷",r(.015),t(.4),{size:18});const x=I(m,.12,.78),g=k.length-1,v=x*g;for(let c=0;c<g;c++){const i=G(v-c);if(i<=0)break;const h=k[c],p=k[c+1],S=h.x+(p.x-h.x)*i,T=h.y+(p.y-h.y)*i,B=P[Math.min(c,P.length-1)];e.strokeStyle=u.warm,e.globalAlpha=.25+.75*B,e.lineWidth=1.2+2.6*B,e.beginPath(),e.moveTo(r(h.x),t(h.y)),e.lineTo(r(S),t(T)),e.stroke(),e.globalAlpha=1,i>=1&&c<g-1&&(e.fillStyle=u.accent,e.beginPath(),e.arc(r(p.x),t(p.y),3.5,0,Math.PI*2),e.fill())}const w=Math.floor(Math.min(v,g));if(w>=1){const c=P[Math.min(w-1,P.length-1)];L(e,`throughput ≈ ${c.toFixed(2)}`,r(.04),t(.94),{color:u.muted,mono:!0})}const b=I(m,.72,.8);b>0&&(e.globalAlpha=b,e.fillStyle=u.warm,e.beginPath(),e.arc(r(.66),t(.14),7+5*Math.sin(m*40),0,Math.PI*2),e.fill(),e.globalAlpha=1,L(e,"found it — pay the pixel",r(.66),t(.14)+22,{color:u.warm,align:"center",alpha:b}));const d=I(m,.86,1);if(d>0){for(let i=0;i<60;i++){const h=.3+i/60*.5,p=G(d*2.2-i/60),S=(Math.sin(i*91.7)*.5+Math.sin(i*47.3+2)*.5)*(1-p),T=.55+.45*Math.sin(i/60*Math.PI)+S*.8;e.fillStyle=`rgba(255, 184, 107, ${G(T)*.85*d})`,e.fillRect(r(h),t(.3),z*.5/60+1,14)}L(e,"1 path = static · many paths = light",r(.55),t(.3)-12,{color:u.muted,align:"center",alpha:d})}}})}X();const Z={"hero-box":a=>M(a,{mode:"hero"}),noise:a=>M(a,{mode:"noise"}),nee:a=>M(a,{mode:"nee"}),bounces:a=>M(a,{mode:"bounces"}),full:a=>M(a,{mode:"full"})};for(const a of document.querySelectorAll("[data-demo]")){const s=a.dataset.demo,l=Z[s];l&&Y(a,()=>l(a))}for(const a of document.querySelectorAll("[data-scrolly]"))a.dataset.scrolly==="photon-walk"&&Q(a);
