const o=`// Minimal additive particle renderer: one instanced quad per body,
// colored by speed.

struct RenderParams {
  scale: f32,
  aspect: f32,
  size: f32,
  colorScale: f32,
}

@group(0) @binding(0) var<uniform> R: RenderParams;
@group(0) @binding(1) var<storage, read> bodies: array<vec4f>;

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
  let b = bodies[ii];
  let q = QUAD[vi];
  let wp = b.xy + q * R.size;
  var o: VOut;
  o.pos = vec4f(wp.x * R.scale / R.aspect, wp.y * R.scale, 0.0, 1.0);
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
`;class c{dev;pipeline;params;group=null;ctx;constructor(e,r){this.dev=e,this.ctx=r;const n=e.createShaderModule({code:o});this.pipeline=e.createRenderPipeline({layout:"auto",vertex:{module:n,entryPoint:"vs"},fragment:{module:n,entryPoint:"fs",targets:[{format:navigator.gpu.getPreferredCanvasFormat(),blend:{color:{srcFactor:"src-alpha",dstFactor:"one",operation:"add"},alpha:{srcFactor:"one",dstFactor:"one",operation:"add"}}}]},primitive:{topology:"triangle-list"}}),this.params=e.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST})}bind(e){this.group=this.dev.createBindGroup({layout:this.pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.params}},{binding:1,resource:{buffer:e}}]})}encode(e,r,n={}){const a=this.ctx.canvas,i=new Float32Array([n.scale??.95,a.width/a.height,n.size??.0022,n.colorScale??2]);this.dev.queue.writeBuffer(this.params,0,i);const t=e.beginRenderPass({colorAttachments:[{view:this.ctx.getCurrentTexture().createView(),clearValue:{r:.024,g:.027,b:.043,a:1},loadOp:n.load?"load":"clear",storeOp:"store"}]});t.setPipeline(this.pipeline),t.setBindGroup(0,this.group),t.draw(6,r),t.end()}}export{c as P};
