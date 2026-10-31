// Step 3: four generations of silicon cell, as carriers wandering in a wafer. A slab of silicon in real units —
// 160 µm thick, a millimetre and a bit across — where each dot is an electron (or, in an n-type wafer, a hole)
// freed by sunlight at a depth drawn from silicon's absorption. It random-walks with silicon's diffusion constant
// until it recombines: in the bulk, with the wafer's lifetime, or at a surface, where each bounce off the face has
// a chance S·√(π·dt/D) of being the last (S, the surface's recombination velocity, is what each generation of cell
// improved). The cell is open-circuited: nothing is collected, so carriers build up until they recombine as fast
// as light makes them, and the figure measures how long they last on average. That lifetime is what sets the
// voltage: Voc = (kT/q)·ln(Δn·(N + Δn)/ni²), with Δn = G·τ/W the extra carriers per cm³. Nothing else goes in.

import { gpuMissing, type Demo } from "../../lib/demoShell";
import { NeuronStage, Readback, drawScope, hudLabel, makeTrace, pushTrace, shaderModule } from "../../lib/neuron/stage";
import { ALPHA_BINS, ENERGY_TABLE, SOLAR_WGSL, alphaTable, energyTable, hudScale, stackBar, text } from "../../lib/solar/lab";
import { KT, SI_GAP } from "./physics";

interface Generation {
  name: string;
  era: string;
  /** p- or n-type: the minority carrier's diffusion constant (cm²/s) and the doping (1/cm³) */
  D: number;
  N: number;
  /** bulk lifetime from defects (Shockley–Read–Hall), s; Auger recombination is added on top, from the carrier
   *  density the figure measures */
  taub: number;
  /** front: passivated face and metal fingers (S in cm/s; whether the metal touches the silicon) */
  sFront: number;
  sFinger: number;
  /** rear: passivated face, and its contacts (full area, or local spots) */
  sRear: number;
  sRearContact: number;
  rearSpots: boolean;
  front: string;
  rear: string;
}

const GENS: Generation[] = [
  {
    name: "Al-BSF",
    era: "1980s–2016",
    D: 27,
    N: 1.2e16,
    taub: 300e-6,
    sFront: 150,
    sFinger: 1500,
    sRear: 600,
    sRearContact: 600,
    rearSpots: false,
    front: "phosphorus emitter under silicon nitride · silver fingers on the silicon",
    rear: "the whole rear alloyed with aluminium",
  },
  {
    name: "PERC",
    era: "2012–2023",
    D: 27,
    N: 1e16,
    taub: 700e-6,
    sFront: 65,
    sFinger: 850,
    sRear: 20,
    sRearContact: 300,
    rearSpots: true,
    front: "phosphorus emitter under silicon nitride · silver fingers on the silicon",
    rear: "aluminium oxide, metal through small openings",
  },
  {
    name: "TOPCon",
    era: "2019–",
    D: 12,
    N: 1e15,
    taub: 2e-3,
    sFront: 8,
    sFinger: 300,
    sRear: 4,
    sRearContact: 4,
    rearSpots: false,
    front: "boron emitter under aluminium oxide · fingers on the silicon",
    rear: "1.5 nm oxide + doped polysilicon: passivated and conducting",
  },
  {
    name: "HJT",
    era: "1990s–",
    D: 12,
    N: 1e15,
    taub: 4e-3,
    sFront: 4,
    sFinger: 4,
    sRear: 4,
    sRearContact: 4,
    rearSpots: false,
    front: "amorphous silicon + ITO · fingers never touch the wafer",
    rear: "amorphous silicon + ITO",
  },
];

