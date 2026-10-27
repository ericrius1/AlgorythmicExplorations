// Polyrhythm: a evenly spaced beats against b evenly spaced beats in the same
// span of time. Each row is one pulse; the bottom row is what you hear when
// both play, the "resultant", with its gaps counted in the smallest unit that
// holds both (1/lcm(a, b) of the cycle).

import { Shell, type Demo } from "../../../lib/demoShell";
import { frameGuard } from "../../../lib/audio";
import { COL, clear, figureAspect, font, glow, line, refresh, rgba, setActive, tapToPlay, text, view2d } from "./draw";
import { Clock, drumKit, startAudio, strip, type Kit } from "./sound";

const gcd = (x: number, y: number): number => (y === 0 ? x : gcd(y, x % y));
const lcm = (x: number, y: number): number => (x * y) / gcd(x, y);

export async function mountPoly(container: HTMLElement): Promise<Demo> {
  const shell = new Shell(container, figureAspect(container, 0.42, 0.95));
  container.classList.add("mh-fig");
  const canvas = shell.canvas;
  const v = view2d(canvas);

  let a = 3;
  let b = 2;
  let cycleSec = 1.6;
  let L = lcm(a, b);
  const recompute = (): void => {
    L = lcm(a, b);
    clock.bpm = 60 / (cycleSec / L); // one clock step = one unit of the grid
  };

  // ---- sound --------------------------------------------------------------------------
  let kit: Kit | null = null;
  const flash = { a: -1, b: -1 };
  const clock = new Clock(120, 1, (step, time) => {
    const u = step % L;
    const hitA = u % (L / a) === 0;
    const hitB = u % (L / b) === 0;
    if (hitA && muteA === false) kit?.hit("conga", time, u === 0 ? 0.9 : 0.7, 175);
    if (hitB && muteB === false) kit?.hit("rim", time, u === 0 ? 0.8 : 0.62, 1250);
    if (hitA) flash.a = time;
    if (hitB) flash.b = time;
  });
  recompute();
  let muteA = false;
  let muteB = false;
  const ensure = async (): Promise<void> => {
    await startAudio();
    if (!kit) kit = drumKit({}, strip({ db: 0, reverb: 0.1 }).input);
  };
  const start = async (): Promise<void> => {
    tap.hide();
    await ensure();
    if (!clock.isRunning) clock.start(0);
    sync();
  };
  const stop = (): void => {
    clock.stop();
    tap.show();
    sync();
  };
  const guard = frameGuard(() => {
    if (clock.isRunning) stop();
  });
  const tap = tapToPlay(container, "Tap to play 3 against 2", () => void start(), 0.5);
  canvas.addEventListener("pointerdown", () => (clock.isRunning ? stop() : void start()));

  const playBtn = shell.button("▶ play", () => (clock.isRunning ? stop() : void start()));
  const sync = (): void => {
    playBtn.textContent = clock.isRunning ? "■ stop" : "▶ play";
  };
  const aBtn = shell.button("low drum", () => {
    muteA = !muteA;
    setActive(aBtn, !muteA);
  });
  const bBtn = shell.button("high drum", () => {
    muteB = !muteB;
    setActive(bBtn, !muteB);
  });
  setActive(aBtn, true);
  setActive(bBtn, true);
  const aS = shell.slider({ label: "low drum beats", min: 1, max: 9, step: 1, value: a, format: (x) => String(Math.round(x)), onInput: (x) => set(Math.round(x), b) });
  const bS = shell.slider({ label: "high drum beats", min: 1, max: 9, step: 1, value: b, format: (x) => String(Math.round(x)), onInput: (x) => set(a, Math.round(x)) });
  shell.slider({
    label: "cycle",
    min: 1,
    max: 4,
    step: 0.1,
    value: cycleSec,
    format: (x) => `${x.toFixed(1)} s`,
    onInput: (x) => {
      cycleSec = x;
      recompute();
    },
  });
  const presets = document.createElement("div");
  presets.className = "mh-group";
  const pl = document.createElement("span");
  pl.className = "mh-group-label";
  pl.textContent = "try";
  presets.appendChild(pl);
  const pBtns: [HTMLButtonElement, number, number][] = [];
  for (const [x, y] of [
    [3, 2],
    [4, 3],
    [5, 4],
    [5, 3],
    [7, 4],
  ] as [number, number][]) {
    const btn = shell.button(`${x} : ${y}`, () => {
      aS.value = String(x);
      bS.value = String(y);
      aS.dispatchEvent(new Event("input"));
      bS.dispatchEvent(new Event("input"));
      void start();
    });
    presets.appendChild(btn);
    pBtns.push([btn, x, y]);
  }
  shell.controls.appendChild(presets);
  function set(x: number, y: number): void {
    const was = clock.isRunning;
    const oldL = L;
    a = x;
    b = y;
    recompute();
    // keep the playhead's place in the cycle when the grid changes
    if (was && oldL !== L) {
      const ph = (clock.position() % oldL) / oldL;
      clock.stop();
      clock.start(Math.round(ph * L));
    }
    for (const [btn, px, py] of pBtns) setActive(btn, px === a && py === b);
  }
  set(a, b);

  const resultant = (): number[] => {
    const out: number[] = [];
    for (let u = 0; u < L; u++) if (u % (L / a) === 0 || u % (L / b) === 0) out.push(u);
    return out;
  };

  shell.setInfo(() => {
    const r = resultant();
    const gaps = r.map((u, i) => (r[i + 1] ?? L) - u);
    return `${a} against ${b} · grid of ${L} · together only on the downbeat${gcd(a, b) > 1 ? ` and ${gcd(a, b) - 1} more time${gcd(a, b) > 2 ? "s" : ""}` : ""} · resultant ${gaps.join("+")}`;
  });

  // ---- drawing -----------------------------------------------------------------------------------
  const draw = (): void => {
    refresh(v, canvas);
    const { ctx, w, h, px } = v;
    clear(v, "#0b0d16", "#05060a");
    const narrow = w / px < 560;
    const running = clock.isRunning;
    const pos = running ? clock.position() % L : 0;
    const x0 = (narrow ? 18 : 120) * px;
    const x1 = w - (narrow ? 18 : 40) * px;
    const X = (u: number): number => x0 + ((x1 - x0) * u) / L;
    const rowY = [h * 0.22, h * 0.45, h * 0.74];
    const labels = [`${a} beats`, `${b} beats`, "together"];
    const colA = COL.major;
    const colB = COL.minor;

    // unit grid
    for (let u = 0; u <= L; u++) {
      line(ctx, X(u), rowY[0] - 26 * px, X(u), rowY[2] + 24 * px, rgba(COL.muted, u === 0 || u === L ? 0.35 : 0.08), 1 * px);
    }
    if (!narrow) labels.forEach((lab, i) => text(ctx, lab, x0 - 16 * px, rowY[i], { color: [colA, colB, COL.bright][i], align: "right", font: font(px, 10.5, 650) }));
    else labels.forEach((lab, i) => text(ctx, lab, x0, rowY[i] - 20 * px, { color: [colA, colB, COL.bright][i], font: font(px, 9.5, 650) }));

    for (const [ri, count, col] of [
      [0, a, colA],
      [1, b, colB],
    ] as [number, number, string][]) {
      const y = rowY[ri];
      line(ctx, x0, y, x1, y, rgba(col, 0.18), 1 * px);
      for (let k = 0; k < count; k++) {
        const u = (k * L) / count;
        const x = X(u);
        const age = running ? pos - u : 99;
        const fl = age >= 0 && age < 1.2 ? 1 - age / 1.2 : 0;
        glow(ctx, x, y, (14 + 20 * fl) * px, col, 0.5 + 0.5 * fl);
        ctx.beginPath();
        ctx.arc(x, y, 6 * px, 0, Math.PI * 2);
        ctx.fillStyle = col;
        ctx.fill();
        // spacing label between beats
        if (k < count && !narrow) {
          const xm = X(u + L / count / 2);
          text(ctx, `${L / count}`, xm, y - 14 * px, { color: col, align: "center", font: font(px, 9.5, 650), alpha: 0.5 });
        }
      }
    }

    // resultant
    const r = resultant();
    const y = rowY[2];
    line(ctx, x0, y, x1, y, rgba(COL.bright, 0.15), 1 * px);
    r.forEach((u, i) => {
      const x = X(u);
      const isA = u % (L / a) === 0;
      const isB = u % (L / b) === 0;
      const col = isA && isB ? COL.white : isA ? colA : colB;
      const age = running ? pos - u : 99;
      const fl = age >= 0 && age < 1.2 ? 1 - age / 1.2 : 0;
      glow(ctx, x, y, (isA && isB ? 22 : 14) * px * (1 + fl), col, 0.55 + 0.45 * fl);
      ctx.beginPath();
      ctx.arc(x, y, (isA && isB ? 7 : 5.5) * px, 0, Math.PI * 2);
      ctx.fillStyle = col;
      ctx.fill();
      const gap = (r[i + 1] ?? L) - u;
      text(ctx, String(gap), (x + X(u + gap)) / 2, y + 18 * px, { color: COL.text, align: "center", font: font(px, narrow ? 10 : 11, 700), alpha: 0.8 });
    });

    // playhead
    if (running) {
      const x = X(pos);
      line(ctx, x, rowY[0] - 30 * px, x, rowY[2] + 28 * px, rgba(COL.white, 0.55), 1.5 * px);
      glow(ctx, x, rowY[0] - 30 * px, 8 * px, COL.white, 0.7);
    }
  };

  return {
    frame() {
      shell.tick();
      guard.pulse();
      sync();
      draw();
    },
    dispose() {
      clock.stop();
    },
  };
}
