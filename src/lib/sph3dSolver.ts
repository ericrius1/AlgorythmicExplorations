// 3D SPH confined to the dome shell. Uses the 64-byte particle layout expected
// by GridSort3; pos/vel are the render-facing buffers the dome demo binds.

import sphShader from "../shaders/sph3d.wgsl?raw";
import { GridSort3, GRID3 } from "./gridSort3";
import type { Bodies3D } from "./seed3d";

const WG = 256;
const H = 2 / GRID3;
const PART_BYTES = 64;

export class Sph3DSolver {
  readonly count: number;
  readonly pos: GPUBuffer;
  readonly vel: GPUBuffer;

  shellR = 0.9;
  shellK = 6;
  steps = 3;
  dt = 0.0014;
  gravity = 2.2;
  stiffness = 55;
  restDensity = 2.0;
  nearStiffness = 220;
  xsph = 0.025;
  mouseRadius = 0.14;
  mouseStrength = 45;

  private dev: GPUDevice;
  private sort: GridSort3;
  private params: GPUBuffer;
  private density: GPUBuffer;
  private scratch: GPUBuffer;
  private sorted: GPUBuffer;
  private packGroup: GPUBindGroup;
  private simGroup: GPUBindGroup;
  private packPipe: GPUComputePipeline;
  private densityPipe: GPUComputePipeline;
  private forcePipe: GPUComputePipeline;
  mouse: [number, number, number] = [99, 99, 99];
  mouseVel: [number, number, number] = [0, 0, 0];

  constructor(dev: GPUDevice, init: Bodies3D) {
    this.dev = dev;
    this.count = init.count;
    this.sort = new GridSort3(dev);

    const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
    this.pos = dev.createBuffer({ size: init.count * 16, usage });
    this.vel = dev.createBuffer({ size: init.count * 16, usage });
    dev.queue.writeBuffer(this.pos, 0, init.pos as BufferSource);
    dev.queue.writeBuffer(this.vel, 0, init.vel as BufferSource);

    this.scratch = dev.createBuffer({ size: init.count * PART_BYTES, usage });
    this.sorted = dev.createBuffer({ size: init.count * PART_BYTES, usage });
    this.density = dev.createBuffer({ size: init.count * 8, usage: GPUBufferUsage.STORAGE });
    this.params = dev.createBuffer({ size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    const layout = dev.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      ],
    });
    const pipeLayout = dev.createPipelineLayout({ bindGroupLayouts: [layout] });
    const module = dev.createShaderModule({ code: sphShader });
    const mk = (entry: string): GPUComputePipeline =>
      dev.createComputePipeline({ layout: pipeLayout, compute: { module, entryPoint: entry } });
    this.packPipe = mk("packIn");
    this.densityPipe = mk("densityPass");
    this.forcePipe = mk("forcePass");

    const mkGroup = (parts: GPUBuffer): GPUBindGroup =>
      dev.createBindGroup({
        layout,
        entries: [
          { binding: 0, resource: { buffer: this.params } },
          { binding: 1, resource: { buffer: parts } },
          { binding: 2, resource: { buffer: this.sort.starts } },
          { binding: 3, resource: { buffer: this.sort.counts } },
          { binding: 4, resource: { buffer: this.density } },
          { binding: 5, resource: { buffer: this.pos } },
          { binding: 6, resource: { buffer: this.vel } },
        ],
      });
    this.packGroup = mkGroup(this.scratch);
    this.simGroup = mkGroup(this.sorted);
  }

  writeParams(): void {
    const dv = new DataView(new ArrayBuffer(96));
    dv.setUint32(0, this.count, true);
    dv.setUint32(4, GRID3, true);
    dv.setFloat32(8, H, true);
    dv.setFloat32(12, this.dt, true);
    dv.setFloat32(16, this.gravity, true);
    dv.setFloat32(20, this.stiffness, true);
    dv.setFloat32(24, this.restDensity, true);
    dv.setFloat32(28, this.nearStiffness, true);
    dv.setFloat32(32, this.xsph, true);
    dv.setFloat32(36, this.shellK, true);
    dv.setFloat32(40, this.shellR, true);
    dv.setFloat32(44, this.mouseRadius, true);
    dv.setFloat32(48, this.mouseStrength, true);
    dv.setFloat32(52, this.mouse[0], true);
    dv.setFloat32(56, this.mouse[1], true);
    dv.setFloat32(60, this.mouse[2], true);
    dv.setFloat32(64, this.mouseVel[0], true);
    dv.setFloat32(68, this.mouseVel[1], true);
    dv.setFloat32(72, this.mouseVel[2], true);
    this.dev.queue.writeBuffer(this.params, 0, dv.buffer);
  }

  encode(enc: GPUCommandEncoder): void {
    const wgs = Math.ceil(this.count / WG);
    this.sort.writeParams(this.count);
    this.writeParams();
    const sortGroup = this.sort.bindGroup(this.scratch, this.sorted);

    for (let s = 0; s < this.steps; s++) {
      {
        const pass = enc.beginComputePass();
        pass.setPipeline(this.packPipe);
        pass.setBindGroup(0, this.packGroup);
        pass.dispatchWorkgroups(wgs);
        pass.end();
      }
      this.sort.encode(enc, sortGroup, this.count);
      {
        const pass = enc.beginComputePass();
        pass.setBindGroup(0, this.simGroup);
        pass.setPipeline(this.densityPipe);
        pass.dispatchWorkgroups(wgs);
        pass.setPipeline(this.forcePipe);
        pass.dispatchWorkgroups(wgs);
        pass.end();
      }
    }
  }

  dispose(): void {
    this.sort.dispose();
    for (const b of [this.pos, this.vel, this.params, this.density, this.scratch, this.sorted]) b.destroy();
  }
}
