// Part four's demos: sphere tracing analytic SDFs, all through ShaderView
// (one fullscreen fragment shader per figure, like the music series).
//   hero  — the sculpture garden: smin blobs over a pedestal, orbiting camera
//   blend — three shapes and one knob: smooth-minimum morphing
//   steps — the cost made visible: a step-count heatmap with a budget slider
//   shade — soft shadows and ambient occlusion, each on its own knob
//   full  — everything, with the light riding your cursor and debug views
//
// Uniform map (U[0] is ShaderView's time/aspect/pointer):
//   uf(4) A     — smin k (blend) · step budget (steps) · unused elsewhere
//   uf(5) B     — AO strength (shade/full)
//   uf(6,7)     — camera yaw/pitch offsets (drag to orbit)
//   uf(10..12)  — light position, world
//   uf(13)      — view mode: 0 final · 1 normals · 2 step heat
//   uf(14)      — autorotate (0 while dragging)
//   uf(15)      — shadow sharpness k: 2 = penumbra everywhere … 64 = knife

import { Shell, gpuMissing, type Demo } from "../../lib/demoShell";
import { getDevice } from "../../lib/gpu";
import { ShaderView } from "../../lib/shaderCanvas";

export interface SculptOptions {
  mode: "hero" | "blend" | "steps" | "shade" | "full";
}

const VIEW_NAMES = ["final", "normals", "step count"];

