import { Shell, type Demo } from "../../lib/demoShell";

const TAU = Math.PI * 2;

const C = {
  bg: "#06070b",
  panel: "#11131c",
  grid: "#2a2f42",
  text: "#d7dbe6",
  muted: "#8a91a5",
  accent: "#7aa2ff",
  warm: "#ffb86b",
  good: "#7dd6a0",
  red: "#ff8585",
};

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

function smooth01(x: number): number {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clear(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, "#070914");
  g.addColorStop(1, C.bg);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function line(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color = C.grid,
  width = 1,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

function label(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  opts: { color?: string; size?: number; align?: CanvasTextAlign; mono?: boolean } = {},
): void {
  ctx.save();
  ctx.fillStyle = opts.color ?? C.text;
  ctx.textAlign = opts.align ?? "left";
  ctx.textBaseline = "middle";
  const size = opts.size ?? 13;
  ctx.font = opts.mono
    ? `${size}px ui-monospace, Menlo, monospace`
    : `600 ${size}px ui-sans-serif, system-ui, sans-serif`;
  ctx.fillText(text, x, y);
  ctx.restore();
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
}

function syncSlider(input: HTMLInputElement, value: number): void {
  input.value = String(value);
  input.dispatchEvent(new Event("input"));
}

function withCanvas(
  canvas: HTMLCanvasElement,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const cssW = canvas.clientWidth || canvas.width;
  const cssH = canvas.clientHeight || canvas.height;
  const dpr = canvas.width / Math.max(cssW, 1);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw(ctx, cssW, cssH);
}

function pointerPoint(canvas: HTMLCanvasElement, e: PointerEvent): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  const w = canvas.clientWidth || rect.width;
  const h = canvas.clientHeight || rect.height;
  return {
    x: ((e.clientX - rect.left) / Math.max(rect.width, 1)) * w,
    y: ((e.clientY - rect.top) / Math.max(rect.height, 1)) * h,
  };
}

function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

function normAngle(theta: number): number {
  return ((theta % TAU) + TAU) % TAU;
}

function polarMetrics(w: number, h: number, theta: number, radius: number) {
  const mobile = w < 520;
  const s = Math.min(w, h) * 0.26;
  const cx = w * 0.29;
  const cy = h * 0.43;
  const px = cx + Math.cos(theta) * radius * s;
  const py = cy - Math.sin(theta) * radius * s;
  const rx = w * 0.56;
  const ry = h * 0.18;
  const rw = w * 0.34;
  const rh = h * 0.49;
  const ux = rx + (theta / TAU) * rw;
  const uy = ry + rh - radius * rh;
  return { mobile, s, cx, cy, px, py, rx, ry, rw, rh, ux, uy };
}

function drawPolar(ctx: CanvasRenderingContext2D, w: number, h: number, theta: number, radius: number): void {
  clear(ctx, w, h);
  const { mobile, s, cx, cy, px, py, rx, ry, rw, rh, ux, uy } = polarMetrics(w, h, theta, radius);

  // Circle diagram.
  for (let r = 0.25; r <= 1.001; r += 0.25) {
    ctx.strokeStyle = r > 0.99 ? C.accent : C.grid;
    ctx.lineWidth = r > 0.99 ? 2 : 1;
    ctx.beginPath();
    ctx.arc(cx, cy, s * r, 0, TAU);
    ctx.stroke();
  }
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * TAU;
    line(ctx, cx, cy, cx + Math.cos(a) * s, cy - Math.sin(a) * s, i % 4 === 0 ? "#38405c" : C.grid);
  }
  line(ctx, cx - s * 1.13, cy, cx + s * 1.13, cy, "#424862");
  line(ctx, cx, cy + s * 1.13, cx, cy - s * 1.13, "#424862");

  ctx.strokeStyle = C.warm;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(px, py);
  ctx.stroke();

  ctx.strokeStyle = C.good;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, s * 0.34, 0, -theta, true);
  ctx.stroke();
  dot(ctx, px, py, Math.max(5, s * 0.025), C.accent);
  dot(ctx, cx, cy, Math.max(3, s * 0.016), C.text);

  label(ctx, "unit circle", cx - s, cy - s - (mobile ? 14 : 22), { color: C.text, size: mobile ? 12 : 14 });
  label(ctx, "r", (cx + px) * 0.5 + 8, (cy + py) * 0.5 - 8, { color: C.warm, size: 14, mono: true });
  label(ctx, "theta", cx + s * 0.38, cy - s * 0.1, { color: C.good, size: 14, mono: true });
  if (!mobile) {
    label(ctx, `x = ${Math.cos(theta) * radius >= 0 ? " " : ""}${(Math.cos(theta) * radius).toFixed(2)}`, cx - s, cy + s + 28, {
      color: C.muted,
      size: 12,
      mono: true,
    });
    label(ctx, `y = ${(Math.sin(theta) * radius).toFixed(2)}`, cx - s, cy + s + 48, { color: C.muted, size: 12, mono: true });
  }

  // Unwrapped polar texture.
  ctx.fillStyle = C.panel;
  ctx.fillRect(rx, ry, rw, rh);
  ctx.strokeStyle = "#30364d";
  ctx.lineWidth = 1;
  ctx.strokeRect(rx, ry, rw, rh);

  for (let i = 0; i <= 8; i++) {
    const x = rx + (i / 8) * rw;
    line(ctx, x, ry, x, ry + rh, i === 0 || i === 8 ? C.warm : C.grid);
  }
  for (let i = 0; i <= 4; i++) {
    const y = ry + (i / 4) * rh;
    line(ctx, rx, y, rx + rw, y, i === 4 ? "#424862" : C.grid);
  }

  ctx.fillStyle = "rgba(122, 162, 255, 0.12)";
  ctx.fillRect(rx, uy, ux - rx, ry + rh - uy);
  line(ctx, ux, ry, ux, ry + rh, C.good, 2);
  line(ctx, rx, uy, rx + rw, uy, C.warm, 2);
  dot(ctx, ux, uy, 6, C.accent);
  label(ctx, mobile ? "polar UV" : "same point as a texture lookup", rx, ry - (mobile ? 14 : 22), {
    color: C.text,
    size: mobile ? 12 : 14,
  });
  label(ctx, mobile ? "seam" : "theta = 0 seam", rx + 4, ry + rh + (mobile ? 12 : 18), {
    color: C.warm,
    size: mobile ? 9 : 11,
    mono: true,
  });
  label(ctx, mobile ? "2pi" : "theta = 2pi", rx + rw - 4, ry + rh + (mobile ? 12 : 18), {
    color: C.warm,
    size: mobile ? 9 : 11,
    align: "right",
    mono: true,
  });
  if (!mobile) {
    label(ctx, "r = 1 edge", rx + rw + 10, ry + 8, { color: C.muted, size: 11, mono: true });
    label(ctx, "r = 0 center", rx + rw + 10, ry + rh - 8, { color: C.muted, size: 11, mono: true });

    const bottom = h * 0.84;
    label(ctx, "cartesian -> polar:  r = sqrt(x*x + y*y),  theta = atan2(y, x)", w * 0.08, bottom, {
      color: C.text,
      size: 13,
      mono: true,
    });
    label(ctx, "polar -> cartesian:  x = r*cos(theta),  y = r*sin(theta)", w * 0.08, bottom + 24, {
      color: C.muted,
      size: 13,
      mono: true,
    });
  }
}

