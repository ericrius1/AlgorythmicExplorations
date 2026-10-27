// A seven-cell circuit of leaky integrate-and-fire neurons (membrane.ts LIF:
// rest −70, threshold −55, τ = 20 ms, 2 ms refractory). A spike travels down
// an edge for `delay` ms and then kicks the target's voltage by `w` mV, up for
// excitation, down for inhibition. Background noise is an Ornstein–Uhlenbeck
// jitter whose standard deviation, in mV, is `noise`.
//
//            1               4 ──► 6
//          ↗   ↘           ↗ ↕
//        0       3 ───────┤
//          ↘   ↗           ↘
//            2               5 (inhibitory, back onto 3)
//
// 3 needs both 1 and 2 at once (9 + 9 mV). 3 and 4 excite each other, so one
// spike into that pair would echo forever; the interneuron 5 is driven by 3
// and its inhibition reaches 3 at the same moment 4's echo does.

import { LIF, stepLIF, type LIFCell } from "./membrane";

export interface CircuitEdge {
  from: number;
  to: number;
  w: number; // mV; negative edges are scaled by `inhibition`
  delay: number; // ms
}

export const CIRCUIT_EDGES: CircuitEdge[] = [
  { from: 0, to: 1, w: 18, delay: 6 },
  { from: 0, to: 2, w: 18, delay: 6 },
  { from: 1, to: 3, w: 9, delay: 6 },
  { from: 2, to: 3, w: 9, delay: 6 },
  { from: 3, to: 4, w: 18, delay: 6 },
  { from: 4, to: 3, w: 18, delay: 6 },
  { from: 3, to: 5, w: 18, delay: 6 },
  { from: 5, to: 3, w: -1, delay: 6 },
  { from: 4, to: 6, w: 18, delay: 6 },
];

export const INHIBITORY_CELL = 5;

export interface InFlight {
  edge: number;
  t0: number;
}

export class Circuit {
  readonly cells: LIFCell[];
  readonly flights: InFlight[] = [];
  readonly spikes: { cell: number; t: number }[] = [];
  readonly kicks: { cell: number; t: number; w: number }[] = [];
  t = 0;
  noise = 1.5; // mV, standard deviation of the background jitter
  inhibition = 20; // mV, strength of the inhibitory edge
  onSpike: ((cell: number) => void) | null = null;
  private rand: () => number;

  constructor(n = 7, rand: () => number = Math.random) {
    this.rand = rand;
    this.cells = Array.from({ length: n }, () => ({ v: LIF.rest, refractory: 0 }));
  }

  weight(e: CircuitEdge): number {
    return e.w < 0 ? -this.inhibition : e.w;
  }

  // Make cell i fire now, as if an electrode had kicked it over threshold.
  force(i: number): boolean {
    const c = this.cells[i];
    if (c.refractory > 0) return false;
    this.fire(i);
    return true;
  }

  private fire(i: number): void {
    const c = this.cells[i];
    c.v = LIF.reset;
    c.refractory = LIF.refractory;
    this.spikes.push({ cell: i, t: this.t });
    if (this.spikes.length > 400) this.spikes.shift();
    CIRCUIT_EDGES.forEach((e, k) => {
      if (e.from === i) this.flights.push({ edge: k, t0: this.t });
    });
    this.onSpike?.(i);
  }

  step(dt: number): void {
    this.t += dt;
    // deliver arrivals
    for (let k = this.flights.length - 1; k >= 0; k--) {
      const f = this.flights[k];
      const e = CIRCUIT_EDGES[f.edge];
      if (this.t - f.t0 < e.delay) continue;
      this.flights.splice(k, 1);
      const w = this.weight(e);
      const c = this.cells[e.to];
      if (c.refractory <= 0) c.v += w;
      this.kicks.push({ cell: e.to, t: this.t, w });
      if (this.kicks.length > 200) this.kicks.shift();
    }
    // integrate
    const sd = this.noise * Math.sqrt((2 * dt) / LIF.tau);
    for (let i = 0; i < this.cells.length; i++) {
      const c = this.cells[i];
      if (c.refractory <= 0 && this.noise > 0) {
        const g = Math.sqrt(-2 * Math.log(this.rand() + 1e-12)) * Math.cos(2 * Math.PI * this.rand());
        c.v += sd * g;
      }
      if (c.v >= LIF.threshold && c.refractory <= 0) {
        this.fire(i);
        continue;
      }
      if (stepLIF(c, dt)) {
        // stepLIF already reset the cell; record the spike and send it out
        c.refractory = 0;
        this.fire(i);
      }
    }
  }
}
