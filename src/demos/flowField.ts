// Part six, flow-field figure: the same noise, used two ways. "downhill"
// pushes particles along the gradient of a noise field — they slide into
// the maxima and die there, because a gradient field has sinks. "curl"
// rotates that gradient 90° — divergence-free by construction — and the
// same particles swirl forever. This is the trick that keeps the toy alive.

import { Shell, type Demo } from "../lib/demoShell";

const COUNT = 2600;

// small value noise, enough for a figure
function makeNoise(): (x: number, y: number, t: number) => number {
  const P = new Uint8Array(512);
  const perm = new Uint8Array(256).map((_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  P.set(perm);
  P.set(perm, 256);
  const g = (h: number): number => (h & 1 ? 1 : -1) * 0.7;
  const f = (t: number): number => t * t * (3 - 2 * t);
  const layer = (x: number, y: number): number => {
    const xi = Math.floor(x) & 255;
    const yi = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const u = f(xf);
    const v = f(yf);
    const a = P[P[xi] + yi];
    const b = P[P[xi + 1] + yi];
    const c = P[P[xi] + yi + 1];
    const d = P[P[xi + 1] + yi + 1];
    const lerp = (s: number, e: number, k: number): number => s + (e - s) * k;
    return lerp(lerp(g(a) * xf + g(a >> 1) * yf, g(b) * (xf - 1) + g(b >> 1) * yf, u),
                lerp(g(c) * xf + g(c >> 1) * (yf - 1), g(d) * (xf - 1) + g(d >> 1) * (yf - 1), u), v);
  };
  return (x, y, t) => layer(x + t * 0.18, y + t * 0.11) + 0.5 * layer(x * 2.1 + 13.7 - t * 0.07, y * 2.1 + 5.3);
}

export function mountFlowField(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.56);
  const ctx = shell.canvas.getContext("2d")!;
  const W = shell.canvas.width;
  const H = shell.canvas.height;

  const noise = makeNoise();
  let curlMode = true;
  let scale = 2.4;
  let t = 0;

  const px = new Float32Array(COUNT);
  const py = new Float32Array(COUNT);
  const age = new Float32Array(COUNT);
  const respawn = (i: number): void => {
    px[i] = Math.random();
    py[i] = Math.random();
    age[i] = 2 + Math.random() * 6;
  };
  for (let i = 0; i < COUNT; i++) respawn(i);

  let curlBtn: HTMLButtonElement;
  let gradBtn: HTMLButtonElement;
  const labels = (): void => {
    curlBtn.textContent = curlMode ? "● curl (swirls)" : "curl (swirls)";
    gradBtn.textContent = curlMode ? "downhill (sinks)" : "● downhill (sinks)";
  };
  shell.button("curl", () => { curlMode = true; labels(); });
  curlBtn = shell.controls.lastElementChild as HTMLButtonElement;
  shell.button("downhill", () => { curlMode = false; labels(); });
  gradBtn = shell.controls.lastElementChild as HTMLButtonElement;
  labels();
  shell.slider({
    label: "noise scale", min: 1, max: 6, step: 0.1, value: scale,
    onInput: (v) => (scale = v),
  });
  shell.setInfo(() =>
    curlMode
      ? `${COUNT.toLocaleString()} tracers · rotate the gradient 90° and no point gains or loses flow`
      : `${COUNT.toLocaleString()} tracers · follow the gradient and everything pools at the peaks`,
  );

  ctx.fillStyle = "#06070d";
  ctx.fillRect(0, 0, W, H);

  return {
    frame() {
      shell.tick();
      t += 1 / 60;
      ctx.fillStyle = "rgba(6, 7, 13, 0.08)";
      ctx.fillRect(0, 0, W, H);
      ctx.lineWidth = Math.max(1, W / 900);

      const e = 0.012;
      for (let i = 0; i < COUNT; i++) {
        const x = px[i];
        const y = py[i];
        // gradient of the noise by central differences
        const nx = (noise((x + e) * scale, y * scale, t) - noise((x - e) * scale, y * scale, t)) / (2 * e);
        const ny = (noise(x * scale, (y + e) * scale, t) - noise(x * scale, (y - e) * scale, t)) / (2 * e);
        let vx: number;
        let vy: number;
        if (curlMode) {
          vx = ny; // rotate 90°: (∂n/∂y, -∂n/∂x)
          vy = -nx;
        } else {
          vx = nx;
          vy = ny;
        }
        const dt = 0.0035;
        const x2 = x + vx * dt;
        const y2 = y + vy * dt;
        const speed = Math.min(Math.hypot(vx, vy) * 0.55, 1);
        ctx.strokeStyle = `hsla(${205 + speed * 110}, 85%, ${45 + speed * 35}%, 0.55)`;
        ctx.beginPath();
        ctx.moveTo(x * W, y * H);
        ctx.lineTo(x2 * W, y2 * H);
        ctx.stroke();
        px[i] = x2;
        py[i] = y2;
        age[i] -= 1 / 60;
        // downhill mode parks particles at maxima — recycle the stuck ones
        const stuck = !curlMode && speed < 0.02;
        if (age[i] < 0 || stuck || x2 < 0 || x2 > 1 || y2 < 0 || y2 > 1) respawn(i);
      }
    },
  };
}
