// Simplified Hodgkin–Huxley-style membrane dynamics for teaching demos.
// Not a research model — tuned for readable voltage traces and clear phases.

export const REST = -70; // mV resting potential
export const THRESH = -55;
export const PEAK = 40;
export const REFRACTORY_MS = 2.5;

export interface MembraneState {
  v: number; // membrane potential (mV)
  n: number; // K+ activation gate (0–1)
  m: number; // Na+ activation gate (0–1)
  h: number; // Na+ inactivation gate (0–1)
  refractory: number; // ms remaining
}

export interface MembraneParams {
  gNa: number; // Na+ conductance scale
  gK: number; // K+ conductance scale
  gLeak: number;
  eNa: number;
  eK: number;
  eLeak: number;
  cm: number; // membrane capacitance (µF/cm² scale)
}

export const DEFAULT_PARAMS: MembraneParams = {
  gNa: 120,
  gK: 36,
  gLeak: 0.3,
  eNa: 55,
  eK: -77,
  eLeak: -54.4,
  cm: 1,
};

// HH α/β rate functions (classic Hodgkin–Huxley, 1952).
function alphaM(v: number): number {
  const x = v + 40;
  if (Math.abs(x) < 1e-6) return 1;
  return (0.1 * x) / (1 - Math.exp(-x / 10));
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
  if (Math.abs(x) < 1e-6) return 0.1;
  return (0.01 * x) / (1 - Math.exp(-x / 10));
}
function betaN(v: number): number {
  return 0.125 * Math.exp(-(v + 65) / 80);
}

function gatesAt(v: number): { m: number; h: number; n: number } {
  const m = alphaM(v) / (alphaM(v) + betaM(v));
  const h = alphaH(v) / (alphaH(v) + betaH(v));
  const n = alphaN(v) / (alphaN(v) + betaN(v));
  return { m, h, n };
}

function totalIonicCurrent(v: number, m: number, h: number, n: number, p: MembraneParams): number {
  const iNa = p.gNa * m * m * m * h * (v - p.eNa);
  const iK = p.gK * n * n * n * n * (v - p.eK);
  const iLeak = p.gLeak * (v - p.eLeak);
  return iNa + iK + iLeak;
}

export function restingState(p: MembraneParams = DEFAULT_PARAMS): MembraneState {
  // Find V where ionic currents balance (fixed point for the HH gates).
  let v = REST;
  for (let i = 0; i < 24; i++) {
    const { m, h, n } = gatesAt(v);
    const i = totalIonicCurrent(v, m, h, n, p);
    v -= i * 0.15;
  }
  const { m, h, n } = gatesAt(v);
  return { v, m, h, n, refractory: 0 };
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

// One integration step. `iSyn` is injected synaptic current (µA/cm² scale).
export function stepMembrane(
  s: MembraneState,
  dt: number,
  p: MembraneParams,
  iSyn = 0,
): MembraneState {
  const steps = 8;
  const h = dt / steps;
  let state = s;

  for (let i = 0; i < steps; i++) {
    if (state.refractory > 0) {
      state = {
        ...state,
        refractory: Math.max(0, state.refractory - h * 1000),
        v: state.v + (REST - state.v) * (1 - Math.exp(-h * 8)),
      };
      continue;
    }

    const { v, m, h: hg, n } = state;
    const iNa = p.gNa * m * m * m * hg * (v - p.eNa);
    const iK = p.gK * n * n * n * n * (v - p.eK);
    const iLeak = p.gLeak * (v - p.eLeak);
    const dv = (-(iNa + iK + iLeak) + iSyn) / p.cm;

    const dm = alphaM(v) * (1 - m) - betaM(v) * m;
    const dh = alphaH(v) * (1 - hg) - betaH(v) * hg;
    const dn = alphaN(v) * (1 - n) - betaN(v) * n;

    let nv = v + dv * h * 100; // scale dt for visible dynamics
    let fired = false;
    if (nv >= THRESH && v < THRESH) {
      nv = PEAK;
      fired = true;
    }

    state = {
      v: Math.max(-95, Math.min(PEAK, nv)),
      m: clamp01(m + dm * h * 100),
      h: clamp01(hg + dh * h * 100),
      n: clamp01(n + dn * h * 100),
      refractory: fired ? REFRACTORY_MS : 0,
    };
  }

  return state;
}

// Leaky integrate-and-fire for network demos (faster, cheaper).
export interface LIFNeuron {
  v: number;
  refractory: number;
}

export function stepLIF(
  n: LIFNeuron,
  dt: number,
  input: number,
  tau = 12,
): { state: LIFNeuron; fired: boolean } {
  if (n.refractory > 0) {
    return {
      state: { v: REST, refractory: Math.max(0, n.refractory - dt * 1000) },
      fired: false,
    };
  }
  const dv = (-(n.v - REST) + input) / tau;
  let v = n.v + dv * dt * 1000;
  if (v >= THRESH) {
    return { state: { v: REST, refractory: REFRACTORY_MS }, fired: true };
  }
  return { state: { v, refractory: 0 }, fired: false };
}
