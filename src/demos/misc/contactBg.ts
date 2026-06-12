// Contact-page background: the blog in miniature, kept deliberately cheap.
//   · gravity series — a couple hundred bodies orbit a soft central mass,
//     stepped with semi-implicit Euler and Plummer softening (part 1); the
//     cursor is a test mass that gently perturbs the disk (the slingshot demo)
//   · Barnes-Hut — a quadtree is rebuilt over the bodies every frame, and the
//     faint boxes are the clusters a force walk *from your cursor* would
//     accept under the θ test (step 4 of part 1, with the cursor as the body)
//   · light series — the cursor carries a small light; bodies brighten with
//     inverse-square falloff as it approaches
//   · music series — a click rings the field: three circles expanding at
//     speeds 1 : 3/2 : 2 (unison, fifth, octave) that nudge bodies outward
// Canvas2D, one O(n) pass plus a ~400-node quadtree per frame — well under a
// millisecond, so the page stays a page and never becomes a demo.

interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number; // draw radius, px
}

interface Ripple {
  x: number;
  y: number;
  t: number; // birth, seconds
}

// One quadtree cell: center/half-width, aggregate Σm and Σm·pos (every body
// has mass 1), plus the single occupant while the cell is still a leaf.
interface Cell {
  cx: number;
  cy: number;
  hw: number;
  m: number;
  sx: number;
  sy: number;
  bx: number;
  by: number;
  kids: Cell[] | null;
}

const THETA2 = 0.8 * 0.8;
const MAX_DEPTH = 8;
const RIPPLE_LIFE = 2.2; // seconds
const RIPPLE_RATIOS = [1, 1.5, 2]; // unison, perfect fifth, octave

function makeCell(cx: number, cy: number, hw: number): Cell {
  return { cx, cy, hw, m: 0, sx: 0, sy: 0, bx: 0, by: 0, kids: null };
}

function childFor(c: Cell, x: number, y: number): Cell {
  const i = (x >= c.cx ? 1 : 0) + (y >= c.cy ? 2 : 0);
  return c.kids![i];
}

function split(c: Cell): void {
  const h = c.hw / 2;
  c.kids = [
    makeCell(c.cx - h, c.cy - h, h),
    makeCell(c.cx + h, c.cy - h, h),
    makeCell(c.cx - h, c.cy + h, h),
    makeCell(c.cx + h, c.cy + h, h),
  ];
  const o = childFor(c, c.bx, c.by);
  o.m = 1;
  o.sx = c.bx;
  o.sy = c.by;
  o.bx = c.bx;
  o.by = c.by;
}

function insert(root: Cell, x: number, y: number): void {
  let c = root;
  let depth = 0;
  for (;;) {
    c.m += 1;
    c.sx += x;
    c.sy += y;
    if (c.kids) {
      c = childFor(c, x, y);
      depth++;
      continue;
    }
    if (c.m === 1) {
      c.bx = x;
      c.by = y;
      return;
    }
    if (depth >= MAX_DEPTH) return; // crowded leaf — aggregate only
    split(c);
    c = childFor(c, x, y);
    depth++;
  }
}

