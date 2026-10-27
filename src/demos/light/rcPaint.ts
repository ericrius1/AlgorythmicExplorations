// Radiance cascades sandbox: paint lights and walls, watch the light field
// answer. No simulation here at all — the scene is your strokes, and the
// cascade slider truncates the hierarchy so you can see what each level buys.
// Strokes go into two textures: the cascades' downscaled scene, and a full-
// resolution copy the display pass draws so edges stay crisp.

import rcShader from "../../shaders/rc.wgsl?raw";
import { Shell, gpuMissing, type Demo } from "../../lib/demoShell";
import { getDevice, configureContext } from "../../lib/gpu";
import { PostFX, HDR_FORMAT } from "../../lib/postfx";
import { RadianceCascades, type BrushStamp } from "../../lib/radianceCascades";

type BrushMode = "light" | "wall" | "erase";

const LIGHT_COLORS: { name: string; rgb: [number, number, number] }[] = [
  { name: "ember", rgb: [3.4, 1.3, 0.25] },
  { name: "cyan", rgb: [0.5, 2.6, 3.2] },
  { name: "violet", rgb: [2.6, 0.7, 3.4] },
  { name: "white", rgb: [3.0, 2.9, 2.7] },
];

export async function mountRcPaint(container: HTMLElement): Promise<Demo> {
  const dev = await getDevice();
  const narrow = (container.clientWidth || window.innerWidth) < 600;
  const shell = new Shell(container, narrow ? 0.8 : 0.62);
  if (!dev) return gpuMissing(container);
  const ctx = configureContext(shell.canvas, dev);
  const post = new PostFX(dev, ctx);
  post.settings.exposure = 1.0;
  post.settings.bloom = 0.16;
  post.settings.vignette = 0.2;

  // the light runs at 2/3 of the canvas's CSS size, so a brush is the same
  // size on screen whatever the display's pixel density
  const dpr = shell.canvas.width / Math.max(1, shell.canvas.clientWidth || shell.canvas.width);
  const cssW = shell.canvas.width / Math.max(dpr, 1);
  const k = 1.5 * Math.max(dpr, 1);
  const rc = new RadianceCascades(dev, Math.floor(shell.canvas.width / k), Math.floor(shell.canvas.height / k), 4, 0.2);
  const unit = rc.width / cssW; // scene px per CSS px

  const paintTex = dev.createTexture({
    size: [shell.canvas.width, shell.canvas.height],
    format: "rgba16float",
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
  const paintTarget = { view: paintTex.createView(), width: shell.canvas.width, height: shell.canvas.height };

  const module = dev.createShaderModule({ code: rcShader });
  const displayPipe = dev.createRenderPipeline({
    layout: "auto",
    vertex: { module, entryPoint: "vsFull" },
    fragment: { module, entryPoint: "fsPaintDisplay", targets: [{ format: HDR_FORMAT }] },
    primitive: { topology: "triangle-list" },
  });
  const pp = dev.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const displayGroup = dev.createBindGroup({
    layout: displayPipe.getBindGroupLayout(0),
    entries: [
      { binding: 4, resource: dev.createSampler({ magFilter: "linear", minFilter: "linear" }) },
      { binding: 8, resource: rc.fluence.view },
      { binding: 15, resource: paintTarget.view },
      { binding: 16, resource: { buffer: pp } },
    ],
  });

  let mode: BrushMode = "light";
  let colorIdx = 0;
  let cascades = rc.cascadeCount;
  let debugMode = 0;
  const pending: BrushStamp[] = [];

  // A starting scene so the canvas has something to say before you touch it:
  // a warm light and a cool one, a wall between them, and a few posts that
  // throw long shadows. Sizes are in CSS pixels, converted to scene pixels.
  {
    const W = rc.width;
    const Hh = rc.height;
    const u = unit;
    pending.push(
      { x: W * 0.2, y: Hh * 0.7, radius: 15 * u, color: LIGHT_COLORS[0].rgb, occlusion: 1 },
      { x: W * 0.8, y: Hh * 0.26, radius: 13 * u, color: LIGHT_COLORS[1].rgb, occlusion: 1 },
    );
    // a wall with a gap in it
    const wall = (x0: number, y0: number, x1: number, y1: number): void => {
      const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / (2 * u));
      for (let i = 0; i <= n; i++) {
        pending.push({
          x: x0 + ((x1 - x0) * i) / n, y: y0 + ((y1 - y0) * i) / n,
          radius: 5 * u, color: [0, 0, 0], occlusion: 1, hardness: 0.7,
        });
      }
    };
    wall(W * 0.5, Hh * 0.08, W * 0.5, Hh * 0.38);
    wall(W * 0.5, Hh * 0.52, W * 0.5, Hh * 0.92);
    for (const [px, py] of [[0.33, 0.42], [0.36, 0.86], [0.66, 0.6], [0.7, 0.12]]) {
      pending.push({ x: W * px, y: Hh * py, radius: 9 * u, color: [0, 0, 0], occlusion: 1, hardness: 0.8 });
    }
  }

  // ---- painting -------------------------------------------------------------
  let drawing = false;
  let last: [number, number] | null = null;
  const toScene = (e: PointerEvent): [number, number] => {
    const r = shell.canvas.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * rc.width, ((e.clientY - r.top) / r.height) * rc.height];
  };
  const stampAt = (x: number, y: number): void => {
    const radius = (mode === "erase" ? 20 : mode === "wall" ? 6 : 12) * unit;
    pending.push({
      x, y, radius,
      color: mode === "light" ? LIGHT_COLORS[colorIdx].rgb : [0, 0, 0],
      occlusion: 1,
      erase: mode === "erase",
      hardness: mode === "wall" ? 0.7 : 0.25,
    });
  };
  shell.canvas.addEventListener("pointerdown", (e) => {
    drawing = true;
    shell.canvas.setPointerCapture(e.pointerId);
    const p = toScene(e);
    stampAt(p[0], p[1]);
    last = p;
  });
  shell.canvas.addEventListener("pointermove", (e) => {
    if (!drawing) return;
    const p = toScene(e);
    if (last) {
      const d = Math.hypot(p[0] - last[0], p[1] - last[1]);
      const n = Math.min(Math.ceil(d / (3 * unit)), 24);
      for (let i = 1; i <= n; i++) {
        stampAt(last[0] + ((p[0] - last[0]) * i) / n, last[1] + ((p[1] - last[1]) * i) / n);
      }
    }
    last = p;
  });
  const stop = (): void => {
    drawing = false;
    last = null;
  };
  shell.canvas.addEventListener("pointerup", stop);
  shell.canvas.addEventListener("pointerleave", stop);
  shell.canvas.style.touchAction = "none";

  // ---- controls --------------------------------------------------------------
  const modeBtns = {} as Record<BrushMode, HTMLButtonElement>;
  const setMode = (m: BrushMode): void => {
    mode = m;
    for (const [key, b] of Object.entries(modeBtns)) {
      b.style.borderColor = key === m ? "var(--accent)" : "";
    }
  };
  modeBtns.light = shell.button("paint light", () => setMode("light"));
  modeBtns.wall = shell.button("paint wall", () => setMode("wall"));
  modeBtns.erase = shell.button("erase", () => setMode("erase"));
  const colorBtn = shell.button(`colour: ${LIGHT_COLORS[0].name}`, () => {
    colorIdx = (colorIdx + 1) % LIGHT_COLORS.length;
    colorBtn.textContent = `colour: ${LIGHT_COLORS[colorIdx].name}`;
    setMode("light");
  });
  shell.slider({
    label: "cascades",
    min: 1, max: rc.cascadeCount, step: 1, value: cascades,
    format: (v) => `${v} of ${rc.cascadeCount}`,
    onInput: (v) => (cascades = Math.round(v)),
  });
  const viewBtn = shell.button("view: final", () => {
    debugMode = debugMode === 0 ? 3 : 0; // final ↔ distance field
    viewBtn.textContent = debugMode === 0 ? "view: final" : "view: distance field";
  });
  shell.button("clear", () => {
    pending.length = 0;
    const enc = dev.createCommandEncoder();
    rc.clearScene(enc);
    rc.clearScene(enc, paintTarget.view);
    dev.queue.submit([enc.finish()]);
  });
  setMode("light");

  // how far the top cascade's rays reach, in CSS pixels — the readout makes
  // the slider's effect a number, not just a look
  const reach = (n: number): number => (4 * (Math.pow(4, n) - 1)) / 3 / unit;
  shell.setInfo(
    () => `${cascades} of ${rc.cascadeCount} cascades · light reaches ${Math.round(Math.min(reach(cascades), 9999))} px · light computed at ${rc.width}×${rc.height}`,
  );

  return {
    frame() {
      shell.tick();
      const enc = dev.createCommandEncoder();
      const n = Math.min(pending.length, 60);
      for (let i = 0; i < n; i++) {
        rc.brush(enc, pending[i]);
        rc.brush(enc, pending[i], paintTarget);
      }
      pending.splice(0, n);
      rc.encodeGI(enc, cascades);
      if (debugMode === 0) {
        dev.queue.writeBuffer(pp, 0, new Float32Array([rc.fluence.probes[0], rc.fluence.probes[1], 1.5, 2.2]));
        const pass = enc.beginRenderPass({
          colorAttachments: [{ view: post.sceneView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: "clear", storeOp: "store" }],
        });
        pass.setPipeline(displayPipe);
        pass.setBindGroup(0, displayGroup);
        pass.draw(3);
        pass.end();
        post.encodePresent(enc);
      } else {
        rc.encodeComposite(enc, ctx.getCurrentTexture().createView(), { exposure: 1.5, emitBoost: 0.7, debugMode });
      }
      dev.queue.submit([enc.finish()]);
    },
    dispose() {
      rc.dispose();
      paintTex.destroy();
      pp.destroy();
      post.dispose();
    },
  };
}
