// Part four's solver: part one's mass pyramid and part three's hash grid,
// run back to back over the same particle buffer every substep.
//
//   sort     hash, count, scan, scatter          (part three's machinery)
//   pyramid  bounds, mass scatter, reduce ×8     (part one's machinery)
//   force    tree walk + 9 buckets + integrate   (one kernel, both answers)
//
// Every grain has mass 1, so the sort's permutation is invisible to gravity
// and no mass buffer exists. The pyramid is sized to the cloud (adaptive
// bounds); the hash cells are sized to the grain (one diameter).

import shader from "../shaders/accretion.wgsl?raw";
import { HashSort, type HashTableSize } from "./hashSort";

const WG = 256;
const FINEST = 8;
const DIM = 1 << FINEST; // 256
const FP_SCALE = 8192;

function levelOffset(l: number): number {
  return ((1 << (2 * l)) - 1) / 3;
}

export interface AccretionParams {
  count: number;
  gravity: boolean;
  contacts: boolean;
  dt: number;
  gGrain: number;
  softening: number;
  theta: number;
  cellSize: number;
  stiffness: number;
  damping: number;
  starGM: number;
  starSoft: number;
  confineR: number;
  confineK: number;
  mouseRadius: number;
  mouseStrength: number;
  maxSpeed: number;
  mouse: [number, number];
  mouseVel: [number, number];
}

export class AccretionSolver {
  readonly sort: HashSort;
  private dev: GPUDevice;
  private params: GPUBuffer;
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
  private gResolve: GPUBindGroup;
  private gReduce: GPUBindGroup[] = [];
  // Indexed by which ping-pong buffer the pass reads/writes.
  private gBounds: GPUBindGroup[] = [];
  private gScatter: GPUBindGroup[] = [];
  private gForce: GPUBindGroup[] = [];
  private gSort: GPUBindGroup[] = [];
  private gravity = true;
  private contacts = true;

