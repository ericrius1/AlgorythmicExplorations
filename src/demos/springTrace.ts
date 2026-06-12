// Three ways to chase a jumping target, drawn as a scrolling oscilloscope:
//   cut    — teleport to the target (what switching clips does)
//   blend  — a fixed-duration crossfade (what blend trees do)
//   spring — a critically damped spring (what part 4's animator does)
// The target square-waves on its own; click to throw it somewhere by hand
// mid-flight and watch which follower keeps its dignity.

import { Shell, type Demo } from "../lib/demoShell";

export function mountSpringTrace(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.5);
  const ctx = shell.canvas.getContext("2d")!;
  const W = shell.canvas.width;
  const H = shell.canvas.height;
  const px = (n: number): number => (n * W) / 900;

  let freqHz = 1.35;
  shell.slider({
    label: "spring stiffness (Hz)",
    min: 0.3, max: 4, step: 0.05, value: freqHz,
    onInput: (v) => (freqHz = v),
  });
  shell.setInfo(() => "click to move the target mid-flight");

  // normalized vertical positions in [0, 1]
  let target = 0.3;
  let lastFlip = 0;
  let time = 0;

  const cut = { y: target };
  const blend = { y: target, from: target, t: 1 }; // t in [0,1] across a fixed fade
  const spring = { y: target, v: 0 };
  const BLEND_SECONDS = 0.9;

  // history columns scroll left; newest at the right edge
  const cols = Math.floor(W / px(3));
  const history: { tg: number; cut: number; blend: number; spring: number }[] = [];

  shell.canvas.addEventListener("pointerdown", (e) => {
    const r = shell.canvas.getBoundingClientRect();
    target = Math.min(0.92, Math.max(0.08, (e.clientY - r.top) / r.height));
    blend.from = blend.y;
    blend.t = 0;
    cut.y = target;
    lastFlip = time;
  });

  let last = performance.now();

  return {
    frame: () => {
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      time += dt;

      // the target square-waves by itself every few seconds
      if (time - lastFlip > 2.6) {
        target = target > 0.5 ? 0.22 : 0.78;
        blend.from = blend.y;
        blend.t = 0;
        cut.y = target;
        lastFlip = time;
      }

      // cut: already there. blend: fixed-duration smoothstep crossfade.
      blend.t = Math.min(1, blend.t + dt / BLEND_SECONDS);
      const u = blend.t * blend.t * (3 - 2 * blend.t);
      blend.y = blend.from + (target - blend.from) * u;

      // spring: critically damped, exact integrator
      const omega = 2 * Math.PI * freqHz;
      const ex = Math.exp(-omega * dt);
      const dx = spring.y - target;
      const tmp = (spring.v + omega * dx) * dt;
      spring.y = target + (dx + tmp) * ex;
      spring.v = (spring.v - omega * tmp) * ex;

      history.push({ tg: target, cut: cut.y, blend: blend.y, spring: spring.y });
      if (history.length > cols) history.shift();

      // ---- draw -------------------------------------------------------------------
      ctx.fillStyle = "#06070b";
      ctx.fillRect(0, 0, W, H);

      const colW = W / cols;
      const trace = (key: "tg" | "cut" | "blend" | "spring", color: string, width: number): void => {
        ctx.beginPath();
        for (let i = 0; i < history.length; i++) {
          const x = W - (history.length - i) * colW;
          const y = history[i][key] * H;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = color;
        ctx.lineWidth = px(width);
        ctx.lineJoin = "round";
        ctx.stroke();
      };

      trace("tg", "rgba(215, 219, 230, 0.35)", 2);
      trace("cut", "#5c6478", 2.5);
      trace("blend", "#9a7fd4", 2.5);
      trace("spring", "#7aa2ff", 3.5);

      // labels at the line ends
      ctx.font = `600 ${px(15)}px ui-sans-serif, system-ui`;
      const lab = (key: "cut" | "blend" | "spring", color: string, text: string): void => {
        const y = history[history.length - 1][key] * H;
        ctx.fillStyle = color;
        ctx.fillText(text, W - px(86), y - px(7));
      };
      lab("cut", "#8a91a5", "cut");
      lab("blend", "#b9a3ec", "crossfade");
      lab("spring", "#a5c0ff", "spring");

      // target marker on the right edge
      ctx.beginPath();
      ctx.arc(W - px(10), target * H, px(7), 0, Math.PI * 2);
      ctx.fillStyle = "#ffb86b";
      ctx.fill();

      shell.tick();
    },
  };
}
