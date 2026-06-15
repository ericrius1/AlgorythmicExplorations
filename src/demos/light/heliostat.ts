// Heliostat — a procedural, seamless-looping solar-punk sculpture.
//
// A sunflower dish of brass-and-glass panels furls and turns toward a moving
// light; a molten "sun-seed" burns at its heart; pollen drifts around it on a
// living wind. Everything is driven by one phase variable that runs 0 → 2π over
// a 12-second loop, so the last frame is exactly the first.
//
// Two techniques are lifted, in depth, from elsewhere in the blog:
//
//   1. Curl-noise flow field  (Particle Worlds, part six). The pollen rides a
//      divergence-free wind — the curl of a value-noise vector potential — so
//      it swirls forever instead of pooling. Phase enters the noise through a
//      (cos, sin) pair, which makes the whole field exactly 2π-periodic.
//
//   2. Smooth-minimum SDF sphere tracing (Bounced Light, part four — flatland).
//      The sun-seed is no mesh: it is a handful of analytic spheres and a torus
//      welded with the polynomial smooth-minimum and sphere-traced per pixel,
//      with central-difference normals, a soft penumbra shadow, and five-probe
//      ambient occlusion — all in a WGSL function dropped into a TSL material.

import * as THREE from "three/webgpu";
import { RenderPipeline } from "three/webgpu";
import { wgslFn, positionLocal, uniform, pass, vec3, mix, float, smoothstep } from "three/tsl";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { Shell, type Demo } from "../../lib/demoShell";
import { createStage3D } from "../../lib/stage3d";

const TAU = Math.PI * 2;
const LOOP_SECONDS = 12;
const GOLDEN = Math.PI * (3 - Math.sqrt(5)); // 137.5° — the sunflower angle
const DISH_R = 2.35;
const PANELS = 150;
const POLLEN = 180;

