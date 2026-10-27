// Part four's demos: sphere tracing analytic SDFs, all through ShaderView
// (one fullscreen fragment shader per figure).
//   hero  — the sculpture: smin blobs and a torus over a pedestal, orbiting camera
//   blend — three shapes and one knob: smooth-minimum morphing
//   steps — the cost made visible: a step-count heatmap with a budget slider
//   shade — soft shadows and ambient occlusion, each on its own knob
//   full  — everything, with the light riding your cursor and debug views
//
// Uniform map (U[0] is ShaderView's time/aspect/pointer):
//   uf(4) A     — smin k (blend) · step budget (steps) · unused elsewhere
//   uf(5) B     — AO strength (shade/full)
//   uf(6,7)     — camera yaw/pitch offsets (drag to orbit)
//   uf(8)       — camera yaw from the slow auto-orbit
//   uf(10..12)  — light position, world
//   uf(13)      — view mode: 0 final · 1 normals · 2 step heat
//   uf(15)      — shadow sharpness k: 2 = penumbra everywhere … 64 = knife

import { Shell, gpuMissing, type Demo } from "../../lib/demoShell";
import { getDevice } from "../../lib/gpu";
import { ShaderView } from "../../lib/shaderCanvas";

export interface SculptOptions {
  mode: "hero" | "blend" | "steps" | "shade" | "full";
}

const VIEW_NAMES = ["final", "normals", "step count"];
export const MAX_STEPS = 128;

