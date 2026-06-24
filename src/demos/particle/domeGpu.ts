// Unified dome demo: multiple substance modes share one hemispheric shell.
// Press M to cycle substances. / toggles Tweakpane + stats; . resets params.

import { Shell, gpuMissing, type Demo } from "../../lib/demoShell";
import { createDevTools } from "../../lib/devTools";
import { getDevice, configureContext } from "../../lib/gpu";
import { Renderer3D } from "../../lib/renderer3d";
import { Pyramid3DSolver } from "../../lib/pyramid3dSolver";
import { Sph3DSolver } from "../../lib/sph3dSolver";
import { seedDome, seedDomeFluid } from "../../lib/seed3d";
import { PARAM_SCHEMA, SCHEMA_VERSION, type DomeParams } from "./domeGpu.params";

export type DomeSubstance = "nbody" | "water";

const SUBSTANCES: DomeSubstance[] = ["nbody", "water"];
const LABELS: Record<DomeSubstance, string> = {
  nbody: "n-body gravity",
  water: "SPH water",
};

export interface DomeDemoOptions {
  count?: number;
  steps?: number;
  hero?: boolean;
  startMode?: DomeSubstance;
}

export async function mountDome(container: HTMLElement, opts: DomeDemoOptions = {}): Promise<Demo> {
  const dev = await getDevice();
  const shell = new Shell(container, opts.hero ? 0.56 : 0.62);
  if (!dev) return gpuMissing(container);
  const ctx = configureContext(shell.canvas, dev);
  const renderer = new Renderer3D(dev, ctx);
  renderer.camera.attach(shell.canvas);

  let mode: DomeSubstance = opts.startMode ?? "nbody";
  let nbody: Pyramid3DSolver | null = null;
  let water: Sph3DSolver | null = null;
  let count = opts.count ?? 20000;

  let mouse: [number, number, number] = [99, 99, 99];
  let mouseVel: [number, number, number] = [0, 0, 0];
  let lastMove = 0;
  const stirPlaneZ = 0.42;

  const hud = createDevTools({
    schema: PARAM_SCHEMA,
    schemaVersion: SCHEMA_VERSION,
    storageKey: "algorythmic-dome-params",
    onChange: (p, path) => onParams(p, path),
  });

  if (opts.count !== undefined) hud.values.particles.count = opts.count;
  if (opts.steps !== undefined) hud.values.particles.nbodySteps = opts.steps;
  if (opts.startMode) hud.values.substance.mode = opts.startMode;

  const worldFromPointer = (clientX: number, clientY: number): [number, number, number] | null => {
    const r = shell.canvas.getBoundingClientRect();
    const ndcX = ((clientX - r.left) / r.width) * 2 - 1;
    const ndcY = -(((clientY - r.top) / r.height) * 2 - 1);
    const aspect = shell.canvas.width / shell.canvas.height;
    const { viewProj } = renderer.camera.matrices(aspect);
    const inv = invert4(viewProj);
    if (!inv) return null;
    const near = unproject(ndcX, ndcY, 0, inv);
    const far = unproject(ndcX, ndcY, 1, inv);
    const t = (stirPlaneZ - near[2]) / (far[2] - near[2]);
    if (!Number.isFinite(t)) return null;
    return [near[0] + (far[0] - near[0]) * t, near[1] + (far[1] - near[1]) * t, stirPlaneZ];
  };

  shell.canvas.addEventListener("pointermove", (e) => {
    const w = worldFromPointer(e.clientX, e.clientY);
    if (!w) return;
    const now = performance.now();
    const dtm = Math.min((now - lastMove) / 1000, 0.1) || 0.016;
    lastMove = now;
    if (mouse[0] < 90) {
      const vx = (w[0] - mouse[0]) / dtm;
      const vy = (w[1] - mouse[1]) / dtm;
      const vz = (w[2] - mouse[2]) / dtm;
      const mag = Math.hypot(vx, vy, vz);
      const clamp = mag > 4 ? 4 / mag : 1;
      mouseVel = [
        mouseVel[0] * 0.6 + vx * clamp * 0.4,
        mouseVel[1] * 0.6 + vy * clamp * 0.4,
        mouseVel[2] * 0.6 + vz * clamp * 0.4,
      ];
    }
    mouse = w;
  });
  shell.canvas.addEventListener("pointerleave", () => {
    mouse = [99, 99, 99];
    mouseVel = [0, 0, 0];
  });

  const disposeActive = (): void => {
    nbody?.dispose();
    water?.dispose();
    nbody = null;
    water = null;
  };

  const applyCamera = (p: DomeParams): void => {
    renderer.camera.elevation = p.camera.elevation;
    renderer.camera.distance = p.camera.distance;
  };

  const applySolvers = (p: DomeParams): void => {
    if (nbody) {
      nbody.shellK = p.dome.shellK;
      nbody.shellR = p.dome.shellR;
      nbody.gScale = p.nbody.gScale;
      nbody.theta = p.nbody.theta;
      nbody.damping = p.nbody.damping;
    }
    if (water) {
      water.shellK = p.dome.shellK;
      water.shellR = p.dome.shellR;
      water.steps = p.water.steps;
      water.gravity = p.water.gravity;
      water.stiffness = p.water.stiffness;
      water.restDensity = p.water.restDensity;
      water.mouseStrength = p.water.mouseStrength;
    }
  };

  const activate = (next: DomeSubstance, p: DomeParams): void => {
    disposeActive();
    mode = next;
    count = Math.round(p.particles.count);
    if (next === "nbody") {
      nbody = new Pyramid3DSolver(dev, seedDome(count, { radius: p.dome.shellR }));
      renderer.bind(nbody.pos, nbody.vel);
    } else {
      water = new Sph3DSolver(dev, seedDomeFluid(count, { radius: p.dome.shellR * 0.92 }));
      renderer.bind(water.pos, water.vel);
    }
    applySolvers(p);
  };

  const needsReseed = (path: string): boolean =>
    path === "reset" ||
    path === "substance.mode" ||
    path === "particles.count" ||
    path === "dome.shellR";

  const onParams = (p: DomeParams, path: string): void => {
    applyCamera(p);
    const nextMode = p.substance.mode;
    if (needsReseed(path) || nextMode !== mode) {
      activate(nextMode, p);
      return;
    }
    applySolvers(p);
  };

  activate(hud.values.substance.mode, hud.values);
  applyCamera(hud.values);

  const onKey = (e: KeyboardEvent): void => {
    if (e.code !== "KeyM" || e.repeat) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    const idx = SUBSTANCES.indexOf(hud.values.substance.mode);
    hud.values.substance.mode = SUBSTANCES[(idx + 1) % SUBSTANCES.length];
    hud.persist();
    onParams(hud.values, "substance.mode");
  };
  window.addEventListener("keydown", onKey);

  shell.setInfo(() =>
    opts.hero
      ? `${count.toLocaleString()} · ${LABELS[mode]} on a dome · M switch · / pane · . reset`
      : `${count.toLocaleString()} · ${LABELS[mode]} · M cycles · / pane · . reset`,
  );

  return {
    frame() {
      shell.tick();
      hud.tick();
      const p = hud.values;
      const enc = dev.createCommandEncoder();
      const pointSize = p.particles.pointSize;
      if (mode === "nbody" && nbody) {
        nbody.writeParams();
        const pass = enc.beginComputePass();
        for (let s = 0; s < p.particles.nbodySteps; s++) nbody.encode(pass);
        pass.end();
        renderer.encode(enc, count, { size: pointSize, colorScale: p.render.colorScale });
      } else if (water) {
        water.mouse = mouse;
        water.mouseVel = mouseVel;
        water.encode(enc);
        renderer.encode(enc, count, { size: pointSize, colorScale: p.water.colorScale });
      }
      dev.queue.submit([enc.finish()]);
    },
    dispose() {
      window.removeEventListener("keydown", onKey);
      hud.dispose();
      disposeActive();
    },
  };
}

