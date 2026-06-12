// Part six's demos.
//   bench    — a 2D optics bench, canvas-2D: one white beam, one rotatable
//              glass prism, Snell's law per wavelength. Newton's tabletop.
//   hero     — the spectral path tracer: prism + glass sphere, converging
//   caustics — glass sphere over a pale floor; the light-size knob
//   full     — the toy: dispersion, aperture, focus, draggable light
//
// The tracer modes share prism.wgsl, the same progressive-accumulation
// pattern as part five.

import prismShader from "../shaders/prism.wgsl?raw";
import { Shell, gpuMissing, type Demo } from "../lib/demoShell";
import { getDevice, configureContext } from "../lib/gpu";

export interface PrismOptions {
  mode: "bench" | "hero" | "caustics" | "full";
}

// ---- wavelength → css color (same gaussian fits as the shader) ---------------------

function wavelengthRGB(l: number): [number, number, number] {
  const g = (x: number, mu: number, s: number): number => Math.exp(-0.5 * ((x - mu) / s) ** 2);
  const x = 1.056 * g(l, 599.8, 32) + 0.362 * g(l, 442.0, 21) - 0.065 * g(l, 501.1, 26);
  const y = 0.821 * g(l, 568.8, 43) + 0.286 * g(l, 530.9, 27);
  const z = 1.217 * g(l, 437.0, 15) + 0.681 * g(l, 459.0, 30);
  return [
    Math.max(0, 3.2406 * x - 1.5372 * y - 0.4986 * z),
    Math.max(0, -0.9689 * x + 1.8758 * y + 0.0415 * z),
    Math.max(0, 0.0557 * x - 0.204 * y + 1.057 * z),
  ];
}

// ---- the 2D bench --------------------------------------------------------------------

