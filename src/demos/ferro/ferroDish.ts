// The dish: part two's magnetized SPH in three dimensions, surfaced every
// frame by marching tetrahedra, surface nets, or dual contouring, and shaded
// as glossy ink. Drag orbits; hovering parks a dipole magnet over the pool;
// ctrl/⌘+wheel zooms.

import renderShader from "../../shaders/ferrorender3.wgsl?raw";
import { Shell, gpuMissing, type Demo } from "../../lib/demoShell";
import { getDevice, configureContext } from "../../lib/gpu";
import { OrbitCamera } from "../../lib/camera3d";
import { Ferro3Sim, FERRO3_KNOBS, DISH, H3, type Ferro3Knobs } from "../../lib/ferroSim3";
import { Surface3, type Extractor } from "../../lib/surface3";

const EXTRACTORS: Extractor[] = ["tets", "nets", "dc"];
const EXTRACTOR_NAMES: Record<Extractor, string> = {
  tets: "marching tets",
  nets: "surface nets",
  dc: "dual contouring",
};
const VIEW_NAMES = ["shaded", "particles"];
const MAG_Z = 0.05; // height the cursor magnet hovers at

export interface DishOptions {
  hero?: boolean;
  pipeline?: boolean; // extractor + view buttons, no sliders
  full?: boolean; // everything
  extractor?: Extractor;
}

