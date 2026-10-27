// Step demo: the temperature field, naked. Same sim as the lamp, but every
// particle is drawn as a dot coloured by its own temperature — no metaballs,
// no light transport. The point is to watch heat enter at the coil, ride a
// plume up, and leak away near the top. A 2D overlay draws the glass and
// labels at full resolution.

import renderShader from "../../shaders/lavarender.wgsl?raw";
import { Shell, gpuMissing, type Demo } from "../../lib/demoShell";
import { getDevice, configureContext } from "../../lib/gpu";
import { heatRgb, pixelRatio } from "../../lib/palette";
import { LavaSim, LAMP, DEFAULT_KNOBS, H, vesselHalfWidth, type LavaKnobs } from "../../lib/lavaSim";

export async function mountLavaTemp(container: HTMLElement): Promise<Demo> {
  const dev = await getDevice();
  const narrow = (container.clientWidth || window.innerWidth) < 600;
  const shell = new Shell(container, narrow ? 0.95 : 0.62);
  if (!dev) return gpuMissing(container);
  const ctx = configureContext(shell.canvas, dev);

  // overlay for the glass outline, labels and legend
  const stage = document.createElement("div");
  stage.style.position = "relative";
  container.insertBefore(stage, shell.canvas);
  stage.appendChild(shell.canvas);
  const overlay = document.createElement("canvas");
  overlay.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none";
  stage.appendChild(overlay);

  const aspect = shell.canvas.width / shell.canvas.height;
  const viewScaleY = 1.05;
  const viewY = -0.02;
  const viewScale: [number, number] = [viewScaleY / aspect, viewScaleY];

  const knobs: LavaKnobs = { ...DEFAULT_KNOBS };
  const count = 9000;
  const sim = new LavaSim(dev, count);

  const module = dev.createShaderModule({ code: renderShader });
  const rp = dev.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const dotsPipe = dev.createRenderPipeline({
    layout: "auto",
    vertex: { module, entryPoint: "vsDots" },
    fragment: {
      module,
      entryPoint: "fsDots",
      targets: [{
        format: navigator.gpu.getPreferredCanvasFormat(),
        blend: {
          color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
          alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
        },
      }],
    },
    primitive: { topology: "triangle-list" },
  });

  const writeRP = (): void => {
    const f = new Float32Array([
      viewScale[0], viewScale[1], shell.canvas.width, shell.canvas.height,
      H * 2.6, 0.85, 0, 1,
      LAMP.wallBottom, LAMP.wallTop, LAMP.floorY, LAMP.topY,
      LAMP.heaterY, H * 0.8, 0, viewY,
    ]);
    dev.queue.writeBuffer(rp, 0, f);
  };

  // ---- overlay ------------------------------------------------------------------
  const drawOverlay = (): void => {
    const pr = pixelRatio(shell.canvas);
    const cw = shell.canvas.clientWidth || shell.canvas.width / pr;
    const ch = shell.canvas.clientHeight || shell.canvas.height / pr;
    overlay.width = Math.round(cw * pr);
    overlay.height = Math.round(ch * pr);
    const g = overlay.getContext("2d");
    if (!g) return;
    g.setTransform(pr, 0, 0, pr, 0, 0);
    g.clearRect(0, 0, cw, ch);
    const sx = (x: number): number => (x * viewScale[0] * 0.5 + 0.5) * cw;
    const sy = (y: number): number => (0.5 - (y - viewY) * viewScale[1] * 0.5) * ch;

    // glass
    g.strokeStyle = "rgba(170, 185, 215, 0.35)";
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(sx(-LAMP.wallBottom), sy(LAMP.floorY - 0.04));
    g.lineTo(sx(-LAMP.wallTop), sy(LAMP.topY));
    g.lineTo(sx(LAMP.wallTop), sy(LAMP.topY));
    g.lineTo(sx(LAMP.wallBottom), sy(LAMP.floorY - 0.04));
    g.stroke();

    // the coil, and the band where the shader cools hardest (the top 0.28)
    const coilY = sy(LAMP.floorY - 0.025);
    const grad = g.createLinearGradient(sx(-LAMP.wallBottom), 0, sx(LAMP.wallBottom), 0);
    grad.addColorStop(0, "rgba(255,140,60,0.35)");
    grad.addColorStop(0.5, "rgba(255,170,80,0.95)");
    grad.addColorStop(1, "rgba(255,140,60,0.35)");
    g.fillStyle = grad;
    g.fillRect(sx(-LAMP.wallBottom * 0.92), coilY - 2, sx(LAMP.wallBottom * 0.92) - sx(-LAMP.wallBottom * 0.92), 4);
    const coolTop = sy(LAMP.topY);
    const coolBot = sy(LAMP.topY - 0.28);
    const hwCool = vesselHalfWidth(LAMP.topY - 0.14);
    g.setLineDash([3, 4]);
    g.strokeStyle = "rgba(122, 162, 255, 0.45)";
    g.beginPath();
    g.moveTo(sx(-hwCool), coolBot);
    g.lineTo(sx(hwCool), coolBot);
    g.stroke();
    g.setLineDash([]);

    const small = cw < 480;
    const fs = small ? 10.5 : 12;
    g.font = `${fs}px ui-sans-serif, system-ui, sans-serif`;
    g.textBaseline = "middle";
    g.fillStyle = "rgba(255, 190, 120, 0.95)";
    g.textAlign = "left";
    g.fillText("coil: heat in", sx(LAMP.wallBottom) + 10, coilY);
    g.fillStyle = "rgba(160, 185, 255, 0.95)";
    g.fillText("cooling zone", sx(vesselHalfWidth(LAMP.topY - 0.14)) + 10, (coolTop + coolBot) / 2);

    // legend: the same ramp the dots use
    const lw = small ? 88 : 120;
    const lx = 14;
    const ly = ch - 26;
    const lg = g.createLinearGradient(lx, 0, lx + lw, 0);
    for (let i = 0; i <= 8; i++) {
      const [r, gg, b] = heatRgb(i / 8);
      lg.addColorStop(i / 8, `rgb(${r | 0},${gg | 0},${b | 0})`);
    }
    g.fillStyle = lg;
    g.fillRect(lx, ly, lw, 6);
    g.fillStyle = "rgba(200, 206, 222, 0.85)";
    g.font = `${small ? 10 : 11}px ui-sans-serif, system-ui, sans-serif`;
    g.textAlign = "left";
    g.fillText("cold", lx, ly - 9);
    g.textAlign = "right";
    g.fillText("hot", lx + lw, ly - 9);
  };
  drawOverlay();
  const ro = new ResizeObserver(() => drawOverlay());
  ro.observe(shell.canvas);

  // ---- cursor stirring ----------------------------------------------------------
  let mouse: [number, number] = [99, 99];
  let mouseVel: [number, number] = [0, 0];
  let lastMove = 0;
  shell.canvas.addEventListener("pointermove", (e) => {
    const r = shell.canvas.getBoundingClientRect();
    const cx = ((e.clientX - r.left) / r.width) * 2 - 1;
    const cy = -(((e.clientY - r.top) / r.height) * 2 - 1);
    const wx = cx / viewScale[0];
    const wy = cy / viewScale[1] + viewY;
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

  shell.slider({
    label: "coil heat",
    min: 0, max: 3, step: 0.05, value: knobs.heatRate,
    onInput: (v) => (knobs.heatRate = v),
  });
  shell.slider({
    label: "buoyancy",
    min: 0, max: 6, step: 0.1, value: knobs.buoyancy,
    onInput: (v) => (knobs.buoyancy = v),
  });
  shell.slider({
    label: "expansion β",
    min: 0, max: 0.6, step: 0.01, value: knobs.beta,
    onInput: (v) => (knobs.beta = v),
  });
  shell.slider({
    label: "cooling",
    min: 0.1, max: 1.5, step: 0.05, value: knobs.coolRate,
    onInput: (v) => (knobs.coolRate = v),
  });
  let dotGroups: [GPUBindGroup, GPUBindGroup] = [null!, null!];
  const bindDots = (): void => {
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

  // start a few seconds into the cycle, so the first thing you see is a plume
  const warm = (chunks: number): void => {
    sim.writeParams(knobs, 0.0016, mouse, mouseVel);
    for (let c = 0; c < chunks; c++) {
      const enc = dev.createCommandEncoder();
      sim.encodeSteps(enc, 250);
      dev.queue.submit([enc.finish()]);
    }
  };
  warm(8);
  bindDots();

  shell.button("re-melt", () => {
    sim.rebuild(count);
    bindDots();
  });
  shell.setInfo(() => `${count.toLocaleString()} particles · colour = temperature · stir with your cursor`);

  return {
    frame() {
      shell.tick();
      sim.writeParams(knobs, 0.0016, mouse, mouseVel);
      writeRP();
      const enc = dev.createCommandEncoder();
      sim.encodeSteps(enc, 4);
      const pass = enc.beginRenderPass({
        colorAttachments: [{
          view: ctx.getCurrentTexture().createView(),
          clearValue: { r: 0.024, g: 0.027, b: 0.043, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        }],
      });
      pass.setPipeline(dotsPipe);
      pass.setBindGroup(0, dotGroups[sim.currentIndex]);
      pass.draw(6, sim.count);
      pass.end();
      dev.queue.submit([enc.finish()]);
    },
    dispose() {
      ro.disconnect();
      sim.dispose();
      rp.destroy();
    },
  };
}
