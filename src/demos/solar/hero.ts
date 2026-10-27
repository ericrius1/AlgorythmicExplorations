// Hero: sunlight falling into a perovskite-on-silicon tandem, drawn as a cross
// section. Each streak is one photon with its energy drawn from the same
// sunlight spectrum the figures use. Photons above the perovskite's 1.68 eV
// gap mostly stop in the thin top film, photons between 1.12 and 1.68 eV get
// through to the silicon and stop at a depth set by silicon's absorption
// coefficient, and photons below 1.12 eV pass through both. Every absorption
// makes an electron (cyan, drifting up) and a hole (pink, drifting down).

import { Shell, type Demo } from "../../lib/demoShell";
import {
  SI_GAP,
  jph,
  nmFromEv,
  perovskiteAlpha,
  samplePhotonEnergy,
  siliconAlpha,
  topCellSplit,
} from "./physics";
import { MONO, SANS, wavelengthRgb } from "./draw";

const TOP_GAP = 1.68;
const TOP_NM = 500; // perovskite thickness
const SI_UM = 160; // wafer thickness

interface Photon {
  x: number;
  y: number;
  ev: number;
  rgb: [number, number, number];
  stopY: number; // where it gets absorbed (Infinity = never)
  layer: 0 | 1 | 2; // 0 perovskite, 1 silicon, 2 passes
  alive: boolean;
}

interface Carrier {
  x: number;
  y: number;
  vy: number;
  endY: number;
  electron: boolean;
  layer: 0 | 1;
  age: number;
}

interface Flash {
  x: number;
  y: number;
  rgb: [number, number, number];
  heat: number; // excess energy above the gap, eV
  age: number;
  life: number;
  size: number;
}

