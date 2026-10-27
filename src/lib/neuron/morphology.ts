// Procedural neuron shapes, built as trees of short cylinders. Every
// cylinder is one compartment of the cable model in cable.ts, and its kind
// decides which channels it carries: passive dendrites, an excitable soma,
// a Na⁺-dense initial segment where spikes start, myelin with bare nodes of
// Ranvier between, and terminal boutons.

import { E_L, V_REST, type CableSpec } from "./cable";

export const Kind = {
  Soma: 0,
  Basal: 1,
  Apical: 2,
  Hillock: 3,
  AIS: 4,
  Internode: 5,
  Node: 6,
  Axon: 7,
  Bouton: 8,
} as const;
export type Kind = (typeof Kind)[keyof typeof Kind];

export interface Morphology {
  n: number;
  p0: Float32Array; // proximal end (xyz per compartment)
  p1: Float32Array; // distal end
  radius: Float32Array;
  kind: Uint8Array;
  parent: Int32Array;
  spec: CableSpec;
  boutons: number[];
  dendrites: number[]; // every Basal/Apical compartment, for synaptic input
  sheathRadius: number; // outer radius of the myelin, for drawing
}

type V3 = [number, number, number];

export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

// Electrical character of each kind: [cm, gNa, gK, gL, axial scale].
// Leak reversal is E_L for HH membrane and the resting potential for
// purely passive membrane, so the whole cell rests at one voltage.
const CHANNELS: Record<Kind, [number, number, number, number, number]> = {
  [Kind.Soma]: [1, 120, 36, 0.3, 1],
  [Kind.Basal]: [1, 0, 0, 0.3, 0.16],
  [Kind.Apical]: [1, 12, 4, 0.3, 0.16],
  [Kind.Hillock]: [1, 160, 40, 0.3, 1],
  [Kind.AIS]: [1, 700, 120, 0.3, 1],
  [Kind.Internode]: [0.03, 0, 0, 0.006, 1],
  [Kind.Node]: [1, 1600, 300, 2, 1],
  [Kind.Axon]: [1, 160, 40, 0.3, 1],
  [Kind.Bouton]: [1, 160, 40, 0.3, 1],
};

export class MorphBuilder {
  p0: number[] = [];
  p1: number[] = [];
  radius: number[] = [];
  kind: Kind[] = [];
  parent: number[] = [];
  // axial conductance per unit (radius² / length)
  kAxial = 50;

  add(parent: number, a: V3, b: V3, r: number, kind: Kind): number {
    this.p0.push(...a);
    this.p1.push(...b);
    this.radius.push(r);
    this.kind.push(kind);
    this.parent.push(parent);
    return this.kind.length - 1;
  }

  end(i: number): V3 {
    return [this.p1[i * 3], this.p1[i * 3 + 1], this.p1[i * 3 + 2]];
  }

  // A persistent random walk: `steps` compartments of length `len`, each
  // turning a little from the last, tapering from r0 to r1.
  walk(
    rand: () => number,
    parent: number,
    from: V3,
    dir: V3,
    steps: number,
    len: number,
    r0: number,
    r1: number,
    kind: Kind,
    wiggle = 0.35,
  ): { last: number; dir: V3; end: V3 } {
    let p = from;
    let d = norm(dir);
    let last = parent;
    for (let s = 0; s < steps; s++) {
      d = norm(add(d, [(rand() - 0.5) * wiggle, (rand() - 0.5) * wiggle, (rand() - 0.5) * wiggle]));
      const q = add(p, scale(d, len));
      const r = r0 + (r1 - r0) * (s / Math.max(1, steps - 1));
      last = this.add(last, p, q, r, kind);
      p = q;
    }
    return { last, dir: d, end: p };
  }

