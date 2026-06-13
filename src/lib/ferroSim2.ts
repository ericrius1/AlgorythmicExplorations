// The magnetized ferrofluid stack (Strange Matter part two): part one's
// SPH skeleton plus two magnetic passes — a warm-started magnetization
// relaxation and a pairwise current-loop force — run once per frame and
// cached in the particle aux lane across the five substeps.

import ferroShader from "../shaders/ferro2.wgsl?raw";
import { GridSort2, GRID } from "./gridSort2";
import { seedTray, TRAY, H } from "./ferroSim";

const WG = 256;
export { TRAY, H };

export interface Ferro2Knobs {
  gravity: number;
  stiffness: number;
  restDensity: number;
  nearStiffness: number;
  xsph: number;
  tension: number;
  chi: number; // susceptibility
  hExt: number; // uniform field strength
  magMoment: number; // cursor dipole moment
  forceScale: number;
  kelvin: boolean; // true = Kelvin force model, false = current loop
}

export const FERRO2_KNOBS: Ferro2Knobs = {
  gravity: 3.0,
  stiffness: 80.0,
  restDensity: 2.6,
  nearStiffness: 260.0,
  xsph: 0.16,
  tension: 3.2,
  chi: 8.0,
  hExt: 5.0,
  magMoment: 0.0,
  forceScale: 0.45,
  kelvin: false,
};

export const CURSOR_H = 0.1; // cursor magnet smoothing radius, world units
const M_MAX = 30.0;
const ACC_CLAMP = 70.0;

export class Ferro2Sim {
  count: number;
  readonly params: GPUBuffer;
  private dev: GPUDevice;
  private sort: GridSort2;
  private layout: GPUBindGroupLayout;
  private densityPipe: GPUComputePipeline;
  private forcePipe: GPUComputePipeline;
  private magnetizePipe: GPUComputePipeline;
  private magForcePipe: GPUComputePipeline;
  private bufs: [GPUBuffer, GPUBuffer] = [null!, null!];
  private density: GPUBuffer = null!;
  private sortGroups: [GPUBindGroup, GPUBindGroup] = [null!, null!];
  private simGroups: [GPUBindGroup, GPUBindGroup] = [null!, null!];
  private cur = 0;

  constructor(dev: GPUDevice, count: number) {
    this.dev = dev;
    this.count = count;
    this.sort = new GridSort2(dev);
    this.params = dev.createBuffer({ size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const buf = (type: GPUBufferBindingType): GPUBindGroupLayoutEntry["buffer"] => ({ type });
    this.layout = dev.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: buf("uniform") },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: buf("storage") },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: buf("read-only-storage") },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: buf("read-only-storage") },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: buf("storage") },
      ],
    });
    const module = dev.createShaderModule({ code: ferroShader });
    const pipeLayout = dev.createPipelineLayout({ bindGroupLayouts: [this.layout] });
    const pipe = (entryPoint: string): GPUComputePipeline =>
      dev.createComputePipeline({ layout: pipeLayout, compute: { module, entryPoint } });
    this.densityPipe = pipe("densityPass");
    this.forcePipe = pipe("forcePass");
    this.magnetizePipe = pipe("magnetizePass");
    this.magForcePipe = pipe("magForcePass");
    this.rebuild(count);
  }

  rebuild(count: number): void {
    this.count = count;
    for (const b of this.bufs) b?.destroy();
    this.density?.destroy();
    const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
    this.bufs = [
      this.dev.createBuffer({ size: count * 32, usage }),
      this.dev.createBuffer({ size: count * 32, usage }),
    ];
    this.density = this.dev.createBuffer({ size: count * 16, usage: GPUBufferUsage.STORAGE });
    this.dev.queue.writeBuffer(this.bufs[0], 0, seedTray(count) as BufferSource);
    this.sortGroups = [this.sort.bindGroup(this.bufs[0], this.bufs[1]), this.sort.bindGroup(this.bufs[1], this.bufs[0])];
    const mkSim = (sorted: GPUBuffer): GPUBindGroup =>
      this.dev.createBindGroup({
        layout: this.layout,
        entries: [
          { binding: 0, resource: { buffer: this.params } },
          { binding: 1, resource: { buffer: sorted } },
          { binding: 2, resource: { buffer: this.sort.starts } },
          { binding: 3, resource: { buffer: this.sort.counts } },
          { binding: 4, resource: { buffer: this.density } },
        ],
      });
    this.simGroups = [mkSim(this.bufs[1]), mkSim(this.bufs[0])];
    this.cur = 0;
  }

  writeParams(knobs: Ferro2Knobs, dt: number, mag: [number, number], magOn: boolean): void {
    const dv = new DataView(new ArrayBuffer(96));
    dv.setUint32(0, this.count, true);
    dv.setUint32(4, GRID, true);
    dv.setFloat32(8, H, true);
    dv.setFloat32(12, dt, true);
    dv.setFloat32(16, knobs.gravity, true);
    dv.setFloat32(20, knobs.stiffness, true);
    dv.setFloat32(24, knobs.restDensity, true);
    dv.setFloat32(28, knobs.nearStiffness, true);
    dv.setFloat32(32, knobs.xsph, true);
    dv.setFloat32(36, 2000.0, true); // wallK
    dv.setFloat32(40, knobs.tension, true);
    dv.setFloat32(44, knobs.chi, true);
    dv.setFloat32(48, knobs.hExt, true);
    dv.setFloat32(52, magOn ? knobs.magMoment : 0.0, true);
    dv.setFloat32(56, mag[0], true);
    dv.setFloat32(60, mag[1], true);
    dv.setFloat32(64, knobs.forceScale, true);
    dv.setFloat32(68, knobs.kelvin ? 1.0 : 0.0, true);
    dv.setFloat32(72, M_MAX, true);
    dv.setFloat32(76, ACC_CLAMP, true);
    dv.setFloat32(80, TRAY.floorY, true);
    dv.setFloat32(84, TRAY.wallX, true);
    dv.setFloat32(88, TRAY.topY, true);
    dv.setFloat32(92, CURSOR_H, true);
    this.dev.queue.writeBuffer(this.params, 0, dv.buffer);
  }

  // Substep 0 carries the two magnetic passes; the rest reuse the cached
  // magnetic acceleration. `magnetics` lets the pre-warm skip them entirely.
  encodeSteps(enc: GPUCommandEncoder, steps: number, magnetics = true): void {
    this.sort.writeParams(this.count);
    const wgs = Math.ceil(this.count / WG);
    for (let s = 0; s < steps; s++) {
      this.sort.encode(enc, this.sortGroups[this.cur], this.count);
      const pass = enc.beginComputePass();
      pass.setBindGroup(0, this.simGroups[this.cur]);
      pass.setPipeline(this.densityPipe);
      pass.dispatchWorkgroups(wgs);
      if (magnetics && s === 0) {
        pass.setPipeline(this.magnetizePipe);
        pass.dispatchWorkgroups(wgs);
        pass.setPipeline(this.magForcePipe);
        pass.dispatchWorkgroups(wgs);
      }
      pass.setPipeline(this.forcePipe);
      pass.dispatchWorkgroups(wgs);
      pass.end();
      this.cur = 1 - this.cur;
    }
  }

  get current(): GPUBuffer {
    return this.bufs[this.cur];
  }

  get buffers(): [GPUBuffer, GPUBuffer] {
    return this.bufs;
  }

  get currentIndex(): number {
    return this.cur;
  }

  dispose(): void {
    this.sort.dispose();
    for (const b of this.bufs) b?.destroy();
    this.density?.destroy();
    this.params.destroy();
  }
}
