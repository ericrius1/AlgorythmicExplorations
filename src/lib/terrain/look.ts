// The look of the Ground Truth series: one sky, one haze, one sun, shared by
// every 3D figure. The sky is a function of view direction (zenith blue, a
// warm band at the horizon, a glow around the sun). The haze uses the same
// function for its colour, so distant ridges fade into exactly the sky that's
// behind them, and it thins with altitude so valleys hold more of it than
// peaks. Surfaces are lit by the sun (times a baked shadow term) plus a
// sky/ground ambient (times baked occlusion). Everything goes through filmic
// tone mapping at the end.

import * as THREE from "three/webgpu";
import type { Node } from "three/webgpu";
import {
  uniform,
  vec2,
  vec3,
  vec4,
  float,
  mix,
  smoothstep,
  dot,
  exp,
  normalize,
  positionWorld,
  cameraPosition,
  normalWorldGeometry,
  attribute,
  fog,
  screenCoordinate,
  fract,
  sin,
  select,
  mx_noise_float,
} from "three/tsl";
import { Orbit3D } from "../stage3d";

type F = Node<"float">;
type V3 = Node<"vec3">;

// ---- moods ------------------------------------------------------------------------------

export interface Mood {
  sunDir: [number, number, number]; // toward the sun (normalized on use)
  sun: [number, number, number]; // linear HDR sunlight
  zenith: [number, number, number];
  horizon: [number, number, number]; // haze colour looking away from the sun
  glow: [number, number, number]; // extra light around the sun, strongest low down
  ambientSky: [number, number, number];
  ambientGround: [number, number, number];
  haze: number; // haze density per world unit, at the haze base
  hazeFalloff: number; // how fast it thins per world unit of altitude
  hazeBase: number; // altitude of full density
  exposure: number;
}

// Late afternoon, sun about twelve degrees up: long shadows and warm faces.
export const GOLDEN: Mood = {
  sunDir: [-0.62, 0.21, -0.76],
  sun: [3.0, 2.2, 1.4],
  zenith: [0.03, 0.07, 0.2],
  horizon: [0.25, 0.27, 0.34],
  glow: [1.15, 0.62, 0.28],
  ambientSky: [0.17, 0.23, 0.36],
  ambientGround: [0.1, 0.08, 0.06],
  haze: 0.0055,
  hazeFalloff: 0.05,
  hazeBase: 0,
  exposure: 1.0,
};

// Clean morning light, higher sun, cooler and clearer air.
export const MORNING: Mood = {
  sunDir: [0.55, 0.42, -0.72],
  sun: [2.9, 2.55, 2.05],
  zenith: [0.09, 0.19, 0.42],
  horizon: [0.52, 0.58, 0.66],
  glow: [0.75, 0.55, 0.35],
  ambientSky: [0.24, 0.32, 0.46],
  ambientGround: [0.12, 0.11, 0.08],
  haze: 0.009,
  hazeFalloff: 0.05,
  hazeBase: 0,
  exposure: 0.9,
};

// Sun nearly on the horizon: the finale's light.
export const SUNSET: Mood = {
  sunDir: [0.0, 0.1, -1.0],
  sun: [3.3, 1.75, 0.85],
  zenith: [0.05, 0.08, 0.2],
  horizon: [0.42, 0.34, 0.38],
  glow: [1.6, 0.68, 0.26],
  ambientSky: [0.17, 0.19, 0.31],
  ambientGround: [0.1, 0.07, 0.05],
  haze: 0.01,
  hazeFalloff: 0.055,
  hazeBase: 0,
  exposure: 1.0,
};

// ---- the atmosphere -------------------------------------------------------------------------

export class Look {
  readonly sunDir: THREE.Vector3;
  readonly uSunDir;
  readonly uSun;
  readonly uZenith;
  readonly uHorizon;
  readonly uGlow;
  readonly uAmbSky;
  readonly uAmbGround;
  readonly uHaze;
  readonly uHazeFalloff;
  readonly uHazeBase;
  readonly mood: Mood;

