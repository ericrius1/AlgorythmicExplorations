// Part five's GPU demos, three arrangements of one PM solver.
// mode "collapse": a cold blob in a periodic box, plain Newtonian time, a
//   mesh-size slider — force resolution made touchable.
// mode "web": Zel'dovich ripples in an expanding (Einstein-de Sitter) box,
//   with amplitude/tilt sliders and expansion toggleable.
// hero: the web, wide, a million-ish particles, no controls.

import { Shell, gpuMissing, type Demo } from "../../lib/demoShell";
import { getDevice, configureContext } from "../../lib/gpu";
import { PmSolver } from "../../lib/pmSolver";
import { seedZeldovich, edsCoefficients } from "../../lib/cosmoSeed";
import renderShader from "../../shaders/render5.wgsl?raw";

const A_INIT = 0.02; // z = 49

export interface CosmoDemoOptions {
  mode: "collapse" | "web";
  hero?: boolean;
}

// render5: box-space additive quads with periodic tiling.
class BoxRenderer {
  private dev: GPUDevice;
  private ctx: GPUCanvasContext;
  private pipeline: GPURenderPipeline;
  private params: GPUBuffer;
  private group: GPUBindGroup = null!;

  constructor(dev: GPUDevice, ctx: GPUCanvasContext) {
    this.dev = dev;
    this.ctx = ctx;
    const module = dev.createShaderModule({ code: renderShader });
    this.pipeline = dev.createRenderPipeline({
      layout: "auto",
      vertex: { module, entryPoint: "vs" },
      fragment: {
        module,
        entryPoint: "fs",
        targets: [
          {
            format: navigator.gpu.getPreferredCanvasFormat(),
            blend: {
              color: { srcFactor: "src-alpha", dstFactor: "one", operation: "add" },
              alpha: { srcFactor: "one", dstFactor: "one", operation: "add" },
            },
          },
        ],
      },
      primitive: { topology: "triangle-list" },
    });
    this.params = dev.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  }

  bind(parts: GPUBuffer): void {
    this.group = this.dev.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.params } },
        { binding: 1, resource: { buffer: parts } },
      ],
    });
  }

  encode(
    enc: GPUCommandEncoder,
    count: number,
    opts: { scale?: number; size?: number; colorScale?: number; tiles?: number; load?: boolean } = {},
  ): void {
    const canvas = this.ctx.canvas as HTMLCanvasElement;
    const tiles = opts.tiles ?? 1;
    const dv = new DataView(new ArrayBuffer(32));
    dv.setFloat32(0, opts.scale ?? 1.0, true);
    dv.setFloat32(4, canvas.width / canvas.height, true);
    dv.setFloat32(8, opts.size ?? 0.0022, true);
    dv.setFloat32(12, opts.colorScale ?? 2.0, true);
    dv.setUint32(16, tiles, true);
    dv.setUint32(20, count, true);
    this.dev.queue.writeBuffer(this.params, 0, dv.buffer);
    const pass = enc.beginRenderPass({
      colorAttachments: [
        {
          view: this.ctx.getCurrentTexture().createView(),
          clearValue: { r: 0.024, g: 0.027, b: 0.043, a: 1 },
          loadOp: opts.load ? "load" : "clear",
          storeOp: "store",
        },
      ],
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.group);
    pass.draw(6, count * tiles);
    pass.end();
  }
}

export { BoxRenderer };

// Cold uniform disc in the middle of the box — the part-four ghost cloud,
// reborn in a periodic world.
function seedBlob(count: number): Float32Array {
  const state = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const r = 0.17 * Math.sqrt(Math.random());
    const a = Math.random() * Math.PI * 2;
    state[i * 4] = 0.5 + Math.cos(a) * r;
    state[i * 4 + 1] = 0.5 + Math.sin(a) * r;
  }
  return state;
}

