// An unmyelinated axon as a chain of Hodgkin–Huxley compartments joined by
// the resistance of the axoplasm. Nothing here knows what a "pulse" is:
// propagation, the refractory wake, and two pulses cancelling when they
// meet all come out of the membrane equations plus the axial current.
//
// Units: mV, ms, cm, µF/cm², mS/cm². Each step updates the gates explicitly
// (exponential Euler) and then solves for all the voltages at once with
// backward Euler (a tridiagonal solve), the way NEURON does it, so the
// strong coupling between short compartments can't blow up.

import { E_K, E_NA, HH, restingState, type HHParams } from "./membrane";

export const AXOPLASM_RESISTIVITY = 35.4; // Ω·cm, Hodgkin & Huxley's value

export class Cable {
  readonly n: number;
  readonly dx: number; // cm per compartment
  readonly v: Float64Array;
  readonly m: Float64Array;
  readonly h: Float64Array;
  readonly nk: Float64Array;
  private gc = 0; // axial coupling, mS/cm² of membrane
  private readonly p: HHParams;
  private readonly a: Float64Array;
  private readonly b: Float64Array;
  private readonly c: Float64Array;
  private readonly d: Float64Array;
  private readonly inj: Float64Array; // µA/cm², per compartment
  diameter = 0; // cm

  constructor(n: number, lengthCm: number, diameterUm: number, p: HHParams = HH) {
    this.n = n;
    this.dx = lengthCm / n;
    this.p = p;
    const rest = restingState(p);
    this.v = new Float64Array(n).fill(rest.v);
    this.m = new Float64Array(n).fill(rest.m);
    this.h = new Float64Array(n).fill(rest.h);
    this.nk = new Float64Array(n).fill(rest.n);
    this.a = new Float64Array(n);
    this.b = new Float64Array(n);
    this.c = new Float64Array(n);
    this.d = new Float64Array(n);
    this.inj = new Float64Array(n);
    this.setDiameter(diameterUm);
  }

  setDiameter(um: number): void {
    this.diameter = um * 1e-4;
    // axial conductance between neighbours per unit membrane area:
    // d / (4 Ri dx²), in S/cm², times 1000 for mS/cm²
    this.gc = (1000 * this.diameter) / (4 * AXOPLASM_RESISTIVITY * this.dx * this.dx);
  }

  // Length constant at rest, cm: how far a steady voltage spreads passively.
  lengthConstant(): number {
    const gRest = this.p.gLeakK + this.p.gLeakNa + 0.37; // + open K⁺ channels at rest
    const rm = 1000 / gRest; // Ω·cm²
    return Math.sqrt((this.diameter * rm) / (4 * AXOPLASM_RESISTIVITY));
  }

  // Inject current into compartments [i0, i1] for the next step(s).
  inject(i0: number, i1: number, amp: number): void {
    for (let i = Math.max(0, i0); i <= Math.min(this.n - 1, i1); i++) this.inj[i] = amp;
  }

  clearInjection(): void {
    this.inj.fill(0);
  }

  step(dt: number): void {
    const { n, v, m, h, nk, p, gc, a, b, c, d } = this;
    const cdt = p.cm / dt;
    for (let i = 0; i < n; i++) {
      const vi = v[i];
      // gates, exponential Euler at the old voltage
      const xm = vi + 40;
      const am = Math.abs(xm) < 1e-6 ? 1 : (0.1 * xm) / (1 - Math.exp(-xm / 10));
      const bm = 4 * Math.exp(-(vi + 65) / 18);
      const ah = 0.07 * Math.exp(-(vi + 65) / 20);
      const bh = 1 / (1 + Math.exp(-(vi + 35) / 10));
      const xn = vi + 55;
      const an = Math.abs(xn) < 1e-6 ? 0.1 : (0.01 * xn) / (1 - Math.exp(-xn / 10));
      const bn = 0.125 * Math.exp(-(vi + 65) / 80);
      let k = am + bm;
      m[i] = am / k + (m[i] - am / k) * Math.exp(-dt * k);
      k = ah + bh;
      h[i] = ah / k + (h[i] - ah / k) * Math.exp(-dt * k);
      k = an + bn;
      nk[i] = an / k + (nk[i] - an / k) * Math.exp(-dt * k);

      const mi = m[i];
      const n4 = nk[i] * nk[i] * nk[i] * nk[i];
      const gNa = p.gNa * mi * mi * mi * h[i] + p.gLeakNa;
      const gK = p.gK * n4 + p.gLeakK;
      const neighbours = (i > 0 ? 1 : 0) + (i < n - 1 ? 1 : 0); // sealed ends
      a[i] = i > 0 ? -gc : 0;
      c[i] = i < n - 1 ? -gc : 0;
      b[i] = cdt + gNa + gK + gc * neighbours;
      d[i] = cdt * vi + gNa * E_NA + gK * E_K + this.inj[i];
    }
    // Thomas algorithm
    for (let i = 1; i < n; i++) {
      const w = a[i] / b[i - 1];
      b[i] -= w * c[i - 1];
      d[i] -= w * d[i - 1];
    }
    v[n - 1] = d[n - 1] / b[n - 1];
    for (let i = n - 2; i >= 0; i--) v[i] = (d[i] - c[i] * v[i + 1]) / b[i];
  }
}
