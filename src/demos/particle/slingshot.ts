// Demo 1: one star, your planets. Click-drag to launch a body and feel
// gravity's inverse square law directly. The order button swaps the two
// integrator updates so you can watch the "obvious" order leak energy.

import { Shell, type Demo } from "../../lib/demoShell";
import { speedRgb, pixelRatio } from "../../lib/palette";

const STAR_GM = 0.066; // G * M_star, same scale as the disk demos
const TRAIL = 300; // frames of path kept per body

interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
  ax: number;
  ay: number;
  trail: number[]; // recent x, y pairs, oldest first
}

export function mountSlingshot(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.62);
  const ctx = shell.canvas.getContext("2d")!;
  let softening = 0.06;
  let gravityMul = 1.0;
  let velocityFirst = true;
  const orbit = (r: number): Body => ({ x: r, y: 0, vx: 0, vy: Math.sqrt(STAR_GM / r), ax: 0, ay: 0, trail: [] });
  let bodies: Body[] = [orbit(0.55), orbit(0.2)];

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
  const order = shell.button("order: velocity first", () => {
    velocityFirst = !velocityFirst;
    order.textContent = velocityFirst ? "order: velocity first" : "order: position first";
  });
  shell.button("clear", () => {
    bodies = [];
  });
  shell.setInfo(() =>
    velocityFirst
      ? `${bodies.length} bodies · semi-implicit Euler · press, drag, release to launch`
      : `${bodies.length} bodies · explicit Euler · watch the tight orbit spiral out`,
  );

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
      bodies.push({
        x: drag.x,
        y: drag.y,
        vx: (drag.cx - drag.x) * 1.2,
        vy: (drag.cy - drag.y) * 1.2,
        ax: 0,
        ay: 0,
        trail: [],
      });
    }
    drag = null;
  });

  const { width, height } = ctx.canvas;

  // Where a body launched from the current drag would go, star only, so you
  // can aim before letting go.
  const predict = (gm: number, eps2: number): number[] => {
    if (!drag) return [];
    let x = drag.x;
    let y = drag.y;
    let vx = (drag.cx - drag.x) * 1.2;
    let vy = (drag.cy - drag.y) * 1.2;
    const out = [x, y];
    for (let i = 0; i < 1200; i++) {
      const r2 = x * x + y * y + eps2;
      const inv = gm / (r2 * Math.sqrt(r2));
      vx -= x * inv * 0.004;
      vy -= y * inv * 0.004;
      x += vx * 0.004;
      y += vy * 0.004;
      if (i % 4 === 0) out.push(x, y);
      if (Math.abs(x) > 3 || Math.abs(y) > 3) break;
    }
    return out;
  };

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
          b.ax = -b.x * inv;
          b.ay = -b.y * inv;
          // pull of every other launched body (they're light, but it's honest)
          for (const o of bodies) {
            if (o === b) continue;
            const dx = o.x - b.x;
            const dy = o.y - b.y;
            r2 = dx * dx + dy * dy + eps2;
            inv = (gm * 0.02) / (r2 * Math.sqrt(r2));
            b.ax += dx * inv;
            b.ay += dy * inv;
          }
        }
        for (const b of bodies) {
          if (velocityFirst) {
            // semi-implicit Euler: the new velocity moves the body
            b.vx += b.ax * dt;
            b.vy += b.ay * dt;
            b.x += b.vx * dt;
            b.y += b.vy * dt;
          } else {
            // explicit Euler: the old velocity moves the body
            b.x += b.vx * dt;
            b.y += b.vy * dt;
            b.vx += b.ax * dt;
            b.vy += b.ay * dt;
          }
        }
      }
      bodies = bodies.filter((b) => Math.abs(b.x) < 6 && Math.abs(b.y) < 6);
      for (const b of bodies) {
        b.trail.push(b.x, b.y);
        if (b.trail.length > TRAIL * 2) b.trail.splice(0, 2);
      }

      const px = pixelRatio(shell.canvas);
      const s = Math.min(width, height) / 2 / 1.2;
      const ox = width / 2;
      const oy = height / 2;
      const X = (x: number): number => ox + x * s;
      const Y = (y: number): number => oy - y * s;
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "#06070b";
      ctx.fillRect(0, 0, width, height);

      // star: wide soft halo, then a hot core
      ctx.globalCompositeOperation = "lighter";
      const halo = ctx.createRadialGradient(ox, oy, 0, ox, oy, 80 * px);
      halo.addColorStop(0, "rgba(255, 196, 120, 0.32)");
      halo.addColorStop(0.25, "rgba(255, 160, 90, 0.10)");
      halo.addColorStop(1, "rgba(255, 140, 80, 0)");
      ctx.fillStyle = halo;
      ctx.fillRect(ox - 80 * px, oy - 80 * px, 160 * px, 160 * px);
      const core = ctx.createRadialGradient(ox, oy, 0, ox, oy, 9 * px);
      core.addColorStop(0, "rgba(255, 250, 235, 1)");
      core.addColorStop(0.5, "rgba(255, 220, 160, 0.8)");
      core.addColorStop(1, "rgba(255, 190, 120, 0)");
      ctx.fillStyle = core;
      ctx.fillRect(ox - 9 * px, oy - 9 * px, 18 * px, 18 * px);

      // trails, fading toward the tail, in the body's speed colour
      ctx.lineCap = "round";
      ctx.lineWidth = 1.6 * px;
      for (const b of bodies) {
        const [r, g, bl] = speedRgb(Math.hypot(b.vx, b.vy) * 1.6);
        const n = b.trail.length / 2;
        for (let i = 1; i < n; i++) {
          ctx.strokeStyle = `rgba(${r | 0}, ${g | 0}, ${bl | 0}, ${(i / n) * 0.55})`;
          ctx.beginPath();
          ctx.moveTo(X(b.trail[i * 2 - 2]), Y(b.trail[i * 2 - 1]));
          ctx.lineTo(X(b.trail[i * 2]), Y(b.trail[i * 2 + 1]));
          ctx.stroke();
        }
        const glow = ctx.createRadialGradient(X(b.x), Y(b.y), 0, X(b.x), Y(b.y), 10 * px);
        glow.addColorStop(0, `rgba(${r | 0}, ${g | 0}, ${bl | 0}, 0.55)`);
        glow.addColorStop(1, `rgba(${r | 0}, ${g | 0}, ${bl | 0}, 0)`);
        ctx.fillStyle = glow;
        ctx.fillRect(X(b.x) - 10 * px, Y(b.y) - 10 * px, 20 * px, 20 * px);
        ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
        ctx.beginPath();
        ctx.arc(X(b.x), Y(b.y), 2.2 * px, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";

      // launch preview: the aim line, and the orbit it would make
      if (drag) {
        const path = predict(gm, eps2);
        ctx.setLineDash([2 * px, 5 * px]);
        ctx.lineWidth = 1.2 * px;
        ctx.strokeStyle = "rgba(255, 220, 140, 0.55)";
        ctx.beginPath();
        for (let i = 0; i < path.length; i += 2) {
          if (i === 0) ctx.moveTo(X(path[0]), Y(path[1]));
          else ctx.lineTo(X(path[i]), Y(path[i + 1]));
        }
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.lineWidth = 1.6 * px;
        ctx.strokeStyle = "rgba(255, 220, 120, 0.95)";
        ctx.beginPath();
        ctx.moveTo(X(drag.x), Y(drag.y));
        ctx.lineTo(X(drag.cx), Y(drag.cy));
        ctx.stroke();
        ctx.fillStyle = "rgba(255, 230, 160, 1)";
        ctx.beginPath();
        ctx.arc(X(drag.x), Y(drag.y), 3 * px, 0, Math.PI * 2);
        ctx.fill();
      }
    },
  };
}
