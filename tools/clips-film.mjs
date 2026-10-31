// Series clips for the portfolio: longer looks at a few live figures, one series a clip, a cursor playing with them
// the way a visitor would. Grown from PortfolioII's scripts/explorations-film.mjs (the thirteen-figure montage): the
// same virtual clock, supersampled screenshots, score in D, and captions in the site's fonts.
//
//   node tools/clips-film.mjs --clip <light|particles|ground> --stage capture [--only 0,2 | --reshoot 0,2] [--preview] [--fps 60]
//   node tools/clips-film.mjs --clip <name> --stage cards   (the score and cards alone, after a change to them)
//   node tools/clips-film.mjs --clip <name> --stage cut <out.mp4>
//
// capture: each shot is a figure on a local dev server of this repo (BASE, default http://127.0.0.1:5317/), run on a
// virtual clock (requestAnimationFrame and performance.now are the script's, stepped a frame at a time, warm-up
// included, so a figure's own adaptive quality only ever sees 60 fps) and screenshotted at 2x for a supersampled
// 720p. A drawn cursor moves, presses and drags over the canvas with real pointer events under it. The score and the
// cards are made in the same browser. Everything lands in .clips/<clip>/ (WORK to move it).
// cut: ffmpeg crossfades the shots, lays the cards over and muxes the score: H.264 High, CRF 20 (or the clip's), AAC 192k, 720p.
// --preview: device scale 1 and every 4th frame only, into .clips/<clip>-preview/, for checking framing and paths.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const VALUED = /^--(fps|only|clip|stage|reshoot)$/;
const pos = argv.filter((a, i) => !a.startsWith('--') && !VALUED.test(argv[i - 1] ?? ''));
const flag = (k, d) => { const i = argv.indexOf(`--${k}`); return i < 0 ? d : argv[i + 1]; };
const CLIP = flag('clip', 'light');
const STAGE = flag('stage', 'capture');
const PREVIEW = argv.includes('--preview');
const FPS = Number(flag('fps', 60));
const EVERY = PREVIEW ? 4 : 1;
const W = 1280, H = 720;
const BASE = process.env.BASE ?? 'http://127.0.0.1:5317/';
const FADE = 0.9;
const WORK = resolve(process.env.WORK ?? join(ROOT, '.clips', PREVIEW ? `${CLIP}-preview` : CLIP));
const FFMPEG = process.env.FFMPEG ?? 'ffmpeg';
const ff = (args) => new Promise((ok, no) => spawn(FFMPEG, ['-y', '-loglevel', 'error', '-threads', '8', ...args], { stdio: 'inherit' })
  .on('close', (c) => (c ? no(new Error(`ffmpeg ${c}`)) : ok())));

