// Part six's demos.
//   bench    — a 2D optics bench, canvas 2D: one white beam, one glass prism,
//              Snell's law per wavelength. Newton's tabletop.
//   spectrum — canvas 2D: random wavelengths, their colours, and their average
//   hero     — the spectral path tracer: a slit of sunlight through a prism
//   caustics — a glass ball in a beam, with light tracing on a toggle
//   full     — prism and ball: dispersion, aperture, focus, beam spread, drag
//
// The tracer modes share prism.wgsl: progressive accumulation like part five,
// plus a compute pass that traces paths from the light and splats them onto
// the image (caustics), all at about one trace pixel per CSS pixel.

import prismShader from "../../shaders/prism.wgsl?raw";
import { Shell, gpuMissing, type Demo } from "../../lib/demoShell";
import { getDevice, configureContext } from "../../lib/gpu";
import { PostFX, HDR_FORMAT } from "../../lib/postfx";
import { pixelRatio } from "../../lib/palette";

export interface PrismOptions {
  mode: "bench" | "spectrum" | "hero" | "caustics" | "full";
}

// ---- wavelength → linear sRGB (the same fit and scale as prism.wgsl) --------------
// Wyman, Sloan & Shirley's piecewise-Gaussian fit to the CIE 1931 matching
// functions, to linear sRGB, clipped at zero, scaled so that a flat spectrum
// over 380–720 nm averages to (1, 1, 1).

const LAMBDA_MIN = 380;
const LAMBDA_MAX = 720;

function g2(x: number, mu: number, s1: number, s2: number): number {
  const d = (x - mu) / (x < mu ? s1 : s2);
  return Math.exp(-0.5 * d * d);
}

export function wavelengthRGB(l: number): [number, number, number] {
  const x = 1.056 * g2(l, 599.8, 37.9, 31.0) + 0.362 * g2(l, 442.0, 16.0, 26.7) - 0.065 * g2(l, 501.1, 20.4, 26.2);
  const y = 0.821 * g2(l, 568.8, 46.9, 40.5) + 0.286 * g2(l, 530.9, 16.3, 31.1);
  const z = 1.217 * g2(l, 437.0, 11.8, 36.0) + 0.681 * g2(l, 459.0, 26.0, 13.8);
  return [
    Math.max(0, 3.2406 * x - 1.5372 * y - 0.4986 * z) * 1.92985,
    Math.max(0, -0.9689 * x + 1.8758 * y + 0.0415 * z) * 2.94689,
    Math.max(0, 0.0557 * x - 0.204 * y + 1.057 * z) * 3.11081,
  ];
}

// a displayable swatch colour for one wavelength: brightest channel to 1
function spectralCss(l: number, alpha = 1): string {
  const [r, g, b] = wavelengthRGB(l);
  const m = Math.max(r, g, b, 1e-6);
  const e = (v: number): number => Math.round(255 * Math.pow(Math.min(1, v / m), 1 / 2.2));
  return `rgba(${e(r)}, ${e(g)}, ${e(b)}, ${alpha})`;
}

// Cauchy: n(λ) = A + B/λ², λ in µm. Glass presets for the B readouts.
const IOR_BASE = 1.5;
function cauchy(lambdaNm: number, B: number): number {
  const um = lambdaNm / 1000;
  return IOR_BASE + B / (um * um);
}
function glassName(B: number): string {
  if (B < 0.0005) return "none";
  if (B < 0.006) return "crown";
  if (B < 0.012) return "flint";
  if (B < 0.02) return "dense flint";
  return "beyond glass";
}

// ---- the 2D bench --------------------------------------------------------------------

