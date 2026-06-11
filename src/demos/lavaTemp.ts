// Step demo: the temperature field, naked. Same sim as the lamp, but every
// particle is drawn as a dot coloured by its own temperature — no metaballs,
// no light transport. The point is to watch heat enter at the coil, ride a
// plume up, and leak away near the top.

import renderShader from "../shaders/lavarender.wgsl?raw";
import { Shell, gpuMissing, type Demo } from "../lib/demoShell";
import { getDevice, configureContext } from "../lib/gpu";
import { LavaSim, LAMP, DEFAULT_KNOBS, H, type LavaKnobs } from "../lib/lavaSim";

export async function mountLavaTemp(container: HTMLElement): Promise<Demo> {
  const dev = await getDevice();
  const shell = new Shell(container, 0.62);
  if (!dev) return gpuMissing(container);
  const ctx = configureContext(shell.canvas, dev);

  const aspect = shell.canvas.width / shell.canvas.height;
  const viewScaleY = 1.12;
  const viewScale: [number, number] = [viewScaleY / aspect, viewScaleY];

  const knobs: LavaKnobs = { ...DEFAULT_KNOBS };
  const count = 12000;
  const sim = new LavaSim(dev, count);

  const module = dev.createShaderModule({ code: renderShader });
  const rp = dev.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const dotsPipe = dev.createRenderPipeline({
    layout: "auto",
    vertex: { module, entryPoint: "vsDots" },
    fragment: {
      module,
      entryPoint: "fsDots",
      targets: [{
        format: navigator.gpu.getPreferredCanvasFormat(),
        blend: {
          color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
          alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
        },
      }],
    },
    primitive: { topology: "triangle-list" },
  });

  const writeRP = (): void => {
    const f = new Float32Array([
      viewScale[0], viewScale[1], shell.canvas.width, shell.canvas.height,
      H * 2.6, 0.85, 0, 1,
      LAMP.wallBottom, LAMP.wallTop, LAMP.floorY, LAMP.topY,
      LAMP.heaterY, H * 0.75, 0, 0,
    ]);
    dev.queue.writeBuffer(rp, 0, f);
  };

  let mouse: [number, number] = [99, 99];
  let mouseVel: [number, number] = [0, 0];
  let lastMove = 0;
  shell.canvas.addEventListener("pointermove", (e) => {
    const r = shell.canvas.getBoundingClientRect();
    const cx = ((e.clientX - r.left) / r.width) * 2 - 1;
    const cy = -(((e.clientY - r.top) / r.height) * 2 - 1);
    const wx = cx / viewScale[0];
    const wy = cy / viewScale[1];
    const now = performance.now();
    const dtm = Math.min((now - lastMove) / 1000, 0.1) || 0.016;
    lastMove = now;
    if (mouse[0] < 90) {
      const vx = (wx - mouse[0]) / dtm;
      const vy = (wy - mouse[1]) / dtm;
      const mag = Math.hypot(vx, vy);
      const clampF = mag > 4 ? 4 / mag : 1;
      mouseVel = [mouseVel[0] * 0.6 + vx * clampF * 0.4, mouseVel[1] * 0.6 + vy * clampF * 0.4];
    }
    mouse = [wx, wy];
  });
  shell.canvas.addEventListener("pointerleave", () => {
    mouse = [99, 99];
    mouseVel = [0, 0];
  });

  shell.slider({
    label: "coil heat",
    min: 0, max: 6, step: 0.1, value: knobs.heatRate,
    onInput: (v) => (knobs.heatRate = v),
  });
  shell.slider({
    label: "buoyancy",
    min: 0, max: 10, step: 0.1, value: knobs.buoyancy,
    onInput: (v) => (knobs.buoyancy = v),
  });
  shell.slider({
    label: "thermal expansion β",
    min: 0, max: 0.6, step: 0.01, value: knobs.beta,
    onInput: (v) => (knobs.beta = v),
  });
  shell.slider({
    label: "cooling",
    min: 0.05, max: 1.5, step: 0.05, value: knobs.coolRate,
    onInput: (v) => (knobs.coolRate = v),
  });
  let dotGroups: [GPUBindGroup, GPUBindGroup] = [null!, null!];
  const bindDots = (): void => {
    dotGroups = sim.buffers.map((b) =>
      dev.createBindGroup({
        layout: dotsPipe.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: rp } },
          { binding: 1, resource: { buffer: b } },
        ],
      }),
    ) as [GPUBindGroup, GPUBindGroup];
  };
  bindDots();

  shell.button("re-melt", () => {
    sim.rebuild(count);
    bindDots();
  });
  shell.setInfo(() => `${count.toLocaleString()} particles · colour = temperature · stir with your cursor`);

  return {
    frame() {
      shell.tick();
      sim.writeParams(knobs, 0.0016, mouse, mouseVel);
      writeRP();
      const enc = dev.createCommandEncoder();
      sim.encodeSteps(enc, 4);
      const pass = enc.beginRenderPass({
        colorAttachments: [{
          view: ctx.getCurrentTexture().createView(),
          clearValue: { r: 0.024, g: 0.027, b: 0.043, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        }],
      });
      pass.setPipeline(dotsPipe);
      pass.setBindGroup(0, dotGroups[sim.currentIndex]);
      pass.draw(6, sim.count);
      pass.end();
      dev.queue.submit([enc.finish()]);
    },
    dispose() {
      sim.dispose();
      rp.destroy();
    },
  };
}
