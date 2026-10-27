// Part three's demos, all driven by fog.wgsl + the media-aware cascades:
//   hero / forest — the dawn forest: ground mist, low sun, light shafts (mode 0)
//   halo          — one lamp in a closed room of uniform fog (mode 1)
//   shafts        — sun through two wall slits, density on a slider (mode 2)
// The cursor blows smoke in every mode; in `halo` it carries the lamp instead.

import fogShader from "../../shaders/fog.wgsl?raw";
import { Shell, gpuMissing, type Demo } from "../../lib/demoShell";
import { getDevice, configureContext } from "../../lib/gpu";
import { PostFX, HDR_FORMAT } from "../../lib/postfx";
import { RadianceCascades } from "../../lib/radianceCascades";

const VIEWS = ["final", "scene (what the rays see)", "distance field", "light only", "fog density"];
const VIEW_MODES = [0, 1, 3, 4, 5];

export interface FogOptions {
  mode: "hero" | "forest" | "halo" | "shafts";
}

interface Puff {
  x: number; y: number; r: number; s: number;
  vx: number; vy: number; age: number; life: number;
}

type RGB = [number, number, number];

export async function mountFog(container: HTMLElement, opts: FogOptions): Promise<Demo> {
  const dev = await getDevice();
  const narrow = (container.clientWidth || window.innerWidth) < 600;
  const aspectRatio = opts.mode === "hero" ? (narrow ? 0.85 : 0.5) : narrow ? 0.8 : 0.62;
  const shell = new Shell(container, aspectRatio);
  if (!dev) return gpuMissing(container);
  const ctx = configureContext(shell.canvas, dev);
  const post = new PostFX(dev, ctx);
  post.settings.bloom = 0.18;
  post.settings.vignette = 0.3;

  const modeNum = opts.mode === "halo" ? 1 : opts.mode === "shafts" ? 2 : 0;
  post.settings.exposure = modeNum === 0 ? 1.2 : 1.5;
  const W = shell.canvas.width;
  const Hpx = shell.canvas.height;
  const aspect = W / Hpx;
  const viewScale: [number, number] = [1 / aspect, 1];

  // GI at a fraction of the canvas. The fog march is the priciest in the
  // series (every leap samples the media texture), and the display pass
  // redraws every edge at full resolution anyway.
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rcDiv = Math.max(2.4, 2 * dpr);
  const gw = Math.floor(W / rcDiv);
  const gh = Math.floor(Hpx / rcDiv);

  // the fog texture the rays march through: a = density, rgb = light
  const mediaTex = dev.createTexture({
    size: [gw, gh],
    format: "rgba16float",
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
  const mediaView = mediaTex.createView();

  // temporal 0.45: the fog's glow reads last frame's light (the bounce trick
  // again), and multiple scattering is itself a feedback loop, so too much
  // history smears a moving lamp into a trail. 0.45 is the compromise.
  const rc = new RadianceCascades(dev, gw, gh, 4, 0.45, mediaView);

  // ---- state -----------------------------------------------------------------
  let fog = modeNum === 1 ? 0.5 : modeNum === 2 ? 0.4 : 0.7;
  let scatter = modeNum === 2 ? 0.9 : modeNum === 1 ? 0.6 : 0.75; // single-scattering albedo
  let mist = 0.5;
  let sunHeight = 0.4; // 0 horizon … 1 overhead (shafts mode)
  const bounce = 0.6;
  let view = 0;
  let time = 0;
  let last = performance.now();
  // extinction per world unit at density 1; the cascades want it per scene
  // pixel, which depends on the resolution the light runs at
  const sigmaWorld = modeNum === 0 ? 1.6 : 0.8;
  const pxPerWorld = (viewScale[1] * gh) / 2;

  // ---- GPU resources ------------------------------------------------------------
  const module = dev.createShaderModule({ code: fogShader });
  const fp = dev.createBuffer({ size: 128, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const fpDisplay = dev.createBuffer({ size: 128, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const linSamp = dev.createSampler({ magFilter: "linear", minFilter: "linear" });

  const MAXP = 48;
  const puffBuf = dev.createBuffer({ size: MAXP * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const puffData = new Float32Array(MAXP * 4);

  const fullPipe = (entryPoint: string, format: GPUTextureFormat): GPURenderPipeline =>
    dev.createRenderPipeline({
      layout: "auto",
      vertex: { module, entryPoint: "vsFullF" },
      fragment: { module, entryPoint, targets: [{ format }] },
      primitive: { topology: "triangle-list" },
    });
  const scenePipe = fullPipe("fsSceneF", "rgba16float");
  const mediaPipe = fullPipe("fsMedia", "rgba16float");
  const displayPipe = fullPipe("fsDisplayF", HDR_FORMAT);

  // ("auto" layouts drop bindings an entry point doesn't touch, so each
  // group lists only what its shader reads)
  const sceneGroup = dev.createBindGroup({
    layout: scenePipe.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: fp } },
      { binding: 2, resource: rc.fluence.view },
      { binding: 3, resource: linSamp },
    ],
  });
  const mediaGroup = dev.createBindGroup({
    layout: mediaPipe.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: fp } },
      { binding: 2, resource: rc.fluence.view },
      { binding: 3, resource: linSamp },
      { binding: 4, resource: { buffer: puffBuf } },
    ],
  });
  const displayGroup = dev.createBindGroup({
    layout: displayPipe.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: fpDisplay } },
      { binding: 2, resource: rc.fluence.view },
      { binding: 3, resource: linSamp },
      { binding: 4, resource: { buffer: puffBuf } },
    ],
  });

  // ---- pointer: smoke puffs everywhere, the lamp in halo mode -----------------------
  const puffs: Puff[] = [];
  let lamp: [number, number] = [-0.35, 0.15];
  let lastPointer = 0;
  let lastPuff = 0;

  shell.canvas.addEventListener("pointermove", (e) => {
    const r = shell.canvas.getBoundingClientRect();
    const wx = (((e.clientX - r.left) / r.width) * 2 - 1) / viewScale[0];
    const wy = -(((e.clientY - r.top) / r.height) * 2 - 1) / viewScale[1];
    const now = performance.now();
    lastPointer = now;
    if (modeNum === 1) {
      lamp = [wx, wy];
      return;
    }
    if (now - lastPuff > 40 && puffs.length < MAXP) {
      lastPuff = now;
      puffs.push({
        x: wx, y: wy, r: 0.05, s: 0.9,
        vx: (Math.random() - 0.5) * 0.06, vy: 0.05 + Math.random() * 0.05,
        age: 0, life: 3.5 + Math.random() * 1.5,
      });
    }
  });

  const stepPuffs = (dt: number): void => {
    for (let i = puffs.length - 1; i >= 0; i--) {
      const p = puffs[i];
      p.age += dt;
      if (p.age > p.life) {
        puffs.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.r += 0.045 * dt; // puffs spread as they rise…
      p.s *= Math.exp(-0.45 * dt); // …and thin out
    }
    puffData.fill(0);
    for (let i = 0; i < puffs.length; i++) {
      const p = puffs[i];
      const fade = Math.min(1, p.age * 6) * Math.min(1, (p.life - p.age) * 1.5);
      puffData.set([p.x, p.y, p.r, p.s * fade], i * 4);
    }
    dev.queue.writeBuffer(puffBuf, 0, puffData);
  };

  // ---- controls ---------------------------------------------------------------------
  if (opts.mode !== "hero") {
    shell.slider({
      label: "fog",
      min: 0, max: 1.5, step: 0.01, value: fog,
      onInput: (v) => (fog = v),
    });
  }
  if (opts.mode === "halo" || opts.mode === "forest") {
    shell.slider({
      label: "scatter",
      min: 0, max: 1, step: 0.01, value: scatter,
      onInput: (v) => (scatter = v),
    });
  }
  if (opts.mode === "shafts") {
    shell.slider({
      label: "sun height",
      min: 0.05, max: 1, step: 0.01, value: sunHeight,
      format: (v) => `${Math.round((Math.atan2(0.15 + v * 1.3, 1) * 180) / Math.PI)}°`,
      onInput: (v) => (sunHeight = v),
    });
  }
  if (opts.mode === "forest") {
    shell.slider({
      label: "mist height",
      min: 0.1, max: 1.0, step: 0.01, value: mist,
      onInput: (v) => (mist = v),
    });
    const viewBtn = shell.button(`view: ${VIEWS[0]}`, () => {
      view = (view + 1) % VIEWS.length;
      viewBtn.textContent = `view: ${VIEWS[view]}`;
    });
  }
  shell.setInfo(() => {
    if (modeNum === 1) return `1 lamp · ${rc.cascadeCount} cascades · carry it with your cursor`;
    if (modeNum === 2) return `${rc.cascadeCount} cascades · blow smoke into the light with your cursor`;
    return `${rc.cascadeCount} cascades · fog in every ray · breathe smoke with your cursor`;
  });

  // ---- sky: what the top cascade returns, and the backdrop the display draws --------
  interface Sky {
    zenith: RGB; horizon: RGB; sunDir: [number, number]; sharp: number; sun: number; sunColor: RGB;
    backZenith: RGB; backHorizon: RGB; backSun: number;
  }
  const skyNow = (): Sky | null => {
    if (modeNum === 1) return null;
    if (modeNum === 2) {
      // sun outside the left wall; height on the slider, warmer when low
      const warm = 1 - sunHeight * 0.7;
      const sunColor: RGB = [1, 0.95 - warm * 0.35, 0.85 - warm * 0.55];
      return {
        zenith: [0.03, 0.045, 0.08], horizon: [0.08, 0.06, 0.04],
        sunDir: [-1, -0.15 - sunHeight * 1.3], sharp: 300, sun: 26, sunColor,
        backZenith: [0.3, 0.42, 0.62], backHorizon: [0.85, 0.62, 0.4], backSun: 2.0,
      };
    }
    // the forest: a low morning sun, up and to the left, behind the crowns
    return {
      zenith: [0.022, 0.045, 0.1], horizon: [0.1, 0.075, 0.055],
      sunDir: [-0.62, -0.78], sharp: 260, sun: 46, sunColor: [1, 0.7, 0.36],
      backZenith: [0.025, 0.04, 0.085], backHorizon: [0.2, 0.12, 0.07], backSun: 1.2,
    };
  };

  const writeFP = (sky: Sky | null): void => {
    const f = new Float32Array(32);
    f.set([viewScale[0], viewScale[1], gw, gh]);
    f.set([time, modeNum, fog, 1.0], 4);
    f.set([lamp[0], lamp[1], bounce, puffs.length], 8);
    f.set([rc.fluence.probes[0], rc.fluence.probes[1], mist, scatter], 12);
    const sd = sky ? sky.sunDir : [0, -1];
    const len = Math.hypot(sd[0], sd[1]);
    f.set([sd[0] / len, -sd[1] / len, sigmaWorld, modeNum === 0 ? 2.6 : 3.2], 16);
    if (sky) {
      f.set([...sky.backZenith, 0], 20);
      f.set([...sky.backHorizon, 0], 24);
      f.set([...sky.sunColor, sky.backSun], 28);
    }
    dev.queue.writeBuffer(fp, 0, f);
    f[2] = W; // display path: canvas resolution
    f[3] = Hpx;
    dev.queue.writeBuffer(fpDisplay, 0, f);
  };

  const writeSky = (sky: Sky | null): void => {
    if (!sky) {
      rc.setSky({ zenith: [0, 0, 0], horizon: [0, 0, 0], strength: 0 });
      return;
    }
    rc.setSky({
      zenith: sky.zenith,
      horizon: sky.horizon,
      sunDir: sky.sunDir,
      sunSharpness: sky.sharp,
      sunIntensity: sky.sun,
      sunColor: sky.sunColor,
      strength: 1,
    });
  };

  return {
    frame() {
      shell.tick();
      const now = performance.now();
      const dt = Math.min((now - last) / 1000, 1 / 30);
      last = now;
      time += dt;

      // the lamp wanders when nobody is carrying it, slowly, because a fast
      // lamp in scattering fog drags a tail of stale glow
      if (modeNum === 1 && (lastPointer === 0 || now - lastPointer > 4000)) {
        lamp = [0.55 * Math.sin(time * 0.16) - 0.25, 0.42 * Math.sin(time * 0.11 + 1.3)];
      }

      stepPuffs(dt);
      const sky = skyNow();
      writeFP(sky);
      writeSky(sky);
      rc.setMedia({ sigma: sigmaWorld / pxPerWorld, scatter });

      const enc = dev.createCommandEncoder();

      // fog first (reads LAST frame's light for its glow) …
      let pass = enc.beginRenderPass({
        colorAttachments: [{ view: mediaView, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "store" }],
      });
      pass.setPipeline(mediaPipe);
      pass.setBindGroup(0, mediaGroup);
      pass.draw(3);
      pass.end();

      // … then the surfaces (same one-frame-old light for their bounce)
      pass = enc.beginRenderPass({
        colorAttachments: [{ view: rc.sceneView, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "store" }],
      });
      pass.setPipeline(scenePipe);
      pass.setBindGroup(0, sceneGroup);
      pass.draw(3);
      pass.end();

      rc.encodeGI(enc);

      if (view === 0) {
        pass = enc.beginRenderPass({
          colorAttachments: [{ view: post.sceneView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: "clear", storeOp: "store" }],
        });
        pass.setPipeline(displayPipe);
        pass.setBindGroup(0, displayGroup);
        pass.draw(3);
        pass.end();
        post.encodePresent(enc);
      } else {
        rc.encodeComposite(enc, ctx.getCurrentTexture().createView(), {
          exposure: 1.8,
          debugMode: VIEW_MODES[view],
          emitBoost: 0.55,
        });
      }
      dev.queue.submit([enc.finish()]);
    },
    dispose() {
      rc.dispose();
      mediaTex.destroy();
      fp.destroy();
      fpDisplay.destroy();
      puffBuf.destroy();
      post.dispose();
    },
  };
}
