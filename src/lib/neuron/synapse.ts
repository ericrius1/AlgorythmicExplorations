// Chemical synapse model: vesicle release, neurotransmitter diffusion, postsynaptic conductance.

export interface SynapseState {
  vesicles: number; // ready pool (0–1)
  transmitter: number; // cleft concentration (0–1)
  conductance: number; // postsynaptic g (0–1)
}

export interface SynapseParams {
  releaseProb: number;
  tauTransmitter: number; // ms decay in cleft
  tauConductance: number; // ms postsynaptic current decay
  weight: number; // connection strength (can be negative for inhibition)
}

export const DEFAULT_SYNAPSE: SynapseParams = {
  releaseProb: 0.35,
  tauTransmitter: 1.2,
  tauConductance: 4,
  weight: 1,
};

export function restingSynapse(): SynapseState {
  return { vesicles: 1, transmitter: 0, conductance: 0 };
}

// Call when a presynaptic spike arrives at the terminal.
export function triggerRelease(s: SynapseState, p: SynapseParams): SynapseState {
  const released = s.vesicles * p.releaseProb;
  return {
    vesicles: Math.max(0.15, s.vesicles - released * 0.4),
    transmitter: Math.min(1, s.transmitter + released),
    conductance: s.conductance,
  };
}

export function stepSynapse(s: SynapseState, dt: number, p: SynapseParams): SynapseState {
  // Match membrane demo time scale (dt × 100 ≈ 0.8 ms per frame at 120 fps).
  const tMs = dt * 100;
  const tDecay = Math.exp(-tMs / p.tauTransmitter);
  const gDecay = Math.exp(-tMs / p.tauConductance);
  const binding = s.transmitter * 0.6 * Math.abs(p.weight);
  const transmitter = s.transmitter * tDecay;
  const conductance = s.conductance * gDecay + binding;
  const vesicles = Math.min(1, s.vesicles + dt * 0.08);
  return { vesicles, transmitter, conductance };
}

// Postsynaptic current from open channels (positive = depolarizing EPSP).
export function synapticCurrent(g: number, p: SynapseParams, eRev = 0): number {
  return g * p.weight * (eRev - (-70)) * 0.55;
}
