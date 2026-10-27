// A patch of cortex: tens of thousands of leaky integrate-and-fire neurons,
// four in five excitatory and one in five inhibitory, each wired to a hundred
// near neighbours with delays that grow with distance. Everything runs on
// the GPU: one thread per neuron integrates its voltage, and a neuron that
// fires adds its weight into each target's future input through a ring
// buffer of delays. The streaks are spikes in flight along a sample of the
// connections.
//
// The dynamics are Brunel's (2000) sparse random network. With inhibition
// strong enough, the network sits in an asynchronous irregular state —
// every cell firing now and then, the population never in step. Weaken it
// and the excitation feeds on itself: synchronous waves, then a seizure.

import { gpuMissing, type Demo } from "../../lib/demoShell";
import { rng } from "../../lib/neuron/morphology";
import {
  NeuronStage,
  Readback,
  drawScope,
  makeTrace,
  pushTrace,
  shaderModule,
  HUD_FONT,
  raySegment,
  type V3,
} from "../../lib/neuron/stage";

const K = 100; // outgoing synapses per neuron
const SHOWN = 10; // of which this many are drawn
const D = 64; // ring-buffer slots (max delay + 1, in steps)
const DT = 0.1; // ms per step
const SAMPLE = 200; // neurons in the raster

const COMPUTE = /* wgsl */ `
struct Params {
  n: u32,
  pad0: u32,
  pad1: u32,
  pad2: u32,
  tau: f32,
  theta: f32,
  vreset: f32,
  tref: f32,
  jE: f32,
  g: f32,
  pExt: f32,
  pad3: f32,
}
struct Clock {
  step: u32,
  t: f32,
}
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(6) var<storage, read_write> clock: Clock;
@group(0) @binding(1) var<storage, read_write> V: array<vec4f>;   // v, refractory left, last spike (ms), type
@group(0) @binding(2) var<storage, read> syn: array<u32>;         // target | delay << 20
@group(0) @binding(3) var<storage, read_write> ring: array<atomic<i32>>;
@group(0) @binding(4) var<storage, read_write> kick: array<i32>;
@group(0) @binding(5) var<storage, read_write> count: array<atomic<u32>>;

fn pcg(n: u32) -> u32 {
  var x = n * 747796405u + 2891336453u;
  x = ((x >> ((x >> 28u) + 4u)) ^ x) * 277803737u;
  return (x >> 22u) ^ x;
}
fn rnd(n: u32) -> f32 { return f32(pcg(n)) / 4294967295.0; }

@compute @workgroup_size(256)
fn step(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= P.n) { return; }
  let now = clock.step;
  let slot = now % ${D}u;
  // recurrent input that has arrived this step (fixed point, µV)
  var inp = f32(atomicExchange(&ring[slot * P.n + i], 0)) * 0.001;
  inp += f32(kick[i]) * 0.001;
  kick[i] = 0;
  // external drive: Poisson spikes from outside the patch
  let s = pcg((i * 0x9E3779B9u) ^ (now * 0x85EBCA6Bu));
  if (rnd(s) < P.pExt) { inp += P.jE; }
  if (rnd(s + 1u) < P.pExt * 0.5) { inp += P.jE; }

  var c = V[i];
  if (c.y > 0.0) {
    c.y -= ${DT};
    c.x = P.vreset;
  } else {
    c.x += (-c.x / P.tau) * ${DT} + inp;
    if (c.x >= P.theta) {
      c.x = P.vreset;
      c.y = P.tref;
      c.z = clock.t;
      atomicAdd(&count[0], 1u);
      let w = i32(select(P.jE, -P.g * P.jE, c.w > 0.5) * 1000.0);
      for (var k = 0u; k < ${K}u; k++) {
        let e = syn[i * ${K}u + k];
        let tgt = e & 0xFFFFFu;
        let d = e >> 20u;
        atomicAdd(&ring[((now + d) % ${D}u) * P.n + tgt], w);
      }
    }
  }
  V[i] = c;
}

@compute @workgroup_size(1)
fn tick() {
  clock.step += 1u;
  clock.t += ${DT};
}
`;

