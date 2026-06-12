import{i as W}from"./siteNav-B-J0B7W8.js";import{S as K,g as j,m as J}from"./demoShell-Btkj803W.js";import{g as Q,c as Z}from"./gpu-DBowy6aD.js";import{R as ee}from"./radianceCascades-siyOW2Rq.js";const ne=`// Part three: participating media. The world here is mostly inherited — the
// scene pass paints emission + occlusion exactly as the bonfire did. What's
// new is the media pass: it renders the fog itself into a second texture,
// a = extinction density, rgb = the fog's *glow* (density × last frame's
// fluence × the fog's albedo). The cascade march in rc.wgsl then attenuates
// every ray through the density and picks up the glow along the way.
//
// One shader, three worlds, switched by FP.mode:
//   0 — the dawn forest: trees, ground, a low sun, ground mist
//   1 — the lamp room: one warm lamp in a closed dark room of uniform fog
//   2 — the window room: sun outside, two slits in the wall, shafts inside

struct FogParams {
  viewScale: vec2f, // world [-1,1] → clip
  res: vec2f,       // scene texture px
  time: f32,
  mode: f32,
  fog: f32,         // fog amount knob (density multiplier)
  glow: f32,        // lamp brightness
  lamp: vec2f,      // cursor lamp, world (mode 1)
  bounce: f32,
  puffCount: f32,
  probes0: vec2f,   // cascade-0 probe grid, for fluence sampling
  mist: f32,        // mode 0: how high the ground mist sits
  _p0: f32,
}

struct Puff {
  pos: vec2f,
  radius: f32,
  strength: f32,
}

@group(0) @binding(0) var<uniform> FP: FogParams;
@group(0) @binding(2) var fluenceTex: texture_2d<f32>;
@group(0) @binding(3) var linSamp: sampler;
@group(0) @binding(4) var<storage, read> puffs: array<Puff>;

// ---- noise ------------------------------------------------------------------

fn hash21(p: vec2f) -> f32 {
  var q = fract(p * vec2f(123.34, 456.21));
  q += dot(q, q + 45.32);
  return fract(q.x * q.y);
}

fn vnoise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = hash21(i);
  let b = hash21(i + vec2f(1.0, 0.0));
  let c = hash21(i + vec2f(0.0, 1.0));
  let d = hash21(i + vec2f(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

fn fbm(p: vec2f) -> f32 {
  return vnoise(p) * 0.55 + vnoise(p * 2.13 + 7.7) * 0.3 + vnoise(p * 4.41 + 19.1) * 0.15;
}

// ---- world geometry ------------------------------------------------------------

fn groundY(x: f32) -> f32 {
  return -0.62 + 0.07 * sin(x * 1.9 + 1.2) + 0.035 * sin(x * 4.7 + 0.6);
}

fn sdCapsule(p: vec2f, a: vec2f, b: vec2f, r: f32) -> f32 {
  let pa = p - a;
  let ba = b - a;
  let h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - r;
}

// pines: a trunk and a heavy crown. The crowns matter more than the trunks —
// god rays need *wide* occluders with gaps between them, and a crown is the
// widest thing a forest owns.
fn treeDist(world: vec2f, baseX: f32, h: f32, seed: f32) -> f32 {
  let gy = groundY(baseX);
  let sway = 0.02 * sin(seed * 9.0);
  let top = vec2f(baseX + sway, gy + h);
  var d = sdCapsule(world, vec2f(baseX, gy - 0.05), top, 0.022 + 0.014 * h);
  // crown: a lumpy ellipse, big enough to cast a shadow the upper cascades
  // can't interpolate away
  let c = world - (top + vec2f(0.0, 0.08));
  let lump = 1.0 + 0.5 * (vnoise(world * 9.0 + seed * 13.0) - 0.5);
  d = min(d, length(c * vec2f(1.25, 1.7)) - 0.26 * h * lump);
  let m1 = mix(gy, gy + h, 0.6);
  d = min(d, sdCapsule(world, vec2f(baseX + sway * 0.5, m1), vec2f(baseX + 0.16 * h, m1 + 0.22 * h), 0.011));
  return d;
}

// ---- scene (emission + occlusion), same contract as parts one and two ---------------

struct SceneEval {
  emission: vec3f,
  albedo: vec3f,
  occ: f32,
}

fn evalScene(world: vec2f, aa: f32) -> SceneEval {
  var emission = vec3f(0.0);
  var albedo = vec3f(0.0);
  var occ = 0.0;
  let mode = u32(FP.mode);

  if (mode == 0u) {
    // ---- the dawn forest ------------------------------------------------------
    let gy = groundY(world.x);
    let gcov = smoothstep(aa, -aa, world.y - gy);
    if (gcov > 0.0) {
      occ = gcov;
      let depth = gy - world.y;
      albedo = mix(vec3f(0.13, 0.13, 0.10), vec3f(0.05, 0.05, 0.045), smoothstep(0.0, 0.25, depth)) * gcov;
    }
    let t1 = treeDist(world, -1.05, 0.9, 1.0);
    let t2 = treeDist(world, -0.42, 1.1, 2.0);
    let t3 = treeDist(world, 0.3, 0.85, 3.0);
    let t4 = treeDist(world, 0.95, 1.15, 4.0);
    let t5 = treeDist(world, 1.55, 0.9, 5.0);
    let td = min(min(min(t1, t2), min(t3, t4)), t5);
    let tcov = smoothstep(aa, -aa, td);
    if (tcov > 0.0) {
      occ = max(occ, tcov);
      albedo = mix(albedo, vec3f(0.05, 0.075, 0.04), tcov);
    }
  } else if (mode == 1u) {
    // ---- the lamp room ----------------------------------------------------------
    let b = 0.92;
    let wcov = smoothstep(-aa, aa, max(abs(world.x), abs(world.y)) - b);
    if (wcov > 0.0) {
      occ = max(occ, wcov);
      albedo = mix(albedo, vec3f(0.30, 0.30, 0.33), wcov);
    }
    // a pillar, so the fog has a shadow to make visible
    let pd = max(abs(world.x - 0.45) - 0.045, abs(world.y + 0.18) - 0.42);
    let pcov = smoothstep(aa, -aa, pd);
    if (pcov > 0.0) {
      occ = max(occ, pcov);
      albedo = mix(albedo, vec3f(0.22, 0.24, 0.3), pcov);
    }
    // the lamp follows the cursor. Kept deliberately fat: a near-point
    // source beads the low cascades' sparse directions into visible dots,
    // and a wide soft emitter is the honest fix.
    let ld = length(world - FP.lamp);
    let lampCov = smoothstep(aa, -aa, ld - 0.09);
    if (lampCov > 0.0) {
      occ = max(occ, lampCov);
      albedo = mix(albedo, vec3f(0.0), lampCov);
      emission = vec3f(1.0, 0.8, 0.55) * 4.5 * FP.glow * smoothstep(0.09, 0.025, ld);
    }
  } else {
    // ---- the window room ----------------------------------------------------------
    // floor, ceiling, right wall: plain plaster. The left wall is thicker
    // and pierced by two slits — the slits carve all the way through, so
    // the sky's sun can pour in.
    let b = 0.92;
    var wallCov = step(0.0, max(abs(world.x), abs(world.y)) - b);
    if (world.x < -b + 0.10) {
      let slit = abs(world.y - 0.44) < 0.115 || abs(world.y - 0.0) < 0.115;
      wallCov = select(1.0, 0.0, slit);
    }
    if (wallCov > 0.0) {
      occ = max(occ, wallCov);
      albedo = mix(albedo, vec3f(0.30, 0.29, 0.27), wallCov);
    }
    // a table under the shafts — something for the light to land on
    let td = max(abs(world.x - 0.18) - 0.34, abs(world.y + 0.62) - 0.05);
    let tcov = smoothstep(aa, -aa, td);
    if (tcov > 0.0) {
      occ = max(occ, tcov);
      albedo = mix(albedo, vec3f(0.32, 0.2, 0.1), tcov);
    }
  }

  return SceneEval(emission, albedo, occ);
}

// ---- fluence (last frame's light), for bounce and for the fog's glow -----------------

struct FullOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn vsFullF(@builtin(vertex_index) vi: u32) -> FullOut {
  var pts = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var out: FullOut;
  out.pos = vec4f(pts[vi], 0.0, 1.0);
  out.uv = pts[vi] * vec2f(0.5, -0.5) + 0.5;
  return out;
}

fn fluenceAt(uv: vec2f) -> vec3f {
  let texFull = vec2f(textureDimensions(fluenceTex));
  let local = clamp(uv, vec2f(0.5) / FP.probes0, 1.0 - vec2f(0.5) / FP.probes0);
  var sum = vec3f(0.0);
  for (var d = 0u; d < 4u; d++) {
    let cb = vec2f(f32(d % 2u), f32(d / 2u));
    let tuv = (cb + local) * FP.probes0 / texFull;
    sum += textureSampleLevel(fluenceTex, linSamp, tuv, 0.0).rgb;
  }
  return sum * 0.25;
}

@fragment
fn fsSceneF(in: FullOut) -> @location(0) vec4f {
  let clip = vec2f(in.uv.x * 2.0 - 1.0, 1.0 - in.uv.y * 2.0);
  let world = clip / FP.viewScale;
  let aa = 2.0 / (FP.viewScale.y * FP.res.y);
  let s = evalScene(world, aa);
  var emission = s.emission + s.albedo * 0.012;
  if (s.occ > 0.5 && FP.bounce > 0.0) {
    emission += s.albedo * fluenceAt(in.uv) * FP.bounce;
  }
  return vec4f(emission, s.occ);
}

// ---- media: the fog itself ------------------------------------------------------------
// Density is procedural mist plus cursor-blown smoke puffs; the glow channel
// multiplies that density by last frame's fluence. Fog that light reaches
// shines; fog in shadow stays dark — god rays are exactly this difference.

fn fogDensity(world: vec2f, uv: vec2f) -> f32 {
  let mode = u32(FP.mode);
  var dens = 0.0;

  if (mode == 0u) {
    // ground mist: dense at the floor, thinning with height, drifting east
    let gy = groundY(world.x);
    let h = world.y - gy;
    let band = exp(-max(h, 0.0) / max(FP.mist, 0.05));
    let drift = fbm(world * vec2f(1.4, 2.2) + vec2f(-FP.time * 0.05, FP.time * 0.012));
    dens = FP.fog * band * (0.35 + 0.85 * drift);
    // thin haze everywhere, so even the canopy gaps participate a little
    dens += FP.fog * 0.10 * fbm(world * 0.9 + vec2f(FP.time * 0.02, 0.0));
    if (world.y < gy) { dens = 0.0; }
  } else {
    // rooms: near-uniform fog with a slow large-scale stir
    let wobble = 0.85 + 0.3 * (fbm(world * 1.3 + vec2f(FP.time * 0.04, -FP.time * 0.03)) - 0.5);
    dens = FP.fog * wobble;
    if (max(abs(world.x), abs(world.y)) > 0.92) { dens = 0.0; }
  }

  // smoke puffs (cursor-blown)
  for (var i = 0u; i < u32(FP.puffCount); i++) {
    let p = puffs[i];
    let r = length(world - p.pos) / max(p.radius, 1e-3);
    dens += p.strength * exp(-r * r * 2.0);
  }
  return clamp(dens, 0.0, 2.5);
}

@fragment
fn fsMedia(in: FullOut) -> @location(0) vec4f {
  let clip = vec2f(in.uv.x * 2.0 - 1.0, 1.0 - in.uv.y * 2.0);
  let world = clip / FP.viewScale;
  let dens = fogDensity(world, in.uv);
  // the glow channel holds the local light field (last frame's fluence) with
  // a slightly warm tint — droplets scatter sunrise light amber-ish. The
  // march multiplies in the density's (1 − e^(−σρΔs)) itself, so density is
  // NOT folded in here. The wide 5-tap blur matters: near a bright source
  // the cascades' probe grid leaves faint rings, and glowing fog is a
  // magnifying glass for them — fog is allowed to be blurry.
  let res = vec2f(FP.res);
  let o1 = vec2f(9.0, 3.0) / res;
  let o2 = vec2f(-3.0, 9.0) / res;
  let tint = vec3f(1.0, 0.93, 0.82);
  let glow = (fluenceAt(in.uv) + fluenceAt(in.uv + o1) + fluenceAt(in.uv - o1) +
              fluenceAt(in.uv + o2) + fluenceAt(in.uv - o2)) * 0.2 * tint;
  return vec4f(glow, dens);
}
`,N=["final","scene (what the rays see)","occupancy","distance field","light only","fog density"];async function w(a,c){const o=await Q(),r=new K(a,c.mode==="hero"?.52:.62);if(!o)return j(a);const X=Z(r.canvas,o),i=c.mode==="halo"?1:c.mode==="shafts"?2:0,k=r.canvas.width,B=r.canvas.height,Y=k/B,D=i===0?1:.98,d=[D/Y,D],b=Math.floor(k/2.4),y=Math.floor(B/2.4),A=o.createTexture({size:[b,y],format:"rgba16float",usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING}),G=A.createView(),s=new ee(o,b,y,4,.45,G);let x=i===1?.4:i===2?.32:.7,P=i===2?.9:i===1?.55:.7,F=.8,u=.45,_=.6,m=0,h=0,O=performance.now();const v=o.createShaderModule({code:ne}),p=o.createBuffer({size:64,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),U=o.createSampler({magFilter:"linear",minFilter:"linear"}),S=48,C=o.createBuffer({size:S*16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),T=new Float32Array(S*4),E=o.createRenderPipeline({layout:"auto",vertex:{module:v,entryPoint:"vsFullF"},fragment:{module:v,entryPoint:"fsSceneF",targets:[{format:"rgba16float"}]},primitive:{topology:"triangle-list"}}),z=o.createRenderPipeline({layout:"auto",vertex:{module:v,entryPoint:"vsFullF"},fragment:{module:v,entryPoint:"fsMedia",targets:[{format:"rgba16float"}]},primitive:{topology:"triangle-list"}}),V=o.createBindGroup({layout:E.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:p}},{binding:2,resource:s.fluence.view},{binding:3,resource:U}]}),L=o.createBindGroup({layout:z.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:p}},{binding:2,resource:s.fluence.view},{binding:3,resource:U},{binding:4,resource:{buffer:C}}]}),f=[];let g=[-.2,.1],R=0,q=0;r.canvas.addEventListener("pointermove",e=>{const t=r.canvas.getBoundingClientRect(),n=((e.clientX-t.left)/t.width*2-1)/d[0],l=-((e.clientY-t.top)/t.height*2-1)/d[1],M=performance.now();if(R=M,i===1){g=[n,l];return}M-q>40&&f.length<S&&(q=M,f.push({x:n,y:l,r:.05,s:.9,vx:(Math.random()-.5)*.06,vy:.05+Math.random()*.05,age:0,life:3.5+Math.random()*1.5}))});const $=e=>{for(let t=f.length-1;t>=0;t--){const n=f[t];if(n.age+=e,n.age>n.life){f.splice(t,1);continue}n.x+=n.vx*e,n.y+=n.vy*e,n.r+=.045*e,n.s*=Math.exp(-.45*e)}T.fill(0);for(let t=0;t<f.length;t++){const n=f[t],l=Math.min(1,n.age*6)*Math.min(1,(n.life-n.age)*1.5);T.set([n.x,n.y,n.r,n.s*l],t*4)}o.queue.writeBuffer(C,0,T)};r.slider({label:"fog",min:0,max:1.5,step:.01,value:x,onInput:e=>x=e}),(c.mode==="halo"||c.mode==="forest")&&r.slider({label:"scatter",min:0,max:1.15,step:.01,value:P,onInput:e=>P=e}),c.mode==="shafts"&&r.slider({label:"sun height",min:.05,max:1,step:.01,value:u,format:e=>e<.25?"horizon":e<.6?"morning":"noon",onInput:e=>u=e}),c.mode==="forest"&&(r.slider({label:"mist depth",min:.1,max:1.2,step:.01,value:F,onInput:e=>F=e}),r.button("view: final",function(){m=(m+1)%N.length;const e=r.controls.querySelectorAll("button")[0];e.textContent=`view: ${N[m]}`})),c.mode==="hero"&&r.controls.remove(),r.setInfo(()=>i===1?`1 lamp · ${s.cascadeCount} cascades · carry it with your cursor`:i===2?`${s.cascadeCount} cascades · blow smoke into the shafts with your cursor`:`${s.cascadeCount} cascades · breathe smoke with your cursor`);const H=()=>{const e=new Float32Array(16);e.set([d[0],d[1],b,y]),e.set([h,i,x,1],4),e.set([g[0],g[1],_,f.length],8),e.set([s.fluence.probes[0],s.fluence.probes[1],F,0],12),o.queue.writeBuffer(p,0,e)},I=()=>{if(i===1){s.setSky({zenith:[0,0,0],horizon:[0,0,0],strength:0});return}if(i===2){const e=[-1,-.15-u*1.3],t=1-u*.7;s.setSky({zenith:[.05,.08,.16],horizon:[.22,.16,.1],sunDir:e,sunSharpness:150,sunIntensity:10,sunColor:[1,.95-t*.4,.85-t*.6],strength:1});return}s.setSky({zenith:[.05,.09,.18],horizon:[.4,.26,.12],sunDir:[-.6,-.85],sunSharpness:90,sunIntensity:8,sunColor:[1,.72,.38],strength:1})};return I(),{frame(){r.tick();const e=performance.now(),t=Math.min((e-O)/1e3,1/30);O=e,h+=t,i===1&&e-R>4e3&&(g=[.5*Math.sin(h*.16)-.15,.45*Math.sin(h*.11+1.3)]),$(t),H(),I(),s.setMedia({sigma:i===0?.013:.008,scatter:P});const n=o.createCommandEncoder();let l=n.beginRenderPass({colorAttachments:[{view:G,clearValue:{r:0,g:0,b:0,a:0},loadOp:"clear",storeOp:"store"}]});l.setPipeline(z),l.setBindGroup(0,L),l.draw(3),l.end(),l=n.beginRenderPass({colorAttachments:[{view:s.sceneView,clearValue:{r:0,g:0,b:0,a:0},loadOp:"clear",storeOp:"store"}]}),l.setPipeline(E),l.setBindGroup(0,V),l.draw(3),l.end(),s.encodeGI(n),s.encodeComposite(n,X.getCurrentTexture().createView(),{exposure:i===0?1.9:2.1,debugMode:m,emitBoost:.55}),o.queue.submit([n.finish()])},dispose(){s.dispose(),A.destroy(),p.destroy(),C.destroy()}}}W();const te={"hero-mist":a=>w(a,{mode:"hero"}),halo:a=>w(a,{mode:"halo"}),shafts:a=>w(a,{mode:"shafts"}),forest:a=>w(a,{mode:"forest"})};for(const a of document.querySelectorAll("[data-demo]")){const c=a.dataset.demo,o=te[c];o&&J(a,()=>o(a))}