const W_CM = 0.016; // 160 µm
const X_CM = 0.06; // half-width: 1.2 mm across
const Y_CM = 0.03;
const PITCH = 0.06; // finger pitch (two fingers across the slab)
const FINGER_HALF = 0.0012; // 24 µm wide: 4% of the front
const SPOT_PITCH = 0.03;
const SPOT_R = 0.0025; // rear openings: ~2% of the rear
const G_SUN = 2.6e17; // carriers made per cm² per second in full sun (≈ 41.6 mA/cm²)
const NI = 8.6e9; // intrinsic carrier density of silicon at 300 K, 1/cm³
const C_AUGER = 1.66e-30; // cm⁶/s, ambipolar Auger coefficient
const DT = 0.25e-6; // s per substep
const SUBSTEPS = 96;
// display: x and y as drawn, the wafer drawn deeper than true scale
const SX = 1.15 / X_CM;
const DEPTH = 0.72;

const COMPUTE = /* wgsl */ `
struct Params {
  dt: f32, D: f32, W: f32, taub: f32,
  X: f32, Y: f32, count: u32, seed: u32,
  sF: f32, sFm: f32, sR: f32, sRm: f32,
  geo: vec4f,   // finger pitch, finger half-width, spot pitch, spot radius
  mode: vec4f,  // rear spots?, substeps, wall time per frame, -
}
struct C { a: vec4f, b: vec4f }
// a: position (cm), time since its last event (s, wall) · b: where it last recombined or was born, kind (0 born,
//    1 front, 2 rear, 3 bulk, 4 front metal, 5 rear contact)
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read_write> cs: array<C>;
@group(0) @binding(2) var<storage, read> etab: array<f32>;
@group(0) @binding(3) var<storage, read> alpha: array<f32>;
@group(0) @binding(4) var<storage, read_write> cnt: array<atomic<u32>>;

fn alphaAt(e: f32) -> f32 {
  let i = u32(clamp((e - E_MIN) / (E_MAX - E_MIN) * ${ALPHA_BINS - 1}.0 + 0.5, 0.0, ${ALPHA_BINS - 1}.0));
  return alpha[i];
}

// a new carrier: a sunlight photon above silicon's gap, absorbed at a depth drawn from α (light that reaches the
// rear is turned back by it)
fn born(i: u32, k: u32) -> vec3f {
  var e = 0.0;
  for (var t = 0u; t < 12u; t++) {
    e = etab[min(u32(rnd(i, k, 60u + t) * ${ENERGY_TABLE}.0), ${ENERGY_TABLE - 1}u)];
    if (e >= ${SI_GAP.toFixed(2)}) { break; }
  }
  let d = -log(max(rnd(i, k, 80u), 1e-9)) / max(alphaAt(e), 1e-3);
  let m = d - floor(d / (2.0 * P.W)) * 2.0 * P.W;
  let z = -select(2.0 * P.W - m, m, m < P.W);
  return vec3f((rnd(i, k, 81u) * 2.0 - 1.0) * P.X, (rnd(i, k, 82u) * 2.0 - 1.0) * P.Y, z);
}

fn wrap(v: f32, h: f32) -> f32 { return v - floor((v + h) / (2.0 * h)) * 2.0 * h; }

@compute @workgroup_size(128)
fn walk(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= P.count) { return; }
  var c = cs[i];
  var pos = c.a.xyz;
  let sigma = sqrt(2.0 * P.D * P.dt);
  // a bounce off a face is the last with this chance, for a surface recombination velocity S
  let kS = sqrt(3.14159265 * P.dt / P.D);
  let pb = P.dt / P.taub;
  let n = u32(P.mode.y);
  var ev = -1.0;
  var evPos = vec3f(0.0);
  for (var s = 0u; s < n; s++) {
    let k = P.seed * 131u + s;
    pos += vec3f(gauss(i, k, 1u), gauss(i, k, 2u), gauss(i, k, 3u)) * sigma;
    pos.x = wrap(pos.x, P.X);
    pos.y = wrap(pos.y, P.Y);
    var kind = 0u;
    if (pos.z > 0.0) {
      let fx = abs(wrap(pos.x + P.geo.x * 0.5, P.geo.x * 0.5));
      let metal = fx < P.geo.y;
      let S = select(P.sF, P.sFm, metal);
      if (rnd(i, k, 4u) < S * kS) { kind = select(1u, 4u, metal && P.sFm > P.sF); } else { pos.z = -pos.z; }
    } else if (pos.z < -P.W) {
      var contact = P.mode.x < 0.5;
      if (P.mode.x > 0.5) {
        let q = vec2f(wrap(pos.x, P.geo.z * 0.5), wrap(pos.y, P.geo.z * 0.5));
        contact = length(q) < P.geo.w;
      }
      let S = select(P.sR, P.sRm, contact && P.mode.x > 0.5);
      if (rnd(i, k, 5u) < S * kS) { kind = select(2u, 5u, contact && P.mode.x > 0.5 && P.sRm > P.sR); } else { pos.z = -2.0 * P.W - pos.z; }
    } else if (rnd(i, k, 6u) < pb) {
      kind = 3u;
    }
    if (kind > 0u) {
      atomicAdd(&cnt[kind], 1u);
      ev = f32(kind);
      evPos = vec3f(pos.xy, clamp(pos.z, -P.W, 0.0));
      pos = born(i, k);
      atomicAdd(&cnt[0], 1u);
    }
  }
  atomicAdd(&cnt[6], n);
  c.a = vec4f(pos, c.a.w + P.mode.z);
  if (ev > 0.0) { c.b = vec4f(evPos, ev); c.a.w = 0.0; }
  cs[i] = c;
}
`;

