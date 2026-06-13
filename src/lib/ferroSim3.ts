// The 3D ferrofluid stack: gridSort3 + the part-two physics in a z-up dish,
// plus ownership of the 128³ fixed-point density field the surface
// extractors read. Magnetic passes run once per frame (substep 0) and cache
// their acceleration in the particle's fourth lane, exactly as in 2D.

import ferroShader from "../shaders/ferro3.wgsl?raw";
import { GridSort3, GRID3 } from "./gridSort3";

const WG = 256;
export const H3 = 2 / GRID3;

export const DISH = {
  wallXY: 0.42,
  floorZ: -0.3,
  topZ: 0.85,
};

export const FIELD_N = 128;
export const FIELD_SCALE = 256;
export const SPLAT_R = H3 * 1.1;
export const CURSOR_H3 = 0.12;

export interface Ferro3Knobs {
  gravity: number;
  stiffness: number;
  restDensity: number;
  nearStiffness: number;
  xsph: number;
  tension: number;
  chi: number;
  hExt: number;
  magMoment: number;
  forceScale: number;
  kelvin: boolean;
}

export const FERRO3_KNOBS: Ferro3Knobs = {
  gravity: 3.4,
  stiffness: 60.0,
  restDensity: 4.2,
  nearStiffness: 220.0,
  xsph: 0.12,
  tension: 2.8,
  chi: 4.0,
  hExt: 5.0,
  magMoment: 0.0,
  forceScale: 0.17,
  kelvin: false,
};

const M_MAX = 30.0;
const ACC_CLAMP = 28.0;

// A settled pool: layers of jittered grid from the dish floor up.
export function seedDish(count: number): Float32Array {
  const s = H3 * 0.5;
  const state = new Float32Array(count * 16);
  const hw = DISH.wallXY - s;
  const cols = Math.max(Math.floor((hw * 2) / s), 1);
  let i = 0;
  for (let layer = 0; i < count && layer < 400; layer++) {
    const z = DISH.floorZ + s * (layer + 0.7);
    for (let row = 0; row < cols && i < count; row++) {
      const y = -hw + s * (row + 0.5);
      for (let col = 0; col < cols && i < count; col++, i++) {
        state[i * 16] = -hw + s * (col + 0.5) + (Math.random() - 0.5) * s * 0.35;
        state[i * 16 + 1] = y + (Math.random() - 0.5) * s * 0.35;
        state[i * 16 + 2] = z + (Math.random() - 0.5) * s * 0.35;
      }
    }
  }
  return state;
}

export class Ferro3Sim {
  count: number;
  readonly params: GPUBuffer;
  readonly field: GPUBuffer;
  private dev: GPUDevice;
  private sort: GridSort3;
  private layout: GPUBindGroupLayout;
  private pipes: Record<string, GPUComputePipeline> = {};
  private bufs: [GPUBuffer, GPUBuffer] = [null!, null!];
  private density: GPUBuffer = null!;
  private sortGroups: [GPUBindGroup, GPUBindGroup] = [null!, null!];
  private simGroups: [GPUBindGroup, GPUBindGroup] = [null!, null!];
  private cur = 0;

  constructor(dev: GPUDevice, count: number) {
    this.dev = dev;
    this.count = count;
    this.sort = new GridSort3(dev);
    this.params = dev.createBuffer({ size: 112, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.field = dev.createBuffer({
      size: FIELD_N * FIELD_N * FIELD_N * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const buf = (type: GPUBufferBindingType): GPUBindGroupLayoutEntry["buffer"] => ({ type });
    this.layout = dev.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: buf("uniform") },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: buf("storage") },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: buf("read-only-storage") },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: buf("read-only-storage") },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: buf("storage") },
        { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: buf("storage") },
      ],
    });
    const module = dev.createShaderModule({ code: ferroShader });
    const pipeLayout = dev.createPipelineLayout({ bindGroupLayouts: [this.layout] });
    for (const entry of ["densityPass", "forcePass", "magnetizePass", "magForcePass", "splatPass"]) {
      this.pipes[entry] = dev.createComputePipeline({ layout: pipeLayout, compute: { module, entryPoint: entry } });
    }
    this.rebuild(count);
  }

  rebuild(count: number): void {
    this.count = count;
    for (const b of this.bufs) b?.destroy();
    this.density?.destroy();
    const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
    this.bufs = [
      this.dev.createBuffer({ size: count * 64, usage }),
      this.dev.createBuffer({ size: count * 64, usage }),
    ];
    this.density = this.dev.createBuffer({ size: count * 8, usage: GPUBufferUsage.STORAGE });
    this.dev.queue.writeBuffer(this.bufs[0], 0, seedDish(count) as BufferSource);
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
          { binding: 5, resource: { buffer: this.field } },
        ],
      });
    this.simGroups = [mkSim(this.bufs[1]), mkSim(this.bufs[0])];
    this.cur = 0;
  }

  writeParams(knobs: Ferro3Knobs, dt: number, mag: [number, number, number], magOn: boolean): void {
    const dv = new DataView(new ArrayBuffer(112));
    dv.setUint32(0, this.count, true);
    dv.setUint32(4, GRID3, true);
    dv.setFloat32(8, H3, true);
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
    dv.setFloat32(56, knobs.forceScale, true);
    dv.setFloat32(60, knobs.kelvin ? 1.0 : 0.0, true);
    dv.setFloat32(64, mag[0], true);
    dv.setFloat32(68, mag[1], true);
    dv.setFloat32(72, mag[2], true);
    dv.setFloat32(76, CURSOR_H3, true);
    dv.setFloat32(80, M_MAX, true);
    dv.setFloat32(84, ACC_CLAMP, true);
    dv.setFloat32(88, DISH.floorZ, true);
    dv.setFloat32(92, DISH.wallXY, true);
    dv.setFloat32(96, DISH.topZ, true);
    dv.setUint32(100, FIELD_N, true);
    dv.setFloat32(104, SPLAT_R, true);
    dv.setFloat32(108, FIELD_SCALE, true);
    this.dev.queue.writeBuffer(this.params, 0, dv.buffer);
  }

  encodeSteps(enc: GPUCommandEncoder, steps: number, magnetics = true): void {
    this.sort.writeParams(this.count);
    const wgs = Math.ceil(this.count / WG);
    for (let s = 0; s < steps; s++) {
      this.sort.encode(enc, this.sortGroups[this.cur], this.count);
      const pass = enc.beginComputePass();
      pass.setBindGroup(0, this.simGroups[this.cur]);
      pass.setPipeline(this.pipes.densityPass);
      pass.dispatchWorkgroups(wgs);
      if (magnetics && s === 0) {
        pass.setPipeline(this.pipes.magnetizePass);
        pass.dispatchWorkgroups(wgs);
        pass.setPipeline(this.pipes.magForcePass);
        pass.dispatchWorkgroups(wgs);
      }
      pass.setPipeline(this.pipes.forcePass);
      pass.dispatchWorkgroups(wgs);
      pass.end();
      this.cur = 1 - this.cur;
    }
  }

  // particles → fixed-point field, cleared first; run after the substeps
  encodeSplat(enc: GPUCommandEncoder): void {
    enc.clearBuffer(this.field);
    const pass = enc.beginComputePass();
    pass.setBindGroup(0, this.simGroups[this.cur]);
    pass.setPipeline(this.pipes.splatPass);
    pass.dispatchWorkgroups(Math.ceil(this.count / WG));
    pass.end();
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
    this.field.destroy();
  }
}