function mountBench(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.56);
  const ctx = shell.canvas.getContext("2d")!;
  const W = shell.canvas.width;
  const H = shell.canvas.height;
  const pr = pixelRatio(shell.canvas);

  let rot = 0;          // prism rotation, radians
  let B = 0.016;        // Cauchy B
  // the beam starts at the left edge; the pointer moves it. Parked so it
  // enters the left face and leaves through the right one.
  let beamY = 0.55;
  let beamAngle = -0.12;

  shell.slider({
    label: "prism rotation",
    min: -40, max: 40, step: 0.5, value: 0,
    format: (v) => `${v.toFixed(1)}°`,
    onInput: (v) => (rot = (v * Math.PI) / 180),
  });
  shell.slider({
    label: "dispersion B",
    min: 0, max: 0.04, step: 0.0005, value: B,
    format: (v) => `${v.toFixed(3)} ${glassName(v)}`,
    onInput: (v) => (B = v),
  });
  const aim = (e: PointerEvent): void => {
    const r = shell.canvas.getBoundingClientRect();
    beamY = Math.min(0.95, Math.max(0.05, (e.clientY - r.top) / r.height));
    beamAngle = ((e.clientX - r.left) / r.width - 0.5) * 0.5 - 0.12;
  };
  shell.canvas.addEventListener("pointermove", aim);
  shell.canvas.addEventListener("pointerdown", aim);

  // refraction of a 2D direction across an edge with unit normal n, η = n1/n2
  const refract2 = (dx: number, dy: number, nx: number, ny: number, eta: number): [number, number] | null => {
    let cosI = -(dx * nx + dy * ny);
    if (cosI < 0) {
      nx = -nx;
      ny = -ny;
      cosI = -cosI;
    }
    const sin2T = eta * eta * (1 - cosI * cosI);
    if (sin2T > 1) return null; // total internal reflection
    const cosT = Math.sqrt(1 - sin2T);
    return [eta * dx + (eta * cosI - cosT) * nx, eta * dy + (eta * cosI - cosT) * ny];
  };

  const NL = 64;
  let info = "";
  shell.setInfo(() => info);

  const frame = (): void => {
    shell.tick();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#06070b";
    ctx.fillRect(0, 0, W, H);

    // an equilateral prism, apex up, rotated about its centroid
    const cx = W * 0.42;
    const cy = H * 0.5;
    const s = Math.min(H * 0.44, W * 0.3);
    const base: [number, number][] = [
      [-0.577 * s, 0.333 * s],
      [0.577 * s, 0.333 * s],
      [0, -0.667 * s],
    ];
    const cR = Math.cos(rot);
    const sR = Math.sin(rot);
    const tri = base.map(([x, y]) => [cx + x * cR - y * sR, cy + x * sR + y * cR]);

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
        if (t > 1e-6 * W && u >= 0 && u <= 1 && (!best || t < best.t)) {
          let nx = ey;
          let ny = -ex;
          const len = Math.hypot(nx, ny);
          nx /= len;
          ny /= len;
          if (nx * ((ax + bx) / 2 - cx) + ny * ((ay + by) / 2 - cy) < 0) {
            nx = -nx;
            ny = -ny;
          }
          best = { t, nx, ny };
        }
      }
      return best;
    };

    // glass body
    const grad = ctx.createLinearGradient(tri[2][0], tri[2][1], cx, tri[0][1]);
    grad.addColorStop(0, "rgba(150, 175, 255, 0.10)");
    grad.addColorStop(1, "rgba(90, 110, 190, 0.04)");
    ctx.fillStyle = grad;
    ctx.strokeStyle = "rgba(170, 195, 255, 0.55)";
    ctx.lineWidth = 1.5 * pr;
    ctx.beginPath();
    ctx.moveTo(tri[0][0], tri[0][1]);
    ctx.lineTo(tri[1][0], tri[1][1]);
    ctx.lineTo(tri[2][0], tri[2][1]);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    const ox = 0;
    const oy = beamY * H;
    const d0: [number, number] = [Math.cos(beamAngle), Math.sin(beamAngle)];
    const entry = hitTri(ox, oy, d0[0], d0[1]);

    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    // the incoming white beam
    const inEnd: [number, number] = entry
      ? [ox + d0[0] * entry.t, oy + d0[1] * entry.t]
      : [ox + d0[0] * W * 1.5, oy + d0[1] * W * 1.5];
    for (const [lw, a] of [[7, 0.12], [2.2, 0.9]] as const) {
      ctx.strokeStyle = `rgba(255, 250, 240, ${a})`;
      ctx.lineWidth = lw * pr;
      ctx.beginPath();
      ctx.moveTo(ox, oy);
      ctx.lineTo(inEnd[0], inEnd[1]);
      ctx.stroke();
    }

    const exitAngles = new Map<number, number>();
    let tirCount = 0;
    if (entry) {
      // every wavelength from 380 to 720 nm; their colours average to white,
      // so where the rays overlap the light adds back up to white
      const strokes: { pts: [number, number][]; lambda: number }[] = [];
      for (let i = 0; i < NL; i++) {
        const lambda = LAMBDA_MIN + ((i + 0.5) / NL) * (LAMBDA_MAX - LAMBDA_MIN);
        const n = cauchy(lambda, B);
        let px = inEnd[0];
        let py = inEnd[1];
        let dir = refract2(d0[0], d0[1], entry.nx, entry.ny, 1 / n);
        if (!dir) continue;
        const pts: [number, number][] = [[px, py]];
        let out = false;
        for (let k = 0; k < 6 && !out; k++) {
          const hit = hitTri(px, py, dir[0], dir[1]);
          if (!hit) break;
          px += dir[0] * hit.t;
          py += dir[1] * hit.t;
          pts.push([px, py]);
          const o = refract2(dir[0], dir[1], hit.nx, hit.ny, n);
          if (o) {
            dir = o;
            out = true;
            if (k === 0) exitAngles.set(i, Math.atan2(o[1], o[0]));
          } else {
            // total internal reflection: bounce and keep going
            if (k === 0) tirCount++;
            const dn: number = dir[0] * hit.nx + dir[1] * hit.ny;
            dir = [dir[0] - 2 * dn * hit.nx, dir[1] - 2 * dn * hit.ny];
          }
        }
        if (out) pts.push([px + dir[0] * W * 1.5, py + dir[1] * W * 1.5]);
        strokes.push({ pts, lambda });
      }
      // each channel peaks near 6 for the purest wavelengths; scale so the
      // full fan sums back to white
      const peak = 6;
      for (const [lw, gain] of [[6, 0.25], [1.6, 1]] as const) {
        for (const { pts, lambda } of strokes) {
          const [r, g, b] = wavelengthRGB(lambda);
          const a = (gain * 0.95 * peak) / NL;
          ctx.strokeStyle = `rgba(${Math.round((255 * r) / peak)}, ${Math.round((255 * g) / peak)}, ${Math.round((255 * b) / peak)}, ${Math.min(1, a)})`;
          ctx.lineWidth = lw * pr;
          ctx.beginPath();
          ctx.moveTo(pts[0][0], pts[0][1]);
          for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k][0], pts[k][1]);
          ctx.stroke();
        }
      }
    }
    ctx.globalCompositeOperation = "source-over";

    // readout from the rays just drawn
    if (!entry) {
      info = "move the beam onto the prism";
    } else if (tirCount === NL) {
      info = "total internal reflection: no colour gets out the second face";
    } else {
      const deg = (r: number): number => (r * 180) / Math.PI;
      const keys = [...exitAngles.keys()];
      if (keys.length >= 2) {
        const lo = Math.min(...keys);
        const hi = Math.max(...keys);
        const spread = Math.abs(deg(exitAngles.get(hi)! - exitAngles.get(lo)!));
        const mid = exitAngles.get(keys[Math.floor(keys.length / 2)])!;
        let dev = Math.abs(deg(mid - beamAngle));
        if (dev > 180) dev = 360 - dev;
        const trapped = tirCount > 0 ? ` · ${Math.round((tirCount / NL) * 100)}% trapped` : "";
        info = `bent ${dev.toFixed(1)}° · red to violet spread ${spread.toFixed(2)}°${trapped}`;
      } else {
        info = "most of the beam is trapped inside";
      }
    }
  };

  return { frame };
}

