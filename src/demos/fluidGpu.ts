// Demos 4 & 5 of part three: the full GPU pipeline — counting sort, then
// neighbour forces. mode "grains" runs one contact pass (dry sand); mode
// "sph" runs density + pressure passes (water). Cursor stirs either one.

import sphShader from "../shaders/sph.wgsl?raw";
import grainsShader from "../shaders/grains.wgsl?raw";
import { Shell, gpuMissing, type Demo } from "../lib/demoShell";
import { getDevice, configureContext } from "../lib/gpu";
import { ParticleRenderer } from "../lib/particleRenderer";
import { GridSort, GRID, CELLS } from "../lib/gridSort";

const WG = 256;
const H = 2 / GRID; // kernel radius = one grid cell

export interface FluidDemoOptions {
  mode: "sph" | "grains";
  count?: number;
  steps?: number;
  hero?: boolean;
}

// Dam-break block of fluid particles at h/2 spacing, resting on the floor.
function seedDam(count: number, floorY: number): Float32Array {
  const s = H * 0.5;
  const cols = Math.floor(1.3 / s);
  const state = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    state[i * 4] = -0.93 + col * s + (Math.random() - 0.5) * s * 0.4;
    state[i * 4 + 1] = floorY + s * (row + 0.7) + (Math.random() - 0.5) * s * 0.4;
  }
  return state;
}

// Loose rain of grains filling the upper half of the box.
function seedRain(count: number, floorY: number): Float32Array {
  const state = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    state[i * 4] = (Math.random() * 2 - 1) * 0.9;
    state[i * 4 + 1] = floorY + 0.25 + Math.random() * (0.9 - floorY - 0.27);
  }
  return state;
}

