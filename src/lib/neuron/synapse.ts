// A chemical synapse onto a leaky postsynaptic cell, in real units.
//
// Presynaptic side: a set of release sites, each holding at most one docked
// vesicle. When a spike arrives, each docked vesicle fuses with probability
// `p` after a 0.5 ms delay (the time for Ca²⁺ to come in and trigger fusion).
// An empty site refills at random, with a mean wait of `refillMs` (100 ms,
// quicker than most real synapses, so the figure recovers in a few seconds). That's the
// del Castillo–Katz picture: transmitter comes in whole packets, and how many
// packets a spike releases is a matter of chance.
//
// Postsynaptic side: every fused vesicle opens an AMPA-type conductance
// (0.2 ms rise, 2 ms decay, reversal 0 mV) on a leaky membrane (200 pF,
// 10 nS leak, so τ = 20 ms, resting at −70 mV). If the voltage reaches
// −55 mV the cell fires, which here means a mark on the trace and a reset.

export interface SynapseParams {
  sites: number;
  p: number; // release probability per docked vesicle per spike
  refillMs: number;
  quantumNs: number; // peak conductance of one vesicle's worth of receptors
}

// Each input axon connects to the cell through 10 release sites. The figure
// starts with 12 inputs that fire together.
export const SITES_PER_INPUT = 10;

export const SYNAPSE: SynapseParams = {
  sites: 12 * SITES_PER_INPUT,
  p: 0.3,
  refillMs: 100,
  quantumNs: 0.55,
};

export const POST = {
  capPf: 200,
  leakNs: 10,
  rest: -70,
  threshold: -55,
  reversal: 0,
  riseMs: 0.2,
  decayMs: 2,
  delayMs: 0.5,
  refractoryMs: 3,
};

// Peak of exp(-t/decay) - exp(-t/rise), so one vesicle peaks at quantumNs.
const T_PEAK = ((POST.riseMs * POST.decayMs) / (POST.decayMs - POST.riseMs)) * Math.log(POST.decayMs / POST.riseMs);
const NORM = 1 / (Math.exp(-T_PEAK / POST.decayMs) - Math.exp(-T_PEAK / POST.riseMs));

export interface Fusion {
  site: number;
  t: number; // ms, when it fused
}

export class Synapse {
  readonly params: SynapseParams;
  docked: boolean[];
  t = 0; // ms
  v = POST.rest;
  refractory = 0;
  private gDecay = 0; // two-state kinetics for the summed conductance
  private gRise = 0;
  private pendingSpikes: number[] = []; // arrival times awaiting the release delay
  readonly fusions: Fusion[] = []; // recent fusions, for drawing
  lastReleased = 0;
  lastDocked = 0;
  onFire: (() => void) | null = null;
  onRelease: ((released: number, docked: number) => void) | null = null;
  private rand: () => number;

  constructor(params: SynapseParams = SYNAPSE, rand: () => number = Math.random) {
    this.params = { ...params };
    this.rand = rand;
    this.docked = new Array(params.sites).fill(true);
  }

  setSites(n: number): void {
    while (this.docked.length < n) this.docked.push(true);
    this.docked.length = n;
    this.params.sites = n;
  }

  get conductanceNs(): number {
    return (this.gDecay - this.gRise) * NORM;
  }

  get dockedCount(): number {
    let k = 0;
    for (const d of this.docked) if (d) k++;
    return k;
  }

  spike(): void {
    this.pendingSpikes.push(this.t + POST.delayMs);
  }

  step(dt: number): boolean {
    this.t += dt;
    const { p, refillMs, quantumNs } = this.params;

    // release
    for (let i = this.pendingSpikes.length - 1; i >= 0; i--) {
      if (this.pendingSpikes[i] > this.t) continue;
      this.pendingSpikes.splice(i, 1);
      let released = 0;
      this.lastDocked = this.dockedCount;
      for (let s = 0; s < this.docked.length; s++) {
        if (this.docked[s] && this.rand() < p) {
          this.docked[s] = false;
          released++;
          this.fusions.push({ site: s, t: this.t });
        }
      }
      this.lastReleased = released;
      this.onRelease?.(released, this.lastDocked);
      this.gDecay += released * quantumNs;
      this.gRise += released * quantumNs;
    }

    // refill
    const pRefill = 1 - Math.exp(-dt / refillMs);
    for (let s = 0; s < this.docked.length; s++) {
      if (!this.docked[s] && this.rand() < pRefill) this.docked[s] = true;
    }

    // conductance kinetics
    this.gDecay *= Math.exp(-dt / POST.decayMs);
    this.gRise *= Math.exp(-dt / POST.riseMs);

    // postsynaptic membrane (exponential Euler on the conductance form)
    if (this.refractory > 0) {
      this.refractory = Math.max(0, this.refractory - dt);
      this.v = POST.rest;
      return false;
    }
    const g = POST.leakNs + Math.max(0, this.conductanceNs);
    const vInf = (POST.leakNs * POST.rest + Math.max(0, this.conductanceNs) * POST.reversal) / g;
    this.v = vInf + (this.v - vInf) * Math.exp((-dt * g) / POST.capPf);
    if (this.v >= POST.threshold) {
      this.v = POST.rest;
      this.refractory = POST.refractoryMs;
      this.onFire?.();
      return true;
    }
    return false;
  }
}
