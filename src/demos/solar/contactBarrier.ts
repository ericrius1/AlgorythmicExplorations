// Step 5: lining up the hole contact, as a band diagram in 3D. Across the figure runs the perovskite's valence band,
// then the hole contact (the monolayer), then the electrode; height is a hole's energy, so a contact level below the
// perovskite's band is a step up and one above it is a drop. Every hole the light frees walks across the band (a
// random walk with a gentle drift toward the contact). A step up it takes only with the Boltzmann chance e^(−ΔE/kT)
// of having that much thermal energy at that moment — the same rule as the ion channels in Spark & Signal — so a
// step of a few kT holds most of them back; a drop it always takes, and the energy it falls is lost from the
// voltage, the orange sparks. Holes that wait recombine, more of them where they crowd (a density grid counts
// them every frame). The tallies — how many got out, how far they fell — are the figure's whole answer.

import { gpuMissing, type Demo } from "../../lib/demoShell";
import { NeuronStage, Readback, hudLabel, shaderModule } from "../../lib/neuron/stage";
import { SOLAR_WGSL, hudScale, miniCurve, text } from "../../lib/solar/lab";
import { KT } from "./physics";

const COUNT = 50_000;
const GX = 40;
const GY = 16;
// the band: perovskite from x0 to x1, the monolayer to x2, the electrode beyond
const X0 = -1.25;
const X1 = 0.25;
const X2 = 0.42;
const X3 = 1.1;
const HY = 0.55;
const ESCALE = 1.6; // display units per eV
const GAP = 1.68;
const VOC0 = 1.25;
const JSC = 20;
const JX = 2e4;

const COMPUTE = /* wgsl */ `
struct Params {
  offset: f32,  // contact level minus the perovskite's band, eV (+ a drop, − a step up)
  kT: f32,
  dt: f32,
  count: u32,
  seed: u32,
  recomb: f32,  // chance per step for a hole alone; more where they crowd
  crowd: f32,
  drift: f32,
}
struct H { a: vec4f, b: vec4f } // a: x, y, energy jitter, age · b: last event x, y, kind (0 born, 1 out, 2 recombined, 3 fell), time since
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read_write> hs: array<H>;
@group(0) @binding(2) var<storage, read_write> grid: array<atomic<u32>>;
@group(0) @binding(3) var<storage, read_write> cnt: array<atomic<u32>>;
// cnt: 0 born, 1 out, 2 recombined, 3 energy fallen (meV), 4 steps taken up, 5 steps refused

fn band(x: f32) -> f32 {
  if (x < ${X1.toFixed(3)}) { return 0.0; }
  return -P.offset;
}
fn cell(x: f32, y: f32) -> u32 {
  let gx = u32(clamp((x - ${X0.toFixed(3)}) / (${(X2 - X0).toFixed(3)}) * ${GX}.0, 0.0, ${GX - 1}.0));
  let gy = u32(clamp((y + ${HY.toFixed(3)}) / ${(2 * HY).toFixed(3)} * ${GY}.0, 0.0, ${GY - 1}.0));
  return gy * ${GX}u + gx;
}
fn spawnAt(i: u32, k: u32) -> vec2f {
  return vec2f(mix(${X0.toFixed(3)}, ${X1.toFixed(3)}, rnd(i, k, 1u)), (rnd(i, k, 2u) * 2.0 - 1.0) * ${HY.toFixed(3)});
}

@compute @workgroup_size(256)
fn clearGrid(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x < ${GX * GY}u) { atomicStore(&grid[gid.x], 0u); }
}

@compute @workgroup_size(256)
fn countGrid(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= P.count) { return; }
  let h = hs[i];
  if (h.a.x < ${X2.toFixed(3)}) { atomicAdd(&grid[cell(h.a.x, h.a.y)], 1u); }
}

@compute @workgroup_size(256)
fn walk(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= P.count) { return; }
  var h = hs[i];
  h.b.w += P.dt;
  let k = P.seed;
  let sigma = 0.02;
  var x = h.a.x;
  var y = h.a.y;
  let e0 = band(x);
  // a step: jostled, drifting toward the contact
  var nx = x + P.drift + gauss(i, k, 3u) * sigma;
  var ny = y + gauss(i, k, 4u) * sigma;
  ny = clamp(ny, -${HY.toFixed(3)}, ${HY.toFixed(3)});
  nx = max(nx, ${X0.toFixed(3)});
  let e1 = band(nx);
  let dE = e1 - e0;
  if (dE > 0.0) {
    // up a step: only with the Boltzmann chance of having that much energy to spare
    if (rnd(i, k, 5u) < exp(-dE / P.kT)) { x = nx; y = ny; atomicAdd(&cnt[4], 1u); } else { y = ny; atomicAdd(&cnt[5], 1u); }
  } else {
    // (a drop taken going forward is voltage given up; stepping back down into the perovskite isn't)
    if (dE < -0.001 && nx > x) {
      atomicAdd(&cnt[3], u32(-dE * 1000.0));
      h.b = vec4f(nx, ny, 3.0, 0.0);
    }
    x = nx;
    y = ny;
  }
  // its thermal energy right now (drawn as how far it floats above the band)
  h.a.z = -log(max(rnd(i, k, 6u), 1e-6)) * P.kT;
  h.a.w += P.dt;
  var reborn = false;
  if (x > ${X3.toFixed(3)} - 0.3) {
    atomicAdd(&cnt[1], 1u);
    h.b = vec4f(x, y, 1.0, 0.0);
    reborn = true;
  } else if (x < ${X2.toFixed(3)}) {
    // recombination: a steady chance, more where holes crowd
    let n = f32(atomicLoad(&grid[cell(x, y)]));
    let pr = P.recomb * (1.0 + P.crowd * n);
    if (rnd(i, k, 7u) < pr) {
      atomicAdd(&cnt[2], 1u);
      h.b = vec4f(x, y, 2.0, 0.0);
      reborn = true;
    }
  }
  if (reborn) {
    let p = spawnAt(i, k + 977u);
    x = p.x;
    y = p.y;
    h.a.w = 0.0;
    atomicAdd(&cnt[0], 1u);
  }
  h.a.x = x;
  h.a.y = y;
  hs[i] = h;
}
`;

