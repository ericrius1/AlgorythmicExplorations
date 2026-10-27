// A branching Hodgkin–Huxley cable, solved the way NEURON solves it: every
// compartment is a patch of membrane (a capacitor in parallel with Na⁺, K⁺
// and leak conductances), neighbours are joined by the axial resistance of
// the cytoplasm, and each step is one implicit (backward Euler) solve of the
// whole tree. Hines (1984) noticed that if every compartment's parent has a
// smaller index, that solve is a single sweep up the tree and a single sweep
// back down — O(n), and stable at any step size.
//
// Units are the classic ones: mV, ms, mS/cm², µF/cm², µA/cm². Areas and
// axial conductances are in arbitrary but consistent units, so only ratios
// matter.

export const E_NA = 50;
export const E_K = -77;
export const E_L = -54.4;
export const E_EXC = 0; // glutamate (AMPA) reversal
export const E_INH = -80; // GABA-A reversal
export const V_REST = -65;

export interface CableSpec {
  parent: Int32Array; // parent[i] < i; parent[0] = -1
  area: Float32Array; // membrane area of each compartment
  gAxial: Float32Array; // conductance to the parent (0 for the root)
  cm: Float32Array; // specific capacitance, µF/cm²
  gNa: Float32Array; // peak Na⁺ conductance, mS/cm²
  gK: Float32Array;
  gL: Float32Array;
  eL: Float32Array; // leak reversal: passive membrane rests here
}

// HH rate functions (Hodgkin & Huxley 1952, modern sign convention).
function aM(v: number): number {
  const x = v + 40;
  return Math.abs(x) < 1e-4 ? 1 : (0.1 * x) / (1 - Math.exp(-x / 10));
}
const bM = (v: number): number => 4 * Math.exp(-(v + 65) / 18);
const aH = (v: number): number => 0.07 * Math.exp(-(v + 65) / 20);
const bH = (v: number): number => 1 / (1 + Math.exp(-(v + 35) / 10));
function aN(v: number): number {
  const x = v + 55;
  return Math.abs(x) < 1e-4 ? 0.1 : (0.01 * x) / (1 - Math.exp(-x / 10));
}
const bN = (v: number): number => 0.125 * Math.exp(-(v + 65) / 80);

export class Cable {
  readonly n: number;
  readonly spec: CableSpec;
  // state
  readonly v: Float32Array;
  readonly m: Float32Array;
  readonly h: Float32Array;
  readonly k: Float32Array; // the HH "n" gate
  readonly gExc: Float32Array; // synaptic conductance, absolute (× area already)
  readonly gInh: Float32Array;
  readonly iInj: Float32Array; // injected current, absolute
  // per-step outputs for the renderers
  readonly iNa: Float32Array; // inward Na⁺ current density (positive = in)
  readonly iK: Float32Array; // outward K⁺ current density (positive = out)
  readonly iAxial: Float32Array; // current from parent into this compartment
  readonly lastSpike: Float32Array; // time v last crossed 0 mV upward
  t = 0;
  tauExc = 2;
  tauInh = 6;
  // gate speed-up: 1 is squid at 6.3 °C
  phi = 1;

  private d: Float64Array;
  private b: Float64Array;

  constructor(spec: CableSpec) {
    this.spec = spec;
    const n = (this.n = spec.parent.length);
    this.v = new Float32Array(n).fill(V_REST);
    this.m = new Float32Array(n);
    this.h = new Float32Array(n);
    this.k = new Float32Array(n);
    this.gExc = new Float32Array(n);
    this.gInh = new Float32Array(n);
    this.iInj = new Float32Array(n);
    this.iNa = new Float32Array(n);
    this.iK = new Float32Array(n);
    this.iAxial = new Float32Array(n);
    this.lastSpike = new Float32Array(n).fill(-1e9);
    this.d = new Float64Array(n);
    this.b = new Float64Array(n);
    this.reset();
  }

