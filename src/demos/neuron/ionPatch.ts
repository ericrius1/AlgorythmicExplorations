// A square of membrane with real ions on both sides. Every ion is a GPU
// particle doing a random walk. The only way across the membrane is through
// a channel of the right kind, and a channel lets an ion through with the
// Boltzmann probability of climbing the voltage it would cross. Nothing in
// here is told what the resting potential is: the voltage is just the net
// charge that has crossed, times a constant (the membrane is a capacitor),
// and −70 mV falls out of the counting.
//
// The second figure adds voltage-gated channels, each with its own
// stochastic Hodgkin–Huxley gates, and the action potential falls out too.

import { gpuMissing, type Demo } from "../../lib/demoShell";
import { rng } from "../../lib/neuron/morphology";
import {
  NeuronStage,
  Readback,
  shaderModule,
  drawScope,
  hudLabel,
  makeTrace,
  pushTrace,
  HUD_FONT,
  type V3,
} from "../../lib/neuron/stage";

// box half-sizes and membrane half-thickness
const BX = 1.3;
const BY = 0.85;
const BZ = 0.62;
const H = 0.035;
const GX = 40;
const GY = 26;
const CELLS = GX * GY;
const KT = 26.7; // mV at 37 °C

// pore types
const NONE = 0;
const K_LEAK = 1;
const NA_LEAK = 2;
const NA_V = 3;
const K_V = 4;
const PUMP = 5;

// species: K⁺, Na⁺, Cl⁻, large anions
const SPECIES = 4;
// concentrations in mM, inside and outside (mammalian neuron)
const INSIDE = [140, 12, 10, 142];
const OUTSIDE = [5, 145, 110, 40];

const COMMON = /* wgsl */ `
struct Params {
  dt: f32,
  kT: f32,
  kQ: f32,
  phi: f32,
  box: vec4f,     // BX, BY, BZ, H
  grid: vec4f,    // GX, GY, cell w, cell h
  sigma: vec4f,   // step size per species
  poreR: f32,
  pumpR: f32,
  pumpP: f32,
  pumpOn: f32,
  count: u32,
  inject: i32,
  cells: u32,
  pad: u32,
  vest: vec4f,    // gated channels: vestibule radius, conductance per channel, rate shift
  rev: vec4f,     // reversal potentials: E_Na, E_K
  bulk: vec4f,    // swap odds at the far walls: Na→K in, K→Na in, K→Na out, Na→K out
}

fn pcg(n: u32) -> u32 {
  var x = n * 747796405u + 2891336453u;
  x = ((x >> ((x >> 28u) + 4u)) ^ x) * 277803737u;
  return (x >> 22u) ^ x;
}
fn rnd(n: u32) -> f32 { return f32(pcg(n)) / 4294967295.0; }

fn cellOf(p: vec2f, P: Params) -> u32 {
  let gx = clamp(u32((p.x + P.box.x) / P.grid.z), 0u, u32(P.grid.x) - 1u);
  let gy = clamp(u32((p.y + P.box.y) / P.grid.w), 0u, u32(P.grid.y) - 1u);
  return gy * u32(P.grid.x) + gx;
}
`;

