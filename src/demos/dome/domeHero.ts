// Hero for the Dome Projection pages: a planetarium ray traced in one
// fragment shader (domeHero.wgsl), drawn into an HDR target and finished by
// the shared bloom and tone mapping. Each page picks its own overlay.

import shader from "./domeHero.wgsl?raw";
import { Shell, type Demo } from "../../lib/demoShell";
import { getDevice } from "../../lib/gpu";
import { PostFX, HDR_FORMAT } from "../../lib/postfx";

export type DomeHeroMode = "circle" | "fisheye" | "cubemap" | "show" | "realtime";

const MODE_INDEX: Record<DomeHeroMode, number> = { circle: 0, fisheye: 1, cubemap: 2, show: 3, realtime: 4 };
const BAKE_SIZE = 512;

function smooth(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

// A value that holds at 0, eases to 1, holds, and eases back, on a loop.
function holdCycle(t: number, hold0: number, ramp: number, hold1: number): number {
  const period = hold0 + ramp + hold1 + ramp;
  const x = ((t % period) + period) % period;
  if (x < hold0) return 0;
  if (x < hold0 + ramp) return smooth((x - hold0) / ramp);
  if (x < hold0 + ramp + hold1) return 1;
  return 1 - smooth((x - hold0 - ramp - hold1) / ramp);
}

export function domeHero(mode: DomeHeroMode): (container: HTMLElement) => Promise<Demo> {
  return async (container) => {
    const shell = new Shell(container, 0.5);
    shell.controls.style.display = "none";
    shell.readout.parentElement?.remove();
    const canvas = shell.canvas;

    const device = await getDevice();
    const context = device ? canvas.getContext("webgpu") : null;
    if (!device || !context) return fallback(canvas);

    context.configure({ device, format: navigator.gpu.getPreferredCanvasFormat(), alphaMode: "opaque" });
    const post = new PostFX(device, context);
    post.settings.exposure = 1.25;
    post.settings.bloom = 0.16;
    post.settings.vignette = 0.45;

    // a shader error stops the hero instead of flooding the console every frame
    let broken = false;
    device.pushErrorScope("validation");
    const module = device.createShaderModule({ label: "dome hero", code: shader });
    void module.getCompilationInfo().then((info) => {
      for (const m of info.messages) {
        if (m.type !== "error") continue;
        broken = true;
        console.error(`dome hero WGSL ${m.lineNum}:${m.linePos} ${m.message}`);
      }
    });
    const pipeline = device.createRenderPipeline({
      label: "dome hero",
      layout: "auto",
      vertex: { module, entryPoint: "vs" },
      fragment: { module, entryPoint: "fs", targets: [{ format: HDR_FORMAT }] },
      primitive: { topology: "triangle-list" },
    });
    const bakePipeline = device.createRenderPipeline({
      label: "dome hero sky bake",
      layout: "auto",
      vertex: { module, entryPoint: "vs" },
      fragment: { module, entryPoint: "fs_bake", targets: [{ format: HDR_FORMAT }] },
      primitive: { topology: "triangle-list" },
    });
    void device.popErrorScope().then((error) => {
      if (error) {
        broken = true;
        console.error(`dome hero pipeline: ${error.message}`);
      }
    });

    // Bake the Milky Way and nebulae into a cubemap once. Stars stay
    // procedural in the main pass so they're sharp at any resolution.
    const sky = device.createTexture({
      label: "dome sky cubemap",
      size: [BAKE_SIZE, BAKE_SIZE, 6],
      format: HDR_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    const ubuf = device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const bakeBuf = device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const bakeGroup = device.createBindGroup({
      layout: bakePipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: bakeBuf } }],
    });
    for (let face = 0; face < 6; face++) {
      device.queue.writeBuffer(bakeBuf, 0, new Float32Array([BAKE_SIZE, BAKE_SIZE, 0, face, 0, 0, 0, 0, 0, 0, 0, 0]));
      const enc = device.createCommandEncoder();
      const pass = enc.beginRenderPass({
        colorAttachments: [
          {
            view: sky.createView({ dimension: "2d", baseArrayLayer: face, arrayLayerCount: 1 }),
            loadOp: "clear",
            storeOp: "store",
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
          },
        ],
      });
      pass.setPipeline(bakePipeline);
      pass.setBindGroup(0, bakeGroup);
      pass.draw(3);
      pass.end();
      device.queue.submit([enc.finish()]);
    }

    const group = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: ubuf } },
        { binding: 1, resource: sky.createView({ dimension: "cube" }) },
        { binding: 2, resource: device.createSampler({ magFilter: "linear", minFilter: "linear" }) },
      ],
    });

    const modeIndex = MODE_INDEX[mode];
    const pitch = mode === "circle" ? 1.0 : mode === "show" ? 0.85 : 0.5;
    const uniforms = new Float32Array(12);
    const t0 = performance.now();

    // The part of the hero not covered by the site nav (top) or an overlaid
    // title (bottom), in the shader's -1..1 vertical units. The fisheye page
    // fits its master circle inside it.
    const band: [number, number] = [1, -1];
    let frameCount = 0;
    const measureBand = (): void => {
      const c = canvas.getBoundingClientRect();
      if (!c.height) return;
      const nav = document.querySelector<HTMLElement>(".site-nav");
      // the nav sits at the top of the page; measured this way it doesn't
      // change as the page scrolls
      const navCover = nav ? Math.max(0, nav.offsetHeight - (c.top + window.scrollY)) : 0;
      const title = canvas.closest("header.hero")?.querySelector<HTMLElement>(".hero-title");
      const first = title?.firstElementChild as HTMLElement | null;
      const overlaid = title && first && getComputedStyle(title).position === "absolute";
      const titleCover = overlaid ? Math.max(0, c.bottom - first.getBoundingClientRect().top) : 0;
      band[0] = 1 - (2 * navCover) / c.height;
      band[1] = -1 + (2 * titleCover) / c.height;
    };

    const resize = (): void => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cssW = canvas.clientWidth;
      const cssH = canvas.clientHeight;
      if (!cssW || !cssH) return;
      const scale = Math.min(dpr, 2560 / cssW);
      const w = Math.floor(cssW * scale);
      const h = Math.floor(cssH * scale);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
    };

    return {
      frame() {
        if (broken) return;
        resize();
        const t = (performance.now() - t0) / 1000;
        uniforms[0] = canvas.width;
        uniforms[1] = canvas.height;
        uniforms[2] = t + 40; // start the sky part-way round, not at its seam
        uniforms[3] = modeIndex;
        uniforms[4] = mode === "fisheye" ? holdCycle(t, 5, 3.5, 6) : 0;
        uniforms[5] = mode === "show" ? holdCycle(t, 5, 2.5, 6) : 0;
        uniforms[6] = 0.16 * Math.sin((t / 90) * Math.PI * 2);
        uniforms[7] = pitch;
        // re-measured now and then: the nav and title settle after the first frames
        if (mode === "fisheye" && frameCount++ % 30 === 0) measureBand();
        uniforms[8] = band[0];
        uniforms[9] = band[1];
        device.queue.writeBuffer(ubuf, 0, uniforms);
        const enc = device.createCommandEncoder();
        const pass = enc.beginRenderPass({
          colorAttachments: [
            { view: post.sceneView(), loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 } },
          ],
        });
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, group);
        pass.draw(3);
        pass.end();
        post.encodePresent(enc);
        device.queue.submit([enc.finish()]);
      },
      dispose() {
        post.dispose();
        sky.destroy();
        ubuf.destroy();
        bakeBuf.destroy();
      },
    };
  };
}

// Without WebGPU: the dome from below, as rings and spokes.
function fallback(canvas: HTMLCanvasElement): Demo {
  return {
    frame() {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const w = canvas.width;
      const h = canvas.height;
      ctx.fillStyle = "#06070b";
      ctx.fillRect(0, 0, w, h);
      const r = h * 0.42;
      ctx.strokeStyle = "rgba(122, 162, 255, 0.35)";
      ctx.lineWidth = Math.max(1, w / 900);
      for (let i = 1; i <= 6; i++) {
        ctx.beginPath();
        ctx.arc(w / 2, h * 0.45, (r * i) / 6, 0, Math.PI * 2);
        ctx.stroke();
      }
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(w / 2, h * 0.45);
        ctx.lineTo(w / 2 + Math.cos(a) * r, h * 0.45 + Math.sin(a) * r);
        ctx.stroke();
      }
    },
  };
}
