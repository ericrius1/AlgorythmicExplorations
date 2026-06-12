// The circle of fifths as a map of keys. Twelve major keys around the rim,
// each one fifth from its neighbours; the inner ring is the chromatic
// pitch-class clock with the chosen key's seven notes lit. The rim nodes are
// tinted by how many notes each key shares with the chosen one — watch the
// gradient: neighbours share six of seven, the key across the circle barely
// knows you. Distance on this map is the cost of modulation.

import { Shell, gpuMissing, type Demo } from "../../lib/demoShell";
import { getDevice } from "../../lib/gpu";
import { ShaderView } from "../../lib/shaderCanvas";
import { Tone, masterBus, unlockAudio, frameGuard, soundHint, NOTE_NAMES } from "../../lib/audio";

const C4 = 261.63;
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
// rim position k (clockwise from top) is the key k fifths up from C
const KEY_LABELS = ["C", "G", "D", "A", "E", "B", "F♯", "D♭", "A♭", "E♭", "B♭", "F"];
const SIGNATURES = ["—", "1♯", "2♯", "3♯", "4♯", "5♯", "6♯", "5♭", "4♭", "3♭", "2♭", "1♭"];

const SCENE = /* wgsl */ `
fn nodeAt(k: u32, R: f32) -> vec2f {
  let a = 1.5707963 - f32(k) * 6.2831853 / 12.0;
  return vec2f(cos(a), sin(a)) * R;
}

fn scene(uv: vec2f) -> vec3f {
  let t = uf(0u);
  let aspect = uf(1u);
  let sel = u32(uf(4u));
  let comet = uf(5u);
  var col = vec3f(0.0);

  let q = vec2f((uv.x - 0.5) * aspect, uv.y - 0.5) * 2.35;

  // rim: the twelve keys, tinted by overlap with the chosen key
  for (var k = 0u; k < 12u; k++) {
    let p = nodeAt(k, 0.86);
    let share = D[k]; // 0..7 notes in common
    let d = length(q - p);
    let warmth = share / 7.0;
    let isSel = f32(k == sel);
    let hue = mix(0.62, 0.09, warmth * warmth);
    let size = 0.02 + warmth * 0.014 + isSel * 0.016;
    col += hsv(hue, 0.65, 0.4 + warmth * 0.7) * (glow(d, size) * (0.5 + warmth + isSel) + halo(d, 0.012) * 0.3 * warmth);
    col += vec3f(1.0, 0.95, 0.85) * glow(d, 0.008) * isSel * (0.8 + 0.3 * sin(t * 3.0));
  }
  // neighbour bonds: selected key to its two fifth-neighbours
  let pSel = nodeAt(sel, 0.86);
  let pUp = nodeAt((sel + 1u) % 12u, 0.86);
  let pDn = nodeAt((sel + 11u) % 12u, 0.86);
  col += hsv(0.1, 0.7, 0.9) * (glow(sdSeg(q, pSel, pUp), 0.004) + glow(sdSeg(q, pSel, pDn), 0.004)) * 0.5;

  // inner chromatic clock with the key's notes lit
  for (var k = 0u; k < 12u; k++) {
    let p = nodeAt(k, 0.45);
    let lit = D[12u + k];
    let d = length(q - p);
    col += vec3f(0.06, 0.07, 0.12) * glow(d, 0.006);
    if (lit > 0.5) {
      let isRoot = f32(lit > 1.5);
      col += hsv(mix(0.55, 0.085, isRoot), 0.6, 1.0) * (glow(d, 0.018 + isRoot * 0.008) * (0.8 + isRoot * 0.8));
    }
  }

  if (comet > -5.0) {
    let p = vec2f(cos(comet), sin(comet)) * 0.45;
    col += vec3f(1.0, 0.95, 0.8) * glow(length(q - p), 0.016) * 1.2;
  }

  return col * vignette(uv);
}
`;