function mountBench(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.56);
  const ctx = shell.canvas.getContext("2d")!;
  const W = shell.canvas.width;
  const H = shell.canvas.height;

  let rot = 0.12;       // prism rotation
  let disp = 0.55;      // dispersion exaggeration
  let beamY = 0.52;     // beam height (pointer)
  let beamAngle = -0.06;

  shell.slider({
    label: "prism rotation",
    min: -0.6, max: 0.6, step: 0.005, value: rot,
    onInput: (v) => (rot = v),
  });
  shell.slider({
    label: "dispersion",
    min: 0, max: 1, step: 0.01, value: disp,
    format: (v) => (v < 0.02 ? "none — one n for all colors" : v.toFixed(2)),
    onInput: (v) => (disp = v),
  });
  shell.canvas.addEventListener("pointermove", (e) => {
    const r = shell.canvas.getBoundingClientRect();
    beamY = (e.clientY - r.top) / r.height;
    beamAngle = ((e.clientX - r.left) / r.width - 0.35) * 0.25 - 0.06;
  });
  shell.setInfo(() => "move your cursor to aim the beam");

  // refraction of a 2D direction across a line with normal n (unit), n1→n2
  const refract2 = (dx: number, dy: number, nx: number, ny: number, eta: number): [number, number] | null => {
    let cosI = -(dx * nx + dy * ny);
    if (cosI < 0) {
      nx = -nx; ny = -ny; cosI = -cosI;
    }
    const sin2T = eta * eta * (1 - cosI * cosI);
    if (sin2T > 1) return null; // total internal reflection
    const cosT = Math.sqrt(1 - sin2T);
    return [eta * dx + (eta * cosI - cosT) * nx, eta * dy + (eta * cosI - cosT) * ny];
  };

  const frame = (): void => {
    shell.tick();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#06070b";
    ctx.fillRect(0, 0, W, H);

    // prism triangle, rotated about its centroid
    const cx = W * 0.46;
    const cy = H * 0.55;
    const s = H * 0.42;
    const base = [
      [-0.62 * s, 0.35 * s],
      [0.62 * s, 0.35 * s],
      [0, -0.7 * s],
    ];
    const cR = Math.cos(rot);
    const sR = Math.sin(rot);
    const tri = base.map(([x, y]) => [cx + x * cR - y * sR, cy + x * sR + y * cR]);

    ctx.strokeStyle = "rgba(150, 180, 255, 0.55)";
    ctx.fillStyle = "rgba(110, 140, 220, 0.07)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(tri[0][0], tri[0][1]);
    ctx.lineTo(tri[1][0], tri[1][1]);
    ctx.lineTo(tri[2][0], tri[2][1]);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // intersect a ray with the triangle's edges
    const hitTri = (ox: number, oy: number, dx: number, dy: number): { t: number; nx: number; ny: number } | null => {
      let best: { t: number; nx: number; ny: number } | null = null;
      for (let i = 0; i < 3; i++) {
        const [ax, ay] = tri[i];
        const [bx, by] = tri[(i + 1) % 3];
        const ex = bx - ax;
        const ey = by - ay;
        const den = dx * ey - dy * ex;
        if (Math.abs(den) < 1e-9) continue;
        const t = ((ax - ox) * ey - (ay - oy) * ex) / den;
        const u = ((ax - ox) * dy - (ay - oy) * dx) / den;
        if (t > 1e-3 && u >= 0 && u <= 1 && (!best || t < best.t)) {
          // edge normal, pointing outward (away from centroid)
          let nx = ey;
          let ny = -ex;
          const len = Math.hypot(nx, ny);
          nx /= len; ny /= len;
          const mx = (ax + bx) / 2 - cx;
          const my = (ay + by) / 2 - cy;
          if (nx * mx + ny * my < 0) { nx = -nx; ny = -ny; }
          best = { t, nx, ny };
        }
      }
      return best;
    };

    ctx.globalCompositeOperation = "lighter";

    const oy = beamY * H;
    const ox = 0;
    const d0 = [Math.cos(beamAngle), Math.sin(beamAngle)];
    const entry = hitTri(ox, oy, d0[0], d0[1]);

    // the incoming white beam
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    if (entry) ctx.lineTo(ox + d0[0] * entry.t, oy + d0[1] * entry.t);
    else ctx.lineTo(ox + d0[0] * W * 1.5, oy + d0[1] * W * 1.5);
    ctx.stroke();

    if (entry) {
      const NL = 20;
      for (let i = 0; i < NL; i++) {
        const lambda = 395 + (i / (NL - 1)) * 290;
        const um = lambda / 1000;
        const n = 1.45 + (disp * 0.028) / (um * um);
        const [r, g, b] = wavelengthRGB(lambda);
        ctx.strokeStyle = `rgba(${Math.min(255, r * 230)}, ${Math.min(255, g * 230)}, ${Math.min(255, b * 230)}, 0.5)`;
        ctx.lineWidth = 1.4;

        // entry refraction
        let px = ox + d0[0] * entry.t;
        let py = oy + d0[1] * entry.t;
        let dir = refract2(d0[0], d0[1], entry.nx, entry.ny, 1 / n);
        if (!dir) continue;
        ctx.beginPath();
        ctx.moveTo(px, py);
        // up to 4 internal events
        let inside = true;
        for (let k = 0; k < 4 && inside; k++) {
          const hit2 = hitTri(px, py, dir[0], dir[1]);
          if (!hit2) { inside = false; break; }
          px += dir[0] * hit2.t;
          py += dir[1] * hit2.t;
          ctx.lineTo(px, py);
          const out = refract2(dir[0], dir[1], hit2.nx, hit2.ny, n);
          if (out) {
            dir = out;
            inside = false;
          } else {
            // total internal reflection: bounce and keep going
            const dot = dir[0] * hit2.nx + dir[1] * hit2.ny;
            dir = [dir[0] - 2 * dot * hit2.nx, dir[1] - 2 * dot * hit2.ny];
          }
        }
        // the escaping ray
        ctx.lineTo(px + dir[0] * W, py + dir[1] * W);
        ctx.stroke();
      }
    }
    ctx.globalCompositeOperation = "source-over";
  };

  return { frame };
}

// ---- the tracer modes ---------------------------------------------------------------

const TRACER_DEFAULTS = {
  hero: { sphere: 1, prism: 1, disp: 0.6, aperture: 0.0, lightSize: 0.22 },
  caustics: { sphere: 1, prism: 0, disp: 0.0, aperture: 0.0, lightSize: 0.45 },
  full: { sphere: 1, prism: 1, disp: 0.6, aperture: 0.05, lightSize: 0.2 },
};