export async function mountDish(container: HTMLElement, opts: DishOptions): Promise<Demo> {
  const dev = await getDevice();
  const shell = new Shell(container, opts.hero ? 0.52 : 0.62);
  if (!dev) return gpuMissing(container);
  const ctx = configureContext(shell.canvas, dev);
  const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
  const W = shell.canvas.width;
  const Hpx = shell.canvas.height;
  const aspect = W / Hpx;

  const knobs: Ferro3Knobs = { ...FERRO3_KNOBS };
  const count = opts.hero ? 26000 : opts.full ? 28000 : 22000;
  let extractor: Extractor = opts.extractor ?? (opts.pipeline ? "tets" : "dc");
  let view = 0;
  let threshold = 4.5;
  let sharp = 0.7;
  let time = 0;

  const sim = new Ferro3Sim(dev, count);
  const surface = new Surface3(dev, sim.field);

  const camera = new OrbitCamera();
  camera.attach(shell.canvas);
  camera.distance = opts.hero ? 2.0 : 1.9;
  camera.elevation = opts.hero ? 0.42 : 0.52;
  camera.azimuth = 0.65;

  // ---- pipelines -----------------------------------------------------------------
  const module = dev.createShaderModule({ code: renderShader });
  const rp = dev.createBuffer({ size: 144, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const depthTex = dev.createTexture({
    size: [W, Hpx],
    format: "depth24plus",
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });
  const depthView = depthTex.createView();

  const alphaBlend: GPUBlendState = {
    color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
    alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
  };
  const depthOn: GPUDepthStencilState = { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" };
  const depthRead: GPUDepthStencilState = { format: "depth24plus", depthWriteEnabled: false, depthCompare: "less" };

  const pipe = (
    vs: string,
    fs: string,
    depth: GPUDepthStencilState,
    blend?: GPUBlendState,
  ): GPURenderPipeline =>
    dev.createRenderPipeline({
      layout: "auto",
      vertex: { module, entryPoint: vs },
      fragment: { module, entryPoint: fs, targets: [{ format: canvasFormat, blend }] },
      primitive: { topology: "triangle-list", cullMode: "none" },
      depthStencil: depth,
    });

  const meshPipe = pipe("vsMesh", "fsMesh", depthOn);
  const floorPipe = pipe("vsDish", "fsDish", depthOn);
  const wallPipe = pipe("vsDish", "fsDish", depthRead, alphaBlend);
  const dotsPipe = pipe("vsDots3", "fsDots3", depthRead, alphaBlend);
  const glyphPipe = pipe("vsGlyph", "fsGlyph", depthRead, alphaBlend);

  // layout:"auto" keeps only the bindings each entry point actually uses
  const bindFor = (p: GPURenderPipeline, withVerts: boolean): GPUBindGroup =>
    dev.createBindGroup({
      layout: p.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: rp } },
        ...(withVerts ? [{ binding: 1, resource: { buffer: surface.verts } }] : []),
      ],
    });
  const meshBind = bindFor(meshPipe, true);
  const floorBind = bindFor(floorPipe, false);
  const wallBind = bindFor(wallPipe, false);
  const glyphBind = bindFor(glyphPipe, false);
  let dotBinds: [GPUBindGroup, GPUBindGroup] = [null!, null!];
  const bindDots = (): void => {
    dotBinds = sim.buffers.map((b) =>
      dev.createBindGroup({
        layout: dotsPipe.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: rp } },
          { binding: 2, resource: { buffer: b } },
        ],
      }),
    ) as [GPUBindGroup, GPUBindGroup];
  };
  bindDots();

  // ---- the hovering magnet ----------------------------------------------------------
  let pointer: [number, number] | null = null; // ndc
  let dragging = false;
  shell.canvas.addEventListener("pointerdown", () => (dragging = true));
  shell.canvas.addEventListener("pointerup", () => (dragging = false));
  shell.canvas.addEventListener("pointercancel", () => (dragging = false));
  shell.canvas.addEventListener("pointermove", (e) => {
    const r = shell.canvas.getBoundingClientRect();
    pointer = [((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1)];
  });
  shell.canvas.addEventListener("pointerleave", () => (pointer = null));

  const eyeOf = (): [number, number, number] => {
    const ce = Math.cos(camera.elevation);
    return [
      Math.cos(camera.azimuth) * ce * camera.distance,
      Math.sin(camera.azimuth) * ce * camera.distance,
      Math.sin(camera.elevation) * camera.distance,
    ];
  };

  // hover ray ∩ plane z = MAG_Z → magnet position over the dish
  const magnetPos = (
    eye: [number, number, number],
    right: [number, number, number],
    up: [number, number, number],
  ): [number, number, number] | null => {
    if (!pointer || dragging) return null;
    const fl = Math.hypot(eye[0], eye[1], eye[2]);
    const fwd = [-eye[0] / fl, -eye[1] / fl, -eye[2] / fl];
    const t45 = Math.tan(0.45);
    const dir = [
      fwd[0] + right[0] * pointer[0] * aspect * t45 + up[0] * pointer[1] * t45,
      fwd[1] + right[1] * pointer[0] * aspect * t45 + up[1] * pointer[1] * t45,
      fwd[2] + right[2] * pointer[0] * aspect * t45 + up[2] * pointer[1] * t45,
    ];
    if (Math.abs(dir[2]) < 1e-5) return null;
    const t = (MAG_Z - eye[2]) / dir[2];
    if (t <= 0) return null;
    const cl = (v: number): number => Math.max(-DISH.wallXY, Math.min(DISH.wallXY, v));
    return [cl(eye[0] + dir[0] * t), cl(eye[1] + dir[1] * t), MAG_Z];
  };

  // ---- controls -------------------------------------------------------------------------
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
      min: 0, max: 6, step: 0.1, value: knobs.tension,
      onInput: (v) => (knobs.tension = v),
    });
    shell.slider({
      label: "sharpness",
      min: 0, max: 1, step: 0.05, value: sharp,
      onInput: (v) => (sharp = v),
    });
    shell.slider({
      label: "surface level",
      min: 1.5, max: 8, step: 0.1, value: threshold,
      onInput: (v) => (threshold = v),
    });
  }
  if (opts.full || opts.pipeline) {
    shell.button(`extract: ${EXTRACTOR_NAMES[extractor]}`, function (this: void) {
      extractor = EXTRACTORS[(EXTRACTORS.indexOf(extractor) + 1) % EXTRACTORS.length];
    });
    const exBtn = shell.controls.querySelectorAll("button")[0];
    exBtn?.addEventListener("click", () => (exBtn.textContent = `extract: ${EXTRACTOR_NAMES[extractor]}`));
    shell.button(`view: ${VIEW_NAMES[view]}`, function (this: void) {
      view = (view + 1) % VIEW_NAMES.length;
    });
    const vBtn = shell.controls.querySelectorAll("button")[1];
    vBtn?.addEventListener("click", () => (vBtn.textContent = `view: ${VIEW_NAMES[view]}`));
  }
  if (opts.full) {
    shell.button("re-pour", () => {
      sim.rebuild(count);
      bindDots();
    });
  }
  shell.setInfo(() => {
    const tris = `${surface.trisDrawn.toLocaleString()} triangles`;
    if (opts.hero) return `${count.toLocaleString()} particles · ${tris}, re-meshed every frame · drag to orbit`;
    return `${EXTRACTOR_NAMES[extractor]} · ${tris} · ${count.toLocaleString()} particles`;
  });

  const writeRP = (
    eye: [number, number, number],
    viewProj: Float32Array,
    right: [number, number, number],
    up: [number, number, number],
    mag: [number, number, number] | null,
  ): void => {
    const f = new Float32Array(36);
    f.set(viewProj, 0);
    f.set(eye, 16);
    f[19] = time;
    f.set(right, 20);
    f[23] = H3 * 0.42; // dot size
    f.set(up, 24);
    f[27] = 0.055; // moment → brightness
    f.set(mag ?? [0, 0, 0], 28);
    f[31] = mag ? 1 : 0;
    f[32] = DISH.wallXY;
    f[33] = DISH.floorZ;
    f[34] = DISH.floorZ + 0.3;
    f[35] = 0;
    dev.queue.writeBuffer(rp, 0, f);
  };

  // pre-warm with the field off so the pool arrives settled
  {
    sim.writeParams({ ...knobs, hExt: 0, magMoment: 0 }, 0.0016, [0, 0, 5], false);
    for (let chunk = 0; chunk < 3; chunk++) {
      const enc = dev.createCommandEncoder();
      sim.encodeSteps(enc, 80, false);
      dev.queue.submit([enc.finish()]);
    }
  }

  return {
    frame() {
      shell.tick();
      time += 1 / 60;

      const fieldGain = opts.hero ? 0.62 + 0.38 * Math.sin(time * 0.32 - 0.9) : 1.0;
      const { viewProj, right, up } = camera.matrices(aspect);
      const eye = eyeOf();
      const mag = magnetPos(eye, right, up);
      const frameKnobs: Ferro3Knobs = {
        ...knobs,
        hExt: knobs.hExt * fieldGain,
        magMoment: mag ? 30 : 0,
      };
      sim.writeParams(frameKnobs, 0.0016, mag ?? [0, 0, 5], mag !== null);
      surface.writeParams(threshold, extractor === "dc" ? sharp : 0);
      writeRP(eye, viewProj, right, up, mag);

      const enc = dev.createCommandEncoder();
      sim.encodeSteps(enc, 4);
      sim.encodeSplat(enc);
      surface.encode(enc, extractor);

      const pass = enc.beginRenderPass({
        colorAttachments: [{
          view: ctx.getCurrentTexture().createView(),
          clearValue: { r: 0.016, g: 0.018, b: 0.03, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        }],
        depthStencilAttachment: {
          view: depthView,
          depthClearValue: 1,
          depthLoadOp: "clear",
          depthStoreOp: "store",
        },
      });
      pass.setPipeline(floorPipe);
      pass.setBindGroup(0, floorBind);
      pass.draw(6);
      if (view === 0) {
        pass.setPipeline(meshPipe);
        pass.setBindGroup(0, meshBind);
        if (extractor === "tets") {
          pass.drawIndirect(surface.indirect, 0);
        } else {
          pass.setIndexBuffer(surface.indices, "uint32");
          pass.drawIndexedIndirect(surface.indirect, 16);
        }
      } else {
        pass.setPipeline(dotsPipe);
        pass.setBindGroup(0, dotBinds[sim.currentIndex]);
        pass.draw(6, sim.count);
      }
      pass.setPipeline(wallPipe);
      pass.setBindGroup(0, wallBind);
      pass.draw(24, 1, 6);
      if (mag) {
        pass.setPipeline(glyphPipe);
        pass.setBindGroup(0, glyphBind);
        pass.draw(6);
      }
      pass.end();
      dev.queue.submit([enc.finish()]);
      surface.readCounts(extractor);
    },
    dispose() {
      sim.dispose();
      surface.dispose();
      rp.destroy();
      depthTex.destroy();
    },
  };
}