export async function mountFifthsKeys(container: HTMLElement): Promise<Demo> {
  const dev = await getDevice();
  const shell = new Shell(container, 0.66);
  if (!dev) return gpuMissing(container);
  const view = new ShaderView(dev, shell.canvas, SCENE, 24);
  soundHint(container, "click a key");

  let sel = 0; // rim index: k fifths up from C
  const tonicPC = (k: number): number => (k * 7) % 12;
  const keyPCs = (k: number): Set<number> => new Set(MAJOR.map((s) => (tonicPC(k) + s) % 12));

  const synth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "triangle" },
    envelope: { attack: 0.01, decay: 0.3, sustain: 0.2, release: 0.6 },
    volume: -11,
  }).connect(masterBus());
  let queue: { at: number; pc: number }[] = [];
  const guard = frameGuard(() => {
    synth.releaseAll();
    queue = [];
  });

  let lastFrame = 0;
  const playKey = (k: number): void => {
    if (performance.now() - lastFrame > 400) return;
    const now = Tone.now();
    const tonic = tonicPC(k);
    const pcs = [...MAJOR, 12].map((s) => tonic + s);
    queue = pcs.map((pc, i) => ({ at: now + i * 0.16, pc: pc % 12 }));
    pcs.forEach((pc, i) => {
      synth.triggerAttackRelease(C4 * Math.pow(2, (pc - 12) / 12), 0.15, now + i * 0.16);
    });
    // then the tonic chord
    const chordAt = now + pcs.length * 0.16 + 0.1;
    for (const s of [0, 4, 7]) {
      synth.triggerAttackRelease(C4 * Math.pow(2, (tonic + s - 12) / 12), 1.1, chordAt);
    }
  };

  shell.canvas.addEventListener("pointerdown", () => {
    // which rim node is closest to the click?
    const aspect = shell.canvas.width / shell.canvas.height;
    const qx = (view.pointer.x - 0.5) * aspect * 2.35;
    const qy = (view.pointer.y - 0.5) * 2.35;
    let best = -1;
    let bestD = 0.3;
    for (let k = 0; k < 12; k++) {
      const a = Math.PI / 2 - (k * 2 * Math.PI) / 12;
      const d = Math.hypot(qx - Math.cos(a) * 0.86, qy - Math.sin(a) * 0.86);
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
    if (best >= 0) {
      sel = best;
      void unlockAudio().then(() => playKey(sel));
    }
  });

  shell.button("◀ fifth down", () => {
    sel = (sel + 11) % 12;
    void unlockAudio().then(() => playKey(sel));
  });
  shell.button("fifth up ▶", () => {
    sel = (sel + 1) % 12;
    void unlockAudio().then(() => playKey(sel));
  });

  shell.setInfo(() => {
    const here = keyPCs(sel);
    const up = [...keyPCs((sel + 1) % 12)].filter((pc) => here.has(pc)).length;
    return `${KEY_LABELS[sel]} major · ${SIGNATURES[sel]} · shares ${up} of 7 notes with each neighbour · ${NOTE_NAMES[tonicPC(sel)]} is home`;
  });

  return {
    frame() {
      shell.tick();
      guard.pulse();
      lastFrame = performance.now();

      const here = keyPCs(sel);
      for (let k = 0; k < 12; k++) {
        const other = keyPCs(k);
        let n = 0;
        for (const pc of other) if (here.has(pc)) n++;
        view.data[k] = n;
      }
      for (let pc = 0; pc < 12; pc++) view.data[12 + pc] = here.has(pc) ? 1 : 0;
      view.data[12 + tonicPC(sel)] = 2;

      const now = Tone.now();
      let comet = -10;
      for (const q of queue) {
        if (Math.abs(now - q.at) < 0.09) comet = Math.PI / 2 - (q.pc * 2 * Math.PI) / 12;
      }
      view.uniforms[4] = sel;
      view.uniforms[5] = comet;
      view.draw();
    },
    dispose() {
      synth.releaseAll();
    },
  };
}