const RENDER = /* wgsl */ `
struct C { a: vec4f, b: vec4f }
@group(0) @binding(1) var<storage, read> cs: array<C>;
@group(0) @binding(2) var<storage, read> geo: array<vec4f>;
// geo: [0] display x scale, depth drawn, W (cm), half y (cm) · [1] S front, S finger, S rear, S rear contact
//      [2] finger pitch, finger half-width, spot pitch, spot radius · [3] rear spots?, -, -, -

fn toWorld(p: vec3f) -> vec3f { return vec3f(p.x * geo[0].x, p.y * geo[0].x, p.z / geo[0].z * geo[0].y); }
fn wrapD(v: f32, h: f32) -> f32 { return v - floor((v + h) / (2.0 * h)) * 2.0 * h; }

@vertex
fn vsCarrier(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  let c = cs[ii];
  let fresh = exp(-c.a.w * 6.0);
  let col = mix(vec3f(0.3, 0.55, 1.0) * 0.55, vec3f(0.9, 0.95, 1.0), fresh * 0.6);
  return sprite(toWorld(c.a.xyz), 0.0055, vi, col);
}

// where a carrier just died: red at a surface (brighter at metal), violet in the bulk
@vertex
fn vsFlash(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  let c = cs[ii];
  let t = c.a.w;
  if (t > 0.3) { return hidden(); }
  let kind = u32(c.b.w);
  var col = vec3f(1.0, 0.28, 0.2);
  if (kind == 3u) { col = vec3f(0.6, 0.35, 1.0); }
  if (kind == 4u || kind == 5u) { col = vec3f(1.0, 0.55, 0.25) * 1.4; }
  return sprite(toWorld(c.b.xyz), 0.008 + t * 0.03, vi, col * exp(-t * 12.0) * 0.55);
}

// the faces: a sheet of dots, green where passivated, red where it's bare or metal (by how much it recombines)
@vertex
fn vsFace(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  let rear = ii % 2u == 1u;
  let h = hash3(ii * 2246822519u + 7u);
  let X = 1.0 / geo[0].x * 1.15;
  let x = (h.x * 2.0 - 1.0) * X;
  let y = (h.y * 2.0 - 1.0) * geo[0].w;
  var S = geo[1].x;
  var metal = false;
  if (!rear) {
    metal = abs(wrapD(x + geo[2].x * 0.5, geo[2].x * 0.5)) < geo[2].y;
    if (metal) { S = geo[1].y; }
  } else {
    S = geo[1].z;
    if (geo[3].x > 0.5) {
      let q = vec2f(wrapD(x, geo[2].z * 0.5), wrapD(y, geo[2].z * 0.5));
      if (length(q) < geo[2].w) { S = geo[1].w; metal = true; }
    }
  }
  let bad = clamp(log(max(S, 1.0)) / log(6000.0), 0.0, 1.0);
  var col = mix(vec3f(0.2, 0.95, 0.55), vec3f(1.0, 0.25, 0.2), bad) * (0.04 + 0.06 * bad);
  if (metal && !rear && geo[1].y > geo[1].x) { col = vec3f(0.8, 0.82, 0.9) * 0.22; }
  let z = select(0.0, -geo[0].z, rear);
  return sprite(toWorld(vec3f(x, y, z)), 0.0045, vi, col);
}

// the silver fingers on the front: bars standing on the face
@vertex
fn vsFinger(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  let h = hash3(ii * 374761393u + 3u);
  let f = select(-0.5, 0.5, ii % 2u == 1u) * geo[2].x;
  let x = f + (h.x * 2.0 - 1.0) * geo[2].y;
  let y = (h.y * 2.0 - 1.0) * geo[0].w;
  let zt = h.z * 0.06;
  let p = toWorld(vec3f(x, y, 0.0)) + vec3f(0.0, 0.0, zt);
  return sprite(p, 0.004, vi, vec3f(0.75, 0.78, 0.88) * 0.16);
}
`;

