// Demo 3 of part five: paint mass, watch the whole box's potential update
// the same frame — four FFTs and one division per pixel of paint. A swarm
// of weightless tracer particles falls through the painted field so the
// contour map is something you can feel.

import { Shell, gpuMissing, type Demo } from "../../lib/demoShell";
import { getDevice, configureContext } from "../../lib/gpu";
import { PmSolver } from "../../lib/pmSolver";
import { BoxRenderer } from "./cosmoGpu";
import fieldShader from "../../shaders/field.wgsl?raw";

const DIM = 256;
const TRACERS = 50000;

function seedTracers(): Float32Array {
  const state = new Float32Array(TRACERS * 4);
  for (let i = 0; i < TRACERS; i++) {
    state[i * 4] = Math.random();
    state[i * 4 + 1] = Math.random();
  }
  return state;
}

export async function mountPoissonPaint(container: HTMLElement): Promise<Demo> {
  const dev = await getDevice();
  const shell = new Shell(container, 0.62);
  if (!dev) return gpuMissing(container);
  const ctx = configureContext(shell.canvas, dev);
  const solver = new PmSolver(dev, DIM);

  const buf = dev.createBuffer({
    size: TRACERS * 16,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const reseed = (): void => {
    dev.queue.writeBuffer(buf, 0, seedTracers() as BufferSource);
  };
  reseed();
  solver.setParticles(buf);

  // field colormap underneath, tracers on top
  const fieldModule = dev.createShaderModule({ code: fieldShader });
  const fieldPipeline = dev.createRenderPipeline({
    layout: "auto",
    vertex: { module: fieldModule, entryPoint: "vs" },
    fragment: {
      module: fieldModule,
      entryPoint: "fs",
      targets: [{ format: navigator.gpu.getPreferredCanvasFormat() }],
    },
    primitive: { topology: "triangle-list" },
  });
  const fieldParams = dev.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const dv = new DataView(new ArrayBuffer(16));
  dv.setUint32(0, DIM, true);
  dv.setFloat32(4, shell.canvas.width / shell.canvas.height, true);
  dv.setFloat32(8, 12, true); // contour count
  dev.queue.writeBuffer(fieldParams, 0, dv.buffer);
  const fieldGroup = dev.createBindGroup({
    layout: fieldPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: fieldParams } },
      { binding: 1, resource: { buffer: solver.spec } },
      { binding: 2, resource: { buffer: solver.paint } },
      { binding: 3, resource: { buffer: solver.stat } },
    ],
  });

  const renderer = new BoxRenderer(dev, ctx);
  renderer.bind(buf);

  // painting: pointer position in box units; the canvas shows the box
  // stretched to fill, so the map is direct
  let pointer: [number, number] | null = null;
  let down = false;
  let erase = false;
  const boxAspect = shell.canvas.width / shell.canvas.height;
  const toBox = (e: PointerEvent): [number, number] => {
    const r = shell.canvas.getBoundingClientRect();
    const x = 0.5 + ((e.clientX - r.left) / r.width - 0.5) * boxAspect;
    return [x - Math.floor(x), 1 - (e.clientY - r.top) / r.height];
  };
  shell.canvas.addEventListener("pointerdown", (e) => {
    down = true;
    erase = e.button === 2 || e.shiftKey;
    pointer = toBox(e);
    shell.canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  shell.canvas.addEventListener("pointermove", (e) => (pointer = toBox(e)));
  shell.canvas.addEventListener("pointerup", () => (down = false));
  shell.canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  let brush = 0.035;
  shell.slider({
    label: "brush",
    min: 0.015,
    max: 0.09,
    step: 0.005,
    value: brush,
    format: (v) => v.toFixed(3),
    onInput: (v) => (brush = v),
  });
  shell.button("clear mass", () => {
    dev.queue.writeBuffer(solver.paint, 0, new Float32Array(DIM * DIM) as BufferSource);
    reseed();
  });
  shell.button("re-scatter tracers", reseed);
  shell.setInfo(
    () => `${DIM}×${DIM} mesh · 4 FFTs + 1 divide per frame · drag to paint mass (shift-drag erases)`,
  );

  return {
    frame() {
      shell.tick();
      const enc = dev.createCommandEncoder();
      if (down && pointer) solver.encodeSplat(enc, pointer, brush, erase ? -0.6 : 0.25);
      solver.writeParams({
        count: TRACERS,
        painted: true,
        kick: 0.000045 * DIM * DIM * (1 / (4 * Math.PI * Math.PI)),
        drift: 0.005,
        damp: 0.985, // tracers shed energy so they settle into the wells
        smooth: 1.5,
      });
      solver.encode(enc, TRACERS, true);

      const pass = enc.beginRenderPass({
        colorAttachments: [
          {
            view: ctx.getCurrentTexture().createView(),
            clearValue: { r: 0.024, g: 0.027, b: 0.043, a: 1 },
            loadOp: "clear",
            storeOp: "store",
          },
        ],
      });
      pass.setPipeline(fieldPipeline);
      pass.setBindGroup(0, fieldGroup);
      pass.draw(3);
      pass.end();

      renderer.encode(enc, TRACERS, { scale: 1.0, size: 0.0028, colorScale: 12, tiles: 3, load: true });
      dev.queue.submit([enc.finish()]);
    },
    dispose() {
      solver.dispose();
      buf.destroy();
      fieldParams.destroy();
    },
  };
}
