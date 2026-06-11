// Part two's demos, all driven by bonfire.wgsl:
//   hero / full / dusk — the bonfire scene (mode 0)
//   sparks            — the many-lights counting room (mode 1)
//   room              — the colored-wall bounce room (mode 2)
// The full bonfire can also hand the fire to your hands (micro-handpose):
// your palm stirs the wind, your index fingertip sheds embers.

import bonfireShader from "../shaders/bonfire.wgsl?raw";
import { Shell, gpuMissing, type Demo } from "../lib/demoShell";
import { getDevice, configureContext } from "../lib/gpu";
import { RadianceCascades } from "../lib/radianceCascades";
import { HandTracker } from "../lib/hands";

const DEBUG_NAMES = ["final", "scene (what the rays see)", "occupancy", "distance field", "light only"];

export interface BonfireOptions {
  mode: "hero" | "full" | "dusk" | "sparks" | "room";
}

interface SkyKeyframe {
  zenith: [number, number, number];
  horizon: [number, number, number];
  sunDir: [number, number];
  sunIntensity: number;
  sunSharpness: number;
  sunColor: [number, number, number];
}

const NIGHT: SkyKeyframe = {
  zenith: [0.004, 0.006, 0.016], horizon: [0.012, 0.016, 0.035],
  sunDir: [0.3, -1], sunIntensity: 0, sunSharpness: 40, sunColor: [1, 1, 1],
};
const DUSK: SkyKeyframe = {
  zenith: [0.02, 0.03, 0.09], horizon: [0.5, 0.2, 0.07],
  sunDir: [0.92, -0.2], sunIntensity: 1.3, sunSharpness: 48, sunColor: [1, 0.45, 0.15],
};
const DAY: SkyKeyframe = {
  zenith: [0.12, 0.24, 0.5], horizon: [0.55, 0.6, 0.66],
  sunDir: [0.35, -1], sunIntensity: 1.7, sunSharpness: 90, sunColor: [1, 0.95, 0.85],
};

