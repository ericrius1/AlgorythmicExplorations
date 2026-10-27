// Two axons of the same thickness, side by side, fired at the same instant.
// The top one is bare membrane, so the spike has to regenerate itself patch
// by patch all the way along. The bottom one is wrapped in myelin with bare
// nodes every 0.36 units; under the wrapping the membrane barely charges or
// leaks, so current from one firing node reaches the next almost at once,
// and the spike jumps.

import { gpuMissing, type Demo } from "../../lib/demoShell";
import { Cable } from "../../lib/neuron/cable";
import { CellRenderer } from "../../lib/neuron/cellRenderer";
import { axonPair, Kind } from "../../lib/neuron/morphology";
import { NeuronStage, HUD_FONT, hudLabel } from "../../lib/neuron/stage";

const X0 = -1.5;
const X1 = 1.5;

export async function mountAxonRace(container: HTMLElement): Promise<Demo> {
  const stage = await NeuronStage.create(container, {
    aspect: 0.56,
    post: { bloom: 0.28, exposure: 1.05, vignette: 0.4 },
    setup: (o) => {
      o.azimuth = -Math.PI / 2 + 0.32;
      o.elevation = 0.22;
      o.distance = 3.5;
      o.target = [0.05, 0, -0.04];
      o.sway = 0.3;
    },
  });
  if (!stage) return gpuMissing(container);
  const { shell } = stage;

  const { morph, bare, myelinated } = axonPair({ x0: X0, x1: X1, gap: 0.62, radius: 0.035 });
  const cable = new Cable(morph.spec);
  cable.phi = 3;
  cable.reset();
  const cell = new CellRenderer(stage, morph, { budget: 520_000, dust: 14_000, spines: false });

  let rate = 0.25; // ms of axon time per second on screen
  let simCarry = 0;
  const DT = 0.01;

  // race bookkeeping: when each axon was fired and how far its spike has got
  interface Lane {
    name: string;
    range: [number, number];
    start: number;
    reach: number; // furthest x the spike has reached since the start
    done: number; // arrival time, ms after the start (or -1)
  }
  const lanes: Lane[] = [
    { name: "bare", range: bare, start: -1, reach: X0, done: -1 },
    { name: "myelinated", range: myelinated, start: -1, reach: X0, done: -1 },
  ];
  const fireLane = (l: Lane, at = l.range[0]): void => {
    cable.excite(at, 0.15);
    l.start = cable.t;
    l.reach = morph.p0[at * 3];
    l.done = -1;
  };
  const fireBoth = (): void => lanes.forEach((l) => fireLane(l));

  shell.button("fire both", fireBoth);
  shell.slider({
    label: "slow motion",
    min: 0.05,
    max: 2,
    step: 0.01,
    log: true,
    value: rate,
    format: (v) => `1 s = ${v.toFixed(2)} ms`,
    onInput: (v) => (rate = v),
  });

  stage.orbit.onClick = (nx, ny) => {
    const i = cell.pick(nx, ny, 0.08);
    if (i < 0) return;
    const lane = lanes.find((l) => i >= l.range[0] && i <= l.range[1]);
    if (!lane) return;
    cable.excite(i, 0.15);
    lane.start = -1; // a spike started mid-axon isn't a race
    cell.pushEvent(cell.point(i), [0, 0, 1], 0);
  };

  let autoFire = 0.6; // seconds until the first race
  shell.setInfo(
    () =>
      `${morph.n} compartments · ${Math.round(cell.count / 1000)}k particles · click an axon to start a spike anywhere`,
  );

  return {
    frame() {
      stage.begin();
      if (autoFire > 0) {
        autoFire -= stage.wallDt;
        if (autoFire <= 0) fireBoth();
      }
      simCarry += rate * stage.wallDt;
      const steps = Math.min(400, Math.floor(simCarry / DT));
      simCarry -= steps * DT;
      for (let s = 0; s < steps; s++) {
        cable.step(DT);
        for (const l of lanes) {
          if (l.start < 0 || l.done >= 0) continue;
          for (let i = l.range[0]; i <= l.range[1]; i++) {
            if (cable.lastSpike[i] >= l.start) l.reach = Math.max(l.reach, morph.p1[i * 3]);
          }
          if (cable.lastSpike[l.range[1]] >= l.start) l.done = cable.t - l.start;
        }
      }
      // once both have finished and the axons are quiet, go again
      const quiet = cable.v.every((v) => v < -60);
      if (lanes.every((l) => l.done >= 0 || l.start < 0) && quiet && autoFire <= 0) autoFire = 2.2;

      cell.upload(cable);
      stage.render(null, (pass) => cell.draw(pass));

      // HUD: lane labels, a finish line, and the race readout
      stage.clearHud();
      const g = stage.g;
      const s = stage.px;
      const zOf = (l: Lane): number => morph.p0[l.range[0] * 3 + 2];
      const c = stage.compact;
      if (!c) {
        hudLabel(stage, [X0, 0, zOf(lanes[0]) + 0.04], "bare axon", [-14, -34], "rgba(214, 222, 240, 0.9)");
        hudLabel(stage, [X0, 0, zOf(lanes[1]) - 0.1], "myelinated axon", [-14, 40], "rgba(214, 222, 240, 0.9)");
      }
      let nodeShown = c;
      for (let i = lanes[1].range[0] + 1; i <= lanes[1].range[1] && !nodeShown; i++) {
        if (morph.kind[i] === Kind.Node && morph.p0[i * 3] > 0.3) {
          hudLabel(stage, cell.point(i), "node", [18, 44]);
          nodeShown = true;
        }
      }
      const a = stage.project([X1 + 0.03, 0, zOf(lanes[0]) + 0.2]);
      const b = stage.project([X1 + 0.03, 0, zOf(lanes[1]) - 0.2]);
      if (a && b) {
        g.strokeStyle = "rgba(255, 255, 255, 0.22)";
        g.setLineDash([4 * s, 5 * s]);
        g.lineWidth = 1 * s;
        g.beginPath();
        g.moveTo(a[0], a[1]);
        g.lineTo(b[0], b[1]);
        g.stroke();
        g.setLineDash([]);
        g.fillStyle = "rgba(200, 210, 235, 0.6)";
        g.font = `600 ${9.5 * s}px ${HUD_FONT}`;
        g.textAlign = "center";
        g.fillText("FINISH", a[0], a[1] - 8 * s);
      }
      g.textAlign = "left";
      g.textBaseline = "middle";
      const u = (c ? 0.75 : 1) * s;
      const bx = 12 * s;
      const bw = (c ? 70 : 150) * s;
      lanes.forEach((l, k) => {
        const y = (24 + k * 22) * u;
        g.font = `600 ${10 * u}px ${HUD_FONT}`;
        g.fillStyle = "rgba(170, 182, 212, 0.75)";
        g.fillText(l.name.toUpperCase(), bx, y);
        const x0 = bx + 86 * u;
        g.fillStyle = "rgba(255, 255, 255, 0.07)";
        g.fillRect(x0, y - 3 * s, bw, 6 * s);
        const f = l.start < 0 ? 0 : (l.reach - X0) / (X1 - X0);
        g.fillStyle = l.done >= 0 ? "#ffb86b" : "rgba(255, 184, 107, 0.6)";
        g.fillRect(x0, y - 3 * s, bw * Math.min(1, Math.max(0, f)), 6 * s);
        g.fillStyle = "rgba(230, 236, 255, 0.9)";
        g.font = `600 ${10.5 * u}px ${HUD_FONT}`;
        const t = l.start < 0 ? "" : l.done >= 0 ? `${l.done.toFixed(2)} ms` : `${(cable.t - l.start).toFixed(2)} ms…`;
        g.fillText(t, x0 + bw + 10 * u, y);
      });
      const [m, bb] = [lanes[1].done, lanes[0].done];
      if (m > 0 && bb > 0) {
        g.fillStyle = "rgba(143, 224, 176, 0.9)";
        g.font = `600 ${10.5 * u}px ${HUD_FONT}`;
        g.fillText(`myelin wins, ${(bb / m).toFixed(1)}× faster`, bx, 70 * u);
      }
      shell.tick();
    },
  };
}
