// A chemical synapse in 3D. Above: the presynaptic bouton, full of vesicles,
// a few of them docked at the active zone. Below, across a cleft drawn far
// wider than its real 20 nm: a dendritic spine with a patch of glutamate
// receptors. A spike arriving at the bouton opens Ca²⁺ channels; Ca²⁺ makes
// docked vesicles fuse; each one dumps its glutamate (thousands of GPU
// particles, each doing its own random walk) into the cleft. Molecules that
// bump into a free receptor may stick, and a receptor holding glutamate is
// an open channel: Na⁺ flows into the spine and the voltage there rises.
// Molecules that wander out of the cleft are taken up and gone.

import { gpuMissing, type Demo } from "../../lib/demoShell";
import { rng } from "../../lib/neuron/morphology";
import {
  NeuronStage,
  Readback,
  drawScope,
  hudLabel,
  makeTrace,
  pushTrace,
  shaderModule,
  HUD_FONT,
  type V3,
} from "../../lib/neuron/stage";

const CL = 0.07; // half-width of the cleft
const RC = 0.5; // radius of the cleft (beyond it, transmitter escapes)
const NV = 36; // vesicles
const PER_VESICLE = 1400; // glutamate molecules per vesicle (real ones hold a few thousand)
const NT = NV * PER_VESICLE;
const MAX_R = 128;
const DOCKS = 9;
const BOUTON_C: V3 = [0, 0, 0.55];
const BOUTON_R = 0.6;
const SPINE_C: V3 = [0, 0, -0.48];
const SPINE_R = 0.52;

const COMPUTE = /* wgsl */ `
struct Params {
  sigma: f32,
  pBind: f32,
  pUnbind: f32,
  nr: u32,
  step: u32,
  pad0: u32,
  pad1: u32,
  pad2: u32,
}
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read_write> mol: array<vec4f>; // [2i] pos + vesicle, [2i+1] state, receptor, …
@group(0) @binding(2) var<storage, read> ves: array<vec4f>;       // [2k] pos + state, [2k+1] age, …
@group(0) @binding(3) var<storage, read> rec: array<vec4f>;
@group(0) @binding(4) var<storage, read_write> occ: array<atomic<i32>>;

fn pcg(n: u32) -> u32 {
  var x = n * 747796405u + 2891336453u;
  x = ((x >> ((x >> 28u) + 4u)) ^ x) * 277803737u;
  return (x >> 22u) ^ x;
}
fn rnd(n: u32) -> f32 { return f32(pcg(n)) / 4294967295.0; }
fn inBall(n: u32) -> vec3f {
  let z = rnd(n) * 2.0 - 1.0;
  let a = rnd(n + 1u) * 6.2831853;
  let r = pow(rnd(n + 2u), 0.333);
  return vec3f(sqrt(1.0 - z * z) * cos(a), sqrt(1.0 - z * z) * sin(a), z) * r;
}

const CL = ${CL};
const RC = ${RC};

@compute @workgroup_size(256)
fn step(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= ${NT}u) { return; }
  var a = mol[i * 2u];
  var b = mol[i * 2u + 1u];
  let k = u32(a.w);
  let v = ves[k * 2u];
  var p = a.xyz;
  for (var sub = 0u; sub < 4u; sub++) {
  let s = pcg((i * 0x9E3779B9u) ^ ((P.step * 4u + sub) * 0x85EBCA6Bu));
  let state = u32(b.x);
  if (state == 0u) {
    // packed in vesicle k; a fusing vesicle opens a pore into the cleft
    if (v.w == 2.0 && ves[k * 2u + 1u].x > 0.06) {
      p = vec3f(v.xy, CL - 0.004) + inBall(s) * vec3f(0.03, 0.03, 0.004);
      b.x = 1.0;
    } else {
      p = v.xyz + inBall(i * 7u) * 0.034;
    }
  } else if (state == 3u) {
    // gone; repacked when its vesicle is refilled
    if (v.w < 1.5) { b.x = 0.0; p = v.xyz; }
  } else if (state == 1u) {
    let g = vec3f(rnd(s) - 0.5, rnd(s + 1u) - 0.5, rnd(s + 2u) - 0.5) * 3.4;
    p += g * P.sigma;
    let r = length(p.xy);
    if (r < RC) {
      if (p.z > CL) { p.z = 2.0 * CL - p.z; }
      if (p.z < -CL) { p.z = -2.0 * CL - p.z; }
      p.z = clamp(p.z, -CL, CL);
    }
    // escaped the cleft: taken up by transporters on the surrounding glia
    if (r > 0.6 || abs(p.z) > 0.4) { b.x = 3.0; }
    // bump into a receptor: maybe bind (each holds at most two)
    if (b.x == 1.0 && p.z < -CL + 0.025 && r < 0.36) {
      for (var j = 0u; j < P.nr; j++) {
        if (distance(p, rec[j].xyz) < 0.032 && rnd(s + 5u + j) < P.pBind) {
          let old = atomicAdd(&occ[j], 1);
          if (old < 2) {
            b.x = 2.0;
            b.y = f32(j);
            break;
          }
          atomicSub(&occ[j], 1);
        }
      }
    }
  } else if (state == 2u) {
    let j = u32(b.y);
    p = rec[j].xyz + (inBall(s) * 0.006) + vec3f(0.0, 0.0, 0.006);
    if (rnd(s + 9u) < P.pUnbind) {
      atomicSub(&occ[j], 1);
      b.x = 1.0;
      p.z += 0.012;
    }
  }
  }
  mol[i * 2u] = vec4f(p, a.w);
  mol[i * 2u + 1u] = b;
}
`;

