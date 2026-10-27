// The Room Instrument (Acoustic Spaces part 2). A room is the sequencer: a
// drum in the room sends out a pulse once a bar, the pulse travels at a
// slowed-down "sequencer speed" and reflects off the walls, and every time a
// wavefront (direct or reflected) passes a stone, the stone rings. So the
// geometry writes the rhythm and the wall materials set how loud the echoes
// are. What you hear of each note is the real acoustics: a binaural impulse
// response from that stone to the listener's head, at the real speed of
// sound. The whole room fits in a share link.

import { Shell, type Demo } from "../../lib/demoShell";
import { frameGuard, midiName } from "../../lib/audio";
import { siteUrl } from "../../lib/posts";
import { buildIR } from "./space/ir";
import { MATERIALS, eyring, imageSources, material, type Image, type Room } from "./space/room";
import { rawCtx, sampleRate } from "./space/sound";
import {
  Plan,
  RoomVoice,
  SC,
  dragger,
  drawHead,
  irBuffer,
  label,
  monoBuffer,
  narrowScreen,
  playGate,
  rgba,
  roundRect,
  segmented,
  smallButton,
  stage,
  ui,
  type P2,
} from "./space/kit";

const STEPS = 16;
const MAX_STONES = 7;
const WALL_CYCLE = ["tile", "brick", "wood", "glass", "curtain", "acoustic"];

export const SCALES = {
  major: { name: "major pentatonic", steps: [0, 2, 4, 7, 9] },
  minor: { name: "minor pentatonic", steps: [0, 3, 5, 7, 10] },
  dorian: { name: "dorian", steps: [0, 2, 3, 5, 7, 9, 10] },
  insen: { name: "in sen", steps: [0, 1, 5, 7, 10] },
} as const;
type ScaleId = keyof typeof SCALES;

interface Preset {
  name: string;
  L: number;
  W: number;
  H: number;
  walls: [string, string, string, string];
  floor: string;
  ceiling: string;
}

export const PRESETS: Record<string, Preset> = {
  studio: { name: "studio", L: 7, W: 5, H: 3, walls: ["wood", "curtain", "wood", "acoustic"], floor: "woodfloor", ceiling: "acoustic" },
  bathroom: { name: "bathroom", L: 3.2, W: 2.2, H: 2.4, walls: ["tile", "tile", "tile", "tile"], floor: "tile", ceiling: "drywall" },
  hall: { name: "concert hall", L: 40, W: 26, H: 17, walls: ["wood", "wood", "wood", "wood"], floor: "audience", ceiling: "plaster" },
  church: { name: "stone church", L: 60, W: 26, H: 24, walls: ["brick", "brick", "glass", "brick"], floor: "wood", ceiling: "plaster" },
  tank: { name: "water tank", L: 9, W: 9, H: 9, walls: ["concrete", "concrete", "concrete", "concrete"], floor: "water", ceiling: "concrete" },
};
type PresetId = keyof typeof PRESETS;

// Positions are stored as fractions of the room, so a layout keeps its shape
// when the room changes size.
export interface RoomState {
  preset: PresetId;
  L: number;
  W: number;
  H: number;
  walls: [string, string, string, string];
  floor: string;
  ceiling: string;
  lis: P2;
  drum: P2;
  stones: P2[];
  scale: ScaleId;
  tempo: number;
  echoes: 1 | 2;
}

function fromPreset(id: PresetId, keep?: RoomState): RoomState {
  const p = PRESETS[id];
  return {
    preset: id,
    L: p.L,
    W: p.W,
    H: p.H,
    walls: [...p.walls],
    floor: p.floor,
    ceiling: p.ceiling,
    lis: keep?.lis ?? { x: 0.72, y: 0.7 },
    drum: keep?.drum ?? { x: 0.18, y: 0.3 },
    stones: keep?.stones ?? [
      { x: 0.42, y: 0.22 },
      { x: 0.62, y: 0.45 },
      { x: 0.3, y: 0.7 },
      { x: 0.85, y: 0.3 },
      { x: 0.5, y: 0.85 },
    ],
    scale: keep?.scale ?? "major",
    tempo: keep?.tempo ?? 92,
    echoes: keep?.echoes ?? 2,
  };
}