  reset(): void {
    const v = V_REST;
    const m = aM(v) / (aM(v) + bM(v));
    const h = aH(v) / (aH(v) + bH(v));
    const k = aN(v) / (aN(v) + bN(v));
    this.v.fill(v);
    this.m.fill(m);
    this.h.fill(h);
    this.k.fill(k);
    this.gExc.fill(0);
    this.gInh.fill(0);
    this.iInj.fill(0);
    this.lastSpike.fill(-1e9);
    // settle the passive and myelinated parts onto their own fixed point
    for (let i = 0; i < 400; i++) this.step(0.05);
    this.t = 0;
    this.lastSpike.fill(-1e9);
  }

  step(dt: number): void {
    const { parent, area, gAxial, cm, gNa, gK, gL, eL } = this.spec;
    const { v, m, h, k, d, b, n } = this;
    const pdt = dt * this.phi;
    const eExc = Math.exp(-dt / this.tauExc);
    const eInh = Math.exp(-dt / this.tauInh);

    for (let i = 0; i < n; i++) {
      const vi = v[i];
      // exponential Euler on the gates, using last step's voltage
      if (gNa[i] > 0) {
        const am = aM(vi),
          bm = bM(vi),
          ah = aH(vi),
          bh = bH(vi);
        m[i] = am / (am + bm) + (m[i] - am / (am + bm)) * Math.exp(-pdt * (am + bm));
        h[i] = ah / (ah + bh) + (h[i] - ah / (ah + bh)) * Math.exp(-pdt * (ah + bh));
      }
      if (gK[i] > 0) {
        const an = aN(vi),
          bn = bN(vi);
        k[i] = an / (an + bn) + (k[i] - an / (an + bn)) * Math.exp(-pdt * (an + bn));
      }
      const mi = m[i],
        ki = k[i];
      const gna = gNa[i] * mi * mi * mi * h[i];
      const gk = gK[i] * ki * ki * ki * ki;
      const A = area[i];
      const G = (gna + gk + gL[i]) * A + this.gExc[i] + this.gInh[i];
      const GE = (gna * E_NA + gk * E_K + gL[i] * eL[i]) * A + this.gExc[i] * E_EXC + this.gInh[i] * E_INH;
      const C = (cm[i] * A) / dt;
      d[i] = C + G;
      b[i] = C * vi + GE + this.iInj[i];
      this.iNa[i] = -gna * (vi - E_NA);
      this.iK[i] = gk * (vi - E_K);
      this.gExc[i] *= eExc;
      this.gInh[i] *= eInh;
    }
    // (a compartment with no parent is the root of its own tree, so one
    // Cable can hold several separate cells)
    for (let i = 1; i < n; i++) {
      if (parent[i] < 0) continue;
      const g = gAxial[i];
      d[i] += g;
      d[parent[i]] += g;
    }
    // Hines: eliminate leaves upward…
    for (let i = n - 1; i >= 1; i--) {
      const p = parent[i];
      if (p < 0) continue;
      const a = -gAxial[i];
      const f = a / d[i];
      d[p] -= f * a;
      b[p] -= f * b[i];
    }
    // …then substitute back down
    const t1 = this.t + dt;
    for (let i = 0; i < n; i++) {
      const p = parent[i];
      const nv = p < 0 ? b[i] / d[i] : (b[i] + gAxial[i] * v[p]) / d[i];
      if (v[i] < 0 && nv >= 0) this.lastSpike[i] = t1;
      v[i] = nv;
    }
    for (let i = 1; i < n; i++) this.iAxial[i] = parent[i] < 0 ? 0 : (gAxial[i] * (v[parent[i]] - v[i])) / area[i];
    this.t = t1;
  }

  // Open some glutamate receptors on compartment i (g in absolute units).
  excite(i: number, g: number): void {
    this.gExc[i] += g;
  }

  inhibit(i: number, g: number): void {
    this.gInh[i] += g;
  }
}