const COMPUTE = /* wgsl */ `
struct Globals {
  q: atomic<i32>,
  step: atomic<u32>,
  naIn: atomic<u32>,
  naOut: atomic<u32>,
  kIn: atomic<u32>,
  kOut: atomic<u32>,
  pumpNa: atomic<u32>,
  pumpK: atomic<u32>,
  v: f32,
  t: f32,
  swapIn: atomic<u32>,     // Na⁺ → K⁺ at the inner wall
  swapInBack: atomic<u32>, // K⁺ → Na⁺ at the inner wall
  swapOut: atomic<u32>,    // K⁺ → Na⁺ at the outer wall
  swapOutBack: atomic<u32>,
  pad: vec2u,
}

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read_write> G: Globals;
@group(0) @binding(2) var<storage, read_write> pores: array<vec4f>; // cx, cy, type, open
@group(0) @binding(3) var<storage, read_write> gates: array<u32>;
@group(0) @binding(4) var<storage, read_write> flash: array<f32>;
@group(0) @binding(5) var<storage, read_write> ions: array<vec4f>; // [2i] pos+species, [2i+1] lastCross, …
@group(0) @binding(6) var<storage, read_write> tickets: array<atomic<i32>>;

// HH rates, ms⁻¹ (Hodgkin & Huxley 1952, modern sign convention)
fn aM(v: f32) -> f32 { let x = v + 40.0; if (abs(x) < 1e-3) { return 1.0; } return 0.1 * x / (1.0 - exp(-x / 10.0)); }
fn bM(v: f32) -> f32 { return 4.0 * exp(-(v + 65.0) / 18.0); }
fn aH(v: f32) -> f32 { return 0.07 * exp(-(v + 65.0) / 20.0); }
fn bH(v: f32) -> f32 { return 1.0 / (1.0 + exp(-(v + 35.0) / 10.0)); }
fn aN(v: f32) -> f32 { let x = v + 55.0; if (abs(x) < 1e-3) { return 0.1; } return 0.01 * x / (1.0 - exp(-x / 10.0)); }
fn bN(v: f32) -> f32 { return 0.125 * exp(-(v + 65.0) / 80.0); }

// Each channel carries its own gates, each one a coin that flips open with
// rate α and shut with rate β. A Na⁺ channel conducts when its three m gates
// and its h gate are all open; a K⁺ channel when all four n gates are. Every
// site on the membrane holds a cluster of eight channels, four gate bits each.
fn flipGate(g: u32, bit: u32, a: f32, b: f32, r: f32) -> u32 {
  let on = (g >> bit) & 1u;
  if (on == 0u && r < a) { return g | (1u << bit); }
  if (on == 1u && r < b) { return g & ~(1u << bit); }
  return g;
}

@compute @workgroup_size(64)
fn gate(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= P.cells) { return; }
  let ty = pores[i].z;
  if (ty == 5.0) {
    // Na⁺/K⁺-ATPase: each cycle owes three Na⁺ out and two K⁺ in
    // (a cycle only starts once the last one's ions have been carried, so
    // the 3:2 ratio holds even when K⁺ is scarce outside)
    let a = atomicLoad(&tickets[i]);
    let b = atomicLoad(&tickets[P.cells + i]);
    if (P.pumpOn > 0.5 && a > -3 && b < 2) {
      let cycles = i32(floor(P.pumpP + rnd(atomicLoad(&G.step) * 2246822519u + i * 31u)));
      atomicStore(&tickets[i], a - 3 * cycles);
      atomicStore(&tickets[P.cells + i], b + 2 * cycles);
    }
    return;
  }
  if (ty != 3.0 && ty != 4.0) { return; }
  // HH's rates are written for a cell resting at −65 mV; ours rests a little
  // lower, so read them shifted to keep threshold the same distance from rest
  let v = G.v + P.vest.z;
  let dt = P.dt * P.phi;
  let s = atomicLoad(&G.step) * 2654435761u + i * 197u;
  var g = gates[i];
  var openCount = 0u;
  if (ty == 3.0) {
    let am = aM(v) * dt;
    let bm = bM(v) * dt;
    let ah = aH(v) * dt;
    let bh = bH(v) * dt;
    for (var c = 0u; c < 8u; c++) {
      let b0 = c * 4u;
      g = flipGate(g, b0, am, bm, rnd(s + b0));
      g = flipGate(g, b0 + 1u, am, bm, rnd(s + b0 + 1u));
      g = flipGate(g, b0 + 2u, am, bm, rnd(s + b0 + 2u));
      g = flipGate(g, b0 + 3u, ah, bh, rnd(s + b0 + 3u));
      if (((g >> b0) & 15u) == 15u) { openCount++; }
    }
  } else {
    let an = aN(v) * dt;
    let bn = bN(v) * dt;
    for (var c = 0u; c < 8u; c++) {
      let b0 = c * 4u;
      g = flipGate(g, b0, an, bn, rnd(s + b0));
      g = flipGate(g, b0 + 1u, an, bn, rnd(s + b0 + 1u));
      g = flipGate(g, b0 + 2u, an, bn, rnd(s + b0 + 2u));
      g = flipGate(g, b0 + 3u, an, bn, rnd(s + b0 + 3u));
      if (((g >> b0) & 15u) == 15u) { openCount++; }
    }
  }
  gates[i] = g;
  let open = f32(openCount) / 8.0;
  pores[i].w = open;
  // Open channels pass current I = γ (V − E): this many ions this step.
  // Positive tickets carry ions inward, negative ones outward; any ion of
  // the right kind waiting at the right mouth can claim one.
  if (openCount > 0u) {
    let e = select(P.rev.y, P.rev.x, ty == 3.0);
    let lam = P.vest.y * P.dt * open * (e - G.v);
    let n = i32(floor(abs(lam) + rnd(s + 40u))) * select(-1, 1, lam > 0.0);
    let t = atomicLoad(&tickets[i]);
    atomicStore(&tickets[i], clamp(t + n, -4, 4));
  } else {
    atomicStore(&tickets[i], 0);
  }
}

fn charge(sp: u32) -> i32 { return select(-1, 1, sp < 2u); }

fn permeates(ty: f32, sp: u32) -> bool {
  if (sp == 0u) { return ty == 1.0 || ty == 4.0; }
  if (sp == 1u) { return ty == 2.0 || ty == 3.0; }
  return false;
}

fn gauss(s: u32) -> vec3f {
  let u1 = max(rnd(s), 1e-7);
  let u2 = rnd(s + 1u);
  let u3 = max(rnd(s + 2u), 1e-7);
  let u4 = rnd(s + 3u);
  let r1 = sqrt(-2.0 * log(u1));
  let r2 = sqrt(-2.0 * log(u3));
  return vec3f(r1 * cos(6.2831853 * u2), r1 * sin(6.2831853 * u2), r2 * cos(6.2831853 * u4));
}

@compute @workgroup_size(256)
fn walk(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= P.count) { return; }
  var a = ions[i * 2u];
  var b = ions[i * 2u + 1u];
  let sp = u32(a.w);
  let s = pcg((i * 0x9E3779B9u) ^ (atomicLoad(&G.step) * 0x85EBCA6Bu));
  let h = P.box.w;
  let wasOut = a.z > 0.0;
  var p = a.xyz + gauss(s) * P.sigma[sp];
  // periodic sideways (an endless sheet), reflecting top and bottom
  p.x = p.x - 2.0 * P.box.x * floor((p.x + P.box.x) / (2.0 * P.box.x));
  p.y = p.y - 2.0 * P.box.y * floor((p.y + P.box.y) / (2.0 * P.box.y));
  if (p.z > P.box.z) { p.z = 2.0 * P.box.z - p.z; }
  if (p.z < -P.box.z) { p.z = -2.0 * P.box.z - p.z; }

  // Two ways through. Leak channels are narrow: an ion has to wander
  // straight into one. Voltage-gated channels have a wide vestibule that
  // funnels in any ion of the right kind nearby, so each one carries far
  // more current — which is what lets a few hundred of them swamp the leak.
  let hit = select(p.z > -h, p.z < h, wasOut);
  var tryCross = false;
  var cell = cellOf(p.xy, P);
  var pr = pores[cell];
  if (hit && pr.w > 0.5 && permeates(pr.z, sp) && pr.z < 3.0 && length(p.xy - pr.xy) < P.poreR) {
    tryCross = true;
  }
  // gated channels reach a little way into the neighbouring cells, and
  // move ions only against tickets their current has issued
  var ticketed = false;
  if (!tryCross && sp < 2u && abs(a.z) < h + P.vest.x) {
    let mouthZ = select(-h, h, wasOut);
    let c0 = vec2i(i32(cell % u32(P.grid.x)), i32(cell / u32(P.grid.x)));
    for (var dy = -1; dy <= 1 && !tryCross; dy++) {
      for (var dx = -1; dx <= 1 && !tryCross; dx++) {
        let c = c0 + vec2i(dx, dy);
        if (c.x < 0 || c.y < 0 || c.x >= i32(P.grid.x) || c.y >= i32(P.grid.y)) { continue; }
        let ci = u32(c.y) * u32(P.grid.x) + u32(c.x);
        let q = pores[ci];
        if (q.z >= 3.0 && q.z < 5.0 && q.w > 0.01 && permeates(q.z, sp)
            && length(a.xyz - vec3f(q.xy, mouthZ)) < P.vest.x) {
          if (wasOut) {
            if (atomicSub(&tickets[ci], 1) > 0) { tryCross = true; } else { atomicAdd(&tickets[ci], 1); }
          } else {
            if (atomicAdd(&tickets[ci], 1) < 0) { tryCross = true; } else { atomicSub(&tickets[ci], 1); }
          }
          if (tryCross) {
            ticketed = true;
            cell = ci;
            pr = q;
          }
        }
      }
    }
  }
  var crossed = false;
  if (tryCross) {
    // Metropolis: always go downhill, climb with Boltzmann probability
    let z = f32(charge(sp));
    let dU = select(z * (0.0 - G.v), z * G.v, wasOut);
    if (ticketed || rnd(s + 7u) < exp(-max(dU, 0.0) / P.kT)) {
      crossed = true;
      let c = select(-charge(sp), charge(sp), wasOut);
      atomicAdd(&G.q, c);
      if (sp == 0u) {
        if (wasOut) { atomicAdd(&G.kIn, 1u); } else { atomicAdd(&G.kOut, 1u); }
      } else {
        if (wasOut) { atomicAdd(&G.naIn, 1u); } else { atomicAdd(&G.naOut, 1u); }
      }
      flash[cell] = G.t;
      b.x = G.t;
      // exit clear of the far vestibule, so the ion diffuses away rather
      // than being handed straight back
      let land = h + P.vest.x + 0.005 + rnd(s + 9u) * 0.03;
      let ang = rnd(s + 10u) * 6.2831853;
      p = vec3f(pr.xy + vec2f(cos(ang), sin(ang)) * 0.02, select(land, -land, wasOut));
    }
  }
  if (hit && !crossed) {
    p.z = select(-2.0 * h - p.z, 2.0 * h - p.z, wasOut);
    p.z = select(min(p.z, -h - 0.001), max(p.z, h + 0.001), wasOut);
  }

  // Na⁺/K⁺ pump: carries Na⁺ out and K⁺ in against their gradients, paid
  // for with ATP, but only as many as the cycles it has run
  // (sparse K⁺ outside is gathered from a wider reach than Na⁺ inside)
  let reach = select(P.pumpR, P.pumpR * 1.8, sp == 0u);
  if (sp < 2u && abs(p.z) < h + reach) {
    let out = p.z > 0.0;
    if ((sp == 1u && !out) || (sp == 0u && out)) {
      let pc = cellOf(p.xy, P);
      let pq = pores[pc];
      if (pq.z == 5.0 && length(p.xy - pq.xy) < reach) {
        var go = false;
        if (sp == 1u) {
          if (atomicAdd(&tickets[pc], 1) < 0) { go = true; } else { atomicSub(&tickets[pc], 1); }
        } else {
          if (atomicSub(&tickets[P.cells + pc], 1) > 0) { go = true; } else { atomicAdd(&tickets[P.cells + pc], 1); }
        }
        if (go) {
          let land = h + 0.03 + rnd(s + 13u) * 0.03;
          p.z = select(land, -land, out);
          atomicAdd(&G.q, select(-1, 1, out));
          if (out) { atomicAdd(&G.pumpK, 1u); } else { atomicAdd(&G.pumpNa, 1u); }
          flash[pc] = G.t;
          b.x = G.t;
        }
      }
    }
  }
  // The far walls stand in for the bulk of the cell and the bath around it,
  // far too big for a few spikes to change: an ion that reaches one may be
  // swapped for whichever ion that side is short of
  if (sp < 2u) {
    let r = rnd(s + 17u);
    if (p.z < -P.box.z + 0.02) {
      if (sp == 1u && r < P.bulk.x) { a.w = 0.0; atomicAdd(&G.swapIn, 1u); }
      else if (sp == 0u && r < P.bulk.y) { a.w = 1.0; atomicAdd(&G.swapInBack, 1u); }
    } else if (p.z > P.box.z - 0.02) {
      if (sp == 0u && r < P.bulk.z) { a.w = 1.0; atomicAdd(&G.swapOut, 1u); }
      else if (sp == 1u && r < P.bulk.w) { a.w = 0.0; atomicAdd(&G.swapOutBack, 1u); }
    }
  }
  ions[i * 2u] = vec4f(p, a.w);
  ions[i * 2u + 1u] = b;
}

@compute @workgroup_size(1)
fn volt() {
  let q = atomicAdd(&G.q, P.inject) + P.inject;
  G.v = P.kQ * f32(q);
  G.t = G.t + P.dt;
  atomicAdd(&G.step, 1u);
}
`;