async function mountTracer(container: HTMLElement, mode: "hero" | "caustics" | "full"): Promise<Demo> {
  const dev = await getDevice();
  const shell = new Shell(container, mode === "hero" ? 0.56 : 0.62);
  if (!dev) return gpuMissing(container);
  const ctx = configureContext(shell.canvas, dev);

  const W = shell.canvas.width;
  const Hpx = shell.canvas.height;
  const tw = Math.floor(W / 2);
  const th = Math.floor(Hpx / 2);

  const def = TRACER_DEFAULTS[mode];
  let frame = 0;
  let samples = 0;
  const spp = 2;
  let lightPos: [number, number] = [-0.5, -0.4];
  let lightSize = def.lightSize;
  let dispersion = def.disp;
  let aperture = def.aperture;
  let focusDist = 4.3;

  const reset = (): void => {
    frame = 0;
    samples = 0;
  };

  const module = dev.createShaderModule({ code: prismShader });
  const pp = dev.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
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
    vertex: { module, entryPoint: "vsFullP" },
    fragment: { module, entryPoint: "fsTraceP", targets: [{ format: "rgba32float" }] },
    primitive: { topology: "triangle-list" },
  });
  const displayPipe = dev.createRenderPipeline({
    layout: "auto",
    vertex: { module, entryPoint: "vsFullP" },
    fragment: { module, entryPoint: "fsDisplayP", targets: [{ format: navigator.gpu.getPreferredCanvasFormat() }] },
    primitive: { topology: "triangle-list" },
  });
  const traceGroups = [0, 1].map((i) =>
    dev.createBindGroup({
      layout: tracePipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: pp } },
        { binding: 1, resource: accumViews[i] },
      ],
    }),
  );
  const displayGroups = [0, 1].map((i) =>
    dev.createBindGroup({
      layout: displayPipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: pp } },
        { binding: 2, resource: accumViews[i] },
      ],
    }),
  );

  // drag the light (caustics + full)
  if (mode !== "hero") {
    let dragging = false;
    const place = (e: PointerEvent): void => {
      const r = shell.canvas.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * 2 - 1;
      const z = ((e.clientY - r.top) / r.height) * 2 - 1;
      lightPos = [Math.max(-1.6, Math.min(1.6, x * 2.0)), Math.max(-1.4, Math.min(1.2, z * 1.8))];
      reset();
    };
    shell.canvas.addEventListener("pointerdown", (e) => {
      dragging = true;
      place(e);
    });
    shell.canvas.addEventListener("pointermove", (e) => {
      if (dragging) place(e);
    });
    const up = (): void => {
      dragging = false;
    };
    shell.canvas.addEventListener("pointerup", up);
    shell.canvas.addEventListener("pointerleave", up);
  }

  if (mode === "caustics") {
    shell.slider({
      label: "light size",
      min: 0.04, max: 0.8, step: 0.01, value: lightSize,
      format: (v) => (v < 0.09 ? "near-point" : v.toFixed(2)),
      onInput: (v) => {
        lightSize = v;
        reset();
      },
    });
  }
  if (mode === "full") {
    shell.slider({
      label: "dispersion",
      min: 0, max: 1.4, step: 0.01, value: dispersion,
      onInput: (v) => {
        dispersion = v;
        reset();
      },
    });
    shell.slider({
      label: "aperture",
      min: 0, max: 0.22, step: 0.002, value: aperture,
      format: (v) => (v < 0.003 ? "pinhole" : v.toFixed(3)),
      onInput: (v) => {
        aperture = v;
        reset();
      },
    });
    shell.slider({
      label: "focus distance",
      min: 3.0, max: 6.0, step: 0.02, value: focusDist,
      onInput: (v) => {
        focusDist = v;
        reset();
      },
    });
    shell.slider({
      label: "light size",
      min: 0.04, max: 0.8, step: 0.01, value: lightSize,
      onInput: (v) => {
        lightSize = v;
        reset();
      },
    });
  }
  shell.setInfo(() => {
    const s = samples.toLocaleString();
    if (mode === "hero") return `${s} spp · one wavelength per sample`;
    return `${s} spp · drag to move the light`;
  });

  const writePP = (): void => {
    const f = new Float32Array(16);
    f.set([tw, th, frame, spp]);
    f.set([lightPos[0], lightPos[1], lightSize, dispersion], 4);
    f.set([aperture, focusDist, 9, 1.5], 8); // maxBounces, exposure
    f.set([def.sphere, def.prism, 1, 0], 12); // sphereOn, prismOn, lightBoost
    dev.queue.writeBuffer(pp, 0, f);
  };

  return {
    frame() {
      shell.tick();
      const enc = dev.createCommandEncoder();
      const src = frame % 2;
      const dst = 1 - src;
      writePP();
      let pass = enc.beginRenderPass({
        colorAttachments: [{ view: accumViews[dst], loadOp: "clear", storeOp: "store" }],
      });
      pass.setPipeline(tracePipe);
      pass.setBindGroup(0, traceGroups[src]);
      pass.draw(3);
      pass.end();

      pass = enc.beginRenderPass({
        colorAttachments: [{ view: ctx.getCurrentTexture().createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: "clear", storeOp: "store" }],
      });
      pass.setPipeline(displayPipe);
      pass.setBindGroup(0, displayGroups[dst]);
      pass.draw(3);
      pass.end();

      dev.queue.submit([enc.finish()]);
      frame++;
      samples += spp;
    },
    dispose() {
      for (const t of accum) t.destroy();
      pp.destroy();
    },
  };
}

export function mountPrism(container: HTMLElement, opts: PrismOptions): Demo | Promise<Demo> {
  if (opts.mode === "bench") return mountBench(container);
  return mountTracer(container, opts.mode);
}
