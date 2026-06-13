// The crown: part one's renderer (splat field → marching squares → glossy
// fill) driven by the part-two sim, where the fluid magnetizes itself.
// New teaching view: every particle's magnetic moment drawn as an arrow.

import renderShader from "../../shaders/ferrorender.wgsl?raw";
import { Shell, gpuMissing, type Demo } from "../../lib/demoShell";
import { getDevice, configureContext } from "../../lib/gpu";
import { Ferro2Sim, FERRO2_KNOBS, H, type Ferro2Knobs } from "../../lib/ferroSim2";

const VIEW_NAMES = ["final", "mesh only", "field + contour", "particles", "moments"];
const MAX_SEGS = 65536;

export interface CrownOptions {
  hero?: boolean;
  full?: boolean; // sliders + view cycling
  view?: number; // starting debug view
  duel?: boolean; // force-model toggle only
}

export async function mountCrown(container: HTMLElement, opts: CrownOptions): Promise<Demo> {
  const dev = await getDevice();
  const shell = new Shell(container, opts.hero ? 0.5 : 0.62);
  if (!dev) return gpuMissing(container);
  const ctx = configureContext(shell.canvas, dev);
  const canvasFormat = navigator.gpu.getPreferredCanvasFormat();

  const W = shell.canvas.width;
  const Hpx = shell.canvas.height;
  const aspect = W / Hpx;
  const viewScaleY = 1.04;
  const viewScale: [number, number] = [viewScaleY / aspect, viewScaleY];

  const fieldW = Math.floor(W / 2);
  const fieldH = Math.floor(Hpx / 2);

  const knobs: Ferro2Knobs = { ...FERRO2_KNOBS };
  const count = opts.hero ? 16000 : opts.view === 4 ? 12000 : 16000;
  let view = opts.view ?? 0;
  let time = 0;
  let segsDrawn = 0;

  const sim = new Ferro2Sim(dev, count);

  // ---- pipelines (part one's, plus arrows) -----------------------------------------
  const module = dev.createShaderModule({ code: renderShader });
  const fieldTex = dev.createTexture({
    size: [fieldW, fieldH],
    format: "rgba16float",
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
  const fieldView = fieldTex.createView();
  const linSamp = dev.createSampler({ magFilter: "linear", minFilter: "linear" });
  const rp = dev.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

  const segBuf = dev.createBuffer({ size: MAX_SEGS * 16, usage: GPUBufferUsage.STORAGE });
  const segCount = dev.createBuffer({
    size: 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });
  const indirectBuf = dev.createBuffer({ size: 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT });
  const segStaging = dev.createBuffer({ size: 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  let stagingBusy = false;

  const alphaBlend: GPUBlendState = {
    color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
    alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
  };
  const splatPipe = dev.createRenderPipeline({
    layout: "auto",
    vertex: { module, entryPoint: "vsSplat" },
    fragment: {
      module,
      entryPoint: "fsSplat",
      targets: [{
        format: "rgba16float",
        blend: {
          color: { srcFactor: "one", dstFactor: "one", operation: "add" },
          alpha: { srcFactor: "one", dstFactor: "one", operation: "add" },
        },
      }],
    },
    primitive: { topology: "triangle-list" },
  });
  const fillPipe = dev.createRenderPipeline({
    layout: "auto",
    vertex: { module, entryPoint: "vsFull" },
    fragment: { module, entryPoint: "fsFill", targets: [{ format: canvasFormat }] },
    primitive: { topology: "triangle-list" },
  });
  const segPipe = dev.createRenderPipeline({
    layout: "auto",
    vertex: { module, entryPoint: "vsSegs" },
    fragment: { module, entryPoint: "fsSegs", targets: [{ format: canvasFormat, blend: alphaBlend }] },
    primitive: { topology: "triangle-list" },
  });
  const dotsPipe = dev.createRenderPipeline({
    layout: "auto",
    vertex: { module, entryPoint: "vsDots" },
    fragment: { module, entryPoint: "fsDots", targets: [{ format: canvasFormat, blend: alphaBlend }] },
    primitive: { topology: "triangle-list" },
  });
  const arrowPipe = dev.createRenderPipeline({
    layout: "auto",
    vertex: { module, entryPoint: "vsArrows" },
    fragment: { module, entryPoint: "fsArrows", targets: [{ format: canvasFormat, blend: alphaBlend }] },
    primitive: { topology: "triangle-list" },
  });
  const msPipe = dev.createComputePipeline({ layout: "auto", compute: { module, entryPoint: "msCells" } });
  const indPipe = dev.createComputePipeline({ layout: "auto", compute: { module, entryPoint: "msIndirect" } });

  // ---- bind groups -----------------------------------------------------------------
  let splatGroups: [GPUBindGroup, GPUBindGroup] = [null!, null!];
  let dotGroups: [GPUBindGroup, GPUBindGroup] = [null!, null!];
  let arrowGroups: [GPUBindGroup, GPUBindGroup] = [null!, null!];
  const particleGroups = (pipe: GPURenderPipeline): [GPUBindGroup, GPUBindGroup] =>
    sim.buffers.map((b) =>
      dev.createBindGroup({
        layout: pipe.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: rp } },
          { binding: 1, resource: { buffer: b } },
        ],
      }),
    ) as [GPUBindGroup, GPUBindGroup];
  const bindParticles = (): void => {
    splatGroups = particleGroups(splatPipe);
    dotGroups = particleGroups(dotsPipe);
    arrowGroups = particleGroups(arrowPipe);
  };
  bindParticles();

  const fillGroup = dev.createBindGroup({
    layout: fillPipe.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: rp } },
      { binding: 2, resource: fieldView },
      { binding: 3, resource: linSamp },
    ],
  });
  const msGroup = dev.createBindGroup({
    layout: msPipe.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: rp } },
      { binding: 2, resource: fieldView },
      { binding: 4, resource: { buffer: segBuf } },
      { binding: 5, resource: { buffer: segCount } },
    ],
  });
  const indGroup = dev.createBindGroup({
    layout: indPipe.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: rp } },
      { binding: 5, resource: { buffer: segCount } },
      { binding: 6, resource: { buffer: indirectBuf } },
    ],
  });
  const segGroup = dev.createBindGroup({
    layout: segPipe.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: rp } },
      { binding: 7, resource: { buffer: segBuf } },
    ],
  });

  // ---- the cursor magnet -------------------------------------------------------------
  let pointer: [number, number] | null = null;
  shell.canvas.addEventListener("pointermove", (e) => {
    const r = shell.canvas.getBoundingClientRect();
    const cx = ((e.clientX - r.left) / r.width) * 2 - 1;
    const cy = -(((e.clientY - r.top) / r.height) * 2 - 1);
    pointer = [cx / viewScale[0], cy / viewScale[1]];
  });
  shell.canvas.addEventListener("pointerleave", () => (pointer = null));

  const idleMagnet = (): [number, number] => [
    0.42 * Math.sin(time * 0.5),
    -0.05 + 0.28 * Math.sin(time * 0.77 + 1.3),
  ];

  // ---- controls ------------------------------------------------------------------------
  const modelName = (): string => (knobs.kelvin ? "Kelvin" : "current loop");
  if (opts.full) {
    shell.slider({
      label: "susceptibility χ",
      min: 0, max: 20, step: 0.5, value: knobs.chi,
      onInput: (v) => (knobs.chi = v),
    });
    shell.slider({
      label: "field strength",
      min: 0, max: 10, step: 0.1, value: knobs.hExt,
      onInput: (v) => (knobs.hExt = v),
    });
    shell.slider({
      label: "surface tension",
      min: 0, max: 8, step: 0.1, value: knobs.tension,
      onInput: (v) => (knobs.tension = v),
    });
  }
  if (opts.full || opts.duel) {
    shell.button(`force model: ${modelName()}`, function (this: void) {
      knobs.kelvin = !knobs.kelvin;
    });
    const modelBtn = shell.controls.querySelectorAll("button")[0];
    modelBtn?.addEventListener("click", () => (modelBtn.textContent = `force model: ${modelName()}`));
  }
  if (opts.full) {
    shell.button(`view: ${VIEW_NAMES[view]}`, function (this: void) {
      view = (view + 1) % VIEW_NAMES.length;
    });
    const viewBtn = shell.controls.querySelectorAll("button")[1];
    viewBtn?.addEventListener("click", () => (viewBtn.textContent = `view: ${VIEW_NAMES[view]}`));
    shell.button("re-pour", () => {
      sim.rebuild(count);
      bindParticles();
    });
  }
  shell.setInfo(() => {
    if (opts.hero) return `${count.toLocaleString()} particles, each one a magnet · uniform field, no cursor needed`;
    if (opts.duel) return `${modelName()} model · ${count.toLocaleString()} mutually magnetized particles`;
    if (view === 4) return `${count.toLocaleString()} moments · solved by warm-started relaxation, one iteration per frame`;
    return `${modelName()} · ${segsDrawn.toLocaleString()} segments · χ, field, and tension set the crown`;
  });

  const writeRP = (mag: [number, number], magOn: boolean): void => {
    const f = new Float32Array([
      viewScale[0], viewScale[1], fieldW, fieldH,
      H * 5.4, 1.05, 0.85, time,
      mag[0], mag[1], magOn ? 1 : 0, view === 4 ? 0 : view,
      H * 0.62, MAX_SEGS, 0.12, 2, // _pad = moment scale, arrow stride
    ]);
    dev.queue.writeBuffer(rp, 0, f);
  };

  // pre-warm with the field off so the pool arrives settled, not mid-eruption
  {
    sim.writeParams({ ...knobs, hExt: 0, magMoment: 0 }, 0.0016, [0, 5], false);
    for (let chunk = 0; chunk < 3; chunk++) {
      const enc = dev.createCommandEncoder();
      sim.encodeSteps(enc, 200, false);
      dev.queue.submit([enc.finish()]);
    }
  }

  return {
    frame() {
      shell.tick();
      time += 1 / 60;

      // hero: the uniform field breathes, so the crown grows and relaxes on
      // its own; the cursor adds a movable magnet on top in every demo
      const fieldGain = opts.hero ? 0.6 + 0.4 * Math.sin(time * 0.35 - 0.8) : 1.0;
      const mag = pointer ?? (opts.view === 4 ? idleMagnet() : [0, 5] as [number, number]);
      const magOn = pointer !== null || opts.view === 4;
      const frameKnobs: Ferro2Knobs = {
        ...knobs,
        hExt: knobs.hExt * fieldGain,
        magMoment: magOn ? (opts.view === 4 ? 40 : 30) : 0,
      };
      sim.writeParams(frameKnobs, 0.0016, mag, magOn);
      writeRP(mag, magOn);

      const enc = dev.createCommandEncoder();
      sim.encodeSteps(enc, 5);

      // splat particles into the field
      let pass = enc.beginRenderPass({
        colorAttachments: [{ view: fieldView, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "store" }],
      });
      pass.setPipeline(splatPipe);
      pass.setBindGroup(0, splatGroups[sim.currentIndex]);
      pass.draw(6, sim.count);
      pass.end();

      // marching squares: field → segments → indirect args
      enc.clearBuffer(segCount);
      const cpass = enc.beginComputePass();
      cpass.setPipeline(msPipe);
      cpass.setBindGroup(0, msGroup);
      cpass.dispatchWorkgroups(Math.ceil(fieldW / 8), Math.ceil(fieldH / 8));
      cpass.setPipeline(indPipe);
      cpass.setBindGroup(0, indGroup);
      cpass.dispatchWorkgroups(1);
      cpass.end();
      if (!stagingBusy) enc.copyBufferToBuffer(segCount, 0, segStaging, 0, 4);

      // composite to canvas
      pass = enc.beginRenderPass({
        colorAttachments: [{
          view: ctx.getCurrentTexture().createView(),
          clearValue: { r: 0.016, g: 0.018, b: 0.03, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        }],
      });
      if (view === 0 || view === 2 || view === 4) {
        pass.setPipeline(fillPipe);
        pass.setBindGroup(0, fillGroup);
        pass.draw(3);
      }
      if (view === 0 || view === 1) {
        pass.setPipeline(segPipe);
        pass.setBindGroup(0, segGroup);
        pass.drawIndirect(indirectBuf, 0);
      }
      if (view === 3) {
        pass.setPipeline(dotsPipe);
        pass.setBindGroup(0, dotGroups[sim.currentIndex]);
        pass.draw(6, sim.count);
      }
      if (view === 4) {
        pass.setPipeline(arrowPipe);
        pass.setBindGroup(0, arrowGroups[sim.currentIndex]);
        pass.draw(6, Math.floor(sim.count / 2));
      }
      pass.end();
      dev.queue.submit([enc.finish()]);

      if (!stagingBusy) {
        stagingBusy = true;
        segStaging.mapAsync(GPUMapMode.READ).then(() => {
          segsDrawn = Math.min(new Uint32Array(segStaging.getMappedRange())[0], MAX_SEGS);
          segStaging.unmap();
          stagingBusy = false;
        }).catch(() => (stagingBusy = false));
      }
    },
    dispose() {
      sim.dispose();
      fieldTex.destroy();
      rp.destroy();
      segBuf.destroy();
      segCount.destroy();
      indirectBuf.destroy();
      segStaging.destroy();
    },
  };
}