const RENDER = /* wgsl */ `
@group(0) @binding(1) var<storage, read> ions: array<vec4f>;
@group(0) @binding(2) var<storage, read> pores: array<vec4f>;
@group(0) @binding(3) var<storage, read> flash: array<f32>;
@group(0) @binding(4) var<storage, read> glob: array<f32>; // [8] = V, [9] = t
@group(0) @binding(5) var<storage, read> geo: array<vec4f>; // [0] box, [1] grid, [2] (poreR, msPerSec, electrode, …)

fn edgeFade(p: vec3f) -> f32 {
  let b = geo[0];
  return smoothstep(b.x, b.x - 0.12, abs(p.x)) * smoothstep(b.y, b.y - 0.12, abs(p.y));
}

fn cellAt(p: vec2f) -> u32 {
  let b = geo[0];
  let g = geo[1];
  let gx = clamp(u32((p.x + b.x) / g.z), 0u, u32(g.x) - 1u);
  let gy = clamp(u32((p.y + b.y) / g.w), 0u, u32(g.y) - 1u);
  return gy * u32(g.x) + gx;
}

@vertex
fn vsIon(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  let a = ions[ii * 2u];
  let b = ions[ii * 2u + 1u];
  let sp = u32(a.w);
  var col = vec3f(0.2, 0.78, 1.0) * 0.1;            // K⁺
  var r = 0.0055;
  if (sp == 1u) { col = vec3f(1.0, 0.55, 0.14) * 0.1; }      // Na⁺
  if (sp == 2u) { col = vec3f(0.4, 1.0, 0.45) * 0.032; }     // Cl⁻
  if (sp == 3u) { col = vec3f(0.6, 0.36, 1.0) * 0.03; r = 0.008; } // proteins
  // flare after crossing, in screen time
  let age = (glob[9] - b.x) / max(geo[2].y, 1e-3);
  let f = exp(-max(age, 0.0) * 3.5) * select(0.0, 1.0, b.x > 0.0);
  col *= 1.0 + 26.0 * f;
  r *= 1.0 + 1.6 * f;
  return sprite(a.xyz, r, vi, col * edgeFade(a.xyz) * cam.q.x);
}

// lipid heads on both leaflets, with holes where the channels are; each
// leaflet glows with the sign of the charge stacked against it
@vertex
fn vsLipid(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  let b = geo[0];
  let leaf = ii & 1u;
  let k = ii >> 1u;
  let lx = 180u;
  let ly = u32(f32(lx) * b.y / b.x);
  if (k >= lx * ly) { return hidden(); }
  let j = hash3(k * 7u + leaf);
  let x = -b.x + (f32(k % lx) + 0.15 + 0.7 * j.x) * (2.0 * b.x / f32(lx));
  let y = -b.y + (f32(k / lx) + 0.15 + 0.7 * j.y) * (2.0 * b.y / f32(ly));
  let side = select(-1.0, 1.0, leaf == 1u);
  let p = vec3f(x, y, side * b.w * (0.92 + 0.16 * j.z));
  let pr = pores[cellAt(p.xy)];
  if (pr.z > 0.5 && length(p.xy - pr.xy) < geo[2].x * 1.25) { return hidden(); }
  let v = glob[8];
  // inner leaflet: blue when the inside is negative; outer: warm
  let neg = clamp(-v / 90.0, 0.0, 1.0);
  let pos = clamp(v / 60.0, 0.0, 1.0);
  var col = vec3f(0.85, 0.78, 0.7) * 0.05;
  if (leaf == 0u) { col += vec3f(0.25, 0.45, 1.0) * neg * 0.16 + vec3f(1.0, 0.5, 0.2) * pos * 0.2; }
  else { col += vec3f(1.0, 0.6, 0.3) * neg * 0.1 + vec3f(0.25, 0.45, 1.0) * pos * 0.14; }
  return sprite(p, 0.0042, vi, col * edgeFade(p));
}

// channels: two rings through the bilayer, bright when open, flaring as
// ions pass; pumps turn slowly
@vertex
fn vsPore(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  let cell = ii / 30u;
  let k = ii % 30u;
  let pr = pores[cell];
  let ty = u32(pr.z);
  if (ty == 0u) { return hidden(); }
  let h = geo[0].w;
  let R = geo[2].x;
  var col = vec3f(0.2, 0.75, 1.0);
  if (ty == 2u || ty == 3u) { col = vec3f(1.0, 0.55, 0.14); }
  if (ty == 5u) { col = vec3f(0.8, 0.55, 1.0); }
  let open = pr.w;
  let age = (glob[9] - flash[cell]) / max(geo[2].y, 1e-3);
  let fl = exp(-max(age, 0.0) * 5.0) * select(0.0, 1.0, flash[cell] > 0.0);
  let gatedTy = ty == 3u || ty == 4u;
  var bright = select(0.45, 0.12 + 0.6 * sqrt(open), gatedTy) + fl * 2.5;
  if (ty <= 2u) { bright *= 0.65; }
  var p: vec3f;
  if (k < 28u) {
    let ring = f32(k / 14u);
    var a = f32(k % 14u) / 14.0 * 6.2831853;
    if (ty == 5u) { a += cam.p.x * 1.5; }
    // closed gated channels pinch shut
    let rr = R * select(1.0, mix(0.55, 1.0, sqrt(open)), gatedTy);
    p = vec3f(pr.xy + vec2f(cos(a), sin(a)) * rr, (ring * 2.0 - 1.0) * h * 1.15);
  } else {
    p = vec3f(pr.xy, (f32(k - 28u) * 2.0 - 1.0) * h * 0.4);
    bright *= min(1.0, open * 4.0) * 2.0;
  }
  return sprite(p, 0.006, vi, col * bright * 0.5 * edgeFade(p));
}

// a faint wire box, so the volume reads in 3D
@vertex
fn vsFrame(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  let b = geo[0];
  let e = ii / 120u;
  let t = (f32(ii % 120u) + 0.5) / 120.0 * 2.0 - 1.0;
  var p: vec3f;
  let sx = select(-1.0, 1.0, (e & 1u) == 1u);
  let sy = select(-1.0, 1.0, (e & 2u) == 2u);
  if (e < 4u) { p = vec3f(t * b.x, sx * b.y, sy * b.z); }
  else if (e < 8u) { p = vec3f(sx * b.x, t * b.y, sy * b.z); }
  else { p = vec3f(sx * b.x, sy * b.y, t * b.z); }
  return sprite(p, 0.0035, vi, vec3f(0.5, 0.6, 1.0) * 0.06);
}

// the stimulating electrode: a glass needle into the inside
@vertex
fn vsElectrode(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  if (geo[2].z <= 0.0) { return hidden(); }
  let b = geo[0];
  let t = f32(ii) / 400.0;
  let tip = vec3f(-0.25, -0.1, -0.22);
  let base = vec3f(-1.25, -0.8, -b.z - 0.3);
  let j = hash3(ii * 13u) * 2.0 - 1.0;
  let p = mix(base, tip, t) + j * 0.012 * (1.0 - t * 0.85);
  let pulse = geo[2].w;
  let glow = exp(-pow((t - fract(cam.p.x * 1.2)) * 6.0, 2.0)) * 0.1 + pulse * exp(-(1.0 - t) * 6.0) * 2.0;
  return sprite(p, 0.004, vi, vec3f(0.75, 0.85, 1.0) * (0.06 + glow));
}
`;

