// The ferrofluid: SPH with cohesion + a dipole magnet, splatted to a field,
// surfaced by GPU marching squares every frame. The cursor is the magnet;
// with nobody at the controls a phantom magnet rides a slow Lissajous path.

import renderShader from "../shaders/ferrorender.wgsl?raw";
import { Shell, gpuMissing, type Demo } from "../lib/demoShell";
import { getDevice, configureContext } from "../lib/gpu";
import { FerroSim, FERRO_KNOBS, H, type FerroKnobs } from "../lib/ferroSim";

const VIEW_NAMES = ["final", "mesh only", "field + contour", "particles"];
const MAX_SEGS = 65536;

export interface FerroOptions {
  hero?: boolean;
  full?: boolean; // sliders + view cycling
  view?: number; // starting debug view
}

export async function mountFerro(container: HTMLElement, opts: FerroOptions): Promise<Demo> {
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

  const knobs: FerroKnobs = { ...FERRO_KNOBS };
  const count = opts.hero ? 18000 : 22000;
  let view = opts.view ?? 0;
  let time = 0;
  let segsDrawn = 0;

  const sim = new FerroSim(dev, count);

  // ---- pipelines ---------------------------------------------------------------
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
    fragment: {
      module,
      entryPoint: "fsSegs",
      targets: [{
        format: canvasFormat,
        blend: {
          color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
          alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
        },
      }],
    },
    primitive: { topology: "triangle-list" },
  });
  const dotsPipe = dev.createRenderPipeline({
    layout: "auto",
    vertex: { module, entryPoint: "vsDots" },
    fragment: {
      module,
      entryPoint: "fsDots",
      targets: [{
        format: canvasFormat,
        blend: {
          color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
          alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
        },
      }],
    },
    primitive: { topology: "triangle-list" },
  });
  const msPipe = dev.createComputePipeline({ layout: "auto", compute: { module, entryPoint: "msCells" } });
  const indPipe = dev.createComputePipeline({ layout: "auto", compute: { module, entryPoint: "msIndirect" } });

  // ---- bind groups ---------------------------------------------------------------
  let splatGroups: [GPUBindGroup, GPUBindGroup] = [null!, null!];
  let dotGroups: [GPUBindGroup, GPUBindGroup] = [null!, null!];
  const bindParticles = (): void => {
    splatGroups = sim.buffers.map((b) =>
      dev.createBindGroup({
        layout: splatPipe.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: rp } },
          { binding: 1, resource: { buffer: b } },
        ],
      }),
    ) as [GPUBindGroup, GPUBindGroup];
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

  // ---- the magnet ------------------------------------------------------------------
  let pointer: [number, number] | null = null;
  shell.canvas.addEventListener("pointermove", (e) => {
    const r = shell.canvas.getBoundingClientRect();
    const cx = ((e.clientX - r.left) / r.width) * 2 - 1;
    const cy = -(((e.clientY - r.top) / r.height) * 2 - 1);
    pointer = [cx / viewScale[0], cy / viewScale[1]];
  });
  shell.canvas.addEventListener("pointerleave", () => (pointer = null));

  const idleMagnet = (): [number, number] => [
    0.42 * Math.sin(time * 0.55),
    -0.02 + 0.3 * Math.sin(time * 0.83 + 1.3),
  ];

  // ---- controls ----------------------------------------------------------------------
  if (opts.full) {
    shell.slider({
      label: "surface tension",
      min: 0, max: 8, step: 0.1, value: knobs.tension,
      onInput: (v) => (knobs.tension = v),
    });
    shell.slider({
      label: "magnet strength",
      min: 0, max: 90, step: 1, value: knobs.magStrength,
      onInput: (v) => (knobs.magStrength = v),
    });
    shell.slider({
      label: "magnet reach",
      min: 0.05, max: 0.2, step: 0.005, value: knobs.magSoft,
      onInput: (v) => (knobs.magSoft = v),
    });
    shell.button(`view: ${VIEW_NAMES[view]}`, function (this: void) {
      view = (view + 1) % VIEW_NAMES.length;
    });
    const btn = shell.controls.querySelectorAll("button")[0];
    btn?.addEventListener("click", () => (btn.textContent = `view: ${VIEW_NAMES[view]}`));
    shell.button("re-pour", () => {
      sim.rebuild(count);
      bindParticles();
    });
  }
  shell.setInfo(() =>
    opts.hero
      ? `${count.toLocaleString()} particles · surface remeshed every frame · your cursor is the magnet`
      : `${count.toLocaleString()} particles · ${segsDrawn.toLocaleString()} segments by marching squares · cursor = magnet`,
  );

  const writeRP = (mag: [number, number], magOn: boolean): void => {
    const f = new Float32Array([
      viewScale[0], viewScale[1], fieldW, fieldH,
      H * 5.4, 1.05, 0.85, time,
      mag[0], mag[1], magOn ? 1 : 0, view,
      H * 0.62, MAX_SEGS, 0, 0,
    ]);
    dev.queue.writeBuffer(rp, 0, f);
  };

  // pre-warm so the pool arrives settled
  {
    sim.writeParams(knobs, 0.0016, [0, 5], [0, 1], false);
    for (let chunk = 0; chunk < 3; chunk++) {
      const enc = dev.createCommandEncoder();
      sim.encodeSteps(enc, 200);
      dev.queue.submit([enc.finish()]);
    }
  }

  return {
    frame() {
      shell.tick();
      time += 1 / 60;
      const magOn = true;
      const mag = pointer ?? idleMagnet();
      sim.writeParams(knobs, 0.0016, mag, [0, 1], magOn);
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
      if (view === 0 || view === 2) {
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