export async function mountCosmo(container: HTMLElement, opts: CosmoDemoOptions): Promise<Demo> {
  const dev = await getDevice();
  const shell = new Shell(container, opts.hero ? 0.5 : 0.66);
  if (!dev) return gpuMissing(container);
  const ctx = configureContext(shell.canvas, dev);
  const renderer = new BoxRenderer(dev, ctx);
  const web = opts.mode === "web";

  let mesh = web ? 512 : 256;
  let lattice = opts.hero ? 768 : web ? 512 : 256;
  let amplitude = 0.03;
  let tilt = 1.0;
  let expanding = web;
  let a = A_INIT;
  let frozenSince = 0; // hero: ms timestamp when a reached 1 (today)
  let solver = new PmSolver(dev, mesh);
  let buf: GPUBuffer = null!;
  let count = 0;

  const reseed = (): void => {
    buf?.destroy();
    if (web) {
      const ic = seedZeldovich({ lattice, aInit: A_INIT, amplitude, tilt });
      count = ic.count;
      buf = dev.createBuffer({ size: count * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      dev.queue.writeBuffer(buf, 0, ic.state as BufferSource);
    } else {
      count = lattice * lattice;
      buf = dev.createBuffer({ size: count * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      dev.queue.writeBuffer(buf, 0, seedBlob(count) as BufferSource);
    }
    solver.setParticles(buf);
    a = A_INIT;
    frozenSince = 0;
  };
  const remesh = (dim: number): void => {
    mesh = dim;
    solver.dispose();
    solver = new PmSolver(dev, mesh);
    solver.setParticles(buf);
  };
  reseed();

  // Cursor stirring, in box units.
  const aspect = shell.canvas.width / shell.canvas.height;
  let mouse: [number, number] = [99, 99];
  let mouseVel: [number, number] = [0, 0];
  let lastMove = 0;
  shell.canvas.addEventListener("pointermove", (e) => {
    const r = shell.canvas.getBoundingClientRect();
    const cx = ((e.clientX - r.left) / r.width) * 2 - 1;
    const cy = -(((e.clientY - r.top) / r.height) * 2 - 1);
    const wx = (cx * aspect) / 2 + 0.5;
    const wy = cy / 2 + 0.5;
    const now = performance.now();
    const dtm = Math.min((now - lastMove) / 1000, 0.1) || 0.016;
    lastMove = now;
    if (mouse[0] < 90) {
      const vx = (wx - mouse[0]) / dtm;
      const vy = (wy - mouse[1]) / dtm;
      const mag = Math.hypot(vx, vy);
      const clamp = mag > 2 ? 2 / mag : 1;
      mouseVel = [mouseVel[0] * 0.6 + vx * clamp * 0.4, mouseVel[1] * 0.6 + vy * clamp * 0.4];
    }
    mouse = [wx, wy];
  });
  shell.canvas.addEventListener("pointerleave", () => {
    mouse = [99, 99];
    mouseVel = [0, 0];
  });

  if (!opts.hero) {
    if (web) {
      shell.slider({
        label: "particles",
        min: 256 * 256,
        max: 1024 * 1024,
        step: 1,
        value: lattice * lattice,
        log: true,
        format: (v) => (Math.round(Math.sqrt(v)) ** 2).toLocaleString(),
        onInput: (v) => {
          lattice = Math.min(1024, Math.max(256, Math.round(Math.sqrt(v))));
          reseed();
        },
      });
      shell.slider({
        label: "ripple strength",
        min: 0.015,
        max: 0.1,
        step: 0.001,
        value: amplitude,
        format: (v) => v.toFixed(3),
        onInput: (v) => {
          amplitude = v;
          reseed();
        },
      });
      shell.slider({
        label: "tilt n",
        min: -1,
        max: 3,
        step: 0.1,
        value: tilt,
        format: (v) => v.toFixed(1),
        onInput: (v) => {
          tilt = v;
          reseed();
        },
      });
      shell.button("expansion on/off", () => (expanding = !expanding));
      shell.button("big bang again", reseed);
    } else {
      shell.slider({
        label: "mesh",
        min: 6,
        max: 9,
        step: 1,
        value: Math.log2(mesh),
        format: (v) => `${1 << v}×${1 << v}`,
        onInput: (v) => remesh(1 << v),
      });
      shell.button("re-seed", reseed);
    }
  }

  shell.setInfo(() => {
    if (!web) return `${count.toLocaleString()} particles · ${mesh}×${mesh} mesh · 4 FFTs per step`;
    const z = Math.max(1 / a - 1, 0);
    const when = !expanding
      ? "expansion off"
      : a >= 1
        ? "a = 1.00 · z = 0 — today"
        : `a = ${a.toFixed(2)} · z = ${z.toFixed(1)}`;
    return `${count.toLocaleString()} particles · ${mesh}×${mesh} mesh · ${when}${opts.hero ? " · stir the universe" : ""}`;
  });

  return {
    frame() {
      shell.tick();
      const enc = dev.createCommandEncoder();
      const steps = 2;
      // The collapse loops: cold blob, infall, shatter, again.
      if (!web && performance.now() - (frozenSince || (frozenSince = performance.now())) > 14000) {
        reseed();
        frozenSince = performance.now();
      }
      // The expanding runs stop at a = 1 — today. The hero lingers there a
      // few seconds, then bangs again.
      if (web && expanding && a >= 1) {
        if (!frozenSince) frozenSince = performance.now();
        if (opts.hero && performance.now() - frozenSince > 12000) {
          reseed();
          frozenSince = 0;
        }
      }
      for (let s = 0; s < steps; s++) {
        let kick: number;
        let drift: number;
        if (web && expanding) {
          // Past a = 1 the clock stops but the physics keeps running at
          // "today" — the web goes on churning (and stays stirrable).
          const c = edsCoefficients(Math.min(a, 1), 0.004, mesh, count);
          kick = c.kick;
          drift = c.drift;
          if (a < 1) a = c.aNext;
        } else if (web) {
          // frozen comoving box: Newtonian, gentle clock
          const dt = 0.004;
          kick = ((dt * 1.5 * mesh * mesh) / count) * (1 / (4 * Math.PI * Math.PI));
          drift = dt;
        } else {
          const dt = 0.012;
          kick = ((dt * 4.0 * mesh * mesh) / count) * (1 / (4 * Math.PI * Math.PI));
          drift = dt;
        }
        solver.writeParams({
          count,
          kick,
          drift,
          smooth: 1.0,
          mouseRadius: 0.06,
          mouseStrength: 0.02,
          mouse,
          mouseVel,
        });
        solver.encode(enc, count);
      }
      renderer.bind(buf);
      renderer.encode(enc, count, {
        scale: web ? 1.0 : 0.45,
        size: opts.hero ? 0.0026 : 0.0032,
        colorScale: web ? 14 : 30,
        tiles: web ? 3 : 9,
      });
      dev.queue.submit([enc.finish()]);
    },
    dispose() {
      solver.dispose();
      buf?.destroy();
    },
  };
}
