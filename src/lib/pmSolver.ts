// Part five's solver: particle-mesh gravity with an FFT Poisson solve.
//
//   deposit   CIC mass assignment onto a DIM×DIM mesh        (pm.wgsl)
//   solve     FFT rows+cols → ×(-1/k²) → inverse FFT          (fft.wgsl)
//   force     central-difference gradient mesh               (pm.wgsl)
//   gather    CIC interpolation + kick-drift integration     (pm.wgsl)
//
// kick/drift arrive precomputed: for the expanding-universe demos they carry
// the scale-factor terms (p = a²ẋ momenta), for plain collapses they are
// G·dt and dt. The painter mode swaps the deposited density for a hand-
// painted field and lets tracer particles fall through the same pipeline.

import fftShader from "../shaders/fft.wgsl?raw";
import pmShader from "../shaders/pm.wgsl?raw";

const WG = 256;

export interface PmStepParams {
  count: number;
  painted?: boolean;
  kick: number;
  drift: number;
  damp?: number;
  smooth?: number; // gaussian force-smoothing length, in mesh cells
  mouseRadius?: number;
  mouseStrength?: number;
  mouse?: [number, number];
  mouseVel?: [number, number];
}

export class PmSolver {
  readonly dim: number;
  readonly spec: GPUBuffer;
  readonly paint: GPUBuffer;
  readonly stat: GPUBuffer;
  private dev: GPUDevice;
  private params: GPUBuffer;
  private splatParams: GPUBuffer;
  private rho: GPUBuffer;
  private force: GPUBuffer;

  private pClear: GPUComputePipeline;
  private pDeposit: GPUComputePipeline;
  private pToSpec: GPUComputePipeline;
  private pGreen: GPUComputePipeline;
  private pGradient: GPUComputePipeline;
  private pGather: GPUComputePipeline;
  private pSplat: GPUComputePipeline;
  // FFT pipelines indexed [axis][inverse]
  private pFft: GPUComputePipeline[][];

  private gClear: GPUBindGroup;
  private gToSpec: GPUBindGroup;
  private gGreen: GPUBindGroup;
  private gGradient: GPUBindGroup;
  private gSplat: GPUBindGroup;
  private gFft: GPUBindGroup[][];
  private gDeposit: GPUBindGroup = null!;
  private gGather: GPUBindGroup = null!;

  constructor(dev: GPUDevice, dim: number) {
    if ((dim & (dim - 1)) !== 0) throw new Error("mesh size must be a power of two");
    this.dev = dev;
    this.dim = dim;
    const cells = dim * dim;

    this.params = dev.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.splatParams = dev.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const st = GPUBufferUsage.STORAGE;
    this.rho = dev.createBuffer({ size: cells * 4, usage: st });
    this.spec = dev.createBuffer({ size: cells * 8, usage: st | GPUBufferUsage.COPY_SRC });
    this.force = dev.createBuffer({ size: cells * 8, usage: st });
    this.paint = dev.createBuffer({ size: cells * 4, usage: st | GPUBufferUsage.COPY_DST });
    this.stat = dev.createBuffer({ size: 4, usage: st });

    const logn = Math.log2(dim);
    const fftCode = fftShader
      .replaceAll("__N__", String(dim))
      .replaceAll("__HALF__", String(dim / 2))
      .replaceAll("__LOGN__", String(logn));
    const fftModule = dev.createShaderModule({ code: fftCode });
    const pmModule = dev.createShaderModule({ code: pmShader });

    const mk = (entryPoint: string, constants: Record<string, number> = {}): GPUComputePipeline =>
      dev.createComputePipeline({ layout: "auto", compute: { module: pmModule, entryPoint, constants } });
    this.pClear = mk("clear_rho", { DIM: dim });
    this.pDeposit = mk("deposit", { DIM: dim });
    this.pToSpec = mk("to_spec", { DIM: dim });
    this.pGreen = mk("green", { DIM: dim });
    this.pGradient = mk("gradient", { DIM: dim });
    this.pGather = mk("gather", { DIM: dim });
    this.pSplat = mk("splat", { DIM: dim });
    this.pFft = [0, 1].map((axis) =>
      [0, 1].map((inv) =>
        dev.createComputePipeline({
          layout: "auto",
          compute: { module: fftModule, entryPoint: "fft", constants: { AXIS: axis, INV: inv } },
        }),
      ),
    );

    const grp = (pipe: GPUComputePipeline, bindings: [number, GPUBuffer][]): GPUBindGroup =>
      dev.createBindGroup({
        layout: pipe.getBindGroupLayout(0),
        entries: bindings.map(([binding, buffer]) => ({ binding, resource: { buffer } })),
      });
    this.gClear = grp(this.pClear, [[2, this.rho], [6, this.stat]]);
    this.gToSpec = grp(this.pToSpec, [[0, this.params], [2, this.rho], [3, this.spec], [5, this.paint], [6, this.stat]]);
    this.gGreen = grp(this.pGreen, [[0, this.params], [3, this.spec]]);
    this.gGradient = grp(this.pGradient, [[3, this.spec], [4, this.force], [6, this.stat]]);
    this.gSplat = grp(this.pSplat, [[7, this.splatParams], [5, this.paint]]);
    this.gFft = this.pFft.map((row) => row.map((pipe) => grp(pipe, [[0, this.spec]])));
  }

