// The lamp itself: temperature SPH → metaball splat → scene (emission +
// occlusion) → radiance cascades → composite. Cursor stirs the wax.

import renderShader from "../shaders/lavarender.wgsl?raw";
import { Shell, gpuMissing, type Demo } from "../lib/demoShell";
import { getDevice, configureContext } from "../lib/gpu";
import { LavaSim, LAMP, DEFAULT_KNOBS, H, type LavaKnobs } from "../lib/lavaSim";
import { RadianceCascades } from "../lib/radianceCascades";

const DEBUG_NAMES = ["final", "scene (what the rays see)", "occupancy", "distance field", "light only"];

export interface LavaLampOptions {
  hero?: boolean;
  full?: boolean; // sliders + debug views
}

export async function mountLavaLamp(container: HTMLElement, opts: LavaLampOptions): Promise<Demo> {
  const dev = await getDevice();
  const shell = new Shell(container, opts.hero ? 0.52 : 0.66);
  if (!dev) return gpuMissing(container);
  const ctx = configureContext(shell.canvas, dev);

  const W = shell.canvas.width;
  const Hpx = shell.canvas.height;
  const aspect = W / Hpx;
  const viewScaleY = 1.12;
  const viewScale: [number, number] = [viewScaleY / aspect, viewScaleY];

  // light transport at half resolution — /3 read soft once the canvas
  // upscaled; /2 keeps blob edges crisp and still runs comfortably
  const rc = new RadianceCascades(dev, Math.floor(W / 2), Math.floor(Hpx / 2));

  const knobs: LavaKnobs = { ...DEFAULT_KNOBS };
  let count = opts.hero ? 9000 : 10000;
  let steps = 4;
  let glow = 1.0;
  let exposure = 1.35;
  let debugMode = 0;
  let time = 0;

  const sim = new LavaSim(dev, count);

  // ---- field + scene pipelines ------------------------------------------------
  const module = dev.createShaderModule({ code: renderShader });
  const fieldTex = dev.createTexture({
    size: [rc.width, rc.height],
    format: "rgba16float",
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
  const fieldView = fieldTex.createView();
  const linSamp = dev.createSampler({ magFilter: "linear", minFilter: "linear" });
  const rp = dev.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

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
  const scenePipe = dev.createRenderPipeline({
    layout: "auto",
    vertex: { module, entryPoint: "vsFull" },
    fragment: { module, entryPoint: "fsScene", targets: [{ format: "rgba16float" }] },
    primitive: { topology: "triangle-list" },
  });

  let splatGroups: [GPUBindGroup, GPUBindGroup] = [null!, null!];
  const bindSplat = (): void => {
    splatGroups = sim.buffers.map((b) =>
      dev.createBindGroup({
        layout: splatPipe.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: rp } },
          { binding: 1, resource: { buffer: b } },
        ],
      }),
    ) as [GPUBindGroup, GPUBindGroup];
  };
  const sceneGroup = dev.createBindGroup({
    layout: scenePipe.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: rp } },
      { binding: 2, resource: fieldView },
      { binding: 3, resource: linSamp },
    ],
  });

  const writeRP = (): void => {
    const f = new Float32Array([
      viewScale[0], viewScale[1], rc.width, rc.height,
      H * 6.2, 1.1, time, glow,
      LAMP.wallBottom, LAMP.wallTop, LAMP.floorY, LAMP.topY,
      LAMP.heaterY, H * 0.7, 1, 0,
    ]);
    dev.queue.writeBuffer(rp, 0, f);
  };

  // ---- cursor stirring ----------------------------------------------------------
  let mouse: [number, number] = [99, 99];
  let mouseVel: [number, number] = [0, 0];
  let lastMove = 0;
  shell.canvas.addEventListener("pointermove", (e) => {
    const r = shell.canvas.getBoundingClientRect();
    const cx = ((e.clientX - r.left) / r.width) * 2 - 1;
    const cy = -(((e.clientY - r.top) / r.height) * 2 - 1);
    const wx = cx / viewScale[0];
    const wy = cy / viewScale[1];
    const now = performance.now();
    const dtm = Math.min((now - lastMove) / 1000, 0.1) || 0.016;
    lastMove = now;
    if (mouse[0] < 90) {
      const vx = (wx - mouse[0]) / dtm;
      const vy = (wy - mouse[1]) / dtm;
      const mag = Math.hypot(vx, vy);
      const clampF = mag > 4 ? 4 / mag : 1;
      mouseVel = [mouseVel[0] * 0.6 + vx * clampF * 0.4, mouseVel[1] * 0.6 + vy * clampF * 0.4];
    }
    mouse = [wx, wy];
  });
  shell.canvas.addEventListener("pointerleave", () => {
    mouse = [99, 99];
    mouseVel = [0, 0];
  });

  // ---- controls -------------------------------------------------------------------
  if (opts.full) {
    shell.slider({
      label: "coil heat",
      min: 0.5, max: 6, step: 0.1, value: knobs.heatRate,
      onInput: (v) => (knobs.heatRate = v),
    });
    shell.slider({
      label: "buoyancy",
      min: 3.0, max: 9, step: 0.1, value: knobs.buoyancy,
      onInput: (v) => (knobs.buoyancy = v),
    });
    shell.slider({
      label: "gooiness (XSPH)",
      min: 0.0, max: 0.3, step: 0.01, value: knobs.xsph,
      onInput: (v) => (knobs.xsph = v),
    });
    shell.slider({
      label: "glow",
      min: 0.3, max: 2.5, step: 0.05, value: glow,
      onInput: (v) => (glow = v),
    });
    shell.button("view: final", function (this: void) {
      debugMode = (debugMode + 1) % DEBUG_NAMES.length;
    });
    // relabel the debug button as it cycles
    const btn = shell.controls.querySelectorAll("button")[0];
    btn?.addEventListener("click", () => (btn.textContent = `view: ${DEBUG_NAMES[debugMode]}`));
    shell.button("re-melt", () => {
      sim.rebuild(count);
      bindSplat();
    });
  }
  shell.setInfo(() =>
    opts.hero
      ? `${count.toLocaleString()} wax particles · ${rc.cascadeCount} radiance cascades · stir with your cursor`
      : `${count.toLocaleString()} particles · ${rc.cascadeCount} cascades over a ${rc.width}×${rc.height} field · stir with your cursor`,
  );

  // pre-warm: a head start of pure simulation so the lamp arrives mid-churn
  {
    sim.writeParams(knobs, 0.0016, mouse, mouseVel);
    for (let chunk = 0; chunk < 6; chunk++) {
      const enc = dev.createCommandEncoder();
      sim.encodeSteps(enc, 250);
      dev.queue.submit([enc.finish()]);
    }
  }
  bindSplat();

  return {
    frame() {
      shell.tick();
      time += 1 / 60;
      sim.writeParams(knobs, 0.0016, mouse, mouseVel);
      writeRP();

      const enc = dev.createCommandEncoder();
      sim.encodeSteps(enc, steps);

      // splat particles into the metaball field
      let pass = enc.beginRenderPass({
        colorAttachments: [{ view: fieldView, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "store" }],
      });
      pass.setPipeline(splatPipe);
      pass.setBindGroup(0, splatGroups[sim.currentIndex]);
      pass.draw(6, sim.count);
      pass.end();

      // field → emission + occlusion (plus coil, base, cap, glass)
      pass = enc.beginRenderPass({
        colorAttachments: [{ view: rc.sceneView, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "store" }],
      });
      pass.setPipeline(scenePipe);
      pass.setBindGroup(0, sceneGroup);
      pass.draw(3);
      pass.end();

      rc.encodeGI(enc);
      rc.encodeComposite(enc, ctx.getCurrentTexture().createView(), {
        exposure,
        debugMode,
        emitBoost: 0.55,
      });
      dev.queue.submit([enc.finish()]);
    },
    dispose() {
      sim.dispose();
      rc.dispose();
      fieldTex.destroy();
      rp.destroy();
    },
  };
}
