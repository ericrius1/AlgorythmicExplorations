const a=`// Part three's counting sort, widened to a 32-byte particle: position and
// velocity in one vec4, auxiliary state (temperature, …) in a second. The
// scatter copies both, so a particle's heat travels with it through the sort.

struct Particle2 {
  pv: vec4f,  // pos.xy, vel.zw
  aux: vec4f, // temp in x, rest free
}

struct GridParams {
  count: u32,
  grid: u32,
  _pad0: u32,
  _pad1: u32,
}

@group(0) @binding(0) var<uniform> GP: GridParams;
@group(0) @binding(1) var<storage, read> partsIn: array<Particle2>;
@group(0) @binding(2) var<storage, read_write> counts: array<atomic<u32>>;
@group(0) @binding(3) var<storage, read_write> starts: array<u32>;
@group(0) @binding(4) var<storage, read_write> blockSums: array<u32>;
@group(0) @binding(5) var<storage, read_write> cursor: array<atomic<u32>>;
@group(0) @binding(6) var<storage, read_write> sorted: array<Particle2>;

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
  atomicAdd(&counts[cellOf(partsIn[gid.x].pv.xy)], 1u);
}

// ---- pass 2: prefix sum (identical to gridsort.wgsl) -----------------------

var<workgroup> sa: array<u32, 256>;
var<workgroup> sb: array<u32, 256>;

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
  return sa[lid];
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
  starts[gid.x] = inclusive - v0;
  if (lid.x == 255u) { blockSums[wid.x] = inclusive; }
}

@compute @workgroup_size(256)
fn scan_sums(@builtin(local_invocation_id) lid: vec3u) {
  let v0 = blockSums[lid.x];
  sa[lid.x] = v0;
  workgroupBarrier();
  let inclusive = scanShared(lid.x);
  blockSums[lid.x] = inclusive - v0;
}

@compute @workgroup_size(256)
fn scan_add(
  @builtin(global_invocation_id) gid: vec3u,
  @builtin(workgroup_id) wid: vec3u,
) {
  starts[gid.x] = starts[gid.x] + blockSums[wid.x];
}

// ---- pass 3: scatter --------------------------------------------------------

@compute @workgroup_size(256)
fn scatter(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= GP.count) { return; }
  let p = partsIn[gid.x];
  let slot = atomicAdd(&cursor[cellOf(p.pv.xy)], 1u);
  sorted[slot] = p;
}
`,u=256;class c{counts;starts;dev;params;blockSums;cursor;layout;pipes={};constructor(i){this.dev=i;const n=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC;this.params=i.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.counts=i.createBuffer({size:65536*4,usage:n}),this.starts=i.createBuffer({size:65536*4,usage:n}),this.blockSums=i.createBuffer({size:256*4,usage:n}),this.cursor=i.createBuffer({size:65536*4,usage:n});const e=t=>({type:t});this.layout=i.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.COMPUTE,buffer:e("uniform")},{binding:1,visibility:GPUShaderStage.COMPUTE,buffer:e("read-only-storage")},{binding:2,visibility:GPUShaderStage.COMPUTE,buffer:e("storage")},{binding:3,visibility:GPUShaderStage.COMPUTE,buffer:e("storage")},{binding:4,visibility:GPUShaderStage.COMPUTE,buffer:e("storage")},{binding:5,visibility:GPUShaderStage.COMPUTE,buffer:e("storage")},{binding:6,visibility:GPUShaderStage.COMPUTE,buffer:e("storage")}]});const s=i.createShaderModule({code:a}),r=i.createPipelineLayout({bindGroupLayouts:[this.layout]});for(const t of["count","scan_blocks","scan_sums","scan_add","scatter"])this.pipes[t]=i.createComputePipeline({layout:r,compute:{module:s,entryPoint:t}})}bindGroup(i,n){return this.dev.createBindGroup({layout:this.layout,entries:[{binding:0,resource:{buffer:this.params}},{binding:1,resource:{buffer:i}},{binding:2,resource:{buffer:this.counts}},{binding:3,resource:{buffer:this.starts}},{binding:4,resource:{buffer:this.blockSums}},{binding:5,resource:{buffer:this.cursor}},{binding:6,resource:{buffer:n}}]})}writeParams(i){this.dev.queue.writeBuffer(this.params,0,new Uint32Array([i,256,0,0]))}encode(i,n,e){const s=Math.ceil(e/256);i.clearBuffer(this.counts);let r=i.beginComputePass();r.setBindGroup(0,n),r.setPipeline(this.pipes.count),r.dispatchWorkgroups(s),r.setPipeline(this.pipes.scan_blocks),r.dispatchWorkgroups(256),r.setPipeline(this.pipes.scan_sums),r.dispatchWorkgroups(1),r.setPipeline(this.pipes.scan_add),r.dispatchWorkgroups(256),r.end(),i.copyBufferToBuffer(this.starts,0,this.cursor,0,65536*4),r=i.beginComputePass(),r.setBindGroup(0,n),r.setPipeline(this.pipes.scatter),r.dispatchWorkgroups(s),r.end()}dispose(){for(const i of[this.params,this.counts,this.starts,this.blockSums,this.cursor])i.destroy()}}export{c as G,u as a};