const RENDER = /* wgsl */ `
@group(0) @binding(1) var<storage, read> mem: array<vec4f>;
@group(0) @binding(2) var<storage, read> ves: array<vec4f>;
@group(0) @binding(3) var<storage, read> mol: array<vec4f>;
@group(0) @binding(4) var<storage, read> rec: array<vec4f>;
@group(0) @binding(5) var<storage, read> occ: array<i32>;

const CL = ${CL};

// cam.q: x = presynaptic flash, y = postsynaptic depolarization (0–1),
//        z = seconds since Ca²⁺ channels opened, w = receptor count

@vertex
fn vsMem(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  let m = mem[ii];
  var col: vec3f;
  if (m.w < 0.5) {
    col = mix(vec3f(0.12, 0.17, 0.6), vec3f(1.0, 0.55, 0.2), cam.q.x) * (0.07 + 0.35 * cam.q.x);
  } else {
    let d = cam.q.y;
    col = mix(vec3f(0.12, 0.17, 0.6), vec3f(0.6, 0.4, 1.0), smoothstep(0.0, 0.5, d));
    col = mix(col, vec3f(1.0, 0.6, 0.2), smoothstep(0.7, 1.0, d)) * (0.07 + 0.25 * d);
  }
  return sprite(m.xyz, 0.0042, vi, col);
}

@vertex
fn vsVesicle(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  let k = ii / 160u;
  let v = ves[k * 2u];
  let v1 = ves[k * 2u + 1u];
  if (v.w > 2.5) { return hidden(); }
  let h = hash3(ii * 3u + 1u) * 2.0 - 1.0;
  var d = normalize(h + vec3f(1e-4));
  var p = v.xyz + d * 0.042;
  var b = 0.16;
  if (v.w == 2.0) {
    // fusing: the vesicle membrane opens and flattens into the active zone
    let f = smoothstep(0.0, 0.5, v1.x);
    p = mix(p, vec3f(v.xy + d.xy * (0.042 + f * 0.06), max(p.z, CL + 0.004)), f);
    b *= 1.0 - f;
  }
  return sprite(p, 0.0035, vi, vec3f(0.75, 0.6, 1.0) * b);
}

@vertex
fn vsMol(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  let a = mol[ii * 2u];
  let b = mol[ii * 2u + 1u];
  let st = u32(b.x);
  if (st == 3u) { return hidden(); }
  var col = vec3f(0.55, 1.0, 0.3);
  var r = 0.0032;
  if (st == 0u) { col *= 0.05; r = 0.0026; }
  else if (st == 1u) { col *= 0.42; }
  else { col = vec3f(0.85, 1.0, 0.6) * 1.1; r = 0.004; }
  return sprite(a.xyz, r, vi, col);
}

@vertex
fn vsReceptor(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  let j = ii / 14u;
  if (f32(j) >= cam.q.w) { return hidden(); }
  let k = ii % 14u;
  let c = rec[j].xyz;
  let o = occ[j];
  let a = f32(k % 7u) / 7.0 * 6.2831853;
  let ring = f32(k / 7u);
  let rr = 0.012 + ring * 0.006;
  let p = c + vec3f(cos(a) * rr, sin(a) * rr, -0.012 - ring * 0.01);
  let col = select(vec3f(0.3, 0.5, 0.9) * 0.25, vec3f(0.8, 1.0, 0.5) * (0.8 + 0.5 * f32(o)), o > 0);
  return sprite(p, 0.0045, vi, col);
}

// Ca²⁺ streaming in through channels around the active zone
@vertex
fn vsCa(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  let t = cam.q.z;
  if (t < 0.0 || t > 1.4) { return hidden(); }
  let ch = ii / 90u;
  let ang = f32(ch) / 6.0 * 6.2831853 + 0.4;
  let base = vec3f(cos(ang) * 0.3, sin(ang) * 0.3, CL);
  let h = hash3(ii * 5u + 9u);
  let life = fract(t * 1.6 + h.x);
  let spread = (h.yz - 0.5) * 0.12 * life;
  let p = base + vec3f(spread, -0.05 + life * 0.22);
  let env = smoothstep(0.0, 0.15, t) * (1.0 - smoothstep(0.7, 1.4, t)) * sin(3.14159 * life);
  return sprite(p, 0.0045, vi, vec3f(1.0, 0.95, 0.65) * env * 0.9);
}

// Na⁺ entering the spine through open receptors
@vertex
fn vsNa(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  let j = ii / 16u;
  if (f32(j) >= cam.q.w || occ[j] <= 0) { return hidden(); }
  let c = rec[j].xyz;
  let h = hash3(ii * 11u + 3u);
  let life = fract(cam.p.x * 1.4 + h.x);
  let a = h.y * 6.2831853;
  let p0 = c + vec3f(cos(a) * 0.03 * h.z, sin(a) * 0.03 * h.z, 0.05 - life * 0.22);
  let p1 = p0 + vec3f(0.0, 0.0, 0.05);
  return streak(p1, p0, 0.0028, vi, vec3f(1.0, 0.55, 0.12) * sin(3.14159 * life) * 1.4);
}
`;

