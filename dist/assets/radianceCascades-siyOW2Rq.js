const O=`// Radiance cascades, 2D, vanilla recipe:
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
// blocks, one per direction, each block holding the whole probe grid. The
// composite still gets the 4 nearest cascade-0 probes from one hardware
// bilinear tap per block; the cascade merge itself uses the "bilinear fix"
// (see fsCascade) and point-loads the four corner probes instead.

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

// Participating media (part three). The caller renders fog into mediaTex:
// a = extinction density, rgb = the fog's glow — density × last frame's
// fluence × the fog's albedo, so the in-scattered light rides the same
// one-frame time loop as the bounce. enabled = 0 binds a 1×1 dummy and the
// march reduces to the vanilla recipe.
struct MediaParams {
  sigma: f32,   // extinction per scene px at density 1 (how fast light dies)
  scatter: f32, // single-scattering albedo: the fraction of extinguished
                // light re-emitted as glow. ≤ 1 conserves energy; above 1
                // the fog becomes a gain medium and the time loop diverges.
  enabled: f32,
  _p0: f32,
}
@group(0) @binding(13) var mediaTex: texture_2d<f32>;
@group(0) @binding(14) var<uniform> MU: MediaParams;

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

// One ray interval, sphere-marched against the distance field. With media
// on, each leap also integrates fog along the segment: extinction multiplies
// \`trans\` down (Beer–Lambert), and the fog's own glow — last frame's light
// scattered toward this ray — accumulates into \`inscat\`.
struct RayResult {
  radiance: vec3f,
  inscat: vec3f,
  trans: f32,
  hit: bool,
}

fn marchInterval(start: vec2f, dir: vec2f, maxLen: f32, sceneRes: vec2f) -> RayResult {
  var r: RayResult;
  r.radiance = vec3f(0.0);
  r.inscat = vec3f(0.0);
  r.trans = 1.0;
  r.hit = false;
  var t = 0.0;
  // fog varies smoothly, so cap the leap: ~12 samples across the interval
  let fogStep = max(maxLen / 12.0, 3.0);
  for (var s = 0; s < 32; s++) {
    let pos = start + dir * t;
    if (pos.x < 0.0 || pos.y < 0.0 || pos.x >= sceneRes.x || pos.y >= sceneRes.y) {
      break; // off the canvas: a miss — let the cascade above (or the sky) answer
    }
    let uv = pos / sceneRes;
    let d = textureSampleLevel(distTex, linSamp, uv, 0.0).r;
    if (d < 1.0) {
      r.radiance = textureSampleLevel(sceneTex, linSamp, uv, 0.0).rgb;
      r.hit = true;
      break;
    }
    var step = max(d, 1.0);
    if (MU.enabled > 0.5) {
      step = min(step, fogStep);
      let segLen = min(step, maxLen - t);
      let m = textureSampleLevel(mediaTex, linSamp, uv, 0.0);
      let sigT = m.a * MU.sigma;
      let segT = exp(-sigT * segLen);
      // the segment swallows (1 − segT) of the beam; the same fraction of
      // the local light field (m.rgb, scaled by the albedo) is re-emitted
      // toward us. Source-term integral ∫ σ·J·e^(−σs) ds = J·(1 − e^(−σL)).
      r.inscat += r.trans * m.rgb * MU.scatter * (1.0 - segT);
      r.trans *= segT;
      if (r.trans < 0.004) { r.hit = true; r.radiance = vec3f(0.0); break; } // optically thick
    }
    t += step;
    if (t >= maxLen) { break; }
  }
  return r;
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
  let start = origin + dir * CU.intervalStart;

  // top cascade: nothing above to merge with — one ray, sky on a miss
  if (CU.isTop > 0.5) {
    let r = marchInterval(start, dir, CU.intervalLen, sceneRes);
    var radiance = r.radiance;
    if (!r.hit) { radiance = skyRadiance(dir); }
    return vec4f(r.inscat + r.trans * radiance, 1.0);
  }

  // Bilinear fix (radiance-cascades.com / Osborne & Hanika). Vanilla merging
  // interpolates the four upper probes' pre-merged results, but those probes
  // see a nearby emitter from different angles than this probe does — that
  // parallax draws concentric rings around small bright sources. Instead,
  // trace one interval per upper corner probe, each ray bridging exactly
  // from this probe's interval start to where that corner's own rays begin,
  // merge each with that corner alone, and only then blend the four merged
  // results with the bilinear weights. 4× the rays, no rings — and occlusion
  // along the actual bridge path kills light leaks through thin walls too.
  let upSpacing = sceneRes / CU.upperProbes;
  let g = origin / upSpacing - 0.5;     // position in the upper probe grid
  let baseIdx = floor(g);
  let fw = g - baseIdx;                 // bilinear fractions
  let t1 = CU.intervalStart + CU.intervalLen; // = upper cascade's interval start
  let ublocks = u32(CU.upperBlocks);
  var merged = vec3f(0.0);
  for (var k = 0u; k < 4u; k++) {
    let corner = vec2f(f32(k & 1u), f32(k >> 1u));
    let w = mix(1.0 - fw.x, fw.x, corner.x) * mix(1.0 - fw.y, fw.y, corner.y);
    let cornerIdx = clamp(vec2i(baseIdx + corner), vec2i(0), vec2i(CU.upperProbes) - 1);
    let upPos = (vec2f(cornerIdx) + 0.5) * upSpacing;
    let bridge = upPos + dir * t1 - start;
    let len = max(length(bridge), 1e-4);
    let r = marchInterval(start, bridge / len, len, sceneRes);
    var radiance = r.radiance;
    if (!r.hit) {
      // merge with this corner probe alone: point-load its 4 child directions
      var sum = vec3f(0.0);
      for (var c = 0u; c < 4u; c++) {
        let child = dirIdx * 4u + c;
        let cb = vec2i(i32(child % ublocks), i32(child / ublocks));
        sum += textureLoad(upperTex, cb * vec2i(CU.upperProbes) + cornerIdx, 0).rgb;
      }
      radiance = sum * 0.25;
    }
    // whatever the far end answered arrives attenuated by this interval's fog
    merged += w * (r.inscat + r.trans * radiance);
  }
  return vec4f(merged, 1.0);
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
  if (mode == 5u) {
    let dens = textureSampleLevel(mediaTex, linSamp, in.uv, 0.0).a;
    return vec4f(pow(vec3f(dens), vec3f(0.4545)) * vec3f(0.75, 0.8, 0.95), 1.0);
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
`;class M{width;height;cascadeCount;sceneTex;sceneView;dev;jfa;dist;casc;probes0;seedPipe;jfaPipe;distPipe;cascadePipe;compositePipe;paintPipe;erasePipe;seedGroup;jfaGroups=[];jfaOffsets=[];distGroup;cascGroups=[];compositeGroup;compositeBuf;skyBuf;casc0View;brushBufs=[];brushGroups=[];brushCursor=0;texFull;histTex=null;histView=null;tempTex=null;temporalPipe=null;temporalGroup=null;temporalBuf=null;mediaBuf;mediaEnabled;constructor(e,n,s,t=4,o=0,a){this.dev=e,this.width=n,this.height=s;const c=r=>e.createTexture({size:[n,s],format:r,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING});this.sceneTex=c("rgba16float"),this.sceneView=this.sceneTex.createView(),this.jfa=[c("rg16float"),c("rg16float")],this.dist=c("r16float"),this.probes0=[Math.max(4,Math.floor(n/2)),Math.max(4,Math.floor(s/2))];const f=[this.probes0[0]*2,this.probes0[1]*2];this.casc=[e.createTexture({size:f,format:"rgba16float",usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING}),e.createTexture({size:f,format:"rgba16float",usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING})],this.texFull=f;const B=Math.hypot(n,s);let p=Math.ceil(Math.log(3*B/t+1)/Math.log(4));for(;p>1&&(this.probes0[0]>>p-1<2||this.probes0[1]>>p-1<2);)p--;this.cascadeCount=Math.max(p,2);const b=e.createShaderModule({code:O}),u=(r,i,h)=>e.createRenderPipeline({layout:"auto",vertex:{module:b,entryPoint:r.startsWith("fsBrush")?"vsBrush":"vsFull"},fragment:{module:b,entryPoint:r.startsWith("fsBrush")?"fsBrush":r,targets:[{format:i,blend:h}]},primitive:{topology:"triangle-list"}});this.seedPipe=u("fsSeed","rg16float"),this.jfaPipe=u("fsJfa","rg16float"),this.distPipe=u("fsDist","r16float"),this.cascadePipe=u("fsCascade","rgba16float"),this.compositePipe=u("fsComposite",navigator.gpu.getPreferredCanvasFormat());const U={color:{srcFactor:"one",dstFactor:"one-minus-src-alpha",operation:"add"},alpha:{srcFactor:"one",dstFactor:"one-minus-src-alpha",operation:"add"}},G={color:{srcFactor:"zero",dstFactor:"one-minus-src-alpha",operation:"add"},alpha:{srcFactor:"zero",dstFactor:"one-minus-src-alpha",operation:"add"}};this.paintPipe=u("fsBrush","rgba16float",U),this.erasePipe=u("fsBrush-erase","rgba16float",G);const v=e.createSampler({magFilter:"linear",minFilter:"linear"});this.seedGroup=e.createBindGroup({layout:this.seedPipe.getBindGroupLayout(0),entries:[{binding:1,resource:this.sceneView}]});let l=1;for(;l*2<Math.max(n,s);)l*=2;for(let r=0;l>=1;l=Math.floor(l/2),r++){const i=e.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});if(e.queue.writeBuffer(i,0,new Float32Array([l,0,0,0])),this.jfaOffsets.push(l),this.jfaGroups.push(e.createBindGroup({layout:this.jfaPipe.getBindGroupLayout(0),entries:[{binding:5,resource:this.jfa[r%2].createView()},{binding:6,resource:{buffer:i}}]})),l===1)break}const C=this.jfa[this.jfaGroups.length%2];this.distGroup=e.createBindGroup({layout:this.distPipe.getBindGroupLayout(0),entries:[{binding:5,resource:C.createView()}]}),this.skyBuf=e.createBuffer({size:64,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});const x=this.dist.createView(),d=[this.casc[0].createView(),this.casc[1].createView()];this.casc0View=d[0],o>0&&(this.histTex=e.createTexture({size:f,format:"rgba16float",usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST}),this.histView=this.histTex.createView(),this.tempTex=e.createTexture({size:f,format:"rgba16float",usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC}),this.temporalPipe=u("fsTemporal","rgba16float"),this.temporalBuf=e.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),e.queue.writeBuffer(this.temporalBuf,0,new Float32Array([o,0,0,0])),this.temporalGroup=e.createBindGroup({layout:this.temporalPipe.getBindGroupLayout(0),entries:[{binding:8,resource:d[0]},{binding:11,resource:this.histView},{binding:12,resource:{buffer:this.temporalBuf}}]})),this.mediaEnabled=!!a;const k=e.createTexture({size:[1,1],format:"rgba16float",usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.RENDER_ATTACHMENT}),y=a??k.createView();this.mediaBuf=e.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});for(let r=0;r<this.cascadeCount;r++){const i=[Math.max(this.probes0[0]>>r,1),Math.max(this.probes0[1]>>r,1)],h=[Math.max(this.probes0[0]>>r+1,1),Math.max(this.probes0[1]>>r+1,1)],g=2<<r,S=t*(Math.pow(4,r)-1)/3,R=t*Math.pow(4,r),w=m=>{const T=e.createBuffer({size:48,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});return e.queue.writeBuffer(T,0,new Float32Array([i[0],i[1],h[0],h[1],g,g*2,S,R,m,0,0,0])),T},P=m=>e.createBindGroup({layout:this.cascadePipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:m}},{binding:1,resource:this.sceneView},{binding:2,resource:x},{binding:3,resource:d[(r+1)%2]},{binding:4,resource:v},{binding:10,resource:{buffer:this.skyBuf}},{binding:13,resource:y},{binding:14,resource:{buffer:this.mediaBuf}}]});this.cascGroups.push({main:P(w(0)),top:P(w(1)),region:[i[0]*g,i[1]*g]})}this.compositeBuf=e.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.compositeGroup=e.createBindGroup({layout:this.compositePipe.getBindGroupLayout(0),entries:[{binding:1,resource:this.sceneView},{binding:2,resource:x},{binding:4,resource:v},{binding:7,resource:{buffer:this.compositeBuf}},{binding:8,resource:this.histView??d[0]},{binding:13,resource:y}]});for(let r=0;r<64;r++){const i=e.createBuffer({size:48,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});this.brushBufs.push(i),this.brushGroups.push(e.createBindGroup({layout:this.paintPipe.getBindGroupLayout(0),entries:[{binding:9,resource:{buffer:i}}]}))}}setSky(e){const n=e.sunDir??[.3,-1],s=e.sunColor??[1,.85,.6];this.dev.queue.writeBuffer(this.skyBuf,0,new Float32Array([...e.zenith,0,...e.horizon,0,n[0],n[1],e.sunSharpness??24,e.sunIntensity??0,...s,e.strength??1]))}setMedia(e){this.dev.queue.writeBuffer(this.mediaBuf,0,new Float32Array([e.sigma,e.scatter,this.mediaEnabled?1:0,0]))}get fluence(){return{view:this.histView??this.casc0View,probes:[this.probes0[0],this.probes0[1]]}}clearScene(e){e.beginRenderPass({colorAttachments:[{view:this.sceneView,clearValue:{r:0,g:0,b:0,a:0},loadOp:"clear",storeOp:"store"}]}).end()}brush(e,n){const s=this.brushCursor++%64,t=new Float32Array(12);t.set([n.x,n.y,this.width,this.height,n.radius,n.hardness??.25,0,0]),t.set([n.color[0],n.color[1],n.color[2],n.occlusion],8),this.dev.queue.writeBuffer(this.brushBufs[s],0,t);const o=e.beginRenderPass({colorAttachments:[{view:this.sceneView,loadOp:"load",storeOp:"store"}]});o.setPipeline(n.erase?this.erasePipe:this.paintPipe),o.setBindGroup(0,this.brushGroups[s]),o.draw(6),o.end()}encodeGI(e,n){const s=a=>e.beginRenderPass({colorAttachments:[{view:a,loadOp:"clear",storeOp:"store"}]});let t=s(this.jfa[0].createView());t.setPipeline(this.seedPipe),t.setBindGroup(0,this.seedGroup),t.draw(3),t.end();for(let a=0;a<this.jfaGroups.length;a++)t=s(this.jfa[(a+1)%2].createView()),t.setPipeline(this.jfaPipe),t.setBindGroup(0,this.jfaGroups[a]),t.draw(3),t.end();t=s(this.dist.createView()),t.setPipeline(this.distPipe),t.setBindGroup(0,this.distGroup),t.draw(3),t.end();const o=Math.min(Math.max(n??this.cascadeCount,1),this.cascadeCount);for(let a=o-1;a>=0;a--){const c=this.cascGroups[a];t=s(this.casc[a%2].createView()),t.setViewport(0,0,c.region[0],c.region[1],0,1),t.setPipeline(this.cascadePipe),t.setBindGroup(0,a===o-1?c.top:c.main),t.draw(3),t.end()}this.temporalPipe&&this.tempTex&&this.histTex&&(t=s(this.tempTex.createView()),t.setPipeline(this.temporalPipe),t.setBindGroup(0,this.temporalGroup),t.draw(3),t.end(),e.copyTextureToTexture({texture:this.tempTex},{texture:this.histTex},this.texFull))}encodeComposite(e,n,s={}){this.dev.queue.writeBuffer(this.compositeBuf,0,new Float32Array([this.probes0[0],this.probes0[1],s.exposure??1.6,s.debugMode??0,s.emitBoost??.55,0,0,0]));const t=e.beginRenderPass({colorAttachments:[{view:n,clearValue:{r:0,g:0,b:0,a:1},loadOp:"clear",storeOp:"store"}]});t.setPipeline(this.compositePipe),t.setBindGroup(0,this.compositeGroup),t.draw(3),t.end()}dispose(){this.sceneTex.destroy(),this.dist.destroy();for(const e of this.jfa)e.destroy();for(const e of this.casc)e.destroy();for(const e of this.brushBufs)e.destroy();this.compositeBuf.destroy(),this.skyBuf.destroy(),this.mediaBuf.destroy(),this.histTex?.destroy(),this.tempTex?.destroy(),this.temporalBuf?.destroy()}}export{M as R};