  constructor(mood: Mood) {
    this.mood = mood;
    this.sunDir = new THREE.Vector3(...mood.sunDir).normalize();
    this.uSunDir = uniform(this.sunDir.clone());
    this.uSun = uniform(new THREE.Vector3(...mood.sun));
    this.uZenith = uniform(new THREE.Vector3(...mood.zenith));
    this.uHorizon = uniform(new THREE.Vector3(...mood.horizon));
    this.uGlow = uniform(new THREE.Vector3(...mood.glow));
    this.uAmbSky = uniform(new THREE.Vector3(...mood.ambientSky));
    this.uAmbGround = uniform(new THREE.Vector3(...mood.ambientGround));
    this.uHaze = uniform(mood.haze);
    this.uHazeFalloff = uniform(mood.hazeFalloff);
    this.uHazeBase = uniform(mood.hazeBase);
  }

  // Sky radiance along a direction (no sun disc).
  sky(dir: V3): V3 {
    const up = dir.y.max(0);
    // a soft horizon band: the zenith colour takes over fast once you look up
    const t = float(1).sub(float(1).sub(up).pow(6));
    let col = mix(this.uHorizon, this.uZenith, t) as unknown as V3;
    // looking down past the horizon: the haze darkens a little toward the ground
    col = mix(col, this.uHorizon.mul(0.55).add(this.uAmbGround.mul(0.5)), smoothstep(0.0, -0.35, dir.y)) as unknown as V3;
    const c = dot(dir, this.uSunDir).max(0);
    const low = float(1).sub(up).pow(3).mul(0.75).add(0.25);
    const glow = this.uGlow.mul(c.pow(5).mul(0.42).add(c.pow(32).mul(0.9))).mul(low);
    return col.add(glow) as unknown as V3;
  }

  // The background: sky plus the sun disc, dithered against banding.
  background(): Node {
    const dir = normalWorldGeometry as unknown as V3;
    const c = dot(dir, this.uSunDir);
    const disc = smoothstep(0.99988, 0.99994, c).mul(16);
    const col = this.sky(dir).add(this.uSun.mul(disc));
    const n = fract(sin(dot(screenCoordinate.xy, vec2(12.9898, 78.233))).mul(43758.5453)).sub(0.5);
    return vec4(col.mul(n.mul(0.04).add(1)).add(n.mul(0.003)), 1);
  }

  // Height fog with the sky's own colour. The density integral along the ray
  // has a closed form for exponential falloff with altitude (Quilez).
  fog(): Node {
    const toFrag = positionWorld.sub(cameraPosition);
    const dist = toFrag.length();
    const rd = toFrag.div(dist);
    const k = rd.y.mul(this.uHazeFalloff).mul(dist);
    const term = select(k.abs().greaterThan(1e-4), float(1).sub(exp(k.negate())).div(k), float(1));
    const amount = this.uHaze
      .mul(dist)
      .mul(exp(cameraPosition.y.sub(this.uHazeBase).mul(this.uHazeFalloff).negate()))
      .mul(term);
    const factor = float(1).sub(exp(amount.negate())).min(1);
    // the colour of the air along this ray, squashed toward the horizon
    const fogDir = normalize(vec3(rd.x, rd.y.max(0).mul(0.3), rd.z)) as unknown as V3;
    return fog(this.sky(fogDir), factor);
  }

  // Sun and sky on a surface. `sunVis` is the baked shadow term, `ao` the
  // baked occlusion; `wrap` lets light bend past the terminator (foliage).
  lit(albedo: V3, n: V3, sunVis: F | number, ao: F | number, wrap = 0): V3 {
    const ndl = wrap > 0 ? dot(n, this.uSunDir).add(wrap).div(1 + wrap).max(0) : dot(n, this.uSunDir).max(0);
    const hemi = mix(this.uAmbGround, this.uAmbSky, n.y.mul(0.5).add(0.5));
    return albedo.mul(this.uSun.mul(ndl.mul(sunVis)).add(hemi.mul(ao))) as unknown as V3;
  }

