const d=`
struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn vs(@builtin(vertex_index) i: u32) -> VOut {
  var out: VOut;
  let xy = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  out.pos = vec4f(xy * 2.0 - 1.0, 0.0, 1.0);
  // uv: x rightward 0..1, y upward 0..1 (math orientation)
  out.uv = vec2f(xy.x, xy.y);
  return out;
}

// U[0] = (time, aspect, pointerX, pointerY); the rest is per-demo.
@group(0) @binding(0) var<uniform> U: array<vec4f, 8>;
@group(0) @binding(1) var<storage, read> D: array<f32>;

fn uf(i: u32) -> f32 { return U[i >> 2u][i & 3u]; }

fn hsv(h: f32, s: f32, v: f32) -> vec3f {
  let p = abs(fract(vec3f(h) + vec3f(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return v * mix(vec3f(1.0), clamp(p - 1.0, vec3f(0.0), vec3f(1.0)), s);
}

fn sdSeg(p: vec2f, a: vec2f, b: vec2f) -> f32 {
  let pa = p - a;
  let ba = b - a;
  let h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-9), 0.0, 1.0);
  return length(pa - ba * h);
}

// soft gaussian core — the bright line itself
fn glow(d: f32, r: f32) -> f32 { return exp(-(d * d) / (r * r)); }
// long 1/d tail — the bloom around it
fn halo(d: f32, r: f32) -> f32 { return r / (abs(d) + r); }

fn vignette(uv: vec2f) -> f32 {
  let q = uv * (1.0 - uv);
  return pow(clamp(q.x * q.y * 16.0, 0.0, 1.0), 0.18);
}

@fragment
fn fs(v: VOut) -> @location(0) vec4f {
  // touch D so "auto" pipeline layout keeps binding 1 even for scenes
  // that compute everything from uniforms alone
  let c = scene(v.uv) + vec3f(D[0]) * 1e-20;
  return vec4f(max(c, vec3f(0.0)), 1.0);
}
`;class l{uniforms=new Float32Array(32);data;pointer={x:.5,y:.5,down:!1,inside:!1};dev;ctx;broken=!1;pipeline;bind;ubuf;dbuf;t0=performance.now();constructor(t,e,a,p=4){this.dev=t;const n=e.getContext("webgpu");if(!n)throw new Error("no webgpu context");const s=navigator.gpu.getPreferredCanvasFormat();n.configure({device:t,format:s,alphaMode:"premultiplied"}),this.ctx=n,this.data=new Float32Array(Math.max(p,4)),this.ubuf=t.createBuffer({size:128,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.dbuf=t.createBuffer({size:this.data.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});const u=d+a;t.pushErrorScope("validation");const o=t.createShaderModule({code:u});o.getCompilationInfo().then(i=>{for(const r of i.messages)if(r.type==="error"){this.broken=!0;const h=u.split(`
`)[r.lineNum-1]??"";console.error(`WGSL error ${r.lineNum}:${r.linePos} — ${r.message}
${h}`)}}),this.pipeline=t.createRenderPipeline({layout:"auto",vertex:{module:o,entryPoint:"vs"},fragment:{module:o,entryPoint:"fs",targets:[{format:s}]},primitive:{topology:"triangle-list"}}),this.bind=t.createBindGroup({layout:this.pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.ubuf}},{binding:1,resource:{buffer:this.dbuf}}]}),t.popErrorScope().then(i=>{i&&(this.broken=!0,console.error(`ShaderView setup failed: ${i.message}`))});const f=i=>{const r=e.getBoundingClientRect();return[(i.clientX-r.left)/r.width,1-(i.clientY-r.top)/r.height]};e.addEventListener("pointerdown",i=>{[this.pointer.x,this.pointer.y]=f(i),this.pointer.down=!0,e.setPointerCapture(i.pointerId)}),e.addEventListener("pointermove",i=>{[this.pointer.x,this.pointer.y]=f(i),this.pointer.inside=!0}),e.addEventListener("pointerup",()=>this.pointer.down=!1),e.addEventListener("pointerleave",()=>{this.pointer.inside=!1,this.pointer.down=!1}),this.uniforms[1]=e.width/e.height}draw(){if(this.broken)return;this.uniforms[0]=(performance.now()-this.t0)/1e3,this.uniforms[2]=this.pointer.x,this.uniforms[3]=this.pointer.y,this.dev.queue.writeBuffer(this.ubuf,0,this.uniforms),this.dev.queue.writeBuffer(this.dbuf,0,this.data);const t=this.dev.createCommandEncoder(),e=t.beginRenderPass({colorAttachments:[{view:this.ctx.getCurrentTexture().createView(),loadOp:"clear",storeOp:"store",clearValue:{r:.024,g:.027,b:.043,a:1}}]});e.setPipeline(this.pipeline),e.setBindGroup(0,this.bind),e.draw(3),e.end(),this.dev.queue.submit([t.finish()])}}export{l as S};