export function mountContactBackground(): void {
  const canvas = document.createElement("canvas");
  canvas.className = "contact-bg";
  canvas.setAttribute("aria-hidden", "true");
  document.body.prepend(canvas);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  let w = 0;
  let h = 0;
  let GM = 0; // central mass, tuned so a mid-radius orbit takes ~30 s
  let bodies: Body[] = [];
  const ripples: Ripple[] = [];

  const seedBody = (): Body => {
    const cx = w / 2;
    const cy = h / 2;
    const rMin = Math.min(w, h) * 0.08;
    const rMax = Math.max(w, h) * 0.58;
    const ang = Math.random() * Math.PI * 2;
    const rad = rMin + (rMax - rMin) * Math.sqrt(Math.random());
    const v = Math.sqrt(GM / rad) * (0.88 + Math.random() * 0.24);
    return {
      x: cx + Math.cos(ang) * rad,
      y: cy + Math.sin(ang) * rad,
      vx: -Math.sin(ang) * v,
      vy: Math.cos(ang) * v,
      r: 0.5 + Math.random() * 1.1,
    };
  };

  const fit = (): void => {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const rRef = Math.min(w, h) * 0.35;
    const vRef = rRef * 0.21; // → period ≈ 30 s at the reference radius
    GM = vRef * vRef * rRef;
    const n = Math.max(120, Math.min(280, Math.round((w * h) / 7000)));
    bodies = Array.from({ length: n }, seedBody);
    ctx.fillStyle = "#0a0b10";
    ctx.fillRect(0, 0, w, h);
  };
  fit();

  // ---- pointer: a test mass, and the body the Barnes-Hut walk runs for ----
  let px = -1e6;
  let py = -1e6;
  let pointerAt = -1e6; // last move, ms — drives the fade of boxes & glow
  window.addEventListener(
    "pointermove",
    (e) => {
      px = e.clientX;
      py = e.clientY;
      pointerAt = performance.now();
    },
    { passive: true },
  );
  window.addEventListener("pointerdown", (e) => {
    px = e.clientX;
    py = e.clientY;
    pointerAt = performance.now();
    ripples.push({ x: e.clientX, y: e.clientY, t: performance.now() / 1000 });
    if (ripples.length > 6) ripples.shift();
  });
  window.addEventListener("pointerout", (e) => {
    if (!e.relatedTarget) pointerAt = -1e6;
  });

  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(fit, 150);
  });

  // ---- one frame: physics, then paint ----
  const eps2 = 38 * 38; // Plummer softening for the central mass
  const epsM2 = 80 * 80; // softer still for the cursor — perturb, don't fling
  let last = performance.now();

  const frame = (): void => {
    const now = performance.now();
    const tNow = now / 1000;
    const dt = Math.min((now - last) / 1000, 1 / 30);
    last = now;

    const cx = w / 2;
    const cy = h / 2;
    // boxes/glow/attraction ride one fade: full while the pointer moves,
    // gone a few seconds after it stops, so an idle tab returns to a galaxy
    const idle = (now - pointerAt) / 1000;
    const fade = Math.max(0, Math.min(1, 1 - (idle - 2.5) / 1.2));
    const GMm = GM * 0.16 * fade;
    const escape2 = (w * w + h * h) * 0.7;

    for (const b of bodies) {
      let dx = cx - b.x;
      let dy = cy - b.y;
      let d2 = dx * dx + dy * dy + eps2;
      let inv = GM / (d2 * Math.sqrt(d2));
      let ax = dx * inv;
      let ay = dy * inv;

      if (GMm > 0) {
        dx = px - b.x;
        dy = py - b.y;
        d2 = dx * dx + dy * dy + epsM2;
        inv = GMm / (d2 * Math.sqrt(d2));
        ax += dx * inv;
        ay += dy * inv;
      }

      for (const rp of ripples) {
        const age = tNow - rp.t;
        if (age > RIPPLE_LIFE) continue;
        dx = b.x - rp.x;
        dy = b.y - rp.y;
        const d = Math.sqrt(dx * dx + dy * dy) + 1e-3;
        for (const ratio of RIPPLE_RATIOS) {
          const front = 230 * ratio * age;
          const off = (d - front) / 26;
          if (off > -2 && off < 2) {
            const kick = (34 * (1 - age / RIPPLE_LIFE) * Math.exp(-off * off)) / d;
            ax += dx * kick;
            ay += dy * kick;
          }
        }
      }

      // semi-implicit Euler: velocity first, then position (part 1, step 1)
      b.vx = (b.vx + ax * dt) * (1 - 0.015 * dt);
      b.vy = (b.vy + ay * dt) * (1 - 0.015 * dt);
      b.x += b.vx * dt;
      b.y += b.vy * dt;

      dx = b.x - cx;
      dy = b.y - cy;
      if (dx * dx + dy * dy > escape2) {
        const fresh = seedBody();
        b.x = fresh.x;
        b.y = fresh.y;
        b.vx = fresh.vx;
        b.vy = fresh.vy;
      }
    }

    // ---- paint ----
    ctx.fillStyle = "rgba(10, 11, 16, 0.3)"; // fading trails
    ctx.fillRect(0, 0, w, h);

    if (fade > 0) {
      const glow = ctx.createRadialGradient(px, py, 0, px, py, 280);
      glow.addColorStop(0, `rgba(122, 162, 255, ${0.055 * fade})`);
      glow.addColorStop(1, "rgba(122, 162, 255, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(px - 280, py - 280, 560, 560);

      // quadtree over the live bodies, then the θ-walk from the cursor
      let minX = bodies[0].x;
      let maxX = minX;
      let minY = bodies[0].y;
      let maxY = minY;
      for (const b of bodies) {
        if (b.x < minX) minX = b.x;
        if (b.x > maxX) maxX = b.x;
        if (b.y < minY) minY = b.y;
        if (b.y > maxY) maxY = b.y;
      }
      const hw = Math.max(maxX - minX, maxY - minY) / 2 + 4;
      const root = makeCell((minX + maxX) / 2, (minY + maxY) / 2, hw);
      for (const b of bodies) insert(root, b.x, b.y);

      ctx.lineWidth = 1;
      ctx.strokeStyle = `rgba(255, 184, 107, ${0.085 * fade})`;
      ctx.fillStyle = `rgba(255, 158, 196, ${0.3 * fade})`;
      const walk = (c: Cell): void => {
        if (c.m === 0) return;
        const comx = c.sx / c.m;
        const comy = c.sy / c.m;
        const dx = comx - px;
        const dy = comy - py;
        const d2 = dx * dx + dy * dy;
        const cw = c.hw * 2;
        if (cw * cw < THETA2 * d2 || !c.kids) {
          ctx.strokeRect(c.cx - c.hw, c.cy - c.hw, cw, cw);
          if (c.m > 1) ctx.fillRect(comx - 1, comy - 1, 2, 2); // centre of mass
        } else {
          for (const k of c.kids) walk(k);
        }
      };
      walk(root);
    }

    for (const rp of ripples) {
      const age = tNow - rp.t;
      if (age > RIPPLE_LIFE) continue;
      const die = 1 - age / RIPPLE_LIFE;
      for (let i = 0; i < RIPPLE_RATIOS.length; i++) {
        ctx.beginPath();
        ctx.arc(rp.x, rp.y, 230 * RIPPLE_RATIOS[i] * age, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255, 184, 107, ${0.22 * die * (1 - i * 0.28)})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    for (const b of bodies) {
      const dx = b.x - px;
      const dy = b.y - py;
      // inverse-square light from the cursor, clamped (light series)
      const boost = Math.min(0.45, (4200 / (dx * dx + dy * dy + 4000)) * fade);
      ctx.fillStyle = `rgba(176, 194, 255, ${0.38 + boost})`;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    frame(); // one still of the disk, no animation
    return;
  }

  // rAF-driven, with the same watchdog demoShell uses: some embedded/preview
  // browsers suspend rAF entirely, so a timer keeps the disk turning.
  let lastFrame = 0;
  const loop = (): void => {
    lastFrame = performance.now();
    frame();
    requestAnimationFrame(loop);
  };
  const watchdog = (): void => {
    if (performance.now() - lastFrame > 700) {
      lastFrame = performance.now();
      frame();
    }
    window.setTimeout(watchdog, 250);
  };
  requestAnimationFrame(loop);
  window.setTimeout(watchdog, 250);
}
