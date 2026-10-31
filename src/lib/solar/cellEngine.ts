// A solar cell in cross-section, photon by photon, on the GPU: the engine
// behind the Solar Stack hero and Steps 1, 2 and 6.
//
// Each particle slot lives one photon's story at a time. The photon's energy
// is drawn from the sun's spectrum; on the way in it meets each layer in turn
// and stops at a depth drawn from that layer's absorption coefficient
// (Beer–Lambert: d = −ln(u)/α), or passes through all of them. Where it stops
// it frees an electron (cyan, drifting up to its contact) and a hole (pink,
// drifting down); whatever energy it had above the gap is thrown off as heat,
// the orange burst. A pair that reaches both contacts is current; one that
// recombines on the way glows and is lost. In series (two terminals) the two
// cells meet at a junction where each top-cell hole must find a bottom-cell
// electron: the cell with spare current has carriers that find no partner,
// pile up there and recombine.
//
// Nothing here knows the answer. The CPU only reads the tallies back (counts
// of photons, absorptions, collections, recombinations, heat, and a spectrum
// histogram of each fate) and turns them into currents.

import { E_MAX, E_MIN, jph } from "../../demos/solar/physics";
import { Readback, shaderModule, type NeuronStage } from "../neuron/stage";
import { ALPHA_BINS, ENERGY_TABLE, SOLAR_WGSL, alphaTable, energyTable, type Material } from "./lab";

export interface LayerSpec {
  material: Material;
  gap: number;
  /** physical thickness, nm */
  thickNm: number;
  /** display depth of its top and bottom (z is up; the cell's top face is at 0) */
  z0: number;
  z1: number;
  /** depth drawn on a log scale (for the silicon wafer, 300× thicker than the film above it) */
  log?: boolean;
  /** light trapping: how many times the light's path crosses the layer (texture and a rear mirror send it back and
   *  forth; a photon that goes deeper than the layer is drawn turned back at its rear) */
  trap?: number;
  /** chance per second (display time) that a pair recombines on its way out */
  recomb: number;
  /** lattice colour */
  color: [number, number, number];
}

export interface EngineOptions {
  count: number;
  halfX: number;
  halfY: number;
  layers: LayerSpec[];
  /** two terminals: the cells meet at a junction and must carry one current */
  series?: boolean;
  /** how high above the cell photons start, and how fast they fall (display units, per second) */
  spawnTop?: number;
  fall?: number;
  /** carriers' drift speed and jitter */
  drift?: number;
  jitter?: number;
  /** lattice dots per layer */
  lattice?: number;
  /** photon and carrier brightness */
  bright?: number;
  carriers?: number;
}

export const HIST_BINS = 64;
// counter layout (u32): see the shader
const C_PHOT = 0;
const C_PASS = 1;
const C_ABS = 2;
const C_COL = 4;
const C_REC = 6;
const C_HEAT = 8;
const C_PARK = 10;
const C_PASSE = 12;
const C_HIST = 16;
const COUNTERS = C_HIST + HIST_BINS * 3;

/** what the particles did, summed since the last reset */
export interface Tally {
  photons: number;
  passed: number;
  /** energy carried through by the photons that passed, eV */
  passedEnergy: number;
  absorbed: number[];
  collected: number[];
  recombined: number[];
  parked: number[];
  /** heat thrown off, eV, per layer */
  heat: number[];
  /** per energy bin: photons that passed, were absorbed in layer 0, in layer 1 */
  hist: number[][];
}

