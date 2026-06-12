// Demo 1: one star, your planets. Click-drag to launch a body and feel
// gravity's inverse square law directly.

import { Shell, type Demo } from "../../lib/demoShell";

const STAR_GM = 0.066; // G * M_star, same scale as the disk demos

interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export function mountSlingshot(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.62);
  const ctx = shell.canvas.getContext("2d")!;
  let softening = 0.06;
  let gravityMul = 1.0;
  let bodies: Body[] = [{ x: 0.55, y: 0, vx: 0, vy: Math.sqrt(STAR_GM / 0.55) }];

  shell.slider({
    label: "gravity ×",
    min: 0.2,
    max: 3,
    step: 0.05,
    value: gravityMul,
    onInput: (v) => (gravityMul = v),
  });
  shell.slider({
    label: "softening ε",
    min: 0.01,
    max: 0.3,
    step: 0.005,
    value: softening,
    onInput: (v) => (softening = v),
  });
  shell.button("clear", () => {
    bodies = [];
  });
  shell.setInfo(() => `${bodies.length} bodies · drag on the canvas to launch one`);

  // Pointer drag = launch vector.
  let drag: { x: number; y: number; cx: number; cy: number } | null = null;
  const toWorld = (e: PointerEvent): [number, number] => {
    const r = shell.canvas.getBoundingClientRect();
    const s = Math.min(r.width, r.height) / 2 / 1.2;
    return [(e.clientX - r.left - r.width / 2) / s, -(e.clientY - r.top - r.height / 2) / s];
  };
  shell.canvas.addEventListener("pointerdown", (e) => {
    const [x, y] = toWorld(e);
    drag = { x, y, cx: x, cy: y };
    shell.canvas.setPointerCapture(e.pointerId);
  });
  shell.canvas.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const [x, y] = toWorld(e);
    drag.cx = x;
    drag.cy = y;
  });
  shell.canvas.addEventListener("pointerup", () => {
    if (!drag) return;
    if (bodies.length < 24) {
      bodies.push({ x: drag.x, y: drag.y, vx: (drag.cx - drag.x) * 1.2, vy: (drag.cy - drag.y) * 1.2 });
    }
    drag = null;
  });

  const { width, height } = ctx.canvas;
  ctx.fillStyle = "#06070b";
  ctx.fillRect(0, 0, width, height);

  return {
    frame() {
      shell.tick();
      const gm = STAR_GM * gravityMul;
      const eps2 = softening * softening;
      const dt = 0.004;
      for (let s = 0; s < 4; s++) {
        for (const b of bodies) {
          // pull of the star
          let r2 = b.x * b.x + b.y * b.y + eps2;
          let inv = gm / (r2 * Math.sqrt(r2));
          let ax = -b.x * inv;
          let ay = -b.y * inv;
          // pull of every other launched body (they're light, but it's honest)
          for (const o of bodies) {
            if (o === b) continue;
            const dx = o.x - b.x;
            const dy = o.y - b.y;
            r2 = dx * dx + dy * dy + eps2;
            inv = (gm * 0.02) / (r2 * Math.sqrt(r2));
            ax += dx * inv;
            ay += dy * inv;
          }
          b.vx += ax * dt;
          b.vy += ay * dt;
        }
        for (const b of bodies) {
          b.x += b.vx * dt;
          b.y += b.vy * dt;
        }
      }
      bodies = bodies.filter((b) => Math.abs(b.x) < 6 && Math.abs(b.y) < 6);

      // fading trails
      ctx.fillStyle = "rgba(6, 7, 11, 0.08)";
      ctx.fillRect(0, 0, width, height);
      const s = Math.min(width, height) / 2 / 1.2;
      const ox = width / 2;
      const oy = height / 2;
      // star
      const grad = ctx.createRadialGradient(ox, oy, 0, ox, oy, 14);
      grad.addColorStop(0, "rgba(255, 235, 180, 1)");
      grad.addColorStop(1, "rgba(255, 235, 180, 0)");
      ctx.fillStyle = grad;
      ctx.fillRect(ox - 14, oy - 14, 28, 28);
      // bodies
      ctx.fillStyle = "rgb(140, 180, 255)";
      for (const b of bodies) {
        ctx.beginPath();
        ctx.arc(ox + b.x * s, oy - b.y * s, 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
      // launch preview
      if (drag) {
        ctx.strokeStyle = "rgba(255, 220, 120, 0.9)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(ox + drag.x * s, oy - drag.y * s);
        ctx.lineTo(ox + drag.cx * s, oy - drag.cy * s);
        ctx.stroke();
      }
    },
  };
}