// ---------------------------------------------------------------- the cursor's paths
// A path is keys [t, x, y, flag?]: seconds into the shot, and 0..1 across the visible 16:9 frame (outside it is off
// the canvas). Between keys it runs on a Catmull-Rom curve in time (tangents from the neighbours, weighted by their
// spacing), so it moves like a hand: no corners, no sudden speeds. Flags: 's' stops there (zero velocity), 'd' presses
// the button there and holds it, 'u' lets it go (both also stop there).
const path = (...ks) => {
  const n = ks.length;
  const stop = ks.map(([, , , f], i) => i === 0 || i === n - 1 || /[sdu]/.test(f ?? ''));
  const tan = ks.map((k, i) => {
    if (stop[i]) return [0, 0];
    const [a, b] = [ks[i - 1], ks[i + 1]];
    const d0 = k[0] - a[0], d1 = b[0] - k[0];
    return [1, 2].map((c) => (((k[c] - a[c]) / d0) * d1 + ((b[c] - k[c]) / d1) * d0) / (d0 + d1));
  });
  return (t) => {
    let down = false;
    for (const k of ks) if (t >= k[0]) { if (/d/.test(k[3] ?? '')) down = true; if (/u/.test(k[3] ?? '')) down = false; }
    if (t <= ks[0][0]) return [ks[0][1], ks[0][2], down];
    if (t >= ks[n - 1][0]) return [ks[n - 1][1], ks[n - 1][2], down];
    let i = 0;
    while (ks[i + 1][0] < t) i++;
    const [a, b] = [ks[i], ks[i + 1]];
    const h = b[0] - a[0], u = (t - a[0]) / h, u2 = u * u, u3 = u2 * u;
    const p = [1, 2].map((c, j) => (2 * u3 - 3 * u2 + 1) * a[c] + (u3 - 2 * u2 + u) * h * tan[i][j] + (-2 * u3 + 3 * u2) * b[c] + (u3 - u2) * h * tan[i + 1][j]);
    return [p[0], p[1], down];
  };
};
// keys going round an ellipse (centre cx, cy; radii rx, ry), from t0 to t1, `turns` times, starting at angle a0
const loop = (t0, t1, cx, cy, rx, ry, turns, a0 = 0, per = 6) => {
  const n = Math.max(2, Math.round(turns * per)), out = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + (i / n) * turns * Math.PI * 2;
    out.push([t0 + ((t1 - t0) * i) / n, cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return out;
};

// ---------------------------------------------------------------- the clips
// shot: page, fig (its [data-demo] kind), warm (seconds run before filming), dur, cap (caption) and kicker, mouse
// (a path), setup (page-side code run before the warm-up, with `fig` the figure), ramps (sliders moved over time, as a
// visitor drags them: [label, from, to, t0, t1]), acts ([t, code] run at that moment), scale (device pixels per css
// pixel), crop ([x, y, w] of the canvas, 0..1, to film a part of it; the height follows at 16:9).
const CLIPS = {
  light: {
    title: 'Bounced Light', sub: 'fire, fog, wax and walls, lit by radiance cascades',
    poster: [2, 270], // the lava lamp's plume (shot, frame): written beside the clip as its .jpg
    shots: [
      // stirring the embers over the fire, then away
      // (the cursor waits off the frame while the title is up)
      { page: 'pages/bounced-light/bonfire.html', fig: 'hero-fire', warm: 6, dur: 13, cap: 'The Bonfire', kicker: 'Bounced Light · Part 2', crop: [0.15, 0.12, 0.7],
        mouse: path([0, 1.12, 0.3], [3.8, 1.12, 0.3, 's'], [5.0, 0.72, 0.36], ...loop(6.0, 11.0, 0.5, 0.5, 0.1, 0.13, 1.8, Math.PI * 0.1), [12.9, 1.15, 0.5]) },
      // the lamp carried to the red wall, then the green: the room takes each colour
      { page: 'pages/bounced-light/bonfire.html', fig: 'room', warm: 4, dur: 10.5, cap: 'Colour bleeding', kicker: 'The Bonfire · Fig. 2',
        mouse: path([0, 0.5, 0.6], [2.2, 0.15, 0.62], [3.8, 0.1, 0.42], [6.0, 0.5, 0.74], [8.2, 0.88, 0.55], [10.5, 0.72, 0.36]) },
      // the wax warming and climbing, left alone
      { page: 'pages/bounced-light/lava.html', fig: 'hero-lamp', warm: 2, dur: 10, cap: 'The Lava Lamp', kicker: 'Bounced Light · Part 1' },
      // an ember stroke, a cyan one (the colour button, below the frame), then a wall that throws shadows
      { page: 'pages/bounced-light/lava.html', fig: 'paint', warm: 3, dur: 13, cap: 'Paint with light', kicker: 'The Lava Lamp · Fig. 2',
        acts: [[5.0, `window.__fig.button('paint', 'colour')`], [9.4, `window.__fig.button('paint', 'paint wall')`]],
        mouse: path([0, 0.25, 1.15], [1.2, 0.17, 0.38, 'd'], [2.0, 0.22, 0.26], [2.8, 0.32, 0.2], [3.6, 0.42, 0.25, 'u'], [4.6, 0.3, 1.15, 's'], [5.4, 0.3, 1.15, 's'],
          [6.2, 0.6, 0.78, 'd'], [7.2, 0.72, 0.7], [8.2, 0.86, 0.74, 'u'], [9.0, 0.6, 1.15, 's'], [9.6, 0.6, 1.15, 's'], [10.4, 0.64, 0.42, 'd'], [11.8, 0.8, 0.5, 'u'], [12.4, 0.76, 0.34], [13, 0.74, 0.3]) },
      // smoke blown into two shafts of sun (the cursor gone before the end card)
      { page: 'pages/bounced-light/fog.html', fig: 'shafts', warm: 5, dur: 12, cap: 'Sun through two slits', kicker: 'The Fog · Fig. 2',
        mouse: path([0, 1.1, 0.78], [1.2, 0.82, 0.72], [2.8, 0.55, 0.62], [4.4, 0.3, 0.68], [5.8, 0.42, 0.5], [7.0, 0.6, 0.62], [8.0, 0.66, 1.15]) },
    ],
  },
  particles: {
    title: 'Particle Worlds', sub: 'water, dust and the cosmic web, a particle at a time',
    crf: 23, // (a million moving points cost bits: 23 looks the same as 20 here at two thirds of the size)
    poster: [2, 310], // the web as its filaments light up
    shots: [
      // splashing the tank (once the title has gone)
      { page: 'pages/particle-worlds/part3.html', fig: 'hero-fluid', warm: 6, dur: 13, cap: 'Sorting Water', kicker: 'Particle Worlds · Part 3',
        mouse: path([0, -0.1, 0.55], [3.8, -0.1, 0.55, 's'], [5.4, 0.3, 0.62], [6.8, 0.5, 0.75], [8.2, 0.68, 0.6], [9.8, 0.45, 0.68], [11.2, 0.6, 0.8], [13, 1.1, 0.7]) },
      // a ring of dust under its own gravity: clumps, then galaxies that find each other
      { page: 'pages/particle-worlds/part4.html', fig: 'ghosts', warm: 0.5, dur: 11, cap: 'Gravity only', kicker: 'Worlds from Dust · Fig. 1' },
      // the web growing from small ripples, stirred while it is all filaments, then left to gather into halos
      // (The Fluid Instrument was tried last and dropped: its dye smears into a hard-edged block where the cursor leaves)
      { page: 'pages/particle-worlds/part5.html', fig: 'hero-web', warm: 0.2, dur: 14, cap: 'Gravity in Frequency Space', kicker: 'Particle Worlds · Part 5',
        mouse: path([0, -0.1, 0.62], [5.2, -0.1, 0.62, 's'], [6.4, 0.26, 0.52], [7.6, 0.48, 0.64], [8.8, 0.64, 0.42], [10.0, 1.1, 0.3]) },
    ],
  },
  ground: {
    title: 'Ground Truth', sub: 'terrain from noise, rain, grass and trees, streamed without end',
    poster: [0, 330], // the sunset flight over the trees
    shots: [
      { page: 'pages/ground-truth/horizon.html', fig: 'hero-horizon', warm: 6, dur: 12, cap: 'The Horizon', kicker: 'Ground Truth · Part 6' },
      { page: 'pages/ground-truth/grass.html', fig: 'hero-grass', warm: 5, dur: 10, cap: 'The Grass', kicker: 'Ground Truth · Part 3' },
      { page: 'pages/ground-truth/erosion.html', fig: 'hero-erosion', warm: 6, dur: 10, cap: 'The Rain', kicker: 'Ground Truth · Part 2' },
      // dragging the eroding island round
      { page: 'pages/ground-truth/erosion.html', fig: 'erode', warm: 5, dur: 11, cap: 'The storm, in 3D', kicker: 'The Rain · Fig. 2',
        mouse: path([0, 0.85, 1.15], [1.2, 0.7, 0.55, 's'], [1.4, 0.7, 0.55, 'd'], [5.4, 0.36, 0.53], [5.7, 0.35, 0.53, 'u'], [7.2, 0.58, 0.6, 's'], [7.4, 0.58, 0.6, 'd'], [10.4, 0.42, 0.58], [10.6, 0.41, 0.58, 'u'], [11, 0.4, 0.64]) },
      // steering the endless flight (let go before the end card)
      { page: 'pages/ground-truth/horizon.html', fig: 'flight', warm: 5, dur: 13, cap: 'The endless flight', kicker: 'The Horizon · Fig. 2',
        mouse: path([0, 0.5, 1.15], [1.4, 0.5, 0.55, 's'], [1.6, 0.5, 0.55, 'd'], [4.4, 0.36, 0.5], [7.4, 0.58, 0.54], [7.6, 0.58, 0.54, 'u'], [8.8, 0.64, 1.15]) },
    ],
  },
};

const DEF = CLIPS[CLIP];
if (!DEF) throw new Error(`no clip "${CLIP}" (${Object.keys(CLIPS).join(', ')})`);
const only = flag('only', null)?.split(',').map(Number);
// --reshoot 0,4: film just those shots again (the rest kept from before); the score and cards are made for the whole clip
const reshoot = flag('reshoot', null)?.split(',').map(Number);
const SHOTS = DEF.shots.map((s, i) => ({ ...s, i })).filter((s) => !only || only.includes(s.i));
let at = 0;
for (const s of SHOTS) { s.at = at; at += s.dur - FADE; }
const SECONDS = at + FADE;
const shotDir = (s) => join(WORK, `shot${String(s.i).padStart(2, '0')}`);

// ---------------------------------------------------------------- capture
async function capture(cardsOnly = false) {
  const { chromium } = await import(process.env.PLAYWRIGHT ?? 'file:///C:/Users/ericr/codeprojects/weft-migration/PortfolioII/node_modules/playwright/index.mjs');
  const browser = await chromium.launch({
    channel: 'chrome', headless: true,
    args: ['--mute-audio', '--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist',
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
  });
  mkdirSync(WORK, { recursive: true });

  // the clock the script steps; requestAnimationFrame callbacks wait in a queue until it does
  const CLOCK = `(() => {
    const realRAF = requestAnimationFrame.bind(window), realCancel = cancelAnimationFrame.bind(window);
    const realNow = performance.now.bind(performance), realDate = Date.now;
    let virt = false, t = 0, base = 0, next = 1e7;
    const q = new Map();
    window.__film = {
      start() { if (virt) return; t = realNow(); base = realDate() - t; virt = true; },
      step(ms) { t += ms; const cbs = [...q.values()]; q.clear(); for (const cb of cbs) { try { cb(t); } catch (e) { console.error(e); } } return cbs.length; },
      frame(n = 2) { return new Promise((r) => { const go = (k) => (k ? realRAF(() => go(k - 1)) : r()); go(n); }); },
    };
    window.requestAnimationFrame = (cb) => { if (!virt) return realRAF(cb); const id = next++; q.set(id, cb); return id; };
    window.cancelAnimationFrame = (id) => { if (q.has(id)) q.delete(id); else realCancel(id); };
    performance.now = () => (virt ? t : realNow());
    Date.now = () => (virt ? Math.round(base + t) : realDate());
  })();`;
  // the page's words and chrome hidden, and the drawn cursor
  const BARE = `.site-nav, .hero-title, .hero-scroll-hint, .home-hero-inner, header.hero .demo-readout, header.hero .demo-controls,
    .synth-play, .ms-hero-pill, .mp-gate, .k-toggle, .ui-toggle { visibility: hidden !important; }
    html { scroll-behavior: auto !important; }
    #film-cursor { position: fixed; left: 0; top: 0; z-index: 2147483647; pointer-events: none; transform-origin: 0 0; will-change: transform; }`;
  const CURSOR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" style="overflow:visible;display:block">
    <defs><filter id="fcs" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="1" stdDeviation="1.3" flood-color="#000" flood-opacity="0.55"/></filter></defs>
    <circle id="fc-ring" cx="0" cy="0" r="11" fill="rgba(255,255,255,0.10)" stroke="rgba(255,255,255,0.55)" stroke-width="1.2" opacity="0"/>
    <path filter="url(#fcs)" d="M0 0 L0 17.2 L4.1 13.3 L6.9 19.6 L9.6 18.4 L6.9 12.3 L12.4 12.3 Z" fill="#fff" stroke="#111" stroke-width="1.15" stroke-linejoin="round"/></svg>`;

  // page-side helpers: move a figure's slider or press its button, as the strip under it would
  const HELP = `window.__fig = {
    el(kind) { return document.querySelector('[data-demo="' + kind + '"]'); },
    slider(kind, label, v) {
      for (const w of this.el(kind).querySelectorAll('.demo-slider')) {
        if (!w.textContent.trim().toLowerCase().startsWith(label)) continue;
        const inp = w.querySelector('input[type=range]'); inp.value = String(v); inp.dispatchEvent(new Event('input')); return true;
      }
      throw new Error('no slider ' + label);
    },
    button(kind, text) {
      for (const b of this.el(kind).querySelectorAll('button')) if (b.textContent.trim().toLowerCase().startsWith(text)) { b.click(); return true; }
      throw new Error('no button ' + text);
    },
  };`;

  for (const s of SHOTS) {
    if (cardsOnly || (reshoot && !reshoot.includes(s.i))) continue;
    const dir = shotDir(s);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const hero = s.fig.startsWith('hero');
    const scale = PREVIEW ? 1 : (s.scale ?? 2);
    // 837 tall makes an essay's hero exactly 16:9 (its shell fits the hero to 86% of the window)
    const page = await browser.newPage({ viewport: { width: W, height: 837 }, deviceScaleFactor: scale });
    page.on('pageerror', (e) => console.warn(`  ${s.page}: ${e.message.slice(0, 200)}`));
    page.on('console', (m) => { if (m.type() === 'error') console.warn(`  ${s.page} console: ${m.text().slice(0, 200)}`); });
    await page.addInitScript(CLOCK);
    await page.goto(BASE + s.page, { waitUntil: 'load', timeout: 90000 });
    await page.addStyleTag({ content: BARE });
    await page.evaluate(HELP);
    // the figure into the middle of the window (it builds on approach), its canvas found once it has one
    await page.evaluate((k) => { const el = window.__fig.el(k); if (k.startsWith('hero')) scrollTo(0, 0); else el.scrollIntoView({ block: 'center' }); }, s.fig);
    await page.waitForFunction((k) => { const c = window.__fig.el(k)?.querySelector('canvas'); return c && c.getBoundingClientRect().height > 50; }, s.fig, { timeout: 60000 });
    await page.waitForTimeout(1500);
    if (s.setup) await page.evaluate(`(() => { const fig = window.__fig.el(${JSON.stringify(s.fig)}); ${s.setup} })()`);
    // the visible frame: the canvas (or the part of it asked for), cut to 16:9 round its middle
    const r = await page.evaluate((k) => { const b = window.__fig.el(k).querySelector('canvas').getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; }, s.fig);
    let box = s.crop ? { x: r.x + s.crop[0] * r.w, y: r.y + s.crop[1] * r.h, w: s.crop[2] * r.w, h: (s.crop[2] * r.w * 9) / 16 } : r;
    let clip;
    if (box.h > (box.w * 9) / 16) clip = { x: box.x, y: box.y + (box.h - (box.w * 9) / 16) / 2, width: box.w, height: (box.w * 9) / 16 };
    else clip = { x: box.x + (box.w - (box.h * 16) / 9) / 2, y: box.y, width: (box.h * 16) / 9, height: box.h };
    // the cursor drawn a little larger than a 1280-wide screen's (it has to read in a video), whatever the figure's size
    const cursorScale = (1.2 * clip.width) / W;
    await page.evaluate(({ svg, k }) => { const d = document.createElement('div'); d.id = 'film-cursor'; d.innerHTML = svg; d.style.opacity = '0'; d.dataset.k = k; document.body.appendChild(d); }, { svg: CURSOR_SVG, k: cursorScale });
    const at01 = ([x, y]) => [clip.x + x * clip.width, clip.y + y * clip.height];

    // warm up on the virtual clock, the cursor parked where it starts
    let down = false;
    const [x0, y0] = s.mouse ? s.mouse(0) : [-1, -1];
    if (s.mouse) await page.mouse.move(...at01([x0, y0]));
    await page.evaluate(() => window.__film.start());
    // (a figure that wanders on its own when the pointer has been still is kept from it: the cursor twitches by half a
    // pixel every half second while it waits, so the first frame filmed carries on from the warm-up without a jump)
    const warmN = Math.round(s.warm * FPS);
    for (let f = 0; f < warmN; f++) {
      if (s.mouse && f % 30 === 0) { const [wx, wy] = at01([x0, y0]); await page.mouse.move(wx + ((f / 30) % 2) * 0.5, wy); }
      await page.evaluate((ms) => { window.__film.step(ms); return window.__film.frame(1); }, 1000 / FPS);
    }
    await page.evaluate(() => window.__film.frame(3));

    const n = Math.round(s.dur * FPS);
    const acts = [...(s.acts ?? [])].sort((a, b) => a[0] - b[0]);
    let ai = 0, shots = 0;
    const t0 = Date.now();
    for (let f = 0; f < n; f++) {
      const t = f / FPS;
      let cur = null;
      if (s.mouse) {
        const [x, y, d] = s.mouse(t);
        const [px, py] = at01([x, y]);
        await page.mouse.move(px, py);
        if (d && !down) await page.mouse.down();
        if (!d && down) await page.mouse.up();
        down = d;
        // the drawn cursor: shown inside the frame (faded at its edges), its ring while pressed
        const inside = Math.min(x + 0.02, 1.02 - x, y + 0.02, 1.02 - y);
        cur = { px, py, o: Math.max(0, Math.min(1, inside / 0.04)), d };
      }
      while (ai < acts.length && acts[ai][0] <= t) await page.evaluate(acts[ai++][1]);
      const ramp = (s.ramps ?? []).filter(([, , , a, b]) => t >= a && t <= b + 0.5 / FPS).map(([label, v0, v1, a, b]) => {
        const u = Math.min(1, (t - a) / (b - a)), e = u * u * (3 - 2 * u);
        return [label, v0 + (v1 - v0) * e];
      });
      await page.evaluate(({ ms, cur, ramp, k }) => {
        for (const [label, v] of ramp) window.__fig.slider(k, label, v);
        if (cur) {
          const el = document.getElementById('film-cursor');
          const sc = Number(el.dataset.k) * (cur.d ? 0.92 : 1);
          el.style.transform = `translate(${cur.px}px, ${cur.py}px) scale(${sc})`;
          el.style.opacity = String(cur.o);
          el.querySelector('#fc-ring').setAttribute('opacity', cur.d ? '1' : '0');
        }
        window.__film.step(ms);
        return window.__film.frame();
      }, { ms: 1000 / FPS, cur, ramp, k: s.fig });
      if (f % EVERY === 0) {
        await page.screenshot({ path: join(dir, `${String(f / EVERY).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 93, clip });
        shots++;
      }
    }
    if (down) await page.mouse.up();
    await page.close();
    console.log(`${s.i} ${s.cap}: ${shots} frames at ${scale}x (${(clip.width * scale).toFixed(0)}x${(clip.height * scale).toFixed(0)}) in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }

  if (!PREVIEW) {
    writeFileSync(join(WORK, 'score.wav'), await score(browser));
    await cards(browser);
  }
  await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 5000))]);
}

// ---------------------------------------------------------------- the score
// D major, slow: a pad turning through its chords, a bell at every cut climbing the pentatonic, sparkles, air, a long
// room (the montage's score, stretched to the clip, its sparkles seeded by the clip)
async function score(browser) {
  const page = await browser.newPage();
  const cuts = SHOTS.map((s) => s.at);
  const seed = [...CLIP].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) % 100000 + 1;
  const data = await page.evaluate(async ({ seconds, cuts, seed }) => {
    const SR = 48000;
    const ctx = new OfflineAudioContext(2, Math.ceil(seconds * SR), SR);
    const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
    const master = ctx.createGain();
    master.gain.setValueAtTime(0, 0);
    master.gain.linearRampToValueAtTime(0.9, 1.2);
    master.gain.setValueAtTime(0.9, seconds - 3);
    master.gain.linearRampToValueAtTime(0, seconds);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 3; comp.attack.value = 0.02; comp.release.value = 0.4;
    const makeup = ctx.createGain();
    makeup.gain.value = 2.25;
    master.connect(comp).connect(makeup).connect(ctx.destination);
    const verb = ctx.createConvolver();
    const ir = ctx.createBuffer(2, SR * 4, SR);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3.2) * Math.exp(-i / (SR * 1.1));
    }
    verb.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    verb.connect(wet).connect(master);
    const bus = (dry) => { const g = ctx.createGain(); g.gain.value = dry; g.connect(master); g.connect(verb); return g; };
    const padBus = bus(0.5);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 900; lp.Q.value = 0.4;
    const lfo = ctx.createOscillator(), lfoG = ctx.createGain();
    lfo.frequency.value = 0.07; lfoG.gain.value = 420;
    lfo.connect(lfoG).connect(lp.frequency);
    lfo.start(0);
    lp.connect(padBus);
    const chords = [[50, 57, 61, 64, 66], [47, 54, 57, 61, 62], [43, 50, 54, 57, 59], [40, 47, 50, 54, 55], [50, 57, 61, 64, 66], [45, 52, 59, 61, 64], [50, 57, 62, 66, 69]];
    const len = seconds / (chords.length - 0.6);
    chords.forEach((ch, k) => {
      const t0 = k * len, t1 = Math.min(seconds, t0 + len + 2.2);
      for (const m of ch) {
        for (const det of [-7, 6]) {
          const o = ctx.createOscillator(), g = ctx.createGain();
          o.type = 'sawtooth'; o.frequency.value = hz(m); o.detune.value = det;
          g.gain.setValueAtTime(0, t0);
          g.gain.linearRampToValueAtTime(0.022, t0 + 2.0);
          g.gain.setValueAtTime(0.022, Math.max(t0 + 2.0, t1 - 2.4));
          g.gain.linearRampToValueAtTime(0, t1);
          o.connect(g).connect(lp);
          o.start(t0); o.stop(t1 + 0.05);
        }
      }
      const s = ctx.createOscillator(), sg = ctx.createGain();
      s.type = 'sine'; s.frequency.value = hz(ch[0] - 12);
      sg.gain.setValueAtTime(0, t0); sg.gain.linearRampToValueAtTime(0.09, t0 + 1.5);
      sg.gain.setValueAtTime(0.09, Math.max(t0 + 1.5, t1 - 2.4)); sg.gain.linearRampToValueAtTime(0, t1);
      s.connect(sg).connect(padBus); s.start(t0); s.stop(t1 + 0.05);
    });
    const bellBus = bus(0.7);
    const bell = (m, t, level, decay, pan) => {
      const c = ctx.createOscillator(), mod = ctx.createOscillator(), mg = ctx.createGain(), g = ctx.createGain(), p = ctx.createStereoPanner();
      c.frequency.value = hz(m); mod.frequency.value = hz(m) * 3.5;
      mg.gain.setValueAtTime(hz(m) * 2.2, t); mg.gain.exponentialRampToValueAtTime(1, t + decay * 0.6);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(level, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
      p.pan.value = pan;
      mod.connect(mg).connect(c.frequency);
      c.connect(g).connect(p).connect(bellBus);
      c.start(t); mod.start(t); c.stop(t + decay + 0.1); mod.stop(t + decay + 0.1);
    };
    const penta = [62, 64, 66, 69, 71];
    cuts.forEach((t, k) => {
      const m = penta[k % 5] + 12 * Math.floor(k / 5) + 12;
      bell(m, t + 0.05, 0.11, 4.2, (k % 2 ? 0.35 : -0.35));
      bell(m - 12, t + 0.05, 0.05, 5, 0);
    });
    let rs = seed;
    const rnd = () => ((rs = (rs * 16807) % 2147483647) / 2147483647);
    for (let t = 1.8; t < seconds - 3; t += 0.9 + rnd() * 1.8) bell(penta[Math.floor(rnd() * 5)] + 24, t, 0.03 + rnd() * 0.025, 2.6, rnd() * 1.4 - 0.7);
    const noise = ctx.createBuffer(1, SR * 2, SR);
    const nd = noise.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    const air = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), ag = ctx.createGain();
    air.buffer = noise; air.loop = true; bp.type = 'bandpass'; bp.frequency.value = 2400; bp.Q.value = 0.6; ag.gain.value = 0.012;
    air.connect(bp).connect(ag).connect(master); air.start(0);
    const buf = await ctx.startRendering();
    const toB64 = (f) => { const b = new Uint8Array(f.buffer); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };
    return { sr: SR, l: toB64(buf.getChannelData(0)), r: toB64(buf.getChannelData(1)) };
  }, { seconds: SECONDS, cuts, seed });
  await page.close();
  const L = new Float32Array(Buffer.from(data.l, 'base64').buffer.slice(0)), R = new Float32Array(Buffer.from(data.r, 'base64').buffer.slice(0));
  const n = L.length, wav = Buffer.alloc(44 + n * 4);
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + n * 4, 4); wav.write('WAVE', 8); wav.write('fmt ', 12);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22); wav.writeUInt32LE(data.sr, 24);
  wav.writeUInt32LE(data.sr * 4, 28); wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i])) * 32767), 44 + i * 4);
    wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i])) * 32767), 46 + i * 4);
  }
  return wav;
}

// ---------------------------------------------------------------- the cards
// the series' title over the first shot, a caption on each shot (its name, and the page's own kicker), and the end card
async function cards(browser) {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  const css = `
    @import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Space+Mono&display=block');
    html, body { margin: 0; background: transparent; width: ${W}px; height: ${H}px; color: #f3eef5; overflow: hidden; }
    .mid { position: absolute; inset: 0; display: grid; place-content: center; justify-items: center; text-align: center; padding-bottom: ${Math.round(H * 0.04)}px;
      background: radial-gradient(ellipse 44% 30% at 50% 47%, rgba(0,0,0,0.38), rgba(0,0,0,0.16) 55%, rgba(0,0,0,0) 100%); }
    .mid.end { background: radial-gradient(ellipse 50% 36% at 50% 49%, rgba(0,0,0,0.56), rgba(0,0,0,0.26) 55%, rgba(0,0,0,0) 100%); }
    h1 { margin: 0; font: 400 ${Math.round(H * 0.125)}px/0.95 'Instrument Serif', serif; letter-spacing: -0.015em; text-shadow: 0 2px ${Math.round(H * 0.05)}px rgba(0,0,0,0.75); }
    .sub { margin: ${Math.round(H * 0.018)}px 0 0; font: italic 400 ${Math.round(H * 0.038)}px 'Instrument Serif', serif; color: rgba(243,238,245,0.78); text-shadow: 0 1px 14px rgba(0,0,0,0.8); }
    .url { margin: ${Math.round(H * 0.05)}px 0 0; font: 400 ${Math.round(H * 0.021)}px 'Space Mono', monospace; letter-spacing: 0.08em; color: rgba(243,238,245,0.85); text-shadow: 0 1px 10px rgba(0,0,0,0.8); }
    .cap { position: absolute; left: ${Math.round(H * 0.06)}px; bottom: ${Math.round(H * 0.06)}px; margin: 0; font: 400 ${Math.round(H * 0.03)}px 'Instrument Serif', serif; color: rgba(243,238,245,0.88); text-shadow: 0 1px 12px rgba(0,0,0,0.85); }
    .cap b { font-weight: 400; font-style: italic; }
    .cap span { font: 400 ${Math.round(H * 0.017)}px 'Space Mono', monospace; letter-spacing: 0.14em; text-transform: uppercase; opacity: 0.8; }`;
  const made = {
    title: `<div class="mid"><h1>${DEF.title}</h1><p class="sub">${DEF.sub}</p></div>`,
    end: '<div class="mid end"><h1>Algorythmic Explorations</h1><p class="sub">essays where every figure is a live simulation</p><p class="url">ericlevin.dev/algorythmicexplorations</p></div>',
  };
  for (const s of SHOTS) made[`cap${s.i}`] = `<p class="cap"><b>${s.cap}</b> &nbsp;<span>${s.kicker}</span></p>`;
  for (const [name, body] of Object.entries(made)) {
    await page.setContent(`<!doctype html><html><head><style>${css}</style></head><body>${body}</body></html>`);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(250);
    await page.screenshot({ path: join(WORK, `${name}.png`), omitBackground: true });
  }
  await page.close();
}

// ---------------------------------------------------------------- the cut
async function cut(out) {
  const inputs = [];
  for (const s of SHOTS) inputs.push('-framerate', String(FPS), '-i', join(shotDir(s), '%05d.jpg'));
  const nv = SHOTS.length;
  inputs.push('-i', join(WORK, 'score.wav'));
  // the cards: [png, from, to] (seconds in the clip; each fades in and out over 0.7 s)
  const first = SHOTS[0], last = SHOTS[nv - 1];
  const overlays = [['title', first.at + 0.5, first.at + 4.6]];
  for (const s of SHOTS) {
    const a = s === first ? s.at + 5.0 : s.at + FADE + 0.3;
    const b = s === last ? Math.min(s.at + s.dur - 4.4, a + 6.5) : Math.min(s.at + s.dur - FADE - 0.3, a + 7.5);
    overlays.push([`cap${s.i}`, a, b]);
  }
  overlays.push(['end', SECONDS - 3.9, SECONDS - 0.15]);
  for (const [name] of overlays) inputs.push('-loop', '1', '-framerate', String(FPS), '-t', String(SECONDS + 1), '-i', join(WORK, `${name}.png`));
  let g = '';
  SHOTS.forEach((s, i) => { g += `[${i}:v]scale=${W}:${H}:flags=lanczos:in_range=pc:out_range=tv,setsar=1,format=yuv420p,setrange=tv,settb=AVTB,setpts=PTS-STARTPTS[s${i}];`; });
  let lastL = 's0';
  for (let i = 1; i < nv; i++) {
    g += `[${lastL}][s${i}]xfade=transition=fade:duration=${FADE}:offset=${SHOTS[i].at.toFixed(4)}[x${i}];`;
    lastL = `x${i}`;
  }
  g += `[${lastL}]fade=t=in:st=0:d=0.8,fade=t=out:st=${(SECONDS - 1.2).toFixed(3)}:d=1.2[v0];`;
  overlays.forEach(([, a, b], i) => {
    g += `[${nv + 1 + i}:v]format=rgba,fade=t=in:st=${a.toFixed(3)}:d=0.7:alpha=1,fade=t=out:st=${(b - 0.7).toFixed(3)}:d=0.7:alpha=1[c${i}];`;
    g += `[v${i}][c${i}]overlay=0:0:enable='between(t,${a.toFixed(3)},${b.toFixed(3)})'[v${i + 1}];`;
  });
  g += `[${nv}:a]atrim=0:${SECONDS.toFixed(3)},afade=t=in:st=0:d=0.8[a]`;
  mkdirSync(dirname(resolve(out)), { recursive: true });
  await ff([...inputs, '-filter_complex', g, '-map', process.env.MAPV ?? `[v${overlays.length}]`, '-map', '[a]', '-t', SECONDS.toFixed(3), '-r', String(FPS),
    '-c:v', 'libx264', '-preset', 'slow', '-crf', process.env.CRF ?? String(DEF.crf ?? 20), '-profile:v', 'high', '-pix_fmt', 'yuv420p',
    '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
    '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', resolve(out)]);
  console.log(`-> ${resolve(out)} (${SECONDS.toFixed(1)} s)`);
  // the poster: one supersampled frame, down to 720p
  if (DEF.poster && SHOTS.some((s) => s.i === DEF.poster[0])) {
    const jpg = resolve(out).replace(/\.mp4$/, '.jpg');
    await ff(['-i', join(WORK, `shot${String(DEF.poster[0]).padStart(2, '0')}`, `${String(DEF.poster[1]).padStart(5, '0')}.jpg`),
      '-vf', `scale=${W}:${H}:flags=lanczos`, '-q:v', '2', jpg]);
    console.log(`-> ${jpg}`);
  }
}

// a quick look at a preview: the shots' frames as a low-res mp4, no cards or sound
async function previewCut(out) {
  const inputs = [];
  for (const s of SHOTS) inputs.push('-framerate', String(FPS / EVERY), '-i', join(shotDir(s), '%05d.jpg'));
  let g = '';
  SHOTS.forEach((s, i) => { g += `[${i}:v]scale=640:360,setsar=1,format=yuv420p[s${i}];`; });
  g += SHOTS.map((_, i) => `[s${i}]`).join('') + `concat=n=${SHOTS.length}:v=1[v]`;
  await ff([...inputs, '-filter_complex', g, '-map', '[v]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', resolve(out)]);
  console.log(`-> ${resolve(out)}`);
}

console.log(`${CLIP}: ${SHOTS.length} shots, ${SECONDS.toFixed(1)} s at ${FPS} fps, ${STAGE}${PREVIEW ? ' (preview)' : ''} in ${WORK}`);
if (STAGE === 'capture') await capture();
else if (STAGE === 'cards') await capture(true); // just the score and the cards again
else if (STAGE === 'cut') await (PREVIEW ? previewCut : cut)(pos[0] ?? join(WORK, `${CLIP}.mp4`));
else throw new Error(`no stage ${STAGE}`);
process.exit(0);