const COMPUTE = /* wgsl */ `
struct Layer { z: vec4f, k: vec4f } // z: (top, bottom, gap eV, thickness cm); k: (log?, light-trapping path multiple, recomb /s, surplus 0..1)
struct Params {
  dt: f32,
  time: f32,
  count: u32,
  nl: u32,
  box: vec4f,   // half x, half y, spawn top, fall speed
  car: vec4f,   // drift, jitter, longest wait before respawning, slant
  l: array<Layer, 2>,
  seed: u32,
  series: u32,
  pad0: u32,
  pad1: u32,
}
struct Particle { a: vec4f, b: vec4f, c: vec4f, d: vec4f }
// a: photon xyz, energy · b: electron xyz, state · c: hole xyz, time in state · d: stop z, layer, flags, generation
// states: 0 photon on its way, 1 carriers moving, 3 waiting to respawn, 4 recombining
// flags: 1 electron out, 2 hole out, 4 collected (a glint at the contacts), 8 parked at the junction

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read_write> parts: array<Particle>;
@group(0) @binding(2) var<storage, read> etab: array<f32>;
@group(0) @binding(3) var<storage, read> alpha: array<f32>;
@group(0) @binding(4) var<storage, read_write> cnt: array<atomic<u32>>;

const ABINS: f32 = ${ALPHA_BINS}.0;

fn alphaAt(layer: u32, e: f32) -> f32 {
  let i = u32(clamp((e - E_MIN) / (E_MAX - E_MIN) * (ABINS - 1.0) + 0.5, 0.0, ABINS - 1.0));
  return alpha[layer * ${ALPHA_BINS}u + i];
}

// depth along the light's path → drawn depth: folded back at the rear (light trapping), then on the layer's scale
// (linear, or log from 1 µm for the wafer)
fn depthToZ(layer: u32, d: f32) -> f32 {
  let L = P.l[layer];
  let T = L.z.w;
  let m = d - floor(d / (2.0 * T)) * 2.0 * T;
  let df = select(2.0 * T - m, m, m < T);
  var f = df / T;
  if (L.k.x > 0.5) { f = log(1.0 + df / 1e-4) / log(1.0 + T / 1e-4); }
  return mix(L.z.x, L.z.y, clamp(f, 0.0, 1.0));
}

fn histBin(e: f32) -> u32 {
  return u32(clamp((e - E_MIN) / (E_MAX - E_MIN) * ${HIST_BINS}.0, 0.0, ${HIST_BINS - 1}.0));
}

fn spawn(i: u32, gen: u32) -> Particle {
  var p: Particle;
  let e = etab[min(u32(rnd(i, gen, 11u) * ${ENERGY_TABLE}.0), ${ENERGY_TABLE - 1}u)];
  let x = (rnd(i, gen, 12u) * 2.0 - 1.0) * P.box.x;
  let y = (rnd(i, gen, 13u) * 2.0 - 1.0) * P.box.y;
  let z = 0.02 + rnd(i, gen, 14u) * P.box.z;
  // its fate, decided now: the first layer whose drawn depth falls inside it
  var stop = -1e3;
  var layer = -1.0;
  for (var k = 0u; k < P.nl; k++) {
    let a = alphaAt(k, e);
    if (a <= 0.0) { continue; }
    let d = -log(max(rnd(i, gen, 20u + k), 1e-9)) / a;
    if (d < P.l[k].z.w * P.l[k].k.y) { stop = depthToZ(k, d); layer = f32(k); break; }
  }
  p.a = vec4f(x - P.car.w * z, y, z, e);
  p.b = vec4f(p.a.xyz, 0.0);
  p.c = vec4f(p.a.xyz, 0.0);
  p.d = vec4f(stop, layer, 0.0, f32(gen));
  atomicAdd(&cnt[${C_PHOT}u], 1u);
  return p;
}

@compute @workgroup_size(256)
fn step(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= P.count) { return; }
  var p = parts[i];
  let dt = P.dt;
  var state = u32(p.b.w + 0.5);
  let gen = u32(p.d.w);
  p.c.w += dt;
  let t = p.c.w;
  let bottom = P.l[P.nl - 1u].z.y;

  if (state == 0u) {
    // the photon falls (slanting a little, as the sun is off to one side)
    p.a.z -= P.box.w * dt;
    p.a.x += P.car.w * P.box.w * dt;
    let layer = i32(p.d.y);
    // its fate is tallied as it enters the cell (every photon is counted at the same point of its fall, so the
    // tallies of the ones stopped near the top and the ones that fall all the way through never drift apart)
    if (p.d.z < 0.5 && p.a.z <= 0.0) {
      p.d.z = 1.0;
      if (layer >= 0) {
        let L = P.l[u32(layer)];
        atomicAdd(&cnt[${C_ABS}u + u32(layer)], 1u);
        atomicAdd(&cnt[${C_HEAT}u + u32(layer)], u32(max(0.0, p.a.w - L.z.z) * 1000.0));
        atomicAdd(&cnt[${C_HIST}u + histBin(p.a.w) * 3u + 1u + u32(layer)], 1u);
      } else {
        atomicAdd(&cnt[${C_PASS}u], 1u);
        atomicAdd(&cnt[${C_PASSE}u], u32(p.a.w * 1000.0));
        atomicAdd(&cnt[${C_HIST}u + histBin(p.a.w) * 3u], 1u);
      }
    }
    if (layer >= 0 && p.a.z <= p.d.x) {
      // absorbed: an electron and a hole; the energy above the gap is heat
      p.b = vec4f(p.a.xyz, 1.0);
      p.c = vec4f(p.a.xyz, 0.0);
      p.d.z = 0.0;
      state = 1u;
    } else if (layer < 0 && p.a.z < bottom - 0.45) {
      p.b.w = 3.0;
      p.c.w = -rnd(i, gen, 30u) * P.car.z;
      state = 3u;
    }
  } else if (state == 1u) {
    let layer = u32(p.d.y);
    let L = P.l[layer];
    var flags = u32(p.d.z);
    let s = P.seed;
    // drift toward the contacts, jostled by the lattice
    let jx = P.car.y * sqrt(dt);
    // (a parked carrier has stopped at the junction for good: it waits there, jostling, until it recombines)
    if ((flags & 8u) != 0u) {
      p.b.x += gauss(i, s, 49u) * jx * 0.4;
      p.c.x += gauss(i, s, 50u) * jx * 0.4;
    }
    if ((flags & 9u) == 0u) {
      p.b.x += gauss(i, s, 40u) * jx;
      p.b.y += gauss(i, s, 41u) * jx;
      p.b.z += P.car.x * dt + gauss(i, s, 42u) * jx * 0.6;
      p.b.y = clamp(p.b.y, -P.box.y, P.box.y);
      if (p.b.z >= L.z.x) {
        p.b.z = L.z.x;
        // (in series the bottom cell's electrons go up into the junction, where they need a partner)
        if (P.series == 1u && layer == 1u && rnd(i, s, 43u) < L.k.w) { flags |= 8u; } else { flags |= 1u; }
      }
    }
    if ((flags & 10u) == 0u) {
      p.c.x += gauss(i, s, 44u) * jx;
      p.c.y += gauss(i, s, 45u) * jx;
      p.c.z -= P.car.x * dt - gauss(i, s, 46u) * jx * 0.6;
      p.c.y = clamp(p.c.y, -P.box.y, P.box.y);
      if (p.c.z <= L.z.y) {
        p.c.z = L.z.y;
        if (P.series == 1u && layer == 0u && rnd(i, s, 47u) < L.k.w) { flags |= 8u; } else { flags |= 2u; }
      }
    }
    // recombination: a steady chance on the way out; a parked carrier finds no partner and soon recombines
    var rate = L.k.z;
    if ((flags & 8u) != 0u) { rate = 4.0; }
    if (rnd(i, s, 48u) < rate * dt) {
      atomicAdd(&cnt[${C_REC}u + layer], 1u);
      if ((flags & 8u) != 0u) { atomicAdd(&cnt[${C_PARK}u + layer], 1u); }
      p.b.w = 4.0;
      p.c.w = 0.0;
      p.d.z = f32(flags);
      state = 4u;
    } else if ((flags & 3u) == 3u) {
      atomicAdd(&cnt[${C_COL}u + layer], 1u);
      p.d.z = 4.0;
      p.b.w = 3.0;
      p.c.w = -rnd(i, gen, 31u) * P.car.z;
      state = 3u;
    } else {
      p.d.z = f32(flags);
    }
  } else if (state == 4u) {
    if (t > 0.45) {
      p.b.w = 3.0;
      p.d.z = 0.0;
      p.c.w = -rnd(i, gen, 32u) * P.car.z;
      state = 3u;
    }
  } else if (state == 3u) {
    // (time runs from minus the wait up to zero, then a new photon)
    if (t >= 0.0) {
      let g = gen + 1u;
      p = spawn(i, g);
      state = 0u;
    }
  }
  p.b.w = f32(state);
  parts[i] = p;
}
`;