export function mountPolarCircle(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.86);
  let theta = 1.05;
  let radius = 0.72;
  let orbiting = false;
  let dragging: "circle" | "uv" | null = null;

  const angleSlider = shell.slider({
    label: "angle",
    min: 0,
    max: TAU,
    step: 0.001,
    value: theta,
    format: (v) => `${(v / Math.PI).toFixed(2)}pi`,
    onInput: (v) => {
      theta = v;
    },
  });
  const radiusSlider = shell.slider({
    label: "radius",
    min: 0,
    max: 1,
    step: 0.01,
    value: radius,
    format: (v) => v.toFixed(2),
    onInput: (v) => {
      radius = v;
    },
  });
  shell.button("orbit", () => {
    orbiting = !orbiting;
    orbitButton.textContent = orbiting ? "pause orbit" : "orbit";
  });
  const orbitButton = shell.controls.lastElementChild as HTMLButtonElement;
  shell.button("snap seam", () => syncSlider(angleSlider, 0));

  const syncState = (): void => {
    syncSlider(angleSlider, theta);
    syncSlider(radiusSlider, radius);
  };

  const hitHandle = (x: number, y: number): "circle" | "uv" | null => {
    const m = polarMetrics(shell.canvas.clientWidth, shell.canvas.clientHeight, theta, radius);
    const grabR = Math.max(18, m.s * 0.07);
    const circleHit = dist2(x, y, m.px, m.py) <= grabR * grabR;
    const uvHit = dist2(x, y, m.ux, m.uy) <= grabR * grabR;
    if (circleHit && uvHit) return dist2(x, y, m.px, m.py) < dist2(x, y, m.ux, m.uy) ? "circle" : "uv";
    if (circleHit) return "circle";
    if (uvHit) return "uv";
    if (Math.hypot(x - m.cx, y - m.cy) <= m.s) return "circle";
    if (x >= m.rx && x <= m.rx + m.rw && y >= m.ry && y <= m.ry + m.rh) return "uv";
    return null;
  };

  const applyDrag = (handle: "circle" | "uv", e: PointerEvent): void => {
    const p = pointerPoint(shell.canvas, e);
    const m = polarMetrics(shell.canvas.clientWidth, shell.canvas.clientHeight, theta, radius);
    if (handle === "circle") {
      const dx = p.x - m.cx;
      const dy = m.cy - p.y;
      theta = normAngle(Math.atan2(dy, dx));
      radius = clamp(Math.hypot(dx, dy) / m.s, 0, 1);
    } else {
      theta = clamp((p.x - m.rx) / m.rw, 0, 1) * TAU;
      radius = clamp(1 - (p.y - m.ry) / m.rh, 0, 1);
    }
    syncState();
  };

  shell.canvas.addEventListener("pointerdown", (e) => {
    const p = pointerPoint(shell.canvas, e);
    const handle = hitHandle(p.x, p.y);
    if (!handle) return;
    e.preventDefault();
    dragging = handle;
    orbiting = false;
    orbitButton.textContent = "orbit";
    shell.canvas.setPointerCapture(e.pointerId);
    shell.canvas.style.cursor = "grabbing";
    applyDrag(handle, e);
  });
  shell.canvas.addEventListener("pointermove", (e) => {
    if (dragging) {
      e.preventDefault();
      applyDrag(dragging, e);
      return;
    }
    const p = pointerPoint(shell.canvas, e);
    shell.canvas.style.cursor = hitHandle(p.x, p.y) ? "grab" : "default";
  });
  const stopDrag = (e: PointerEvent): void => {
    if (!dragging) return;
    dragging = null;
    try {
      shell.canvas.releasePointerCapture(e.pointerId);
    } catch {
      // The browser may already have released capture during cancellation.
    }
    const p = pointerPoint(shell.canvas, e);
    shell.canvas.style.cursor = hitHandle(p.x, p.y) ? "grab" : "default";
  };
  shell.canvas.addEventListener("pointerup", stopDrag);
  shell.canvas.addEventListener("pointercancel", stopDrag);
  shell.canvas.addEventListener("pointerleave", () => {
    if (!dragging) shell.canvas.style.cursor = "default";
  });

  shell.setInfo(() => {
    const u = theta / TAU;
    return `drag blue handles · theta ${(theta * 180 / Math.PI).toFixed(1)} deg · r ${radius.toFixed(2)} · texture u ${u.toFixed(3)}`;
  });

  return {
    frame() {
      if (orbiting) {
        theta = (theta + 0.008) % TAU;
        syncSlider(angleSlider, theta);
      }
      withCanvas(shell.canvas, (ctx, w, h) => drawPolar(ctx, w, h, theta, radius));
      shell.tick();
    },
  };
}