// ----------------------------------------------------------------------------
// Technique 1 — curl-noise wind (Particle Worlds, part six)
// ----------------------------------------------------------------------------
function hash01(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

const fade = (t: number): number => t * t * (3 - 2 * t);

// cheap 3-D value noise on a hashed lattice
function vnoise(x: number, y: number, z: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const u = fade(x - xi), v = fade(y - yi), w = fade(z - zi);
  const lat = (i: number, j: number, k: number): number =>
    2 * hash01(i + j * 57 + k * 113) - 1;
  const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
  const c00 = lerp(lat(xi, yi, zi), lat(xi + 1, yi, zi), u);
  const c10 = lerp(lat(xi, yi + 1, zi), lat(xi + 1, yi + 1, zi), u);
  const c01 = lerp(lat(xi, yi, zi + 1), lat(xi + 1, yi, zi + 1), u);
  const c11 = lerp(lat(xi, yi + 1, zi + 1), lat(xi + 1, yi + 1, zi + 1), u);
  return lerp(lerp(c00, c10, v), lerp(c01, c11, v), w);
}

// a 3-channel vector potential Ψ(p); phase rides a circle through noise space,
// so Ψ — and therefore its curl — returns to itself after one loop
function potential(x: number, y: number, z: number, phase: number, out: THREE.Vector3): THREE.Vector3 {
  const cx = Math.cos(phase) * 1.3, sx = Math.sin(phase) * 1.3;
  const s = 0.55;
  out.set(
    vnoise(x * s + cx, y * s + sx, z * s),
    vnoise(y * s + 31.4 + cx, z * s + sx, x * s),
    vnoise(z * s + 57.1 + cx, x * s + sx, y * s),
  );
  return out;
}

const _pa = new THREE.Vector3();
const _pb = new THREE.Vector3();

// velocity = ∇ × Ψ by central differences — divergence-free by construction
function curlNoise(x: number, y: number, z: number, phase: number, out: THREE.Vector3): THREE.Vector3 {
  const e = 0.09, inv = 1 / (2 * e);
  const dZdy = (potential(x, y + e, z, phase, _pa).z - potential(x, y - e, z, phase, _pb).z) * inv;
  const dYdz = (potential(x, y, z + e, phase, _pa).y - potential(x, y, z - e, phase, _pb).y) * inv;
  const dXdz = (potential(x, y, z + e, phase, _pa).x - potential(x, y, z - e, phase, _pb).x) * inv;
  const dZdx = (potential(x + e, y, z, phase, _pa).z - potential(x - e, y, z, phase, _pb).z) * inv;
  const dYdx = (potential(x + e, y, z, phase, _pa).y - potential(x - e, y, z, phase, _pb).y) * inv;
  const dXdy = (potential(x, y + e, z, phase, _pa).x - potential(x, y - e, z, phase, _pb).x) * inv;
  out.set(dZdy - dYdz, dXdz - dZdx, dYdx - dXdy);
  return out;
}

// ----------------------------------------------------------------------------
// Technique 2 — smooth-minimum SDF sun-seed (Bounced Light, part four)
//   Entry function MUST be first: three's wgslFn takes its name + signature
//   from the first declaration; the helpers below are forward-referenced
//   (legal at WGSL module scope). All time terms use integer multiples of `ph`
//   so the field is 2π-periodic and the loop is seamless.
// ----------------------------------------------------------------------------
const sunSeed = wgslFn(/* wgsl */ `
fn sunSeed(fragPos: vec3f, camPos: vec3f, ph: f32) -> vec4f {
  let rd = normalize(fragPos - camPos);
  var t = 0.0;
  var hit = false;
  var p = fragPos;
  for (var i = 0; i < 64; i = i + 1) {
    p = fragPos + rd * t;
    let h = mapSeed(p, ph);
    if (h < 0.0012) { hit = true; break; }
    t = t + h;
    if (length(p) > 0.95) { break; }
  }
  if (!hit) { return vec4f(0.0, 0.0, 0.0, 0.0); }

  let n = nrmSeed(p, ph);
  let occ = aoSeed(p, n, ph);
  let ld = normalize(vec3f(0.45, 0.85, 0.5));
  let sh = shadowSeed(p + n * 0.012, ld, 11.0, ph);
  let dif = max(dot(n, ld), 0.0) * sh;
  let fres = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);
  let core = exp(-length(p) * 4.0);
  // Re-tuned for ACES filmic tonemapping: the renderer now tonemaps the linear
  // scene once at output, which rolls saturated highlights toward white. To keep
  // the molten gold heart + green rim reading richly we (a) saturate the base
  // hues, (b) push the HDR core well above 1.0 so it survives the roll-off and
  // feeds bloom, and (c) keep the breath shallower so the peak doesn't blow out.
  let gold = vec3f(1.0, 0.60, 0.16);
  let green = vec3f(0.28, 1.0, 0.58);
  var col = gold * (0.35 + 1.05 * dif) * occ;  // shaped body
  col = col + gold * core * 4.2;               // emissive heart (HDR, blooms)
  col = col + green * fres * 1.0;              // solar-punk rim glow
  col = col * (0.95 + 0.22 * sin(ph));         // breathing brightness
  let a = clamp(max(col.r, max(col.g, col.b)), 0.0, 1.0);
  return vec4f(col, a);
}

fn rotY(p: vec3f, a: f32) -> vec3f {
  let c = cos(a); let s = sin(a);
  return vec3f(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}
fn sdSphere(p: vec3f, r: f32) -> f32 { return length(p) - r; }
fn sdTorus(p: vec3f, tt: vec2f) -> f32 {
  let q = vec2f(length(p.xz) - tt.x, p.y);
  return length(q) - tt.y;
}
// the polynomial smooth minimum: two surfaces that refuse to crease — the
// whole reason this looks like molten wax instead of boolean CSG
fn smin(a: f32, b: f32, k: f32) -> f32 {
  let kk = max(k, 1e-4);
  let h = clamp(0.5 + 0.5 * (b - a) / kk, 0.0, 1.0);
  return mix(b, a, h) - kk * h * (1.0 - h);
}
fn mapSeed(p: vec3f, ph: f32) -> f32 {
  let k = 0.20;
  var d = sdSphere(p, 0.40 + 0.03 * sin(ph));
  d = smin(d, sdSphere(p - vec3f(0.30 * sin(ph), 0.22 * sin(ph * 2.0 + 1.0), 0.30 * cos(ph)), 0.22), k);
  d = smin(d, sdSphere(p - vec3f(0.28 * cos(ph), 0.26 * sin(ph), 0.24 * cos(ph * 2.0)), 0.20), k);
  d = smin(d, sdSphere(p - vec3f(0.0, 0.34 * sin(ph), 0.0), 0.21), k);
  d = smin(d, sdTorus(rotY(p, ph), vec2f(0.54, 0.06)), 0.12);
  return d;
}
fn nrmSeed(p: vec3f, ph: f32) -> vec3f {
  let e = 0.0015;
  return normalize(vec3f(
    mapSeed(p + vec3f(e, 0.0, 0.0), ph) - mapSeed(p - vec3f(e, 0.0, 0.0), ph),
    mapSeed(p + vec3f(0.0, e, 0.0), ph) - mapSeed(p - vec3f(0.0, e, 0.0), ph),
    mapSeed(p + vec3f(0.0, 0.0, e), ph) - mapSeed(p - vec3f(0.0, 0.0, e), ph)
  ));
}
fn shadowSeed(ro: vec3f, rd: vec3f, k: f32, ph: f32) -> f32 {
  var res = 1.0; var t = 0.02;
  for (var i = 0; i < 24; i = i + 1) {
    let h = mapSeed(ro + rd * t, ph);
    if (h < 0.001) { return 0.0; }
    res = min(res, k * h / t);
    t = t + clamp(h, 0.01, 0.2);
    if (t > 2.0) { break; }
  }
  return clamp(res, 0.0, 1.0);
}
fn aoSeed(p: vec3f, n: vec3f, ph: f32) -> f32 {
  var occ = 0.0; var sca = 1.0;
  for (var i = 1; i <= 5; i = i + 1) {
    let h = 0.02 + 0.10 * f32(i);
    occ = occ + (h - mapSeed(p + n * h, ph)) * sca;
    sca = sca * 0.72;
  }
  return clamp(1.0 - 1.6 * occ, 0.0, 1.0);
}
`);

// ----------------------------------------------------------------------------
interface Panel {
  home: THREE.Vector3;
  radial: THREE.Vector3; // outward unit direction in the dish plane
  frac: number;          // 0 at centre, 1 at rim
  scale: number;
}

export async function mountHeliostat(container: HTMLElement): Promise<Demo> {
  const aspect = Math.max(0.5, Math.min(1.1, window.innerHeight / Math.max(window.innerWidth, 1)));
  const shell = new Shell(container, aspect);
  const stage = await createStage3D(shell.canvas, {
    skyTop: [0.006, 0.03, 0.028],
    skyBottom: [0.02, 0.08, 0.07],
    fog: { color: 0x05231f, near: 9, far: 26 },
    hemi: { sky: 0xb6ffe2, ground: 0x16321d, intensity: 1.25 },
    key: { color: 0xffe6ac, intensity: 3.4, position: [4, 7, 5] },
    rim: { color: 0x46ffd2, intensity: 2.0, position: [-5, 3, -4] },
    target: [0, 1.75, 0],
    distance: 7.4,
    minDistance: 4,
    maxDistance: 13,
    elevation: 0.16,
    azimuth: 0.6,
    fov: 42,
    far: 60,
  });
  stage.orbit.autoSpin = 0; // the sculpture loops; keep the camera still so the whole frame does

  // ---- environment reflections (procedural PMREM) ---------------------------
  // A tiny env scene — a BackSide sphere with a vertical teal gradient plus one
  // warm (gold) and one cool (green) emissive card — pre-filtered into an env
  // map so the metals/glass pick up directional, solar-punk-tinted reflections.
  {
    const envScene = new THREE.Scene();
    const domeMat = new THREE.MeshBasicNodeMaterial();
    domeMat.side = THREE.BackSide;
    // deep teal at the bottom, brighter teal-cyan toward the top
    const bottomTeal = vec3(0.01, 0.06, 0.055);
    const topTeal = vec3(0.05, 0.22, 0.2);
    domeMat.colorNode = mix(bottomTeal, topTeal, positionLocal.y.mul(0.5).add(0.5).clamp(0, 1));
    const dome = new THREE.Mesh(new THREE.SphereGeometry(10, 24, 16), domeMat);
    envScene.add(dome);

    const warmMat = new THREE.MeshBasicNodeMaterial();
    warmMat.colorNode = vec3(1.6, 1.0, 0.45); // warm gold key
    const warmCard = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), warmMat);
    warmCard.position.set(5.5, 4.0, 3.0);
    warmCard.lookAt(0, 0, 0);
    envScene.add(warmCard);

    const greenMat = new THREE.MeshBasicNodeMaterial();
    greenMat.colorNode = vec3(0.25, 1.1, 0.6); // green fill
    const greenCard = new THREE.Mesh(new THREE.PlaneGeometry(5, 5), greenMat);
    greenCard.position.set(-5.5, 2.5, -3.5);
    greenCard.lookAt(0, 0, 0);
    envScene.add(greenCard);

    const pmrem = new THREE.PMREMGenerator(stage.renderer);
    try {
      // sigma 0.04: stays under the 20-sample cap (0.2 requested 98 -> clip
      // warning). The env is a smooth low-freq gradient + 2 soft cards, so the
      // slightly sharper blur won't band; it just sharpens directional reflections.
      stage.scene.environment = pmrem.fromScene(envScene, 0.04).texture;
    } catch (e) {
      console.warn("[heliostat] PMREM env build failed; metals fall back to emissive+bloom", e);
    }
    if (stage.scene.environment == null) {
      console.warn("[heliostat] scene.environment is null after PMREM; continuing without env reflections");
    }
    pmrem.dispose();
    domeMat.dispose();
    warmMat.dispose();
    greenMat.dispose();
    dome.geometry.dispose();
    warmCard.geometry.dispose();
    greenCard.geometry.dispose();
  }

  // ---- tone mapping + post-processing pipeline ------------------------------
  // ACES filmic tonemap; RenderPipeline (three/webgpu, formerly PostProcessing)
  // defaults outputColorTransform=true, so it applies tonemap + sRGB ONCE at output.
  stage.renderer.toneMapping = THREE.ACESFilmicToneMapping;
  stage.renderer.toneMappingExposure = 1.0;
  const post = new RenderPipeline(stage.renderer);
  const scenePass = pass(stage.scene, stage.camera);
  const scenePassColor = scenePass.getTextureNode();
  // Bloom budget: high threshold so only the genuinely-HDR seed core blooms, not
  // every mote; moderate strength/radius for a soft solar halo.
  const bloomPass = bloom(scenePassColor, 0.4, 0.5, 0.9);
  post.outputNode = scenePassColor.add(bloomPass);

  // ---- materials ----
  // Roughness nudged down + envMapIntensity raised so the new PMREM environment
  // (teal dome + warm/green cards) gives the metals real directional reflections.
  const brass = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.9, roughness: 0.22, emissive: 0x1c0d02, envMapIntensity: 1.1 });
  const darkMetal = new THREE.MeshStandardMaterial({ color: 0x16332c, metalness: 0.75, roughness: 0.3, emissive: 0x03130d, envMapIntensity: 1.0 });
  const paleBrass = new THREE.MeshStandardMaterial({ color: 0xffd479, metalness: 0.85, roughness: 0.18, emissive: 0x4a2403, envMapIntensity: 1.2 });
  // Pollen: additive light motes. Per-instance color/brightness set below; bloom
  // turns the brightest ones into drifting embers.
  const moteMat = new THREE.MeshBasicMaterial({ color: 0xffffff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });

  const dish = new THREE.Group();
  stage.scene.add(dish);

  // ---- base + stem + rim (light procedural scaffolding) ----
  const base = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.45, 0.36, 24), darkMetal);
  base.position.y = 0.18;
  dish.add(base);
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 1.5, 16), brass);
  stem.position.y = 1.0;
  dish.add(stem);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(DISH_R * 1.01, 0.05, 10, 120), paleBrass);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 1.95;
  dish.add(rim);
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.04, 8, 64), paleBrass);
  collar.rotation.x = Math.PI / 2;
  collar.position.y = 1.62;
  dish.add(collar);

  // ---- phyllotaxis panel dish (Technique-free body, but the host for both) ----
  const panelGeo = new THREE.CircleGeometry(0.18, 6); // flat hexagon, normal +Z
  // Solar glass: clearcoat over a brushed-metal base, lit by env reflections.
  // FrontSide (was DoubleSide) since reflections now give the front face all the
  // read it needs, and the panels overlap heavily at the dish centre.
  const panelMat = new THREE.MeshPhysicalNodeMaterial({
    metalness: 0.6,
    roughness: 0.25,
    emissive: new THREE.Color(0x05382c),
    emissiveIntensity: 0.6,
    clearcoat: 1.0,
    clearcoatRoughness: 0.25,
    envMapIntensity: 1.0,
    side: THREE.FrontSide,
  });
  // LOW iridescence — the dichroic solar-punk sheen. Kept on a single line so it
  // can be commented out if the perf check shows <60fps on the WebGL2 path.
  panelMat.iridescence = 0.3;
  panelMat.iridescenceIOR = 1.3;
  const panels = new THREE.InstancedMesh(panelGeo, panelMat, PANELS);
  panels.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  dish.add(panels);

  const panelData: Panel[] = [];
  const cBrass = new THREE.Color(0xd8902f);
  const cGreen = new THREE.Color(0x3ec98a);
  const tmpColor = new THREE.Color();
  for (let i = 0; i < PANELS; i++) {
    const frac = (i + 0.5) / PANELS;
    const ang = i * GOLDEN;
    const r = Math.sqrt(frac) * DISH_R;
    const y = 1.55 + 0.95 * frac * frac; // concave dish, rim lifted
    panelData.push({
      home: new THREE.Vector3(Math.cos(ang) * r, y, Math.sin(ang) * r),
      radial: new THREE.Vector3(Math.cos(ang), 0, Math.sin(ang)),
      frac,
      scale: 0.55 + 1.0 * frac,
    });
    tmpColor.copy(cBrass).lerp(cGreen, frac);
    panels.setColorAt(i, tmpColor);
  }
  if (panels.instanceColor) panels.instanceColor.needsUpdate = true;

  // ---- the sun-seed: a raymarched SDF, drawn on a bounding sphere ----
  const SEED_Y = 1.95;
  const phaseU = uniform(0);
  const camLocal = uniform(new THREE.Vector3());
  const seedMat = new THREE.MeshBasicNodeMaterial();
  // one wgslFn call node, referenced twice — the graph evaluates the march once
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const marched = sunSeed(positionLocal, camLocal, phaseU) as any;
  seedMat.colorNode = marched;
  seedMat.opacityNode = marched.w;
  seedMat.transparent = true;
  seedMat.depthWrite = false;
  seedMat.blending = THREE.AdditiveBlending;
  seedMat.side = THREE.FrontSide;
  const seed = new THREE.Mesh(new THREE.SphereGeometry(0.78, 48, 32), seedMat);
  seed.position.y = SEED_Y;
  seed.renderOrder = 4;
  stage.scene.add(seed);

  // ---- sun-seed corona: one soft additive halo behind the seed --------------
  // A camera-facing sprite with a radial gold→transparent gradient. Pulses on
  // phase (integer multiple → seamless). Peak clamped so it never clips the SDF
  // center to white.
  const coronaCanvas = document.createElement("canvas");
  coronaCanvas.width = 256;
  coronaCanvas.height = 256;
  const cctx = coronaCanvas.getContext("2d")!;
  const grad = cctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  // Many stops on a roughly-gaussian ease-out so alpha falls monotonically to 0
  // with no hard step. Warm gold core -> gradually thinning -> fully transparent
  // at the outer radius (last stop alpha 0 => no ring boundary).
  const coronaStops = 24;
  for (let i = 0; i <= coronaStops; i++) {
    const t = i / coronaStops; // 0 at center, 1 at outer edge
    // gaussian-ish falloff: opaque core, smooth thinning tail reaching 0 at t=1
    const gaussian = Math.exp(-3.0 * t * t);
    const edgeFade = 1.0 - t; // forces the outermost stop to exactly 0
    const alpha = 0.85 * gaussian * edgeFade;
    // warm gold core shifting toward deeper amber at the rim
    const r = 255;
    const g = Math.round(196 - 76 * t); // 196 -> 120
    const b = Math.round(110 - 70 * t); // 110 -> 40
    grad.addColorStop(t, `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(4)})`);
  }
  cctx.fillStyle = grad;
  cctx.fillRect(0, 0, 256, 256);
  const coronaTex = new THREE.CanvasTexture(coronaCanvas);
  coronaTex.colorSpace = THREE.SRGBColorSpace;
  const coronaMat = new THREE.SpriteMaterial({
    map: coronaTex,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
    opacity: 0.9,
  });
  const corona = new THREE.Sprite(coronaMat);
  corona.position.set(0, SEED_Y, 0);
  corona.scale.setScalar(3.0);
  corona.renderOrder = 1; // below the seed (seed.renderOrder = 4)
  stage.scene.add(corona);

  const seedLight = new THREE.PointLight(0xffcf85, 14, 8, 2);
  seedLight.position.set(0, SEED_Y, 0);
  stage.scene.add(seedLight);
  const greenLight = new THREE.PointLight(0x3effc2, 8, 7, 2);
  greenLight.position.set(0, 2.6, 0);
  stage.scene.add(greenLight);

  // ---- pollen on the curl-noise wind ----
  const pollen = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.032, 0), moteMat, POLLEN);
  pollen.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  stage.scene.add(pollen);
  const pollenHome = new Float32Array(POLLEN * 3); // baseAngle, baseRadius, baseY
  const pollenDir = new Float32Array(POLLEN);
  // per-instance color: mostly warm gold, some greenish, a few bright embers.
  // With additive blending + bloom the brightest read as drifting light motes.
  const moteCol = new THREE.Color();
  const cWarm = new THREE.Color(0xffc870);
  const cGreenMote = new THREE.Color(0x86ffba);
  for (let i = 0; i < POLLEN; i++) {
    pollenHome[i * 3] = hash01(i * 1.7) * TAU;
    pollenHome[i * 3 + 1] = 1.0 + hash01(i * 3.1 + 5) * 2.6;
    pollenHome[i * 3 + 2] = 0.7 + hash01(i * 5.3 + 11) * 3.0;
    pollenDir[i] = i % 2 === 0 ? 1 : -1;
    const greenMix = hash01(i * 7.9 + 2) < 0.3 ? 0.6 * hash01(i * 2.3 + 9) : 0.0;
    moteCol.copy(cWarm).lerp(cGreenMote, greenMix);
    const ember = hash01(i * 4.1 + 7) < 0.12 ? 2.2 : 0.55 + 0.5 * hash01(i * 6.7 + 3);
    moteCol.multiplyScalar(ember);
    pollen.setColorAt(i, moteCol);
  }
  if (pollen.instanceColor) pollen.instanceColor.needsUpdate = true;

  // ---- grounding: a dark, low-roughness reflective disc + soft contact blob --
  // Catches the env + seed light as a faint reflection and keeps the sculpture
  // from floating. Radial alpha fade so the disc edge dissolves into the fog.
  {
    const GR = 6.0;
    const groundMat = new THREE.MeshStandardNodeMaterial();
    groundMat.colorNode = vec3(0.024, 0.07, 0.058);
    groundMat.roughnessNode = float(0.3);
    groundMat.metalnessNode = float(0.3);
    groundMat.envMapIntensity = 1.0;
    groundMat.transparent = true;
    groundMat.opacityNode = float(1).sub(smoothstep(GR * 0.25, GR * 0.95, positionLocal.xy.length()));
    const ground = new THREE.Mesh(new THREE.CircleGeometry(GR, 64), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0.0;
    stage.scene.add(ground);

    const blobMat = new THREE.MeshBasicNodeMaterial();
    blobMat.transparent = true;
    blobMat.depthWrite = false;
    blobMat.colorNode = vec3(0, 0, 0);
    const sr = 1.5;
    blobMat.opacityNode = float(1).sub(smoothstep(0.0, sr, positionLocal.xy.length())).mul(0.5);
    const blob = new THREE.Mesh(new THREE.CircleGeometry(sr * 1.1, 48), blobMat);
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.012;
    stage.scene.add(blob);
  }

  // ---- frame state ----
  let elapsed = 0;
  let paused = false;
  let last = performance.now();
  const mtx = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const normal = new THREE.Vector3();
  const wind = new THREE.Vector3();
  const Z = new THREE.Vector3(0, 0, 1);
  const UP = new THREE.Vector3(0, 1, 0);

  shell.button("pause", () => (paused = !paused));
  shell.button("restart loop", () => (elapsed = 0));
  shell.setInfo(() => `${(elapsed % LOOP_SECONDS).toFixed(1)} / ${LOOP_SECONDS}s seamless loop · drag to orbit`);

  return {
    frame() {
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!paused) elapsed += dt;
      const phase = ((elapsed % LOOP_SECONDS) / LOOP_SECONDS) * TAU;

      phaseU.value = phase;

      // the dish turns once per loop; lights breathe
      dish.rotation.y = phase;
      seedLight.intensity = 12 + Math.sin(phase) * 5;
      greenLight.intensity = 7 + Math.sin(phase * 2 + 1) * 3;

      // corona halo pulses on phase (integer multiple → seamless); peak clamped
      // so it feeds bloom without clipping the SDF center to white.
      const coronaPulse = 0.5 + 0.5 * Math.sin(phase);
      corona.scale.setScalar(2.8 + 0.5 * coronaPulse);
      coronaMat.opacity = 0.55 + 0.3 * coronaPulse;

      // panels: a radial furl ripple travelling out from the centre
      for (let i = 0; i < PANELS; i++) {
        const p = panelData[i];
        const open = 0.5 + 0.5 * Math.sin(phase - p.frac * 5.0);
        const tilt = 0.22 + 0.55 * open; // 0 = face straight up, larger = lean out
        normal.copy(p.radial).multiplyScalar(Math.sin(tilt)).addScaledVector(UP, Math.cos(tilt)).normalize();
        quat.setFromUnitVectors(Z, normal);
        const breath = 1 + 0.06 * Math.sin(phase * 2 + p.frac * 6.0);
        scl.setScalar(p.scale * breath);
        mtx.compose(p.home, quat, scl);
        panels.setMatrixAt(i, mtx);
      }
      panels.instanceMatrix.needsUpdate = true;

      // pollen: slow orbit (seamless) + divergence-free curl-noise displacement
      for (let i = 0; i < POLLEN; i++) {
        const baseAng = pollenHome[i * 3];
        const baseR = pollenHome[i * 3 + 1];
        const baseY = pollenHome[i * 3 + 2];
        const ang = baseAng + phase * pollenDir[i];
        const hx = Math.cos(ang) * baseR;
        const hz = Math.sin(ang) * baseR;
        curlNoise(hx, baseY, hz, phase, wind);
        pos.set(hx + wind.x * 0.75, baseY + wind.y * 0.75, hz + wind.z * 0.75);
        const seed01 = hash01(i * 1.7);
        scl.setScalar(0.55 + 0.7 * (0.5 + 0.5 * Math.sin(phase * 2 + seed01 * TAU)));
        mtx.compose(pos, quat, scl);
        pollen.setMatrixAt(i, mtx);
      }
      pollen.instanceMatrix.needsUpdate = true;

      // Move the camera FIRST, then recompute the seed's camLocal from the
      // updated camera position (avoids a 1-frame lag), then render via post.
      stage.orbit.apply(stage.camera);
      camLocal.value.set(stage.camera.position.x, stage.camera.position.y - SEED_Y, stage.camera.position.z);
      post.render();
      shell.tick();
    },
    dispose: () => stage.dispose(),
  };
}
