import{i as I}from"./siteNav-DaR1fllU.js";import{S as P,g as q,m as O}from"./demoShell-Btkj803W.js";import{g as L}from"./gpu-DBowy6aD.js";import{S as Y}from"./shaderCanvas-B9soO7i5.js";import{m as B,P as y,a as F,b as S,p as A,c as T}from"./scrolly-CfS_4Ccm.js";const E=["final","normals","step count"];function W(s){return`
const MODE: i32 = ${s};

fn rotY(p: vec3f, a: f32) -> vec3f {
  let c = cos(a); let s = sin(a);
  return vec3f(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}

fn sdSphere(p: vec3f, r: f32) -> f32 { return length(p) - r; }

fn sdTorus(p: vec3f, t: vec2f) -> f32 {
  let q = vec2f(length(p.xz) - t.x, p.y);
  return length(q) - t.y;
}

fn sdRoundBox(p: vec3f, b: vec3f, r: f32) -> f32 {
  let q = abs(p) - b;
  return length(max(q, vec3f(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}

// the polynomial smooth minimum — two surfaces that refuse to intersect
// sharply, the whole reason SDF sculpture looks like wax instead of CSG
fn smin(a: f32, b: f32, k: f32) -> f32 {
  let kk = max(k, 1e-4);
  let h = clamp(0.5 + 0.5 * (b - a) / kk, 0.0, 1.0);
  return mix(b, a, h) - kk * h * (1.0 - h);
}

// distance + material id, the whole world in one function
fn map(p: vec3f) -> vec2f {
  let t = uf(0u);
  var d = p.y;            // the ground: distance to the y=0 plane, exactly
  var m = 1.0;

  if (MODE == 1) {
    // ---- the blend lab: three shapes, one knob --------------------------------
    let k = uf(4u);
    let orbit = vec3f(0.9 * sin(t * 0.5), 0.55 + 0.25 * sin(t * 0.33), 0.45 * cos(t * 0.5));
    var s = sdSphere(p - vec3f(-0.7, 0.55, 0.0), 0.5);
    s = smin(s, sdRoundBox(p - vec3f(0.75, 0.45, 0.0), vec3f(0.42, 0.42, 0.42), 0.04), k);
    s = smin(s, sdSphere(p - orbit, 0.34), k);
    if (s < d) { d = s; m = 2.0; }
  } else {
    // ---- the sculpture: pedestal + blobs + torus ------------------------------
    let ped = sdRoundBox(p - vec3f(0.0, 0.3, 0.0), vec3f(0.42, 0.3, 0.42), 0.04);
    if (ped < d) { d = ped; m = 3.0; }
    let c = vec3f(0.0, 1.18, 0.0);
    let k = 0.17;
    var s = sdTorus(rotY(p - c, t * 0.2), vec2f(0.42, 0.1));
    s = smin(s, sdSphere(p - (c + vec3f(0.30 * sin(t * 0.43), 0.22 * sin(t * 0.31 + 2.0), 0.30 * cos(t * 0.43))), 0.26), k);
    s = smin(s, sdSphere(p - (c + vec3f(0.34 * sin(t * 0.27 + 4.0), 0.30 * cos(t * 0.36), 0.20 * sin(t * 0.5 + 1.0))), 0.21), k);
    s = smin(s, sdSphere(p - (c + vec3f(0.0, 0.40 * sin(t * 0.22), 0.0)), 0.23), k);
    if (s < d) { d = s; m = 2.0; }
  }
  return vec2f(d, m);
}

// gradient of the distance — the surface normal, by central differences
fn calcNormal(p: vec3f) -> vec3f {
  let e = 0.0012;
  return normalize(vec3f(
    map(p + vec3f(e, 0.0, 0.0)).x - map(p - vec3f(e, 0.0, 0.0)).x,
    map(p + vec3f(0.0, e, 0.0)).x - map(p - vec3f(0.0, e, 0.0)).x,
    map(p + vec3f(0.0, 0.0, e)).x - map(p - vec3f(0.0, 0.0, e)).x,
  ));
}

// sphere trace toward the light; the closest miss along the way sets the
// penumbra. k large = shadows snap hard, k small = everything is dusk.
fn softShadow(ro: vec3f, rd: vec3f, k: f32) -> f32 {
  var res = 1.0;
  var t = 0.04;
  for (var i = 0; i < 40; i++) {
    let h = map(ro + rd * t).x;
    if (h < 0.001) { return 0.0; }
    res = min(res, k * h / t);
    t += clamp(h, 0.015, 0.3);
    if (t > 6.0) { break; }
  }
  return clamp(res, 0.0, 1.0);
}

// five probes up the normal: how much free space hangs over this point
fn ambientOcc(p: vec3f, n: vec3f) -> f32 {
  var occ = 0.0;
  var sca = 1.0;
  for (var i = 1; i <= 5; i++) {
    let h = 0.03 + 0.12 * f32(i);
    occ += (h - map(p + n * h).x) * sca;
    sca *= 0.7;
  }
  return clamp(1.0 - 1.6 * occ, 0.0, 1.0);
}

fn skyBg(rd: vec3f) -> vec3f {
  let up = clamp(rd.y, 0.0, 1.0);
  var col = mix(vec3f(0.045, 0.05, 0.085), vec3f(0.012, 0.02, 0.05), up);
  let sunDir = normalize(vec3f(-0.55, 0.32, -0.4));
  col += vec3f(1.0, 0.7, 0.4) * pow(max(dot(rd, sunDir), 0.0), 64.0) * 0.45;
  return col;
}

fn heat(x: f32) -> vec3f {
  // black → violet → orange → near-white, the universal "cost" ramp
  let a = clamp(x, 0.0, 1.0);
  return vec3f(
    smoothstep(0.1, 0.7, a),
    smoothstep(0.4, 0.95, a) * 0.85,
    smoothstep(0.0, 0.35, a) * (1.0 - 0.7 * smoothstep(0.45, 0.9, a)),
  );
}

fn scene(uv: vec2f) -> vec3f {
  let aspect = uf(1u);
  let t = uf(0u);
  // camera: orbit around the plinth
  let autoRot = uf(14u);
  let yaw = uf(6u) + select(0.0, t * 0.12, autoRot > 0.5) + 0.6;
  let pitch = clamp(uf(7u) + 0.32, -0.1, 1.2);
  let radius = select(3.4, 3.1, MODE == 1);
  let tgt = select(vec3f(0.0, 0.95, 0.0), vec3f(0.0, 0.45, 0.0), MODE == 1);
  let ro = tgt + radius * vec3f(cos(pitch) * sin(yaw), sin(pitch), cos(pitch) * cos(yaw));
  let fwd = normalize(tgt - ro);
  let right = normalize(cross(fwd, vec3f(0.0, 1.0, 0.0)));
  let up = cross(right, fwd);
  let px = (uv - 0.5) * vec2f(2.0 * aspect, 2.0);
  let rd = normalize(fwd * 1.9 + right * px.x + up * px.y);

  // the march
  let budget = select(128.0, max(uf(4u), 4.0), MODE == 2);
  var tt = 0.0;
  var m = 0.0;
  var steps = 0.0;
  var hit = false;
  for (var i = 0; i < 128; i++) {
    if (f32(i) >= budget) { break; }
    steps = f32(i) + 1.0;
    let p = ro + rd * tt;
    let h = map(p);
    if (h.x < 0.0012 * (1.0 + tt)) { m = h.y; hit = true; break; }
    tt += h.x;
    if (tt > 14.0) { break; }
  }

  let view = u32(uf(13u));
  if (view == 2u || MODE == 2) {
    // cost view: how many spheres did this pixel inflate?
    var c = heat(steps / select(96.0, budget, MODE == 2));
    if (!hit) { c *= 0.55; }
    return c;
  }

  if (!hit) { return skyBg(rd); }

  let p = ro + rd * tt;
  let n = calcNormal(p);
  if (view == 1u) { return n * 0.5 + 0.5; }

  // materials
  var albedo = vec3f(0.23, 0.22, 0.21);             // ground: concrete
  if (m > 2.5) { albedo = vec3f(0.32, 0.26, 0.2); } // pedestal: warm stone
  else if (m > 1.5) { albedo = vec3f(0.65, 0.34, 0.18); } // sculpture: copper
  if (m < 1.5) {
    // checker, the traditional floor of every distance field demo
    let ch = f32((i32(floor(p.x * 1.4)) + i32(floor(p.z * 1.4))) & 1);
    albedo *= 0.8 + 0.4 * ch;
  }

  let lp = vec3f(uf(10u), uf(11u), uf(12u));
  let ld = normalize(lp - p);
  let dist2 = dot(lp - p, lp - p);
  let shK = uf(15u);
  let sh = softShadow(p + n * 0.012, ld, shK);
  let dif = max(dot(n, ld), 0.0) * sh * 9.0 / max(dist2, 0.4);
  let aoAmt = uf(5u);
  let ao = mix(1.0, ambientOcc(p, n), aoAmt);
  let skyAmb = mix(0.22, 0.36, clamp(n.y * 0.5 + 0.5, 0.0, 1.0)) * ao;
  let bounceAmb = vec3f(0.05, 0.04, 0.035) * clamp(-n.y * 0.5 + 0.5, 0.0, 1.0) * ao;

  var col = albedo * (dif * vec3f(1.0, 0.87, 0.7) + skyAmb * vec3f(0.45, 0.55, 0.8)) + bounceAmb;
  // a little specular so the copper reads as metal
  if (m > 1.5 && m < 2.5) {
    let h = normalize(ld - rd);
    col += vec3f(1.0, 0.8, 0.6) * pow(max(dot(n, h), 0.0), 36.0) * sh * 0.5;
  }

  // distance haze — the dishonest fog: no scattering, just a blend
  col = mix(col, skyBg(rd), 1.0 - exp(-0.0045 * tt * tt));

  col = col / (1.0 + col);
  return pow(col, vec3f(0.4545));
}
`}async function k(s,o){const w=await L(),r=new P(s,o.mode==="hero"?.52:.6);if(!w)return q(s);{const t=Math.min(s.clientWidth||720,900),f=1.35;r.canvas.width=Math.floor(t*f),r.canvas.height=Math.floor(t*(o.mode==="hero"?.52:.6)*f)}const g={hero:0,blend:1,steps:2,shade:3,full:4}[o.mode],u=new Y(w,r.canvas,W(g));let e=.22,c=48,v=1,h=14,l=0,i=0,d=0,m=!1,b=0,a=0,n=0;r.canvas.addEventListener("pointerdown",t=>{m=!0,b=t.clientX,a=t.clientY}),r.canvas.addEventListener("pointermove",t=>{m&&(i-=(t.clientX-b)*.008,d+=(t.clientY-a)*.005,d=Math.max(-.35,Math.min(.85,d)),b=t.clientX,a=t.clientY,n=performance.now())});const p=()=>{m=!1};r.canvas.addEventListener("pointerup",p),r.canvas.addEventListener("pointerleave",p),o.mode==="blend"&&r.slider({label:"blend k",min:.001,max:.55,step:.001,value:e,format:t=>t<.01?"hard min()":t.toFixed(2),onInput:t=>e=t}),o.mode==="steps"&&r.slider({label:"step budget",min:4,max:128,step:1,value:c,format:t=>String(Math.round(t)),onInput:t=>c=Math.round(t)}),(o.mode==="shade"||o.mode==="full")&&(r.slider({label:"shadow sharpness",min:2,max:64,step:.5,value:h,format:t=>t<5?"overcast":t>45?"knife edge":t.toFixed(0),onInput:t=>h=t}),r.slider({label:"ambient occlusion",min:0,max:1,step:.01,value:v,onInput:t=>v=t})),o.mode==="full"&&r.button("view: final",function(){l=(l+1)%E.length;const t=r.controls.querySelectorAll("button")[0];t.textContent=`view: ${E[l]}`}),r.setInfo(()=>o.mode==="steps"?`${c} steps max · drag to orbit`:o.mode==="full"?"drag to orbit · cursor carries the light":"drag to orbit");let x=performance.now();return{frame(){r.tick();const t=(performance.now()-x)/1e3,f=u.uniforms;f[4]=o.mode==="blend"?e:c,f[5]=o.mode==="shade"||o.mode==="full"?v:1,f[6]=i,f[7]=d;let M=[2.6*Math.sin(t*.21+2),2.6,2.6*Math.cos(t*.21+2)];if(o.mode==="full"&&u.pointer.inside&&!m){const z=(u.pointer.x-.5)*Math.PI*2.2,D=.5+u.pointer.y*3.2;M=[2.4*Math.sin(z),D,2.4*Math.cos(z)]}f[10]=M[0],f[11]=M[1],f[12]=M[2],f[13]=o.mode==="steps"?2:l,f[14]=performance.now()-n>3500?1:0,f[15]=o.mode==="shade"||o.mode==="full"?h:18,u.draw()}}}function N(s){const o=[{x:.78,y:.62,r:.16},{x:.86,y:.38,r:.12},{x:.62,y:.8,r:.1}],w=(e,c)=>{let v=1/0;for(const h of o)v=Math.min(v,Math.hypot(e-h.x,c-h.y)-h.r);return v},r=(e,c,v,h,l)=>{const i=[];let d=0;for(let m=0;m<l;m++){const b=e+v*d,a=c+h*d,n=w(b,a);if(i.push({x:b,y:a,r:n}),n<.004)break;d+=n}return i},g=r(.07,.42,Math.cos(-.12),Math.sin(-.12),10),u=r(.07,.28,Math.cos(.06),Math.sin(.06),26);B(s,{screens:4,aspect:.56,steps:[{at:0,text:"One ray, marching toward a scene it cannot see. All it may do is ask, at any point: <em>how far is the nearest surface?</em>"},{at:.18,text:"The answer is a radius of <em>certified empty space</em> — a circle that touches nothing. The ray can leap that far with no risk of skipping through a surface."},{at:.42,text:"From the new position, ask again. Far from everything, the circles are huge and the ray crosses the scene in a few leaps. This is the distance field doing for one ray what it did for thousands in part one."},{at:.62,text:"Close to a surface, the answers shrink, and the ray brakes to a halt exactly at the boundary — within ten steps here."},{at:.78,text:"The failure mode: a ray that <em>grazes</em> a surface. Every answer is tiny — certified space is honest but unhelpful — and the ray creeps for dozens of steps. Step-count heatmaps glow brightest along silhouettes for exactly this reason."}],draw(e,c,v,h){const l=a=>a*c,i=a=>a*v;for(const a of o)e.beginPath(),e.arc(l(a.x),i(a.y),a.r*c,0,Math.PI*2),e.fillStyle="#1d2233",e.fill(),e.strokeStyle=y.dim,e.lineWidth=1.5,e.stroke();const d=A(h,.05,.6),m=Math.min(g.length,Math.floor(d*(g.length+1)));for(let a=0;a<m;a++){const n=g[a],p=T(d*(g.length+1)-a);if(e.beginPath(),e.arc(l(n.x),i(n.y),Math.max(n.r*c,1.2),0,Math.PI*2),e.strokeStyle=y.accent,e.globalAlpha=.55*p,e.lineWidth=1.2,e.stroke(),e.globalAlpha=p,e.fillStyle=y.warm,e.beginPath(),e.arc(l(n.x),i(n.y),3,0,Math.PI*2),e.fill(),e.globalAlpha=1,a>0){const x=g[a-1];e.globalAlpha=p,F(e,l(x.x),i(x.y),l(n.x),i(n.y),y.warm,1.6,6),e.globalAlpha=1}}d>0&&m>0&&S(e,"the ray",l(g[0].x)-4,i(g[0].y)-14,{color:y.warm,size:12});const b=A(h,.72,.98);if(b>0){const a=Math.min(u.length,Math.floor(b*(u.length+2)));for(let n=0;n<a;n++){const p=u[n];e.beginPath(),e.arc(l(p.x),i(p.y),Math.max(p.r*c,1),0,Math.PI*2),e.strokeStyle=y.red,e.globalAlpha=.4,e.lineWidth=1,e.stroke(),e.globalAlpha=1,e.fillStyle=y.red,e.beginPath(),e.arc(l(p.x),i(p.y),2.2,0,Math.PI*2),e.fill()}a>3&&S(e,`${a} steps and still going…`,l(u[a-1].x)-30,i(u[a-1].y)-16,{color:y.red,size:12,align:"right"})}m>1&&S(e,`${Math.min(m,g.length)} steps`,l(.06),i(.92),{color:y.muted,size:12,mono:!0})}})}I();const R={"hero-sculpt":s=>k(s,{mode:"hero"}),blend:s=>k(s,{mode:"blend"}),steps:s=>k(s,{mode:"steps"}),shade:s=>k(s,{mode:"shade"}),full:s=>k(s,{mode:"full"})};for(const s of document.querySelectorAll("[data-demo]")){const o=s.dataset.demo,w=R[o];w&&O(s,()=>w(s))}for(const s of document.querySelectorAll("[data-scrolly]"))s.dataset.scrolly==="sphere-march"&&N(s);
