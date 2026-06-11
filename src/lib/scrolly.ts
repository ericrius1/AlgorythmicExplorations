// Scroll-driven diagrams. The figure pins to the viewport while the reader
// scrolls through a tall track; scroll progress scrubs the animation, so
// scrolling back rewinds it. Drawing is plain canvas 2D — every frame is a
// pure function of progress t in [0, 1].

export interface ScrollyStep {
  at: number; // progress at which this caption takes over
  text: string;
}

export interface ScrollySpec {
  screens?: number; // track length in viewport-heights of scrolling (default 3)
  aspect?: number; // canvas height / width (default 0.58)
  steps: ScrollyStep[];
  draw(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void;
}

export function mountScrolly(container: HTMLElement, spec: ScrollySpec): void {
  const screens = spec.screens ?? 3;
  const aspect = spec.aspect ?? 0.58;

  container.classList.add("scrolly");
  container.style.height = `${Math.round(screens * 100)}vh`;

  const stage = document.createElement("div");
  stage.className = "scrolly-stage";
  container.appendChild(stage);

  const canvas = document.createElement("canvas");
  canvas.className = "scrolly-canvas";
  stage.appendChild(canvas);

  const progress = document.createElement("div");
  progress.className = "scrolly-progress";
  const fill = document.createElement("div");
  fill.className = "scrolly-progress-fill";
  progress.appendChild(fill);
  stage.appendChild(progress);

  const caption = document.createElement("p");
  caption.className = "scrolly-caption";
  stage.appendChild(caption);

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  let w = 0;
  let h = 0;

  const resize = (): void => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = canvas.clientWidth || stage.clientWidth - 16;
    // Keep the whole stage on screen even on short viewports.
    const maxH = Math.max(window.innerHeight * 0.68, 260);
    const ch = Math.min(cw * aspect, maxH);
    canvas.width = Math.max(1, Math.floor(cw * dpr));
    canvas.height = Math.max(1, Math.floor(ch * dpr));
    canvas.style.height = `${ch}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    w = cw;
    h = ch;
  };

  const rawProgress = (): number => {
    const rect = container.getBoundingClientRect();
    const span = rect.height - window.innerHeight;
    if (span <= 0) return 1;
    return Math.min(1, Math.max(0, -rect.top / span));
  };

  const nearViewport = (): boolean => {
    const rect = container.getBoundingClientRect();
    return rect.top < window.innerHeight + 200 && rect.bottom > -200;
  };

  let t = -1; // force first draw
  let stepIdx = -1;

  const hint = ` <span class="scrolly-hint">— scroll to advance, scroll up to rewind</span>`;

  const render = (force = false): void => {
    const target = rawProgress();
    // Light smoothing so trackpads and scroll-jumps don't strobe the figure.
    const next = t < 0 ? target : t + (target - t) * 0.35;
    if (!force && Math.abs(next - t) < 0.0005) return;
    t = next;

    ctx.clearRect(0, 0, w, h);
    spec.draw(ctx, w, h, Math.min(1, Math.max(0, t)));
    fill.style.width = `${(t * 100).toFixed(1)}%`;

    let idx = 0;
    for (let i = 0; i < spec.steps.length; i++) {
      if (t >= spec.steps[i].at) idx = i;
    }
    if (idx !== stepIdx) {
      stepIdx = idx;
      caption.innerHTML = spec.steps[idx].text + (idx === 0 ? hint : "");
    }
  };

  let running = false;
  let raf = 0;
  let lastTick = 0;
  const loop = (): void => {
    if (!running) return;
    lastTick = performance.now();
    render();
    raf = requestAnimationFrame(loop);
  };
  const setRunning = (on: boolean): void => {
    if (on === running) return;
    running = on;
    if (on) raf = requestAnimationFrame(loop);
    else cancelAnimationFrame(raf);
  };

  if (typeof IntersectionObserver !== "undefined") {
    new IntersectionObserver(
      (entries) => {
        for (const e of entries) setRunning(e.isIntersecting);
      },
      { rootMargin: "200px" },
    ).observe(container);
  }
  setInterval(() => setRunning(nearViewport()), 500);

  // Some embedded/preview browsers throttle or suspend rAF entirely; drive
  // the render from scroll events and a slow watchdog as well.
  window.addEventListener(
    "scroll",
    () => {
      if (nearViewport()) render();
    },
    { passive: true },
  );
  setInterval(() => {
    if (running && performance.now() - lastTick > 400 && nearViewport()) render();
  }, 150);

  window.addEventListener("resize", () => {
    resize();
    render(true);
  });

  resize();
  render(true);
  setRunning(nearViewport());
}

/* ---------- shared drawing helpers ---------- */

export const PAL = {
  bg: "#06070b",
  dot: "#aab4d4",
  dim: "#3a4054",
  grid: "#2a2f42",
  accent: "#7aa2ff",
  warm: "#ffb86b",
  red: "#ff8585",
  text: "#d7dbe6",
  muted: "#8a91a5",
  good: "#7dd6a0",
};

// Deterministic RNG so diagrams look identical on every visit.
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}

export function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// Progress of t through the window [a, b], smoothstep-eased, clamped.
export function phase(t: number, a: number, b: number): number {
  const x = clamp01((t - a) / (b - a));
  return x * x * (3 - 2 * x);
}

export function arrow(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: string,
  width = 2,
  head = 7,
): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (len < 1) return;
  const ux = dx / len;
  const uy = dy / len;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1 - ux * head * 0.7, y1 - uy * head * 0.7);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - ux * head - uy * head * 0.45, y1 - uy * head + ux * head * 0.45);
  ctx.lineTo(x1 - ux * head + uy * head * 0.45, y1 - uy * head - ux * head * 0.45);
  ctx.closePath();
  ctx.fill();
}

export function label(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  opts: { color?: string; size?: number; align?: CanvasTextAlign; alpha?: number; mono?: boolean } = {},
): void {
  ctx.save();
  ctx.globalAlpha = opts.alpha ?? 1;
  ctx.fillStyle = opts.color ?? PAL.text;
  ctx.textAlign = opts.align ?? "left";
  ctx.textBaseline = "middle";
  const size = opts.size ?? 12;
  ctx.font = opts.mono
    ? `${size}px ui-monospace, Menlo, monospace`
    : `600 ${size}px ui-sans-serif, system-ui, sans-serif`;
  ctx.fillText(text, x, y);
  ctx.restore();
}
