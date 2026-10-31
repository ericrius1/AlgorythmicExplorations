// Step 7: coating a field of pyramids. A patch of textured wafer 20 µm across, covered in random upright pyramids
// with faces at 54.7° (the {111} planes the etch leaves). Two things are counted on it. Light: photons fall on the
// texture and meet each facet with silicon's Fresnel reflectance (n ≈ 3.9: a flat face sends back 35%), and a
// reflected photon flies on to the next pyramid for another try, so the figure tallies how many get away. And the
// film: a solution coating levels out like any liquid — it fills the valleys up to the height that holds its volume,
// and a tip that pokes through is bare, a shunt — while an evaporated one coats every facet evenly. Points sampled
// across the surface count how much of it is left bare.

import { gpuMissing, type Demo } from "../../lib/demoShell";
import { NeuronStage, Readback, hudLabel, shaderModule } from "../../lib/neuron/stage";
import { ENERGY_TABLE, SOLAR_WGSL, energyTable, hudScale, text } from "../../lib/solar/lab";

const F = 1.4; // half the patch, display units (20 µm across)
const UM = (2 * F) / 20; // display units per µm
const N_SI = 3.9;
const PHOTONS = 36_000;
const SAMPLES = 120_000;
const TAN = Math.SQRT2; // tan 54.74°: a facet falls √2 per unit across

interface Field {
  n: number;
  cell: number;
  /** per cell: centre x, centre y, height */
  cells: Float32Array<ArrayBuffer>;
}

/** random pyramids: one per cell, each a random size and nudged off centre, so they overlap like etched ones */
function makeField(heightUm: number, seed = 7): Field {
  const H = Math.max(0.001, heightUm * UM);
  // (cells narrower than the smallest pyramid's base, so neighbours always overlap: an etched wafer has no flat
  // ground left between them)
  const cell = Math.max(0.1, 0.82 * H);
  const n = Math.min(40, Math.max(1, Math.round((2 * F) / cell)));
  const c = (2 * F) / n;
  let s = seed;
  const r = (): number => (s = (s * 16807) % 2147483647) / 2147483647;
  const cells = new Float32Array(n * n * 4);
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const k = (j * n + i) * 4;
      cells[k] = -F + (i + 0.5) * c + (r() - 0.5) * c * 0.8;
      cells[k + 1] = -F + (j + 0.5) * c + (r() - 0.5) * c * 0.8;
      cells[k + 2] = heightUm <= 0.001 ? 0 : H * (0.55 + 0.45 * r());
    }
  return { n, cell: c, cells };
}

const wrapD = (d: number): number => d - Math.round(d / (2 * F)) * 2 * F;

/** the texture's height at (x, y): the highest pyramid there (each falling √2 per unit from its apex) */
function heightAt(f: Field, x: number, y: number): number {
  const i0 = Math.floor((x + F) / f.cell);
  const j0 = Math.floor((y + F) / f.cell);
  let z = 0;
  for (let dj = -1; dj <= 1; dj++)
    for (let di = -1; di <= 1; di++) {
      const i = (((i0 + di) % f.n) + f.n) % f.n;
      const j = (((j0 + dj) % f.n) + f.n) % f.n;
      const k = (j * f.n + i) * 4;
      const dx = Math.abs(wrapD(x - f.cells[k]));
      const dy = Math.abs(wrapD(y - f.cells[k + 1]));
      z = Math.max(z, f.cells[k + 2] - Math.max(dx, dy) * TAN);
    }
  return z;
}