const RENDER = /* wgsl */ `
struct Particle { a: vec4f, b: vec4f, c: vec4f, d: vec4f }
@group(0) @binding(1) var<storage, read> parts: array<Particle>;
@group(0) @binding(2) var<storage, read> geo: array<vec4f>;
// geo: [0] half x, half y, bottom, layers · [1..2] layer: top, bottom, gap, lattice count · [3..4] layer colour, -
//      [5] series, slant, photon brightness, carrier brightness

fn state(p: Particle) -> u32 { return u32(p.b.w + 0.5); }

@vertex
fn vsPhoton(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  let p = parts[ii];
  if (state(p) != 0u) { return hidden(); }
  let head = p.a.xyz;
  let dir = normalize(vec3f(geo[5].y, 0.0, -1.0));
  let below = p.a.z < geo[0].z;
  // a photon that has passed through everything dims as it leaves out the bottom
  let fade = select(1.0, clamp(1.0 + (p.a.z - geo[0].z) / 0.45, 0.0, 1.0) * 0.5, below);
  let inside = p.a.z < 0.0;
  let len = select(0.13, 0.07, inside);
  return streak(head - dir * len, head, 0.0045, vi, photonColor(p.a.w) * geo[5].z * fade);
}

// electrons and holes: two per slot; just made, they're white-hot, and cool to their colours as the pair settles
@vertex
fn vsCarrier(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  let p = parts[ii / 2u];
  let st = state(p);
  if (st != 1u) { return hidden(); }
  let flags = u32(p.d.z);
  let hole = (ii & 1u) == 1u;
  if ((!hole && (flags & 1u) != 0u) || (hole && (flags & 2u) != 0u)) { return hidden(); }
  let pos = select(p.b.xyz, p.c.xyz, hole);
  var col = select(vec3f(0.25, 0.8, 1.0), vec3f(1.0, 0.42, 0.72), hole);
  let hot = exp(-p.c.w * 9.0);
  col = mix(col, vec3f(1.0, 0.95, 0.85), hot) * (0.5 + 1.4 * hot);
  // parked at the junction with no partner: they flicker, waiting
  if ((flags & 8u) != 0u) { col *= 0.7 + 0.5 * sin(cam.p.x * 30.0 + f32(ii)); }
  // (a short trail behind it, the way it's drifting: electrons stream up, holes down)
  let tail = pos + vec3f(0.0, 0.0, select(-0.035, 0.035, hole));
  if ((flags & 8u) != 0u) { return sprite(pos, 0.0075, vi, col * geo[5].w * 1.3); }
  return streak(tail, pos, 0.0045, vi, col * geo[5].w * 1.6);
}

// the photon's energy above the gap, thrown off as heat in the first moments: orange sparks, more for a bluer photon
@vertex
fn vsHeat(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  let p = parts[ii / 4u];
  if (state(p) != 1u || p.c.w > 0.5) { return hidden(); }
  let layer = u32(p.d.y);
  let excess = max(0.0, p.a.w - geo[1u + layer].z);
  let k = ii & 3u;
  if (f32(k) >= excess * 3.0 + 0.3) { return hidden(); }
  let dir = normalize(hash3(ii * 7u + 3u) * 2.0 - 1.0);
  let t = p.c.w;
  let r0 = 0.012 + t * (0.07 + 0.06 * excess);
  let col = vec3f(1.0, 0.45, 0.12) * (0.6 + excess) * exp(-t * 6.0) * 1.6;
  return streak(p.a.xyz + dir * r0 * 0.45, p.a.xyz + dir * r0, 0.004, vi, col);
}

// a pair that recombines gives its energy back as a faint glow, the colour of a photon at the gap
@vertex
fn vsFlash(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  let p = parts[ii];
  if (state(p) != 4u) { return hidden(); }
  let layer = u32(p.d.y);
  let t = p.c.w;
  let flags = u32(p.d.z);
  let at = select(mix(p.b.xyz, p.c.xyz, 0.5), select(p.b.xyz, p.c.xyz, layer == 0u), (flags & 8u) != 0u);
  let col = (photonColor(geo[1u + layer].z) * 0.8 + vec3f(0.25, 0.1, 0.35)) * exp(-t * 5.0) * 1.6;
  return sprite(at, 0.012 + t * 0.022, vi, col);
}

// the crystal: dim dots on a lattice through each layer (depth spaced as the layer is drawn)
@vertex
fn vsLattice(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  let n0 = u32(geo[1].w);
  let layer = select(0u, 1u, ii >= n0);
  let j = select(ii, ii - n0, layer == 1u);
  let L = geo[1u + layer];
  let h = hash3(j * 2654435761u + layer * 97u);
  let x = (h.x * 2.0 - 1.0) * geo[0].x;
  let y = (h.y * 2.0 - 1.0) * geo[0].y;
  let z = mix(L.x, L.y, h.z);
  let edge = smoothstep(0.0, 0.02, min(abs(z - L.x), abs(z - L.y)));
  let tw = 0.75 + 0.25 * sin(cam.p.x * 0.7 + h.x * 40.0);
  return sprite(vec3f(x, y, z), 0.0042, vi, geo[3u + layer].rgb * (0.16 + 0.14 * (1.0 - edge)) * tw);
}

// the contacts: a bright fine sheet at the top of the stack, between the cells, and at the bottom
@vertex
fn vsContact(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  let nl = u32(geo[0].w);
  let sheet = ii % (nl + 1u);
  let j = ii / (nl + 1u);
  let h = hash3(j * 747796405u + sheet * 31u);
  var z = geo[1].x;
  if (sheet == 1u) { z = geo[1].y; }
  if (sheet == 2u) { z = geo[2].y; }
  let x = (h.x * 2.0 - 1.0) * geo[0].x;
  let y = (h.y * 2.0 - 1.0) * geo[0].y;
  var col = vec3f(0.55, 0.6, 0.8) * 0.09;
  if (sheet == 1u && nl == 2u) { col = vec3f(0.85, 0.75, 1.0) * 0.12; }
  return sprite(vec3f(x, y, z), 0.0035, vi, col);
}
`;