type FisheyeMode = {
  name: string;
  formula: string;
  project(theta: number, maxTheta: number): number;
  unproject(rho: number, maxTheta: number): number;
};

const FISHEYE_MODES: FisheyeMode[] = [
  {
    name: "equidistant",
    formula: "rho = theta / thetaMax",
    project: (theta, maxTheta) => theta / maxTheta,
    unproject: (rho, maxTheta) => rho * maxTheta,
  },
  {
    name: "equisolid",
    formula: "rho = sin(theta/2) / sin(thetaMax/2)",
    project: (theta, maxTheta) => Math.sin(theta / 2) / Math.sin(maxTheta / 2),
    unproject: (rho, maxTheta) => 2 * Math.asin(clamp(rho * Math.sin(maxTheta / 2), -1, 1)),
  },
  {
    name: "orthographic",
    formula: "rho = sin(theta) / sin(thetaMax)",
    project: (theta, maxTheta) => Math.sin(theta) / Math.sin(maxTheta),
    unproject: (rho, maxTheta) => Math.asin(clamp(rho * Math.sin(maxTheta), -1, 1)),
  },
  {
    name: "stereographic",
    formula: "rho = tan(theta/2) / tan(thetaMax/2)",
    project: (theta, maxTheta) => Math.tan(theta / 2) / Math.tan(maxTheta / 2),
    unproject: (rho, maxTheta) => 2 * Math.atan(rho * Math.tan(maxTheta / 2)),
  },
];

function fisheyeMetrics(w: number, h: number, thetaDeg: number, phi: number, fovDeg: number, mode: FisheyeMode) {
  const mobile = w < 520;
  const maxTheta = (fovDeg * Math.PI) / 360;
  const theta = clamp((thetaDeg * Math.PI) / 180, 0, maxTheta);
  const rho = clamp(mode.project(theta, maxTheta), 0, 1);
  const rayX = Math.sin(theta) * Math.cos(phi);
  const rayY = Math.sin(theta) * Math.sin(phi);
  const rayZ = Math.cos(theta);
  const fc = { x: w * 0.29, y: h * 0.45 };
  const fr = Math.min(w, h) * 0.26;
  const sampleX = fc.x + Math.cos(phi) * rho * fr;
  const sampleY = fc.y - Math.sin(phi) * rho * fr;
  const dcx = w * 0.73;
  const dcy = h * 0.72;
  const dr = Math.min(w, h) * 0.31;
  const sideX = dcx + Math.sin(theta) * dr;
  const sideY = dcy - Math.cos(theta) * dr;
  return { mobile, maxTheta, theta, rho, rayX, rayY, rayZ, fc, fr, sampleX, sampleY, dcx, dcy, dr, sideX, sideY };
}