export function mountTandemHero(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.5);
  const canvas = shell.canvas;
  const ctx = canvas.getContext("2d")!;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = canvas.width / dpr;
  const small = W < 700;
  // phones put the title under the hero, so the frame can be taller than the
  // shell's landscape strip
  if (small) canvas.height = Math.floor(W * 1.1 * dpr);
  const H = canvas.height / dpr;
  // the fixed site nav covers the top of the hero; keep the stack clear of it
  const navH = document.querySelector(".site-nav")?.getBoundingClientRect().height ?? 48;

  // layout in CSS px
  const skyH = small ? navH + (H - navH) * 0.3 : H * 0.34;
  const topY = skyH;
  const topH = Math.max(18, H * 0.07);
  const junctionY = topY + topH;
  const siY = junctionY + 3;
  const siH = H * (small ? 0.4 : 0.25);
  const siBottom = siY + siH;

  // fall direction: a little diagonal, as if the sun were up and to the left
  const dirX = 0.2;
  const dirY = 1;
  const speed = Math.max(90, H * 0.22); // px/s, calm
  const fingerPitch = small ? 120 : 170;
  const fingerW = small ? 5 : 7;

  const photons: Photon[] = [];
  const carriers: Carrier[] = [];
  const flashes: Flash[] = [];
  const rate = W / 20; // photons per second

  // the share of photons that each layer takes, for the readout
  const jAll = jph(0.3);
  const split = topCellSplit(TOP_GAP, TOP_NM);
  const pctTop = Math.round((split.jTop / jAll) * 100);
  const pctSi = Math.round((split.jPass / jAll) * 100);
  const pctOut = 100 - pctTop - pctSi;
  shell.setInfo(
    () => `of 100 sunlight photons: ${pctTop} stop in the perovskite · ${pctSi} reach the silicon · ${pctOut} are below both gaps`,
  );

  const onFinger = (x: number): boolean => {
    const m = ((x % fingerPitch) + fingerPitch) % fingerPitch;
    return m < fingerW;
  };

  const spawn = (y: number): void => {
    const ev = samplePhotonEnergy(Math.random());
    const nm = nmFromEv(ev);
    // start somewhere along the top edge, shifted so diagonal paths cover the width
    const x = Math.random() * (W + H * dirX) - H * dirX * 0.6;
    let layer: 0 | 1 | 2 = 2;
    let stopY = Infinity;
    const uTop = -Math.log(Math.random() + 1e-9);
    const aTop = perovskiteAlpha(ev, TOP_GAP) * TOP_NM * 1e-7; // optical depth of the film
    if (aTop > 0 && uTop < aTop) {
      layer = 0;
      stopY = topY + (uTop / aTop) * topH;
    } else if (ev >= SI_GAP) {
      // depth in the wafer, with one bounce off the rear mirror
      const depthUm = (-Math.log(Math.random() + 1e-9) / siliconAlpha(nm)) * 1e4;
      if (depthUm < SI_UM * 2) {
        layer = 1;
        const d = depthUm < SI_UM ? depthUm : SI_UM * 2 - depthUm;
        stopY = siY + (d / SI_UM) * siH;
      }
    }
    photons.push({ x, y, ev, rgb: wavelengthRgb(nm), stopY, layer, alive: true });
  };

  const absorb = (p: Photon): void => {
    const gap = p.layer === 0 ? TOP_GAP : SI_GAP;
    flashes.push({
      x: p.x,
      y: p.stopY,
      rgb: p.rgb,
      heat: Math.max(0, p.ev - gap),
      age: 0,
      life: 0.9,
      size: small ? 7 : 10,
    });
    const v = small ? 26 : 34;
    const layer = p.layer as 0 | 1;
    const top = layer === 0 ? topY : siY;
    const bottom = layer === 0 ? junctionY : siBottom;
    carriers.push({ x: p.x, y: p.stopY, vy: -v, endY: top + 1, electron: true, layer, age: 0 });
    carriers.push({ x: p.x, y: p.stopY, vy: v, endY: bottom - 1, electron: false, layer, age: 0 });
  };

  let junctionGlow = 0;

  const step = (dt: number): void => {
    let n = rate * dt;
    while (n > 0) {
      if (Math.random() < n) spawn(-20 - Math.random() * 30);
      n -= 1;
    }
    for (const p of photons) {
      if (!p.alive) continue;
      const ny = p.y + dirY * speed * dt;
      const nx = p.x + dirX * speed * dt;
      // the front metal grid shades whatever lands on it
      if (p.y < topY && ny >= topY) {
        const xs = p.x + ((topY - p.y) / (ny - p.y)) * (nx - p.x);
        if (onFinger(xs)) {
          p.alive = false;
          flashes.push({ x: xs, y: topY - 2, rgb: [230, 230, 240], heat: 0, age: 0, life: 0.35, size: 4 });
          continue;
        }
      }
      if (ny >= p.stopY) {
        p.x = p.x + ((p.stopY - p.y) / (ny - p.y)) * (nx - p.x);
        p.y = p.stopY;
        p.alive = false;
        absorb(p);
        continue;
      }
      p.x = nx;
      p.y = ny;
      if (p.y > H + 30) p.alive = false;
    }
    for (const c of carriers) {
      c.age += dt;
      c.y += c.vy * dt;
      const done = c.vy < 0 ? c.y <= c.endY : c.y >= c.endY;
      if (done) {
        c.age = -1;
        // holes from the top cell and electrons from the bottom cell meet at the junction
        if ((c.layer === 0 && !c.electron) || (c.layer === 1 && c.electron)) junctionGlow = Math.min(1, junctionGlow + 0.08);
      }
    }
    for (const f of flashes) f.age += dt;
    junctionGlow *= Math.exp(-dt * 2.5);
    compact(photons, (p) => p.alive);
    compact(carriers, (c) => c.age >= 0);
    compact(flashes, (f) => f.age < f.life);
  };

  // pre-run so the first frame already looks like steady sunlight
  for (let t = 0; t < 7; t += 1 / 30) step(1 / 30);

  // static background, drawn once
  const bg = document.createElement("canvas");
  bg.width = canvas.width;
  bg.height = canvas.height;
  {
    const b = bg.getContext("2d")!;
    b.setTransform(dpr, 0, 0, dpr, 0, 0);
    const sky = b.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, "#0b0d18");
    sky.addColorStop(0.35, "#080912");
    sky.addColorStop(1, "#05060a");
    b.fillStyle = sky;
    b.fillRect(0, 0, W, H);
    // a warm haze where the light comes from
    const sun = b.createRadialGradient(W * 0.18, -H * 0.15, 0, W * 0.18, -H * 0.15, H * 0.9);
    sun.addColorStop(0, "rgba(255, 214, 150, 0.30)");
    sun.addColorStop(0.4, "rgba(255, 170, 110, 0.08)");
    sun.addColorStop(1, "rgba(255, 170, 110, 0)");
    b.fillStyle = sun;
    b.fillRect(0, 0, W, H);

    // perovskite film: green-teal with a faint grain pattern
    const pg = b.createLinearGradient(0, topY, 0, junctionY);
    pg.addColorStop(0, "rgba(70, 200, 150, 0.30)");
    pg.addColorStop(1, "rgba(40, 140, 110, 0.22)");
    b.fillStyle = pg;
    b.fillRect(0, topY, W, topH);
    b.strokeStyle = "rgba(120, 240, 190, 0.10)";
    b.lineWidth = 1;
    let gx = 0;
    let seed = 7;
    const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    while (gx < W) {
      gx += 14 + rnd() * 26;
      b.beginPath();
      b.moveTo(gx, topY + 2);
      b.lineTo(gx + (rnd() - 0.5) * 8, junctionY - 1);
      b.stroke();
    }
    b.fillStyle = "rgba(150, 255, 210, 0.55)";
    b.fillRect(0, topY, W, 1);

    // silicon wafer: deep blue, darker with depth
    const sg = b.createLinearGradient(0, siY, 0, siBottom);
    sg.addColorStop(0, "rgba(70, 100, 200, 0.30)");
    sg.addColorStop(1, "rgba(30, 45, 110, 0.20)");
    b.fillStyle = sg;
    b.fillRect(0, siY, W, siH);
    // rear contact
    b.fillStyle = "rgba(200, 205, 220, 0.35)";
    b.fillRect(0, siBottom, W, 3);

    // front grid fingers
    for (let x = 0; x < W + fingerPitch; x += fingerPitch) {
      b.fillStyle = "rgba(215, 220, 232, 0.85)";
      b.fillRect(x, topY - 5, fingerW, 5);
    }

    // labels down the right side
    const lx = W - (small ? 10 : 22);
    b.textAlign = "right";
    b.font = `600 ${small ? 10 : 12}px ${SANS}`;
    b.fillStyle = "rgba(150, 240, 200, 0.9)";
    b.fillText(`perovskite · ${TOP_GAP} eV · ${TOP_NM} nm`, lx, topY + topH * 0.5 + 4);
    b.fillStyle = "rgba(160, 185, 255, 0.9)";
    b.fillText(`silicon · ${SI_GAP} eV · ${SI_UM} µm`, lx, siY + (small ? 16 : 22));
    b.font = `${small ? 9 : 11}px ${MONO}`;
    b.fillStyle = "rgba(160, 170, 200, 0.6)";
    b.fillText(`${Math.round((SI_UM * 1000) / TOP_NM)}× thicker than the film; not to scale`, lx, siY + (small ? 30 : 40));
    b.textAlign = "left";
  }

  let last = performance.now();

  return {
    frame() {
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      step(dt);

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(bg, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // recombination junction: brightens as carriers from both cells arrive
      ctx.fillStyle = `rgba(255, 190, 100, ${0.35 + junctionGlow * 0.5})`;
      ctx.fillRect(0, junctionY, W, 3);

      ctx.globalCompositeOperation = "lighter";
      const tail = small ? 18 : 34;
      ctx.lineCap = "round";
      for (const p of photons) {
        if (!p.alive) continue;
        const [r, g, b] = p.rgb;
        const ir = p.ev < 1.65;
        const a = ir ? 0.4 : 0.95;
        // a short tail behind the photon, shortened if it just came out of the stack
        const len = Math.min(tail, p.y - (p.y > siBottom ? siBottom : -50));
        const x0 = p.x - dirX * len;
        const y0 = p.y - len;
        const grad = ctx.createLinearGradient(x0, y0, p.x, p.y);
        grad.addColorStop(0, `rgba(${r},${g},${b},0)`);
        grad.addColorStop(1, `rgba(${r},${g},${b},${a})`);
        ctx.strokeStyle = grad;
        // soft glow, then the bright core
        ctx.globalAlpha = 0.22;
        ctx.lineWidth = ir ? 3 : 5;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.lineWidth = ir ? 1.2 : 1.9;
        ctx.stroke();
        if (!ir) {
          ctx.fillStyle = `rgba(255,255,255,0.8)`;
          ctx.fillRect(p.x - 0.8, p.y - 0.8, 1.6, 1.6);
        }
      }

      for (const f of flashes) {
        const t = f.age / f.life;
        const a = (1 - t) * (1 - t);
        const rad = f.size * (0.6 + t * 1.4);
        const [r, g, b] = f.rgb;
        const glow = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, rad);
        glow.addColorStop(0, `rgba(255,255,255,${0.9 * a})`);
        glow.addColorStop(0.35, `rgba(${r},${g},${b},${0.6 * a})`);
        glow.addColorStop(1, `rgba(${r},${g},${b},0)`);
        ctx.fillStyle = glow;
        ctx.fillRect(f.x - rad, f.y - rad, rad * 2, rad * 2);
        // the excess energy above the gap leaves as heat: an orange ring
        if (f.heat > 0.15) {
          ctx.strokeStyle = `rgba(255, 150, 70, ${Math.min(0.5, f.heat * 0.4) * a})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(f.x, f.y, rad * (0.8 + f.heat * 0.6), 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      for (const c of carriers) {
        const fade = Math.min(1, c.age * 4);
        ctx.fillStyle = c.electron ? `rgba(79, 216, 255, ${0.7 * fade})` : `rgba(255, 123, 184, ${0.7 * fade})`;
        ctx.beginPath();
        ctx.arc(c.x, c.y, small ? 1.3 : 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";
      shell.tick();
    },
  };
}

function compact<T>(arr: T[], keep: (v: T) => boolean): void {
  let j = 0;
  for (let i = 0; i < arr.length; i++) if (keep(arr[i])) arr[j++] = arr[i];
  arr.length = j;
}
