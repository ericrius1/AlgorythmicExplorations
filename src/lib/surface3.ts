// Driver for surface3.wgsl: owns the mesh buffers and runs one of the
// extractors over the sim's field each frame. Marching tets fills the vertex
// soup; surface nets / dual contouring fill vertices + indices. Both end in
// the same finalize pass that turns atomic counters into indirect-draw args.

import surfShader from "../shaders/surface3.wgsl?raw";
import { FIELD_N, FIELD_SCALE } from "./ferroSim3";

export const MAX_VERTS = 600_000;
export const MAX_IDX = 2_400_000;
const CELLS = FIELD_N - 1;

export type Extractor = "tets" | "nets" | "dc";

export class Surface3 {
  readonly verts: GPUBuffer;
  readonly indices: GPUBuffer;
  readonly indirect: GPUBuffer; // [0..3] soup draw, [4..8] indexed draw
  private dev: GPUDevice;
  private params: GPUBuffer;
  private cellVert: GPUBuffer;
  private vertCount: GPUBuffer;
  private idxCount: GPUBuffer;
  private counts: GPUBuffer; // staging for the info line
  private countsBusy = false;
  private group: GPUBindGroup;
  private pipes: Record<string, GPUComputePipeline> = {};
  trisDrawn = 0;

  constructor(dev: GPUDevice, field: GPUBuffer) {
    this.dev = dev;
    this.params = dev.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.verts = dev.createBuffer({ size: MAX_VERTS * 32, usage: GPUBufferUsage.STORAGE });
    this.indices = dev.createBuffer({ size: MAX_IDX * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDEX });
    this.cellVert = dev.createBuffer({ size: CELLS * CELLS * CELLS * 4, usage: GPUBufferUsage.STORAGE });
    const counter = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
    this.vertCount = dev.createBuffer({ size: 4, usage: counter });
    this.idxCount = dev.createBuffer({ size: 4, usage: counter });
    this.indirect = dev.createBuffer({ size: 48, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT });
    this.counts = dev.createBuffer({ size: 8, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });

    const buf = (type: GPUBufferBindingType): GPUBindGroupLayoutEntry["buffer"] => ({ type });
    const layout = dev.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: buf("uniform") },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: buf("read-only-storage") },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: buf("storage") },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: buf("storage") },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: buf("storage") },
        { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: buf("storage") },
        { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: buf("storage") },
        { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: buf("storage") },
      ],
    });
    const module = dev.createShaderModule({ code: surfShader });
    const pipeLayout = dev.createPipelineLayout({ bindGroupLayouts: [layout] });
    for (const entry of ["mtPass", "dcVertexPass", "dcFacePass", "finalizePass"]) {
      this.pipes[entry] = dev.createComputePipeline({ layout: pipeLayout, compute: { module, entryPoint: entry } });
    }
    this.group = dev.createBindGroup({
      layout,
      entries: [
        { binding: 0, resource: { buffer: this.params } },
        { binding: 1, resource: { buffer: field } },
        { binding: 2, resource: { buffer: this.verts } },
        { binding: 3, resource: { buffer: this.vertCount } },
        { binding: 4, resource: { buffer: this.cellVert } },
        { binding: 5, resource: { buffer: this.indices } },
        { binding: 6, resource: { buffer: this.idxCount } },
        { binding: 7, resource: { buffer: this.indirect } },
      ],
    });
  }

  writeParams(threshold: number, sharp: number): void {
    const dv = new DataView(new ArrayBuffer(32));
    dv.setUint32(0, FIELD_N, true);
    dv.setUint32(4, CELLS, true);
    dv.setUint32(8, MAX_VERTS, true);
    dv.setUint32(12, MAX_IDX, true);
    dv.setFloat32(16, threshold, true);
    dv.setFloat32(20, FIELD_SCALE, true);
    dv.setFloat32(24, sharp, true);
    dv.setUint32(28, 10, true); // relax iterations
    this.dev.queue.writeBuffer(this.params, 0, dv.buffer);
  }

  encode(enc: GPUCommandEncoder, mode: Extractor): void {
    enc.clearBuffer(this.vertCount);
    enc.clearBuffer(this.idxCount);
    const cellWgs = Math.ceil(CELLS / 4);
    const latticeWgs = Math.ceil(FIELD_N / 4);
    const pass = enc.beginComputePass();
    pass.setBindGroup(0, this.group);
    if (mode === "tets") {
      pass.setPipeline(this.pipes.mtPass);
      pass.dispatchWorkgroups(cellWgs, cellWgs, cellWgs);
    } else {
      pass.setPipeline(this.pipes.dcVertexPass);
      pass.dispatchWorkgroups(cellWgs, cellWgs, cellWgs);
      pass.setPipeline(this.pipes.dcFacePass);
      pass.dispatchWorkgroups(latticeWgs, latticeWgs, latticeWgs);
    }
    pass.setPipeline(this.pipes.finalizePass);
    pass.dispatchWorkgroups(1);
    pass.end();
    if (!this.countsBusy) {
      enc.copyBufferToBuffer(this.vertCount, 0, this.counts, 0, 4);
      enc.copyBufferToBuffer(this.idxCount, 0, this.counts, 4, 4);
    }
  }

  // call after submit; updates trisDrawn for the readout
  readCounts(mode: Extractor): void {
    if (this.countsBusy) return;
    this.countsBusy = true;
    this.counts.mapAsync(GPUMapMode.READ).then(() => {
      const u = new Uint32Array(this.counts.getMappedRange());
      this.trisDrawn = Math.floor((mode === "tets" ? Math.min(u[0], MAX_VERTS) : Math.min(u[1], MAX_IDX)) / 3);
      this.counts.unmap();
      this.countsBusy = false;
    }).catch(() => (this.countsBusy = false));
  }

  dispose(): void {
    for (const b of [this.params, this.verts, this.indices, this.cellVert, this.vertCount, this.idxCount, this.indirect, this.counts]) {
      b.destroy();
    }
  }
}
