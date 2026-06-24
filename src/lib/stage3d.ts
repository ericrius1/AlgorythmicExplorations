// Shared three.js stage for the creature and terrain series: a WebGPURenderer
// bound to the Shell's canvas (three falls back to WebGL2 on its own), the
// site's orbit feel (drag to turn, two-finger scroll / wheel / middle-drag to dolly, slow auto-spin when
// idle), a gradient-sky background, and configurable lights/fog — so a bird
// turntable and a mountain flyover can share one chassis.

import * as THREE from "three/webgpu";
import { screenUV, mix, vec3, float, positionLocal, smoothstep } from "three/tsl";

export class Orbit3D {
  enabled = true; // demos with their own canvas drags flip this off mid-drag
  azimuth = 0.5;
  elevation = 0.2;
  distance = 3;
  minDistance = 0.5;
  maxDistance = 12;
  maxElevation = 1.35;
  minElevation = -0.1;
  target = new THREE.Vector3(0, 0.5, 0);
  autoSpin = 0.0012;
  private lastInteraction = 0;

  attach(canvas: HTMLCanvasElement): void {
    let orbiting = false;
    let dollying = false;
    let lx = 0, ly = 0;

    const dollyBy = (delta: number): void => {
      this.distance = Math.min(this.maxDistance, Math.max(this.minDistance, this.distance * Math.exp(delta)));
      this.lastInteraction = performance.now();
    };

    canvas.addEventListener("pointerdown", (e) => {
      if (!this.enabled) return;
      if (e.button === 0) {
        orbiting = true;
        lx = e.clientX;
        ly = e.clientY;
        canvas.setPointerCapture(e.pointerId);
      } else if (e.button === 1) {
        dollying = true;
        ly = e.clientY;
        e.preventDefault();
        canvas.setPointerCapture(e.pointerId);
      }
    });
    canvas.addEventListener("pointerup", (e) => {
      if (e.button === 0) orbiting = false;
      if (e.button === 1) dollying = false;
    });
    canvas.addEventListener("pointercancel", () => {
      orbiting = false;
      dollying = false;
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!this.enabled) return;
      if (orbiting) {
        this.azimuth -= (e.clientX - lx) * 0.005;
        this.elevation = Math.min(this.maxElevation, Math.max(this.minElevation, this.elevation + (e.clientY - ly) * 0.005));
        lx = e.clientX;
        ly = e.clientY;
        this.lastInteraction = performance.now();
      } else if (dollying) {
        dollyBy((e.clientY - ly) * 0.005);
        ly = e.clientY;
      }
    });
    canvas.addEventListener(
      "wheel",
      (e) => {
        if (!this.enabled) return;
        e.preventDefault();
        dollyBy(e.deltaY * 0.001);
      },
      { passive: false },
    );
    canvas.addEventListener("auxclick", (e) => {
      if (e.button === 1) e.preventDefault();
    });
  }

  apply(camera: THREE.PerspectiveCamera): void {
    if (performance.now() - this.lastInteraction > 2500) this.azimuth += this.autoSpin;
    const ce = Math.cos(this.elevation);
    camera.position.set(
      this.target.x + Math.sin(this.azimuth) * ce * this.distance,
      this.target.y + Math.sin(this.elevation) * this.distance,
      this.target.z + Math.cos(this.azimuth) * ce * this.distance,
    );
    camera.lookAt(this.target);
  }
}

export interface Stage3DOptions {
  // sky gradient, top to bottom (screen space)
  skyTop?: [number, number, number];
  skyBottom?: [number, number, number];
  fog?: { color: number; near: number; far: number };
  hemi?: { sky: number; ground: number; intensity: number };
  key?: { color: number; intensity: number; position: [number, number, number] };
  rim?: { color: number; intensity: number; position: [number, number, number] };
  target?: [number, number, number];
  distance?: number;
  minDistance?: number;
  maxDistance?: number;
  elevation?: number;
  azimuth?: number;
  fov?: number;
  far?: number;
}

export interface Stage3D {
  renderer: THREE.WebGPURenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  orbit: Orbit3D;
  render(): void;
  dispose(): void;
}