const RENDER = /* wgsl */ `
@group(0) @binding(1) var<storage, read> pos: array<vec4f>;  // xyz, type
@group(0) @binding(2) var<storage, read> V: array<vec4f>;
@group(0) @binding(3) var<storage, read> syn: array<u32>;

// cam.q: x = sim time (ms), y = theta, z = ms per second on screen

fn typeColor(inh: bool) -> vec3f {
  return select(vec3f(1.0, 0.62, 0.22), vec3f(0.3, 0.75, 1.0), inh);
}

@vertex
fn vsNeuron(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  let p = pos[ii];
  let c = V[ii];
  let inh = p.w > 0.5;
  let age = cam.q.x - c.z;
  let flash = exp(-max(age, 0.0) / 3.0) * select(0.0, 1.0, c.z > -1e8);
  let sub = clamp(c.x / cam.q.y, 0.0, 1.0);
  let col = typeColor(inh) * (0.05 + 0.12 * sub * sub + flash * 2.4) + vec3f(1.0, 0.95, 0.85) * flash * 0.5;
  return sprite(p.xyz, 0.0075 + 0.008 * flash, vi, col);
}

// spikes in flight along the first few connections of every neuron
@vertex
fn vsSpike(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  let src = ii / ${SHOWN}u;
  let k = ii % ${SHOWN}u;
  let c = V[src];
  let e = syn[src * ${K}u + k];
  let tgt = e & 0xFFFFFu;
  let d = f32(e >> 20u) * ${DT};
  let ph = (cam.q.x - c.z) / d;
  if (ph <= 0.0 || ph >= 1.0) { return hidden(); }
  let a = pos[src].xyz;
  let b = pos[tgt].xyz;
  let inh = pos[src].w > 0.5;
  let head = mix(a, b, ph);
  let tail = mix(a, b, max(0.0, ph - 0.35));
  let env = smoothstep(0.0, 0.1, ph) * (1.0 - smoothstep(0.85, 1.0, ph));
  return streak(tail, head, 0.0032, vi, typeColor(inh) * env * 1.8);
}
`;

interface Net {
  n: number;
  pos: Float32Array;
  syn: Uint32Array;
  inh: Uint8Array;
}

// A gently curved slab of cortex, six layers deep. Targets are drawn from a
// Gaussian neighbourhood (via a coarse grid), delays from distance.
function buildNet(n: number, seed: number): Net {
  const rand = rng(seed);
  const pos = new Float32Array(n * 4);
  const inh = new Uint8Array(n);
  const LAYERS = [0.08, 0.26, 0.22, 0.18, 0.16, 0.1]; // share of cells per layer
  const cum = LAYERS.map((_, i) => LAYERS.slice(0, i + 1).reduce((a, b) => a + b, 0));
  for (let i = 0; i < n; i++) {
    const x = (rand() * 2 - 1) * 1.7;
    const y = (rand() * 2 - 1) * 1.05;
    const r = rand();
    const L = cum.findIndex((c) => r <= c);
    const zl = 0.32 - (L + rand()) * (0.64 / 6);
    const z = zl + 0.22 * Math.cos(x * 1.1) - 0.1;
    inh[i] = rand() < 0.2 ? 1 : 0;
    pos.set([x, y, z, inh[i]], i * 4);
  }
  // grid for neighbour sampling
  const cell = 0.18;
  const gx = Math.ceil(3.6 / cell);
  const gy = Math.ceil(2.3 / cell);
  const gz = Math.ceil(1.2 / cell);
  const key = (x: number, y: number, z: number): number => {
    const ix = Math.min(gx - 1, Math.max(0, Math.floor((x + 1.8) / cell)));
    const iy = Math.min(gy - 1, Math.max(0, Math.floor((y + 1.15) / cell)));
    const iz = Math.min(gz - 1, Math.max(0, Math.floor((z + 0.6) / cell)));
    return (iz * gy + iy) * gx + ix;
  };
  const buckets: number[][] = Array.from({ length: gx * gy * gz }, () => []);
  for (let i = 0; i < n; i++) buckets[key(pos[i * 4], pos[i * 4 + 1], pos[i * 4 + 2])].push(i);
  const syn = new Uint32Array(n * K);
  const sigma = 0.3;
  for (let i = 0; i < n; i++) {
    const x = pos[i * 4];
    const y = pos[i * 4 + 1];
    const z = pos[i * 4 + 2];
    for (let k = 0; k < K; k++) {
      let j = -1;
      for (let tries = 0; tries < 12 && j < 0; tries++) {
        const u = Math.sqrt(-2 * Math.log(rand() || 1e-9));
        const a = rand() * Math.PI * 2;
        const b = Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(rand() * Math.PI * 2);
        const bucket = buckets[key(x + u * Math.cos(a) * sigma, y + u * Math.sin(a) * sigma, z + b * sigma * 0.5)];
        if (bucket.length) j = bucket[Math.floor(rand() * bucket.length)];
        if (j === i) j = -1;
      }
      if (j < 0) j = Math.floor(rand() * n);
      const d = Math.hypot(pos[j * 4] - x, pos[j * 4 + 1] - y, pos[j * 4 + 2] - z);
      // ~0.5 ms synaptic delay plus conduction at ~0.25 units/ms
      const steps = Math.min(D - 1, Math.max(5, Math.round((0.5 + d / 0.25) / DT)));
      syn[i * K + k] = j | (steps << 20);
    }
  }
  return { n, pos, syn, inh };
}

