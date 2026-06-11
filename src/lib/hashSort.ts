// GridSort's unbounded sibling: GPU counting sort over a *hashed* grid.
// Cells are one interaction-radius wide and tile all of space; their integer
// coordinates hash into 65,536 buckets. Same three moves — histogram, scan,
// scatter — same buffers, no walls.

import hashShader from "../shaders/hashsort.wgsl?raw";

export const TABLE = 65536;
const WG = 256;
const BLOCKS = TABLE / WG; // 256 — block sums fit one workgroup exactly

export class HashSort {
  readonly counts: GPUBuffer;
  readonly starts: GPUBuffer;
  private dev: GPUDevice;
  private params: GPUBuffer;
  private blockSums: GPUBuffer;
  private cursor: GPUBuffer;
  private layout: GPUBindGroupLayout;
  private pipes: Record<string, GPUComputePipeline> = {};

  constructor(dev: GPUDevice) {
    this.dev = dev;
    const storage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
    this.params = dev.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.counts = dev.createBuffer({ size: TABLE * 4, usage: storage });
    this.starts = dev.createBuffer({ size: TABLE * 4, usage: storage });
    this.blockSums = dev.createBuffer({ size: BLOCKS * 4, usage: storage });
    this.cursor = dev.createBuffer({ size: TABLE * 4, usage: storage });

    const buf = (type: GPUBufferBindingType): GPUBindGroupLayoutEntry["buffer"] => ({ type });
    this.layout = dev.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: buf("uniform") },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: buf("read-only-storage") },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: buf("storage") },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: buf("storage") },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: buf("storage") },
        { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: buf("storage") },
        { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: buf("storage") },
      ],
    });
    const module = dev.createShaderModule({ code: hashShader });
    const pipeLayout = dev.createPipelineLayout({ bindGroupLayouts: [this.layout] });
    for (const entry of ["count", "scan_blocks", "scan_sums", "scan_add", "scatter"]) {
      this.pipes[entry] = dev.createComputePipeline({
        layout: pipeLayout,
        compute: { module, entryPoint: entry },
      });
    }
  }

  bindGroup(partsIn: GPUBuffer, sorted: GPUBuffer): GPUBindGroup {
    return this.dev.createBindGroup({
      layout: this.layout,
      entries: [
        { binding: 0, resource: { buffer: this.params } },
        { binding: 1, resource: { buffer: partsIn } },
        { binding: 2, resource: { buffer: this.counts } },
        { binding: 3, resource: { buffer: this.starts } },
        { binding: 4, resource: { buffer: this.blockSums } },
        { binding: 5, resource: { buffer: this.cursor } },
        { binding: 6, resource: { buffer: sorted } },
      ],
    });
  }

  writeParams(count: number, cellSize: number): void {
    const dv = new DataView(new ArrayBuffer(16));
    dv.setUint32(0, count, true);
    dv.setFloat32(8, cellSize, true);
    this.dev.queue.writeBuffer(this.params, 0, dv.buffer);
  }

  encode(enc: GPUCommandEncoder, group: GPUBindGroup, count: number): void {
    const wgs = Math.ceil(count / WG);
    enc.clearBuffer(this.counts);

    let pass = enc.beginComputePass();
    pass.setBindGroup(0, group);
    pass.setPipeline(this.pipes.count);
    pass.dispatchWorkgroups(wgs);
    pass.setPipeline(this.pipes.scan_blocks);
    pass.dispatchWorkgroups(BLOCKS);
    pass.setPipeline(this.pipes.scan_sums);
    pass.dispatchWorkgroups(1);
    pass.setPipeline(this.pipes.scan_add);
    pass.dispatchWorkgroups(BLOCKS);
    pass.end();

    enc.copyBufferToBuffer(this.starts, 0, this.cursor, 0, TABLE * 4);

    pass = enc.beginComputePass();
    pass.setBindGroup(0, group);
    pass.setPipeline(this.pipes.scatter);
    pass.dispatchWorkgroups(wgs);
    pass.end();
  }

  dispose(): void {
    for (const b of [this.params, this.counts, this.starts, this.blockSums, this.cursor]) b.destroy();
  }
}
