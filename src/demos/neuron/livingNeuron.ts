// A whole pyramidal neuron, alive. Six hundred Hodgkin–Huxley compartments
// run on the CPU (cable.ts) and several hundred thousand particles draw them
// (cellRenderer.ts). Synaptic input rains onto the spines; when enough of it
// lines up, the initial segment fires and the spike runs down the axon,
// node to node, into the terminals.
//
// Spikes last a millisecond but neurons fire a few times a second, so the
// clock runs fast while the cell is quiet and drops into slow motion the
// moment a spike starts — a bullet-time camera for one cell.

import { gpuMissing, type Demo } from "../../lib/demoShell";
import { Cable, V_REST } from "../../lib/neuron/cable";
import { CellRenderer, sub } from "../../lib/neuron/cellRenderer";
import { Kind, pyramidalNeuron, rng } from "../../lib/neuron/morphology";
import {
  NeuronStage,
  drawScope,
  hudLabel,
  makeTrace,
  normalize,
  pushTrace,
  HUD_FONT,
  type V3,
} from "../../lib/neuron/stage";

export interface LivingNeuronOptions {
  hero?: boolean; // page-top showpiece: no labels, minimal readout
  labels?: boolean;
}

export async function mountLivingNeuron(container: HTMLElement, opts: LivingNeuronOptions = {}): Promise<Demo> {
  const stage = await NeuronStage.create(container, {
    aspect: opts.hero ? 0.56 : 0.62,
    post: { bloom: 0.26, exposure: 1.05, vignette: 0.45 },
    setup: (o) => {
      o.azimuth = -Math.PI / 2 + 0.25;
      o.elevation = 0.2;
      o.distance = opts.hero ? 3.85 : 3.7;
      o.target = [0.05, 0, opts.hero ? -0.42 : -0.12];
      o.sway = 0.45;
    },
  });
  if (!stage) return gpuMissing(container);
  const { shell } = stage;
  // narrow heroes (phones) are taller than wide: back off until the cell fits,
  // and centre it, since the title sits below instead of over it
  if (opts.hero && stage.aspect < 1.75) {
    stage.orbit.distance *= Math.min(2.4, 1.75 / stage.aspect);
    stage.orbit.target = [0.05, 0, -0.05];
  }

  const morph = pyramidalNeuron(7);
  const cable = new Cable(morph.spec);
  // gates 3× faster than Hodgkin and Huxley's 6 °C squid: a warmer, briefer spike
  cable.phi = 3;
  cable.reset();
  const n = morph.n;
  const pixels = stage.canvas.width * stage.canvas.height;
  const cell = new CellRenderer(stage, morph, {
    budget: Math.round(Math.min(900_000, Math.max(260_000, pixels * 0.32))),
    dust: 24_000,
  });

  // controls
  let inputRate = 5; // synaptic events per ms of neuron time
  if (!opts.hero) {
    shell.slider({
      label: "synaptic input",
      min: 0,
      max: 12,
      step: 0.1,
      value: inputRate,
      format: (v) => `${v.toFixed(1)} /ms`,
      onInput: (v) => (inputRate = v),
    });
    shell.button("fire the cell", () => cable.excite(0, 0.12));
    const flowBtn = shell.button("hide current", () => {
      cell.showFlow = !cell.showFlow;
      flowBtn.textContent = cell.showFlow ? "hide current" : "show current";
    });
  }

  const rand = rng(99);
  const somaC = cell.point(0, 0);
  const somaR = morph.radius[0];
  const proximal = morph.dendrites.filter((i) => Math.hypot(...sub(cell.point(i, 0), somaC)) < 0.22);

  const deliverInput = (): void => {
    if (rand() < 0.86) {
      const s = cell.spines[Math.floor(rand() * cell.spines.length)];
      cable.excite(s.comp, 0.01 * (0.6 + rand() * 0.9));
      if (rand() < 0.3) cell.pushEvent(s.head, s.normal, 0);
    } else {
      // inhibition lands near the soma, where it can veto the most
      cable.inhibit(proximal[Math.floor(rand() * proximal.length)], 0.006);
      if (rand() > 0.3) return;
      const z = rand() * 2 - 1;
      const a = rand() * Math.PI * 2;
      const d: V3 = [Math.sqrt(1 - z * z) * Math.cos(a), Math.sqrt(1 - z * z) * Math.sin(a), z];
      cell.pushEvent(
        [somaC[0] + d[0] * somaR * 1.05, somaC[1] + d[1] * somaR * 1.05, somaC[2] + d[2] * somaR * 1.05],
        d,
        1,
      );
    }
  };

  // click: open receptors on a dendrite, or kick the axon
  stage.orbit.onClick = (nx, ny) => {
    const i = cell.pick(nx, ny);
    if (i < 0) return;
    const k = morph.kind[i];
    const p = cell.point(i);
    if (k === Kind.Basal || k === Kind.Apical) {
      cable.excite(i, 0.03);
      for (let j = 0; j < 4; j++) cell.pushEvent(p, normalize([rand() - 0.5, rand() - 0.5, rand() - 0.5]), 0);
    } else {
      cable.excite(i, 0.06);
      cell.pushEvent(p, [0, 0, 1], 0);
    }
  };

  // bookkeeping for bullet time and readouts
  const lastSeen = new Float32Array(n).fill(-1e9);
  const axonal: number[] = [];
  for (let i = 0; i < n; i++) if (morph.kind[i] >= Kind.Hillock || morph.kind[i] === Kind.Soma) axonal.push(i);
  const FAST = 30; // ms of neuron time per second, while quiet
  const SLOW = 0.4; // …and while a spike is in flight
  let rate = FAST;
  let hold = 0;
  let spikes = 0;
  const DT = 0.025;
  let simCarry = 0;
  const somaTrace = makeTrace(360);

  // label anchors
  const centroid = (pred: (i: number) => boolean): V3 => {
    const c: V3 = [0, 0, 0];
    let k = 0;
    for (let i = 0; i < n; i++)
      if (pred(i)) {
        const p = cell.point(i);
        c[0] += p[0];
        c[1] += p[1];
        c[2] += p[2];
        k++;
      }
    return [c[0] / k, c[1] / k, c[2] / k];
  };
  const nthOf = (kind: number, nth = 0): V3 => {
    let seen = 0;
    for (let i = 0; i < n; i++) if (morph.kind[i] === kind && seen++ === nth) return cell.point(i);
    return somaC;
  };
  const labels: { at: V3; text: string; off: [number, number]; key?: boolean }[] = [
    {
      at: centroid((i) => morph.kind[i] === Kind.Apical && morph.p1[i * 3] < -1.25),
      text: "apical tuft",
      off: [-30, -46],
    },
    { at: nthOf(Kind.Apical, 14), text: "apical dendrite", off: [-20, -64] },
    { at: nthOf(Kind.Basal, 40), text: "basal dendrites", off: [-60, 58], key: true },
    { at: somaC, text: "soma", off: [10, -70], key: true },
    { at: nthOf(Kind.AIS, 2), text: "initial segment", off: [10, 62] },
    { at: nthOf(Kind.Internode, 9), text: "myelin", off: [10, -52], key: true },
    { at: nthOf(Kind.Node, 3), text: "node of Ranvier", off: [0, 56] },
    { at: centroid((i) => morph.kind[i] === Kind.Bouton), text: "axon terminals", off: [-10, -76], key: true },
  ];

  shell.setInfo(() =>
    opts.hero
      ? `${Math.round(cell.count / 1000)}k particles · ${n} compartments · live`
      : `${spikes} spike${spikes === 1 ? "" : "s"} · 1 s on screen = ${rate.toFixed(rate < 2 ? 2 : 0)} ms for the cell · click a branch`,
  );

  return {
    frame() {
      stage.begin();
      const wall = stage.wallDt;

      // bullet time: the instant anything axonal starts to fire, drop to slow
      // motion (stopping mid-frame so the onset itself is never skipped), and
      // ease back up once the cell has gone quiet again
      hold -= wall;
      const target = hold > 0 ? SLOW : FAST;
      if (target > rate) rate += (target - rate) * Math.min(1, wall * 1.4);
      simCarry += rate * wall;
      const steps = Math.min(80, Math.floor(simCarry / DT));
      simCarry -= steps * DT;
      for (let s = 0; s < steps; s++) {
        let k = inputRate * DT;
        while (k > 0) {
          if (rand() < Math.min(1, k)) deliverInput();
          k -= 1;
        }
        cable.step(DT);
        let vmax = -100;
        for (const i of axonal) vmax = Math.max(vmax, cable.v[i]);
        if (vmax > -50) {
          hold = 1.0;
          if (rate > SLOW * 1.5) {
            rate = SLOW;
            simCarry = 0;
            break;
          }
        }
      }
      for (const b of morph.boutons) {
        if (cable.lastSpike[b] > lastSeen[b]) {
          lastSeen[b] = cable.lastSpike[b];
          const p = cell.point(b);
          cell.pushEvent(p, normalize(sub(p, cell.point(b, 0))), 2);
        }
      }
      if (cable.lastSpike[0] > lastSeen[0]) {
        lastSeen[0] = cable.lastSpike[0];
        spikes++;
      }
      pushTrace(somaTrace, cable.v[0]);

      cell.upload(cable);
      stage.render(null, (pass) => cell.draw(pass));

      // HUD
      stage.clearHud();
      const g = stage.g;
      const s = stage.px;
      if (opts.labels) for (const l of labels) if (l.key || !stage.compact) hudLabel(stage, l.at, l.text, l.off);
      if (!opts.hero) {
        drawScope(
          stage,
          stage.corner(260, 100),
          [{ trace: somaTrace, color: "#ffb86b" }],
          [-85, 45],
          [
            { v: V_REST, label: "−65 mV rest" },
            { v: 0, label: "0 mV" },
          ],
          "soma voltage",
        );
        const slow = rate < 2;
        g.font = `600 ${10.5 * s}px ${HUD_FONT}`;
        g.fillStyle = slow ? "rgba(255, 184, 107, 0.9)" : "rgba(160, 175, 210, 0.6)";
        g.textAlign = "left";
        g.textBaseline = "alphabetic";
        g.fillText(
          `${slow ? "◉ SPIKE · " : "◎ "}${Math.round(1000 / rate).toLocaleString()}× SLOWER THAN LIFE`,
          14 * s,
          22 * s,
        );
      }
      shell.tick();
    },
  };
}
