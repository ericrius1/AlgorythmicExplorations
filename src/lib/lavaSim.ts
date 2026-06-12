// The lava-lamp SPH stack, shared by every demo on the page: 32-byte
// particles (pos/vel + temperature), grid sort, density+force passes.
// Demos differ only in how they draw the result.

import lavaShader from "../shaders/lava.wgsl?raw";
import { GridSort2, GRID } from "./gridSort2";

const WG = 256;
export const H = 2 / GRID;

// Vessel geometry, world units ([-1,1] sim box). One source of truth for
// the sim shader, the scene shader, and particle seeding.
export const LAMP = {
  floorY: -0.62,
  topY: 0.66,
  wallBottom: 0.4,
  wallTop: 0.26,
  heaterY: -0.56,
};

export interface LavaKnobs {
  gravity: number;
  stiffness: number;
  restDensity: number;
  nearStiffness: number;
  xsph: number;
  beta: number;
  buoyancy: number;
  heatRate: number;
  coolRate: number;
  diffusion: number;
}

export const DEFAULT_KNOBS: LavaKnobs = {
  gravity: 3.0,
  stiffness: 80.0,
  restDensity: 2.4,
  nearStiffness: 260.0,
  xsph: 0.22,
  beta: 0.2,
  buoyancy: 5.0,
  heatRate: 1.5,
  coolRate: 1.1,
  diffusion: 0.02,
};

export function vesselHalfWidth(y: number): number {
  const t = Math.min(Math.max((y - LAMP.floorY) / (LAMP.topY - LAMP.floorY), 0), 1);
  return LAMP.wallBottom + (LAMP.wallTop - LAMP.wallBottom) * t;
}

// Cold wax pooled at the bottom of the taper, h/2 spacing with jitter.
export function seedPool(count: number): Float32Array {
  const s = H * 0.5;
  const state = new Float32Array(count * 8);
  let i = 0;
  for (let row = 0; i < count && row < 4000; row++) {
    const y = LAMP.floorY + s * (row + 0.7);
    const hw = vesselHalfWidth(y) - s;
    const cols = Math.max(Math.floor((hw * 2) / s), 1);
    for (let col = 0; col < cols && i < count; col++, i++) {
      state[i * 8] = -hw + s * (col + 0.5) + (Math.random() - 0.5) * s * 0.4;
      state[i * 8 + 1] = y + (Math.random() - 0.5) * s * 0.4;
      // vel zw = 0; aux: temperature 0 (cold), rest unused
    }
  }
  return state;
}

export class LavaSim {
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
    this.params = dev.createBuffer({ size: 112, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
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
    const module = dev.createShaderModule({ code: lavaShader });
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
    this.dev.queue.writeBuffer(this.bufs[0], 0, seedPool(count) as BufferSource);
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

  writeParams(knobs: LavaKnobs, dt: number, mouse: [number, number], mouseVel: [number, number]): void {
    const dv = new DataView(new ArrayBuffer(112));
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
    dv.setFloat32(40, knobs.beta, true);
    dv.setFloat32(44, knobs.buoyancy, true);
    dv.setFloat32(48, knobs.heatRate, true);
    dv.setFloat32(52, knobs.coolRate, true);
    dv.setFloat32(56, knobs.diffusion, true);
    dv.setFloat32(60, LAMP.heaterY, true);
    dv.setFloat32(64, mouse[0], true);
    dv.setFloat32(68, mouse[1], true);
    dv.setFloat32(72, mouseVel[0], true);
    dv.setFloat32(76, mouseVel[1], true);
    dv.setFloat32(80, 0.16, true); // mouseRadius
    dv.setFloat32(84, 30.0, true); // mouseStrength
    dv.setFloat32(88, LAMP.wallBottom, true);
    dv.setFloat32(92, LAMP.wallTop, true);
    dv.setFloat32(96, LAMP.floorY, true);
    dv.setFloat32(100, LAMP.topY, true);
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

  // Buffer currently holding the freshest particle state.
  get current(): GPUBuffer {
    return this.bufs[this.cur];
  }

  // Both particle buffers, for callers that prebuild per-parity bind groups.
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
