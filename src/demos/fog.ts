// Part three's demos, all driven by fog.wgsl + the media-aware cascades:
//   hero / forest — the dawn forest: ground mist, low sun, god rays (mode 0)
//   halo          — one lamp in a closed room of uniform fog (mode 1)
//   shafts        — sun through two wall slits, density on a slider (mode 2)
// The cursor blows smoke in every mode; in `halo` it carries the lamp instead.

import fogShader from "../shaders/fog.wgsl?raw";
import { Shell, gpuMissing, type Demo } from "../lib/demoShell";
import { getDevice, configureContext } from "../lib/gpu";
import { RadianceCascades } from "../lib/radianceCascades";

const DEBUG_NAMES = ["final", "scene (what the rays see)", "occupancy", "distance field", "light only", "fog density"];

export interface FogOptions {
  mode: "hero" | "forest" | "halo" | "shafts";
}

interface Puff {
  x: number; y: number; r: number; s: number;
  vx: number; vy: number; age: number; life: number;
}

export async function mountFog(container: HTMLElement, opts: FogOptions): Promise<Demo> {
  const dev = await getDevice();
  const shell = new Shell(container, opts.mode === "hero" ? 0.52 : 0.62);
  if (!dev) return gpuMissing(container);
  const ctx = configureContext(shell.canvas, dev);

  const modeNum = opts.mode === "halo" ? 1 : opts.mode === "shafts" ? 2 : 0;
  const W = shell.canvas.width;
  const Hpx = shell.canvas.height;
  const aspect = W / Hpx;
  const viewScaleY = modeNum === 0 ? 1.0 : 0.98;
  const viewScale: [number, number] = [viewScaleY / aspect, viewScaleY];

  // GI at /2.4 — fog is the lowest-frequency light there is, but narrow
  // light corridors (the wall slits) must stay wider than the upper
  // cascades' probe spacing or the shafts interpolate away. The fog march
  // is the priciest in the series (every leap samples the media texture),
  // so this is the perf/looks compromise.
  const gw = Math.floor(W / 2.4);
  const gh = Math.floor(Hpx / 2.4);

  // the fog texture the rays march through: a = density, rgb = glow
  const mediaTex = dev.createTexture({
    size: [gw, gh],
    format: "rgba16float",
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
  const mediaView = mediaTex.createView();

  // temporal 0.45: the fog's glow reads last frame's light (the bounce trick
  // again). The EMA stores that history — but multiple scattering is itself
  // a feedback loop, so too much history makes moving lights smear into
  // long-lived ghost trails. 0.45 is the compromise.
  const rc = new RadianceCascades(dev, gw, gh, 4, 0.45, mediaView);

  // ---- state -----------------------------------------------------------------
  let fog = modeNum === 1 ? 0.4 : modeNum === 2 ? 0.32 : 0.7;
  let scatter = modeNum === 2 ? 0.9 : modeNum === 1 ? 0.55 : 0.7; // single-scattering albedo
  let mist = 0.8;
  let sunHeight = 0.45; // 0 horizon … 1 overhead (shafts mode)
  let bounce = 0.6;
  let debugMode = 0;
  let time = 0;
  let last = performance.now();

  // ---- GPU resources ------------------------------------------------------------
  const module = dev.createShaderModule({ code: fogShader });
  const fp = dev.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const linSamp = dev.createSampler({ magFilter: "linear", minFilter: "linear" });

  const MAXP = 48;
  const puffBuf = dev.createBuffer({ size: MAXP * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  const puffData = new Float32Array(MAXP * 4);

  const scenePipe = dev.createRenderPipeline({
    layout: "auto",
    vertex: { module, entryPoint: "vsFullF" },
    fragment: { module, entryPoint: "fsSceneF", targets: [{ format: "rgba16float" }] },
    primitive: { topology: "triangle-list" },
  });
  const mediaPipe = dev.createRenderPipeline({
    layout: "auto",
    vertex: { module, entryPoint: "vsFullF" },
    fragment: { module, entryPoint: "fsMedia", targets: [{ format: "rgba16float" }] },
    primitive: { topology: "triangle-list" },
  });

  // (no puff binding here: the scene pass never reads them, and "auto"
  // layout drops bindings an entry point doesn't touch)
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

  // ---- pointer: smoke puffs everywhere, the lamp in halo mode -----------------------
  const puffs: Puff[] = [];
  let lamp: [number, number] = [-0.2, 0.1];
  let lastPointer = 0;
  let lastPuff = 0;

  shell.canvas.addEventListener("pointermove", (e) => {
    const r = shell.canvas.getBoundingClientRect();
    const wx = (((e.clientX - r.left) / r.width) * 2 - 1) / viewScale[0];
    const wy = (-(((e.clientY - r.top) / r.height) * 2 - 1)) / viewScale[1];
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
      if (p.age > p.life) { puffs.splice(i, 1); continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.r += 0.045 * dt;       // puffs spread as they rise…
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
  shell.slider({
    label: "fog",
    min: 0, max: 1.5, step: 0.01, value: fog,
    onInput: (v) => (fog = v),
  });
  if (opts.mode === "halo" || opts.mode === "forest") {
    shell.slider({
      label: "scatter",
      min: 0, max: 1.15, step: 0.01, value: scatter,
      onInput: (v) => (scatter = v),
    });
  }
  if (opts.mode === "shafts") {
    shell.slider({
      label: "sun height",
      min: 0.05, max: 1, step: 0.01, value: sunHeight,
      format: (v) => (v < 0.25 ? "horizon" : v < 0.6 ? "morning" : "noon"),
      onInput: (v) => (sunHeight = v),
    });
  }
  if (opts.mode === "forest") {
    shell.slider({
      label: "mist depth",
      min: 0.1, max: 1.2, step: 0.01, value: mist,
      onInput: (v) => (mist = v),
    });
    shell.button("view: final", function () {
      debugMode = (debugMode + 1) % DEBUG_NAMES.length;
      const btn = shell.controls.querySelectorAll("button")[0];
      btn.textContent = `view: ${DEBUG_NAMES[debugMode]}`;
    });
  }
  if (opts.mode === "hero") {
    shell.controls.remove();
  }
  shell.setInfo(() => {
    if (modeNum === 1) return `1 lamp · ${rc.cascadeCount} cascades · carry it with your cursor`;
    if (modeNum === 2) return `${rc.cascadeCount} cascades · blow smoke into the shafts with your cursor`;
    return `${rc.cascadeCount} cascades · breathe smoke with your cursor`;
  });

  const writeFP = (): void => {
    const f = new Float32Array(16);
    f.set([viewScale[0], viewScale[1], gw, gh]);
    f.set([time, modeNum, fog, 1.0], 4); // glow = 1
    f.set([lamp[0], lamp[1], bounce, puffs.length], 8);
    f.set([rc.fluence.probes[0], rc.fluence.probes[1], mist, 0], 12);
    dev.queue.writeBuffer(fp, 0, f);
  };

  const writeSky = (): void => {
    if (modeNum === 1) {
      rc.setSky({ zenith: [0, 0, 0], horizon: [0, 0, 0], strength: 0 });
      return;
    }
    if (modeNum === 2) {
      // sun outside the left wall; height on the slider
      const dir: [number, number] = [-1, -0.15 - sunHeight * 1.3];
      const warm = 1 - sunHeight * 0.7;
      rc.setSky({
        zenith: [0.05, 0.08, 0.16],
        horizon: [0.22, 0.16, 0.1],
        sunDir: dir,
        sunSharpness: 150,
        sunIntensity: 10,
        sunColor: [1, 0.95 - warm * 0.4, 0.85 - warm * 0.6],
        strength: 1,
      });
      return;
    }
    // the forest: morning sun, high enough to slant down through the crowns
    rc.setSky({
      zenith: [0.05, 0.09, 0.18],
      horizon: [0.40, 0.26, 0.12],
      sunDir: [-0.6, -0.85],
      sunSharpness: 90,
      sunIntensity: 8.0,
      sunColor: [1, 0.72, 0.38],
      strength: 1,
    });
  };
  writeSky();

  return {
    frame() {
      shell.tick();
      const now = performance.now();
      const dt = Math.min((now - last) / 1000, 1 / 30);
      last = now;
      time += dt;

      // the lamp wanders when nobody is carrying it — slowly, because a
      // fast lamp in scattering fog drags a comet tail of stale glow
      if (modeNum === 1 && now - lastPointer > 4000) {
        lamp = [0.5 * Math.sin(time * 0.16) - 0.15, 0.45 * Math.sin(time * 0.11 + 1.3)];
      }

      stepPuffs(dt);
      writeFP();
      writeSky();
      // sigma: extinction per scene px at density 1 — at fog 1 an e-fold
      // every ~80 px, which reads as "thick" without going black
      // rooms are smaller worlds than the forest — gentler extinction, or
      // the far wall vanishes entirely
      rc.setMedia({ sigma: modeNum === 0 ? 0.013 : 0.008, scatter });

      const enc = dev.createCommandEncoder();

      // fog first (reads LAST frame's fluence for its glow) …
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
      rc.encodeComposite(enc, ctx.getCurrentTexture().createView(), {
        exposure: modeNum === 0 ? 1.9 : 2.1,
        debugMode,
        emitBoost: 0.55,
      });
      dev.queue.submit([enc.finish()]);
    },
    dispose() {
      rc.dispose();
      mediaTex.destroy();
      fp.destroy();
      puffBuf.destroy();
    },
  };
}
