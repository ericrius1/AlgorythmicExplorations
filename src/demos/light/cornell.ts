// Part five's demos, all one engine (cornell.wgsl):
//   hero     — the box on a dark stage, converging in front of you
//   noise    — samples per frame, pause, and a measured noise readout
//   nee      — next-event estimation on/off with a small lamp
//   bounces  — a max-bounce slider: direct light first, then the bleeding
//   full     — sphere material, roughness, lamp size, drag the lamp
//
// Accumulation: two rgba32float ping-pong textures hold (Σ radiance, Σ lum²)
// at about one trace pixel per CSS pixel. Any knob that changes the scene
// resets the sum. The display pass filters the sum up to the canvas and
// PostFX tone maps it. Once a figure reaches its sample cap it stops tracing.

import cornellShader from "../../shaders/cornell.wgsl?raw";
import { Shell, gpuMissing, type Demo } from "../../lib/demoShell";
import { getDevice, configureContext } from "../../lib/gpu";
import { PostFX, HDR_FORMAT } from "../../lib/postfx";

export interface CornellOptions {
  mode: "hero" | "noise" | "nee" | "bounces" | "full";
}

const MAT_NAMES = ["matte", "mirror", "glossy"];
// lamp radiance at the default half-size 0.3; smaller lamps get brighter so
// the total power stays put and only the shadows change
const LE_REF = 15;
const SIZE_REF = 0.3;