export async function mountFluid(container: HTMLElement, opts: FluidDemoOptions): Promise<Demo> {
  const dev = await getDevice();
  const shell = new Shell(container, opts.hero ? 0.5 : 0.62);
  if (!dev) return gpuMissing(container);
  const ctx = configureContext(shell.canvas, dev);
  const renderer = new ParticleRenderer(dev, ctx);
  const sort = new GridSort(dev);
  const sph = opts.mode === "sph";

  // Fit the box to the canvas: walls at x = ±0.95 always fill the width;
  // the floor sits at the bottom of the visible window.
  const aspect = shell.canvas.width / shell.canvas.height;
  const renderScale = 1.03 * aspect;
  const floorY = -0.95 / renderScale;

  const params = dev.createBuffer({ size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const layout = dev.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
    ],
  });
  const pipeLayout = dev.createPipelineLayout({ bindGroupLayouts: [layout] });
  const module = dev.createShaderModule({ code: sph ? sphShader : grainsShader });
  const mkPipe = (entry: string): GPUComputePipeline =>
    dev.createComputePipeline({ layout: pipeLayout, compute: { module, entryPoint: entry } });
  const densityPipe = sph ? mkPipe("densityPass") : null;
  const forcePipe = mkPipe("forcePass");

  let count = opts.count ?? (sph ? 50000 : 12000);
  let steps = opts.steps ?? 5;
  let bufs: [GPUBuffer, GPUBuffer] = [null!, null!];
  let density: GPUBuffer = null!;
  let sortGroups: [GPUBindGroup, GPUBindGroup] = [null!, null!];
  let simGroups: [GPUBindGroup, GPUBindGroup] = [null!, null!];
  let cur = 0;

  const rebuild = (): void => {
    for (const b of bufs) b?.destroy();
    density?.destroy();
    const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
    bufs = [dev.createBuffer({ size: count * 16, usage }), dev.createBuffer({ size: count * 16, usage })];
    density = dev.createBuffer({ size: count * 8, usage: GPUBufferUsage.STORAGE });
    dev.queue.writeBuffer(bufs[0], 0, (sph ? seedDam : seedRain)(count, floorY) as BufferSource);
    sortGroups = [sort.bindGroup(bufs[0], bufs[1]), sort.bindGroup(bufs[1], bufs[0])];
    const mkSim = (sorted: GPUBuffer): GPUBindGroup =>
      dev.createBindGroup({
        layout,
        entries: [
          { binding: 0, resource: { buffer: params } },
          { binding: 1, resource: { buffer: sorted } },
          { binding: 2, resource: { buffer: sort.starts } },
          { binding: 3, resource: { buffer: sort.counts } },
          { binding: 4, resource: { buffer: density } },
        ],
      });
    simGroups = [mkSim(bufs[1]), mkSim(bufs[0])]; // sim runs on the sort's output
    cur = 0;
  };
  rebuild();

  // Cursor stirring: world-space position + velocity, smoothed.
  let mouse: [number, number] = [99, 99];
  let mouseVel: [number, number] = [0, 0];
  let lastMove = 0;
  shell.canvas.addEventListener("pointermove", (e) => {
    const r = shell.canvas.getBoundingClientRect();
    const cx = ((e.clientX - r.left) / r.width) * 2 - 1;
    const cy = -(((e.clientY - r.top) / r.height) * 2 - 1);
    const wx = (cx * aspect) / renderScale;
    const wy = cy / renderScale;
    const now = performance.now();
    const dtm = Math.min((now - lastMove) / 1000, 0.1) || 0.016;
    lastMove = now;
    if (mouse[0] < 90) {
      const vx = (wx - mouse[0]) / dtm;
      const vy = (wy - mouse[1]) / dtm;
      const mag = Math.hypot(vx, vy);
      const clamp = mag > 4 ? 4 / mag : 1;
      mouseVel = [mouseVel[0] * 0.6 + vx * clamp * 0.4, mouseVel[1] * 0.6 + vy * clamp * 0.4];
    }
    mouse = [wx, wy];
  });
  shell.canvas.addEventListener("pointerleave", () => {
    mouse = [99, 99];
    mouseVel = [0, 0];
  });

  if (!opts.hero) {
    shell.slider({
      label: "particles",
      min: sph ? 10000 : 2000,
      max: sph ? 80000 : 30000,
      step: 1000,
      value: count,
      log: true,
      format: (v) => Math.round(v).toLocaleString(),
      onInput: (v) => {
        count = Math.round(v);
        rebuild();
      },
    });
    shell.slider({
      label: "steps / frame",
      min: 1,
      max: 8,
      step: 1,
      value: steps,
      onInput: (v) => (steps = Math.round(v)),
    });
    shell.button("re-pour", rebuild);
  }
  shell.setInfo(() =>
    opts.hero
      ? `${count.toLocaleString()} particles of ${sph ? "water" : "sand"} — stir with your cursor`
      : `${count.toLocaleString()} particles · sorted into ${CELLS.toLocaleString()} cells ` +
        `${steps}× per frame · stir with your cursor`,
  );

  const writeParams = (): void => {
    const dv = new DataView(new ArrayBuffer(80));
    dv.setUint32(0, count, true);
    dv.setUint32(4, GRID, true);
    dv.setFloat32(8, H, true);
    dv.setFloat32(12, 0.0016, true); // dt
    if (sph) {
      dv.setFloat32(16, 3.0, true); // gravity
      dv.setFloat32(20, 60.0, true); // stiffness
      dv.setFloat32(24, 2.2, true); // rest density
      dv.setFloat32(28, 240.0, true); // near stiffness
      dv.setFloat32(32, 0.03, true); // xsph
    } else {
      dv.setFloat32(16, 3.0, true); // gravity
      dv.setFloat32(20, 4000.0, true); // contact stiffness
      dv.setFloat32(24, 50.0, true); // contact damping
    }
    dv.setFloat32(36, 2000.0, true); // wallK
    dv.setFloat32(40, 0.18, true); // mouse radius
    dv.setFloat32(44, 60.0, true); // mouse strength
    dv.setFloat32(48, mouse[0], true);
    dv.setFloat32(52, mouse[1], true);
    dv.setFloat32(56, mouseVel[0], true);
    dv.setFloat32(60, mouseVel[1], true);
    dv.setFloat32(64, 0.95, true); // wall.x
    dv.setFloat32(68, -floorY, true); // wall.y (floor)
    dev.queue.writeBuffer(params, 0, dv.buffer);
  };

  return {
    frame() {
      shell.tick();
      writeParams();
      sort.writeParams(count);
      const wgs = Math.ceil(count / WG);
      const enc = dev.createCommandEncoder();
      for (let s = 0; s < steps; s++) {
        sort.encode(enc, sortGroups[cur], count);
        const pass = enc.beginComputePass();
        pass.setBindGroup(0, simGroups[cur]);
        if (densityPipe) {
          pass.setPipeline(densityPipe);
          pass.dispatchWorkgroups(wgs);
        }
        pass.setPipeline(forcePipe);
        pass.dispatchWorkgroups(wgs);
        pass.end();
        cur = 1 - cur; // sim output becomes next sort's input
      }
      renderer.bind(bufs[cur]);
      renderer.encode(enc, count, {
        scale: renderScale,
        size: sph ? 0.0035 : 0.005,
        colorScale: 0.9,
      });
      dev.queue.submit([enc.finish()]);
    },
    dispose() {
      sort.dispose();
      for (const b of bufs) b?.destroy();
      density?.destroy();
      params.destroy();
    },
  };
}