const RENDER = /* wgsl */ `
struct H { a: vec4f, b: vec4f }
@group(0) @binding(1) var<storage, read> hs: array<H>;
@group(0) @binding(2) var<storage, read> geo: array<vec4f>;
// geo[0]: offset (eV), display units per eV, gap, kT

fn bandZ(x: f32) -> f32 {
  if (x < ${X1.toFixed(3)}) { return 0.0; }
  return -geo[0].x * geo[0].y;
}

@vertex
fn vsHole(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  let h = hs[ii];
  let z = bandZ(h.a.x) + h.a.z * geo[0].y;
  let fresh = exp(-h.a.w * 3.0);
  let col = mix(vec3f(1.0, 0.42, 0.72) * 0.4, vec3f(1.0, 0.92, 0.95), fresh * 0.6);
  return sprite(vec3f(h.a.x, h.a.y, z), 0.0058, vi, col);
}

// events: out through the electrode (a glint), recombined (a violet glow), fell down a drop (orange sparks)
@vertex
fn vsEvent(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  let h = hs[ii / 3u];
  let t = h.b.w;
  if (t > 0.4) { return hidden(); }
  let kind = u32(h.b.z);
  let k = ii % 3u;
  let at = vec3f(h.b.x, h.b.y, bandZ(h.b.x));
  if (kind == 1u) {
    if (k > 0u) { return hidden(); }
    return sprite(at, 0.01, vi, vec3f(0.95, 0.8, 1.0) * exp(-t * 10.0) * 0.8);
  }
  if (kind == 2u) {
    if (k > 0u) { return hidden(); }
    return sprite(at + vec3f(0.0, 0.0, 0.02), 0.012 + t * 0.03, vi, vec3f(0.62, 0.38, 1.0) * exp(-t * 8.0) * 0.9);
  }
  if (kind == 3u) {
    let dir = normalize(hash3(ii * 13u + 5u) * 2.0 - vec3f(1.0, 1.0, 0.2));
    let r = 0.01 + t * 0.12;
    let fall = max(0.0, geo[0].x);
    return streak(at + dir * r * 0.4, at + dir * r, 0.0035, vi, vec3f(1.0, 0.45, 0.12) * (0.4 + fall * 6.0) * exp(-t * 7.0));
  }
  return hidden();
}

// the bands as sheets of dots: the perovskite's valence band, the contact level, the electrode; and far above, the
// conduction band a gap's worth higher (where the electrons are, leaving the other way)
@vertex
fn vsBand(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  let h = hash3(ii * 2654435761u + 17u);
  let x = mix(${X0.toFixed(3)}, ${X3.toFixed(3)}, h.x);
  let y = (h.y * 2.0 - 1.0) * ${HY.toFixed(3)};
  let cb = ii % 5u == 0u;
  var z = bandZ(x);
  var col = vec3f(0.37, 0.88, 0.66) * 0.12;
  if (x >= ${X1.toFixed(3)} && x < ${X2.toFixed(3)}) { col = vec3f(0.9, 0.85, 1.0) * 0.2; }
  if (x >= ${X2.toFixed(3)}) { col = vec3f(0.6, 0.65, 0.8) * 0.1; }
  if (cb) {
    if (x > ${X1.toFixed(3)}) { return hidden(); }
    z = 0.62;
    col = vec3f(0.3, 0.75, 1.0) * 0.1;
  }
  return sprite(vec3f(x, y, z), 0.004, vi, col);
}

// the step itself: a curtain of dots where the band changes level
@vertex
fn vsStep(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  let h = hash3(ii * 2246822519u + 3u);
  let y = (h.y * 2.0 - 1.0) * ${HY.toFixed(3)};
  let z = -geo[0].x * geo[0].y * h.x;
  let up = geo[0].x < 0.0;
  let col = select(vec3f(1.0, 0.55, 0.25), vec3f(0.85, 0.5, 1.0), up) * 0.14;
  return sprite(vec3f(${X1.toFixed(3)}, y, z), 0.004, vi, col);
}
`;

