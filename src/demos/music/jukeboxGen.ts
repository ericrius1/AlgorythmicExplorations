// The jukebox, twice. As the hero it's a song clock: the drum patterns as
// Euclidean necklaces around the current chord, the melody as sparks around
// the rim, the song's sections as an arc, over a nebula drawn from the live
// spectrum. As the last figure it's the same band opened up: the song map,
// a piano roll that shows what's about to play, and switches for swing,
// humanizing, each part, and the style.

import { Shell, type Demo } from "../../lib/demoShell";
import { getDevice } from "../../lib/gpu";
import { ShaderView } from "../../lib/shaderCanvas";
import { frameGuard, spectrum } from "../../lib/audio";
import { Band, STYLE_NAMES, TRACKS, describeSong, keyName, styleLabel, type Humanize, type Song, type StyleName, type TrackName } from "./harmony/band";
import { COL, VOICE, clear, figureAspect, font, glow, glowPath, line, refresh, rgba, roundRect, setActive, tapToPlay, text, view2d } from "./harmony/draw";
import { audioTime } from "./harmony/sound";

const BINS = 64;

// A curated first song for each place it appears (the rest are random).
const HERO_SEED = 7; // lo-fi, B major
const LAB_SEED = 4; // bossa, D major

const TRACK_COL: Record<TrackName, string> = {
  drums: "#c9d1ea",
  bass: COL.major,
  keys: COL.minor,
  pad: "#8f7cff",
  lead: COL.calm,
};

const NEBULA = /* wgsl */ `
fn hash(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
}
fn vnoise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2f(1.0, 0.0)), u.x), mix(hash(i + vec2f(0.0, 1.0)), hash(i + vec2f(1.0)), u.x), u.y);
}
fn fbm(p: vec2f) -> f32 {
  var v = 0.0;
  var a = 0.5;
  var q = p;
  for (var k = 0; k < 4; k++) {
    v += a * vnoise(q);
    q = q * 2.03 + vec2f(1.7, 9.2);
    a *= 0.5;
  }
  return v;
}
fn stars(q: vec2f, density: f32, t: f32) -> f32 {
  let cell = floor(q * density);
  var v = 0.0;
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      let c = cell + vec2f(f32(dx), f32(dy));
      let h = hash(c);
      if (h < 0.86) { continue; }
      let pos = (c + vec2f(hash(c + vec2f(1.3, 7.1)), hash(c + vec2f(4.7, 2.9)))) / density;
      let d = length(q - pos);
      let size = (0.35 + 0.65 * pow(hash(c + vec2f(9.2, 3.3)), 4.0)) * 0.009;
      let tw = 0.6 + 0.4 * sin(t * (0.6 + h * 2.0) + h * 40.0);
      v += glow(d, size) * tw * (h - 0.85) / 0.15;
    }
  }
  return v;
}
fn scene(uv: vec2f) -> vec3f {
  let t = uf(0u);
  let aspect = uf(1u);
  let cy = uf(4u);
  let energy = uf(5u);
  let hueBase = uf(6u);
  let kick = uf(7u);
  var col = vec3f(0.0);
  let q = vec2f((uv.x - 0.5) * aspect, uv.y - cy) * 2.0;
  let r = length(q);
  let ang = atan2(q.y, q.x);
  let sw = fbm(q * 1.3 + vec2f(t * 0.03, -t * 0.025));
  let a2 = ang + sw * 1.6 + t * 0.015;
  let binF = clamp(pow(r * 0.62, 1.3), 0.0, 0.999) * f32(${BINS - 1});
  let bi = u32(binF);
  let mag = mix(D[bi], D[min(bi + 1u, ${BINS - 1}u)], fract(binF));
  // the swirl enters only through cos/sin, so there's no seam where atan2 wraps
  let dir = vec2f(cos(a2), sin(a2));
  let fil = pow(fbm(dir * 1.9 + vec2f(r * 2.2 - t * 0.05, r * 1.3)), 2.0);
  let hue = fract(hueBase + r * 0.16 + sw * 0.1);
  col += hsv(hue, 0.6, 1.0) * mag * (0.25 + fil * 1.3) * 0.9;
  // a faint resting haze so the hero isn't black before the music starts
  col += hsv(fract(hueBase + 0.05), 0.55, 1.0) * fil * 0.05 * (1.0 - smoothstep(0.2, 1.6, r));
  col += hsv(fract(hueBase + 0.08), 0.45, 1.0) * glow(r, 0.22 + 0.06 * energy) * (0.08 + kick * 0.1);
  col += vec3f(0.72, 0.78, 1.0) * stars(q, 22.0, t) * 0.35;
  col += vec3f(0.95, 0.97, 1.0) * stars(q + vec2f(31.7, 17.3), 10.0, t * 0.7) * 0.5;
  return col * vignette(uv);
}
`;