export interface IonPatchOptions {
  mode: "rest" | "spike";
}

interface PoreCounts {
  kLeak: number;
  naLeak: number;
  naV: number;
  kV: number;
  pump: number;
}

export async function mountIonPatch(container: HTMLElement, opts: IonPatchOptions): Promise<Demo> {
  const spike = opts.mode === "spike";
  const stage = await NeuronStage.create(container, {
    aspect: 0.6,
    post: { bloom: 0.2, exposure: 1.1, vignette: 0.35 },
    setup: (o) => {
      o.azimuth = -Math.PI / 2 + 0.55;
      o.elevation = 0.32;
      o.distance = 3.3;
      o.target = [0, 0, -0.04];
      o.sway = 0.3;
      o.swaySpeed = 0.035;
    },
  });
  if (!stage) return gpuMissing(container);
  const { device, shell } = stage;
  stage.minRadiusPx = 0.9;

  const counts: PoreCounts = spike
    ? { kLeak: 20, naLeak: 1, naV: 200, kV: 60, pump: 24 }
    : { kLeak: 60, naLeak: 4, naV: 0, kV: 0, pump: 14 };
  let ionCount = 240_000;
  let pumpOn = true;

  // ---- buffers ----
  const params = device.createBuffer({ size: 144, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const globals = device.createBuffer({
    size: 64,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });
  const pores = stage.storage(CELLS * 16, GPUBufferUsage.COPY_SRC);
  const gates = stage.storage(CELLS * 4);
  const flash = stage.storage(CELLS * 4);
  const tickets = stage.storage(CELLS * 8);
  const geo = stage.storage(48);
  let ions: GPUBuffer = null!;
  const readback = new Readback(device, 64);

  const cw = (2 * BX) / GX;
  const ch = (2 * BY) / GY;
  const PORE_R = 0.026;

  // pore layout: a fixed shuffle of cells, types dealt out in order
  const order: number[] = [];
  const jitter = new Float32Array(CELLS * 2);
  {
    let s = 12345;
    const r = (): number => (s = (s * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < CELLS; i++) {
      order.push(i);
      jitter[i * 2] = (r() - 0.5) * (cw - PORE_R * 2.2);
      jitter[i * 2 + 1] = (r() - 0.5) * (ch - PORE_R * 2.2);
    }
    for (let i = CELLS - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
  }
  // each gate starts open with its steady-state probability at rest, so the
  // patch begins quiet instead of firing while its gates settle
  const gateRand = rng(4242);
  const restingGates = (ty: number): number => {
    const v = -72 + 10; // matches the rate shift in the gate kernel
    const am = (0.1 * (v + 40)) / (1 - Math.exp(-(v + 40) / 10));
    const bm = 4 * Math.exp(-(v + 65) / 18);
    const ah = 0.07 * Math.exp(-(v + 65) / 20);
    const bh = 1 / (1 + Math.exp(-(v + 35) / 10));
    const an = (0.01 * (v + 55)) / (1 - Math.exp(-(v + 55) / 10));
    const bn = 0.125 * Math.exp(-(v + 65) / 80);
    const p =
      ty === NA_V
        ? [am / (am + bm), am / (am + bm), am / (am + bm), ah / (ah + bh)]
        : [an / (an + bn), an / (an + bn), an / (an + bn), an / (an + bn)];
    let g = 0;
    for (let c = 0; c < 8; c++) for (let b = 0; b < 4; b++) if (gateRand() < p[b]) g |= 1 << (c * 4 + b);
    return g >>> 0;
  };
  const writePores = (): void => {
    const data = new Float32Array(CELLS * 4);
    const g = new Uint32Array(CELLS);
    for (let i = 0; i < CELLS; i++) {
      const gx = i % GX;
      const gy = Math.floor(i / GX);
      data[i * 4] = -BX + (gx + 0.5) * cw + jitter[i * 2];
      data[i * 4 + 1] = -BY + (gy + 0.5) * ch + jitter[i * 2 + 1];
    }
    const seq: [number, number][] = [
      [K_LEAK, counts.kLeak],
      [NA_LEAK, counts.naLeak],
      [NA_V, counts.naV],
      [K_V, counts.kV],
      [PUMP, counts.pump],
    ];
    let o = 0;
    for (const [ty, c] of seq) {
      for (let k = 0; k < c && o < CELLS; k++, o++) {
        const cell = order[o];
        data[cell * 4 + 2] = ty;
        data[cell * 4 + 3] = ty === NA_V || ty === K_V ? 0 : 1;
        g[cell] = ty === NA_V || ty === K_V ? restingGates(ty) : 0;
      }
    }
    for (; o < CELLS; o++) data[order[o] * 4 + 2] = NONE;
    device.queue.writeBuffer(pores, 0, data);
    device.queue.writeBuffer(gates, 0, g);
  };

  // per-species totals, for the live concentration readout
  const unitsIn = INSIDE.reduce((a, b) => a + b, 0);
  const unitsOut = OUTSIDE.reduce((a, b) => a + b, 0);
  let perMM = 0;
  let kQ = 0;

  const writeIons = (): void => {
    ions?.destroy();
    perMM = ionCount / (unitsIn + unitsOut);
    // the membrane's capacitance: a third of a percent of the inside K⁺
    // leaving is enough to charge it to E_K
    kQ = 89 / (0.0035 * 140 * perMM);
    const data = new Float32Array(ionCount * 8);
    let s = 777;
    const r = (): number => (s = (s * 16807) % 2147483647) / 2147483647;
    let i = 0;
    const fill = (conc: number[], inside: boolean): void => {
      for (let sp = 0; sp < SPECIES; sp++) {
        const n = Math.round(conc[sp] * perMM);
        for (let k = 0; k < n && i < ionCount; k++, i++) {
          const z = H + 0.003 + r() * (BZ - H - 0.006);
          data.set([(r() * 2 - 1) * BX, (r() * 2 - 1) * BY, inside ? -z : z, sp, -1, 0, 0, 0], i * 8);
        }
      }
    };
    fill(INSIDE, true);
    fill(OUTSIDE, false);
    ionCount = i;
    ions = stage.storage(data);
    // the spike figure starts already charged near rest, as a living cell
    // would be; the resting figure starts flat, to watch the charge build
    const g0 = new ArrayBuffer(64);
    const v0 = spike ? -72 : 0;
    new Int32Array(g0)[0] = Math.round(v0 / kQ);
    new Float32Array(g0)[8] = v0;
    device.queue.writeBuffer(globals, 0, g0);
    device.queue.writeBuffer(flash, 0, new Float32Array(CELLS).fill(-1e9));
    device.queue.writeBuffer(tickets, 0, new Int32Array(CELLS * 2));
    rebuildGroups();
    warm = spike ? 300 : 0;
    trace.count = 0;
    simT = 0;
  };

  // ---- pipelines ----
  const cmod = shaderModule(device, COMMON + COMPUTE, "ion-compute");
  const cpipe = (entryPoint: string): GPUComputePipeline =>
    device.createComputePipeline({ layout: "auto", compute: { module: cmod, entryPoint } });
  const pGate = cpipe("gate");
  const pWalk = cpipe("walk");
  const pVolt = cpipe("volt");
  const render = stage.pipelines(RENDER, ["vsIon", "vsLipid", "vsPore", "vsFrame", "vsElectrode"]);

  let gGate: GPUBindGroup, gWalk: GPUBindGroup, gVolt: GPUBindGroup, gDraw: GPUBindGroup;
  const rebuildGroups = (): void => {
    const all = [params, globals, pores, gates, flash, ions, tickets];
    const make = (p: GPUComputePipeline, used: number[]): GPUBindGroup =>
      device.createBindGroup({
        layout: p.getBindGroupLayout(0),
        entries: used.map((b) => ({ binding: b, resource: { buffer: all[b] } })),
      });
    gGate = make(pGate, [0, 1, 2, 3, 6]);
    gWalk = make(pWalk, [0, 1, 2, 4, 5, 6]);
    gVolt = make(pVolt, [0, 1]);
    gDraw = stage.group([ions, pores, flash, globals, geo]);
  };

  // ---- controls ----
  const trace = makeTrace(420);
  let warm = 0;
  let simT = 0;
  let injectFrames = 0;
  let slowFrames = 0;
  let pulse = 0;
  let stimStrength = 1.25;

  if (spike) {
    shell.button("stimulate", () => {
      injectFrames = 2;
      slowFrames = 40;
      pulse = 1;
    });
    shell.slider({
      label: "stimulus",
      min: 0.2,
      max: 2,
      step: 0.05,
      value: stimStrength,
      format: (v) => `${(v * 20).toFixed(0)} mV kick`,
      onInput: (v) => (stimStrength = v),
    });
    shell.slider({
      label: "Na⁺ channels",
      min: 0,
      max: 300,
      step: 5,
      value: counts.naV,
      format: (v) => `${v}`,
      onInput: (v) => {
        counts.naV = v;
        writePores();
      },
    });
    shell.slider({
      label: "K⁺ channels",
      min: 0,
      max: 250,
      step: 5,
      value: counts.kV,
      format: (v) => `${v}`,
      onInput: (v) => {
        counts.kV = v;
        writePores();
      },
    });
  } else {
    shell.slider({
      label: "K⁺ leak channels",
      min: 0,
      max: 160,
      step: 2,
      value: counts.kLeak,
      format: (v) => `${v}`,
      onInput: (v) => {
        counts.kLeak = v;
        writePores();
      },
    });
    shell.slider({
      label: "Na⁺ leak channels",
      min: 0,
      max: 60,
      step: 1,
      value: counts.naLeak,
      format: (v) => `${v}`,
      onInput: (v) => {
        counts.naLeak = v;
        writePores();
      },
    });
    const pumpBtn = shell.button("pump: on", () => {
      pumpOn = !pumpOn;
      pumpBtn.textContent = pumpOn ? "pump: on" : "pump: off";
    });
  }
  shell.slider({
    label: "ions",
    min: 30_000,
    max: 1_000_000,
    step: 10_000,
    log: true,
    value: ionCount,
    format: (v) => `${(v / 1000).toFixed(0)}k`,
    onInput: (v) => {
      ionCount = v;
      clearTimeout(rebuildTimer);
      rebuildTimer = window.setTimeout(writeIons, 250);
    },
  });
  let rebuildTimer = 0;
  shell.button("reset", () => writeIons());

  writePores();
  writeIons();

  // ---- frame ----
  const DT = 0.003; // ms of membrane time per substep
  const SUBSTEPS = 16;
  const pData = new ArrayBuffer(144);
  const pf = new Float32Array(pData);
  const pu = new Uint32Array(pData);
  const pi = new Int32Array(pData);
  let vNow = 0;
  let kIn = INSIDE[0];
  let naIn = INSIDE[1];
  let kOut = OUTSIDE[0];
  let flux = { naIn: 0, kOut: 0 };
  let lastCounters = new Int32Array(12);

  const writeParams = (inject: number): void => {
    pf.set([DT, KT, kQ, 3], 0);
    pf.set([BX, BY, BZ, H], 4);
    pf.set([GX, GY, cw, ch], 8);
    pf.set([0.0138, 0.0155, 0.0138, 0.005], 12);
    // the pump runs about as fast as Na⁺ leaks in, and speeds up steeply
    // as Na⁺ builds inside (it has three Na⁺ binding sites)
    const drive = Math.min(3, Math.max(0, 1 + (6 * (naIn - INSIDE[1])) / INSIDE[1]));
    const base = (0.1 * Math.max(1, counts.naLeak)) / Math.max(1, counts.pump);
    pf.set([PORE_R, 0.05, base * drive, pumpOn ? 1 : 0], 16);
    pu[20] = ionCount;
    pi[21] = inject;
    pu[22] = CELLS;
    // γ: ions per ms per mV of driving force for a fully open cluster
    pf.set([0.075, 3, 10, 0], 24);
    pf.set([66, -89, 0, 0], 28);
    // only the spike figure gets a bulk: the resting one shows what happens
    // to the gradients without the pump
    const exIn = naIn - INSIDE[1];
    const exOut = kOut - OUTSIDE[0];
    const k = spike ? 0.004 : 0;
    pf.set(
      [
        Math.min(0.5, k * Math.max(0, exIn)),
        Math.min(0.5, k * Math.max(0, -exIn)),
        Math.min(0.5, k * Math.max(0, exOut)),
        Math.min(0.5, k * Math.max(0, -exOut)),
      ],
      32,
    );
    device.queue.writeBuffer(params, 0, pData);
  };

  const label = (p: V3, text: string, off: [number, number], color?: string): void =>
    hudLabel(stage, p, text, off, color);

  shell.setInfo(
    () =>
      `${ionCount.toLocaleString()} ions · ${(counts.kLeak + counts.naLeak + (counts.naV + counts.kV) * 8).toLocaleString()} channels · ${counts.pump} pumps`,
  );

  return {
    frame() {
      stage.begin();
      // spike mode runs in slow motion while the membrane is excited
      if (slowFrames > 0) slowFrames--;
      const busy = spike && (vNow > -60 || slowFrames > 0);
      const substeps = warm > 0 ? Math.min(warm, 400) : busy ? 6 : SUBSTEPS;
      warm = Math.max(0, warm - substeps);
      let inject = 0;
      if (injectFrames > 0) {
        // a kick of current through the electrode: ~20 mV × strength, over 2 frames
        inject = Math.round((20 * stimStrength) / kQ / (2 * substeps));
        injectFrames--;
      }
      writeParams(inject);
      simT += substeps * DT;
      const msPerSec = (substeps * DT) / Math.max(stage.wallDt, 1 / 120);
      pulse *= 0.92;
      device.queue.writeBuffer(
        geo,
        0,
        new Float32Array([BX, BY, BZ, H, GX, GY, cw, ch, PORE_R, msPerSec, spike ? 1 : 0, pulse]),
      );
      stage.q = [1, 0, 0, 0];

      stage.render(
        (enc) => {
          const pass = enc.beginComputePass();
          for (let s = 0; s < substeps; s++) {
            pass.setPipeline(pGate);
            pass.setBindGroup(0, gGate);
            pass.dispatchWorkgroups(Math.ceil(CELLS / 64));
            pass.setPipeline(pWalk);
            pass.setBindGroup(0, gWalk);
            pass.dispatchWorkgroups(Math.ceil(ionCount / 256));
            pass.setPipeline(pVolt);
            pass.setBindGroup(0, gVolt);
            pass.dispatchWorkgroups(1);
          }
          pass.end();
        },
        (pass) => {
          pass.setBindGroup(0, gDraw);
          pass.setPipeline(render.vsFrame);
          pass.draw(6, 12 * 120);
          pass.setPipeline(render.vsLipid);
          pass.draw(6, 180 * 118 * 2);
          pass.setPipeline(render.vsIon);
          pass.draw(6, ionCount);
          pass.setPipeline(render.vsPore);
          pass.draw(6, CELLS * 30);
          if (spike) {
            pass.setPipeline(render.vsElectrode);
            pass.draw(6, 400);
          }
        },
        (enc) => readback.copy(enc, globals),
      );

      // readback: voltage, fluxes, concentrations
      const ints = new Int32Array(readback.latest.buffer);
      vNow = readback.latest[8];
      const dSteps = ints[1] - lastCounters[1];
      if (dSteps > 0 && warm === 0) {
        const ms = dSteps * DT;
        flux = {
          naIn: (ints[2] - lastCounters[2] - (ints[3] - lastCounters[3])) / ms,
          kOut: (ints[5] - lastCounters[5] - (ints[4] - lastCounters[4])) / ms,
        };
      }
      lastCounters = ints.slice();
      // (skip frames before the first readback lands)
      if (warm === 0 && ints[1] > 0) pushTrace(trace, vNow);

      const swapIn = ints[10] - ints[11];
      kIn = INSIDE[0] - (ints[5] - ints[4] - ints[7] - swapIn) / perMM;
      naIn = INSIDE[1] + (ints[2] - ints[3] - ints[6] - swapIn) / perMM;
      kOut = OUTSIDE[0] + (ints[5] - ints[4] - ints[7] - (ints[12] - ints[13])) / perMM;
      const eK = KT * Math.log(Math.max(0.5, kOut) / Math.max(1, kIn));

      // ---- HUD ----
      stage.clearHud();
      const g = stage.g;
      const s = stage.px;
      const W = stage.hud.width;
      const Hh = stage.hud.height;
      const c = stage.compact;
      const u = (c ? 0.72 : 1) * s; // HUD type scale
      g.textBaseline = "alphabetic";
      g.textAlign = "left";
      g.fillStyle = "rgba(160, 175, 210, 0.7)";
      g.font = `600 ${10 * u}px ${HUD_FONT}`;
      g.fillText("MEMBRANE POTENTIAL", 12 * s, 22 * u);
      g.fillStyle = vNow > -40 ? "#ffb86b" : "#9fb6ff";
      g.font = `700 ${28 * u}px ${HUD_FONT}`;
      g.fillText(warm > 0 ? "settling…" : `${vNow >= 0 ? "+" : "−"}${Math.abs(vNow).toFixed(1)} mV`, 12 * s, 52 * u);
      g.font = `${10.5 * u}px ${HUD_FONT}`;
      g.fillStyle = "rgba(190, 200, 225, 0.75)";
      g.fillText(`inside: ${kIn.toFixed(1)} mM K⁺ · ${naIn.toFixed(1)} mM Na⁺`, 12 * s, 72 * u);
      if (!c)
        g.fillText(`net flow: K⁺ out ${flux.kOut.toFixed(0)}/ms · Na⁺ in ${flux.naIn.toFixed(0)}/ms`, 12 * s, 88 * u);

      // legend
      const legend: [string, string][] = [
        ["K⁺", "#38c8ff"],
        ["Na⁺", "#ff8c24"],
        ["Cl⁻", "#66ff73"],
        ["A⁻ proteins", "#9a5cff"],
      ];
      // legend: top-right, or along the bottom-left on a phone
      g.font = `600 ${10.5 * u}px ${HUD_FONT}`;
      const ly = c ? Hh - 10 * s : 22 * s;
      let lx = c ? 12 * s : W - 16 * s;
      g.textAlign = c ? "left" : "right";
      for (let i = 0; i < legend.length; i++) {
        const [t, col] = legend[c ? i : legend.length - 1 - i];
        const tw = g.measureText(t).width;
        const dot = c ? lx + 3.5 * u : lx - tw - 8 * u;
        g.fillStyle = "rgba(210, 218, 240, 0.85)";
        g.fillText(t, c ? lx + 10 * u : lx, ly);
        g.fillStyle = col;
        g.beginPath();
        g.arc(dot, ly - 3.5 * u, 3.5 * u, 0, Math.PI * 2);
        g.fill();
        lx += (c ? 1 : -1) * (tw + 24 * u);
      }
      g.textAlign = "left";

      label([BX * 0.55, -BY, BZ * 0.75], "OUTSIDE", [24, -10], "rgba(255, 190, 130, 0.9)");
      label([BX * 0.55, -BY, -BZ * 0.75], "INSIDE", [24, 10], "rgba(140, 200, 255, 0.9)");
      if (!c) label([BX, -BY * 0.4, 0], "membrane", [20, 0]);

      const box = stage.corner(300, 106);
      if (c) box.y = 10 * s;
      const lines = [
        { v: eK, label: `E_K ${eK.toFixed(0)}`, color: "rgba(56, 200, 255, 0.3)" },
        { v: 0, label: "0 mV" },
      ];
      if (spike) lines.push({ v: 55, label: "E_Na +66", color: "rgba(255, 140, 36, 0.3)" });
      drawScope(
        stage,
        box,
        [{ trace, color: "#ffb86b" }],
        spike ? [-100, 70] : [-100, 20],
        lines,
        "voltage across the membrane",
      );
      shell.tick();
    },
  };
}