/** where a levelled liquid film of mean thickness t settles: the height whose filled-in volume is t over the patch */
function liquidLevel(f: Field, tUm: number): number {
  const t = tUm * UM;
  const hs: number[] = [];
  for (let j = 0; j < 90; j++) for (let i = 0; i < 90; i++) hs.push(heightAt(f, -F + ((i + 0.5) / 90) * 2 * F, -F + ((j + 0.5) / 90) * 2 * F));
  let lo = 0;
  let hi = Math.max(...hs) + t + 0.01;
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2;
    const vol = hs.reduce((a, h) => a + Math.max(0, mid - h), 0) / hs.length;
    if (vol > t) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

const FIELD_WGSL = /* wgsl */ `
const F: f32 = ${F.toFixed(4)};
const TAN: f32 = ${TAN.toFixed(6)};
fn wrapD(d: f32) -> f32 { return d - round(d / (2.0 * F)) * 2.0 * F; }
fn wrapP(v: f32) -> f32 { return v - floor((v + F) / (2.0 * F)) * 2.0 * F; }
// the height and the facet's normal at (x, y); fg: (cells per side, cell size)
fn surf(x: f32, y: f32, fg: vec2f) -> vec4f {
  let n = i32(fg.x);
  let i0 = i32(floor((x + F) / fg.y));
  let j0 = i32(floor((y + F) / fg.y));
  var z = 0.0;
  var nrm = vec3f(0.0, 0.0, 1.0);
  for (var dj = -1; dj <= 1; dj++) {
    for (var di = -1; di <= 1; di++) {
      let i = ((i0 + di) % n + n) % n;
      let j = ((j0 + dj) % n + n) % n;
      let c = cells[j * n + i];
      let dx = wrapD(x - c.x);
      let dy = wrapD(y - c.y);
      let h = c.z - max(abs(dx), abs(dy)) * TAN;
      if (h > z) {
        z = h;
        if (abs(dx) > abs(dy)) { nrm = normalize(vec3f(sign(dx) * TAN, 0.0, 1.0)); }
        else { nrm = normalize(vec3f(0.0, sign(dy) * TAN, 1.0)); }
      }
    }
  }
  return vec4f(nrm, z);
}
`;

const COMPUTE = /* wgsl */ `
struct Params { fg: vec2f, level: f32, film: f32, dt: f32, seed: u32, count: u32, method: u32, nsi: f32, samples: u32, pad0: u32, pad1: u32 }
struct Ph { a: vec4f, b: vec4f, c: vec4f } // a: position, energy · b: direction, state (0 flying, 1 in the silicon, 2 away) · c: bounces, time in state, -, -
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> cells: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> ph: array<Ph>;
@group(0) @binding(3) var<storage, read> etab: array<f32>;
@group(0) @binding(4) var<storage, read_write> cnt: array<atomic<u32>>;
// cnt: 0 photons in, 1 got away, 2 into the silicon, 3 into it at the first touch, 4 at the second, 5 later · 8 samples bare
${FIELD_WGSL}

fn fresnel(cosi: f32, n: f32) -> f32 {
  let sint = sqrt(max(0.0, 1.0 - cosi * cosi)) / n;
  let cost = sqrt(max(0.0, 1.0 - sint * sint));
  let rs = (cosi - n * cost) / (cosi + n * cost);
  let rp = (cost - n * cosi) / (cost + n * cosi);
  return 0.5 * (rs * rs + rp * rp);
}

fn launch(i: u32, k: u32) -> Ph {
  var p: Ph;
  let e = etab[min(u32(rnd(i, k, 1u) * ${ENERGY_TABLE}.0), ${ENERGY_TABLE - 1}u)];
  p.a = vec4f((rnd(i, k, 2u) * 2.0 - 1.0) * F, (rnd(i, k, 3u) * 2.0 - 1.0) * F, 0.9 + rnd(i, k, 4u) * 0.6, e);
  p.b = vec4f(normalize(vec3f(0.05 * (rnd(i, k, 5u) - 0.5), 0.05 * (rnd(i, k, 6u) - 0.5), -1.0)), 0.0);
  p.c = vec4f(0.0);
  atomicAdd(&cnt[0], 1u);
  return p;
}

@compute @workgroup_size(128)
fn fly(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= P.count) { return; }
  var p = ph[i];
  p.c.y += P.dt;
  let state = u32(p.b.w + 0.5);
  let k = P.seed;
  if (state == 0u) {
    var budget = 1.4 * P.dt;
    for (var s = 0u; s < 48u && budget > 0.0; s++) {
      let q = surf(wrapP(p.a.x), wrapP(p.a.y), P.fg);
      let gap = p.a.z - q.w;
      if (gap <= 0.0015) {
        // a facet: reflected with Fresnel's chance, or into the silicon
        let cosi = max(0.02, -dot(p.b.xyz, q.xyz));
        if (rnd(i, k * 7u + s, 10u) < fresnel(cosi, P.nsi)) {
          p.b = vec4f(reflect(p.b.xyz, q.xyz), 0.0);
          p.a = vec4f(p.a.xyz + q.xyz * 0.004, p.a.w);
          p.c.x += 1.0;
        } else {
          atomicAdd(&cnt[2], 1u);
          atomicAdd(&cnt[3u + min(u32(p.c.x), 2u)], 1u);
          // inside, it bends toward the facet's normal (Snell), drawn as a short dive
          let n = q.xyz;
          let d = p.b.xyz;
          let eta = 1.0 / P.nsi;
          let ci = -dot(d, n);
          let tdir = eta * d + (eta * ci - sqrt(max(0.0, 1.0 - eta * eta * (1.0 - ci * ci)))) * n;
          p.b = vec4f(normalize(tdir), 1.0);
          p.c.y = 0.0;
          break;
        }
      }
      let step = clamp(gap / 1.8, 0.003, 0.06);
      p.a = vec4f(p.a.xyz + p.b.xyz * step, p.a.w);
      budget -= step;
      if (p.a.z > 1.6 && p.b.z > 0.0) {
        atomicAdd(&cnt[1], 1u);
        p.b.w = 2.0;
        p.c.y = 0.0;
        break;
      }
    }
  } else if (state == 1u) {
    p.a = vec4f(p.a.xyz + p.b.xyz * P.dt * 0.25, p.a.w);
    if (p.c.y > 0.5) { p = launch(i, k + i); }
  } else if (p.c.y > 0.1) {
    p = launch(i, k + i);
  }
  ph[i] = p;
}

// the coverage: points sampled over the patch; one is bare where a levelled film doesn't reach it
@compute @workgroup_size(256)
fn cover(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= P.samples) { return; }
  let x = (rnd(i, 3u, 90u) * 2.0 - 1.0) * F;
  let y = (rnd(i, 3u, 91u) * 2.0 - 1.0) * F;
  let q = surf(x, y, P.fg);
  if (P.method == 0u && q.w > P.level) { atomicAdd(&cnt[8], 1u); }
}
`;

const RENDER = /* wgsl */ `
struct Ph { a: vec4f, b: vec4f, c: vec4f }
@group(0) @binding(1) var<storage, read> cells: array<vec4f>;
@group(0) @binding(2) var<storage, read> ph: array<Ph>;
@group(0) @binding(3) var<storage, read> geo: array<vec4f>;
// geo[0]: cells per side, cell size, liquid level, film thickness · geo[1]: method (0 solution, 1 conformal), -
${FIELD_WGSL}

// the silicon: dots over the texture, each facet lit by its angle to the light
@vertex
fn vsSilicon(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  let h = hash3(ii * 2654435761u + 1u);
  let x = (h.x * 2.0 - 1.0) * F;
  let y = (h.y * 2.0 - 1.0) * F;
  let q = surf(x, y, geo[0].xy);
  let lit = 0.25 + 0.75 * max(0.0, dot(q.xyz, normalize(vec3f(-0.4, -0.6, 0.7))));
  return sprite(vec3f(x, y, q.w), 0.0042, vi, vec3f(0.42, 0.58, 1.0) * 0.26 * lit);
}

// the film: a levelled liquid surface over the valleys, or a skin over every facet; the tips poking through glow red
@vertex
fn vsFilm(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  let h = hash3(ii * 374761393u + 9u);
  let x = (h.x * 2.0 - 1.0) * F;
  let y = (h.y * 2.0 - 1.0) * F;
  let q = surf(x, y, geo[0].xy);
  if (geo[1].x > 0.5) {
    return sprite(vec3f(x, y, q.w + geo[0].w * (0.3 + 0.7 * h.z)), 0.0042, vi, vec3f(0.37, 0.95, 0.66) * 0.13);
  }
  let L = geo[0].z;
  if (q.w > L) {
    let flick = 0.7 + 0.3 * sin(cam.p.x * 9.0 + h.z * 30.0);
    return sprite(vec3f(x, y, q.w + 0.004), 0.0055, vi, vec3f(1.0, 0.3, 0.22) * 0.45 * flick);
  }
  let z = mix(q.w, L, select(1.0, h.z, h.z < 0.35));
  return sprite(vec3f(x, y, z), 0.0042, vi, vec3f(0.37, 0.95, 0.66) * select(0.1, 0.05, h.z < 0.35));
}

@vertex
fn vsPhoton(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  let p = ph[ii];
  let st = u32(p.b.w + 0.5);
  let col = photonColor(p.a.w);
  if (st == 1u) {
    let fade = exp(-p.c.y * 5.0);
    return streak(p.a.xyz - p.b.xyz * 0.05, p.a.xyz, 0.003, vi, col * fade * 0.7);
  }
  if (st == 2u) { return hidden(); }
  // a reflected photon brightens a little each bounce, so its path reads
  let k = 0.9 + 0.5 * p.c.x;
  return streak(p.a.xyz - p.b.xyz * 0.14, p.a.xyz, 0.0034, vi, col * k);
}
`;

export async function mountPyramidField(container: HTMLElement): Promise<Demo> {
  const stage = await NeuronStage.create(container, {
    aspect: 0.62,
    post: { bloom: 0.24, exposure: 1.1, vignette: 0.42 },
    setup: (o) => {
      o.azimuth = -Math.PI / 2 + 0.55;
      o.elevation = 0.5;
      o.distance = 3.0;
      o.target = [0.15, 0, 0.1];
      o.sway = 0.3;
      o.swaySpeed = 0.03;
    },
  });
  if (!stage) return gpuMissing(container);
  const { device, shell } = stage;
  const params = device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const cellsBuf = stage.storage(40 * 40 * 16);
  const ph = stage.storage(PHOTONS * 48);
  const etab = stage.storage(energyTable());
  const cnt = stage.storage(64, GPUBufferUsage.COPY_SRC);
  const geo = stage.storage(32);
  const readback = new Readback(device, 64);
  const mod = shaderModule(device, SOLAR_WGSL + COMPUTE, "pyramids");
  const pipe = (entryPoint: string): GPUComputePipeline => device.createComputePipeline({ layout: "auto", compute: { module: mod, entryPoint } });
  const pFly = pipe("fly");
  const pCover = pipe("cover");
  const render = stage.pipelines(SOLAR_WGSL + RENDER, ["vsSilicon", "vsFilm", "vsPhoton"]);
  const gFly = device.createBindGroup({
    layout: pFly.getBindGroupLayout(0),
    entries: [params, cellsBuf, ph, etab, cnt].map((buffer, binding) => ({ binding, resource: { buffer } })),
  });
  const gCover = device.createBindGroup({
    layout: pCover.getBindGroupLayout(0),
    entries: [0, 1, 4].map((b) => ({ binding: b, resource: { buffer: [params, cellsBuf, ph, etab, cnt][b] } })),
  });
  const gDraw = stage.group([cellsBuf, ph, geo]);
  {
    // photons start spread through their fall, so the shower is full at once
    const d = new Float32Array(PHOTONS * 12);
    for (let i = 0; i < PHOTONS; i++) d.set([0, 0, 0, 2, 0, 0, -1, 2, 0, Math.random() * -1.2 + 0.1, 0, 0], i * 12);
    device.queue.writeBuffer(ph, 0, d);
  }

  let height = 2;
  let film = 0.6;
  let conformal = false;
  let field = makeField(height);
  let level = liquidLevel(field, film);
  let thickest = 0;
  // the tally since the texture last changed
  let photons = 0;
  let away = 0;
  let into = 0;
  let firstTouch = 0;
  let bare = 0;
  let last: Uint32Array | null = null;
  let skip = 0;
  let coverDirty = true;

  const rebuild = (): void => {
    field = makeField(height);
    level = liquidLevel(field, film);
    thickest = level / UM;
    device.queue.writeBuffer(cellsBuf, 0, field.cells);
    photons = away = into = firstTouch = 0;
    skip = 4;
    coverDirty = true;
  };
  shell.slider({
    label: "Pyramid height",
    min: 0,
    max: 4,
    step: 0.1,
    value: height,
    format: (v) => (v < 0.05 ? "flat (polished)" : `${v.toFixed(1)} µm`),
    onInput: (v) => {
      height = v;
      rebuild();
    },
  });
  shell.slider({
    label: "Film thickness",
    min: 200,
    max: 1500,
    step: 20,
    value: film * 1000,
    format: (v) => `${v.toFixed(0)} nm`,
    onInput: (v) => {
      film = v / 1000;
      level = liquidLevel(field, film);
      thickest = level / UM;
      coverDirty = true;
    },
  });
  const methodBtn = shell.button("solution (spin / slot-die)", () => {
    conformal = !conformal;
    methodBtn.textContent = conformal ? "conformal (evaporated first)" : "solution (spin / slot-die)";
    coverDirty = true;
  });
  rebuild();

  const pdata = new ArrayBuffer(48);
  const pf = new Float32Array(pdata);
  const pu = new Uint32Array(pdata);
  let seed = 1;
  const reflectance = (): number | null => (photons > 500 ? away / Math.max(1, away + into) : null);
  const bareShare = (): number => (conformal ? 0 : bare / SAMPLES);
  shell.setInfo(() => {
    const r = reflectance();
    return `${(away + into).toLocaleString()} photons · ${r !== null ? (r * 100).toFixed(1) : "—"}% reflected (flat silicon: 35%) · ${(bareShare() * 100).toFixed(0)}% of the surface bare · ${conformal ? "an even skin over every facet" : `film ${thickest.toFixed(2)} µm deep at its deepest`}`;
  });

  return {
    frame() {
      stage.begin();
      pf.set([field.n, field.cell, level, film * UM, Math.min(0.05, stage.wallDt)], 0);
      pu[5] = seed++;
      pu[6] = PHOTONS;
      pu[7] = conformal ? 1 : 0;
      pf[8] = N_SI;
      pu[9] = SAMPLES;
      device.queue.writeBuffer(params, 0, pdata);
      device.queue.writeBuffer(geo, 0, new Float32Array([field.n, field.cell, level, film * UM, conformal ? 1 : 0, 0, 0, 0]));
      const doCover = coverDirty;
      if (doCover) {
        // (a fresh count of bare points: clear the counter's slot first)
        device.queue.writeBuffer(cnt, 32, new Uint32Array([0]));
        coverDirty = false;
      }
      stage.render(
        (enc) => {
          const pass = enc.beginComputePass();
          pass.setPipeline(pFly);
          pass.setBindGroup(0, gFly);
          pass.dispatchWorkgroups(Math.ceil(PHOTONS / 128));
          if (doCover) {
            pass.setPipeline(pCover);
            pass.setBindGroup(0, gCover);
            pass.dispatchWorkgroups(Math.ceil(SAMPLES / 256));
          }
          pass.end();
        },
        (pass) => {
          pass.setBindGroup(0, gDraw);
          pass.setPipeline(render.vsSilicon);
          pass.draw(6, 110_000);
          pass.setPipeline(render.vsFilm);
          pass.draw(6, 60_000);
          pass.setPipeline(render.vsPhoton);
          pass.draw(6, PHOTONS);
        },
        (enc) => readback.copy(enc, cnt),
      );
      const now = new Uint32Array(readback.latest.buffer);
      if (last && skip === 0) {
        const d = (k: number): number => (now[k] - last![k]) >>> 0;
        photons += d(0);
        away += d(1);
        into += d(2);
        firstTouch += d(3);
      } else skip = Math.max(0, skip - 1);
      last = now.slice();
      bare = now[8];

      // ---- HUD ----
      stage.clearHud();
      const s = stage.px;
      const u = hudScale(stage);
      const c = stage.compact;
      const r = reflectance();
      text(stage, "REFLECTED", 14 * s, 22 * u, 10, "rgba(160, 175, 210, 0.7)");
      text(stage, r !== null ? `${(r * 100).toFixed(1)}%` : "counting…", 14 * s, 52 * u, 28, "#9fd8ff", 700);
      text(stage, height < 0.05 ? "a flat face: one chance to bounce away" : "photons that bounce off one facet try the next", 14 * s, 70 * u, 10.5, "rgba(190, 200, 225, 0.75)", 500);
      const bx = c ? 14 * s : stage.hud.width * 0.6;
      text(stage, "LEFT BARE", bx, 22 * u, 10, "rgba(160, 175, 210, 0.7)");
      text(stage, conformal ? "0%" : `${(bareShare() * 100).toFixed(0)}%`, bx, 52 * u + (c ? 40 * u : 0), 28, bareShare() > 0.02 ? "#ff8a6a" : "#5fe0a8", 700);
      text(stage, conformal ? "evaporated first: every facet coated" : bareShare() > 0.005 ? "tips through a levelled film: shunts" : "the film covers every tip", bx, 70 * u + (c ? 40 * u : 0), 10.5, "rgba(190, 200, 225, 0.75)", 500);
      if (!c && height > 0.05) {
        hudLabel(stage, [F * 0.55, -F * 0.8, 0.02], "54.7° facets of silicon", [16, 22], "rgba(160, 190, 255, 0.85)");
        if (!conformal) hudLabel(stage, [-F * 0.45, -F * 0.8, level], "the film, levelled in the valleys", [-14, 26], "rgba(150, 240, 200, 0.85)");
      }
      shell.tick();
    },
  };
}