// ---- share links -------------------------------------------------------------

const matIndex = (id: string): number => Math.max(0, MATERIALS.findIndex((m) => m.id === id));
const q = (v: number): number => Math.round(Math.max(0, Math.min(1, v)) * 100);

export function encodeState(s: RoomState): string {
  const nums = [
    Object.keys(PRESETS).indexOf(s.preset),
    Math.round(s.L * 10),
    Math.round(s.W * 10),
    Math.round(s.H * 10),
    ...s.walls.map(matIndex),
    matIndex(s.floor),
    matIndex(s.ceiling),
    q(s.lis.x),
    q(s.lis.y),
    q(s.drum.x),
    q(s.drum.y),
    Object.keys(SCALES).indexOf(s.scale),
    s.tempo,
    s.echoes,
    ...s.stones.flatMap((p) => [q(p.x), q(p.y)]),
  ];
  return "2." + nums.map((n) => n.toString(36)).join(".");
}

export function decodeState(raw: string | null): RoomState | null {
  if (!raw || !raw.startsWith("2.")) return null;
  try {
    const n = raw.slice(2).split(".").map((t) => parseInt(t, 36));
    if (n.length < 19 || n.some((v) => !Number.isFinite(v))) return null;
    const ids = Object.keys(PRESETS) as PresetId[];
    const mat = (i: number): string => MATERIALS[Math.max(0, Math.min(MATERIALS.length - 1, i))].id;
    const f = (v: number): number => Math.max(0.02, Math.min(0.98, v / 100));
    const clampDim = (v: number): number => Math.max(1.5, Math.min(90, v / 10));
    const stones: P2[] = [];
    for (let i = 19; i + 1 < n.length && stones.length < MAX_STONES; i += 2) stones.push({ x: f(n[i]), y: f(n[i + 1]) });
    return {
      preset: ids[n[0]] ?? "studio",
      L: clampDim(n[1]),
      W: clampDim(n[2]),
      H: clampDim(n[3]),
      walls: [mat(n[4]), mat(n[5]), mat(n[6]), mat(n[7])],
      floor: mat(n[8]),
      ceiling: mat(n[9]),
      lis: { x: f(n[10]), y: f(n[11]) },
      drum: { x: f(n[12]), y: f(n[13]) },
      scale: (Object.keys(SCALES) as ScaleId[])[n[14]] ?? "major",
      tempo: Math.max(60, Math.min(140, n[15])),
      echoes: n[16] === 1 ? 1 : 2,
      stones,
    };
  } catch {
    return null;
  }
}

export function shareUrl(s: RoomState): string {
  const url = new URL(siteUrl("pages/acoustic-spaces/room-instrument.html"), location.href);
  url.searchParams.set("r", encodeState(s));
  return url.href;
}

// ---- sounds --------------------------------------------------------------------

// A marimba-like bar: fundamental plus the bar's tuned overtones (4× and
// roughly 10× the fundamental), each dying away faster than the last.
function barNote(midi: number, fs: number): Float32Array {
  const f = 440 * Math.pow(2, (midi - 69) / 12);
  const n = Math.floor(fs * 1.4);
  const x = new Float32Array(n);
  const tau = 0.9 * Math.pow(0.5, (midi - 60) / 24);
  for (let i = 0; i < n; i++) {
    const t = i / fs;
    const att = Math.min(1, t / 0.0015);
    x[i] =
      att *
      (Math.sin(2 * Math.PI * f * t) * Math.exp(-t / tau) +
        0.28 * Math.sin(2 * Math.PI * f * 4 * t) * Math.exp(-t / (tau * 0.18)) +
        0.08 * Math.sin(2 * Math.PI * f * 9.9 * t) * Math.exp(-t / 0.025));
  }
  return x;
}

// The drum: a short pitched thump that falls in pitch.
function drumHit(fs: number): Float32Array {
  const n = Math.floor(fs * 0.5);
  const x = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / fs;
    const f = 52 + 90 * Math.exp(-t / 0.035);
    ph += (2 * Math.PI * f) / fs;
    x[i] = Math.sin(ph) * Math.exp(-t / 0.16) * Math.min(1, t / 0.002);
  }
  return x;
}