export async function createStage3D(canvas: HTMLCanvasElement, opts: Stage3DOptions = {}): Promise<Stage3D> {
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
  await renderer.init();
  renderer.setPixelRatio(1); // the Shell already sized the canvas in device px
  renderer.setSize(canvas.width, canvas.height, false);

  const scene = new THREE.Scene();
  const top = opts.skyTop ?? [0.028, 0.03, 0.045];
  const bottom = opts.skyBottom ?? [0.055, 0.065, 0.095];
  const horizon = mix(vec3(...bottom), vec3(...top), screenUV.y.oneMinus());
  const glow = float(1).sub(screenUV.sub(0.5).length().mul(1.6)).max(0).pow(2).mul(0.035);
  scene.backgroundNode = horizon.add(glow);

  if (opts.fog) scene.fog = new THREE.Fog(opts.fog.color, opts.fog.near, opts.fog.far);

  const camera = new THREE.PerspectiveCamera(opts.fov ?? 38, canvas.width / canvas.height, 0.05, opts.far ?? 120);
  const orbit = new Orbit3D();
  if (opts.target) orbit.target.set(...opts.target);
  if (opts.distance !== undefined) orbit.distance = opts.distance;
  if (opts.minDistance !== undefined) orbit.minDistance = opts.minDistance;
  if (opts.maxDistance !== undefined) orbit.maxDistance = opts.maxDistance;
  if (opts.elevation !== undefined) orbit.elevation = opts.elevation;
  if (opts.azimuth !== undefined) orbit.azimuth = opts.azimuth;
  orbit.attach(canvas);

  const hemi = opts.hemi ?? { sky: 0x9db8d6, ground: 0x3a3025, intensity: 0.85 };
  scene.add(new THREE.HemisphereLight(hemi.sky, hemi.ground, hemi.intensity));
  const keyOpt = opts.key ?? { color: 0xfff0dd, intensity: 1.7, position: [2.5, 3.5, 2] };
  const key = new THREE.DirectionalLight(keyOpt.color, keyOpt.intensity);
  key.position.set(...keyOpt.position);
  scene.add(key);
  const rimOpt = opts.rim ?? { color: 0x86a8ff, intensity: 0.8, position: [-2, 2.2, -2.6] };
  const rim = new THREE.DirectionalLight(rimOpt.color, rimOpt.intensity);
  rim.position.set(...rimOpt.position);
  scene.add(rim);

  return {
    renderer,
    scene,
    camera,
    orbit,
    render() {
      orbit.apply(camera);
      renderer.render(scene, camera);
    },
    dispose() {
      renderer.dispose();
    },
  };
}

// A fading ground disc plus a soft fake contact shadow — the cheap stagecraft
// that keeps a turntable subject from floating in the void.
export function addGroundDisc(scene: THREE.Scene, opts: { radius?: number; color?: [number, number, number]; shadowRadius?: number } = {}): void {
  const radius = opts.radius ?? 2.2;
  const color = opts.color ?? [0.075, 0.082, 0.105];

  const groundMat = new THREE.MeshStandardNodeMaterial();
  groundMat.colorNode = vec3(...color);
  groundMat.roughnessNode = float(0.95);
  groundMat.transparent = true;
  groundMat.opacityNode = float(1).sub(smoothstep(radius * 0.27, radius * 0.95, positionLocal.xy.length()));
  const ground = new THREE.Mesh(new THREE.CircleGeometry(radius, 48), groundMat);
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  const blobMat = new THREE.MeshBasicNodeMaterial();
  blobMat.transparent = true;
  blobMat.depthWrite = false;
  blobMat.colorNode = vec3(0, 0, 0);
  const sr = opts.shadowRadius ?? radius * 0.25;
  blobMat.opacityNode = float(1).sub(smoothstep(0.0, sr, positionLocal.xy.length())).mul(0.45);
  const blob = new THREE.Mesh(new THREE.CircleGeometry(sr * 1.1, 32), blobMat);
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.005;
  scene.add(blob);
}