function lerp3(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function skyAt(t: number): SkyKeyframe {
  const [a, b, f] = t < 0.5 ? [NIGHT, DUSK, t * 2] : [DUSK, DAY, (t - 0.5) * 2];
  return {
    zenith: lerp3(a.zenith, b.zenith, f),
    horizon: lerp3(a.horizon, b.horizon, f),
    sunDir: [a.sunDir[0] + (b.sunDir[0] - a.sunDir[0]) * f, a.sunDir[1] + (b.sunDir[1] - a.sunDir[1]) * f],
    sunIntensity: a.sunIntensity + (b.sunIntensity - a.sunIntensity) * f,
    sunSharpness: a.sunSharpness + (b.sunSharpness - a.sunSharpness) * f,
    sunColor: lerp3(a.sunColor, b.sunColor, f),
  };
}

export async function mountBonfire(container: HTMLElement, opts: BonfireOptions): Promise<Demo> {
  const dev = await getDevice();
  const shell = new Shell(container, opts.mode === "hero" ? 0.52 : 0.62);
  if (!dev) return gpuMissing(container);
  const ctx = configureContext(shell.canvas, dev);

  const fire = opts.mode === "hero" || opts.mode === "full" || opts.mode === "dusk";
  const modeNum = fire ? 0 : opts.mode === "sparks" ? 1 : 2;

  const W = shell.canvas.width;
  const Hpx = shell.canvas.height;
  const aspect = W / Hpx;
  const viewScaleY = fire ? 1.0 : 0.98;
  const viewScale: [number, number] = [viewScaleY / aspect, viewScaleY];

  // /3 read soft once the canvas upscaled; /2.5 keeps ember edges crisp
  // without doubling the GI cost (the smoke sim already eats a chunk)
  const rc = new RadianceCascades(dev, Math.floor(W / 2.5), Math.floor(Hpx / 2.5));

  // ---- state ---------------------------------------------------------------------
  let count = opts.mode === "sparks" ? 1024 : opts.mode === "room" ? 0 : opts.mode === "hero" ? 380 : 500;
  const MAX = 8192;
  let wind = modeNum === 1 ? 0.5 : 0.25;
  let bounce = modeNum === 2 ? 1.0 : modeNum === 1 ? 0.4 : 0.7;
  let bounceOn = true;
  let glow = 1.0;
  let fireScale = 1.0;
  let timeOfDay = opts.mode === "dusk" ? 0.5 : 0.07;
  let debugMode = 0;
  let time = 0;
  let last = performance.now();

  // ---- GPU resources ---------------------------------------------------------------
  const module = dev.createShaderModule({ code: bonfireShader });
  const bp = dev.createBuffer({ size: 112, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const linSamp = dev.createSampler({ magFilter: "linear", minFilter: "linear" });

  const embers = dev.createBuffer({ size: MAX * 32, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  {
    const init = new Float32Array(MAX * 8);
    for (let i = 0; i < MAX; i++) {
      init[i * 8] = Math.random() * 2 - 1; // sparks start scattered; embers respawn anyway
      init[i * 8 + 1] = Math.random() * 2 - 1;
      init[i * 8 + 4] = Math.random() * 4; // life, staggered
      init[i * 8 + 5] = 4;
      init[i * 8 + 6] = Math.random(); // heat
      init[i * 8 + 7] = Math.random(); // seed
    }
    dev.queue.writeBuffer(embers, 0, init);
  }

  const simPipe = dev.createComputePipeline({
    layout: "auto",
    compute: { module, entryPoint: "emberSim" },
  });
  const splatPipe = dev.createRenderPipeline({
    layout: "auto",
    vertex: { module, entryPoint: "vsEmber" },
    fragment: {
      module,
      entryPoint: "fsEmber",
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
  const scenePipe = dev.createRenderPipeline({
    layout: "auto",
    vertex: { module, entryPoint: "vsFullB" },
    fragment: { module, entryPoint: "fsScene", targets: [{ format: "rgba16float" }] },
    primitive: { topology: "triangle-list" },
  });

  const simGroup = dev.createBindGroup({
    layout: simPipe.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: bp } },
      { binding: 1, resource: { buffer: embers } },
    ],
  });
  const splatGroup = dev.createBindGroup({
    layout: splatPipe.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: bp } },
      { binding: 4, resource: { buffer: embers } },
    ],
  });
  const sceneGroup = dev.createBindGroup({
    layout: scenePipe.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: bp } },
      { binding: 2, resource: rc.fluence.view },
      { binding: 3, resource: linSamp },
    ],
  });

  // ---- stirring: cursor, idle ghost, hands -------------------------------------------
  let stir: [number, number] = [99, 99];
  let stirVel: [number, number] = [0, 0];
  let lastMove = 0;
  let lastPointer = 0;
  shell.canvas.addEventListener("pointermove", (e) => {
    const r = shell.canvas.getBoundingClientRect();
    const cx = ((e.clientX - r.left) / r.width) * 2 - 1;
    const cy = -(((e.clientY - r.top) / r.height) * 2 - 1);
    const wx = cx / viewScale[0];
    const wy = cy / viewScale[1];
    const now = performance.now();
    const dtm = Math.min((now - lastMove) / 1000, 0.1) || 0.016;
    lastMove = now;
    lastPointer = now;
    if (stir[0] < 90) {
      const vx = (wx - stir[0]) / dtm;
      const vy = (wy - stir[1]) / dtm;
      const mag = Math.hypot(vx, vy);
      const c = mag > 5 ? 5 / mag : 1;
      stirVel = [stirVel[0] * 0.6 + vx * c * 0.4, stirVel[1] * 0.6 + vy * c * 0.4];
    }
    stir = [wx, wy];
  });
  shell.canvas.addEventListener("pointerleave", () => {
    stir = [99, 99];
    stirVel = [0, 0];
  });

  let tracker: HandTracker | null = null;
  let emit2: [number, number] = [99, 99];
  let emit2On = 0;
  let lastPalm: [number, number] | null = null;

  const handToWorld = (hx: number, hy: number): [number, number] => [
    (hx * 2 - 1) / viewScale[0],
    (1 - hy * 2) / viewScale[1],
  ];

  const pollHands = (dt: number): void => {
    emit2On = 0;
    if (!tracker?.running || tracker.hands.length === 0) {
      lastPalm = null;
      return;
    }
    const h = tracker.hands[0];
    const palm = handToWorld(h.palm[0], h.palm[1]);
    if (lastPalm) {
      const vx = (palm[0] - lastPalm[0]) / Math.max(dt, 1e-3);
      const vy = (palm[1] - lastPalm[1]) / Math.max(dt, 1e-3);
      const mag = Math.hypot(vx, vy);
      const c = mag > 5 ? 5 / mag : 1;
      stirVel = [stirVel[0] * 0.5 + vx * c * 0.5, stirVel[1] * 0.5 + vy * c * 0.5];
      stir = palm;
    }
    lastPalm = palm;
    // index fingertip sheds embers — more when pinched (a "strike" gesture)
    const tip = handToWorld(h.lm[8 * 3], h.lm[8 * 3 + 1]);
    emit2 = tip;
    emit2On = 1;
  };

  // ---- controls -------------------------------------------------------------------------
  if (opts.mode === "sparks") {
    shell.slider({
      label: "lights",
      min: 16, max: MAX, step: 16, value: count, log: true,
      format: (v) => Math.round(v).toLocaleString(),
      onInput: (v) => (count = Math.round(v)),
    });
    shell.slider({
      label: "wind",
      min: 0, max: 1.5, step: 0.05, value: wind,
      onInput: (v) => (wind = v),
    });
  }
  if (opts.mode === "room") {
    shell.button("bounce: on", function () {
      bounceOn = !bounceOn;
      const btn = shell.controls.querySelectorAll("button")[0];
      btn.textContent = bounceOn ? "bounce: on" : "bounce: off";
    });
    shell.slider({
      label: "bounce strength",
      min: 0, max: 2.5, step: 0.05, value: bounce,
      onInput: (v) => (bounce = v),
    });
  }
  if (opts.mode === "dusk") {
    shell.slider({
      label: "time of day",
      min: 0, max: 1, step: 0.01, value: timeOfDay,
      format: (v) => (v < 0.25 ? "night" : v < 0.45 ? "late dusk" : v < 0.62 ? "dusk" : v < 0.85 ? "morning" : "day"),
      onInput: (v) => (timeOfDay = v),
    });
  }
  if (opts.mode === "full") {
    shell.slider({
      label: "embers",
      min: 200, max: MAX, step: 100, value: count, log: true,
      format: (v) => Math.round(v).toLocaleString(),
      onInput: (v) => (count = Math.round(v)),
    });
    shell.slider({
      label: "wind",
      min: 0, max: 1.5, step: 0.05, value: wind,
      onInput: (v) => (wind = v),
    });
    shell.slider({
      label: "bounce",
      min: 0, max: 2, step: 0.05, value: bounce,
      onInput: (v) => (bounce = v),
    });
    shell.slider({
      label: "time of day",
      min: 0, max: 1, step: 0.01, value: timeOfDay,
      onInput: (v) => (timeOfDay = v),
    });
    shell.button("view: final", function () {
      debugMode = (debugMode + 1) % DEBUG_NAMES.length;
      const btn = shell.controls.querySelectorAll("button")[0];
      btn.textContent = `view: ${DEBUG_NAMES[debugMode]}`;
    });
    shell.button("✋ hands", () => {
      if (tracker?.running || tracker?.starting) {
        tracker.stop();
        const btn = shell.controls.querySelectorAll("button")[1];
        btn.textContent = "✋ hands";
      } else {
        tracker ??= new HandTracker();
        void tracker.start().then(() => {
          const btn = shell.controls.querySelectorAll("button")[1];
          btn.textContent = "✋ tracking — wave at the fire";
        });
      }
    });
  }
  shell.setInfo(() => {
    if (opts.mode === "sparks") return `${count.toLocaleString()} lights · one render cost · drag to stir`;
    if (opts.mode === "room") return `1 light · ${rc.cascadeCount} cascades · move the lamp with your cursor`;
    return `${count.toLocaleString()} embers · ${rc.cascadeCount} cascades · stir with your cursor`;
  });

  const writeBP = (dt: number): void => {
    const f = new Float32Array(28);
    f.set([viewScale[0], viewScale[1], rc.width, rc.height]);
    const u = new Uint32Array(f.buffer);
    u[4] = count;
    f[5] = dt;
    f[6] = time;
    f[7] = wind;
    f.set([fire ? 0.55 : 0, fire ? 0.55 : 0.25, 0.013, fireScale], 8); // buoyancy, drag, emberSize, fireScale
    f.set([stir[0], stir[1], stirVel[0], stirVel[1]], 12);
    f.set([0.28, 4.0, bounceOn ? bounce : 0, Math.max(0, 1 - timeOfDay * 2.2)], 16); // stirRadius, stirStrength, bounce, night
    f.set([emit2[0], emit2[1], emit2On, glow], 20);
    f.set([rc.fluence.probes[0], rc.fluence.probes[1], modeNum, 0], 24);
    dev.queue.writeBuffer(bp, 0, f);
  };

  const writeSky = (): void => {
    if (modeNum !== 0) {
      rc.setSky({ zenith: [0, 0, 0], horizon: [0, 0, 0], strength: 0 });
      return;
    }
    const k = skyAt(timeOfDay);
    rc.setSky({
      zenith: k.zenith,
      horizon: k.horizon,
      sunDir: k.sunDir,
      sunIntensity: k.sunIntensity,
      sunSharpness: k.sunSharpness,
      sunColor: k.sunColor,
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
      pollHands(dt);

      // the bounce room's lamp wanders when nobody is holding it
      if (modeNum === 2 && now - lastPointer > 2500) {
        stir = [0.55 * Math.sin(time * 0.4), 0.5 * Math.sin(time * 0.27 + 1.3)];
        stirVel = [0, 0];
      }

      writeBP(dt);
      writeSky();

      const enc = dev.createCommandEncoder();
      if (count > 0) {
        const pass = enc.beginComputePass();
        pass.setPipeline(simPipe);
        pass.setBindGroup(0, simGroup);
        pass.dispatchWorkgroups(Math.ceil(count / 256));
        pass.end();
      }

      // scene first (reads LAST frame's cascade 0 for the bounce) …
      let pass = enc.beginRenderPass({
        colorAttachments: [{ view: rc.sceneView, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "store" }],
      });
      pass.setPipeline(scenePipe);
      pass.setBindGroup(0, sceneGroup);
      pass.draw(3);
      pass.end();

      // … then the embers on top, additively
      if (count > 0) {
        pass = enc.beginRenderPass({
          colorAttachments: [{ view: rc.sceneView, loadOp: "load", storeOp: "store" }],
        });
        pass.setPipeline(splatPipe);
        pass.setBindGroup(0, splatGroup);
        pass.draw(6, count);
        pass.end();
      }

      rc.encodeGI(enc);
      rc.encodeComposite(enc, ctx.getCurrentTexture().createView(), {
        exposure: 1.5,
        debugMode,
        emitBoost: 0.7,
      });
      dev.queue.submit([enc.finish()]);
    },
    dispose() {
      tracker?.stop();
      rc.dispose();
      embers.destroy();
      bp.destroy();
    },
  };
}