function sceneWGSL(mode: number): string {
  return /* wgsl */ `
const MODE: i32 = ${mode};
const MAX_STEPS: i32 = ${MAX_STEPS};
const TMAX: f32 = 26.0;

fn rotY(p: vec3f, a: f32) -> vec3f {
  let c = cos(a); let s = sin(a);
  return vec3f(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}

fn rotX(p: vec3f, a: f32) -> vec3f {
  let c = cos(a); let s = sin(a);
  return vec3f(p.x, c * p.y - s * p.z, s * p.y + c * p.z);
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

// the polynomial smooth minimum: within k of each other, two surfaces
// blend instead of meeting in a crease
fn smin(a: f32, b: f32, k: f32) -> f32 {
  let kk = max(k, 1e-4);
  let h = clamp(0.5 + 0.5 * (b - a) / kk, 0.0, 1.0);
  return mix(b, a, h) - kk * h * (1.0 - h);
}

// distance + material id: the whole world in one function
// materials: 1 floor · 2 sculpture · 3 pedestal
fn map(p: vec3f) -> vec2f {
  let t = uf(0u);
  var d = p.y;            // the floor: distance to the plane y = 0, exactly
  var m = 1.0;

  if (MODE == 1) {
    // ---- the blend lab: three shapes, one knob --------------------------------
    let k = uf(4u);
    let orbit = vec3f(0.85 * sin(t * 0.5), 0.62 + 0.22 * sin(t * 0.33), 0.5 * cos(t * 0.5));
    // a sphere and a box 0.2 apart: they never touch
    var s = sdSphere(p - vec3f(-0.55, 0.46, 0.0), 0.46);
    s = smin(s, sdRoundBox(p - vec3f(0.53, 0.42, 0.0), vec3f(0.38, 0.38, 0.38), 0.04), k);
    s = smin(s, sdSphere(p - orbit, 0.3), k);
    if (s < d) { d = s; m = 2.0; }
  } else {
    // ---- the sculpture: pedestal + a torus + three wandering blobs ----------------
    let ped = sdRoundBox(p - vec3f(0.0, 0.34, 0.0), vec3f(0.42, 0.3, 0.42), 0.04);
    if (ped < d) { d = ped; m = 3.0; }
    let c = vec3f(0.0, 1.2, 0.0);
    let k = 0.17;
    var s = sdTorus(rotX(rotY(p - c, t * 0.2), 0.35), vec2f(0.42, 0.1));
    s = smin(s, sdSphere(p - (c + vec3f(0.30 * sin(t * 0.43), 0.22 * sin(t * 0.31 + 2.0), 0.30 * cos(t * 0.43))), 0.26), k);
    s = smin(s, sdSphere(p - (c + vec3f(0.34 * sin(t * 0.27 + 4.0), 0.30 * cos(t * 0.36), 0.20 * sin(t * 0.5 + 1.0))), 0.21), k);
    s = smin(s, sdSphere(p - (c + vec3f(0.0, 0.40 * sin(t * 0.22), 0.0)), 0.23), k);
    if (s < d) { d = s; m = 2.0; }
  }
  return vec2f(d, m);
}

// gradient of the distance = the surface normal. Four taps on a tetrahedron.
fn calcNormal(p: vec3f) -> vec3f {
  let e = 0.0015;
  let k = vec2f(1.0, -1.0);
  return normalize(
    k.xyy * map(p + k.xyy * e).x +
    k.yyx * map(p + k.yyx * e).x +
    k.yxy * map(p + k.yxy * e).x +
    k.xxx * map(p + k.xxx * e).x
  );
}

// march toward the light; the closest miss along the way sets the penumbra.
// k large = shadows snap hard, k small = everything is dusk.
fn softShadow(ro: vec3f, rd: vec3f, k: f32, tmax: f32) -> f32 {
  var res = 1.0;
  var t = 0.03;
  for (var i = 0; i < 40; i++) {
    let h = map(ro + rd * t).x;
    if (h < 0.0008) { return 0.0; }
    res = min(res, k * h / t);
    t += clamp(h, 0.012, 0.3);
    if (t > tmax) { break; }
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

// a dusk studio: dark blue overhead, a warmer band at the horizon
fn sky(rd: vec3f) -> vec3f {
  let h = clamp(rd.y, -0.3, 1.0);
  let horizon = vec3f(0.085, 0.072, 0.075);
  let zenith = vec3f(0.012, 0.016, 0.034);
  return mix(horizon, zenith, smoothstep(-0.05, 0.55, h));
}

// what a shiny surface sees: the same sky, plus two studio softboxes (a big
// warm one overhead, a cool strip low on the far side) and the dim floor
fn reflEnv(r: vec3f) -> vec3f {
  if (r.y < 0.0) { return vec3f(0.06, 0.052, 0.046) * (1.0 + r.y * 0.5); }
  var c = sky(r) * 1.4;
  c += vec3f(0.5, 0.42, 0.36) * smoothstep(0.3, 0.0, r.y) * 0.35;
  c += vec3f(1.0, 0.86, 0.7) * smoothstep(0.84, 0.95, dot(r, normalize(vec3f(-0.45, 0.85, 0.3)))) * 1.5;
  c += vec3f(0.55, 0.7, 1.0) * smoothstep(0.88, 0.97, dot(r, normalize(vec3f(0.75, 0.25, -0.6)))) * 1.1;
  return c;
}

// the dark-to-bright "cost" ramp, the same stops as the site's heat palette
fn heat(x: f32) -> vec3f {
  let a = clamp(x, 0.0, 1.0) * 4.0;
  let c0 = vec3f(22.0, 14.0, 52.0) / 255.0;
  let c1 = vec3f(96.0, 28.0, 110.0) / 255.0;
  let c2 = vec3f(196.0, 58.0, 82.0) / 255.0;
  let c3 = vec3f(246.0, 128.0, 44.0) / 255.0;
  let c4 = vec3f(252.0, 226.0, 120.0) / 255.0;
  if (a < 1.0) { return mix(c0, c1, a); }
  if (a < 2.0) { return mix(c1, c2, a - 1.0); }
  if (a < 3.0) { return mix(c2, c3, a - 2.0); }
  return mix(c3, c4, a - 3.0);
}

// ACES filmic fit (Stephen Hill), then gamma for the canvas
fn aces(c: vec3f) -> vec3f {
  let m1 = mat3x3f(
    vec3f(0.59719, 0.07600, 0.02840),
    vec3f(0.35458, 0.90834, 0.13383),
    vec3f(0.04823, 0.01566, 0.83777),
  );
  let m2 = mat3x3f(
    vec3f(1.60475, -0.10208, -0.00327),
    vec3f(-0.53108, 1.10813, -0.07276),
    vec3f(-0.07367, -0.00605, 1.07602),
  );
  let v = m1 * c;
  let a = v * (v + 0.0245786) - 0.000090537;
  let b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return clamp(m2 * (a / b), vec3f(0.0), vec3f(1.0));
}

fn finish(c: vec3f, uv: vec2f) -> vec3f {
  var col = pow(aces(c * 1.1), vec3f(1.0 / 2.2));
  let q = uv - 0.5;
  col *= 1.0 - 0.45 * dot(q, q);
  return col;
}

fn fresnel(f0: vec3f, cosT: f32) -> vec3f {
  return f0 + (vec3f(1.0) - f0) * pow(1.0 - clamp(cosT, 0.0, 1.0), 5.0);
}

fn scene(uv: vec2f) -> vec3f {
  let aspect = uf(1u);
  // camera: orbit around the plinth
  let yaw = uf(6u) + uf(8u) + 0.6;
  let pitch = clamp(uf(7u) + 0.3, -0.1, 1.2);
  let radius = select(3.7, 3.2, MODE == 1);
  let tgt = select(vec3f(0.0, 0.9, 0.0), vec3f(0.0, 0.45, 0.0), MODE == 1);
  let ro = tgt + radius * vec3f(cos(pitch) * sin(yaw), sin(pitch), cos(pitch) * cos(yaw));
  let fwd = normalize(tgt - ro);
  let right = normalize(cross(fwd, vec3f(0.0, 1.0, 0.0)));
  let up = cross(right, fwd);
  let px = (uv - 0.5) * vec2f(2.0 * aspect, 2.0);
  let rd = normalize(fwd * 2.1 + right * px.x + up * px.y);

  // the march: step by the distance to the nearest surface, until it's tiny
  let budget = select(f32(MAX_STEPS), clamp(uf(4u), 4.0, f32(MAX_STEPS)), MODE == 2);
  var tt = 0.0;
  var m = 0.0;
  var steps = 0.0;
  var hit = false;
  var gaveUp = false;
  for (var i = 0; i < MAX_STEPS; i++) {
    if (f32(i) >= budget) { gaveUp = true; break; }
    steps = f32(i) + 1.0;
    let h = map(ro + rd * tt);
    if (h.x < 0.001 * (1.0 + tt)) { m = h.y; hit = true; break; }
    tt += h.x;
    if (tt > TMAX) { break; }
  }

  let view = u32(uf(13u));
  if (view == 2u || MODE == 2) {
    // cost view: how many steps did this pixel take?
    if (gaveUp) { return vec3f(0.12, 0.62, 0.66); } // ran out of budget before reaching anything
    var c = heat(steps / f32(MAX_STEPS) * 1.6);
    if (!hit) { c *= 0.6; }
    return c;
  }

  // past the march's reach, the floor is still there: hit the plane exactly
  if (!hit && rd.y < 0.0) {
    tt = -ro.y / rd.y;
    m = 1.0;
    hit = true;
  }
  if (!hit) { return finish(sky(rd), uv); }

  let p = ro + rd * tt;
  var n = calcNormal(p);
  if (m < 1.5 && p.y < 0.01) { n = vec3f(0.0, 1.0, 0.0); }
  if (view == 1u) { return n * 0.5 + 0.5; }

  let v = -rd;
  let lp = vec3f(uf(10u), uf(11u), uf(12u));
  let toL = lp - p;
  let dist2 = dot(toL, toL);
  let ld = toL * inverseSqrt(dist2);
  let sh = softShadow(p + n * 0.01, ld, uf(15u), sqrt(dist2));
  let ao = mix(1.0, ambientOcc(p, n), uf(5u));

  let keyCol = vec3f(1.0, 0.8, 0.6) * 11.0 / max(dist2, 0.6);
  let dif = max(dot(n, ld), 0.0) * sh;
  let skyFill = vec3f(0.30, 0.38, 0.58) * (0.6 + 0.4 * n.y) * 0.32 * ao;
  let bounce = vec3f(0.40, 0.30, 0.22) * clamp(0.5 - 0.5 * n.y, 0.0, 1.0) * 0.18 * ao;
  let hv = normalize(ld + v);
  let nh = max(dot(n, hv), 0.0);
  let r = reflect(rd, n);

  var col = vec3f(0.0);
  if (m > 1.5 && m < 2.5) {
    // copper: all specular, coloured by the metal
    let f0 = vec3f(0.95, 0.6, 0.45);
    let F = fresnel(f0, dot(n, v));
    let shine = 48.0;
    let spec = pow(nh, shine) * (shine + 8.0) / 25.0;
    col = keyCol * dif * fresnel(f0, dot(hv, v)) * spec;
    // the studio in the metal; AO stands in for the sculpture hiding it from itself
    col += reflEnv(r) * F * mix(0.35, 1.0, ao);
    col += f0 * 0.04 * (skyFill + keyCol * dif * 0.15);
  } else {
    var albedo = vec3f(0.29, 0.27, 0.25);           // floor: warm concrete
    if (m > 2.5) {
      albedo = vec3f(0.58, 0.54, 0.5);              // pedestal: pale stone
    } else {
      // a faint grid, thickened with distance so it doesn't shimmer
      let w = 0.006 + 0.0025 * tt;
      let g = abs(fract(p.xz * 2.0 + 0.5) - 0.5) / 2.0;
      let line = 1.0 - smoothstep(0.0, w, min(g.x, g.y));
      albedo *= 1.0 - 0.28 * line;
    }
    col = albedo * (keyCol * dif + skyFill + bounce);
    let spec = pow(nh, 24.0) * 0.06;
    col += keyCol * dif * spec;
    col += reflEnv(r) * fresnel(vec3f(0.04), dot(n, v)) * ao * 0.5;
  }

  // distance haze. No scattering, just a blend toward the sky colour, and
  // complete before the far floor gets anywhere near the edge of the march
  let fog = 1.0 - exp(-pow(max(tt - 4.5, 0.0), 2.0) * 0.022);
  col = mix(col, sky(rd), fog);
  return finish(col, uv);
}
`;
}