export class CellEngine {
  readonly stage: NeuronStage;
  readonly opts: Required<EngineOptions>;
  layers: LayerSpec[];
  /** in series: each cell's share of carriers that find no partner at the junction */
  surplus: [number, number] = [0, 0];
  tally: Tally;
  /** sun's photon current over the whole sampled spectrum, mA/cm² (a share of photons × this = a current) */
  readonly jSun = jph(E_MIN, E_MAX);
  /** how many seconds of display time pass per wall second */
  speed = 1;

  private device: GPUDevice;
  private params: GPUBuffer;
  private parts: GPUBuffer;
  private etab: GPUBuffer;
  private alpha: GPUBuffer;
  private cnt: GPUBuffer;
  private geo: GPUBuffer;
  private pStep: GPUComputePipeline;
  private gStep: GPUBindGroup;
  private gDraw: GPUBindGroup;
  private render: Record<string, GPURenderPipeline>;
  private readback: Readback;
  private last: Uint32Array | null = null;
  private seed = 1;
  private skip = 0;
  private pdata = new ArrayBuffer(176);

  constructor(stage: NeuronStage, opts: EngineOptions) {
    this.stage = stage;
    this.device = stage.device;
    this.opts = {
      series: false,
      spawnTop: 1.1,
      fall: 1.25,
      drift: 1.2,
      jitter: 0.08,
      lattice: 9000,
      bright: 1,
      carriers: 0.55,
      ...opts,
    };
    this.layers = opts.layers;
    const d = this.device;
    this.params = d.createBuffer({ size: 176, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.parts = stage.storage(this.opts.count * 64);
    // every slot starts as a photon already somewhere on its way, so the stream is full from the first frame
    this.etab = stage.storage(energyTable());
    this.alpha = stage.storage(ALPHA_BINS * 2 * 4);
    this.cnt = stage.storage(COUNTERS * 4, GPUBufferUsage.COPY_SRC);
    this.geo = stage.storage(6 * 16);
    this.readback = new Readback(d, COUNTERS * 4);
    const mod = shaderModule(d, SOLAR_WGSL + COMPUTE, "cell-engine");
    this.pStep = d.createComputePipeline({ layout: "auto", compute: { module: mod, entryPoint: "step" } });
    this.gStep = d.createBindGroup({
      layout: this.pStep.getBindGroupLayout(0),
      entries: [this.params, this.parts, this.etab, this.alpha, this.cnt].map((buffer, binding) => ({ binding, resource: { buffer } })),
    });
    this.render = stage.pipelines(SOLAR_WGSL + RENDER, ["vsLattice", "vsContact", "vsPhoton", "vsHeat", "vsCarrier", "vsFlash"]);
    this.gDraw = stage.group([this.parts, this.geo]);
    this.tally = this.emptyTally();
    this.seedParticles();
    this.setLayers(opts.layers);
  }

  private emptyTally(): Tally {
    return {
      photons: 0,
      passed: 0,
      passedEnergy: 0,
      absorbed: [0, 0],
      collected: [0, 0],
      recombined: [0, 0],
      parked: [0, 0],
      heat: [0, 0],
      hist: Array.from({ length: HIST_BINS }, () => [0, 0, 0]),
    };
  }

  /** all slots waiting a random moment before their first photon, so the stream fills in rather than arriving at once */
  private seedParticles(): void {
    const n = this.opts.count;
    const data = new Float32Array(n * 16);
    for (let i = 0; i < n; i++) {
      data[i * 16 + 4 + 3] = 3; // state: waiting
      data[i * 16 + 8 + 3] = -Math.random() * (this.opts.spawnTop / this.opts.fall); // time: minus the wait
      data[i * 16 + 12 + 3] = i % 977; // generation
    }
    this.device.queue.writeBuffer(this.parts, 0, data);
  }

  /** new layers (a gap or a thickness moved): new absorption tables, and the tally starts over */
  setLayers(layers: LayerSpec[]): void {
    this.layers = layers;
    const a = new Float32Array(ALPHA_BINS * 2);
    layers.forEach((l, k) => a.set(alphaTable(l.material, l.gap), k * ALPHA_BINS));
    this.device.queue.writeBuffer(this.alpha, 0, a);
    const g = new Float32Array(24);
    const bottom = layers[layers.length - 1].z1;
    g.set([this.opts.halfX, this.opts.halfY, bottom, layers.length], 0);
    const per = Math.floor(this.opts.lattice / layers.length);
    layers.forEach((l, k) => {
      g.set([l.z0, l.z1, l.gap, per], 4 + k * 4);
      g.set([...l.color, 0], 12 + k * 4);
    });
    if (layers.length === 1) g.set([layers[0].z1, layers[0].z1, layers[0].gap, 0], 8);
    g.set([this.opts.series ? 1 : 0, 0.12, this.opts.bright, this.opts.carriers], 20);
    this.device.queue.writeBuffer(this.geo, 0, g);
    this.resetTally();
  }

  resetTally(): void {
    this.tally = this.emptyTally();
    // (the next readback may still hold counts from before the change: skip a few)
    this.skip = 4;
  }

  private writeParams(): void {
    const f = new Float32Array(this.pdata);
    const u = new Uint32Array(this.pdata);
    const o = this.opts;
    f[0] = Math.min(0.05, this.stage.wallDt) * this.speed;
    f[1] = this.stage.time;
    u[2] = o.count;
    u[3] = this.layers.length;
    f.set([o.halfX, o.halfY, o.spawnTop, o.fall], 4);
    f.set([o.drift, o.jitter, 0.35, 0.12], 8);
    for (let k = 0; k < 2; k++) {
      const l = this.layers[Math.min(k, this.layers.length - 1)];
      const thick = l.thickNm * 1e-7;
      f.set([l.z0, l.z1, l.gap, thick], 12 + k * 8);
      f.set([l.log ? 1 : 0, l.trap ?? 1, l.recomb, this.surplus[k]], 16 + k * 8);
    }
    u[28] = this.seed++;
    u[29] = o.series ? 1 : 0;
    this.device.queue.writeBuffer(this.params, 0, this.pdata);
  }

  compute(enc: GPUCommandEncoder): void {
    this.writeParams();
    const pass = enc.beginComputePass();
    pass.setPipeline(this.pStep);
    pass.setBindGroup(0, this.gStep);
    pass.dispatchWorkgroups(Math.ceil(this.opts.count / 256));
    pass.end();
  }

  draw(pass: GPURenderPassEncoder): void {
    const n = this.opts.count;
    const r = this.render;
    pass.setBindGroup(0, this.gDraw);
    pass.setPipeline(r.vsLattice);
    pass.draw(6, Math.floor(this.opts.lattice / this.layers.length) * this.layers.length);
    pass.setPipeline(r.vsContact);
    pass.draw(6, 3000 * (this.layers.length + 1));
    pass.setPipeline(r.vsPhoton);
    pass.draw(6, n);
    pass.setPipeline(r.vsHeat);
    pass.draw(6, n * 4);
    pass.setPipeline(r.vsCarrier);
    pass.draw(6, n * 2);
    pass.setPipeline(r.vsFlash);
    pass.draw(6, n);
  }

  /** encode the counters' copy (stage.render's readback hook) */
  copyCounters(enc: GPUCommandEncoder): (() => void) | null {
    return this.readback.copy(enc, this.cnt);
  }

  /** fold the latest counters into the tally (differences since the last look, so wrapping never matters) */
  update(): void {
    const now = new Uint32Array(this.readback.latest.buffer);
    if (now.length < COUNTERS) return;
    const prev = this.last;
    this.last = now.slice();
    if (!prev || this.skip > 0) {
      this.skip = Math.max(0, this.skip - 1);
      return;
    }
    const d = (k: number): number => (now[k] - prev[k]) >>> 0;
    const t = this.tally;
    t.photons += d(C_PHOT);
    t.passed += d(C_PASS);
    t.passedEnergy += d(C_PASSE) / 1000;
    for (let k = 0; k < 2; k++) {
      t.absorbed[k] += d(C_ABS + k);
      t.collected[k] += d(C_COL + k);
      t.recombined[k] += d(C_REC + k);
      t.parked[k] += d(C_PARK + k);
      t.heat[k] += d(C_HEAT + k) / 1000;
    }
    for (let b = 0; b < HIST_BINS; b++) for (let k = 0; k < 3; k++) t.hist[b][k] += d(C_HIST + b * 3 + k);
  }

  /** photons whose fate is settled (passed or absorbed), the denominator of every share */
  get settled(): number {
    const t = this.tally;
    return t.passed + t.absorbed[0] + t.absorbed[1];
  }

  /** a layer's absorbed photocurrent, mA/cm², from the counts */
  jAbsorbed(k: number): number {
    return this.settled ? (this.tally.absorbed[k] / this.settled) * this.jSun : 0;
  }

  /** a layer's collected current, mA/cm² (absorbed, less what recombined) */
  jCollected(k: number): number {
    const t = this.tally;
    const done = t.collected[k] + t.recombined[k];
    return done ? this.jAbsorbed(k) * (t.collected[k] / done) : 0;
  }
}
