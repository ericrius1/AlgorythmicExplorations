// The ferrofluid SPH stack: 32-byte particles, grid sort, density+force
// passes — the lava lamp's skeleton with temperature removed and a magnet
// added. Demos differ only in how they draw the result.

import ferroShader from "../shaders/ferro.wgsl?raw";
import { GridSort2, GRID } from "./gridSort2";

const WG = 256;
export const H = 2 / GRID;

// Tray geometry, world units ([-1,1] sim box). Shared by sim and renderer.
export const TRAY = {
  floorY: -0.52,
  topY: 0.95,
  wallX: 0.8,
};

export interface FerroKnobs {
  gravity: number;
  stiffness: number;
  restDensity: number;
  nearStiffness: number;
  xsph: number;
  tension: number;
  magStrength: number;
  magSoft: number;
}

export const FERRO_KNOBS: FerroKnobs = {
  gravity: 3.0,
  stiffness: 80.0,
  restDensity: 2.6,
  nearStiffness: 260.0,
  xsph: 0.16,
  tension: 3.2,
  magStrength: 30.0,
  magSoft: 0.09,
};

// Cold pool filling the bottom of the tray, h/2 spacing with jitter.
export function seedTray(count: number): Float32Array {
  const s = H * 0.5;
  const state = new Float32Array(count * 8);
  let i = 0;
  for (let row = 0; i < count && row < 4000; row++) {
    const y = TRAY.floorY + s * (row + 0.7);
    const hw = TRAY.wallX - s;
    const cols = Math.max(Math.floor((hw * 2) / s), 1);
    for (let col = 0; col < cols && i < count; col++, i++) {
      state[i * 8] = -hw + s * (col + 0.5) + (Math.random() - 0.5) * s * 0.4;
      state[i * 8 + 1] = y + (Math.random() - 0.5) * s * 0.4;
    }
  }
  return state;
}

export class FerroSim {
  count: number;
  readonly params: GPUBuffer;
  private dev: GPUDevice;
  private sort: GridSort2;
  private layout: GPUBindGroupLayout;
  private densityPipe: GPUComputePipeline;
  private forcePipe: GPUComputePipeline;
  private bufs: [GPUBuffer, GPUBuffer] = [null!, null!];
  private density: GPUBuffer = null!;
  private sortGroups: [GPUBindGroup, GPUBindGroup] = [null!, null!];
  private simGroups: [GPUBindGroup, GPUBindGroup] = [null!, null!];
  private cur = 0;

  constructor(dev: GPUDevice, count: number) {
    this.dev = dev;
    this.count = count;
    this.sort = new GridSort2(dev);
    this.params = dev.createBuffer({ size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
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
    this.densityPipe = dev.createComputePipeline({ layout: pipeLayout, compute: { module, entryPoint: "densityPass" } });
    this.forcePipe = dev.createComputePipeline({ layout: pipeLayout, compute: { module, entryPoint: "forcePass" } });
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

  writeParams(knobs: FerroKnobs, dt: number, mag: [number, number], magDir: [number, number], magOn: boolean): void {
    const dv = new DataView(new ArrayBuffer(80));
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
    dv.setFloat32(44, magOn ? knobs.magStrength : 0.0, true);
    dv.setFloat32(48, mag[0], true);
    dv.setFloat32(52, mag[1], true);
    dv.setFloat32(56, magDir[0], true);
    dv.setFloat32(60, magDir[1], true);
    dv.setFloat32(64, knobs.magSoft, true);
    dv.setFloat32(68, TRAY.floorY, true);
    dv.setFloat32(72, TRAY.wallX, true);
    dv.setFloat32(76, TRAY.topY, true);
    this.dev.queue.writeBuffer(this.params, 0, dv.buffer);
  }

  encodeSteps(enc: GPUCommandEncoder, steps: number): void {
    this.sort.writeParams(this.count);
    const wgs = Math.ceil(this.count / WG);
    for (let s = 0; s < steps; s++) {
      this.sort.encode(enc, this.sortGroups[this.cur], this.count);
      const pass = enc.beginComputePass();
      pass.setBindGroup(0, this.simGroups[this.cur]);
      pass.setPipeline(this.densityPipe);
      pass.dispatchWorkgroups(wgs);
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