export interface JukeboxOpts {
  mode?: "hero" | "lab";
}

export async function mountJukeboxGen(container: HTMLElement, opts: JukeboxOpts = {}): Promise<Demo> {
  const hero = opts.mode === "hero";
  const shell = new Shell(container, hero ? 0.56 : figureAspect(container, 0.68, 1.25));
  if (!hero) container.classList.add("mh-fig");
  const base = shell.canvas;

  // hero: WebGPU nebula underneath, a 2D layer on top for everything crisp
  let nebula: ShaderView | null = null;
  let canvas = base;
  if (hero) {
    const dev = await getDevice();
    if (dev) {
      const wrap = document.createElement("div");
      wrap.style.position = "relative";
      base.replaceWith(wrap);
      wrap.appendChild(base);
      canvas = document.createElement("canvas");
      canvas.width = base.width;
      canvas.height = base.height;
      canvas.className = "mh-overlay";
      Object.assign(canvas.style, { position: "absolute", inset: "0", width: "100%", height: "100%", display: "block" });
      wrap.appendChild(canvas);
      nebula = new ShaderView(dev, base, NEBULA, BINS);
    }
  }
  const v = view2d(canvas);

  const band = new Band(hero ? HERO_SEED : LAB_SEED);
  let song: Song = band.song;
  band.onSong = (s) => (song = s);

  const tap = tapToPlay(
    container,
    hero ? "Tap to start the band" : "Tap to play",
    () => void begin(),
    hero ? ((container.clientWidth || 800) < 740 ? 0.86 : 0.54) : 0.55,
  );
  const begin = async (): Promise<void> => {
    tap.hide();
    if (!band.isRunning) await band.start();
    sync();
  };
  const stop = (): void => {
    band.stop();
    tap.show();
    sync();
  };
  const guard = frameGuard(() => {
    if (band.isRunning) stop();
  });
  // tapping the picture starts or stops the band, like the pill
  canvas.addEventListener("pointerdown", () => (band.isRunning ? stop() : void begin()));

  // ---- controls ---------------------------------------------------------------------------
  const playBtn = shell.button("▶ play", () => (band.isRunning ? stop() : void begin()));
  shell.button("next song", () => {
    band.newSong(undefined, styleLock);
    song = band.song;
    void begin();
  });
  let styleLock: StyleName | undefined;
  const muteBtns = new Map<TrackName, HTMLButtonElement>();
  let humanBtn: HTMLButtonElement | null = null;
  let styleBtn: HTMLButtonElement | null = null;
  if (!hero) {
    styleBtn = shell.button("style: any", () => {
      const order: (StyleName | undefined)[] = [undefined, ...STYLE_NAMES];
      styleLock = order[(order.indexOf(styleLock) + 1) % order.length];
      styleBtn!.textContent = `style: ${styleLock ? styleLabel(styleLock) : "any"}`;
      band.setStyleLock(styleLock);
      if (styleLock) {
        band.newSong(undefined, styleLock);
        song = band.song;
      }
    });
    const hum: Humanize[] = ["pink", "white", "off"];
    const humLabel: Record<Humanize, string> = { pink: "humanize: 1/f", white: "humanize: random", off: "humanize: off" };
    humanBtn = shell.button(humLabel[band.humanize], () => {
      band.humanize = hum[(hum.indexOf(band.humanize) + 1) % hum.length];
      humanBtn!.textContent = humLabel[band.humanize];
      setActive(humanBtn!, band.humanize !== "off");
    });
    setActive(humanBtn, true);
    const g = document.createElement("div");
    g.className = "mh-group";
    const lab = document.createElement("span");
    lab.className = "mh-group-label";
    lab.textContent = "parts";
    g.appendChild(lab);
    for (const t of TRACKS) {
      const b = shell.button(t, () => {
        const on = !band.muted.has(t);
        band.setMute(t, on);
        setActive(b, !on);
      });
      b.style.borderColor = rgba(TRACK_COL[t], 0.55);
      setActive(b, true);
      g.appendChild(b);
      muteBtns.set(t, b);
    }
    shell.controls.appendChild(g);
  }
  function sync(): void {
    playBtn.textContent = band.isRunning ? "■ stop" : "▶ play";
  }

  shell.setInfo(() => {
    const pos = band.position();
    const sec = band.section(pos);
    const bar = Math.floor(pos / song.grid);
    const chord = song.chords[Math.min(bar, song.chords.length - 1)];
    const live = band.isRunning ? ` · ${sec.kind} · ${chord.label}` : "";
    return `${describeSong(song)}${live}${hero ? "" : ` · seed ${song.seed}`}`;
  });

  // ---- shared bits for drawing ------------------------------------------------------------------
  const smoothBins = new Float32Array(BINS);
  let kickGlow = 0;
  const flash = new Map<string, number>(); // drum name → last hit time (audio)
  const sparks: { a: number; m: number; t: number; col: string }[] = [];
  let lastSeen = 0;

  const collect = (): void => {
    const now = audioTime();
    for (const p of band.played) {
      if (p.time > now || p.time <= lastSeen) continue;
      if (p.ev.track === "drums") {
        flash.set(p.ev.drum!, p.time);
        if (p.ev.drum === "kick") kickGlow = Math.max(kickGlow, p.ev.vel);
      } else if (p.ev.track === "lead") {
        const a = ((p.ev.step % song.grid) / song.grid) * Math.PI * 2;
        sparks.push({ a, m: p.ev.midi, t: performance.now(), col: COL.calm });
        if (sparks.length > 40) sparks.shift();
      }
    }
    for (const p of band.played) if (p.time <= now && p.time > lastSeen) lastSeen = p.time;
  };

  // ---- hero: the song clock ------------------------------------------------------------------------
  let idleRot = 0;
  const drawHero = (): void => {
    refresh(v, canvas);
    const { ctx, w, h, px } = v;
    const narrow = w / px < 740;
    const cx = w / 2;
    const cy = narrow ? h * 0.5 : h * 0.4;
    const R = Math.min(w * 0.42, h * (narrow ? 0.36 : 0.29));
    if (nebula) {
      ctx.clearRect(0, 0, w, h);
    } else {
      clear(v, "#0b0d16", "#05060a");
      glow(ctx, cx, cy, R * 2.2, "#6a58c8", 0.16);
    }
    const now = performance.now();
    const at = audioTime();
    const running = band.isRunning;
    const pos = band.position();
    const G = song.grid;
    const barPos = running ? (pos % G) / G : (idleRot += 0.0007) % 1;
    const bar = Math.floor(pos / G);
    const chord = song.chords[Math.min(bar, song.chords.length - 1)];
    const sec = band.section(pos);

    // section arc around the outside
    const arcR = R * 1.32;
    const total = song.totalSteps / G;
    for (const s of song.sections) {
      const a0 = -Math.PI / 2 + (s.startBar / total) * Math.PI * 2 + 0.012;
      const a1 = -Math.PI / 2 + ((s.startBar + s.bars) / total) * Math.PI * 2 - 0.012;
      ctx.beginPath();
      ctx.arc(cx, cy, arcR, a0, a1);
      ctx.strokeStyle = rgba(s === sec && running ? COL.major : "#8a91a5", s === sec && running ? 0.85 : 0.18 + s.energy * 0.2);
      ctx.lineWidth = (s === sec && running ? 3 : 2) * px;
      ctx.stroke();
    }
    if (running) {
      const a = -Math.PI / 2 + (pos / song.totalSteps) * Math.PI * 2;
      glow(ctx, cx + Math.cos(a) * arcR, cy + Math.sin(a) * arcR, 9 * px, COL.major, 0.9);
    }

    // drum necklaces
    const rings = song.drumRings;
    rings.forEach((ring, ri) => {
      const rr = R * (0.52 + ri * 0.2);
      const n = ring.pattern.length;
      ctx.beginPath();
      ctx.arc(cx, cy, rr, 0, Math.PI * 2);
      ctx.strokeStyle = rgba(VOICE[ri + 1], 0.12);
      ctx.lineWidth = 1 * px;
      ctx.stroke();
      const hit = flash.get(ring.name) ?? -1;
      const age = at - hit;
      const fl = running && age >= 0 && age < 0.4 ? 1 - age / 0.4 : 0;
      const curStep = Math.floor(barPos * n);
      ring.pattern.forEach((on, k) => {
        const a = -Math.PI / 2 + (k / n) * Math.PI * 2;
        const x = cx + Math.cos(a) * rr;
        const y = cy + Math.sin(a) * rr;
        if (on) {
          const isNow = running && k === curStep;
          glow(ctx, x, y, (10 + (isNow ? 16 * fl : 0)) * px, VOICE[ri + 1], 0.55 + (isNow ? 0.45 * fl : 0));
          ctx.beginPath();
          ctx.arc(x, y, 3.2 * px, 0, Math.PI * 2);
          ctx.fillStyle = rgba(VOICE[ri + 1], 0.95);
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.arc(x, y, 1.6 * px, 0, Math.PI * 2);
          ctx.fillStyle = rgba("#8a91a5", 0.35);
          ctx.fill();
        }
      });
      // ring pulse on a hit
      if (fl > 0) {
        ctx.beginPath();
        ctx.arc(cx, cy, rr, 0, Math.PI * 2);
        ctx.strokeStyle = rgba(VOICE[ri + 1], 0.35 * fl);
        ctx.lineWidth = 3 * px * fl;
        ctx.stroke();
      }
      if (!narrow || ri === rings.length - 1) {
        const la = -Math.PI / 2 - 0.16;
        text(ctx, ring.name, cx + Math.cos(la) * rr, cy + Math.sin(la) * rr, { color: VOICE[ri + 1], align: "right", font: font(px, 9.5, 650), alpha: 0.7 });
      }
    });

    // sweep arm
    {
      const a = -Math.PI / 2 + barPos * Math.PI * 2;
      const r0 = R * 0.34;
      const r1 = R * 1.18;
      glowPath(
        ctx,
        (c) => {
          c.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
          c.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
        },
        COL.white,
        1.1 * px,
        running ? 0.55 : 0.25,
      );
    }

    // melody sparks around the rim, by beat position and pitch
    for (let k = 0; k < sparks.length; k++) {
      const s = sparks[k];
      const age = (now - s.t) / 2600;
      if (age > 1) continue;
      const rr = R * (1.02 + Math.max(-0.1, Math.min(0.26, (s.m - 72) * 0.014)));
      const a = -Math.PI / 2 + s.a;
      const x = cx + Math.cos(a) * rr;
      const y = cy + Math.sin(a) * rr;
      glow(ctx, x, y, (12 - 6 * age) * px, s.col, 0.9 * (1 - age));
      const prev = sparks[k - 1];
      if (prev && (now - prev.t) / 2600 < 1 && s.t - prev.t < 900) {
        const pr = R * (1.02 + Math.max(-0.1, Math.min(0.26, (prev.m - 72) * 0.014)));
        const pa = -Math.PI / 2 + prev.a;
        line(ctx, cx + Math.cos(pa) * pr, cy + Math.sin(pa) * pr, x, y, rgba(COL.calm, 0.25 * (1 - age)), 1 * px);
      }
    }

    // centre: the chord
    kickGlow *= 0.9;
    glow(ctx, cx, cy, R * (0.42 + 0.06 * kickGlow), COL.major, 0.12 + 0.25 * kickGlow);
    text(ctx, running ? chord.label : keyName(song), cx, cy - 4 * px, {
      color: COL.bright,
      align: "center",
      font: font(px, narrow ? 22 : 30, 700),
    });
    text(ctx, running ? sec.kind : styleLabel(song.style), cx, cy + (narrow ? 18 : 24) * px, {
      color: COL.muted,
      align: "center",
      font: font(px, narrow ? 10 : 11.5, 650),
    });
  };

  // ---- lab: song map + piano roll ------------------------------------------------------------------
  const drawLab = (): void => {
    refresh(v, canvas);
    const { ctx, w, h, px } = v;
    const narrow = w / px < 520;
    clear(v, "#0b0d16", "#06070b");
    const running = band.isRunning;
    const pos = band.position();
    const G = song.grid;

    // song map
    const mapY = 12 * px;
    const mapH = 30 * px;
    const mx0 = 12 * px;
    const mx1 = w - 12 * px;
    const total = song.totalSteps / G;
    const sec = band.section(pos);
    for (const s of song.sections) {
      const x0 = mx0 + ((mx1 - mx0) * s.startBar) / total;
      const x1 = mx0 + ((mx1 - mx0) * (s.startBar + s.bars)) / total;
      const isCur = running && s === sec;
      roundRect(ctx, x0 + 1 * px, mapY + mapH * (1 - s.energy) * 0.6, x1 - x0 - 2 * px, mapH - mapH * (1 - s.energy) * 0.6, 4 * px);
      ctx.fillStyle = rgba(isCur ? COL.major : "#8a91a5", isCur ? 0.35 : 0.14);
      ctx.fill();
      if (x1 - x0 > 34 * px) text(ctx, s.kind, (x0 + x1) / 2, mapY + mapH + 10 * px, { color: isCur ? COL.major : COL.dim, align: "center", font: font(px, 9, 650) });
    }
    if (running) {
      const x = mx0 + ((mx1 - mx0) * pos) / song.totalSteps;
      line(ctx, x, mapY - 3 * px, x, mapY + mapH + 2 * px, COL.white, 1.5 * px);
    }

    // piano roll: a window of steps around now
    const top = mapY + mapH + 26 * px;
    const bottom = h - 10 * px;
    const left = (narrow ? 44 : 58) * px;
    const right = w - 10 * px;
    const span = G * (narrow ? 2.5 : 4); // steps visible
    const nowX = left + (right - left) * 0.35;
    const pxPerStep = (right - left) / span;
    const X = (step: number): number => nowX + (step - pos) * pxPerStep;
    const drumRows = [...new Set(song.events.filter((e) => e.track === "drums").map((e) => e.drum!))];
    const drumH = Math.min(12 * px, ((bottom - top) * 0.3) / Math.max(1, drumRows.length));
    const drumTop = bottom - drumH * drumRows.length;
    const pitchTop = top + 14 * px;
    const pitchBottom = drumTop - 8 * px;
    const LO = 31;
    const HI = 90;
    const Y = (m: number): number => pitchBottom - ((m - LO) / (HI - LO)) * (pitchBottom - pitchTop);

    // bar lines and chord names
    const firstBar = Math.floor((pos - span * 0.35) / G);
    for (let b = firstBar; b <= firstBar + Math.ceil(span / G) + 1; b++) {
      if (b < 0 || b >= song.chords.length) continue;
      const x = X(b * G);
      if (x < left - 1 || x > right) continue;
      line(ctx, x, top, x, bottom, rgba("#8a91a5", 0.16), 1 * px);
      text(ctx, song.chords[b].label, x + 4 * px, top + 4 * px, { color: COL.text, font: font(px, narrow ? 9.5 : 11, 700), alpha: 0.85 });
      for (let beat = 1; beat < G / song.stepsPerBeat; beat++) {
        const xb = X(b * G + beat * song.stepsPerBeat);
        if (xb > left && xb < right) line(ctx, xb, top + 14 * px, xb, bottom, rgba("#8a91a5", 0.06), 1 * px);
      }
    }
    // lane labels
    const labelFont = font(px, 9, 650);
    text(ctx, "lead", left - 8 * px, Y(76), { color: TRACK_COL.lead, align: "right", font: labelFont });
    text(ctx, "keys", left - 8 * px, Y(62), { color: TRACK_COL.keys, align: "right", font: labelFont });
    text(ctx, "bass", left - 8 * px, Y(40), { color: TRACK_COL.bass, align: "right", font: labelFont });
    drumRows.forEach((d, i) => text(ctx, d, left - 8 * px, drumTop + drumH * (i + 0.5), { color: TRACK_COL.drums, align: "right", font: font(px, 8.5, 600), alpha: 0.8 }));

    // notes
    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, right - left, bottom - top);
    ctx.clip();
    const lo = pos - span * 0.36;
    const hi = pos + span * 0.66;
    const stepDur = 60 / (song.bpm * song.stepsPerBeat);
    const swingShift = (2 * song.swing - 1);
    for (const ev of song.events) {
      if (ev.step + ev.dur < lo) continue;
      if (ev.step > hi) break;
      const muted = band.muted.has(ev.track);
      // show the feel: swing and the humanizer's offsets, in steps
      const human = band.humanize === "off" ? 0 : ev.lean + (band.humanize === "pink" ? ev.jp : ev.jw);
      const sw = song.stepsPerBeat === 4 && Math.floor(ev.step) % 2 === 1 ? swingShift : 0;
      const s = ev.step + sw + (human + (ev.offset ?? 0)) / stepDur;
      const x = X(s);
      const sounding = running && s <= pos && s + ev.dur > pos;
      const past = s + ev.dur < pos;
      const col = TRACK_COL[ev.track];
      const alpha = (muted ? 0.15 : past ? 0.45 : 0.85) * (0.6 + 0.4 * ev.vel);
      if (ev.track === "drums") {
        const row = drumRows.indexOf(ev.drum!);
        const y = drumTop + drumH * (row + 0.5);
        const r = Math.max(1.6 * px, drumH * 0.32 * (0.6 + 0.5 * ev.vel));
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = rgba(col, alpha);
        ctx.fill();
        if (running && !muted && s <= pos && pos - s < 1.2) glow(ctx, x, y, r * 4, col, 0.8 * (1 - (pos - s) / 1.2));
      } else {
        const y = Y(ev.midi);
        const wdt = Math.max(2 * px, ev.dur * pxPerStep - 1.5 * px);
        const hgt = (ev.track === "pad" ? 3 : 4.5) * px;
        roundRect(ctx, x, y - hgt / 2, wdt, hgt, hgt / 2);
        ctx.fillStyle = rgba(col, ev.track === "pad" ? alpha * 0.45 : alpha);
        ctx.fill();
        if (sounding && !muted) glow(ctx, x + 2 * px, y, 12 * px, col, 0.6 * ev.vel);
      }
    }
    ctx.restore();
    // now line
    glowPath(
      ctx,
      (c) => {
        c.moveTo(nowX, top);
        c.lineTo(nowX, bottom);
      },
      COL.white,
      1.2 * px,
      running ? 0.8 : 0.3,
    );
  };

  return {
    frame() {
      shell.tick();
      guard.pulse();
      sync();
      collect();
      if (hero) {
        drawHero();
        if (nebula) {
          const fft = band.isRunning ? spectrum() : null;
          for (let i = 0; i < BINS; i++) {
            const db = fft ? fft[Math.floor((i / BINS) * 100)] : -Infinity;
            const val = Number.isFinite(db) ? Math.max(0, (db + 95) / 60) : 0;
            smoothBins[i] += (Math.min(val, 1.5) - smoothBins[i]) * 0.2;
            nebula.data[i] = smoothBins[i];
          }
          const narrow = canvas.width / v.px < 740;
          nebula.uniforms[4] = narrow ? 0.5 : 0.6; // shader y is up: centre at 40% from the top
          nebula.uniforms[5] = band.section().energy;
          nebula.uniforms[6] = 0.62 + (song.seed % 100) / 400;
          nebula.uniforms[7] = kickGlow;
          nebula.draw();
        }
      } else {
        drawLab();
      }
    },
    dispose() {
      band.stop();
    },
  };
}