function drawFisheye(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  thetaDeg: number,
  phi: number,
  fovDeg: number,
  mode: FisheyeMode,
): void {
  clear(ctx, w, h);
  const { mobile, maxTheta, theta, rho, rayX, rayY, rayZ, fc, fr, sampleX, sampleY, dcx, dcy, dr, sideX, sideY } =
    fisheyeMetrics(w, h, thetaDeg, phi, fovDeg, mode);
  ctx.strokeStyle = C.accent;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(fc.x, fc.y, fr, 0, TAU);
  ctx.stroke();
  for (let d = 15; d <= fovDeg / 2 + 0.1; d += 15) {
    const r = FISHEYE_MODES[0].project((d * Math.PI) / 180, maxTheta) * fr;
    ctx.strokeStyle = d % 45 === 0 ? "#3a4260" : C.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(fc.x, fc.y, r, 0, TAU);
    ctx.stroke();
  }
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * TAU;
    line(ctx, fc.x, fc.y, fc.x + Math.cos(a) * fr, fc.y - Math.sin(a) * fr, i % 4 === 0 ? "#3a4260" : C.grid);
  }

  line(ctx, fc.x, fc.y, sampleX, sampleY, C.warm, 2);
  dot(ctx, sampleX, sampleY, 6, C.accent);
  dot(ctx, fc.x, fc.y, 4, C.text);
  label(ctx, "fisheye master", fc.x - fr, fc.y - fr - (mobile ? 14 : 22), { color: C.text, size: mobile ? 12 : 14 });
  label(ctx, "azimuth phi", fc.x + fr * 0.28, fc.y - fr * 0.12, { color: C.warm, size: 12, mono: true });
  if (!mobile) label(ctx, mode.name, fc.x, fc.y + fr + 28, { color: C.accent, size: 13, align: "center", mono: true });

  line(ctx, dcx - dr * 1.12, dcy, dcx + dr * 1.12, dcy, "#424862", 1.5);
  ctx.strokeStyle = C.accent;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(dcx, dcy, dr, Math.PI, 0);
  ctx.stroke();

  line(ctx, dcx, dcy, sideX, sideY, C.warm, 3);
  dot(ctx, sideX, sideY, 6, C.accent);
  dot(ctx, dcx, dcy, 4, C.text);
  ctx.strokeStyle = C.good;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(dcx, dcy, dr * 0.26, -Math.PI / 2, -Math.PI / 2 + theta);
  ctx.stroke();
  label(ctx, "dome direction", dcx - dr, dcy - dr - (mobile ? 14 : 22), { color: C.text, size: mobile ? 12 : 14 });
  label(ctx, "theta", dcx + dr * 0.24, dcy - dr * 0.16, { color: C.good, size: 12, mono: true });
  label(ctx, "lens / viewer", dcx + 10, dcy + 20, { color: C.muted, size: 11 });
  label(ctx, "horizon", dcx - dr * 1.1, dcy + 18, { color: C.muted, size: 11 });

  const bottom = h * (mobile ? 0.84 : 0.84);
  label(ctx, `ray = (${rayX.toFixed(2)}, ${rayY.toFixed(2)}, ${rayZ.toFixed(2)})`, w * 0.08, bottom, {
    color: C.text,
    size: mobile ? 11 : 13,
    mono: true,
  });
  if (!mobile) {
    label(ctx, mode.formula, w * 0.08, bottom + 24, { color: C.muted, size: 13, mono: true });
    label(ctx, `uv = (${(0.5 + 0.5 * Math.cos(phi) * rho).toFixed(3)}, ${(0.5 - 0.5 * Math.sin(phi) * rho).toFixed(3)})`, w * 0.08, bottom + 48, {
      color: C.muted,
      size: 13,
      mono: true,
    });
  } else {
    label(ctx, `uv = (${(0.5 + 0.5 * Math.cos(phi) * rho).toFixed(2)}, ${(0.5 - 0.5 * Math.sin(phi) * rho).toFixed(2)})`, w * 0.08, bottom + 18, {
      color: C.muted,
      size: 11,
      mono: true,
    });
  }
}