export async function mountNetwork(container: HTMLElement): Promise<Demo> {
  const stage = await NeuronStage.create(container, {
    aspect: 0.6,
    post: { bloom: 0.3, exposure: 1.1, vignette: 0.45 },
    setup: (o) => {
      o.azimuth = -Math.PI / 2 + 0.45;
      o.elevation = 0.42;
      o.distance = 4.2;
      o.target = [0.35, 0.1, -0.2];
      o.sway = 0.4;
      o.swaySpeed = 0.03;
    },
  });
  if (!stage) return gpuMissing(container);
  const { device, shell } = stage;

  let n = 20_000;
  let g = 6; // inhibition relative to excitation
  let drive = 0.95; // external input, in units of what it takes to reach threshold alone
  let rate = 12; // ms of cortex time per second on screen
  const THETA = 20;
  const TAU = 20;
  const J = 0.6;

  const cmod = shaderModule(device, COMPUTE, "network-compute");
  const pStep = device.createComputePipeline({ layout: "auto", compute: { module: cmod, entryPoint: "step" } });
  const pTick = device.createComputePipeline({ layout: "auto", compute: { module: cmod, entryPoint: "tick" } });
  const clock = stage.storage(16);
  const pipes = stage.pipelines(RENDER, ["vsNeuron", "vsSpike"]);
  const params = device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const count = stage.storage(16, GPUBufferUsage.COPY_SRC);
  const countRb = new Readback(device, 16);
  const sampleRb = new Readback(device, SAMPLE * 16);

  let net: Net;
  let posBuf: GPUBuffer, vBuf: GPUBuffer, synBuf: GPUBuffer, ringBuf: GPUBuffer, kickBuf: GPUBuffer;
  let gStep: GPUBindGroup, gTick: GPUBindGroup, gDraw: GPUBindGroup;
  let t = 0;

  const build = (): void => {
    for (const b of [posBuf, vBuf, synBuf, ringBuf, kickBuf]) b?.destroy();
    net = buildNet(n, 3);
    posBuf = stage.storage(net.pos);
    const v0 = new Float32Array(n * 4);
    const r = rng(17);
    for (let i = 0; i < n; i++) v0.set([r() * THETA, 0, -1e9, net.inh[i]], i * 4);
    vBuf = stage.storage(v0, GPUBufferUsage.COPY_SRC);
    synBuf = stage.storage(net.syn);
    ringBuf = stage.storage(D * n * 4);
    kickBuf = stage.storage(n * 4);
    gStep = device.createBindGroup({
      layout: pStep.getBindGroupLayout(0),
      entries: [params, vBuf, synBuf, ringBuf, kickBuf, count, clock].map((buffer, binding) => ({
        binding,
        resource: { buffer },
      })),
    });
    gTick = device.createBindGroup({
      layout: pTick.getBindGroupLayout(0),
      entries: [{ binding: 6, resource: { buffer: clock } }],
    });
    device.queue.writeBuffer(clock, 0, new Uint32Array(4));
    gDraw = stage.group([posBuf, vBuf, synBuf]);
    t = 0;
  };
  build();

  shell.slider({
    label: "inhibition",
    min: 0,
    max: 8,
    step: 0.1,
    value: g,
    format: (v) => `${v.toFixed(1)}× excitation`,
    onInput: (v) => (g = v),
  });
  shell.slider({
    label: "outside input",
    min: 0.4,
    max: 3,
    step: 0.05,
    value: drive,
    format: (v) => `${v.toFixed(2)}×`,
    onInput: (v) => (drive = v),
  });
  let rebuildTimer = 0;
  shell.slider({
    label: "neurons",
    min: 2_000,
    max: 100_000,
    step: 1_000,
    log: true,
    value: n,
    format: (v) => `${Math.round(v / 1000)}k`,
    onInput: (v) => {
      n = v;
      clearTimeout(rebuildTimer);
      rebuildTimer = window.setTimeout(build, 300);
    },
  });
  shell.slider({
    label: "slow motion",
    min: 5,
    max: 200,
    step: 1,
    log: true,
    value: rate,
    format: (v) => `1 s = ${Math.round(v)} ms`,
    onInput: (v) => (rate = v),
  });

  // click: a burst of input to every cell near the pointer
  stage.orbit.onClick = (nx, ny) => {
    const { o, d } = stage.ray(nx, ny);
    const far: V3 = [o[0] + d[0] * 20, o[1] + d[1] * 20, o[2] + d[2] * 20];
    const kick = new Int32Array(n);
    let hit = 0;
    for (let i = 0; i < n; i++) {
      const p: V3 = [net.pos[i * 4], net.pos[i * 4 + 1], net.pos[i * 4 + 2]];
      if (raySegment(p, [0, 0, 0], o, far).d2 < 0.2 * 0.2) {
        kick[i] = 40_000;
        hit++;
      }
    }
    if (hit) device.queue.writeBuffer(kickBuf, 0, kick);
  };

  const rateTrace = makeTrace(300);
  const raster: { t: number; i: number }[] = [];
  const lastSample = new Float32Array(SAMPLE).fill(-1e9);
  let lastCount = 0;
  let hz = 0;
  let smooth = 0;
  const pData = new ArrayBuffer(48);
  const pu = new Uint32Array(pData);
  const pf = new Float32Array(pData);
  let carry = 0;

  shell.setInfo(
    () =>
      `${n.toLocaleString()} neurons · ${((n * K) / 1e6).toFixed(1)}M synapses · ${hz.toFixed(1)} Hz average · click to stimulate a region`,
  );

  return {
    frame() {
      stage.begin();
      carry += (rate * stage.wallDt) / DT;
      const steps = Math.min(200, Math.floor(carry));
      carry -= steps;
      // external Poisson input: drive × the rate that alone would hold the mean at threshold
      const pExt = Math.min(0.9, (((drive * THETA) / (J * TAU)) * DT) / 1.5);

      stage.render(
        (enc) => {
          pu[0] = n;
          pf.set([TAU, THETA, 10, 2, J, g, pExt, 0], 4);
          device.queue.writeBuffer(params, 0, pData);
          const pass = enc.beginComputePass();
          for (let s = 0; s < steps; s++) {
            pass.setPipeline(pStep);
            pass.setBindGroup(0, gStep);
            pass.dispatchWorkgroups(Math.ceil(n / 256));
            pass.setPipeline(pTick);
            pass.setBindGroup(0, gTick);
            pass.dispatchWorkgroups(1);
          }
          pass.end();
          t += steps * DT;
        },
        (pass) => {
          pass.setBindGroup(0, gDraw);
          pass.setPipeline(pipes.vsSpike);
          pass.draw(6, n * SHOWN);
          pass.setPipeline(pipes.vsNeuron);
          pass.draw(6, n);
        },
        (enc) => {
          const a = countRb.copy(enc, count);
          const b = sampleRb.copy(enc, vBuf);
          return () => {
            a?.();
            b?.();
          };
        },
      );
      stage.q = [t, THETA, rate, 0];

      // population rate and raster from the readbacks
      const total = new Uint32Array(countRb.latest.buffer)[0];
      const dCount = total - lastCount;
      lastCount = total;
      const ms = rate * stage.wallDt || 1;
      if (dCount >= 0) {
        const inst = (dCount / n / ms) * 1000;
        hz += (inst - hz) * 0.05;
        smooth += (inst - smooth) * 0.3;
        pushTrace(rateTrace, smooth);
      }
      const smp = sampleRb.latest;
      for (let i = 0; i < SAMPLE; i++) {
        const ts = smp[i * 4 + 2];
        if (ts > lastSample[i] && ts > -1e8) {
          lastSample[i] = ts;
          raster.push({ t: ts, i });
        }
      }
      while (raster.length && raster[0].t < t - 300) raster.shift();

      // HUD: raster and population rate
      stage.clearHud();
      const gx = stage.g;
      const s = stage.px;
      const rateBox = stage.corner(280, 60);
      drawScope(stage, rateBox, [{ trace: rateTrace, color: "#ffb86b", width: 1.2 }], [0, 80], [], "population rate");
      // the raster sits above the rate, on screens with room for it
      const box = { ...rateBox, y: rateBox.y - 96 * s, h: 90 * s };
      const pad = 8 * s;
      if (!stage.compact) {
        gx.fillStyle = "rgba(8, 9, 15, 0.62)";
        gx.strokeStyle = "rgba(122, 162, 255, 0.16)";
        gx.beginPath();
        gx.roundRect(box.x, box.y, box.w, 90 * s, 8 * s);
        gx.fill();
        gx.stroke();
        gx.fillStyle = "rgba(200, 210, 235, 0.7)";
        gx.font = `600 ${9.5 * s}px ${HUD_FONT}`;
        gx.textBaseline = "middle";
        gx.fillText("spikes from 200 cells, last 300 ms", box.x + pad, box.y + pad + 3 * s);
        const top = box.y + 20 * s;
        const hh = 64 * s;
        for (const r of raster) {
          const x = box.x + pad + ((r.t - (t - 300)) / 300) * (box.w - pad * 2);
          const y = top + (r.i / SAMPLE) * hh;
          gx.fillStyle = net.inh[r.i] ? "rgba(77, 191, 255, 0.9)" : "rgba(255, 200, 140, 0.85)";
          gx.fillRect(x, y, 1.6 * s, 1.6 * s);
        }
      }
      gx.font = `600 ${10.5 * s}px ${HUD_FONT}`;
      gx.textBaseline = "alphabetic";
      gx.fillStyle = "rgba(255, 184, 107, 0.9)";
      gx.fillText("● excitatory", 16 * s, 22 * s);
      gx.fillStyle = "rgba(77, 191, 255, 0.9)";
      gx.fillText("● inhibitory", 100 * s, 22 * s);
      const state =
        hz > 60 ? "RUNAWAY — a seizure" : hz < 0.3 ? "silent" : g < 3.5 ? "excitation-dominated" : "balanced";
      gx.fillStyle = hz > 60 ? "rgba(255, 120, 100, 0.95)" : "rgba(200, 210, 235, 0.75)";
      gx.fillText(state.toUpperCase(), 16 * s, 40 * s);
      shell.tick();
    },
  };
}
