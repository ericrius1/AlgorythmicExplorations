// 3D octree-pyramid solver. Identical architecture to part one's 2D solver;
// every "4" became an "8" and the dome constraint rides in two uniforms.

import shader from "../shaders/pyramid3d.wgsl?raw";
import { TOTAL_MASS, G } from "./seed";
import type { Bodies3D } from "./seed3d";

const WG = 256;
const SCALE_BUDGET = 3.6e9;

export function levelOffset3D(l: number): number {
  return (Math.pow(8, l) - 1) / 7;
}

// Memory is the 3D tax: level F costs 8^F cells. 7 (128³) is ~34 MB of
// accumulators — about the ceiling for a casual browser demo.
export function chooseFinestLevel3D(count: number): number {
  const l = Math.ceil(Math.log2(Math.max(count, 2)) / 3);
  return Math.min(7, Math.max(4, l));
}

export class Pyramid3DSolver {
  readonly count: number;
  readonly finestLevel: number;
  readonly gridDim: number;
  readonly pos: GPUBuffer;
  readonly vel: GPUBuffer;

  dt = 0.016;
  gScale = 1.0; // multiplier on G — the hero runs cooler so it never fully collapses
  softening = 0.05;
  theta = 0.8;
  damping = 1.0;
  shellR = 0.9;
  shellK = 0; // 0 = free 3D gravity; > 0 = dome constraint

  private dev: GPUDevice;
  private simParams: GPUBuffer;
  private grid: GPUBuffer;
  private nodes: GPUBuffer;
  private bounds: GPUBuffer;

  private pClear: GPUComputePipeline;
  private pBounds: GPUComputePipeline;
  private pScatter: GPUComputePipeline;
  private pResolve: GPUComputePipeline;
  private pReduce: GPUComputePipeline[] = [];
  private pForce: GPUComputePipeline;

  private gClear: GPUBindGroup;
  private gBounds: GPUBindGroup;
  private gScatter: GPUBindGroup;
  private gResolve: GPUBindGroup;
  private gReduce: GPUBindGroup[] = [];
  private gForce: GPUBindGroup;

  constructor(dev: GPUDevice, init: Bodies3D) {
    this.dev = dev;
    this.count = init.count;
    this.finestLevel = chooseFinestLevel3D(init.count);
    this.gridDim = 1 << this.finestLevel;
    const cells = this.gridDim ** 3;
    const fpScale = SCALE_BUDGET / TOTAL_MASS;

    const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
    this.pos = dev.createBuffer({ size: init.count * 16, usage });
    this.vel = dev.createBuffer({ size: init.count * 16, usage });
    dev.queue.writeBuffer(this.pos, 0, init.pos as BufferSource);
    dev.queue.writeBuffer(this.vel, 0, init.vel as BufferSource);

    this.simParams = dev.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.grid = dev.createBuffer({ size: cells * 16, usage: GPUBufferUsage.STORAGE });
    this.nodes = dev.createBuffer({ size: levelOffset3D(this.finestLevel + 1) * 16, usage: GPUBufferUsage.STORAGE });
    this.bounds = dev.createBuffer({ size: 32, usage: GPUBufferUsage.STORAGE });

    const module = dev.createShaderModule({ code: shader });
    const mk = (entryPoint: string, constants: Record<string, number>): GPUComputePipeline =>
      dev.createComputePipeline({ layout: "auto", compute: { module, entryPoint, constants } });
    const c = { FINEST: this.finestLevel, DIM: this.gridDim, FP_SCALE: fpScale };
    this.pClear = mk("clear_grid", { DIM: this.gridDim });
    this.pBounds = mk("reduce_bounds", {});
    this.pScatter = mk("scatter", { DIM: this.gridDim, FP_SCALE: fpScale });
    this.pResolve = mk("resolve", c);
    this.pForce = mk("force", c);
    for (let l = 0; l < this.finestLevel; l++) this.pReduce.push(mk("reduce", { LEVEL: l }));

    const grp = (pipe: GPUComputePipeline, bindings: [number, GPUBuffer][]): GPUBindGroup =>
      dev.createBindGroup({
        layout: pipe.getBindGroupLayout(0),
        entries: bindings.map(([binding, buffer]) => ({ binding, resource: { buffer } })),
      });
    this.gClear = grp(this.pClear, [[4, this.grid], [6, this.bounds]]);
    this.gBounds = grp(this.pBounds, [[0, this.simParams], [1, this.pos], [6, this.bounds]]);
    this.gScatter = grp(this.pScatter, [[0, this.simParams], [1, this.pos], [4, this.grid], [6, this.bounds]]);
    this.gResolve = grp(this.pResolve, [[4, this.grid], [5, this.nodes], [6, this.bounds]]);
    for (let l = 0; l < this.finestLevel; l++) this.gReduce.push(grp(this.pReduce[l], [[5, this.nodes]]));
    this.gForce = grp(this.pForce, [
      [0, this.simParams], [1, this.pos], [2, this.vel], [5, this.nodes], [6, this.bounds],
    ]);
  }

  writeParams(): void {
    const buf = new ArrayBuffer(32);
    const dv = new DataView(buf);
    dv.setUint32(0, this.count, true);
    dv.setFloat32(4, this.dt, true);
    dv.setFloat32(8, G * this.gScale, true);
    dv.setFloat32(12, this.softening, true);
    dv.setFloat32(16, this.theta, true);
    dv.setFloat32(20, this.damping, true);
    dv.setFloat32(24, this.shellR, true);
    dv.setFloat32(28, this.shellK, true);
    this.dev.queue.writeBuffer(this.simParams, 0, buf);
  }

  encode(pass: GPUComputePassEncoder): void {
    const cells = this.gridDim ** 3;
    const bodyWGs = Math.ceil(this.count / WG);
    pass.setPipeline(this.pClear);
    pass.setBindGroup(0, this.gClear);
    pass.dispatchWorkgroups(Math.ceil((cells * 4) / WG));
    pass.setPipeline(this.pBounds);
    pass.setBindGroup(0, this.gBounds);
    pass.dispatchWorkgroups(bodyWGs);
    pass.setPipeline(this.pScatter);
    pass.setBindGroup(0, this.gScatter);
    pass.dispatchWorkgroups(bodyWGs);
    pass.setPipeline(this.pResolve);
    pass.setBindGroup(0, this.gResolve);
    pass.dispatchWorkgroups(Math.ceil(cells / WG));
    for (let l = this.finestLevel - 1; l >= 0; l--) {
      pass.setPipeline(this.pReduce[l]);
      pass.setBindGroup(0, this.gReduce[l]);
      pass.dispatchWorkgroups(Math.max(1, Math.ceil(8 ** l / WG)));
    }
    pass.setPipeline(this.pForce);
    pass.setBindGroup(0, this.gForce);
    pass.dispatchWorkgroups(bodyWGs);
  }

  dispose(): void {
    for (const b of [this.pos, this.vel, this.simParams, this.grid, this.nodes, this.bounds]) b.destroy();
  }
}