// ---- the instrument ----------------------------------------------------------------

interface Hit {
  step: number; // 0..15, after wrapping round the bar
  vel: number;
  order: number;
  steps: number; // unwrapped travel time in steps
}

export interface InstrumentOptions {
  hero?: boolean; // the full instrument (true) or the one-stone explainer (false)
  controls?: "full" | "share" | "none"; // for the full instrument: every control, or just the share button (the page hero)
  state?: RoomState;
  syncUrl?: boolean;
}

export function mountRoomInstrument(container: HTMLElement, opts: InstrumentOptions = { hero: true, syncUrl: true }): Demo {
  const hero = opts.hero ?? true;
  const inHero = container.closest("header.hero") !== null;
  const shell = new Shell(container, narrowScreen() ? 1.05 : hero ? 0.56 : 0.5);
  const cv = shell.canvas;
  const g = cv.getContext("2d")!;
  const wrap = stage(shell);
  let st: RoomState =
    opts.state ?? (hero ? decodeState(new URLSearchParams(location.search).get("r")) : null) ?? fromPreset("studio");
  if (!hero) st.stones = st.stones.slice(0, 1);

  const room = (): Room => ({ L: st.L, W: st.W, H: st.H, surf: [...st.walls, st.floor, st.ceiling] as Room["surf"] });
  const plan = new Plan(st.L, st.W);
  const abs = (p: P2): P2 => ({ x: p.x * st.L, y: p.y * st.W });
  const rel = (p: P2): P2 => ({ x: Math.max(0.02, Math.min(0.98, p.x / st.L)), y: Math.max(0.02, Math.min(0.98, p.y / st.W)) });
  // the sequencer's slowed speed: the room's diagonal takes 12 steps
  const mPerStep = (): number => Math.hypot(st.L, st.W) / 12;

  // ---- rhythm from geometry ----
  let drumImages: Image[] = [];
  let hits: Hit[][] = [];
  const solve = (): void => {
    const r = room();
    const d = abs(st.drum);
    const reach = mPerStep() * STEPS * 2;
    drumImages = imageSources(r, { ...d, z: 1.2 }, { ...d, z: 1.2 }, reach * 1.5, st.echoes, [4, 5]);
    hits = st.stones.map((s0) => {
      const s = abs(s0);
      const ims = imageSources(r, { ...d, z: 1.2 }, { ...s, z: 1.2 }, reach, st.echoes, [4, 5]);
      const per = new Map<number, Hit>();
      for (const im of ims) {
        const steps = im.dist / mPerStep();
        // reflection loss at 1 kHz (spreading removed), plus a gentle fall with distance
        const refl = im.gain[3] * im.dist;
        const vel = refl * Math.min(1, 1.3 / (1 + steps / 8));
        if (vel < 0.18) continue;
        const step = Math.round(steps) % STEPS;
        const old = per.get(step);
        if (!old || old.vel < vel) per.set(step, { step, vel: Math.min(1, vel), order: im.order, steps });
      }
      return [...per.values()].sort((a, b) => a.step - b.step);
    });
  };

  const pitchOf = (s: P2): number => {
    const sc = SCALES[st.scale].steps;
    const n = sc.length * 2;
    const k = Math.max(0, Math.min(n - 1, Math.floor((1 - s.y) * n)));
    return 57 + 12 * Math.floor(k / sc.length) + sc[k % sc.length];
  };
  const hueOf = (midi: number): string => {
    const t = (midi - 57) / 24;
    const r = Math.round(120 + 135 * t);
    const gg = Math.round(200 - 40 * Math.abs(t - 0.5));
    const b = Math.round(255 - 150 * t);
    return `rgb(${r},${gg},${b})`;
  };

  // ---- audio ----
  let soundOn = false;
  let voices: RoomVoice[] = [];
  let drumVoice: RoomVoice | null = null;
  const notes = new Map<number, AudioBuffer>();
  let drumBuf: AudioBuffer | null = null;
  let barStart = 0; // AudioContext time of the current bar's step 0
  let nextStep = 0;
  let timer = 0;
  const irQueue = new Set<number>(); // stone indices (−1 = drum) whose IR needs rebuilding
  const flashes: { stone: number; at: number; vel: number }[] = [];

  const noteBuf = (m: number): AudioBuffer => {
    let b = notes.get(m);
    if (!b) {
      b = monoBuffer(barNote(m, sampleRate()), sampleRate());
      notes.set(m, b);
    }
    return b;
  };
  const buildFor = (i: number): void => {
    const fs = sampleRate();
    const p = abs(i < 0 ? st.drum : st.stones[i]);
    const ir = buildIR(room(), { ...p, z: 1.1 }, { pos: { ...abs(st.lis), z: 1.6 }, yaw: Math.PI }, { fs, binaural: true, maxLength: 4.5 });
    const buf = irBuffer(ir, fs, i < 0 ? 0.8 : 1);
    if (i < 0) drumVoice?.setIR(buf, 0.08);
    else voices[i]?.setIR(buf, 0.08);
  };
  const rebuildAll = (): void => {
    irQueue.add(-1);
    st.stones.forEach((_, i) => irQueue.add(i));
  };
  const syncVoices = (): void => {
    while (voices.length < st.stones.length) {
      const v = new RoomVoice();
      v.fadeTo(soundOn ? 1 : 0, 0.05);
      voices.push(v);
    }
    while (voices.length > st.stones.length) voices.pop()!.dispose();
  };

  const schedule = (): void => {
    const ctx = rawCtx();
    const stepDur = 60 / st.tempo / 4;
    while (barStart + nextStep * stepDur < ctx.currentTime + 0.15) {
      const t = barStart + nextStep * stepDur;
      if (nextStep === 0 && drumVoice && drumBuf) drumVoice.fire(drumBuf, 0.55, t);
      hits.forEach((hs, i) => {
        for (const h of hs) {
          if (h.step !== nextStep) continue;
          const m = pitchOf(st.stones[i]);
          voices[i]?.fire(noteBuf(m), 0.12 + 0.5 * h.vel, t);
          flashes.push({ stone: i, at: t, vel: h.vel });
        }
      });
      nextStep++;
      if (nextStep >= STEPS) {
        nextStep = 0;
        barStart += STEPS * stepDur;
      }
    }
    while (flashes.length > 64) flashes.shift();
  };

  const start = (): void => {
    const ctx = rawCtx();
    if (!drumVoice) {
      drumVoice = new RoomVoice();
      drumBuf = monoBuffer(drumHit(sampleRate()), sampleRate());
    }
    syncVoices();
    rebuildAll();
    // build the first few right away so the first bar isn't dry
    for (const i of [...irQueue]) {
      buildFor(i);
      irQueue.delete(i);
    }
    drumVoice.fadeTo(1, 0.05);
    for (const v of voices) v.fadeTo(1, 0.05);
    barStart = ctx.currentTime + 0.1;
    nextStep = 0;
    soundOn = true;
    clearInterval(timer);
    timer = window.setInterval(schedule, 25);
    schedule();
  };
  const gate = playGate(wrap, hero ? "Tap to play the room" : "Tap to play", hero ? "then move the stones, or tap the floor to add one" : "then drag the stone", start);
  const silence = (): void => {
    if (!soundOn) return;
    soundOn = false;
    clearInterval(timer);
    drumVoice?.fadeTo(0, 0.1);
    for (const v of voices) v.fadeTo(0, 0.1);
    gate.show(hero ? "Tap to play the room again" : "Tap to play again");
  };
  const guard = frameGuard(silence);

  let urlTimer = 0;
  const changed = (what: "geometry" | "stone" | "all", stone = -1): void => {
    solve();
    if (soundOn) {
      if (what === "stone" && stone >= 0) irQueue.add(stone);
      else rebuildAll();
    }
    if (opts.syncUrl) {
      clearTimeout(urlTimer);
      urlTimer = window.setTimeout(() => {
        try {
          history.replaceState(null, "", shareUrl(st));
        } catch {
          /* some embeds forbid it */
        }
      }, 400);
    }
  };

  // ---- controls ----
  const copyLink = (btn: HTMLButtonElement): void => {
    const url = shareUrl(st);
    const done = (ok: boolean): void => {
      btn.textContent = ok ? "link copied" : "copy failed: the link is in the address bar";
      window.setTimeout(() => (btn.textContent = "copy share link"), 1800);
    };
    try {
      history.replaceState(null, "", url);
    } catch {
      /* some embeds forbid it */
    }
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(url).then(() => done(true), () => done(false));
    else done(false);
  };
  const fullControls = (): void => {
    const presetNames = Object.fromEntries(Object.entries(PRESETS).map(([k, v]) => [k, v.name])) as Record<PresetId, string>;
    const pSeg = segmented<PresetId>(shell.controls, "room", Object.keys(PRESETS) as PresetId[], st.preset, (v) => {
      st = fromPreset(v, st);
      plan.L = st.L;
      plan.W = st.W;
      floorSel.value = st.floor;
      ceilSel.value = st.ceiling;
      changed("all");
    }, presetNames);
    void pSeg;
    const brk = document.createElement("span");
    brk.className = "mp-break";
    shell.controls.appendChild(brk);
    const scaleNames = Object.fromEntries(Object.entries(SCALES).map(([k, v]) => [k, v.name])) as Record<ScaleId, string>;
    segmented<ScaleId>(shell.controls, "scale", Object.keys(SCALES) as ScaleId[], st.scale, (v) => {
      st.scale = v;
      changed("geometry");
    }, scaleNames);
    segmented<"1" | "2">(shell.controls, "echoes", ["1", "2"], String(st.echoes) as "1" | "2", (v) => {
      st.echoes = v === "1" ? 1 : 2;
      changed("geometry");
    }, { "1": "first only", "2": "up to second" });
    const brk2 = document.createElement("span");
    brk2.className = "mp-break";
    shell.controls.appendChild(brk2);
    shell.slider({
      label: "tempo",
      min: 60,
      max: 140,
      step: 1,
      value: st.tempo,
      format: (v) => `${Math.round(v)} bpm`,
      onInput: (v) => {
        st.tempo = Math.round(v);
        changed("geometry");
      },
    });
    const mk = (text: string, value: string, onPick: (v: string) => void): HTMLSelectElement => {
      const w = document.createElement("label");
      w.className = "mp-select";
      const c = document.createElement("span");
      c.textContent = text;
      const s = document.createElement("select");
      for (const m of MATERIALS) {
        const o = document.createElement("option");
        o.value = m.id;
        o.textContent = m.name;
        s.appendChild(o);
      }
      s.value = value;
      s.addEventListener("change", () => onPick(s.value));
      w.append(c, s);
      shell.controls.appendChild(w);
      return s;
    };
    const floorSel = mk("floor", st.floor, (v) => ((st.floor = v), changed("all")));
    const ceilSel = mk("ceiling", st.ceiling, (v) => ((st.ceiling = v), changed("all")));
    const brk3 = document.createElement("span");
    brk3.className = "mp-break";
    shell.controls.appendChild(brk3);
    const copy = smallButton(shell.controls, "copy share link", () => copyLink(copy));
    smallButton(shell.controls, "shuffle stones", () => {
      let seed = Math.floor(Math.random() * 1e9) + 1;
      const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      st.stones = st.stones.map(() => ({ x: 0.08 + rnd() * 0.84, y: 0.08 + rnd() * 0.84 }));
      changed("all");
    });
    smallButton(shell.controls, "clear stones", () => {
      st.stones = [];
      syncVoices();
      changed("all");
    });
  };
  if (hero && opts.controls === "share") {
    const copy = smallButton(shell.controls, "copy share link", () => copyLink(copy));
  } else if (hero) fullControls();
  else {
    segmented<"1" | "2">(shell.controls, "echoes", ["1", "2"], String(st.echoes) as "1" | "2", (v) => {
      st.echoes = v === "1" ? 1 : 2;
      changed("geometry");
    }, { "1": "first only", "2": "up to second" });
    const names: Record<string, string> = { tile: "tile", curtain: "curtains" };
    segmented<"tile" | "curtain">(shell.controls, "walls", ["tile", "curtain"], "tile", (v) => {
      st.walls = [v, v, v, v];
      changed("all");
    }, names);
  }

  // ---- pointer ----
  let dragFrom: P2 | null = null;
  const wallAt = (p: P2): number => {
    const a = plan.px({ x: 0, y: 0 });
    const w = st.L * plan.s;
    const h = st.W * plan.s;
    const tol = 12 * ui(cv);
    const inY = p.y > a.y - tol && p.y < a.y + h + tol;
    const inX = p.x > a.x - tol && p.x < a.x + w + tol;
    if (inY && Math.abs(p.x - a.x) < tol) return 0;
    if (inY && Math.abs(p.x - (a.x + w)) < tol) return 1;
    if (inX && Math.abs(p.y - a.y) < tol) return 2;
    if (inX && Math.abs(p.y - (a.y + h)) < tol) return 3;
    return -1;
  };
  dragger(
    cv,
    () => [
      ...st.stones.map((s, i) => ({
        pos: () => plan.px(abs(s)),
        move: (p: P2) => {
          const m = plan.m(p.x, p.y);
          dragFrom = m;
          st.stones[i] = rel(m);
          solve();
        },
        end: () => {
          // dragged out through a wall: remove it
          const m = dragFrom;
          dragFrom = null;
          if (hero && m && (m.x < -0.3 || m.y < -0.3 || m.x > st.L + 0.3 || m.y > st.W + 0.3)) {
            st.stones.splice(i, 1);
            voices[i]?.dispose();
            voices.splice(i, 1);
            changed("all");
          } else changed("stone", i);
        },
        r: 22,
      })),
      {
        pos: () => plan.px(abs(st.lis)),
        move: (p: P2) => {
          st.lis = rel(plan.m(p.x, p.y));
        },
        end: () => changed("all"),
        r: 26,
      },
      {
        pos: () => plan.px(abs(st.drum)),
        move: (p: P2) => {
          st.drum = rel(plan.m(p.x, p.y));
          solve();
        },
        end: () => changed("all"),
        r: 24,
      },
    ],
    (p) => {
      if (!soundOn) {
        gate.el.click();
        return;
      }
      const w = wallAt(p);
      if (w >= 0 && hero) {
        const i = WALL_CYCLE.indexOf(st.walls[w]);
        st.walls[w] = WALL_CYCLE[(i + 1) % WALL_CYCLE.length];
        changed("all");
        return;
      }
      const m = plan.m(p.x, p.y);
      if (hero && m.x > 0 && m.y > 0 && m.x < st.L && m.y < st.W && st.stones.length < MAX_STONES) {
        st.stones.push(rel(m));
        syncVoices();
        changed("stone", st.stones.length - 1);
      }
    },
  );

  solve();
  shell.setInfo(() => {
    const T = eyring(room());
    const n = hits.reduce((a, h) => a + h.length, 0);
    return `${PRESETS[st.preset].name} ${st.L.toFixed(1)} × ${st.W.toFixed(1)} × ${st.H.toFixed(1)} m · T ${T[3].toFixed(2)} s at 1 kHz · ${st.stones.length} stones, ${n} hits a bar` + (hero ? " · tap a wall to change it" : "");
  });

  let lastBuild = 0;
  return {
    frame() {
      guard.pulse();
      shell.tick();
      // rebuild at most one impulse response per 60 ms, so dragging stays smooth
      if (soundOn && irQueue.size && performance.now() - lastBuild > 60) {
        const i = irQueue.values().next().value as number;
        irQueue.delete(i);
        if (i < st.stones.length) buildFor(i);
        lastBuild = performance.now();
      }
      const d = ui(cv);
      const Wc = cv.width;
      const Hc = cv.height;
      g.fillStyle = SC.bg;
      g.fillRect(0, 0, Wc, Hc);
      const narrow = Wc / d < 560;
      const pad = 14 * d;
      const top = (inHero ? (narrow ? 86 : 96) : 22) * d;
      const gridH = Math.max(60 * d, Math.min(26 * d * Math.max(1, st.stones.length), Hc * 0.3)) + 28 * d;
      plan.L = st.L;
      plan.W = st.W;
      plan.fit(pad + 18 * d, top, Wc - pad * 2 - 36 * d, Hc - top - gridH - pad * 2 - 14 * d);
      const a = plan.px({ x: 0, y: 0 });
      const rw = st.L * plan.s;
      const rh = st.W * plan.s;

      // floor
      g.fillStyle = "#0d0f17";
      g.fillRect(a.x, a.y, rw, rh);
      const fm = material(st.floor);
      g.fillStyle = fm.color;
      g.globalAlpha = 0.06;
      g.fillRect(a.x, a.y, rw, rh);
      g.globalAlpha = 1;

      // where in the bar we are, in steps
      const ctx = soundOn ? rawCtx() : null;
      const stepDur = 60 / st.tempo / 4;
      const nowS = ctx ? (ctx.currentTime - barStart) / stepDur : ((performance.now() / 1000) / stepDur) % STEPS;
      const phase = ((nowS % STEPS) + STEPS) % STEPS;

      // wavefronts: the drum's pulse and its mirror images, as rings growing at
      // the sequencer speed, for this bar and the one before
      g.save();
      g.beginPath();
      g.rect(a.x, a.y, rw, rh);
      g.clip();
      for (const back of [0, 1]) {
        const age = phase + back * STEPS;
        const rad = age * mPerStep() * plan.s;
        for (const im of drumImages) {
          const refl = im.order === 0 ? 1 : im.gain[3] * im.dist;
          const alpha = refl * Math.exp(-age / 14) * (im.order === 0 ? 0.55 : 0.4);
          if (alpha < 0.02) continue;
          const c = plan.px(im.pos);
          g.strokeStyle = im.order === 0 ? rgba(SC.src, alpha) : rgba(im.order === 1 ? [255, 214, 150] : [190, 150, 255], alpha);
          g.lineWidth = (im.order === 0 ? 2.4 : 1.6) * d;
          g.beginPath();
          g.arc(c.x, c.y, rad, 0, Math.PI * 2);
          g.stroke();
        }
      }
      g.restore();

      // walls
      const walls: [number, number, number, number][] = [
        [a.x, a.y, a.x, a.y + rh],
        [a.x + rw, a.y, a.x + rw, a.y + rh],
        [a.x, a.y, a.x + rw, a.y],
        [a.x, a.y + rh, a.x + rw, a.y + rh],
      ];
      walls.forEach(([x0, y0, x1, y1], i) => {
        const col = material(st.walls[i]).color;
        g.save();
        g.shadowColor = col;
        g.shadowBlur = 12 * d;
        g.strokeStyle = col;
        g.lineWidth = 5 * d;
        g.lineCap = "round";
        g.beginPath();
        g.moveTo(x0, y0);
        g.lineTo(x1, y1);
        g.stroke();
        g.restore();
      });
      const fs = (narrow ? 9.5 : 10.5) * d;
      label(g, material(st.walls[2]).name, a.x + rw / 2, a.y - 11 * d, fs, SC.muted, "center");
      label(g, `${material(st.walls[3]).name} · floor: ${material(st.floor).name}`, a.x + rw / 2, a.y + rh + 12 * d, fs, SC.muted, "center");
      g.save();
      g.translate(a.x - 12 * d, a.y + rh / 2);
      g.rotate(-Math.PI / 2);
      label(g, material(st.walls[0]).name, 0, 0, fs, SC.muted, "center");
      g.restore();
      g.save();
      g.translate(a.x + rw + 12 * d, a.y + rh / 2);
      g.rotate(Math.PI / 2);
      label(g, material(st.walls[1]).name, 0, 0, fs, SC.muted, "center");
      g.restore();

      // the drum
      const dp = plan.px(abs(st.drum));
      const beat = Math.exp(-phase * 1.2);
      g.save();
      g.shadowColor = rgba(SC.src, 0.9);
      g.shadowBlur = (10 + 20 * beat) * d;
      g.strokeStyle = rgba(SC.src, 1);
      g.fillStyle = rgba(SC.src, 0.25 + 0.6 * beat);
      g.lineWidth = 2.5 * d;
      g.beginPath();
      g.arc(dp.x, dp.y, 10 * d, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.restore();
      label(g, "drum", dp.x, dp.y + 20 * d, 9.5 * d, rgba(SC.src, 0.85), "center");

      // stones, flashing when a wavefront passes
      const nowT = ctx ? ctx.currentTime : 0;
      st.stones.forEach((s, i) => {
        const p = plan.px(abs(s));
        const m = pitchOf(s);
        let flash = 0;
        if (ctx) {
          for (const f of flashes) if (f.stone === i && nowT >= f.at && nowT - f.at < 0.4) flash = Math.max(flash, f.vel * (1 - (nowT - f.at) / 0.4));
        } else {
          // before sound starts, flash in time with the visual rings
          for (const h of hits[i] ?? []) {
            const dt = (phase - h.step + STEPS) % STEPS;
            if (dt < 1.5) flash = Math.max(flash, h.vel * (1 - dt / 1.5));
          }
        }
        const col = hueOf(m);
        g.save();
        g.shadowColor = col;
        g.shadowBlur = (8 + 26 * flash) * d;
        g.fillStyle = col;
        g.beginPath();
        g.arc(p.x, p.y, (8 + 5 * flash) * d, 0, Math.PI * 2);
        g.fill();
        g.restore();
        g.fillStyle = "rgba(10,12,18,0.85)";
        label(g, midiName(m), p.x, p.y + (19 + 4 * flash) * d, 9 * d, "rgba(230,235,250,0.8)", "center", 600, true);
      });

      drawHead(g, plan.px(abs(st.lis)), Math.PI, 10 * d, d, 0.6);

      // ---- the bar, as the room wrote it ----
      const gy = Hc - gridH - pad + 10 * d;
      const gx = pad + 52 * d;
      const gw = Wc - gx - pad;
      const gh = gridH - 22 * d;
      g.fillStyle = "#0b0d14";
      roundRect(g, pad, gy - 8 * d, Wc - pad * 2, gridH, 8 * d);
      g.fill();
      const rows = Math.max(1, st.stones.length);
      const rowH = gh / rows;
      const colW = gw / STEPS;
      for (let k = 0; k < STEPS; k++) {
        g.fillStyle = k % 4 === 0 ? "rgba(150,160,200,0.08)" : "rgba(150,160,200,0.035)";
        g.fillRect(gx + k * colW + 1 * d, gy, colW - 2 * d, gh);
      }
      const ph = gx + (phase / STEPS) * gw;
      g.fillStyle = "rgba(255,255,255,0.5)";
      g.fillRect(ph - d, gy, 2 * d, gh);
      if (!st.stones.length) label(g, "tap the floor to place a stone", gx + gw / 2, gy + gh / 2, 11 * d, SC.muted, "center");
      st.stones.forEach((s, i) => {
        const y = gy + (i + 0.5) * rowH;
        const m = pitchOf(s);
        label(g, midiName(m), pad + 10 * d, y, 9.5 * d, hueOf(m), "left", 700, true);
        for (const h of hits[i] ?? []) {
          const x = gx + (h.step + 0.5) * colW;
          g.fillStyle = hueOf(m);
          g.globalAlpha = 0.35 + 0.65 * h.vel;
          const rr = Math.min(rowH * 0.42, colW * 0.42) * (0.45 + 0.55 * h.vel);
          g.beginPath();
          g.arc(x, y, rr, 0, Math.PI * 2);
          g.fill();
          g.globalAlpha = 1;
          if (h.order > 0) {
            g.strokeStyle = h.order === 1 ? "rgba(255,214,150,0.8)" : "rgba(190,150,255,0.8)";
            g.lineWidth = 1.2 * d;
            g.beginPath();
            g.arc(x, y, rr + 2 * d, 0, Math.PI * 2);
            g.stroke();
          }
        }
      });
      label(g, "plain: direct · amber ring: one bounce · violet ring: two", gx + gw, gy + gh + 9 * d, 9 * d, SC.muted, "right", 500);
    },
    dispose() {
      clearInterval(timer);
    },
  };
}

// The in-article explainer: one stone, one drum, a tiled room.
export function mountOneStone(container: HTMLElement): Demo {
  const s = fromPreset("bathroom");
  s.L = 8;
  s.W = 5;
  s.H = 3;
  s.stones = [{ x: 0.66, y: 0.36 }];
  s.drum = { x: 0.2, y: 0.55 };
  s.lis = { x: 0.82, y: 0.78 };
  s.echoes = 1;
  s.scale = "major";
  return mountRoomInstrument(container, { hero: false, state: s, syncUrl: false });
}