function sceneWGSL(mode: number): string {
  return /* wgsl */ `
const MODE: i32 = ${mode};

fn rotY(p: vec3f, a: f32) -> vec3f {
  let c = cos(a); let s = sin(a);
  return vec3f(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}

fn sdSphere(p: vec3f, r: f32) -> f32 { return length(p) - r; }

fn sdTorus(p: vec3f, t: vec2f) -> f32 {
  let q = vec2f(length(p.xz) - t.x, p.y);
  return length(q) - t.y;
}

fn sdRoundBox(p: vec3f, b: vec3f, r: f32) -> f32 {
  let q = abs(p) - b;
  return length(max(q, vec3f(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}

// the polynomial smooth minimum — two surfaces that refuse to intersect
// sharply, the whole reason SDF sculpture looks like wax instead of CSG
fn smin(a: f32, b: f32, k: f32) -> f32 {
  let kk = max(k, 1e-4);
  let h = clamp(0.5 + 0.5 * (b - a) / kk, 0.0, 1.0);
  return mix(b, a, h) - kk * h * (1.0 - h);
}

// distance + material id, the whole world in one function
fn map(p: vec3f) -> vec2f {
  let t = uf(0u);
  var d = p.y;            // the ground: distance to the y=0 plane, exactly
  var m = 1.0;

  if (MODE == 1) {
    // ---- the blend lab: three shapes, one knob --------------------------------
    let k = uf(4u);
    let orbit = vec3f(0.9 * sin(t * 0.5), 0.55 + 0.25 * sin(t * 0.33), 0.45 * cos(t * 0.5));
    var s = sdSphere(p - vec3f(-0.7, 0.55, 0.0), 0.5);
    s = smin(s, sdRoundBox(p - vec3f(0.75, 0.45, 0.0), vec3f(0.42, 0.42, 0.42), 0.04), k);
    s = smin(s, sdSphere(p - orbit, 0.34), k);
    if (s < d) { d = s; m = 2.0; }
  } else {
    // ---- the sculpture: pedestal + blobs + torus ------------------------------
    let ped = sdRoundBox(p - vec3f(0.0, 0.3, 0.0), vec3f(0.42, 0.3, 0.42), 0.04);
    if (ped < d) { d = ped; m = 3.0; }
    let c = vec3f(0.0, 1.18, 0.0);
    let k = 0.17;
    var s = sdTorus(rotY(p - c, t * 0.2), vec2f(0.42, 0.1));
    s = smin(s, sdSphere(p - (c + vec3f(0.30 * sin(t * 0.43), 0.22 * sin(t * 0.31 + 2.0), 0.30 * cos(t * 0.43))), 0.26), k);
    s = smin(s, sdSphere(p - (c + vec3f(0.34 * sin(t * 0.27 + 4.0), 0.30 * cos(t * 0.36), 0.20 * sin(t * 0.5 + 1.0))), 0.21), k);
    s = smin(s, sdSphere(p - (c + vec3f(0.0, 0.40 * sin(t * 0.22), 0.0)), 0.23), k);
    if (s < d) { d = s; m = 2.0; }
  }
  return vec2f(d, m);
}

// gradient of the distance — the surface normal, by central differences
fn calcNormal(p: vec3f) -> vec3f {
  let e = 0.0012;
  return normalize(vec3f(
    map(p + vec3f(e, 0.0, 0.0)).x - map(p - vec3f(e, 0.0, 0.0)).x,
    map(p + vec3f(0.0, e, 0.0)).x - map(p - vec3f(0.0, e, 0.0)).x,
    map(p + vec3f(0.0, 0.0, e)).x - map(p - vec3f(0.0, 0.0, e)).x,
  ));
}

// sphere trace toward the light; the closest miss along the way sets the
// penumbra. k large = shadows snap hard, k small = everything is dusk.
fn softShadow(ro: vec3f, rd: vec3f, k: f32) -> f32 {
  var res = 1.0;
  var t = 0.04;
  for (var i = 0; i < 40; i++) {
    let h = map(ro + rd * t).x;
    if (h < 0.001) { return 0.0; }
    res = min(res, k * h / t);
    t += clamp(h, 0.015, 0.3);
    if (t > 6.0) { break; }
  }
  return clamp(res, 0.0, 1.0);
}

// five probes up the normal: how much free space hangs over this point
fn ambientOcc(p: vec3f, n: vec3f) -> f32 {
  var occ = 0.0;
  var sca = 1.0;
  for (var i = 1; i <= 5; i++) {
    let h = 0.03 + 0.12 * f32(i);
    occ += (h - map(p + n * h).x) * sca;
    sca *= 0.7;
  }
  return clamp(1.0 - 1.6 * occ, 0.0, 1.0);
}

fn skyBg(rd: vec3f) -> vec3f {
  let up = clamp(rd.y, 0.0, 1.0);
  var col = mix(vec3f(0.045, 0.05, 0.085), vec3f(0.012, 0.02, 0.05), up);
  let sunDir = normalize(vec3f(-0.55, 0.32, -0.4));
  col += vec3f(1.0, 0.7, 0.4) * pow(max(dot(rd, sunDir), 0.0), 64.0) * 0.45;
  return col;
}

fn heat(x: f32) -> vec3f {
  // black → violet → orange → near-white, the universal "cost" ramp
  let a = clamp(x, 0.0, 1.0);
  return vec3f(
    smoothstep(0.1, 0.7, a),
    smoothstep(0.4, 0.95, a) * 0.85,
    smoothstep(0.0, 0.35, a) * (1.0 - 0.7 * smoothstep(0.45, 0.9, a)),
  );
}

fn scene(uv: vec2f) -> vec3f {
  let aspect = uf(1u);
  let t = uf(0u);
  // camera: orbit around the plinth
  let autoRot = uf(14u);
  let yaw = uf(6u) + select(0.0, t * 0.12, autoRot > 0.5) + 0.6;
  let pitch = clamp(uf(7u) + 0.32, -0.1, 1.2);
  let radius = select(3.4, 3.1, MODE == 1);
  let tgt = select(vec3f(0.0, 0.95, 0.0), vec3f(0.0, 0.45, 0.0), MODE == 1);
  let ro = tgt + radius * vec3f(cos(pitch) * sin(yaw), sin(pitch), cos(pitch) * cos(yaw));
  let fwd = normalize(tgt - ro);
  let right = normalize(cross(fwd, vec3f(0.0, 1.0, 0.0)));
  let up = cross(right, fwd);
  let px = (uv - 0.5) * vec2f(2.0 * aspect, 2.0);
  let rd = normalize(fwd * 1.9 + right * px.x + up * px.y);

  // the march
  let budget = select(128.0, max(uf(4u), 4.0), MODE == 2);
  var tt = 0.0;
  var m = 0.0;
  var steps = 0.0;
  var hit = false;
  for (var i = 0; i < 128; i++) {
    if (f32(i) >= budget) { break; }
    steps = f32(i) + 1.0;
    let p = ro + rd * tt;
    let h = map(p);
    if (h.x < 0.0012 * (1.0 + tt)) { m = h.y; hit = true; break; }
    tt += h.x;
    if (tt > 14.0) { break; }
  }

  let view = u32(uf(13u));
  if (view == 2u || MODE == 2) {
    // cost view: how many spheres did this pixel inflate?
    var c = heat(steps / select(96.0, budget, MODE == 2));
    if (!hit) { c *= 0.55; }
    return c;
  }

  if (!hit) { return skyBg(rd); }

  let p = ro + rd * tt;
  let n = calcNormal(p);
  if (view == 1u) { return n * 0.5 + 0.5; }

  // materials
  var albedo = vec3f(0.23, 0.22, 0.21);             // ground: concrete
  if (m > 2.5) { albedo = vec3f(0.32, 0.26, 0.2); } // pedestal: warm stone
  else if (m > 1.5) { albedo = vec3f(0.65, 0.34, 0.18); } // sculpture: copper
  if (m < 1.5) {
    // checker, the traditional floor of every distance field demo
    let ch = f32((i32(floor(p.x * 1.4)) + i32(floor(p.z * 1.4))) & 1);
    albedo *= 0.8 + 0.4 * ch;
  }

  let lp = vec3f(uf(10u), uf(11u), uf(12u));
  let ld = normalize(lp - p);
  let dist2 = dot(lp - p, lp - p);
  let shK = uf(15u);
  let sh = softShadow(p + n * 0.012, ld, shK);
  let dif = max(dot(n, ld), 0.0) * sh * 9.0 / max(dist2, 0.4);
  let aoAmt = uf(5u);
  let ao = mix(1.0, ambientOcc(p, n), aoAmt);
  let skyAmb = mix(0.22, 0.36, clamp(n.y * 0.5 + 0.5, 0.0, 1.0)) * ao;
  let bounceAmb = vec3f(0.05, 0.04, 0.035) * clamp(-n.y * 0.5 + 0.5, 0.0, 1.0) * ao;

  var col = albedo * (dif * vec3f(1.0, 0.87, 0.7) + skyAmb * vec3f(0.45, 0.55, 0.8)) + bounceAmb;
  // a little specular so the copper reads as metal
  if (m > 1.5 && m < 2.5) {
    let h = normalize(ld - rd);
    col += vec3f(1.0, 0.8, 0.6) * pow(max(dot(n, h), 0.0), 36.0) * sh * 0.5;
  }

  // distance haze — the dishonest fog: no scattering, just a blend
  col = mix(col, skyBg(rd), 1.0 - exp(-0.0045 * tt * tt));

  col = col / (1.0 + col);
  return pow(col, vec3f(0.4545));
}
`;
}