  apply(scene: THREE.Scene): void {
    scene.backgroundNode = this.background();
    scene.fogNode = this.fog();
  }
}

// ---- terrain shading -------------------------------------------------------------------------

// sRGB hex → linear vec3
export function lin(hex: number): V3 {
  const c = new THREE.Color().setHex(hex, THREE.SRGBColorSpace);
  return vec3(c.r, c.g, c.b) as unknown as V3;
}

export interface TerrainMaterialOptions {
  amplitude: number; // world height of h01 = 1
  water?: boolean; // geometry carries aWater (erosion streams)
  snowLine?: [number, number]; // h01 where snow starts and where it's full (default 0.6, 0.72)
}

// The ground. Altitude and slope pick the colour per pixel (the same rule
// as heightColor() in heightmap.ts, with a little noise in the thresholds so
// the snowline and the rock edges aren't contour lines). Geometry supplies
// aLight = (sun visibility, occlusion) and aTint = (rgb, weight), which
// demos use for sediment, biomes, or the soil under a meadow.
export function terrainMaterial(look: Look, opts: TerrainMaterialOptions): { material: THREE.MeshBasicNodeMaterial; amplitude: { value: number } } {
  const amplitude = uniform(opts.amplitude);
  const material = new THREE.MeshBasicNodeMaterial();
  const p = positionWorld;
  const n = normalWorldGeometry as unknown as V3;
  const h01 = p.y.div(amplitude);
  const slope = float(1).sub(n.y);

  const broad = mx_noise_float(p.xz.mul(0.07)); // patches tens of units across
  const mid = mx_noise_float(p.xz.mul(0.55));
  const fine = mx_noise_float(p.xz.mul(4.1));
  const jitter = mid.mul(0.04).add(fine.mul(0.012));

  const grass = mix(lin(0x3f5d29), lin(0x6c7636), broad.mul(0.5).add(0.5)) as unknown as V3;
  const scree = lin(0x7a6f63);
  // rock with faint strata: bands in altitude, bent by the noise
  const strata = sin(p.y.mul(5.5).add(mid.mul(2.2))).mul(0.5).add(0.5);
  const rock = mix(lin(0x56504a), lin(0x786e64), strata.mul(0.6).add(fine.mul(0.2)).add(0.1)) as unknown as V3;
  const snowCol = lin(0xe8edf3);

  let col = mix(grass, scree, smoothstep(0.4, 0.7, h01.add(jitter))) as unknown as V3;
  col = mix(col, rock, smoothstep(0.25, 0.5, slope.add(jitter))) as unknown as V3;
  {
    const [s0, s1] = opts.snowLine ?? [0.6, 0.72];
    const snow = smoothstep(s0, s1, h01.add(jitter.mul(1.5))).mul(float(1).sub(smoothstep(0.3, 0.55, slope.sub(mid.mul(0.05)))));
    col = mix(col, snowCol, snow) as unknown as V3;
  }

  const tint = attribute("aTint", "vec4") as unknown as Node<"vec4">;
  col = mix(col, tint.xyz, tint.w) as unknown as V3;
  col = col.mul(fine.mul(0.07).add(mid.mul(0.05)).add(1)) as unknown as V3;

  const light = attribute("aLight", "vec2") as unknown as Node<"vec2">;
  let out = look.lit(col, n, light.x, light.y);

  if (opts.water) {
    // streams: wet, dark, and mirror-like at a glancing angle, with the sun
    // glinting off them when it's behind the water
    const wet = (attribute("aWater", "float") as unknown as F).clamp(0, 1);
    const v = normalize(cameraPosition.sub(p)) as unknown as V3;
    const r = vec3(v.x.negate(), v.y, v.z.negate());
    const fres = float(1).sub(v.y.max(0)).pow(4).mul(0.7).add(0.12);
    const glint = dot(r, look.uSunDir).max(0).pow(180).mul(9);
    const waterCol = look
      .sky(normalize(r) as unknown as V3)
      .mul(fres)
      .add(look.uSun.mul(glint).mul(light.x))
      .add(lin(0x1c2e33).mul(look.uAmbSky).mul(2));
    out = mix(out.mul(float(1).sub(wet.mul(0.45))), waterCol, wet.mul(wet).mul(0.9)) as unknown as V3;
  }

  material.colorNode = vec4(out, 1);
  return { material, amplitude };
}

