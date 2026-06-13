// GridSort's unbounded sibling: GPU counting sort over a *hashed* grid.
// Cells are one interaction-radius wide and tile all of space; their integer
// coordinates hash into a power-of-two table. Same three moves — histogram,
// scan, scatter — same buffers, no walls.

import hashShader from "../shaders/hashsort.wgsl?raw";

export const HASH_TABLE_SIZES = [1 << 16, 1 << 18, 1 << 20] as const;
export type HashTableSize = (typeof HASH_TABLE_SIZES)[number];

export function chooseHashTableSize(count: number): HashTableSize {
  if (count >= 80000) return 1 << 20;
  if (count >= 30000) return 1 << 18;
  return 1 << 16;
}

const WG = 256;

export class HashSort {
  readonly counts: GPUBuffer;
  readonly starts: GPUBuffer;
  readonly table: HashTableSize;
  private dev: GPUDevice;
  private blocks: number;
  private params: GPUBuffer;
  private blockSums: GPUBuffer;
  private cursor: GPUBuffer;
  private layout: GPUBindGroupLayout;
  private pipes: Record<string, GPUComputePipeline> = {};

  constructor(dev: GPUDevice, table: HashTableSize = HASH_TABLE_SIZES[0]) {
    this.dev = dev;
    this.table = table;
    this.blocks = table / WG;
    const storage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
    this.params = dev.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.counts = dev.createBuffer({ size: table * 4, usage: storage });
    this.starts = dev.createBuffer({ size: table * 4, usage: storage });
    this.blockSums = dev.createBuffer({ size: this.blocks * 4, usage: storage });
    this.cursor = dev.createBuffer({ size: table * 4, usage: storage });

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
    const constants = { TABLE: table, FOLD: this.blocks / WG };
    for (const entry of ["count", "scan_blocks", "scan_sums", "scan_add", "scatter"]) {
      this.pipes[entry] = dev.createComputePipeline({
        layout: pipeLayout,
        compute: { module, entryPoint: entry, constants },
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
    pass.dispatchWorkgroups(this.blocks);
    pass.setPipeline(this.pipes.scan_sums);
    pass.dispatchWorkgroups(1);
    pass.setPipeline(this.pipes.scan_add);
    pass.dispatchWorkgroups(this.blocks);
    pass.setPipeline(this.pipes.scatter);
    pass.dispatchWorkgroups(wgs);
    pass.end();
  }

  dispose(): void {
    for (const b of [this.params, this.counts, this.starts, this.blockSums, this.cursor]) b.destroy();
  }
}