export function mountFisheyeMap(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.82);
  let thetaDeg = 54;
  let phi = 0.65;
  let fovDeg = 180;
  let modeIndex = 0;
  let spinning = false;
  let dragging: "fisheye" | "dome" | null = null;

  const phiSlider = shell.slider({
    label: "azimuth",
    min: 0,
    max: TAU,
    step: 0.001,
    value: phi,
    format: (v) => `${(v * 180 / Math.PI).toFixed(0)} deg`,
    onInput: (v) => {
      phi = v;
    },
  });
  const thetaSlider = shell.slider({
    label: "zenith angle",
    min: 0,
    max: 90,
    step: 0.1,
    value: thetaDeg,
    format: (v) => `${v.toFixed(1)} deg`,
    onInput: (v) => {
      thetaDeg = v;
    },
  });
  shell.slider({
    label: "fisheye fov",
    min: 120,
    max: 180,
    step: 1,
    value: fovDeg,
    format: (v) => `${v.toFixed(0)} deg`,
    onInput: (v) => {
      fovDeg = v;
    },
  });
  for (const [idx, mode] of FISHEYE_MODES.entries()) {
    shell.button(mode.name, () => {
      modeIndex = idx;
    });
  }
  shell.button("spin phi", () => {
    spinning = !spinning;
    spinButton.textContent = spinning ? "pause phi" : "spin phi";
  });
  const spinButton = shell.controls.lastElementChild as HTMLButtonElement;

  const syncFisheyeState = (): void => {
    syncSlider(phiSlider, phi);
    syncSlider(thetaSlider, thetaDeg);
  };

  const hitHandle = (x: number, y: number): "fisheye" | "dome" | null => {
    const m = fisheyeMetrics(shell.canvas.clientWidth, shell.canvas.clientHeight, thetaDeg, phi, fovDeg, FISHEYE_MODES[modeIndex]);
    const grabR = Math.max(18, m.fr * 0.08);
    const fisheyeHit = dist2(x, y, m.sampleX, m.sampleY) <= grabR * grabR;
    const domeHit = dist2(x, y, m.sideX, m.sideY) <= grabR * grabR;
    if (fisheyeHit && domeHit) return dist2(x, y, m.sampleX, m.sampleY) < dist2(x, y, m.sideX, m.sideY) ? "fisheye" : "dome";
    if (fisheyeHit) return "fisheye";
    if (domeHit) return "dome";
    if (Math.hypot(x - m.fc.x, y - m.fc.y) <= m.fr) return "fisheye";
    if (Math.hypot(x - m.dcx, y - m.dcy) <= m.dr && y <= m.dcy + 8) return "dome";
    return null;
  };

  const applyDrag = (handle: "fisheye" | "dome", e: PointerEvent): void => {
    const p = pointerPoint(shell.canvas, e);
    const mode = FISHEYE_MODES[modeIndex];
    const m = fisheyeMetrics(shell.canvas.clientWidth, shell.canvas.clientHeight, thetaDeg, phi, fovDeg, mode);
    if (handle === "fisheye") {
      const dx = p.x - m.fc.x;
      const dy = m.fc.y - p.y;
      phi = normAngle(Math.atan2(dy, dx));
      const rho = clamp(Math.hypot(dx, dy) / m.fr, 0, 1);
      thetaDeg = (mode.unproject(rho, m.maxTheta) * 180) / Math.PI;
    } else {
      const dx = p.x - m.dcx;
      const dy = m.dcy - p.y;
      thetaDeg = (clamp(Math.atan2(dx, dy), 0, m.maxTheta) * 180) / Math.PI;
    }
    syncFisheyeState();
  };

  shell.canvas.addEventListener("pointerdown", (e) => {
    const p = pointerPoint(shell.canvas, e);
    const handle = hitHandle(p.x, p.y);
    if (!handle) return;
    e.preventDefault();
    dragging = handle;
    spinning = false;
    spinButton.textContent = "spin phi";
    shell.canvas.setPointerCapture(e.pointerId);
    shell.canvas.style.cursor = "grabbing";
    applyDrag(handle, e);
  });
  shell.canvas.addEventListener("pointermove", (e) => {
    if (dragging) {
      e.preventDefault();
      applyDrag(dragging, e);
      return;
    }
    const p = pointerPoint(shell.canvas, e);
    shell.canvas.style.cursor = hitHandle(p.x, p.y) ? "grab" : "default";
  });
  const stopDrag = (e: PointerEvent): void => {
    if (!dragging) return;
    dragging = null;
    try {
      shell.canvas.releasePointerCapture(e.pointerId);
    } catch {
      // The browser may already have released capture during cancellation.
    }
    const p = pointerPoint(shell.canvas, e);
    shell.canvas.style.cursor = hitHandle(p.x, p.y) ? "grab" : "default";
  };
  shell.canvas.addEventListener("pointerup", stopDrag);
  shell.canvas.addEventListener("pointercancel", stopDrag);
  shell.canvas.addEventListener("pointerleave", () => {
    if (!dragging) shell.canvas.style.cursor = "default";
  });

  shell.setInfo(() => {
    const maxTheta = fovDeg / 2;
    return `drag blue handles · ${FISHEYE_MODES[modeIndex].name} · theta ${Math.min(thetaDeg, maxTheta).toFixed(1)} deg of ${maxTheta.toFixed(0)} deg`;
  });

  return {
    frame() {
      if (spinning) {
        phi = (phi + 0.006) % TAU;
        syncSlider(phiSlider, phi);
      }
      withCanvas(shell.canvas, (ctx, w, h) => drawFisheye(ctx, w, h, thetaDeg, phi, fovDeg, FISHEYE_MODES[modeIndex]));
      shell.tick();
    },
  };
}

function masterColor(u: number, v: number, beat: number, sensor: number, cue: number): [number, number, number] {
  const rings = Math.sin(TAU * (v * 5.5 - beat * 0.045));
  const sweep = Math.sin(TAU * (u * 3 + beat * 0.065));
  const beatPulse = Math.pow(Math.max(0, Math.sin(TAU * beat)), 8);
  const brightness = 0.46 + 0.2 * rings + 0.16 * sweep + 0.24 * sensor + 0.26 * beatPulse + cue * 0.25;
  const warm = clamp(0.35 + 0.35 * sweep + sensor * 0.3, 0, 1);
  const r = clamp(55 + brightness * mix(80, 190, warm), 0, 255);
  const g = clamp(75 + brightness * mix(140, 105, warm), 0, 255);
  const b = clamp(120 + brightness * mix(200, 80, warm), 0, 255);
  return [r, g, b];
}