// ---- the spectrum: random wavelengths average to white -------------------------------

function mountSpectrum(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.5);
  const ctx = shell.canvas.getContext("2d")!;
  const W = shell.canvas.width;
  const H = shell.canvas.height;
  const pr = pixelRatio(shell.canvas);

  let count = 16;
  let roll = 1;
  let dirty = true;
  shell.slider({
    label: "wavelengths averaged",
    min: 1, max: 4096, step: 1, value: count, log: true,
    format: (v) => String(Math.round(v)),
    onInput: (v) => {
      count = Math.max(1, Math.round(v));
      dirty = true;
    },
  });
  shell.button("roll again", () => {
    roll++;
    dirty = true;
  });

  // deterministic dice, so the figure looks the same on every visit
  const dice = (seed: number): (() => number) => {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let z = s;
      z = Math.imul(z ^ (z >>> 15), z | 1);
      z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
      return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
    };
  };

  let avg: [number, number, number] = [1, 1, 1];
  shell.setInfo(() => `average R ${avg[0].toFixed(2)} · G ${avg[1].toFixed(2)} · B ${avg[2].toFixed(2)} (white is 1 · 1 · 1)`);

  const draw = (): void => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#06070b";
    ctx.fillRect(0, 0, W, H);

    const narrow = W / pr < 520;
    const pad = 14 * pr;
    const swW = narrow ? 0 : Math.min(W * 0.26, 220 * pr);
    const plotL = pad + 26 * pr;
    const plotR = W - pad - (narrow ? 0 : swW + pad * 1.5);
    const stripH = 16 * pr;
    const plotT = pad + 8 * pr;
    const plotB = narrow ? H * 0.5 : H - pad - stripH - 30 * pr;
    const X = (l: number): number => plotL + ((l - LAMBDA_MIN) / (LAMBDA_MAX - LAMBDA_MIN)) * (plotR - plotL);
    const ymax = 6.2;
    const Y = (v: number): number => plotB - (v / ymax) * (plotB - plotT);

    // axes
    ctx.strokeStyle = "#2a2f42";
    ctx.lineWidth = 1 * pr;
    ctx.beginPath();
    ctx.moveTo(plotL, plotT);
    ctx.lineTo(plotL, plotB);
    ctx.lineTo(plotR, plotB);
    ctx.stroke();
    ctx.font = `${11 * pr}px ui-monospace, Menlo, monospace`;
    ctx.fillStyle = "#8a91a5";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (const l of [400, 500, 600, 700]) {
      ctx.fillText(String(l), X(l), plotB + stripH + 8 * pr);
    }
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (const v of [0, 2, 4, 6]) ctx.fillText(String(v), plotL - 6 * pr, Y(v));

    // the matching curves, as linear sRGB weights
    const curves: [number, string][] = [[0, "#ff6b6b"], [1, "#6be38f"], [2, "#6b9bff"]];
    for (const [c, col] of curves) {
      ctx.strokeStyle = col;
      ctx.lineWidth = 2 * pr;
      ctx.beginPath();
      for (let l = LAMBDA_MIN; l <= LAMBDA_MAX; l += 2) {
        const v = wavelengthRGB(l)[c];
        if (l === LAMBDA_MIN) ctx.moveTo(X(l), Y(v));
        else ctx.lineTo(X(l), Y(v));
      }
      ctx.stroke();
    }

    // the spectrum strip
    for (let l = LAMBDA_MIN; l < LAMBDA_MAX; l += 1) {
      ctx.fillStyle = spectralCss(l);
      ctx.fillRect(X(l), plotB + 3 * pr, X(l + 1) - X(l) + 1, stripH);
    }

    // the dice: each sample is one wavelength
    const rand = dice(roll * 9973);
    const sum: [number, number, number] = [0, 0, 0];
    const shown = Math.min(count, 160);
    for (let i = 0; i < count; i++) {
      const l = LAMBDA_MIN + rand() * (LAMBDA_MAX - LAMBDA_MIN);
      const c = wavelengthRGB(l);
      sum[0] += c[0];
      sum[1] += c[1];
      sum[2] += c[2];
      if (i < shown) {
        ctx.strokeStyle = spectralCss(l, count > 40 ? 0.55 : 0.95);
        ctx.lineWidth = (count > 40 ? 1 : 2) * pr;
        ctx.beginPath();
        ctx.moveTo(X(l), plotT);
        ctx.lineTo(X(l), plotB);
        ctx.stroke();
      }
    }
    avg = [sum[0] / count, sum[1] / count, sum[2] / count];

    // the average, as a swatch
    const sx = narrow ? plotL : plotR + pad * 1.5;
    const sy = narrow ? plotB + stripH + 30 * pr : plotT;
    const sw = narrow ? plotR - plotL : swW;
    const sh = narrow ? H - sy - pad : plotB + stripH - plotT;
    const enc = (v: number): number => Math.round(255 * Math.pow(Math.min(1, Math.max(0, v * 0.82)), 1 / 2.2));
    ctx.fillStyle = `rgb(${enc(avg[0])}, ${enc(avg[1])}, ${enc(avg[2])})`;
    ctx.beginPath();
    ctx.roundRect(sx, sy, sw, sh, 8 * pr);
    ctx.fill();
    ctx.fillStyle = "rgba(6, 7, 11, 0.75)";
    ctx.font = `600 ${12 * pr}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    const lum = 0.2126 * avg[0] + 0.7152 * avg[1] + 0.0722 * avg[2];
    ctx.fillStyle = lum > 0.5 ? "rgba(6, 7, 11, 0.8)" : "rgba(240, 242, 248, 0.9)";
    ctx.fillText(`average of ${count}`, sx + 10 * pr, sy + 10 * pr);
  };

  return {
    frame() {
      shell.tick();
      if (dirty) {
        draw();
        dirty = false;
      }
    },
  };
}

// ---- the tracer modes ---------------------------------------------------------------

type TracerMode = "hero" | "caustics" | "full";

interface Scene {
  prism: [number, number, number, number]; // x, z, rotation, height (0 = none)
  sphere: [number, number, number, number]; // centre, radius (0 = none)
  aim: [number, number, number];            // where the beam is pointed
  az: number;                               // beam azimuth, radians (direction of travel)
  el: number;                               // beam elevation (downward), radians
  slot: [number, number];                   // slot half-width, half-height
  round: boolean;                           // a round hole instead (radius = slot[0])
  spreadDeg: number;                        // cone half-angle
  B: number;
  eye: [number, number, number];
  look: [number, number, number];
  focal: number;
  aperture: number;
  focus: number;
  lightTracing: boolean;
}

function sceneFor(mode: TracerMode, aspect: number): Scene {
  if (mode === "caustics") {
    return {
      prism: [0, 0, 0, 0],
      sphere: [0, 0.5, 0, 0.5],
      aim: [0, 0.5, 0],
      az: 0.75, el: 0.62,
      slot: [0.6, 0.6],
      round: true,
      spreadDeg: 1.5,
      B: 0,
      eye: [0.1, 2.7, 4.2], look: [0.45, 0.1, 0.45], focal: 2.5,
      aperture: 0, focus: 5,
      lightTracing: false,
    };
  }
  const wide = aspect > 1.5;
  const q = new URLSearchParams(location.search);
  const num = (k: string, d: number): number => (q.has(k) ? Number(q.get(k)) : d);
  return {
    prism: [num("px", -1.2), num("pz", 0.3), num("prot", 0.3), 1.0],
    sphere: [num("sx", -0.15), 0.45, num("sz", -0.8), mode === "full" || num("sph", 0) > 0 ? 0.45 : 0],
    aim: [num("px", -1.2), 0.2, num("pz", 0.3)],
    az: num("az", 0.12), el: num("el", 0.27),
    slot: [0.05, 0.85],
    round: false,
    spreadDeg: 0.27,
    B: num("B", 0.03),
    eye: wide ? [0.3, 5.0, 3.0] : [0.3, 5.6, 3.6],
    look: [0.25, 0.0, -0.75],
    focal: wide ? 2.2 : 1.8,
    aperture: mode === "full" ? 0.04 : 0,
    focus: 5.4,
    lightTracing: true,
  };
}

async function mountTracer(container: HTMLElement, mode: TracerMode): Promise<Demo> {
  const hero = mode === "hero";
  const dev = await getDevice();
  const shell = new Shell(container, hero ? 0.56 : 0.62);
  if (!dev) return gpuMissing(container);
  const ctx = configureContext(shell.canvas, dev);
  const post = new PostFX(dev, ctx);
  post.settings.bloom = 0.12;
  post.settings.radius = 1.2;
  post.settings.vignette = hero ? 0.3 : 0.2;

  const cssW = shell.canvas.clientWidth || shell.canvas.width / Math.min(window.devicePixelRatio || 1, 2);
  const budget = hero ? 900_000 : 400_000;
  let k = Math.max(1, Math.round(shell.canvas.width / cssW));
  while ((shell.canvas.width / k) * (shell.canvas.height / k) > budget) k++;
  const tw = Math.ceil(shell.canvas.width / k);
  const th = Math.ceil(shell.canvas.height / k);

  const sc = sceneFor(mode, tw / th);
  const dbg = new URLSearchParams(location.search).get("cam");
  if (dbg) {
    const v = dbg.split(",").map(Number);
    sc.eye = [v[0], v[1], v[2]];
    sc.look = [v[3], v[4], v[5]];
    sc.focal = v[6] ?? sc.focal;
  }
  let frame = 0;
  let samples = 0;
  let seed = 1;
  let spp = 2;
  let lightPaths = 1 << 18;
  let B = sc.B;
  let aperture = sc.aperture;
  let focus = sc.focus;
  let spread = sc.spreadDeg;
  let az = sc.az;
  let el = sc.el;
  let lightTracing = sc.lightTracing;
  const cap = hero ? 16384 : 8192;
  let dirty = true;

  const reset = (): void => {
    frame = 0;
    samples = 0;
    dirty = true;
  };

  // ---- GPU ---------------------------------------------------------------------
  const module = dev.createShaderModule({ code: prismShader });
  const pp = dev.createBuffer({ size: 176, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const mkAccum = (): GPUTexture[] =>
    [0, 1].map(() =>
      dev.createTexture({
        size: [tw, th],
        format: "rgba32float",
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      }),
    );
  const camAcc = mkAccum();
  const lightAcc = mkAccum();
  const camViews = camAcc.map((t) => t.createView());
  const lightViews = lightAcc.map((t) => t.createView());
  const splat = dev.createBuffer({ size: tw * th * 3 * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });

  const tracePipe = dev.createRenderPipeline({
    layout: "auto",
    vertex: { module, entryPoint: "vsFullP" },
    fragment: { module, entryPoint: "fsTraceP", targets: [{ format: "rgba32float" }, { format: "rgba32float" }] },
    primitive: { topology: "triangle-list" },
  });
  const lightPipe = dev.createComputePipeline({ layout: "auto", compute: { module, entryPoint: "lightTrace" } });
  const displayPipe = dev.createRenderPipeline({
    layout: "auto",
    vertex: { module, entryPoint: "vsFullP" },
    fragment: { module, entryPoint: "fsDisplayP", targets: [{ format: HDR_FORMAT }] },
    primitive: { topology: "triangle-list" },
  });
  const traceGroups = [0, 1].map((i) =>
    dev.createBindGroup({
      layout: tracePipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: pp } },
        { binding: 1, resource: camViews[i] },
        { binding: 2, resource: lightViews[i] },
        { binding: 4, resource: { buffer: splat } },
      ],
    }),
  );
  const lightGroup = dev.createBindGroup({
    layout: lightPipe.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: pp } },
      { binding: 3, resource: { buffer: splat } },
    ],
  });
  const displayGroups = [0, 1].map((i) =>
    dev.createBindGroup({
      layout: displayPipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: pp } },
        { binding: 5, resource: camViews[i] },
        { binding: 6, resource: lightViews[i] },
      ],
    }),
  );

  // ---- interaction ---------------------------------------------------------------
  if (mode === "full") {
    // drag sideways to swing the beam around the prism, up and down to raise it
    let drag: { x: number; y: number; az: number; el: number } | null = null;
    shell.canvas.style.touchAction = "none";
    shell.canvas.addEventListener("pointerdown", (e) => {
      drag = { x: e.clientX, y: e.clientY, az, el };
      shell.canvas.setPointerCapture(e.pointerId);
    });
    shell.canvas.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const r = shell.canvas.getBoundingClientRect();
      az = drag.az + ((e.clientX - drag.x) / r.width) * 1.6;
      el = Math.max(0.15, Math.min(1.1, drag.el + ((e.clientY - drag.y) / r.height) * 0.9));
      reset();
    });
    const up = (): void => {
      drag = null;
    };
    shell.canvas.addEventListener("pointerup", up);
    shell.canvas.addEventListener("pointercancel", up);
  }

  if (mode === "caustics") {
    const ltBtn = shell.button("light tracing: off", () => {
      lightTracing = !lightTracing;
      ltBtn.textContent = lightTracing ? "light tracing: on" : "light tracing: off";
      reset();
    });
    shell.slider({
      label: "beam spread",
      min: 0.25, max: 6, step: 0.05, value: spread,
      format: (v) => `${v.toFixed(2)}°`,
      onInput: (v) => {
        spread = v;
        reset();
      },
    });
    shell.slider({
      label: "dispersion B",
      min: 0, max: 0.04, step: 0.0005, value: B,
      format: (v) => v.toFixed(3),
      onInput: (v) => {
        B = v;
        reset();
      },
    });
  }
  if (mode === "full") {
    shell.slider({
      label: "dispersion B",
      min: 0, max: 0.04, step: 0.0005, value: B,
      format: (v) => v.toFixed(3),
      onInput: (v) => {
        B = v;
        reset();
      },
    });
    shell.slider({
      label: "aperture",
      min: 0, max: 0.2, step: 0.002, value: aperture,
      format: (v) => (v < 0.003 ? "pinhole" : `${(v * 2).toFixed(2)} wide`),
      onInput: (v) => {
        aperture = v;
        reset();
      },
    });
    shell.slider({
      label: "focus distance",
      min: 3.5, max: 8, step: 0.02, value: focus,
      format: (v) => v.toFixed(2),
      onInput: (v) => {
        focus = v;
        reset();
      },
    });
    shell.slider({
      label: "beam spread",
      min: 0.1, max: 4, step: 0.01, value: spread,
      format: (v) => `${v.toFixed(2)}°`,
      onInput: (v) => {
        spread = v;
        reset();
      },
    });
  }
  shell.setInfo(() => {
    const s = samples.toLocaleString();
    const done = samples >= cap ? " (done)" : "";
    if (mode === "hero") return `${s} samples per pixel${done} · one wavelength per path`;
    if (mode === "full") return `${s} samples per pixel${done} · drag to swing the beam`;
    return `${s} samples per pixel${done}`;
  });

  const writePP = (add: number, lightCount: number): void => {
    const f = new Float32Array(44);
    const dir = [Math.cos(el) * Math.cos(az), -Math.sin(el), Math.cos(el) * Math.sin(az)];
    const half = (spread * Math.PI) / 180;
    const cosMax = Math.cos(half);
    const omega = 2 * Math.PI * (1 - cosMax);
    const dist = 5;
    const pos = [sc.aim[0] - dir[0] * dist, sc.aim[1] - dir[1] * dist, sc.aim[2] - dir[2] * dist];
    f.set([tw, th, frame, add]);
    f.set([...dir, cosMax], 4);
    f.set([...pos, 6], 8); // irradiance across the beam
    f.set([sc.slot[0], sc.slot[1], omega, lightTracing ? 1 : 0], 12);
    f.set(sc.prism, 16);
    f.set(sc.sphere, 20);
    f.set([B, aperture, focus, hero ? 1.05 : 1.0], 24);
    f.set([...sc.eye, sc.focal], 28);
    f.set([...sc.look, samples + add], 32);
    f.set([lightTracing ? frame + (add > 0 ? 1 : 0) : 0, seed, lightCount, sc.round ? 1 : 0], 36);
    dev.queue.writeBuffer(pp, 0, f);
  };

  let dtEma = 16;
  let lastT = performance.now();

  return {
    frame() {
      shell.tick();
      const now = performance.now();
      dtEma += (Math.min(now - lastT, 100) - dtEma) * 0.1;
      lastT = now;
      if (frame > 0 && frame % 15 === 0) {
        // keep the frame rate up; spend what's left on more samples
        if (dtEma < 19 && spp < 8) {
          spp++;
          lightPaths = Math.min(lightPaths * 1.25, 1 << 20);
        } else if (dtEma > 26 && spp > 1) {
          spp--;
          lightPaths = Math.max(lightPaths / 1.25, 1 << 16);
        }
      }

      const tracing = samples < cap;
      if (!tracing && !dirty) return;

      const enc = dev.createCommandEncoder();
      const src = frame % 2;
      const dst = tracing ? 1 - src : src;
      const add = tracing ? Math.min(frame === 0 ? Math.max(spp, 4) : spp, cap - samples) : 0;
      const nLight = lightTracing && tracing ? Math.round(lightPaths / 64) * 64 : 0;
      seed = (seed + 1) % 16777216;
      writePP(add, nLight);

      if (tracing) {
        enc.clearBuffer(splat);
        if (nLight > 0) {
          const cp = enc.beginComputePass();
          cp.setPipeline(lightPipe);
          cp.setBindGroup(0, lightGroup);
          cp.dispatchWorkgroups(nLight / 64);
          cp.end();
        }
        const pass = enc.beginRenderPass({
          colorAttachments: [
            { view: camViews[dst], loadOp: "clear", storeOp: "store" },
            { view: lightViews[dst], loadOp: "clear", storeOp: "store" },
          ],
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
      dev.queue.submit([enc.finish()]);

      if (tracing) {
        frame++;
        samples += add;
      }
      dirty = false;
    },
    dispose() {
      for (const t of [...camAcc, ...lightAcc]) t.destroy();
      pp.destroy();
      splat.destroy();
      post.dispose();
    },
  };
}

export function mountPrism(container: HTMLElement, opts: PrismOptions): Demo | Promise<Demo> {
  if (opts.mode === "bench") return mountBench(container);
  if (opts.mode === "spectrum") return mountSpectrum(container);
  return mountTracer(container, opts.mode);
}