  constructor(dev: GPUDevice, table: HashTableSize) {
    this.dev = dev;
    this.sort = new HashSort(dev, table);
    this.params = dev.createBuffer({
      size: 80,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.grid = dev.createBuffer({ size: DIM * DIM * 16, usage: GPUBufferUsage.STORAGE });
    this.nodes = dev.createBuffer({ size: levelOffset(FINEST + 1) * 16, usage: GPUBufferUsage.STORAGE });
    this.bounds = dev.createBuffer({ size: 16, usage: GPUBufferUsage.STORAGE });

    const module = dev.createShaderModule({ code: shader });
    const mk = (entryPoint: string, constants: Record<string, number> = {}): GPUComputePipeline =>
      dev.createComputePipeline({ layout: "auto", compute: { module, entryPoint, constants } });
    const c = { FINEST, DIM, FP_SCALE, TABLE: table };
    this.pClear = mk("clear_grid", { DIM });
    this.pBounds = mk("reduce_bounds");
    this.pScatter = mk("scatter_mass", { DIM, FP_SCALE });
    this.pResolve = mk("resolve", c);
    this.pForce = mk("force", c);
    for (let l = 0; l < FINEST; l++) this.pReduce.push(mk("reduce", { LEVEL: l }));

    const grp = (pipe: GPUComputePipeline, bindings: [number, GPUBuffer][]): GPUBindGroup =>
      dev.createBindGroup({
        layout: pipe.getBindGroupLayout(0),
        entries: bindings.map(([binding, buffer]) => ({ binding, resource: { buffer } })),
      });
    this.gClear = grp(this.pClear, [[4, this.grid], [6, this.bounds]]);
    this.gResolve = grp(this.pResolve, [[4, this.grid], [5, this.nodes], [6, this.bounds]]);
    for (let l = 0; l < FINEST; l++) this.gReduce.push(grp(this.pReduce[l], [[5, this.nodes]]));
  }

  // bufs ping-pong: sort reads bufs[i], writes bufs[1-i]; pyramid + force then
  // run on bufs[1-i] in place, which becomes the next substep's sort input.
  setBuffers(bufs: [GPUBuffer, GPUBuffer]): void {
    const grp = (pipe: GPUComputePipeline, bindings: [number, GPUBuffer][]): GPUBindGroup =>
      this.dev.createBindGroup({
        layout: pipe.getBindGroupLayout(0),
        entries: bindings.map(([binding, buffer]) => ({ binding, resource: { buffer } })),
      });
    this.gSort = [this.sort.bindGroup(bufs[0], bufs[1]), this.sort.bindGroup(bufs[1], bufs[0])];
    this.gBounds = [];
    this.gScatter = [];
    this.gForce = [];
    for (const b of bufs) {
      this.gBounds.push(grp(this.pBounds, [[0, this.params], [1, b], [6, this.bounds]]));
      this.gScatter.push(grp(this.pScatter, [[0, this.params], [1, b], [4, this.grid], [6, this.bounds]]));
      this.gForce.push(
        grp(this.pForce, [
          [0, this.params], [1, b],
          [2, this.sort.starts], [3, this.sort.counts],
          [5, this.nodes], [6, this.bounds],
        ]),
      );
    }
  }

  writeParams(p: AccretionParams): void {
    this.gravity = p.gravity;
    this.contacts = p.contacts;
    if (this.contacts) this.sort.writeParams(p.count, p.cellSize);
    const dv = new DataView(new ArrayBuffer(80));
    dv.setUint32(0, p.count, true);
    dv.setUint32(4, (p.gravity ? 1 : 0) | (p.contacts ? 2 : 0), true);
    dv.setFloat32(8, p.dt, true);
    dv.setFloat32(12, p.gGrain, true);
    dv.setFloat32(16, p.softening, true);
    dv.setFloat32(20, p.theta, true);
    dv.setFloat32(24, p.cellSize, true);
    dv.setFloat32(28, p.stiffness, true);
    dv.setFloat32(32, p.damping, true);
    dv.setFloat32(36, p.starGM, true);
    dv.setFloat32(40, p.starSoft, true);
    dv.setFloat32(44, p.confineR, true);
    dv.setFloat32(48, p.confineK, true);
    dv.setFloat32(52, p.mouseRadius, true);
    dv.setFloat32(56, p.mouseStrength, true);
    dv.setFloat32(60, p.maxSpeed, true);
    dv.setFloat32(64, p.mouse[0], true);
    dv.setFloat32(68, p.mouse[1], true);
    dv.setFloat32(72, p.mouseVel[0], true);
    dv.setFloat32(76, p.mouseVel[1], true);
    this.dev.queue.writeBuffer(this.params, 0, dv.buffer);
  }

  // One substep. `cur` is the buffer the sort reads; returns the buffer
  // index now holding the integrated state.
  encode(enc: GPUCommandEncoder, cur: number, count: number): number {
    const out = this.contacts ? 1 - cur : cur;
    if (this.contacts) this.sort.encode(enc, this.gSort[cur], count);

    const bodyWGs = Math.ceil(count / WG);
    const cells = DIM * DIM;
    const pass = enc.beginComputePass();
    if (this.gravity) {
      pass.setPipeline(this.pClear);
      pass.setBindGroup(0, this.gClear);
      pass.dispatchWorkgroups(Math.ceil((cells * 4) / WG));
      pass.setPipeline(this.pBounds);
      pass.setBindGroup(0, this.gBounds[out]);
      pass.dispatchWorkgroups(bodyWGs);
      pass.setPipeline(this.pScatter);
      pass.setBindGroup(0, this.gScatter[out]);
      pass.dispatchWorkgroups(bodyWGs);
      pass.setPipeline(this.pResolve);
      pass.setBindGroup(0, this.gResolve);
      pass.dispatchWorkgroups(Math.ceil(cells / WG));
      for (let l = FINEST - 1; l >= 0; l--) {
        pass.setPipeline(this.pReduce[l]);
        pass.setBindGroup(0, this.gReduce[l]);
        pass.dispatchWorkgroups(Math.max(1, Math.ceil((1 << (2 * l)) / WG)));
      }
    }
    pass.setPipeline(this.pForce);
    pass.setBindGroup(0, this.gForce[out]);
    pass.dispatchWorkgroups(bodyWGs);
    pass.end();
    return out;
  }

  dispose(): void {
    this.sort.dispose();
    for (const b of [this.params, this.grid, this.nodes, this.bounds]) b.destroy();
  }
}