export async function mountSiliconSurfaces(container: HTMLElement): Promise<Demo> {
  const stage = await NeuronStage.create(container, {
    aspect: 0.62,
    post: { bloom: 0.24, exposure: 1.1, vignette: 0.4 },
    setup: (o) => {
      o.azimuth = -Math.PI / 2 + 0.38;
      o.elevation = 0.3;
      o.distance = 2.85;
      o.target = [0.3, 0, -0.36];
      o.sway = 0.25;
      o.swaySpeed = 0.035;
    },
  });
  if (!stage) return gpuMissing(container);
  const { device, shell } = stage;
  const COUNT = 60_000;
  const params = device.createBuffer({ size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const cs = stage.storage(COUNT * 32);
  const etab = stage.storage(energyTable());
  const alpha = stage.storage(alphaTable("si", SI_GAP));
  const cnt = stage.storage(64, GPUBufferUsage.COPY_SRC);
  const geo = stage.storage(64);
  const readback = new Readback(device, 64);
  const mod = shaderModule(device, SOLAR_WGSL + COMPUTE, "si-walk");
  const pWalk = device.createComputePipeline({ layout: "auto", compute: { module: mod, entryPoint: "walk" } });
  const gWalk = device.createBindGroup({
    layout: pWalk.getBindGroupLayout(0),
    entries: [params, cs, etab, alpha, cnt].map((buffer, binding) => ({ binding, resource: { buffer } })),
  });
  const render = stage.pipelines(SOLAR_WGSL + RENDER, ["vsFace", "vsFinger", "vsCarrier", "vsFlash"]);
  const gDraw = stage.group([cs, geo]);

  let gen = GENS[1];
  // the tally since the generation was picked
  let sim = 0;
  let recs = [0, 0, 0, 0, 0, 0];
  let last: Uint32Array | null = null;
  let skip = 0;
  const trace = makeTrace(360);
  const measured = new Map<string, number>();

  const seed = (): void => {
    // start each carrier somewhere in the wafer, at a depth light would put it
    const d = new Float32Array(COUNT * 8);
    const a = alphaTable("si", SI_GAP);
    const et = energyTable();
    for (let i = 0; i < COUNT; i++) {
      let e = 0;
      for (let t = 0; t < 12 && e < SI_GAP; t++) e = et[Math.floor(Math.random() * et.length)];
      const al = a[Math.min(ALPHA_BINS - 1, Math.round(((e - 0.3) / 4.1) * (ALPHA_BINS - 1)))] || 1;
      let z = -Math.log(Math.random()) / al;
      z = z % (2 * W_CM);
      if (z > W_CM) z = 2 * W_CM - z;
      d.set([(Math.random() * 2 - 1) * X_CM, (Math.random() * 2 - 1) * Y_CM, -z, 1], i * 8);
    }
    device.queue.writeBuffer(cs, 0, d);
  };
  const pick = (g: Generation): void => {
    gen = g;
    sim = 0;
    recs = [0, 0, 0, 0, 0, 0];
    skip = 4;
    trace.count = 0;
    device.queue.writeBuffer(
      geo,
      0,
      new Float32Array([SX, DEPTH, W_CM, Y_CM, g.sFront, g.sFinger, g.sRear, g.sRearContact, PITCH, FINGER_HALF, SPOT_PITCH, SPOT_R, g.rearSpots ? 1 : 0, 0, 0, 0]),
    );
    buttons.forEach((b, k) => b.classList.toggle("active", GENS[k] === g));
  };
  const buttons = GENS.map((g) => shell.button(g.name, () => pick(g)));
  seed();
  pick(gen);

  const pdata = new ArrayBuffer(96);
  const pf = new Float32Array(pdata);
  const pu = new Uint32Array(pdata);
  let frameSeed = 1;

  /** the voltage a lifetime gives, in full sun */
  const vocFor = (tau: number, g: Generation): number => {
    const dn = (G_SUN * tau) / W_CM;
    return KT * Math.log((dn * (g.N + dn)) / (NI * NI));
  };
  let tau = 0;
  let voc = 0;
  shell.setInfo(() => {
    const total = recs.reduce((a, b) => a + b, 0);
    return `${COUNT.toLocaleString()} carriers · ${total.toLocaleString()} recombinations counted over ${(sim * 1000).toFixed(1)} ms of wafer time · lifetime ${(tau * 1e6).toFixed(0)} µs`;
  });

  return {
    frame() {
      stage.begin();
      // the bulk: defects, plus Auger (three carriers colliding), whose rate grows with how many carriers there are —
      // the density this very count implies
      const dn = tau > 0 ? (G_SUN * tau) / W_CM : 1e15;
      const taubEff = 1 / (1 / gen.taub + C_AUGER * (gen.N + dn) * (gen.N + dn));
      pf.set([DT, gen.D, W_CM, taubEff, X_CM, Y_CM], 0);
      pu[6] = COUNT;
      pu[7] = frameSeed++;
      pf.set([gen.sFront, gen.sFinger, gen.sRear, gen.sRearContact], 8);
      pf.set([PITCH, FINGER_HALF, SPOT_PITCH, SPOT_R], 12);
      pf.set([gen.rearSpots ? 1 : 0, SUBSTEPS, stage.wallDt, 0], 16);
      device.queue.writeBuffer(params, 0, pdata);
      stage.render(
        (enc) => {
          const pass = enc.beginComputePass();
          pass.setPipeline(pWalk);
          pass.setBindGroup(0, gWalk);
          pass.dispatchWorkgroups(Math.ceil(COUNT / 128));
          pass.end();
        },
        (pass) => {
          pass.setBindGroup(0, gDraw);
          pass.setPipeline(render.vsFace);
          pass.draw(6, 40_000);
          pass.setPipeline(render.vsFinger);
          pass.draw(6, 6000);
          pass.setPipeline(render.vsCarrier);
          pass.draw(6, COUNT);
          pass.setPipeline(render.vsFlash);
          pass.draw(6, COUNT);
        },
        (enc) => readback.copy(enc, cnt),
      );
      // fold the counters in: recombinations by where, and wafer time
      const now = new Uint32Array(readback.latest.buffer);
      if (last && skip === 0) {
        const d = (k: number): number => (now[k] - last![k]) >>> 0;
        const steps = d(6) / COUNT;
        sim += steps * DT;
        for (let k = 1; k <= 5; k++) recs[k] += d(k);
      } else skip = Math.max(0, skip - 1);
      last = now.slice();
      const total = recs.reduce((a, b) => a + b, 0);
      // every carrier is alive all the time (a death is a birth), so lifetime = carriers × time / deaths
      if (total > 200 && sim > 0) {
        tau = (COUNT * sim) / total;
        voc = vocFor(tau, gen);
        measured.set(gen.name, voc);
        pushTrace(trace, voc);
      }

      // ---- HUD ----
      stage.clearHud();
      const s = stage.px;
      const u = hudScale(stage);
      const W = stage.hud.width;
      const c = stage.compact;
      text(stage, `${gen.name.toUpperCase()} · ${gen.era}`, 14 * s, 22 * u, 10, "rgba(160, 175, 210, 0.7)");
      text(stage, total > 200 ? `${voc.toFixed(3)} V` : "counting…", 14 * s, 52 * u, 28, "#9fd8ff", 700);
      text(stage, total > 200 ? `open-circuit voltage, from a measured lifetime of ${(tau * 1e6).toFixed(0)} µs` : "", 14 * s, 70 * u, 10.5, "rgba(190, 200, 225, 0.75)", 500);
      if (total > 200) {
        const front = recs[1] + recs[4];
        const rear = recs[2] + recs[5];
        stackBar(
          stage,
          { x: 14 * s, y: 84 * u, w: Math.min(W * (c ? 0.9 : 0.46), 400 * s), h: 9 * u },
          [
            { value: front, color: "#ff6a5a", label: "front" },
            { value: rear, color: "#ffaa5c", label: "rear" },
            { value: recs[3], color: "#a98cff", label: "bulk" },
          ],
        );
      }
      if (!c) {
        // the four generations: each one's voltage, as measured when it was last picked
        const g = stage.g;
        const bx = W - 238 * s;
        const by = 18 * s;
        g.fillStyle = "rgba(8, 9, 15, 0.62)";
        g.beginPath();
        g.roundRect(bx - 10 * s, by - 6 * s, 236 * s, 110 * s, 8 * s);
        g.fill();
        text(stage, "open-circuit voltage, measured", bx, by + 8 * u, 9.5, "rgba(200, 210, 235, 0.75)");
        GENS.forEach((q, k) => {
          const v = measured.get(q.name);
          const y = by + 24 * s + k * 20 * s;
          text(stage, q.name, bx, y + 8 * s, 10, q === gen ? "#ffffff" : "rgba(200, 210, 235, 0.7)", q === gen ? 700 : 500);
          const x0 = bx + 60 * s;
          const ww = 120 * s;
          g.fillStyle = "rgba(255,255,255,0.06)";
          g.fillRect(x0, y, ww, 10 * s);
          if (v) {
            g.fillStyle = q === gen ? "#9fd8ff" : "rgba(159, 216, 255, 0.5)";
            g.fillRect(x0, y, Math.max(0, Math.min(1, (v - 0.6) / 0.16)) * ww, 10 * s);
            text(stage, `${v.toFixed(3)}`, x0 + ww + 6 * s, y + 9 * s, 9.5, "rgba(220, 226, 245, 0.85)");
          } else text(stage, "—", x0 + ww + 6 * s, y + 9 * s, 9.5, "rgba(160, 170, 195, 0.6)");
        });
        const box = stage.corner(250, 90);
        box.x = 14 * s;
        drawScope(stage, box, [{ trace, color: "#9fd8ff" }], [0.6, 0.78], [{ v: 0.7, label: "0.70 V" }], "voltage as the count builds");
        hudLabel(stage, [0, -0.6, 0.02], gen.front, [24, -26], "rgba(200, 210, 235, 0.8)");
        hudLabel(stage, [0.9, -0.6, -DEPTH], gen.rear, [20, 24], "rgba(200, 210, 235, 0.8)");
      }
      shell.tick();
    },
  };
}
