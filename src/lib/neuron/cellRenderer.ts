// Draws a cable-model cell as particles: membrane that glows with its own
// voltage, myelin, spines, Na⁺ pouring in and K⁺ pouring out wherever
// channels are open, axial current streaming along the branches, and
// short-lived events (transmitter landing on a spine, release from a
// bouton). Any Morphology works — a whole neuron or a pair of bare axons.
//
// The particles are baked once; each frame only the per-compartment state
// (voltage, currents, a flow phase) and the event ring are uploaded.

import type { Cable } from "./cable";
import { Kind, rng, type Morphology } from "./morphology";
import { normalize, raySegment, type NeuronStage, type V3 } from "./stage";

const SHADER = /* wgsl */ `
struct Seg { a: vec4f, b: vec4f, c: vec4f } // (p0, radius) (p1, parent) (kind, …)
@group(0) @binding(1) var<storage, read> segs: array<Seg>;
@group(0) @binding(2) var<storage, read> st: array<vec4f>; // [2i] = (V, INa, IK, Iaxial), [2i+1] = (flow phase, …)
@group(0) @binding(3) var<storage, read> pa: array<vec4f>;
@group(0) @binding(4) var<storage, read> pb: array<vec4f>;
@group(0) @binding(5) var<storage, read> ev: array<vec4f>;

fn basis(d: vec3f) -> mat2x3f {
  let a = select(vec3f(0.0, 0.0, 1.0), vec3f(1.0, 0.0, 0.0), abs(d.z) > 0.9);
  let n1 = normalize(cross(d, a));
  return mat2x3f(n1, cross(d, n1));
}

// state at fraction t along compartment i, blended toward its parent
fn stateAt(i: u32, t: f32) -> vec4f {
  let s = st[i * 2u];
  let p = i32(segs[i].b.w);
  if (p < 0) { return s; }
  return mix(st[u32(p) * 2u], s, clamp(t + 0.5, 0.0, 1.0));
}

fn naGlow(i: f32) -> f32 { return pow(1.0 - exp(-max(0.0, i - 20.0) / 250.0), 1.5); }

@vertex
fn vsMembrane(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  let a = pa[ii];
  let b = pb[ii];
  let s = stateAt(u32(b.x), b.y);
  var col: vec3f;
  var r = 0.0034;
  if (b.z > 0.5 && b.z < 1.5) {
    // myelin: pale insulation, lit faintly by the axon inside it
    col = vec3f(0.42, 0.5, 0.75) * 0.11 + voltageColor(s.x) * 0.035;
    r = 0.004;
  } else {
    col = voltageColor(s.x) * cam.q.x + vec3f(1.0, 0.85, 0.6) * naGlow(s.y) * 3.0;
  }
  let tw = 0.75 + 0.25 * sin(cam.p.x * (1.0 + b.w * 2.0) + b.w * 40.0);
  return sprite(a.xyz, r, vi, col * a.w * tw);
}

@vertex
fn vsFlow(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  let f = pa[ii]; // (comp, t0, angle, radial)
  let c = u32(f.x);
  let ia = st[c * 2u].w;
  let mag = clamp(log(1.0 + abs(ia) / 8.0) / 5.3, 0.0, 1.0);
  if (mag < 0.06 || cam.q.y < 0.5) { return hidden(); }
  let seg = segs[c];
  let d = seg.b.xyz - seg.a.xyz;
  let B = basis(normalize(d));
  let t = fract(f.y + st[c * 2u + 1u].x);
  let off = (B[0] * cos(f.z) + B[1] * sin(f.z)) * seg.a.w * f.w * 0.75;
  let head = seg.a.xyz + d * t + off;
  let tail = head - d * sign(ia) * (0.25 + 0.5 * mag);
  let fade = smoothstep(0.0, 0.15, t) * smoothstep(1.0, 0.85, t);
  return streak(tail, head, 0.0022, vi, vec3f(0.45, 0.8, 1.0) * mag * mag * 1.3 * fade);
}

@vertex
fn vsIon(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  let p = pa[ii]; // (comp, t, angle, seed)
  let c = u32(p.x);
  let s = st[c * 2u];
  let isNa = (ii & 1u) == 0u;
  let cur = select(s.z, s.y, isNa);
  let level = 1.0 - exp(-max(0.0, cur - 8.0) / 220.0);
  if (level < 0.02) { return hidden(); }
  let life = fract(cam.p.x * 0.9 + p.w);
  let seg = segs[c];
  let d = seg.b.xyz - seg.a.xyz;
  let B = basis(normalize(d));
  let radial = B[0] * cos(p.z) + B[1] * sin(p.z);
  let r = seg.a.w;
  // Na⁺ falls inward through the membrane, K⁺ climbs out
  let out0 = r + 0.05 + r * 1.5;
  let r1 = select(mix(r * 0.3, out0, life), mix(out0, r * 0.3, life), isNa);
  let r0 = select(mix(r * 0.3, out0, life - 0.12), mix(out0, r * 0.3, life - 0.12), isNa);
  let base = seg.a.xyz + d * p.y;
  let env = sin(3.14159 * life);
  let col = select(vec3f(0.15, 0.75, 1.0), vec3f(1.0, 0.55, 0.12), isNa) * level * env * 1.4;
  return streak(base + radial * r0, base + radial * r1, 0.0024, vi, col);
}

@vertex
fn vsEvent(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  let e = ii / 40u;
  let k = ii % 40u;
  let e0 = ev[e * 2u];
  let e1 = ev[e * 2u + 1u];
  let age = cam.p.x - e0.w;
  if (age < 0.0 || age > 1.6) { return hidden(); }
  let h = hash3(e * 977u + k * 131u + u32(e0.w * 60.0));
  let dir = normalize(h * 2.0 - 1.0);
  if (e1.w < 1.5) {
    // transmitter converging onto a spine: green for glutamate, magenta for GABA
    let land = smoothstep(0.0, 0.45, age);
    let p0 = e0.xyz + (dir * 0.07 + e1.xyz * 0.06) * (1.0 - land);
    let p1 = e0.xyz + (dir * 0.07 + e1.xyz * 0.06) * (1.0 - smoothstep(0.0, 0.45, age - 0.05));
    let col = select(vec3f(0.55, 1.0, 0.3), vec3f(1.0, 0.3, 0.75), e1.w > 0.5);
    let flash = exp(-max(0.0, age - 0.45) * 5.0);
    return streak(p1, p0, 0.003, vi, col * flash * 1.6);
  }
  // release from a bouton: a spray of vesicle contents
  let sp = pow(smoothstep(0.0, 1.6, age), 0.45);
  let p = e0.xyz + (e1.xyz * 0.8 + dir * 0.7) * sp * 0.22;
  let col = vec3f(0.6, 1.0, 0.4) * exp(-age * 2.2) * 0.9;
  return sprite(p, 0.0035, vi, col);
}

@vertex
fn vsDust(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  let h = hash3(ii * 3u + 17u);
  var p = (h * 2.0 - 1.0) * vec3f(3.2, 2.2, 1.6);
  p += 0.05 * sin(cam.p.x * 0.15 * (0.5 + h.yzx) + h.zxy * 6.28);
  let g = hash11(ii * 7u + 3u);
  let b = 0.02 + 0.5 * pow(g, 12.0);
  return sprite(p, 0.0045, vi, mix(vec3f(0.3, 0.38, 1.0), vec3f(0.7, 0.5, 1.0), h.x) * b * 0.35);
}
`;