  build(sheathRadius = 0): Morphology {
    const n = this.kind.length;
    const p0 = new Float32Array(this.p0);
    const p1 = new Float32Array(this.p1);
    const radius = new Float32Array(this.radius);
    const kind = new Uint8Array(this.kind);
    const parent = new Int32Array(this.parent);
    const area = new Float32Array(n);
    const gAxial = new Float32Array(n);
    const cm = new Float32Array(n);
    const gNa = new Float32Array(n);
    const gK = new Float32Array(n);
    const gL = new Float32Array(n);
    const eL = new Float32Array(n);
    const boutons: number[] = [];
    const dendrites: number[] = [];
    for (let i = 0; i < n; i++) {
      const L = Math.max(
        1e-3,
        Math.hypot(p1[i * 3] - p0[i * 3], p1[i * 3 + 1] - p0[i * 3 + 1], p1[i * 3 + 2] - p0[i * 3 + 2]),
      );
      const r = radius[i];
      const k = kind[i] as Kind;
      area[i] = k === Kind.Soma || k === Kind.Bouton ? 4 * Math.PI * r * r : 2 * Math.PI * r * L;
      const [c, na, kk, l, ax] = CHANNELS[k];
      cm[i] = c;
      gNa[i] = na;
      gK[i] = kk;
      gL[i] = l;
      eL[i] = na > 0 ? E_L : V_REST;
      if (parent[i] >= 0) {
        const len = k === Kind.Bouton ? r : L;
        gAxial[i] = (this.kAxial * ax * Math.PI * r * r) / len;
      }
      if (k === Kind.Bouton) boutons.push(i);
      if (k === Kind.Basal || k === Kind.Apical) dendrites.push(i);
    }
    return {
      n,
      p0,
      p1,
      radius,
      kind,
      parent,
      spec: { parent, area, gAxial, cm, gNa, gK, gL, eL },
      boutons,
      dendrites,
      sheathRadius,
    };
  }
}

// A layer-5 pyramidal cell lying along +x: apical dendrite and tuft to the
// left, basal skirt around the soma, and a myelinated axon running right
// into a terminal arbor of boutons.
export function pyramidalNeuron(seed = 7): Morphology {
  const rand = rng(seed);
  const b = new MorphBuilder();
  const somaC: V3 = [-0.42, 0, 0.04];
  const somaR = 0.075;
  const soma = b.add(-1, somaC, somaC, somaR, Kind.Soma);
  const DL = 0.032; // dendritic compartment length

  // apical trunk with obliques, ending in a tuft
  const trunkDir: V3 = [-1, 0, 0.12];
  let trunkParent = soma;
  let p: V3 = add(somaC, scale(norm(trunkDir), somaR * 0.9));
  let d: V3 = norm(trunkDir);
  const trunkSteps = 26;
  for (let s = 0; s < trunkSteps; s++) {
    const seg = b.walk(rand, trunkParent, p, d, 1, DL, 0.03 - (s / trunkSteps) * 0.014, 0, Kind.Apical, 0.12);
    trunkParent = seg.last;
    p = seg.end;
    d = seg.dir;
    if (s > 3 && s % 4 === 0) {
      const side = s % 8 === 0 ? 1 : -1;
      const a = rand() * Math.PI * 2;
      const od = norm([-0.35, Math.cos(a) * 0.9 * side, Math.sin(a) * 0.9]);
      const ob = b.walk(rand, trunkParent, p, od, 7 + Math.floor(rand() * 5), DL, 0.011, 0.006, Kind.Apical);
      if (rand() < 0.6)
        b.walk(
          rand,
          ob.last,
          ob.end,
          add(ob.dir, [0, (rand() - 0.5) * 1.2, (rand() - 0.5) * 1.2]),
          5,
          DL,
          0.006,
          0.004,
          Kind.Apical,
        );
    }
  }
  // tuft: three generations of forks
  const tuft = (parent: number, from: V3, dir: V3, gen: number, r: number): void => {
    const steps = gen === 0 ? 8 : 5 + Math.floor(rand() * 5);
    const w = b.walk(rand, parent, from, dir, steps, DL, r, r * 0.75, Kind.Apical, 0.4);
    if (gen >= 2) return;
    for (let c = 0; c < 2; c++) {
      const a = rand() * Math.PI * 2;
      const spread = 0.9;
      tuft(w.last, w.end, norm(add(w.dir, [0, Math.cos(a) * spread, Math.sin(a) * spread])), gen + 1, r * 0.75);
    }
  };
  for (let c = 0; c < 3; c++) {
    const a = (c / 3) * Math.PI * 2 + rand();
    tuft(trunkParent, p, norm(add(d, [0, Math.cos(a) * 0.7, Math.sin(a) * 0.7])), 0, 0.012);
  }

  // basal dendrites: a skirt around the soma, avoiding the axon's direction
  const basalCount = 7;
  for (let c = 0; c < basalCount; c++) {
    const a = (c / basalCount) * Math.PI * 2 + rand() * 0.5;
    const dir = norm([0.25 + rand() * 0.35, Math.cos(a), Math.sin(a)]);
    const from = add(somaC, scale(dir, somaR * 0.9));
    const w = b.walk(rand, soma, from, dir, 6 + Math.floor(rand() * 4), DL, 0.013, 0.009, Kind.Basal, 0.3);
    for (let f = 0; f < 2; f++) {
      const t = rand() * Math.PI * 2;
      const w2 = b.walk(
        rand,
        w.last,
        w.end,
        norm(add(w.dir, [0, Math.cos(t) * 0.8, Math.sin(t) * 0.8])),
        5 + Math.floor(rand() * 5),
        DL,
        0.008,
        0.005,
        Kind.Basal,
      );
      if (rand() < 0.5)
        b.walk(
          rand,
          w2.last,
          w2.end,
          norm(add(w2.dir, [0, (rand() - 0.5) * 1.4, (rand() - 0.5) * 1.4])),
          4,
          DL,
          0.005,
          0.004,
          Kind.Basal,
        );
    }
  }

  // axon: hillock, initial segment, then myelin and nodes
  const axonR = 0.011;
  let ap: V3 = add(somaC, [somaR * 0.95, 0, -0.01]);
  let ad: V3 = [1, 0, -0.04];
  let last = soma;
  let w = b.walk(rand, last, ap, ad, 2, 0.02, 0.026, 0.016, Kind.Hillock, 0.02);
  w = b.walk(rand, w.last, w.end, w.dir, 4, 0.025, 0.013, axonR, Kind.AIS, 0.02);
  last = w.last;
  ap = w.end;
  ad = w.dir;
  const internodes = 7;
  for (let k = 0; k < internodes; k++) {
    // gentle meander, steered back toward +x
    ad = norm(add(ad, [0.12, (rand() - 0.5) * 0.3, (rand() - 0.5) * 0.3 - ap[2] * 0.4]));
    w = b.walk(rand, last, ap, ad, 6, 0.036, axonR, axonR, Kind.Internode, 0.05);
    w = b.walk(rand, w.last, w.end, w.dir, 1, 0.012, axonR * 0.8, axonR * 0.8, Kind.Node, 0);
    last = w.last;
    ap = w.end;
    ad = w.dir;
  }

  // terminal arbor: unmyelinated branches ending in boutons
  const arbor = (parent: number, from: V3, dir: V3, gen: number): void => {
    const steps = gen === 0 ? 5 : 4 + Math.floor(rand() * 4);
    const r = gen === 0 ? 0.008 : 0.0055;
    const a = b.walk(rand, parent, from, dir, steps, 0.032, r, r * 0.85, Kind.Axon, 0.45);
    if (gen >= 3) {
      const bd = a.dir;
      const br = 0.02;
      const c = add(a.end, scale(bd, br));
      b.add(a.last, a.end, c, br, Kind.Bouton);
      return;
    }
    const kids = gen === 0 ? 3 : 2;
    for (let c = 0; c < kids; c++) {
      const t = (c / kids) * Math.PI * 2 + rand();
      arbor(a.last, a.end, norm(add(a.dir, [0, Math.cos(t) * 0.9, Math.sin(t) * 0.9])), gen + 1);
    }
  };
  arbor(last, ap, ad, 0);

  return b.build(0.03);
}