  setParticles(buf: GPUBuffer): void {
    const grp = (pipe: GPUComputePipeline, bindings: [number, GPUBuffer][]): GPUBindGroup =>
      this.dev.createBindGroup({
        layout: pipe.getBindGroupLayout(0),
        entries: bindings.map(([binding, buffer]) => ({ binding, resource: { buffer } })),
      });
    this.gDeposit = grp(this.pDeposit, [[0, this.params], [1, buf], [2, this.rho]]);
    this.gGather = grp(this.pGather, [[0, this.params], [1, buf], [4, this.force]]);
  }

  writeParams(p: PmStepParams): void {
    const dv = new DataView(new ArrayBuffer(48));
    dv.setUint32(0, p.count, true);
    dv.setUint32(4, p.painted ? 1 : 0, true);
    dv.setFloat32(8, p.kick, true);
    dv.setFloat32(12, p.drift, true);
    dv.setFloat32(16, p.damp ?? 1, true);
    // shader applies exp(-k²·kSmooth) with k in integer modes; convert a
    // smoothing length in cells to that unit: (2π·s/DIM)²
    const s = ((2 * Math.PI * (p.smooth ?? 1)) / this.dim) ** 2;
    dv.setFloat32(20, s, true);
    dv.setFloat32(24, p.mouseRadius ?? 0.05, true);
    dv.setFloat32(28, p.mouseStrength ?? 0, true);
    dv.setFloat32(32, p.mouse?.[0] ?? 99, true);
    dv.setFloat32(36, p.mouse?.[1] ?? 99, true);
    dv.setFloat32(40, p.mouseVel?.[0] ?? 0, true);
    dv.setFloat32(44, p.mouseVel?.[1] ?? 0, true);
    this.dev.queue.writeBuffer(this.params, 0, dv.buffer);
  }

  // Add (or erase, strength < 0) a gaussian blob of painted mass.
  encodeSplat(enc: GPUCommandEncoder, pos: [number, number], radius: number, strength: number): void {
    this.dev.queue.writeBuffer(this.splatParams, 0, new Float32Array([pos[0], pos[1], radius, strength]));
    const pass = enc.beginComputePass();
    pass.setPipeline(this.pSplat);
    pass.setBindGroup(0, this.gSplat);
    pass.dispatchWorkgroups(Math.ceil((this.dim * this.dim) / WG));
    pass.end();
  }

  // One substep: deposit (unless painted), solve, differentiate, integrate.
  encode(enc: GPUCommandEncoder, count: number, painted = false): void {
    const cellWGs = Math.ceil((this.dim * this.dim) / WG);
    const bodyWGs = Math.ceil(count / WG);
    const pass = enc.beginComputePass();
    if (!painted) {
      pass.setPipeline(this.pClear);
      pass.setBindGroup(0, this.gClear);
      pass.dispatchWorkgroups(cellWGs);
      pass.setPipeline(this.pDeposit);
      pass.setBindGroup(0, this.gDeposit);
      pass.dispatchWorkgroups(bodyWGs);
    }
    pass.setPipeline(this.pToSpec);
    pass.setBindGroup(0, this.gToSpec);
    pass.dispatchWorkgroups(cellWGs);
    for (const [axis, inv] of [[0, 0], [1, 0]] as const) {
      pass.setPipeline(this.pFft[axis][inv]);
      pass.setBindGroup(0, this.gFft[axis][inv]);
      pass.dispatchWorkgroups(this.dim);
    }
    pass.setPipeline(this.pGreen);
    pass.setBindGroup(0, this.gGreen);
    pass.dispatchWorkgroups(cellWGs);
    for (const [axis, inv] of [[0, 1], [1, 1]] as const) {
      pass.setPipeline(this.pFft[axis][inv]);
      pass.setBindGroup(0, this.gFft[axis][inv]);
      pass.dispatchWorkgroups(this.dim);
    }
    pass.setPipeline(this.pGradient);
    pass.setBindGroup(0, this.gGradient);
    pass.dispatchWorkgroups(cellWGs);
    pass.setPipeline(this.pGather);
    pass.setBindGroup(0, this.gGather);
    pass.dispatchWorkgroups(bodyWGs);
    pass.end();
  }

  dispose(): void {
    for (const b of [this.params, this.splatParams, this.rho, this.spec, this.force, this.paint, this.stat])
      b.destroy();
  }
}
