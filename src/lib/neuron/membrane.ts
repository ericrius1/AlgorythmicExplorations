// Hodgkin–Huxley membrane, the 1952 squid giant axon model in the modern
// sign convention (rest near −65 mV, depolarization positive). Units: mV, ms,
// µF/cm², mS/cm², µA/cm². Temperature is 6.3 °C, the temperature of the
// voltage-clamp experiments, so the rate constants are used unscaled.
//
// HH lumped every non-Na⁺/K⁺ current into one leak with E = −54.4 mV. The
// demos split that leak into a K⁺ part and a Na⁺ part with the same total
// conductance and the same reversal, so a reader can pull on each ion
// separately. At the default settings the two are identical to classic HH.

export const E_NA = 50;
export const E_K = -77;

export interface HHParams {
  cm: number;
  gNa: number; // voltage-gated Na⁺, maximum
  gK: number; // voltage-gated K⁺, maximum
  gLeakK: number; // always-open K⁺ leak
  gLeakNa: number; // always-open Na⁺ leak
}

// gLeakK + gLeakNa = 0.3 mS/cm² and their weighted reversal is −54.4 mV,
// HH's original leak.
export const HH: HHParams = {
  cm: 1,
  gNa: 120,
  gK: 36,
  gLeakK: 0.24661,
  gLeakNa: 0.05339,
};

export interface HHState {
  v: number;
  m: number; // Na⁺ activation (fast)
  h: number; // Na⁺ inactivation (slow)
  n: number; // K⁺ activation (slow)
}

// α/β rate constants, 1/ms. The removable singularities in αm and αn are
// patched with their limits.
function alphaM(v: number): number {
  const x = v + 40;
  return Math.abs(x) < 1e-6 ? 1 : (0.1 * x) / (1 - Math.exp(-x / 10));
}
function betaM(v: number): number {
  return 4 * Math.exp(-(v + 65) / 18);
}
function alphaH(v: number): number {
  return 0.07 * Math.exp(-(v + 65) / 20);
}
function betaH(v: number): number {
  return 1 / (1 + Math.exp(-(v + 35) / 10));
}
function alphaN(v: number): number {
  const x = v + 55;
  return Math.abs(x) < 1e-6 ? 0.1 : (0.01 * x) / (1 - Math.exp(-x / 10));
}
function betaN(v: number): number {
  return 0.125 * Math.exp(-(v + 65) / 80);
}

export function steadyGates(v: number): { m: number; h: number; n: number } {
  const am = alphaM(v), bm = betaM(v);
  const ah = alphaH(v), bh = betaH(v);
  const an = alphaN(v), bn = betaN(v);
  return { m: am / (am + bm), h: ah / (ah + bh), n: an / (an + bn) };
}

export interface Currents {
  iNa: number; // voltage-gated Na⁺ (negative = inward)
  iK: number; // voltage-gated K⁺ (positive = outward)
  iLeakNa: number;
  iLeakK: number;
  gNa: number; // open conductances, mS/cm²
  gK: number;
}

export function currents(s: HHState, p: HHParams): Currents {
  const gNa = p.gNa * s.m * s.m * s.m * s.h;
  const gK = p.gK * s.n * s.n * s.n * s.n;
  return {
    iNa: gNa * (s.v - E_NA),
    iK: gK * (s.v - E_K),
    iLeakNa: p.gLeakNa * (s.v - E_NA),
    iLeakK: p.gLeakK * (s.v - E_K),
    gNa,
    gK,
  };
}

function netCurrentAtRest(v: number, p: HHParams): number {
  const g = steadyGates(v);
  const c = currents({ v, ...g }, p);
  return c.iNa + c.iK + c.iLeakNa + c.iLeakK;
}

// The voltage where the steady-state currents cancel. With a strong Na⁺ leak
// that point can exist and still be unstable (the cell fires on its own);
// stepping the model is the only way to find out.
export function restingVoltage(p: HHParams = HH): number {
  let lo = -100;
  let hi = -30;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (netCurrentAtRest(mid, p) > 0) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

export function restingState(p: HHParams = HH): HHState {
  const v = restingVoltage(p);
  return { v, ...steadyGates(v) };
}

// One step of `dt` ms with an injected current `iExt` (µA/cm², positive
// depolarizes). Gates use exponential Euler (exact for a fixed voltage) and
// the voltage uses the same trick on its conductance form, which stays stable
// at any step size. Mutates `s`.
export function stepHH(s: HHState, dt: number, p: HHParams, iExt = 0): void {
  const v = s.v;
  const am = alphaM(v), bm = betaM(v);
  const ah = alphaH(v), bh = betaH(v);
  const an = alphaN(v), bn = betaN(v);
  const relax = (x: number, a: number, b: number): number => {
    const k = a + b;
    const inf = a / k;
    return inf + (x - inf) * Math.exp(-dt * k);
  };
  s.m = relax(s.m, am, bm);
  s.h = relax(s.h, ah, bh);
  s.n = relax(s.n, an, bn);

  const gNa = p.gNa * s.m * s.m * s.m * s.h + p.gLeakNa;
  const gK = p.gK * s.n * s.n * s.n * s.n + p.gLeakK;
  const g = gNa + gK;
  const vInf = (gNa * E_NA + gK * E_K + iExt) / g;
  s.v = vInf + (v - vInf) * Math.exp((-dt * g) / p.cm);
}

// Leaky integrate-and-fire, for the circuit figures: a capacitor and a leak,
// plus a rule that says "at threshold, call it a spike and reset". Voltages
// in mV, times in ms. Synaptic input arrives as instant voltage kicks.
export interface LIFCell {
  v: number;
  refractory: number; // ms left
}

export const LIF = {
  rest: -70,
  threshold: -55,
  reset: -70,
  tau: 20, // ms
  refractory: 2, // ms
};

// Returns true if the cell fired during this step.
export function stepLIF(c: LIFCell, dt: number, drive = 0, tau = LIF.tau): boolean {
  if (c.refractory > 0) {
    c.refractory = Math.max(0, c.refractory - dt);
    c.v = LIF.reset;
    return false;
  }
  c.v += ((LIF.rest - c.v + drive) / tau) * dt;
  if (c.v >= LIF.threshold) {
    c.v = LIF.reset;
    c.refractory = LIF.refractory;
    return true;
  }
  return false;
}
