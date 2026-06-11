// The final-form solver from the article: GPU-resident Barnes-Hut over an
// implicit quadtree pyramid. Single body buffer (force integrates in place),
// FINEST/DIM/FP_SCALE baked as pipeline-override constants.

import shader from "../shaders/pyramid.wgsl?raw";
import { TOTAL_MASS, G, type Bodies } from "./seed";

const WG = 256;
const SCALE_BUDGET = 3.6e9;

export function levelOffset(l: number): number {
  return ((1 << (2 * l)) - 1) / 3;
}

export function chooseFinestLevel(count: number): number {
  const l = Math.ceil(Math.log2(Math.max(count, 2)) / 2);
  return Math.min(10, Math.max(5, l));
}

export class PyramidSolver {
  readonly count: number;
  readonly finestLevel: number;
  readonly gridDim: number;
  readonly bodies: GPUBuffer;

  dt = 0.016;
  softening = 0.05;
  theta = 0.75;

  private dev: GPUDevice;
  private simParams: GPUBuffer;
  private grid: GPUBuffer;
  private nodes: GPUBuffer;
  private bounds: GPUBuffer;
  private mass: GPUBuffer;

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

  constructor(dev: GPUDevice, init: Bodies) {
    this.dev = dev;
    this.count = init.count;
    this.finestLevel = chooseFinestLevel(init.count);
    this.gridDim = 1 << this.finestLevel;
    const cells = this.gridDim * this.gridDim;
    const fpScale = SCALE_BUDGET / TOTAL_MASS;

    this.bodies = dev.createBuffer({
      size: init.count * 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    dev.queue.writeBuffer(this.bodies, 0, init.state as BufferSource);
    this.mass = dev.createBuffer({ size: init.count * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    dev.queue.writeBuffer(this.mass, 0, init.mass as BufferSource);

    this.simParams = dev.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.grid = dev.createBuffer({ size: cells * 16, usage: GPUBufferUsage.STORAGE });
    this.nodes = dev.createBuffer({ size: levelOffset(this.finestLevel + 1) * 16, usage: GPUBufferUsage.STORAGE });
    this.bounds = dev.createBuffer({ size: 16, usage: GPUBufferUsage.STORAGE });

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
    this.gBounds = grp(this.pBounds, [[0, this.simParams], [1, this.bodies], [6, this.bounds]]);
    this.gScatter = grp(this.pScatter, [
      [0, this.simParams], [1, this.bodies], [3, this.mass], [4, this.grid], [6, this.bounds],
    ]);
    this.gResolve = grp(this.pResolve, [[4, this.grid], [5, this.nodes], [6, this.bounds]]);
    for (let l = 0; l < this.finestLevel; l++) this.gReduce.push(grp(this.pReduce[l], [[5, this.nodes]]));
    this.gForce = grp(this.pForce, [
      [0, this.simParams], [1, this.bodies], [3, this.mass], [5, this.nodes], [6, this.bounds],
    ]);
  }

  writeParams(): void {
    const buf = new ArrayBuffer(32);
    const dv = new DataView(buf);
    dv.setUint32(0, this.count, true);
    dv.setFloat32(4, this.dt, true);
    dv.setFloat32(8, G, true);
    dv.setFloat32(12, this.softening, true);
    dv.setFloat32(16, this.theta, true);
    dv.setFloat32(20, 1.0, true);   // damping (off)
    dv.setFloat32(24, 10.0, true);  // maxSpeed (effectively off)
    this.dev.queue.writeBuffer(this.simParams, 0, buf);
  }

  // One substep: ~15 dispatches in dispatch order inside the caller's pass.
  encode(pass: GPUComputePassEncoder): void {
    const cells = this.gridDim * this.gridDim;
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
      pass.dispatchWorkgroups(Math.max(1, Math.ceil((1 << (2 * l)) / WG)));
    }
    pass.setPipeline(this.pForce);
    pass.setBindGroup(0, this.gForce);
    pass.dispatchWorkgroups(bodyWGs);
  }

  dispose(): void {
    for (const b of [this.bodies, this.mass, this.simParams, this.grid, this.nodes, this.bounds]) b.destroy();
  }
}