export const EVENTS = 128;
const EVENT_PARTS = 40;

export interface Spine {
  comp: number;
  head: V3;
  normal: V3;
}

interface Particles {
  memA: Float32Array;
  memB: Float32Array;
  flow: Float32Array;
  ions: Float32Array;
  spines: Spine[];
}

export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

function frameOf(d: V3): [V3, V3] {
  const a: V3 = Math.abs(d[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
  const n1 = normalize([d[1] * a[2] - d[2] * a[1], d[2] * a[0] - d[0] * a[2], d[0] * a[1] - d[1] * a[0]]);
  const n2: V3 = [d[1] * n1[2] - d[2] * n1[1], d[2] * n1[0] - d[0] * n1[2], d[0] * n1[1] - d[1] * n1[0]];
  return [n1, n2];
}

// Bake the membrane, myelin and spine particles, and the per-compartment
// flow and ion particles. Positions are fixed; the GPU only lights them.
function buildParticles(m: Morphology, budget: number, seed: number, spinesOn: boolean): Particles {
  const rand = rng(seed);
  const memA: number[] = [];
  const memB: number[] = [];
  const push = (p: V3, inten: number, comp: number, t: number, flag: number): void => {
    memA.push(p[0], p[1], p[2], inten);
    memB.push(comp, t, flag, rand());
  };
  const P = (i: number, k: 0 | 1): V3 => {
    const a = k === 0 ? m.p0 : m.p1;
    return [a[i * 3], a[i * 3 + 1], a[i * 3 + 2]];
  };

  // weights: membrane by length (thicker counts more), spheres by area
  let wsum = 0;
  const w = new Float32Array(m.n);
  for (let i = 0; i < m.n; i++) {
    const k = m.kind[i];
    const r = m.radius[i];
    const L = Math.hypot(...sub(P(i, 1), P(i, 0)));
    if (k === Kind.Soma) w[i] = 9;
    else if (k === Kind.Bouton) w[i] = 0.12;
    else w[i] = L * (0.6 + r / 0.012) * (k === Kind.Internode ? 0.5 : 1);
    wsum += w[i];
  }
  const memBudget = budget * 0.62;
  const sheathBudget = m.sheathRadius > 0 ? budget * 0.1 : 0;
  let sheathLen = 0;
  for (let i = 0; i < m.n; i++) if (m.kind[i] === Kind.Internode) sheathLen += Math.hypot(...sub(P(i, 1), P(i, 0)));

  for (let i = 0; i < m.n; i++) {
    const k = m.kind[i];
    const r = m.radius[i];
    const count = Math.max(4, Math.round((w[i] / wsum) * memBudget));
    if (k === Kind.Soma || k === Kind.Bouton) {
      const c = k === Kind.Soma ? P(i, 0) : P(i, 1);
      for (let j = 0; j < count; j++) {
        const z = rand() * 2 - 1;
        const a = rand() * Math.PI * 2;
        const s = Math.sqrt(1 - z * z);
        let d: V3 = [s * Math.cos(a), s * Math.sin(a), z];
        let rr = r * (0.97 + rand() * 0.06);
        if (k === Kind.Soma && d[0] < 0) {
          // pyramidal soma: drawn out toward the apical dendrite
          rr *= 1 + 0.55 * Math.pow(-d[0], 3);
          d = [d[0], d[1] * (1 - 0.2 * -d[0]), d[2] * (1 - 0.2 * -d[0])];
        }
        push([c[0] + d[0] * rr, c[1] + d[1] * rr, c[2] + d[2] * rr], k === Kind.Soma ? 0.14 : 0.5, i, 0.5, 2);
      }
      continue;
    }
    const a = P(i, 0);
    const b = P(i, 1);
    const d = sub(b, a);
    const L = Math.hypot(...d) || 1e-6;
    const dn: V3 = [d[0] / L, d[1] / L, d[2] / L];
    const [n1, n2] = frameOf(dn);
    const inten = (k === Kind.Node ? 1.3 : 1) * Math.min(1.6, Math.max(0.55, 0.009 / r));
    for (let j = 0; j < count; j++) {
      const t = rand();
      const ang = rand() * Math.PI * 2;
      const rr = r * (0.96 + rand() * 0.08);
      const ca = Math.cos(ang) * rr;
      const sa = Math.sin(ang) * rr;
      push(
        [
          a[0] + d[0] * t + n1[0] * ca + n2[0] * sa,
          a[1] + d[1] * t + n1[1] * ca + n2[1] * sa,
          a[2] + d[2] * t + n1[2] * ca + n2[2] * sa,
        ],
        inten,
        i,
        t,
        0,
      );
    }
    if (k === Kind.Internode && sheathBudget > 0) {
      // the sheath tapers in at each node (the paranodal loops)
      const sc = Math.round((L / sheathLen) * sheathBudget);
      const pi = m.parent[i];
      const prevNode = pi < 0 || m.kind[pi] !== Kind.Internode;
      const ci = i + 1 < m.n && m.parent[i + 1] === i ? i + 1 : -1;
      const nextNode = ci < 0 || m.kind[ci] !== Kind.Internode;
      for (let j = 0; j < sc; j++) {
        const t = rand();
        const ang = rand() * Math.PI * 2;
        let taper = 1;
        if (prevNode) taper = Math.min(taper, 0.45 + 0.55 * Math.min(1, (t * L) / 0.02));
        if (nextNode) taper = Math.min(taper, 0.45 + 0.55 * Math.min(1, ((1 - t) * L) / 0.02));
        const rr = Math.max(r * 1.2, m.sheathRadius * taper * (0.9 + rand() * 0.12));
        const ca = Math.cos(ang) * rr;
        const sa = Math.sin(ang) * rr;
        push(
          [
            a[0] + d[0] * t + n1[0] * ca + n2[0] * sa,
            a[1] + d[1] * t + n1[1] * ca + n2[1] * sa,
            a[2] + d[2] * t + n1[2] * ca + n2[2] * sa,
          ],
          1,
          i,
          t,
          1,
        );
      }
    }
  }

  // dendritic spines: a thin neck and a bulbous head, where synapses land
  const spines: Spine[] = [];
  for (const i of spinesOn ? m.dendrites : []) {
    const r = m.radius[i];
    if (r > 0.02 || rand() > 0.75) continue;
    const a = P(i, 0);
    const d = sub(P(i, 1), a);
    const [n1, n2] = frameOf(normalize(d));
    const t = rand();
    const ang = rand() * Math.PI * 2;
    const nrm: V3 = normalize([
      n1[0] * Math.cos(ang) + n2[0] * Math.sin(ang),
      n1[1] * Math.cos(ang) + n2[1] * Math.sin(ang),
      n1[2] * Math.cos(ang) + n2[2] * Math.sin(ang),
    ]);
    const base: V3 = [a[0] + d[0] * t + nrm[0] * r, a[1] + d[1] * t + nrm[1] * r, a[2] + d[2] * t + nrm[2] * r];
    const len = 0.014 + rand() * 0.012;
    const head: V3 = [base[0] + nrm[0] * len, base[1] + nrm[1] * len, base[2] + nrm[2] * len];
    spines.push({ comp: i, head, normal: nrm });
    for (let j = 0; j < 5; j++) {
      const s = j / 5;
      push([base[0] + nrm[0] * len * s, base[1] + nrm[1] * len * s, base[2] + nrm[2] * len * s], 0.6, i, t, 0);
    }
    const hr = 0.0055;
    for (let j = 0; j < 14; j++) {
      const z = rand() * 2 - 1;
      const q = rand() * Math.PI * 2;
      const s = Math.sqrt(1 - z * z);
      push([head[0] + s * Math.cos(q) * hr, head[1] + s * Math.sin(q) * hr, head[2] + z * hr], 0.9, i, t, 0);
    }
  }

  // flow and ion particles, spread by compartment length
  const flow: number[] = [];
  const ions: number[] = [];
  const flowBudget = budget * 0.16;
  const ionBudget = budget * 0.12;
  let lsum = 0;
  const len = new Float32Array(m.n);
  for (let i = 0; i < m.n; i++) {
    const k = m.kind[i];
    len[i] =
      k === Kind.Soma || k === Kind.Bouton ? 0 : Math.hypot(...sub(P(i, 1), P(i, 0))) * (0.5 + m.radius[i] / 0.012);
    lsum += len[i];
  }
  for (let i = 0; i < m.n; i++) {
    if (len[i] === 0) continue;
    const nf = Math.round((len[i] / lsum) * flowBudget);
    for (let j = 0; j < nf; j++) flow.push(i, rand(), rand() * Math.PI * 2, Math.sqrt(rand()));
    // ions only where there are channels to pass through
    const k = m.kind[i];
    if (m.spec.gNa[i] === 0 && k !== Kind.Internode) continue;
    if (k === Kind.Internode) continue;
    const ni = Math.round((len[i] / lsum) * ionBudget * (k === Kind.Node ? 6 : k === Kind.AIS ? 2 : 1.4)) & ~1;
    for (let j = 0; j < ni; j++) ions.push(i, rand(), rand() * Math.PI * 2, rand());
  }
  return {
    memA: new Float32Array(memA),
    memB: new Float32Array(memB),
    flow: new Float32Array(flow),
    ions: new Float32Array(ions),
    spines,
  };
}

export interface CellRendererOptions {
  budget: number; // total particles to spend on the cell
  dust?: number;
  spines?: boolean;
  seed?: number;
}

export class CellRenderer {
  readonly morph: Morphology;
  readonly spines: Spine[];
  readonly count: number; // particles drawn per frame
  showFlow = true;
  private stage: NeuronStage;
  private device: GPUDevice;
  private n: number;
  private stateData: Float32Array<ArrayBuffer>;
  private stateBuf: GPUBuffer;
  private evData: Float32Array<ArrayBuffer>;
  private evBuf: GPUBuffer;
  private evHead = 0;
  private phase: Float32Array;
  private naNorm: Float32Array;
  private kNorm: Float32Array;
  private pipes: Record<string, GPURenderPipeline>;
  private gMem: GPUBindGroup;
  private gFlow: GPUBindGroup;
  private gIon: GPUBindGroup;
  private memCount: number;
  private flowCount: number;
  private ionCount: number;
  private dustCount: number;

  constructor(stage: NeuronStage, morph: Morphology, opts: CellRendererOptions) {
    this.stage = stage;
    this.device = stage.device;
    this.morph = morph;
    const n = (this.n = morph.n);
    const parts = buildParticles(morph, opts.budget, opts.seed ?? 11, opts.spines ?? true);
    this.spines = parts.spines;
    this.memCount = parts.memA.length / 4;
    this.flowCount = parts.flow.length / 4;
    this.ionCount = parts.ions.length / 4;
    this.dustCount = opts.dust ?? 0;
    this.count = this.memCount + this.flowCount + this.ionCount + this.dustCount + EVENTS * EVENT_PARTS;

    const segData = new Float32Array(n * 12);
    for (let i = 0; i < n; i++) {
      segData.set([morph.p0[i * 3], morph.p0[i * 3 + 1], morph.p0[i * 3 + 2], morph.radius[i]], i * 12);
      segData.set([morph.p1[i * 3], morph.p1[i * 3 + 1], morph.p1[i * 3 + 2], morph.parent[i]], i * 12 + 4);
      segData.set([morph.kind[i], 0, 0, 0], i * 12 + 8);
    }
    const segBuf = stage.storage(segData);
    this.stateData = new Float32Array(n * 8);
    this.stateBuf = stage.storage(this.stateData);
    const memABuf = stage.storage(parts.memA);
    const memBBuf = stage.storage(parts.memB);
    const flowBuf = stage.storage(parts.flow);
    const ionBuf = stage.storage(parts.ions);
    this.evData = new Float32Array(EVENTS * 8);
    for (let e = 0; e < EVENTS; e++) this.evData[e * 8 + 3] = -100;
    this.evBuf = stage.storage(this.evData);
    this.pipes = stage.pipelines(SHADER, ["vsMembrane", "vsFlow", "vsIon", "vsEvent", "vsDust"]);
    this.gMem = stage.group([segBuf, this.stateBuf, memABuf, memBBuf, this.evBuf]);
    this.gFlow = stage.group([segBuf, this.stateBuf, flowBuf, flowBuf, this.evBuf]);
    this.gIon = stage.group([segBuf, this.stateBuf, ionBuf, ionBuf, this.evBuf]);

    this.phase = new Float32Array(n);
    // currents are drawn per unit of channel density, so a node of Ranvier
    // and a soma at the same point of their spike look alike
    this.naNorm = new Float32Array(n);
    this.kNorm = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      this.naNorm[i] = morph.spec.gNa[i] > 0 ? 120 / morph.spec.gNa[i] : 0;
      this.kNorm[i] = morph.spec.gK[i] > 0 ? 36 / morph.spec.gK[i] : 0;
    }
  }

  // type 0: glutamate onto a spine, 1: GABA, 2: release from a bouton
  pushEvent(p: V3, nrm: V3, type: number): void {
    this.evData.set([p[0], p[1], p[2], this.stage.time, nrm[0], nrm[1], nrm[2], type], this.evHead * 8);
    this.evHead = (this.evHead + 1) % EVENTS;
  }

  point(i: number, end: 0 | 1 = 1): V3 {
    const a = end === 0 ? this.morph.p0 : this.morph.p1;
    return [a[i * 3], a[i * 3 + 1], a[i * 3 + 2]];
  }

  // The compartment under a screen point (or -1), within `reach` of its surface.
  pick(nx: number, ny: number, reach = 0.06): number {
    const { o, d } = this.stage.ray(nx, ny);
    let best = -1;
    let bestD = reach * reach;
    for (let i = 0; i < this.n; i++) {
      const hit = raySegment(o, d, this.point(i, 0), this.point(i, 1));
      const d2 = Math.max(0, Math.sqrt(hit.d2) - this.morph.radius[i]) ** 2;
      if (d2 < bestD) {
        bestD = d2;
        best = i;
      }
    }
    return best;
  }

  upload(cable: Cable): void {
    const wall = this.stage.wallDt;
    const s = this.stateData;
    for (let i = 0; i < this.n; i++) {
      const ia = cable.iAxial[i];
      this.phase[i] = (this.phase[i] + Math.sign(ia) * Math.min(2.6, Math.log(1 + Math.abs(ia) / 8) * 0.55) * wall) % 1;
      s[i * 8] = cable.v[i];
      s[i * 8 + 1] = cable.iNa[i] * this.naNorm[i];
      s[i * 8 + 2] = cable.iK[i] * this.kNorm[i];
      s[i * 8 + 3] = ia;
      s[i * 8 + 4] = this.phase[i];
    }
    this.device.queue.writeBuffer(this.stateBuf, 0, s);
    this.device.queue.writeBuffer(this.evBuf, 0, this.evData);
    this.stage.q = [1, this.showFlow ? 1 : 0, 0, 0];
  }

  draw(pass: GPURenderPassEncoder): void {
    const p = this.pipes;
    pass.setBindGroup(0, this.gMem);
    if (this.dustCount) {
      pass.setPipeline(p.vsDust);
      pass.draw(6, this.dustCount);
    }
    pass.setPipeline(p.vsMembrane);
    pass.draw(6, this.memCount);
    pass.setPipeline(p.vsEvent);
    pass.draw(6, EVENTS * EVENT_PARTS);
    pass.setPipeline(p.vsFlow);
    pass.setBindGroup(0, this.gFlow);
    pass.draw(6, this.flowCount);
    pass.setPipeline(p.vsIon);
    pass.setBindGroup(0, this.gIon);
    pass.draw(6, this.ionCount);
  }
}