interface Vesicle {
  pos: V3;
  home: V3;
  state: number; // 0 reserve, 1 docked, 2 fusing, 3 empty
  t: number; // time in this state
  dock: number; // dock index while docked
}

export async function mountSynapse3D(container: HTMLElement): Promise<Demo> {
  const stage = await NeuronStage.create(container, {
    aspect: 0.62,
    post: { bloom: 0.24, exposure: 1.1, vignette: 0.4 },
    setup: (o) => {
      o.azimuth = -Math.PI / 2 + 0.4;
      o.elevation = 0.12;
      o.distance = 2.9;
      o.target = [0, 0, 0.04];
      o.sway = 0.4;
    },
  });
  if (!stage) return gpuMissing(container);
  const { device, shell } = stage;
  const rand = rng(5);

  // ---- membranes: bouton above, spine head below, flattened where they face ----
  const memPts: number[] = [];
  const sphere = (c: V3, R: number, count: number, region: number, clampZ: (z: number) => number): void => {
    for (let i = 0; i < count; i++) {
      const z = rand() * 2 - 1;
      const a = rand() * Math.PI * 2;
      const s = Math.sqrt(1 - z * z);
      const r = R * (0.985 + rand() * 0.03);
      memPts.push(c[0] + s * Math.cos(a) * r, c[1] + s * Math.sin(a) * r, clampZ(c[2] + z * r), region);
    }
  };
  const tube = (a: V3, b: V3, r: number, count: number, region: number): void => {
    const d: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const L = Math.hypot(...d);
    const u: V3 = [d[0] / L, d[1] / L, d[2] / L];
    const t0: V3 = Math.abs(u[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
    const n1: V3 = [u[1] * t0[2] - u[2] * t0[1], u[2] * t0[0] - u[0] * t0[2], u[0] * t0[1] - u[1] * t0[0]];
    const l1 = Math.hypot(...n1);
    n1[0] /= l1;
    n1[1] /= l1;
    n1[2] /= l1;
    const n2: V3 = [u[1] * n1[2] - u[2] * n1[1], u[2] * n1[0] - u[0] * n1[2], u[0] * n1[1] - u[1] * n1[0]];
    for (let i = 0; i < count; i++) {
      const t = rand();
      const q = rand() * Math.PI * 2;
      memPts.push(
        a[0] + d[0] * t + (n1[0] * Math.cos(q) + n2[0] * Math.sin(q)) * r,
        a[1] + d[1] * t + (n1[1] * Math.cos(q) + n2[1] * Math.sin(q)) * r,
        a[2] + d[2] * t + (n1[2] * Math.cos(q) + n2[2] * Math.sin(q)) * r,
        region,
      );
    }
  };
  sphere(BOUTON_C, BOUTON_R, 80_000, 0, (z) => Math.max(z, CL));
  sphere(SPINE_C, SPINE_R, 60_000, 1, (z) => Math.min(z, -CL));
  tube([-0.42, 0.05, 0.95], [-1.6, 0.25, 1.45], 0.09, 14_000, 0);
  tube([0, 0, -0.92], [0, 0, -1.5], 0.11, 12_000, 1);
  const memData = new Float32Array(memPts);
  const memCount = memData.length / 4;

  // ---- receptors: a sunflower patch on the postsynaptic density ----
  let nr = 48;
  const recData = new Float32Array(MAX_R * 4);
  for (let j = 0; j < MAX_R; j++) {
    const r = 0.25 * Math.sqrt((j + 0.5) / MAX_R);
    const a = j * 2.39996;
    recData.set([Math.cos(a) * r, Math.sin(a) * r, -CL, 0], j * 4);
  }
  // shuffle so any prefix of the list is spread over the whole patch
  for (let j = MAX_R - 1; j > 0; j--) {
    const k = Math.floor(rand() * (j + 1));
    for (let c = 0; c < 4; c++) [recData[j * 4 + c], recData[k * 4 + c]] = [recData[k * 4 + c], recData[j * 4 + c]];
  }

  // ---- vesicles ----
  const docks: V3[] = [];
  for (let d = 0; d < DOCKS; d++) {
    const a = (d / (d < 5 ? 4 : 4)) * Math.PI * 2 + (d < 5 ? 0 : 0.8);
    const r = d === 0 ? 0 : d < 5 ? 0.12 : 0.22;
    docks.push([Math.cos(a) * r, Math.sin(a) * r, CL + 0.05]);
  }
  const ves: Vesicle[] = [];
  for (let k = 0; k < NV; k++) {
    let p: V3;
    do {
      p = [(rand() * 2 - 1) * 0.42, (rand() * 2 - 1) * 0.42, 0.18 + rand() * 0.5];
    } while (Math.hypot(p[0] - BOUTON_C[0], p[1] - BOUTON_C[1], p[2] - BOUTON_C[2]) > BOUTON_R - 0.1);
    ves.push({ pos: [...p], home: p, state: 0, t: 0, dock: -1 });
  }
  for (let d = 0; d < DOCKS; d++) {
    ves[d].state = 1;
    ves[d].dock = d;
    ves[d].pos = [...docks[d]];
  }
  const vesData = new Float32Array(NV * 8);

  // ---- transmitter ----
  const molInit = new Float32Array(NT * 8);
  for (let i = 0; i < NT; i++) {
    const k = Math.floor(i / PER_VESICLE);
    molInit.set([...ves[k].pos, k, 0, 0, 0, 0], i * 8);
  }

  const memBuf = stage.storage(memData);
  const vesBuf = stage.storage(vesData);
  const molBuf = stage.storage(molInit);
  const recBuf = stage.storage(recData);
  const occBuf = stage.storage(MAX_R * 4, GPUBufferUsage.COPY_SRC);
  const params = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const readback = new Readback(device, MAX_R * 4);

  const cmod = shaderModule(device, COMPUTE, "synapse-compute");
  const pStep = device.createComputePipeline({ layout: "auto", compute: { module: cmod, entryPoint: "step" } });
  const gStep = device.createBindGroup({
    layout: pStep.getBindGroupLayout(0),
    entries: [params, molBuf, vesBuf, recBuf, occBuf].map((buffer, binding) => ({ binding, resource: { buffer } })),
  });
  const pipes = stage.pipelines(RENDER, ["vsMem", "vsVesicle", "vsMol", "vsReceptor", "vsCa", "vsNa"]);
  const gDraw = stage.group([memBuf, vesBuf, molBuf, recBuf, occBuf]);

  // ---- presynaptic spikes and the postsynaptic cell ----
  let pRelease = 0.5;
  const queue: number[] = []; // times of spikes arriving
  let lastSpike = -10;
  let caOpen = -10;
  const fuses: number[] = [];
  let released = 0;
  let vPost = -70;
  let postFired = -10;
  let postSpikes = 0;
  const trace = makeTrace(420);
  const spike = (at = stage.time): void => {
    queue.push(at);
  };

  shell.button("presynaptic spike", () => {
    auto = -1;
    spike();
  });
  shell.button("burst of 5", () => {
    auto = -1;
    for (let i = 0; i < 5; i++) spike(stage.time + i * 0.25);
  });
  shell.slider({
    label: "release probability",
    min: 0.05,
    max: 1,
    step: 0.05,
    value: pRelease,
    format: (v) => `${Math.round(v * 100)}%`,
    onInput: (v) => (pRelease = v),
  });
  shell.slider({
    label: "receptors",
    min: 8,
    max: MAX_R,
    step: 4,
    value: nr,
    format: (v) => `${v}`,
    onInput: (v) => (nr = v),
  });

  const pData = new ArrayBuffer(32);
  const pf = new Float32Array(pData);
  const pu = new Uint32Array(pData);
  let stepCount = 0;
  let auto = 1.2;

  shell.setInfo(
    () =>
      `${NT.toLocaleString()} glutamate molecules · ${NV} vesicles · ${released} released · next cell fired ${postSpikes}×`,
  );

  return {
    frame() {
      stage.begin();
      const t = stage.time;
      const dt = stage.wallDt;

      // a gentle demo loop until someone presses a button
      if (auto > 0) {
        auto -= dt;
        if (auto <= 0) {
          spike();
          auto = 3.2;
        }
      }
      if (queue.length && queue[0] <= t) {
        queue.shift();
        lastSpike = t;
        caOpen = t + 0.12;
        fuses.push(t + 0.25);
      }
      // Ca²⁺ reaches the docked vesicles; each fuses with probability p
      if (fuses.length && t >= fuses[0]) {
        fuses.shift();
        for (const v of ves) {
          if (v.state === 1 && rand() < pRelease) {
            v.state = 2;
            v.t = 0;
            released++;
          }
        }
      }
      // vesicle lifecycle
      const freeDocks = new Set(docks.map((_, i) => i));
      for (const v of ves) if (v.state === 1 || (v.state === 0 && v.dock >= 0)) freeDocks.delete(v.dock);
      for (const v of ves) {
        v.t += dt;
        if (v.state === 2 && v.t > 0.6) {
          v.state = 3;
          v.t = 0;
          v.dock = -1;
        } else if (v.state === 3 && v.t > 2.5) {
          v.state = 0;
          v.t = 0;
          v.pos = [...v.home];
        } else if (v.state === 0) {
          if (v.dock < 0 && freeDocks.size && rand() < dt * 3) {
            v.dock = [...freeDocks][0];
            freeDocks.delete(v.dock);
          }
          const target = v.dock >= 0 ? docks[v.dock] : v.home;
          for (let c = 0; c < 3; c++) v.pos[c] += (target[c] - v.pos[c]) * Math.min(1, dt * (v.dock >= 0 ? 5 : 0.5));
          if (v.dock >= 0 && Math.hypot(v.pos[0] - target[0], v.pos[1] - target[1], v.pos[2] - target[2]) < 0.01)
            v.state = 1;
          // reserve vesicles drift a little
          if (v.dock < 0) for (let c = 0; c < 3; c++) v.pos[c] += Math.sin(t * 0.7 + v.home[c] * 9) * 0.0006;
        }
      }
      for (let k = 0; k < NV; k++) {
        const v = ves[k];
        vesData.set([...v.pos, v.state, v.t, 0, 0, 0], k * 8);
      }
      device.queue.writeBuffer(vesBuf, 0, vesData);

      // the postsynaptic membrane: leak toward −70, pulled toward 0 by open receptors
      const occ = new Int32Array(readback.latest.buffer);
      let open = 0;
      for (let j = 0; j < nr; j++) if (occ[j] > 0) open++;
      if (t - postFired < 0.18) vPost = 25 - (t - postFired) * 500;
      else {
        const g = open * 0.015;
        vPost += ((-(vPost + 70) - g * (vPost - 0)) / 0.55) * dt;
        if (vPost > -55) {
          postFired = t;
          postSpikes++;
        }
      }
      pushTrace(trace, vPost);

      pf[0] = 0.05;
      pf[1] = 0.02;
      pf[2] = 0.1;
      pu[3] = nr;
      stage.q = [Math.exp(-(t - lastSpike) * 3), Math.min(1, Math.max(0, (vPost + 70) / 95)), t - caOpen, nr];

      pu[4] = stepCount++;
      device.queue.writeBuffer(params, 0, pData);
      stage.render(
        (enc) => {
          // four diffusion substeps per frame, looped inside the kernel
          const pass = enc.beginComputePass();
          pass.setPipeline(pStep);
          pass.setBindGroup(0, gStep);
          pass.dispatchWorkgroups(Math.ceil(NT / 256));
          pass.end();
        },
        (pass) => {
          pass.setBindGroup(0, gDraw);
          pass.setPipeline(pipes.vsMem);
          pass.draw(6, memCount);
          pass.setPipeline(pipes.vsVesicle);
          pass.draw(6, NV * 160);
          pass.setPipeline(pipes.vsMol);
          pass.draw(6, NT);
          pass.setPipeline(pipes.vsReceptor);
          pass.draw(6, MAX_R * 14);
          pass.setPipeline(pipes.vsCa);
          pass.draw(6, 6 * 90);
          pass.setPipeline(pipes.vsNa);
          pass.draw(6, MAX_R * 16);
        },
        (enc) => readback.copy(enc, occBuf),
      );

      // HUD
      stage.clearHud();
      const g = stage.g;
      const s = stage.px;
      const c = stage.compact;
      hudLabel(stage, [-0.5, 0, 0.62], c ? "bouton" : "presynaptic bouton", [-70, -24]);
      if (!c) hudLabel(stage, docks[3], "docked vesicles", [-90, -46]);
      if (!c) hudLabel(stage, [0.42, 0, 0], "cleft (really 20 nm)", [40, -8]);
      hudLabel(stage, [0.12, 0.05, -CL], c ? "receptors" : "glutamate receptors", [70, 30]);
      hudLabel(stage, [-0.42, 0, -0.62], c ? "spine" : "dendritic spine", [-70, 30]);
      drawScope(
        stage,
        stage.corner(250, 100),
        [{ trace, color: "#b892ff" }],
        [-75, 30],
        [
          { v: -70, label: "rest" },
          { v: -55, label: "threshold", color: "rgba(255, 184, 107, 0.35)" },
        ],
        "postsynaptic voltage",
      );
      g.font = `600 ${10.5 * s}px ${HUD_FONT}`;
      g.textBaseline = "alphabetic";
      g.fillStyle = "rgba(200, 210, 235, 0.75)";
      g.fillText(`${open} of ${nr} receptors open`, 16 * s, 22 * s);
      if (t - postFired < 1.2) {
        g.fillStyle = `rgba(255, 184, 107, ${1 - (t - postFired) / 1.2})`;
        g.font = `700 ${13 * s}px ${HUD_FONT}`;
        g.fillText("THE NEXT CELL FIRES", 16 * s, 44 * s);
      }
      shell.tick();
    },
  };
}