export async function mountSculpt(container: HTMLElement, opts: SculptOptions): Promise<Demo> {
  const dev = await getDevice();
  const shell = new Shell(container, opts.mode === "hero" ? 0.52 : 0.6);
  if (!dev) return gpuMissing(container);

  // a marcher pays per pixel — render at a milder resolution than the
  // particle demos and let CSS stretch it
  {
    const w = Math.min(container.clientWidth || 720, 900);
    const scale = 1.35;
    shell.canvas.width = Math.floor(w * scale);
    shell.canvas.height = Math.floor(w * (opts.mode === "hero" ? 0.52 : 0.6) * scale);
  }

  const modeNum = { hero: 0, blend: 1, steps: 2, shade: 3, full: 4 }[opts.mode];
  const view = new ShaderView(dev, shell.canvas, sceneWGSL(modeNum));

  // ---- state ------------------------------------------------------------------
  let sminK = 0.22;
  let budget = 48;
  let aoAmt = 1.0;
  let shadowK = 14;
  let viewMode = 0;
  let yaw = 0;
  let pitch = 0;

  // drag to orbit (every mode)
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let lastDrag = 0;
  shell.canvas.addEventListener("pointerdown", (e) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
  });
  shell.canvas.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    yaw -= (e.clientX - lastX) * 0.008;
    pitch += (e.clientY - lastY) * 0.005;
    pitch = Math.max(-0.35, Math.min(0.85, pitch));
    lastX = e.clientX;
    lastY = e.clientY;
    lastDrag = performance.now();
  });
  const endDrag = (): void => {
    dragging = false;
  };
  shell.canvas.addEventListener("pointerup", endDrag);
  shell.canvas.addEventListener("pointerleave", endDrag);

  // ---- controls ----------------------------------------------------------------
  if (opts.mode === "blend") {
    shell.slider({
      label: "blend k",
      min: 0.001, max: 0.55, step: 0.001, value: sminK,
      format: (v) => (v < 0.01 ? "hard min()" : v.toFixed(2)),
      onInput: (v) => (sminK = v),
    });
  }
  if (opts.mode === "steps") {
    shell.slider({
      label: "step budget",
      min: 4, max: 128, step: 1, value: budget,
      format: (v) => String(Math.round(v)),
      onInput: (v) => (budget = Math.round(v)),
    });
  }
  if (opts.mode === "shade" || opts.mode === "full") {
    shell.slider({
      label: "shadow sharpness",
      min: 2, max: 64, step: 0.5, value: shadowK,
      format: (v) => (v < 5 ? "overcast" : v > 45 ? "knife edge" : v.toFixed(0)),
      onInput: (v) => (shadowK = v),
    });
    shell.slider({
      label: "ambient occlusion",
      min: 0, max: 1, step: 0.01, value: aoAmt,
      onInput: (v) => (aoAmt = v),
    });
  }
  if (opts.mode === "full") {
    shell.button("view: final", function () {
      viewMode = (viewMode + 1) % VIEW_NAMES.length;
      const btn = shell.controls.querySelectorAll("button")[0];
      btn.textContent = `view: ${VIEW_NAMES[viewMode]}`;
    });
  }
  shell.setInfo(() => {
    if (opts.mode === "steps") return `${budget} steps max · drag to orbit`;
    if (opts.mode === "full") return `drag to orbit · cursor carries the light`;
    return "drag to orbit";
  });

  let time0 = performance.now();
  return {
    frame() {
      shell.tick();
      const t = (performance.now() - time0) / 1000;
      const u = view.uniforms;
      u[4] = opts.mode === "blend" ? sminK : budget;
      u[5] = opts.mode === "shade" || opts.mode === "full" ? aoAmt : 1.0;
      u[6] = yaw;
      u[7] = pitch;
      // the light: a slow orbit by default; the cursor carries it in `full`
      let lp: [number, number, number] = [
        2.6 * Math.sin(t * 0.21 + 2.0), 2.6, 2.6 * Math.cos(t * 0.21 + 2.0),
      ];
      if (opts.mode === "full" && view.pointer.inside && !dragging) {
        const az = (view.pointer.x - 0.5) * Math.PI * 2.2;
        const h = 0.5 + view.pointer.y * 3.2;
        lp = [2.4 * Math.sin(az), h, 2.4 * Math.cos(az)];
      }
      u[10] = lp[0];
      u[11] = lp[1];
      u[12] = lp[2];
      u[13] = opts.mode === "steps" ? 2 : viewMode;
      u[14] = performance.now() - lastDrag > 3500 ? 1 : 0;
      u[15] = opts.mode === "shade" || opts.mode === "full" ? shadowK : 18;
      view.draw();
    },
  };
}
