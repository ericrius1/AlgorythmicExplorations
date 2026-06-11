const k=`// Radiance cascades, 2D, vanilla recipe:
//
//   scene (emission rgb, occlusion a)
//     → seed + jump-flood → distance field          (where is the nearest surface?)
//     → cascades, top down                          (march short ray intervals, merge)
//     → composite                                   (average cascade 0 = light at every pixel)
//
// Cascade n: probes every 2·2ⁿ scene pixels, 4ⁿ⁺¹ directions per probe, each
// ray covering the interval [L·(4ⁿ−1)/3, L·(4ⁿ⁺¹−1)/3). Doubling probe
// spacing while quadrupling directions keeps every cascade the same number
// of texels — the trade at the heart of the technique: far light needs
// angular detail, not spatial detail.
//
// Layout is direction-first: cascade n's texture is a 2ⁿ⁺¹ × 2ⁿ⁺¹ grid of
// blocks, one per direction, each block holding the whole probe grid — so a
// single hardware bilinear tap inside a block interpolates the 4 nearest
// probes of one direction for free.

struct FullOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn vsFull(@builtin(vertex_index) vi: u32) -> FullOut {
  var pts = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var out: FullOut;
  out.pos = vec4f(pts[vi], 0.0, 1.0);
  out.uv = pts[vi] * vec2f(0.5, -0.5) + 0.5;
  return out;
}

// ---- seed: occupied pixels point at themselves --------------------------------

@group(0) @binding(1) var sceneTex: texture_2d<f32>;

@fragment
fn fsSeed(in: FullOut) -> @location(0) vec2f {
  let p = vec2i(in.pos.xy);
  let occ = textureLoad(sceneTex, p, 0).a;
  if (occ > 0.5) { return in.pos.xy; }
  return vec2f(-1e4, -1e4);
}

// ---- jump flood: every pixel learns its nearest seed ---------------------------

struct JfaParams { offset: f32, _p0: f32, _p1: f32, _p2: f32 }
@group(0) @binding(6) var<uniform> JU: JfaParams;
@group(0) @binding(5) var jfaTex: texture_2d<f32>;

@fragment
fn fsJfa(in: FullOut) -> @location(0) vec2f {
  let dims = vec2i(textureDimensions(jfaTex));
  let p = vec2i(in.pos.xy);
  var best = vec2f(-1e4, -1e4);
  var bestD = 1e12;
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      let q = clamp(p + vec2i(dx, dy) * i32(JU.offset), vec2i(0), dims - 1);
      let cand = textureLoad(jfaTex, q, 0).xy;
      if (cand.x < -9000.0) { continue; }
      let dd = dot(cand - in.pos.xy, cand - in.pos.xy);
      if (dd < bestD) { bestD = dd; best = cand; }
    }
  }
  return best;
}

@fragment
fn fsDist(in: FullOut) -> @location(0) f32 {
  let seed = textureLoad(jfaTex, vec2i(in.pos.xy), 0).xy;
  if (seed.x < -9000.0) { return 1e4; }
  return length(seed - in.pos.xy);
}

// ---- cascades ------------------------------------------------------------------

struct CascadeParams {
  probes: vec2f,        // probe grid this cascade
  upperProbes: vec2f,
  blocks: f32,          // directions per texture axis (2^(n+1))
  upperBlocks: f32,
  intervalStart: f32,   // scene pixels
  intervalLen: f32,
  isTop: f32,
  ambient: f32,
  _p0: f32,
  _p1: f32,
}

// The environment: what the top cascade merges with instead of darkness.
// strength (sunColor.w) = 0 keeps the old behaviour — a black void with a
// flat ambient term — so existing scenes don't change.
struct SkyParams {
  zenith: vec4f,   // rgb overhead
  horizon: vec4f,  // rgb at the horizon
  sun: vec4f,      // xy direction (scene px space, y down) · z sharpness · w intensity
  sunColor: vec4f, // rgb · w = overall sky strength
}

@group(0) @binding(0) var<uniform> CU: CascadeParams;
@group(0) @binding(2) var distTex: texture_2d<f32>;
@group(0) @binding(3) var upperTex: texture_2d<f32>;
@group(0) @binding(4) var linSamp: sampler;
@group(0) @binding(10) var<uniform> SU: SkyParams;

fn skyRadiance(dir: vec2f) -> vec3f {
  let strength = SU.sunColor.w;
  if (strength <= 0.0) { return vec3f(CU.ambient); }
  let up = -dir.y; // texture y runs down; up is where the sky lives
  let base = mix(SU.horizon.rgb, SU.zenith.rgb, smoothstep(-0.05, 0.8, up));
  let aboveGround = smoothstep(-0.5, -0.05, up); // fade to dark underfoot
  var col = base * aboveGround;
  let s = max(dot(dir, normalize(SU.sun.xy)), 0.0);
  col += SU.sunColor.rgb * pow(s, max(SU.sun.z, 1.0)) * SU.sun.w;
  return col * strength;
}

@fragment
fn fsCascade(in: FullOut) -> @location(0) vec4f {
  let texel = vec2u(in.pos.xy);
  let probesU = vec2u(CU.probes);
  let probe = texel % probesU;          // which probe (within a direction block)
  let block = texel / probesU;          // which direction block
  let blocks = u32(CU.blocks);
  let dirIdx = block.y * blocks + block.x;
  let dirCount = f32(blocks * blocks);

  let sceneRes = vec2f(textureDimensions(distTex));
  let spacing = sceneRes / CU.probes;
  let origin = (vec2f(probe) + 0.5) * spacing;

  let ang = 6.28318530718 * (f32(dirIdx) + 0.5) / dirCount;
  let dir = vec2f(cos(ang), sin(ang));

  // sphere-march the interval against the distance field
  var t = CU.intervalStart;
  var radiance = vec3f(0.0);
  var hit = false;
  let tEnd = CU.intervalStart + CU.intervalLen;
  for (var s = 0; s < 28; s++) {
    let pos = origin + dir * t;
    if (pos.x < 0.0 || pos.y < 0.0 || pos.x >= sceneRes.x || pos.y >= sceneRes.y) {
      break; // off the canvas: a miss — let the cascade above (or the sky) answer
    }
    let uv = pos / sceneRes;
    let d = textureSampleLevel(distTex, linSamp, uv, 0.0).r;
    if (d < 1.0) {
      radiance = textureSampleLevel(sceneTex, linSamp, uv, 0.0).rgb;
      hit = true;
      break;
    }
    t += max(d, 1.0);
    if (t >= tEnd) { break; }
  }

  // miss → this interval saw nothing; defer to the cascade above
  if (!hit) {
    if (CU.isTop > 0.5) {
      radiance = skyRadiance(dir);
    } else {
      let texFull = vec2f(textureDimensions(upperTex));
      let probeUV = (vec2f(probe) + 0.5) / CU.probes;
      let local = clamp(probeUV, vec2f(0.5) / CU.upperProbes, 1.0 - vec2f(0.5) / CU.upperProbes);
      let ublocks = u32(CU.upperBlocks);
      var sum = vec3f(0.0);
      for (var k = 0u; k < 4u; k++) {
        let child = dirIdx * 4u + k;
        let cb = vec2f(f32(child % ublocks), f32(child / ublocks));
        let uv = (cb + local) * CU.upperProbes / texFull;
        sum += textureSampleLevel(upperTex, linSamp, uv, 0.0).rgb;
      }
      radiance = sum * 0.25;
    }
  }
  return vec4f(radiance, 1.0);
}

// ---- composite -------------------------------------------------------------------

struct CompositeParams {
  probes0: vec2f,
  exposure: f32,
  debugMode: f32, // 0 final · 1 scene · 2 occupancy · 3 distance · 4 light only
  emitBoost: f32,
  _p0: f32,
  _p1: f32,
  _p2: f32,
}

@group(0) @binding(7) var<uniform> CP: CompositeParams;
@group(0) @binding(8) var cascade0Tex: texture_2d<f32>;

fn hashRC(p: vec2f) -> f32 {
  var q = fract(p * vec2f(123.34, 456.21));
  q += dot(q, q + 45.32);
  return fract(q.x * q.y);
}

@fragment
fn fsComposite(in: FullOut) -> @location(0) vec4f {
  let texFull = vec2f(textureDimensions(cascade0Tex));
  let local = clamp(in.uv, vec2f(0.5) / CP.probes0, 1.0 - vec2f(0.5) / CP.probes0);
  var fluence = vec3f(0.0);
  for (var d = 0u; d < 4u; d++) {
    let cb = vec2f(f32(d % 2u), f32(d / 2u));
    let uv = (cb + local) * CP.probes0 / texFull;
    fluence += textureSampleLevel(cascade0Tex, linSamp, uv, 0.0).rgb;
  }
  fluence *= 0.25;

  let scene = textureSampleLevel(sceneTex, linSamp, in.uv, 0.0);

  let mode = u32(CP.debugMode);
  if (mode == 1u) { return vec4f(pow(scene.rgb, vec3f(0.4545)), 1.0); }
  if (mode == 2u) { return vec4f(vec3f(scene.a), 1.0); }
  if (mode == 3u) {
    let d = textureSampleLevel(distTex, linSamp, in.uv, 0.0).r;
    return vec4f(vec3f(fract(d / 32.0)) * vec3f(0.6, 0.75, 1.0), 1.0);
  }

  var col = fluence;
  if (mode == 0u) { col = fluence + scene.rgb * CP.emitBoost; }
  col *= CP.exposure;
  col = col / (1.0 + col);                 // gentle reinhard
  col = pow(col, vec3f(0.4545));           // to gamma
  // ±half an 8-bit step of dither breaks banding in slow gradients
  col += (hashRC(in.pos.xy) - 0.5) / 255.0;
  return vec4f(col, 1.0);
}

// ---- temporal accumulation ---------------------------------------------------------
// Exponential moving average over cascade 0. The GI's noise — embers winking
// in and out of rays, the one-frame bounce feedback — is zero-mean frame to
// frame, so a short history integrates it away almost free.

struct TemporalParams { alpha: f32, _p0: f32, _p1: f32, _p2: f32 }
@group(0) @binding(11) var histTex: texture_2d<f32>;
@group(0) @binding(12) var<uniform> TU: TemporalParams;

@fragment
fn fsTemporal(in: FullOut) -> @location(0) vec4f {
  let p = vec2i(in.pos.xy);
  let cur = textureLoad(cascade0Tex, p, 0);
  let hist = textureLoad(histTex, p, 0);
  return mix(hist, cur, TU.alpha);
}

// ---- brush (paint demo): stamp emission / walls / eraser into the scene -----------

struct BrushParams {
  center: vec2f, // scene pixels
  res: vec2f,
  radius: f32,
  hardness: f32,
  _p0: f32,
  _p1: f32,
  color: vec4f,  // rgb emission, a occlusion
}

@group(0) @binding(9) var<uniform> BU: BrushParams;

struct BrushOut {
  @builtin(position) pos: vec4f,
  @location(0) local: vec2f,
}

@vertex
fn vsBrush(@builtin(vertex_index) vi: u32) -> BrushOut {
  var corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
  );
  let c = corners[vi];
  let px = BU.center + c * BU.radius;
  var out: BrushOut;
  out.pos = vec4f(px / BU.res * 2.0 - 1.0, 0.0, 1.0);
  out.pos.y = -out.pos.y; // pixel y runs down, clip y runs up
  out.local = c;
  return out;
}

@fragment
fn fsBrush(in: BrushOut) -> @location(0) vec4f {
  let q = length(in.local);
  if (q > 1.0) { discard; }
  let a = 1.0 - smoothstep(BU.hardness, 1.0, q);
  return vec4f(BU.color.rgb * a, BU.color.a * a);
}
`;class O{width;height;cascadeCount;sceneTex;sceneView;dev;jfa;dist;casc;probes0;seedPipe;jfaPipe;distPipe;cascadePipe;compositePipe;paintPipe;erasePipe;seedGroup;jfaGroups=[];jfaOffsets=[];distGroup;cascGroups=[];compositeGroup;compositeBuf;skyBuf;casc0View;brushBufs=[];brushGroups=[];brushCursor=0;texFull;histTex=null;histView=null;tempTex=null;temporalPipe=null;temporalGroup=null;temporalBuf=null;constructor(e,n,r,t=4,o=0){this.dev=e,this.width=n,this.height=r;const i=s=>e.createTexture({size:[n,r],format:s,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});this.sceneTex=i("rgba16float"),this.sceneView=this.sceneTex.createView(),this.jfa=[i("rg16float"),i("rg16float")],this.dist=i("r16float"),this.probes0=[Math.max(4,Math.floor(n/2)),Math.max(4,Math.floor(r/2))];const c=[this.probes0[0]*2,this.probes0[1]*2];this.casc=[e.createTexture({size:c,format:"rgba16float",usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING}),e.createTexture({size:c,format:"rgba16float",usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING})],this.texFull=c;const y=Math.hypot(n,r);let p=Math.ceil(Math.log(3*y/t+1)/Math.log(4));for(;p>1&&(this.probes0[0]>>p-1<2||this.probes0[1]>>p-1<2);)p--;this.cascadeCount=Math.max(p,2);const b=e.createShaderModule({code:k}),u=(s,a,d)=>e.createRenderPipeline({layout:"auto",vertex:{module:b,entryPoint:s.startsWith("fsBrush")?"vsBrush":"vsFull"},fragment:{module:b,entryPoint:s.startsWith("fsBrush")?"fsBrush":s,targets:[{format:a,blend:d}]},primitive:{topology:"triangle-list"}});this.seedPipe=u("fsSeed","rg16float"),this.jfaPipe=u("fsJfa","rg16float"),this.distPipe=u("fsDist","r16float"),this.cascadePipe=u("fsCascade","rgba16float"),this.compositePipe=u("fsComposite",navigator.gpu.getPreferredCanvasFormat());const U={color:{srcFactor:"one",dstFactor:"one-minus-src-alpha",operation:"add"},alpha:{srcFactor:"one",dstFactor:"one-minus-src-alpha",operation:"add"}},T={color:{srcFactor:"zero",dstFactor:"one-minus-src-alpha",operation:"add"},alpha:{srcFactor:"zero",dstFactor:"one-minus-src-alpha",operation:"add"}};this.paintPipe=u("fsBrush","rgba16float",U),this.erasePipe=u("fsBrush-erase","rgba16float",T);const m=e.createSampler({magFilter:"linear",minFilter:"linear"});this.seedGroup=e.createBindGroup({layout:this.seedPipe.getBindGroupLayout(0),entries:[{binding:1,resource:this.sceneView}]});let l=1;for(;l*2<Math.max(n,r);)l*=2;for(let s=0;l>=1;l=Math.floor(l/2),s++){const a=e.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});if(e.queue.writeBuffer(a,0,new Float32Array([l,0,0,0])),this.jfaOffsets.push(l),this.jfaGroups.push(e.createBindGroup({layout:this.jfaPipe.getBindGroupLayout(0),entries:[{binding:5,resource:this.jfa[s%2].createView()},{binding:6,resource:{buffer:a}}]})),l===1)break}const w=this.jfa[this.jfaGroups.length%2];this.distGroup=e.createBindGroup({layout:this.distPipe.getBindGroupLayout(0),entries:[{binding:5,resource:w.createView()}]}),this.skyBuf=e.createBuffer({size:64,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});const x=this.dist.createView(),f=[this.casc[0].createView(),this.casc[1].createView()];this.casc0View=f[0];for(let s=0;s<this.cascadeCount;s++){const a=[Math.max(this.probes0[0]>>s,1),Math.max(this.probes0[1]>>s,1)],d=[Math.max(this.probes0[0]>>s+1,1),Math.max(this.probes0[1]>>s+1,1)],h=2<<s,G=t*(Math.pow(4,s)-1)/3,C=t*Math.pow(4,s),v=g=>{const B=e.createBuffer({size:48,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});return e.queue.writeBuffer(B,0,new Float32Array([a[0],a[1],d[0],d[1],h,h*2,G,C,g,0,0,0])),B},P=g=>e.createBindGroup({layout:this.cascadePipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:g}},{binding:1,resource:this.sceneView},{binding:2,resource:x},{binding:3,resource:f[(s+1)%2]},{binding:4,resource:m},{binding:10,resource:{buffer:this.skyBuf}}]});this.cascGroups.push({main:P(v(0)),top:P(v(1)),region:[a[0]*h,a[1]*h]})}o>0&&(this.histTex=e.createTexture({size:c,format:"rgba16float",usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST}),this.histView=this.histTex.createView(),this.tempTex=e.createTexture({size:c,format:"rgba16float",usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC}),this.temporalPipe=u("fsTemporal","rgba16float"),this.temporalBuf=e.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),e.queue.writeBuffer(this.temporalBuf,0,new Float32Array([o,0,0,0])),this.temporalGroup=e.createBindGroup({layout:this.temporalPipe.getBindGroupLayout(0),entries:[{binding:8,resource:f[0]},{binding:11,resource:this.histView},{binding:12,resource:{buffer:this.temporalBuf}}]})),this.compositeBuf=e.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.compositeGroup=e.createBindGroup({layout:this.compositePipe.getBindGroupLayout(0),entries:[{binding:1,resource:this.sceneView},{binding:2,resource:x},{binding:4,resource:m},{binding:7,resource:{buffer:this.compositeBuf}},{binding:8,resource:this.histView??f[0]}]});for(let s=0;s<64;s++){const a=e.createBuffer({size:48,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});this.brushBufs.push(a),this.brushGroups.push(e.createBindGroup({layout:this.paintPipe.getBindGroupLayout(0),entries:[{binding:9,resource:{buffer:a}}]}))}}setSky(e){const n=e.sunDir??[.3,-1],r=e.sunColor??[1,.85,.6];this.dev.queue.writeBuffer(this.skyBuf,0,new Float32Array([...e.zenith,0,...e.horizon,0,n[0],n[1],e.sunSharpness??24,e.sunIntensity??0,...r,e.strength??1]))}get fluence(){return{view:this.histView??this.casc0View,probes:[this.probes0[0],this.probes0[1]]}}clearScene(e){e.beginRenderPass({colorAttachments:[{view:this.sceneView,clearValue:{r:0,g:0,b:0,a:0},loadOp:"clear",storeOp:"store"}]}).end()}brush(e,n){const r=this.brushCursor++%64,t=new Float32Array(12);t.set([n.x,n.y,this.width,this.height,n.radius,n.hardness??.25,0,0]),t.set([n.color[0],n.color[1],n.color[2],n.occlusion],8),this.dev.queue.writeBuffer(this.brushBufs[r],0,t);const o=e.beginRenderPass({colorAttachments:[{view:this.sceneView,loadOp:"load",storeOp:"store"}]});o.setPipeline(n.erase?this.erasePipe:this.paintPipe),o.setBindGroup(0,this.brushGroups[r]),o.draw(6),o.end()}encodeGI(e,n){const r=i=>e.beginRenderPass({colorAttachments:[{view:i,loadOp:"clear",storeOp:"store"}]});let t=r(this.jfa[0].createView());t.setPipeline(this.seedPipe),t.setBindGroup(0,this.seedGroup),t.draw(3),t.end();for(let i=0;i<this.jfaGroups.length;i++)t=r(this.jfa[(i+1)%2].createView()),t.setPipeline(this.jfaPipe),t.setBindGroup(0,this.jfaGroups[i]),t.draw(3),t.end();t=r(this.dist.createView()),t.setPipeline(this.distPipe),t.setBindGroup(0,this.distGroup),t.draw(3),t.end();const o=Math.min(Math.max(n??this.cascadeCount,1),this.cascadeCount);for(let i=o-1;i>=0;i--){const c=this.cascGroups[i];t=r(this.casc[i%2].createView()),t.setViewport(0,0,c.region[0],c.region[1],0,1),t.setPipeline(this.cascadePipe),t.setBindGroup(0,i===o-1?c.top:c.main),t.draw(3),t.end()}this.temporalPipe&&this.tempTex&&this.histTex&&(t=r(this.tempTex.createView()),t.setPipeline(this.temporalPipe),t.setBindGroup(0,this.temporalGroup),t.draw(3),t.end(),e.copyTextureToTexture({texture:this.tempTex},{texture:this.histTex},this.texFull))}encodeComposite(e,n,r={}){this.dev.queue.writeBuffer(this.compositeBuf,0,new Float32Array([this.probes0[0],this.probes0[1],r.exposure??1.6,r.debugMode??0,r.emitBoost??.55,0,0,0]));const t=e.beginRenderPass({colorAttachments:[{view:n,clearValue:{r:0,g:0,b:0,a:1},loadOp:"clear",storeOp:"store"}]});t.setPipeline(this.compositePipe),t.setBindGroup(0,this.compositeGroup),t.draw(3),t.end()}dispose(){this.sceneTex.destroy(),this.dist.destroy();for(const e of this.jfa)e.destroy();for(const e of this.casc)e.destroy();for(const e of this.brushBufs)e.destroy();this.compositeBuf.destroy(),this.skyBuf.destroy(),this.histTex?.destroy(),this.tempTex?.destroy(),this.temporalBuf?.destroy()}}export{O as R};