// Two straight axons along x, one bare and one wrapped in myelin with
// nodes every `internode` units, built into one forest so a single Cable
// solves both. Returns the morphology and the first compartment of each.
export function axonPair(opts: {
  x0: number;
  x1: number;
  gap: number;
  radius: number;
  internode?: number;
  seg?: number;
}): {
  morph: Morphology;
  bare: [number, number];
  myelinated: [number, number];
} {
  const b = new MorphBuilder();
  const seg = opts.seg ?? 0.02;
  const r = opts.radius;
  const internode = opts.internode ?? 0.36;
  const nodeLen = 0.012;
  const lay = (z: number, myelin: boolean): [number, number] => {
    let last = -1;
    let first = -1;
    let x = opts.x0;
    let sinceNode = internode;
    while (x < opts.x1 - 1e-6) {
      let kind: Kind = Kind.Axon;
      let len = seg;
      if (myelin) {
        if (sinceNode >= internode - 1e-6) {
          kind = Kind.Node;
          len = nodeLen;
          sinceNode = 0;
        } else {
          kind = Kind.Internode;
          len = Math.min(seg, internode - sinceNode);
          sinceNode += len;
        }
      }
      len = Math.min(len, opts.x1 - x);
      last = b.add(last, [x, 0, z], [x + len, 0, z], kind === Kind.Node ? r * 0.85 : r, kind);
      if (first < 0) first = last;
      x += len;
    }
    return [first, last];
  };
  const bare = lay(opts.gap / 2, false);
  const myelinated = lay(-opts.gap / 2, true);
  return { morph: b.build(r * 2.4), bare, myelinated };
}