function unproject(x: number, y: number, z: number, inv: Float32Array): [number, number, number] {
  const w = 1 / (inv[3] * x + inv[7] * y + inv[11] * z + inv[15]);
  return [
    (inv[0] * x + inv[4] * y + inv[8] * z + inv[12]) * w,
    (inv[1] * x + inv[5] * y + inv[9] * z + inv[13]) * w,
    (inv[2] * x + inv[6] * y + inv[10] * z + inv[14]) * w,
  ];
}

function invert4(m: Float32Array): Float32Array | null {
  const out = new Float32Array(16);
  const a = m;
  const b00 = a[0] * a[5] - a[1] * a[4];
  const b01 = a[0] * a[6] - a[2] * a[4];
  const b02 = a[0] * a[7] - a[3] * a[4];
  const b03 = a[1] * a[6] - a[2] * a[5];
  const b04 = a[1] * a[7] - a[3] * a[5];
  const b05 = a[2] * a[7] - a[3] * a[6];
  const b06 = a[8] * a[13] - a[9] * a[12];
  const b07 = a[8] * a[14] - a[10] * a[12];
  const b08 = a[8] * a[15] - a[11] * a[12];
  const b09 = a[9] * a[14] - a[10] * a[13];
  const b10 = a[9] * a[15] - a[11] * a[13];
  const b11 = a[10] * a[15] - a[11] * a[14];
  let det =
    b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (Math.abs(det) < 1e-12) return null;
  det = 1 / det;
  out[0] = (a[5] * b11 - a[6] * b10 + a[7] * b09) * det;
  out[1] = (-a[1] * b11 + a[2] * b10 - a[3] * b09) * det;
  out[2] = (a[13] * b05 - a[14] * b04 + a[15] * b03) * det;
  out[3] = (-a[9] * b05 + a[10] * b04 - a[11] * b03) * det;
  out[4] = (-a[4] * b11 + a[6] * b08 - a[7] * b07) * det;
  out[5] = (a[0] * b11 - a[2] * b08 + a[3] * b07) * det;
  out[6] = (-a[12] * b05 + a[14] * b02 - a[15] * b01) * det;
  out[7] = (a[8] * b05 - a[10] * b02 + a[11] * b01) * det;
  out[8] = (a[4] * b10 - a[5] * b08 + a[7] * b06) * det;
  out[9] = (-a[0] * b10 + a[1] * b08 - a[3] * b06) * det;
  out[10] = (a[12] * b04 - a[13] * b02 + a[15] * b00) * det;
  out[11] = (-a[8] * b04 + a[9] * b02 - a[11] * b00) * det;
  out[12] = (-a[4] * b09 + a[5] * b07 - a[6] * b06) * det;
  out[13] = (a[0] * b09 - a[1] * b07 + a[2] * b06) * det;
  out[14] = (-a[12] * b03 + a[13] * b01 - a[14] * b00) * det;
  out[15] = (a[8] * b03 - a[9] * b01 + a[10] * b00) * det;
  return out;
}