// Flat lit material for objects that carry their own vertex colours (rocks).
export function litVertexColorMaterial(look: Look, opts: { ao?: boolean } = {}): THREE.MeshBasicNodeMaterial {
  const material = new THREE.MeshBasicNodeMaterial();
  const col = attribute("color", "vec3") as unknown as V3;
  const n = normalWorldGeometry as unknown as V3;
  const ao = opts.ao ? (attribute("aAO", "float") as unknown as F) : float(1);
  material.colorNode = vec4(look.lit(col, n, 1, ao), 1);
  return material;
}

// ---- the stage ---------------------------------------------------------------------------------

export interface TerrainStage {
  renderer: THREE.WebGPURenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  orbit: Orbit3D;
  look: Look;
  render(): void; // orbit camera, then draw
  draw(): void; // draw with the camera as it is (heroes drive their own)
  dispose(): void;
}

export interface TerrainStageOptions {
  target?: [number, number, number];
  distance?: number;
  minDistance?: number;
  maxDistance?: number;
  elevation?: number;
  azimuth?: number;
  minElevation?: number;
  maxElevation?: number;
  autoSpin?: number;
  fov?: number;
  near?: number;
  far?: number;
}

export async function createTerrainStage(canvas: HTMLCanvasElement, mood: Mood, opts: TerrainStageOptions = {}): Promise<TerrainStage> {
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
  await renderer.init();
  renderer.setPixelRatio(1); // the Shell already sized the canvas in device px
  renderer.setSize(canvas.width, canvas.height, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = mood.exposure;

  const scene = new THREE.Scene();
  const look = new Look(mood);
  look.apply(scene);

  const camera = new THREE.PerspectiveCamera(opts.fov ?? 45, canvas.width / canvas.height, opts.near ?? 0.05, opts.far ?? 400);
  const orbit = new Orbit3D();
  if (opts.target) orbit.target.set(...opts.target);
  if (opts.distance !== undefined) orbit.distance = opts.distance;
  if (opts.minDistance !== undefined) orbit.minDistance = opts.minDistance;
  if (opts.maxDistance !== undefined) orbit.maxDistance = opts.maxDistance;
  if (opts.elevation !== undefined) orbit.elevation = opts.elevation;
  if (opts.azimuth !== undefined) orbit.azimuth = opts.azimuth;
  if (opts.minElevation !== undefined) orbit.minElevation = opts.minElevation;
  if (opts.maxElevation !== undefined) orbit.maxElevation = opts.maxElevation;
  orbit.autoSpin = opts.autoSpin ?? 0.0007;
  orbit.attach(canvas);

  return {
    renderer,
    scene,
    camera,
    orbit,
    look,
    render() {
      orbit.apply(camera);
      renderer.render(scene, camera);
    },
    draw() {
      renderer.render(scene, camera);
    },
    dispose() {
      renderer.dispose();
    },
  };
}

// ---- a calm camera -------------------------------------------------------------------------------

// Exponential smoothing that starts settled, so a hero never swoops in from
// a default position on its first frames.
export class Smooth {
  private v: number | null = null;
  constructor(private readonly seconds: number) {}
  step(target: number, dt: number): number {
    if (this.v === null) this.v = target;
    else this.v += (target - this.v) * (1 - Math.exp(-dt / this.seconds));
    return this.v;
  }
}