export async function mountContactBarrier(container: HTMLElement): Promise<Demo> {
  const stage = await NeuronStage.create(container, {
    aspect: 0.6,
    post: { bloom: 0.24, exposure: 1.1, vignette: 0.4 },
    setup: (o) => {
      o.azimuth = -Math.PI / 2 + 0.42;
      o.elevation = 0.38;
      o.distance = 2.45;
      o.target = [0.0, 0, 0.12];
      o.sway = 0.22;
      o.swaySpeed = 0.035;
    },
  });
  if (!stage) return gpuMissing(container);
  const { device, shell } = stage;
  const params = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const hs = stage.storage(COUNT * 32);
  const grid = stage.storage(GX * GY * 4);
  const cnt = stage.storage(32, GPUBufferUsage.COPY_SRC);
  const geo = stage.storage(16);
  const readback = new Readback(device, 32);
  const mod = shaderModule(device, SOLAR_WGSL + COMPUTE, "contact");
  const pipe = (entryPoint: string): GPUComputePipeline => device.createComputePipeline({ layout: "auto", compute: { module: mod, entryPoint } });
  const pClear = pipe("clearGrid");
  const pCount = pipe("countGrid");
  const pWalk = pipe("walk");
  const all = [params, hs, grid, cnt];
  const bind = (p: GPUComputePipeline, used: number[]): GPUBindGroup =>
    device.createBindGroup({ layout: p.getBindGroupLayout(0), entries: used.map((b) => ({ binding: b, resource: { buffer: all[b] } })) });
  const gClear = bind(pClear, [2]);
  const gCount = bind(pCount, [0, 1, 2]);
  const gWalk = bind(pWalk, [0, 1, 2, 3]);
  const render = stage.pipelines(SOLAR_WGSL + RENDER, ["vsBand", "vsStep", "vsHole", "vsEvent"]);
  const gDraw = stage.group([hs, geo]);
  {
    const d = new Float32Array(COUNT * 8);
    for (let i = 0; i < COUNT; i++) d.set([X0 + Math.random() * (X1 - X0), (Math.random() * 2 - 1) * HY, 0, 1, 0, 0, 0, 9], i * 8);
    device.queue.writeBuffer(hs, 0, d);
  }

  let offset = 0;
  // the tally since the level was last moved
  let born = 0;
  let out = 0;
  let rec = 0;
  let fell = 0;
  let last: Uint32Array | null = null;
  let skip = 0;
  // what was measured at each level, to plot over the model
  const points = new Map<number, number>();

  /** the model from before (a Boltzmann-limited extraction current in series with the diode), as a share of the
   *  aligned cell's power: the reference the counts are drawn against */
  const modelP = (off: number): number => {
    const run = (o: number): number => {
      const loss = Math.max(0, o);
      const barrier = Math.max(0, -o);
      const voc = VOC0 - loss;
      const j0 = JSC / Math.expm1(voc / (1.3 * KT));
      const jlim = JX * Math.exp(-barrier / KT);
      let p = 0;
      for (let k = 0; k <= 160; k++) {
        const v = (k / 160) * voc;
        const jd = JSC - j0 * Math.expm1(v / (1.3 * KT));
        const j = jd > 0 ? (jd * jlim) / (jd + jlim) : jd;
        p = Math.max(p, v * j);
      }
      return p;
    };
    return run(off) / run(0);
  };
  const curve: [number, number][] = [];
  for (let o = -0.3; o <= 0.3001; o += 0.01) curve.push([o, modelP(o) * 100]);

  shell.slider({
    label: "Hole contact level",
    min: -0.3,
    max: 0.3,
    step: 0.01,
    value: offset,
    format: (v) => (Math.abs(v) < 0.005 ? "aligned" : v > 0 ? `+${v.toFixed(2)} eV (a drop)` : `${v.toFixed(2)} eV (a step up)`),
    onInput: (v) => {
      offset = v;
      born = out = rec = fell = 0;
      skip = 4;
    },
  });

  const pdata = new ArrayBuffer(32);
  const pf = new Float32Array(pdata);
  const pu = new Uint32Array(pdata);
  let seed = 1;
  // counted: the share of holes that got out, the energy each gave up on the way, and what that leaves of the power
  const result = (): { eta: number; drop: number; keep: number } | null => {
    if (out + rec < 2000) return null;
    const eta = out / (out + rec);
    const drop = out ? fell / out : 0;
    return { eta, drop, keep: eta * Math.max(0, 1 - drop / VOC0) };
  };
  shell.setInfo(() => {
    const r = result();
    return r
      ? `${(out + rec).toLocaleString()} holes counted · ${(r.eta * 100).toFixed(1)}% got out · ${(r.drop * 1000).toFixed(0)} meV given up each · the top cell keeps ${(r.keep * 100).toFixed(0)}% of its power (model ${(modelP(offset) * 100).toFixed(0)}%)`
      : "counting…";
  });

  return {
    frame() {
      stage.begin();
      pf.set([offset, KT, Math.min(0.05, stage.wallDt)], 0);
      pu[3] = COUNT;
      pu[4] = seed++;
      // (tuned so an aligned contact gets nearly every hole out, as a good cell does)
      pf.set([1.1e-4, 0.0012, 0.012], 5);
      device.queue.writeBuffer(params, 0, pdata);
      device.queue.writeBuffer(geo, 0, new Float32Array([offset, ESCALE, GAP, KT]));
      stage.render(
        (enc) => {
          const pass = enc.beginComputePass();
          for (let s = 0; s < 2; s++) {
            pass.setPipeline(pClear);
            pass.setBindGroup(0, gClear);
            pass.dispatchWorkgroups(Math.ceil((GX * GY) / 256));
            pass.setPipeline(pCount);
            pass.setBindGroup(0, gCount);
            pass.dispatchWorkgroups(Math.ceil(COUNT / 256));
            pass.setPipeline(pWalk);
            pass.setBindGroup(0, gWalk);
            pass.dispatchWorkgroups(Math.ceil(COUNT / 256));
          }
          pass.end();
        },
        (pass) => {
          pass.setBindGroup(0, gDraw);
          pass.setPipeline(render.vsBand);
          pass.draw(6, 30_000);
          pass.setPipeline(render.vsStep);
          pass.draw(6, 3000);
          pass.setPipeline(render.vsHole);
          pass.draw(6, COUNT);
          pass.setPipeline(render.vsEvent);
          pass.draw(6, COUNT * 3);
        },
        (enc) => readback.copy(enc, cnt),
      );
      const now = new Uint32Array(readback.latest.buffer);
      if (last && skip === 0) {
        const d = (k: number): number => (now[k] - last![k]) >>> 0;
        born += d(0);
        out += d(1);
        rec += d(2);
        fell += d(3) / 1000;
      } else skip = Math.max(0, skip - 1);
      last = now.slice();
      const r = result();
      if (r) points.set(Math.round(offset * 100), r.keep * 100);

      // ---- HUD ----
      stage.clearHud();
      const s = stage.px;
      const u = hudScale(stage);
      const c = stage.compact;
      text(stage, "THE TOP CELL KEEPS", 14 * s, 22 * u, 10, "rgba(160, 175, 210, 0.7)");
      text(stage, r ? `${(r.keep * 100).toFixed(0)}% of its power` : "counting…", 14 * s, 52 * u, 26, "#ffe08a", 700);
      if (r) {
        text(stage, `${(r.eta * 100).toFixed(1)}% of holes get out · each gives up ${(r.drop * 1000).toFixed(0)} meV`, 14 * s, 70 * u, 10.5, "rgba(190, 200, 225, 0.75)", 500);
      }
      if (!c) {
        const box = stage.corner(260, 118);
        miniCurve(stage, box, curve, [-0.3, 0.3], [0, 105], {
          title: "power kept vs contact level: model, and counted",
          points: [...points].map(([k, v]) => [k / 100, v] as [number, number]),
          marker: [offset, r ? r.keep * 100 : modelP(offset) * 100],
          xTicks: [-0.3, -0.15, 0, 0.15, 0.3],
        });
        hudLabel(stage, [X0 + 0.25, -HY, 0], "perovskite valence band", [-10, 22], "rgba(150, 240, 200, 0.85)");
        hudLabel(stage, [(X1 + X2) / 2, -HY, -offset * ESCALE], offset < 0 ? "the monolayer: a step up" : offset > 0 ? "the monolayer: a drop" : "the monolayer: lined up", [10, -30], "rgba(225, 215, 255, 0.9)");
        hudLabel(stage, [X3 - 0.2, -HY, -offset * ESCALE], "electrode: holes out", [10, 22], "rgba(200, 210, 235, 0.8)");
        hudLabel(stage, [X0 + 0.4, HY, 0.62], "conduction band, 1.68 eV up (drawn closer): electrons leave the other way", [10, -12], "rgba(140, 200, 255, 0.7)");
      }
      shell.tick();
    },
  };
}
