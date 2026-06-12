// Part five's demos, all one engine (cornell.wgsl):
//   hero     — the box, converging in front of you
//   noise    — samples-per-frame and the pause button: variance made visible
//   nee      — next-event estimation on/off, small light, dramatic difference
//   bounces  — a max-bounce slider: direct light first, then the bleeding
//   full     — material knob, movable light (drag), light size, the toy
//
// Accumulation: two rgba32float ping-pong textures hold (Σ radiance, Σ spp).
// Any knob that changes the scene resets the sum — progressive rendering is
// honest that way: touch the world and the past becomes a lie.

import cornellShader from "../shaders/cornell.wgsl?raw";
import { Shell, gpuMissing, type Demo } from "../lib/demoShell";
import { getDevice, configureContext } from "../lib/gpu";

export interface CornellOptions {
  mode: "hero" | "noise" | "nee" | "bounces" | "full";
}

const MAT_NAMES = ["matte", "mirror", "glossy"];

export async function mountCornell(container: HTMLElement, opts: CornellOptions): Promise<Demo> {
  const dev = await getDevice();
  const shell = new Shell(container, opts.mode === "hero" ? 0.56 : 0.62);
  if (!dev) return gpuMissing(container);
  const ctx = configureContext(shell.canvas, dev);

  const W = shell.canvas.width;
  const Hpx = shell.canvas.height;
  // trace at half resolution: Monte Carlo noise hides upscaling far better
  // than it hides a low frame rate
  const tw = Math.floor(W / 2);
  const th = Math.floor(Hpx / 2);

  // ---- state ------------------------------------------------------------------
  let frame = 0; // since last reset
  let samples = 0; // Σ spp actually traced since last reset
  let spp = opts.mode === "noise" ? 1 : 2;
  let paused = false;
  let nee = opts.mode === "nee" ? false : true;
  let maxBounces = opts.mode === "bounces" ? 2 : 6;
  let matB = opts.mode === "full" ? 1 : 0;
  let rough = 0.18;
  let lightPos: [number, number] = [0, 0];
  let lightSize = opts.mode === "nee" ? 0.16 : 0.3;
  let lightBoost = 1;

  const reset = (): void => {
    frame = 0;
    samples = 0;
  };

  // ---- GPU --------------------------------------------------------------------
  const module = dev.createShaderModule({ code: cornellShader });
  const tp = dev.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

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
    fragment: { module, entryPoint: "fsDisplay", targets: [{ format: navigator.gpu.getPreferredCanvasFormat() }] },
    primitive: { topology: "triangle-list" },
  });

  const traceGroups = [0, 1].map((i) =>
    dev.createBindGroup({
      layout: tracePipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: tp } },
        { binding: 1, resource: accumViews[i] }, // read
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

  // ---- interaction: dragging the light (full + hero) ------------------------------
  let dragging = false;
  const placeLight = (e: PointerEvent): void => {
    const r = shell.canvas.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 2 - 1;
    const z = ((e.clientY - r.top) / r.height) * 2 - 1;
    lightPos = [Math.max(-0.95 + lightSize, Math.min(0.95 - lightSize, x * 1.2)), Math.max(-0.8, Math.min(0.95, z * 1.4))];
    reset();
  };
  if (opts.mode === "full") {
    shell.canvas.addEventListener("pointerdown", (e) => {
      dragging = true;
      placeLight(e);
    });
    shell.canvas.addEventListener("pointermove", (e) => {
      if (dragging) placeLight(e);
    });
    const up = (): void => {
      dragging = false;
    };
    shell.canvas.addEventListener("pointerup", up);
    shell.canvas.addEventListener("pointerleave", up);
  }

  // ---- controls --------------------------------------------------------------------
  if (opts.mode === "noise") {
    shell.slider({
      label: "samples per frame",
      min: 1, max: 8, step: 1, value: spp,
      format: (v) => String(Math.round(v)),
      onInput: (v) => (spp = Math.round(v)),
    });
    shell.button("pause accumulation", function () {
      paused = !paused;
      const btn = shell.controls.querySelectorAll("button")[0];
      btn.textContent = paused ? "resume accumulation" : "pause accumulation";
    });
    shell.button("restart", reset);
  }
  if (opts.mode === "nee") {
    shell.button("light sampling: off", function () {
      nee = !nee;
      const btn = shell.controls.querySelectorAll("button")[0];
      btn.textContent = nee ? "light sampling: on" : "light sampling: off";
      reset();
    });
    shell.button("restart", reset);
  }
  if (opts.mode === "bounces") {
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
  if (opts.mode === "full") {
    shell.button(`sphere: ${MAT_NAMES[matB]}`, function () {
      matB = (matB + 1) % 3;
      const btn = shell.controls.querySelectorAll("button")[0];
      btn.textContent = `sphere: ${MAT_NAMES[matB]}`;
      reset();
    });
    shell.slider({
      label: "roughness",
      min: 0, max: 0.6, step: 0.01, value: rough,
      onInput: (v) => {
        rough = v;
        reset();
      },
    });
    shell.slider({
      label: "light size",
      min: 0.05, max: 0.7, step: 0.01, value: lightSize,
      onInput: (v) => {
        lightSize = v;
        reset();
      },
    });
  }
  shell.setInfo(() => {
    const s = samples.toLocaleString();
    if (opts.mode === "full") return `${s} spp · drag to move the light`;
    if (opts.mode === "noise" && paused) return `${s} spp · frozen — this is what one moment of dice looks like`;
    return `${s} samples per pixel so far`;
  });

  const writeTP = (): void => {
    const f = new Float32Array(16);
    f.set([tw, th, frame, spp]);
    f.set([lightPos[0], lightPos[1], lightSize, lightSize], 4);
    f.set([maxBounces, nee ? 1 : 0, matB, rough], 8);
    f.set([1.35, lightBoost, 0, 0], 12); // exposure, boost
    dev.queue.writeBuffer(tp, 0, f);
  };

  return {
    frame() {
      shell.tick();
      const enc = dev.createCommandEncoder();
      const src = frame % 2;
      const dst = 1 - src;

      writeTP();
      if (!paused) {
        const pass = enc.beginRenderPass({
          colorAttachments: [{ view: accumViews[dst], loadOp: "clear", storeOp: "store" }],
        });
        pass.setPipeline(tracePipe);
        pass.setBindGroup(0, traceGroups[src]);
        pass.draw(3);
        pass.end();
      }

      const show = paused ? src : dst;
      const pass2 = enc.beginRenderPass({
        colorAttachments: [{ view: ctx.getCurrentTexture().createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: "clear", storeOp: "store" }],
      });
      pass2.setPipeline(displayPipe);
      pass2.setBindGroup(0, displayGroups[show]);
      pass2.draw(3);
      pass2.end();

      dev.queue.submit([enc.finish()]);
      if (!paused) {
        frame++;
        samples += spp;
      }
    },
    dispose() {
      for (const t of accum) t.destroy();
      tp.destroy();
    },
  };
}