export async function mountSculpt(container: HTMLElement, opts: SculptOptions): Promise<Demo> {
  const dev = await getDevice();
  const hero = opts.mode === "hero";
  const shell = new Shell(container, hero ? 0.56 : 0.6);
  if (!dev) return gpuMissing(container);

  // A marcher pays per pixel. Keep the shell's size and aspect (the essay
  // hero picks its own), but render to a pixel budget and let CSS stretch it.
  {
    const cssW = shell.canvas.clientWidth || shell.canvas.width / Math.min(window.devicePixelRatio || 1, 2);
    const aspect = shell.canvas.height / shell.canvas.width;
    // figures get a little supersampling: one sample per pixel leaves jagged silhouettes
    const dpr = window.devicePixelRatio || 1;
    const budget = hero ? 1_600_000 : 900_000;
    let w = Math.round(cssW * (hero ? Math.min(dpr, 1.5) : Math.min(Math.max(dpr, 1.5), 2)));
    if (w * w * aspect > budget) w = Math.floor(Math.sqrt(budget / aspect));
    shell.canvas.width = w;
    shell.canvas.height = Math.round(w * aspect);
  }

  const modeNum = { hero: 0, blend: 1, steps: 2, shade: 3, full: 4 }[opts.mode];
  const view = new ShaderView(dev, shell.canvas, sceneWGSL(modeNum));

  // ---- state ------------------------------------------------------------------
  let sminK = 0.22;
  let budget = 48;
  let aoAmt = 1.0;
  let shadowK = 14;
  let viewMode = 0;
  // the blend lab starts square-on, so the sphere and the box sit side by side
  let yaw = opts.mode === "blend" ? -0.45 : 0;
  let pitch = 0;
  let autoYaw = 0;

  // drag sideways to orbit (every mode); vertical drags still scroll on touch
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let lastDrag = -1e9;
  shell.canvas.style.touchAction = "pan-y";
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
  shell.canvas.addEventListener("pointercancel", endDrag);
  shell.canvas.addEventListener("pointerleave", endDrag);

  // ---- controls ----------------------------------------------------------------
  if (opts.mode === "blend") {
    shell.slider({
      label: "blend radius k",
      min: 0, max: 0.55, step: 0.01, value: sminK,
      format: (v) => (v < 0.005 ? "0 (plain min)" : v.toFixed(2)),
      onInput: (v) => (sminK = v),
    });
  }
  if (opts.mode === "steps") {
    shell.slider({
      label: "step budget",
      min: 4, max: MAX_STEPS, step: 1, value: budget,
      format: (v) => String(Math.round(v)),
      onInput: (v) => (budget = Math.round(v)),
    });
  }
  if (opts.mode === "shade" || opts.mode === "full") {
    shell.slider({
      label: "shadow sharpness k",
      min: 2, max: 64, step: 0.5, value: shadowK,
      format: (v) => v.toFixed(v < 10 ? 1 : 0),
      onInput: (v) => (shadowK = v),
    });
    shell.slider({
      label: "ambient occlusion",
      min: 0, max: 1, step: 0.01, value: aoAmt,
      format: (v) => (v < 0.005 ? "off" : v.toFixed(2)),
      onInput: (v) => (aoAmt = v),
    });
  }
  if (opts.mode === "full") {
    const btn = shell.button(`view: ${VIEW_NAMES[0]}`, () => {
      viewMode = (viewMode + 1) % VIEW_NAMES.length;
      btn.textContent = `view: ${VIEW_NAMES[viewMode]}`;
    });
  }
  shell.setInfo(() => {
    if (opts.mode === "steps") return `${budget} steps max · teal pixels ran out of steps · drag to orbit`;
    if (opts.mode === "full") return "drag to orbit · the light follows your cursor";
    return "drag to orbit";
  });

  const time0 = performance.now();
  let lastT = time0;
  return {
    frame() {
      shell.tick();
      const now = performance.now();
      const t = (now - time0) / 1000;
      const dt = Math.min((now - lastT) / 1000, 0.1);
      lastT = now;
      // a slow orbit that pauses while you hold the camera, then picks up
      if (now - lastDrag > 3500 && opts.mode !== "blend") autoYaw += dt * 0.1;
      const u = view.uniforms;
      u[4] = opts.mode === "blend" ? sminK : budget;
      u[5] = opts.mode === "shade" || opts.mode === "full" ? aoAmt : 1.0;
      u[6] = yaw;
      u[7] = pitch;
      u[8] = autoYaw;
      // the light: a slow orbit by default; the cursor carries it in `full`
      let lp: [number, number, number] = [2.6 * Math.sin(t * 0.21 + 2.0), 2.7, 2.6 * Math.cos(t * 0.21 + 2.0)];
      if (opts.mode === "full" && view.pointer.inside && !dragging) {
        const az = (view.pointer.x - 0.5) * Math.PI * 2.2;
        const h = 0.5 + view.pointer.y * 3.2;
        lp = [2.4 * Math.sin(az), h, 2.4 * Math.cos(az)];
      }
      u[10] = lp[0];
      u[11] = lp[1];
      u[12] = lp[2];
      u[13] = opts.mode === "steps" ? 2 : viewMode;
      u[15] = opts.mode === "shade" || opts.mode === "full" ? shadowK : 16;
      view.draw();
    },
  };
}