function rgb(r: number, g: number, b: number, a = 1): string {
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${a})`;
}

function drawWarpMesh(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ctx.save();
  ctx.strokeStyle = "rgba(215, 219, 230, 0.18)";
  ctx.lineWidth = 1;
  for (let ring = 0.2; ring <= 1.001; ring += 0.2) {
    ctx.beginPath();
    ctx.arc(cx, cy, r * ring, 0, TAU);
    ctx.stroke();
  }
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * TAU;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    ctx.stroke();
  }
  ctx.restore();
}

function drawTimeline(ctx: CanvasRenderingContext2D, w: number, h: number, beat: number, sensor: number, bpm: number, mobile: boolean): void {
  const x = w * 0.09;
  const y = h * (mobile ? 0.68 : 0.84);
  const bw = w * 0.82;
  const bh = h * 0.045;
  ctx.fillStyle = C.panel;
  ctx.fillRect(x, y, bw, bh);
  ctx.strokeStyle = "#30364d";
  ctx.strokeRect(x, y, bw, bh);

  for (let i = 0; i <= 16; i++) {
    const px = x + (i / 16) * bw;
    line(ctx, px, y, px, y + bh, i % 4 === 0 ? "#58617f" : C.grid);
    if (i < 16 && i % 4 === 0) {
      dot(ctx, px + (bw / 16) * 0.5, y + bh * 0.5, Math.max(4, bh * 0.16), i === 0 ? C.warm : C.accent);
    }
  }

  const playX = x + ((beat % 16) / 16) * bw;
  line(ctx, playX, y - 7, playX, y + bh + 7, C.good, 3);
  label(ctx, `${Math.round(bpm)} bpm clock`, x, y - (mobile ? 16 : 24), { color: C.text, size: mobile ? 11 : 13, mono: true });

  const sx = x;
  const sy = y + bh + 34;
  const sw = bw;
  const sh = 12;
  ctx.fillStyle = "#1a1e2c";
  ctx.fillRect(sx, sy, sw, sh);
  ctx.fillStyle = C.warm;
  ctx.fillRect(sx, sy, sw * sensor, sh);
  label(ctx, `sensor envelope ${sensor.toFixed(2)}`, sx, sy + (mobile ? 24 : 30), { color: C.muted, size: mobile ? 10 : 12, mono: true });
}

function drawShowRig(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  beat: number,
  sensor: number,
  overlap: number,
  edgeGamma: number,
  cue: number,
  bpm: number,
): void {
  clear(ctx, w, h);
  const mobile = w < 520;
  const cx = w * 0.5;
  const cy = h * (mobile ? 0.34 : 0.4);
  const r = mobile ? Math.min(w * 0.29, h * 0.26) : Math.min(w * 0.34, h * 0.31);
  const step = Math.max(7, Math.floor(w / 150));

  for (let y = Math.floor(cy - r); y <= cy + r; y += step) {
    for (let x = Math.floor(cx - r); x <= cx + r; x += step) {
      const nx = (x + step * 0.5 - cx) / r;
      const ny = (y + step * 0.5 - cy) / r;
      const rr = nx * nx + ny * ny;
      if (rr > 1) continue;
      const rad = Math.sqrt(rr);
      const az = Math.atan2(ny, nx);
      const u = (az / TAU + 1) % 1;
      const [baseR, baseG, baseB] = masterColor(u, rad, beat, sensor, cue);
      let wa = 0;
      let wb = 0;
      if (nx < -overlap) {
        wa = 1;
      } else if (nx > overlap) {
        wb = 1;
      } else {
        const t = smooth01((nx + overlap) / (2 * overlap));
        wa = Math.pow(1 - t, edgeGamma);
        wb = Math.pow(t, edgeGamma);
      }
      const level = clamp(wa + wb, 0, 1.25);
      const tintR = 0.92 + wb * 0.12;
      const tintG = 0.9 + (wa + wb) * 0.06;
      const tintB = 0.92 + wa * 0.13;
      ctx.fillStyle = rgb(baseR * level * tintR, baseG * level * tintG, baseB * level * tintB);
      ctx.fillRect(x, y, step + 1, step + 1);
    }
  }

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, TAU);
  ctx.clip();
  ctx.fillStyle = "rgba(122, 162, 255, 0.09)";
  ctx.fillRect(cx - r, cy - r, r * (1 + overlap), r * 2);
  ctx.fillStyle = "rgba(255, 184, 107, 0.09)";
  ctx.fillRect(cx - r * overlap, cy - r, r * (1 + overlap), r * 2);
  ctx.restore();

  drawWarpMesh(ctx, cx, cy, r);
  ctx.strokeStyle = C.accent;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, TAU);
  ctx.stroke();
  line(ctx, cx - overlap * r, cy - r * 0.94, cx - overlap * r, cy + r * 0.94, "rgba(122, 162, 255, 0.65)", 2);
  line(ctx, cx + overlap * r, cy - r * 0.94, cx + overlap * r, cy + r * 0.94, "rgba(255, 184, 107, 0.65)", 2);

  if (!mobile) {
    label(ctx, "projector A warp mesh", cx - r * 0.95, cy - r - 24, { color: C.accent, size: 13 });
    label(ctx, "projector B", cx + r * 0.28, cy - r - 24, { color: C.warm, size: 13 });
    label(ctx, "edge blend overlap", cx, cy + r + 24, { color: C.text, size: 13, align: "center" });
    label(ctx, `gamma ${edgeGamma.toFixed(2)}`, cx, cy + r + 46, { color: C.muted, size: 12, align: "center", mono: true });
  }

  drawTimeline(ctx, w, h, beat, sensor, bpm, mobile);
}

export function mountWarpBlendShow(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.98);
  let overlap = 0.18;
  let edgeGamma = 1.0;
  let bpm = 124;
  let sensorTarget = 0.45;
  let sensor = sensorTarget;
  let running = true;
  let beat = 0;
  let cue = 0;
  let last = performance.now();

  shell.slider({
    label: "projector overlap",
    min: 0.06,
    max: 0.38,
    step: 0.01,
    value: overlap,
    format: (v) => `${Math.round(v * 100)}%`,
    onInput: (v) => {
      overlap = v;
    },
  });
  shell.slider({
    label: "edge gamma",
    min: 0.5,
    max: 2.6,
    step: 0.01,
    value: edgeGamma,
    format: (v) => v.toFixed(2),
    onInput: (v) => {
      edgeGamma = v;
    },
  });
  shell.slider({
    label: "bpm",
    min: 72,
    max: 156,
    step: 1,
    value: bpm,
    format: (v) => `${Math.round(v)}`,
    onInput: (v) => {
      bpm = v;
    },
  });
  shell.slider({
    label: "sensor",
    min: 0,
    max: 1,
    step: 0.01,
    value: sensorTarget,
    format: (v) => v.toFixed(2),
    onInput: (v) => {
      sensorTarget = v;
    },
  });
  shell.button("pause clock", () => {
    running = !running;
    clockButton.textContent = running ? "pause clock" : "run clock";
  });
  const clockButton = shell.controls.lastElementChild as HTMLButtonElement;
  shell.button("trigger cue", () => {
    cue = 1;
  });

  shell.setInfo(() => {
    const bar = Math.floor((beat % 16) / 4) + 1;
    return `bar ${bar} · sensor ${sensor.toFixed(2)} · overlap ${Math.round(overlap * 100)}%`;
  });

  return {
    frame() {
      const now = performance.now();
      const dt = Math.min((now - last) / 1000, 0.08);
      last = now;
      if (running) beat += (dt * bpm) / 60;
      sensor += (sensorTarget - sensor) * 0.08;
      cue *= 0.91;
      withCanvas(shell.canvas, (ctx, w, h) => drawShowRig(ctx, w, h, beat, sensor, overlap, edgeGamma, cue, bpm));
      shell.tick();
    },
  };
}

type RealtimeMode = "direct" | "master";

const PROJECTOR_COLORS = ["#7aa2ff", "#ffb86b", "#7dd6a0", "#d89cff"];

function sectorPath(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  a0: number,
  a1: number,
): void {
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, r, a0, a1);
  ctx.closePath();
}

function drawPipelineBox(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, text: string, color: string): void {
  ctx.fillStyle = "rgba(17, 19, 28, 0.86)";
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 8);
  ctx.fill();
  ctx.stroke();
  label(ctx, text, x + w / 2, y + h / 2, { color: C.text, size: 12, align: "center" });
}

function drawRealtimeProjectors(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  mode: RealtimeMode,
  projectorCount: number,
  overlap: number,
  warp: number,
  time: number,
): void {
  clear(ctx, w, h);
  const mobile = w < 520;
  const cx = w * 0.34;
  const cy = h * (mobile ? 0.33 : 0.43);
  const r = Math.min(w * (mobile ? 0.28 : 0.22), h * 0.29);
  const n = Math.max(1, Math.round(projectorCount));
  const slice = TAU / n;
  const overlapA = (overlap * slice) / 2;

  ctx.fillStyle = "rgba(122, 162, 255, 0.035)";
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = C.accent;
  ctx.lineWidth = 2;
  ctx.stroke();

  for (let ring = 0.25; ring <= 1; ring += 0.25) {
    ctx.strokeStyle = ring >= 1 ? C.accent : C.grid;
    ctx.lineWidth = ring >= 1 ? 1.8 : 1;
    ctx.beginPath();
    ctx.arc(cx, cy, r * ring, 0, TAU);
    ctx.stroke();
  }
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    line(ctx, cx, cy, cx + Math.cos(a) * r, cy + Math.sin(a) * r, C.grid);
  }

  // Animated scene content in dome coordinates, not a pre-rendered video.
  for (let i = 0; i < 34; i++) {
    const a = i * 1.618 + time * (0.25 + (i % 5) * 0.015);
    const rr = r * (0.14 + 0.8 * (((i * 37) % 100) / 100));
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a * 0.81) * rr * 0.78;
    dot(ctx, x, y, 2.4 + (i % 4) * 0.6, i % 3 === 0 ? C.warm : C.accent);
  }

  ctx.save();
  ctx.globalCompositeOperation = "screen";
  for (let i = 0; i < n; i++) {
    const centerA = -Math.PI / 2 + i * slice;
    const color = PROJECTOR_COLORS[i % PROJECTOR_COLORS.length];
    sectorPath(ctx, cx, cy, r, centerA - slice / 2 - overlapA, centerA + slice / 2 + overlapA);
    ctx.fillStyle = color.replace(")", ", 0.11)").replace("#", "");
    ctx.fillStyle = `${color}22`;
    ctx.fill();
    line(ctx, cx, cy, cx + Math.cos(centerA - slice / 2) * r, cy + Math.sin(centerA - slice / 2) * r, `${color}99`, 1.4);
    line(ctx, cx, cy, cx + Math.cos(centerA + slice / 2) * r, cy + Math.sin(centerA + slice / 2) * r, `${color}99`, 1.4);
  }
  ctx.restore();

  // Projector positions and frusta.
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + i * slice;
    const color = PROJECTOR_COLORS[i % PROJECTOR_COLORS.length];
    const px = cx + Math.cos(a) * r * 1.55;
    const py = cy + Math.sin(a) * r * 1.55;
    const left = a + Math.PI - slice * 0.36;
    const right = a + Math.PI + slice * 0.36;
    ctx.fillStyle = `${color}14`;
    ctx.strokeStyle = `${color}aa`;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(cx + Math.cos(left) * r * 0.92, cy + Math.sin(left) * r * 0.92);
    ctx.lineTo(cx + Math.cos(right) * r * 0.92, cy + Math.sin(right) * r * 0.92);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    dot(ctx, px, py, 5.2, color);
    label(ctx, `P${i + 1}`, px + Math.cos(a) * 13, py + Math.sin(a) * 13, { color, size: 11, align: "center", mono: true });
  }

  label(ctx, "physical dome", cx, cy + r + 24, { color: C.text, size: 13, align: "center" });
  label(ctx, `${n} projector${n === 1 ? "" : "s"} · ${(overlap * 100).toFixed(0)}% angular overlap`, cx, cy + r + 45, {
    color: C.muted,
    size: 11,
    align: "center",
    mono: true,
  });

  const bx = mobile ? w * 0.08 : w * 0.62;
  const by = mobile ? h * 0.68 : h * 0.2;
  const bw = mobile ? w * 0.84 : w * 0.3;
  const bh = 44;
  const gap = 24;
  if (mode === "direct") {
    drawPipelineBox(ctx, bx, by, bw, bh, "Three.js scene state", C.good);
    drawPipelineBox(ctx, bx, by + bh + gap, bw, bh, `${n} projector cameras`, C.accent);
    drawPipelineBox(ctx, bx, by + (bh + gap) * 2, bw, bh, "mesh warp + edge blend", C.warm);
    drawPipelineBox(ctx, bx, by + (bh + gap) * 3, bw, bh, "projectors", C.text);
    label(ctx, "no fulldome video/master required", bx + bw / 2, by - 24, { color: C.good, size: 13, align: "center" });
  } else {
    drawPipelineBox(ctx, bx, by, bw, bh, "Three.js scene state", C.good);
    drawPipelineBox(ctx, bx, by + bh + gap, bw, bh, "cubemap / fisheye target", C.accent);
    drawPipelineBox(ctx, bx, by + (bh + gap) * 2, bw, bh, `${n} projector samplers`, C.warm);
    drawPipelineBox(ctx, bx, by + (bh + gap) * 3, bw, bh, "mesh warp + edge blend", C.text);
    label(ctx, "shared master helps portability", bx + bw / 2, by - 24, { color: C.accent, size: 13, align: "center" });
  }
  for (let i = 0; i < 3; i++) {
    const y = by + bh + gap * 0.5 + i * (bh + gap);
    line(ctx, bx + bw / 2, y, bx + bw / 2, y + gap * 0.8, C.muted, 1.2);
  }

  const metricY = mobile ? h * 0.58 : h * 0.84;
  const renderCount = mode === "direct" ? String(n) : "1 fisheye or 5-6 cubemap";
  const sampleCost = mode === "direct" ? "warp pass per projector" : "master sample per projector";
  label(ctx, `scene renders/frame: ${renderCount}`, w * 0.08, metricY, { color: C.text, size: 12, mono: true });
  label(ctx, `correction: ${sampleCost}`, w * 0.08, metricY + 22, { color: C.muted, size: 12, mono: true });
  label(ctx, `calibration mesh displacement: ${warp.toFixed(2)}`, w * 0.08, metricY + 44, { color: C.muted, size: 12, mono: true });
}

export function mountRealtimeProjectors(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.78);
  let mode: RealtimeMode = "direct";
  let projectors = 3;
  let overlap = 0.14;
  let warp = 0.35;
  let time = 0;
  let last = performance.now();

  shell.button("direct projector cameras", () => {
    mode = "direct";
    syncModeButton();
  });
  const directButton = shell.controls.lastElementChild as HTMLButtonElement;
  shell.button("shared fisheye/cubemap", () => {
    mode = "master";
    syncModeButton();
  });
  const masterButton = shell.controls.lastElementChild as HTMLButtonElement;
  const syncModeButton = (): void => {
    directButton.textContent = mode === "direct" ? "direct projector cameras ✓" : "direct projector cameras";
    masterButton.textContent = mode === "master" ? "shared fisheye/cubemap ✓" : "shared fisheye/cubemap";
  };
  syncModeButton();

  shell.slider({
    label: "projectors",
    min: 1,
    max: 4,
    step: 1,
    value: projectors,
    format: (v) => String(Math.round(v)),
    onInput: (v) => {
      projectors = Math.round(v);
    },
  });
  shell.slider({
    label: "overlap",
    min: 0.04,
    max: 0.28,
    step: 0.01,
    value: overlap,
    format: (v) => `${Math.round(v * 100)}%`,
    onInput: (v) => {
      overlap = v;
    },
  });
  shell.slider({
    label: "warp strength",
    min: 0,
    max: 1,
    step: 0.01,
    value: warp,
    format: (v) => v.toFixed(2),
    onInput: (v) => {
      warp = v;
    },
  });

  shell.setInfo(() =>
    mode === "direct"
      ? `dome-native realtime · ${projectors} scene render${projectors === 1 ? "" : "s"} per frame · no fulldome master`
      : `realtime master · fisheye/cubemap render target · projector passes sample it`,
  );

  return {
    frame() {
      const now = performance.now();
      time += Math.min((now - last) / 1000, 0.08);
      last = now;
      withCanvas(shell.canvas, (ctx, w, h) => drawRealtimeProjectors(ctx, w, h, mode, projectors, overlap, warp, time));
      shell.tick();
    },
  };
}