export async function mountCornell(container: HTMLElement, opts: CornellOptions): Promise<Demo> {
  const mode = opts.mode;
  const hero = mode === "hero";
  const dev = await getDevice();
  const shell = new Shell(container, hero ? 0.56 : 0.62);
  if (!dev) return gpuMissing(container);
  const ctx = configureContext(shell.canvas, dev);
  const post = new PostFX(dev, ctx);
  post.settings.bloom = hero ? 0.07 : 0.05;
  post.settings.vignette = hero ? 0.3 : 0.15;

  // Trace at roughly one sample point per CSS pixel, capped, and at an exact
  // integer fraction of the canvas so the bilinear upscale has no moiré.
  const cssW = shell.canvas.clientWidth || shell.canvas.width / Math.min(window.devicePixelRatio || 1, 2);
  const budget = hero ? 1_000_000 : 420_000;
  let k = Math.max(1, Math.round(shell.canvas.width / cssW));
  while ((shell.canvas.width / k) * (shell.canvas.height / k) > budget) k++;
  const tw = Math.ceil(shell.canvas.width / k);
  const th = Math.ceil(shell.canvas.height / k);
  const aspect = tw / th;

  // ---- state ------------------------------------------------------------------
  let frame = 0; // frames since the last reset
  let samples = 0; // samples per pixel in the sum
  let seed = 1;
  let spp = mode === "noise" ? 1 : hero ? 2 : 4;
  let paused = false;
  let nee = mode !== "nee";
  let maxBounces = mode === "bounces" ? 2 : 8;
  let matB = mode === "full" ? 1 : 0;
  let rough = 0.18;
  let lightPos: [number, number] = [0, 0];
  let lightSize = mode === "nee" ? 0.12 : SIZE_REF;
  const cap = mode === "noise" ? 65536 : hero ? 16384 : 8192;
  let dirty = true; // something to draw this frame

  const reset = (): void => {
    frame = 0;
    samples = 0;
    dirty = true;
    if (noise) noise.value = null;
  };

  // Camera: the figures frame the open front of the box tightly; the hero
  // backs off so the box stands on its floor with the title below it.
  const cam = hero
    ? aspect > 1.5
      ? { eye: [0, 1.7, 7.6], target: [0, 0.5, 0], focal: 3.6 }
      : { eye: [0, 1.35, 6.4], target: [0, 0.92, 0], focal: 2.45 }
    : { eye: [0, 1, 3.6], target: [0, 1, 0], focal: 2.56 };

  // ---- GPU --------------------------------------------------------------------
  const module = dev.createShaderModule({ code: cornellShader });
  const tp = dev.createBuffer({ size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

  const accum = [0, 1].map(() =>
    dev.createTexture({
      size: [tw, th],
      format: "rgba32float",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    }),
  );
  const accumViews = accum.map((t) => t.createView());

  const tracePipe = dev.createRenderPipeline({
    layout: "auto",
    vertex: { module, entryPoint: "vsFullC" },
    fragment: { module, entryPoint: "fsTrace", targets: [{ format: "rgba32float" }] },
    primitive: { topology: "triangle-list" },
  });
  const displayPipe = dev.createRenderPipeline({
    layout: "auto",
    vertex: { module, entryPoint: "vsFullC" },
    fragment: { module, entryPoint: "fsDisplay", targets: [{ format: HDR_FORMAT }] },
    primitive: { topology: "triangle-list" },
  });

  const traceGroups = [0, 1].map((i) =>
    dev.createBindGroup({
      layout: tracePipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: tp } },
        { binding: 1, resource: accumViews[i] },
      ],
    }),
  );
  const displayGroups = [0, 1].map((i) =>
    dev.createBindGroup({
      layout: displayPipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: tp } },
        { binding: 2, resource: accumViews[i] },
      ],
    }),
  );

  // noise readout (noise figure only): mean standard error over a sparse grid
  let noise: {
    pipe: GPUComputePipeline;
    groups: GPUBindGroup[];
    buf: GPUBuffer;
    read: GPUBuffer;
    busy: boolean;
    value: number | null;
    at: number; // samples when it was measured
  } | null = null;
  if (mode === "noise" || mode === "nee") {
    const pipe = dev.createComputePipeline({ layout: "auto", compute: { module, entryPoint: "noiseStats" } });
    const buf = dev.createBuffer({ size: 8, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
    const read = dev.createBuffer({ size: 8, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const groups = [0, 1].map((i) =>
      dev.createBindGroup({
        layout: pipe.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: tp } },
          { binding: 3, resource: accumViews[i] },
          { binding: 4, resource: { buffer: buf } },
        ],
      }),
    );
    noise = { pipe, groups, buf, read, busy: false, value: null, at: 0 };
  }

  // ---- interaction: drag the lamp (full) ----------------------------------------
  if (mode === "full") {
    let dragging = false;
    const placeLight = (e: PointerEvent): void => {
      const r = shell.canvas.getBoundingClientRect();
      // the opening spans the middle 62% of the canvas width in this framing
      const x = (((e.clientX - r.left) / r.width) * 2 - 1) / 0.62;
      const z = ((e.clientY - r.top) / r.height) * 2 - 1;
      const lim = 0.98 - lightSize;
      lightPos = [Math.max(-lim, Math.min(lim, x)), Math.max(-lim, Math.min(lim, z * 1.1))];
      reset();
    };
    shell.canvas.style.touchAction = "none";
    shell.canvas.addEventListener("pointerdown", (e) => {
      dragging = true;
      shell.canvas.setPointerCapture(e.pointerId);
      placeLight(e);
    });
    shell.canvas.addEventListener("pointermove", (e) => {
      if (dragging) placeLight(e);
    });
    const up = (): void => {
      dragging = false;
    };
    shell.canvas.addEventListener("pointerup", up);
    shell.canvas.addEventListener("pointercancel", up);
  }

  // ---- controls --------------------------------------------------------------------
  if (mode === "noise") {
    shell.slider({
      label: "samples per frame",
      min: 1, max: 8, step: 1, value: spp,
      format: (v) => String(Math.round(v)),
      onInput: (v) => (spp = Math.round(v)),
    });
    const pauseBtn = shell.button("pause", () => {
      paused = !paused;
      pauseBtn.textContent = paused ? "resume" : "pause";
      dirty = true;
    });
    shell.button("restart", () => {
      reset();
      if (noise) noise.value = null;
    });
  }
  if (mode === "nee") {
    const neeBtn = shell.button("light sampling: off", () => {
      nee = !nee;
      neeBtn.textContent = nee ? "light sampling: on" : "light sampling: off";
      reset();
    });
    shell.button("restart", reset);
  }
  if (mode === "bounces") {
    shell.slider({
      label: "max bounces",
      min: 1, max: 8, step: 1, value: maxBounces,
      format: (v) => (v < 1.5 ? "1 (direct only)" : String(Math.round(v))),
      onInput: (v) => {
        maxBounces = Math.round(v);
        reset();
      },
    });
  }
  if (mode === "full") {
    const matBtn = shell.button(`sphere: ${MAT_NAMES[matB]}`, () => {
      matB = (matB + 1) % 3;
      matBtn.textContent = `sphere: ${MAT_NAMES[matB]}`;
      reset();
    });
    shell.slider({
      label: "roughness",
      min: 0, max: 0.6, step: 0.01, value: rough,
      format: (v) => (matB === 2 ? v.toFixed(2) : `${v.toFixed(2)} (glossy only)`),
      onInput: (v) => {
        rough = v;
        if (matB === 2) reset();
      },
    });
    shell.slider({
      label: "lamp size",
      min: 0.04, max: 0.7, step: 0.01, value: lightSize,
      format: (v) => `${(v * 2).toFixed(2)} wide`,
      onInput: (v) => {
        lightSize = v;
        const lim = 0.98 - lightSize;
        lightPos = [Math.max(-lim, Math.min(lim, lightPos[0])), Math.max(-lim, Math.min(lim, lightPos[1]))];
        reset();
      },
    });
  }
  shell.setInfo(() => {
    const s = samples.toLocaleString();
    const done = samples >= cap ? " (done)" : "";
    if (mode === "noise") {
      const n = noise?.value;
      const est = n == null ? "" : ` · noise ≈ ${(n * 100).toFixed(n < 0.1 ? 1 : 0)}%`;
      return `${s} samples per pixel${est}${paused ? " · paused" : ""}`;
    }
    if (mode === "nee") {
      const n = noise?.value;
      return `${s} samples per pixel${done}${n == null ? "" : ` · noise ≈ ${(n * 100).toFixed(n < 0.1 ? 1 : 0)}%`}`;
    }
    if (mode === "full") return `${s} samples per pixel${done} · drag to move the lamp`;
    return `${s} samples per pixel${done}`;
  });

  const writeTP = (add: number): void => {
    const f = new Float32Array(24);
    const le = LE_REF * (SIZE_REF / lightSize) ** 2;
    const count = samples + add;
    f.set([tw, th, frame, add]);
    f.set([lightPos[0], lightPos[1], lightSize, lightSize], 4);
    f.set([maxBounces, nee ? 1 : 0, matB, rough], 8);
    f.set([count, le, hero ? 1 : 0, seed], 12);
    f.set([...cam.eye, cam.focal], 16);
    f.set([...cam.target, hero ? 0.95 : 1.0], 20);
    dev.queue.writeBuffer(tp, 0, f);
  };

  const readNoise = (): void => {
    if (!noise || noise.busy || samples < 2) return;
    const n = noise;
    n.busy = true;
    const at = samples;
    void n.read.mapAsync(GPUMapMode.READ).then(() => {
      const v = new Uint32Array(n.read.getMappedRange().slice(0));
      n.read.unmap();
      n.busy = false;
      // a restart while this was in flight makes it stale
      if (samples >= at && v[1] > 0) {
        n.value = v[0] / v[1];
        n.at = at;
      }
    });
  };

  // adaptive work per frame for the hero: as many samples as keep it smooth
  let dtEma = 16;
  let lastT = performance.now();

  return {
    frame() {
      shell.tick();
      const now = performance.now();
      dtEma += (Math.min(now - lastT, 100) - dtEma) * 0.1;
      lastT = now;
      if (hero && frame > 0 && frame % 15 === 0) {
        if (dtEma < 19 && spp < 12) spp++;
        else if (dtEma > 26 && spp > 1) spp--;
      }

      const tracing = !paused && samples < cap;
      if (!tracing && !dirty) return;

      const enc = dev.createCommandEncoder();
      const src = frame % 2;
      const dst = tracing ? 1 - src : src;
      // the first frame after a reset traces extra so it never shows a bare 1 spp
      const add = tracing ? Math.min(frame === 0 && mode !== "noise" ? Math.max(spp, 4) : spp, cap - samples) : 0;
      seed = (seed + 1) % 16777216; // exact in a float uniform
      writeTP(add);

      if (tracing) {
        const pass = enc.beginRenderPass({
          colorAttachments: [{ view: accumViews[dst], loadOp: "clear", storeOp: "store" }],
        });
        pass.setPipeline(tracePipe);
        pass.setBindGroup(0, traceGroups[src]);
        pass.draw(3);
        pass.end();
      }

      const pass2 = enc.beginRenderPass({
        colorAttachments: [{ view: post.sceneView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: "clear", storeOp: "store" }],
      });
      pass2.setPipeline(displayPipe);
      pass2.setBindGroup(0, displayGroups[dst]);
      pass2.draw(3);
      pass2.end();
      post.encodePresent(enc);

      const measure = noise && tracing && !noise.busy && frame % 6 === 0;
      if (noise && measure) {
        enc.clearBuffer(noise.buf);
        const cp = enc.beginComputePass();
        cp.setPipeline(noise.pipe);
        cp.setBindGroup(0, noise.groups[dst]);
        cp.dispatchWorkgroups(Math.ceil(tw / 3 / 8), Math.ceil(th / 3 / 8));
        cp.end();
        enc.copyBufferToBuffer(noise.buf, 0, noise.read, 0, 8);
      }

      dev.queue.submit([enc.finish()]);
      if (measure) readNoise();
      if (tracing) {
        frame++;
        samples += add;
      }
      dirty = false;
    },
    dispose() {
      for (const t of accum) t.destroy();
      tp.destroy();
      post.dispose();
      noise?.buf.destroy();
      noise?.read.destroy();
    },
  };
}
