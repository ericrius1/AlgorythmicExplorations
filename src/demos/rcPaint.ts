// Radiance cascades sandbox: paint lights and walls, watch the light field
// answer. No simulation here at all — the scene is your strokes, and the
// cascade slider truncates the hierarchy so you can see what each level buys.

import { Shell, gpuMissing, type Demo } from "../lib/demoShell";
import { getDevice, configureContext } from "../lib/gpu";
import { RadianceCascades, type BrushStamp } from "../lib/radianceCascades";

type BrushMode = "light" | "wall" | "erase";

const LIGHT_COLORS: { name: string; rgb: [number, number, number] }[] = [
  { name: "ember", rgb: [3.4, 1.3, 0.25] },
  { name: "cyan", rgb: [0.5, 2.6, 3.2] },
  { name: "violet", rgb: [2.6, 0.7, 3.4] },
  { name: "white", rgb: [3.0, 2.9, 2.7] },
];

export async function mountRcPaint(container: HTMLElement): Promise<Demo> {
  const dev = await getDevice();
  const shell = new Shell(container, 0.62);
  if (!dev) return gpuMissing(container);
  const ctx = configureContext(shell.canvas, dev);

  const rc = new RadianceCascades(dev, Math.floor(shell.canvas.width / 2), Math.floor(shell.canvas.height / 2));

  let mode: BrushMode = "light";
  let colorIdx = 0;
  let cascades = rc.cascadeCount;
  let debugMode = 0;
  const pending: BrushStamp[] = [];

  // seed the canvas so it speaks before being spoken to: two lights, one wall
  {
    const cx = rc.width / 2;
    const cy = rc.height / 2;
    pending.push(
      { x: cx - rc.width * 0.27, y: cy + rc.height * 0.18, radius: 10, color: LIGHT_COLORS[0].rgb, occlusion: 1 },
      { x: cx + rc.width * 0.3, y: cy - rc.height * 0.22, radius: 8, color: LIGHT_COLORS[1].rgb, occlusion: 1 },
    );
    for (let i = 0; i < 14; i++) {
      pending.push({
        x: cx - rc.width * 0.06 + i * 3.0,
        y: cy - rc.height * 0.05 + i * 1.4,
        radius: 5,
        color: [0, 0, 0],
        occlusion: 1,
      });
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
    const radius = mode === "erase" ? 16 : mode === "wall" ? 5 : 9;
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
      const n = Math.min(Math.ceil(d / 3), 24);
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

  // ---- controls --------------------------------------------------------------
  const modeBtns: Record<BrushMode, HTMLButtonElement> = {} as never;
  const setMode = (m: BrushMode): void => {
    mode = m;
    for (const [k, b] of Object.entries(modeBtns)) {
      b.style.borderColor = k === m ? "var(--accent)" : "var(--border)";
    }
  };
  const addModeButton = (m: BrushMode, label: string): void => {
    shell.button(label, () => setMode(m));
    modeBtns[m] = shell.controls.querySelectorAll("button")[shell.controls.querySelectorAll("button").length - 1] as HTMLButtonElement;
  };
  addModeButton("light", "✦ paint light");
  addModeButton("wall", "▪ paint wall");
  addModeButton("erase", "◌ erase");
  shell.button(`color: ${LIGHT_COLORS[0].name}`, function () {
    colorIdx = (colorIdx + 1) % LIGHT_COLORS.length;
    const btns = shell.controls.querySelectorAll("button");
    btns[3].textContent = `color: ${LIGHT_COLORS[colorIdx].name}`;
    setMode("light");
  });
  shell.slider({
    label: "cascades",
    min: 1, max: rc.cascadeCount, step: 1, value: cascades,
    format: (v) => `${v} of ${rc.cascadeCount}`,
    onInput: (v) => (cascades = Math.round(v)),
  });
  shell.button("view: final", () => {
    debugMode = debugMode === 0 ? 3 : 0; // toggle final ↔ distance field
    const btns = shell.controls.querySelectorAll("button");
    btns[4].textContent = debugMode === 0 ? "view: final" : "view: distance field";
  });
  shell.button("clear", () => {
    const enc = dev.createCommandEncoder();
    rc.clearScene(enc);
    dev.queue.submit([enc.finish()]);
  });
  setMode("light");
  shell.setInfo(
    () => `${rc.cascadeCount} cascades over ${rc.width}×${rc.height} · draw with your cursor`,
  );

  return {
    frame() {
      shell.tick();
      const enc = dev.createCommandEncoder();
      const n = Math.min(pending.length, 60);
      for (let i = 0; i < n; i++) rc.brush(enc, pending[i]);
      pending.splice(0, n);
      rc.encodeGI(enc, cascades);
      rc.encodeComposite(enc, ctx.getCurrentTexture().createView(), {
        exposure: 1.5,
        emitBoost: 0.7,
        debugMode,
      });
      dev.queue.submit([enc.finish()]);
    },
    dispose() {
      rc.dispose();
    },
  };
}
