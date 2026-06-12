// Shared three.js stage for the bear demos: a WebGPURenderer bound to the
// Shell's canvas (with three's automatic WebGL2 fallback), the site's orbit
// feel (drag to turn, ctrl/⌘+wheel to zoom, slow auto-spin when idle), soft
// three-point lighting, a fading ground disc, and the bear's face — eyes and
// nose are tiny glossy spheres that ride the head bone, because marching a
// field fine enough to grow eyeballs would be the wrong kind of heroism.

import * as THREE from "three/webgpu";
import { screenUV, mix, vec3, float, positionLocal, smoothstep } from "three/tsl";
import type { Rig } from "./rig";
import { BONES } from "./skeleton";

export class Orbit {
  azimuth = 0.45;
  elevation = 0.18;
  distance = 3.4;
  target = new THREE.Vector3(0, 0.95, 0);
  autoSpin = 0.0012;
  enabled = true;
  private lastInteraction = 0;

  attach(canvas: HTMLCanvasElement): void {
    let dragging = false;
    let lx = 0, ly = 0;
    canvas.addEventListener("pointerdown", (e) => {
      if (!this.enabled) return;
      dragging = true;
      lx = e.clientX;
      ly = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener("pointerup", () => (dragging = false));
    canvas.addEventListener("pointercancel", () => (dragging = false));
    canvas.addEventListener("pointermove", (e) => {
      if (!dragging || !this.enabled) return;
      this.azimuth -= (e.clientX - lx) * 0.005;
      this.elevation = Math.min(1.35, Math.max(-0.1, this.elevation + (e.clientY - ly) * 0.005));
      lx = e.clientX;
      ly = e.clientY;
      this.lastInteraction = performance.now();
    });
    canvas.addEventListener(
      "wheel",
      (e) => {
        if (!e.ctrlKey && !e.metaKey) return; // plain wheel keeps scrolling the page
        e.preventDefault();
        this.distance = Math.min(9, Math.max(1.4, this.distance * Math.exp(e.deltaY * 0.001)));
        this.lastInteraction = performance.now();
      },
      { passive: false },
    );
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

export interface Stage {
  renderer: THREE.WebGPURenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  orbit: Orbit;
  render(): void;
  dispose(): void;
}

export async function createStage(canvas: HTMLCanvasElement, opts: { ground?: boolean } = {}): Promise<Stage> {
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
  await renderer.init();
  renderer.setPixelRatio(1); // the Shell already sized the canvas in device px
  renderer.setSize(canvas.width, canvas.height, false);

  const scene = new THREE.Scene();
  // night-studio backdrop: barely-there vertical gradient with a low glow
  const horizon = mix(vec3(0.055, 0.065, 0.095), vec3(0.028, 0.03, 0.045), screenUV.y);
  const glow = float(1).sub(screenUV.sub(0.5).length().mul(1.6)).max(0).pow(2).mul(0.035);
  scene.backgroundNode = horizon.add(glow);

  const camera = new THREE.PerspectiveCamera(38, canvas.width / canvas.height, 0.05, 60);
  const orbit = new Orbit();
  orbit.attach(canvas);

  scene.add(new THREE.HemisphereLight(0x9db8d6, 0x3a3025, 0.85));
  const key = new THREE.DirectionalLight(0xfff0dd, 1.7);
  key.position.set(2.5, 3.5, 2);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x86a8ff, 0.8);
  rim.position.set(-2, 2.2, -2.6);
  scene.add(rim);

  if (opts.ground !== false) {
    const groundMat = new THREE.MeshStandardNodeMaterial();
    groundMat.colorNode = vec3(0.075, 0.082, 0.105);
    groundMat.roughnessNode = float(0.95);
    groundMat.transparent = true;
    groundMat.opacityNode = float(1).sub(smoothstep(0.6, 2.1, positionLocal.xy.length()));
    const ground = new THREE.Mesh(new THREE.CircleGeometry(2.2, 48), groundMat);
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);

    // fake contact shadow: a soft dark blob, cheaper than honest shadow maps
    const blobMat = new THREE.MeshBasicNodeMaterial();
    blobMat.transparent = true;
    blobMat.depthWrite = false;
    blobMat.colorNode = vec3(0, 0, 0);
    blobMat.opacityNode = float(1).sub(smoothstep(0.0, 0.5, positionLocal.xy.length())).mul(0.45);
    const blob = new THREE.Mesh(new THREE.CircleGeometry(0.55, 32), blobMat);
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.005;
    scene.add(blob);
  }

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

// ---- the face -------------------------------------------------------------------
// Eyes and nose, parented to the head joint by hand (a 3-line scene graph).

export class Face {
  readonly group = new THREE.Group();
  private parts: { mesh: THREE.Mesh; local: THREE.Vector3 }[] = [];
  private headIndex: number | null = null;

  constructor() {
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x16100e, roughness: 0.15 });
    const glintMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const noseMat = new THREE.MeshStandardMaterial({ color: 0x241a18, roughness: 0.3 });
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1): void => {
      const m = new THREE.Mesh(geo, mat);
      m.scale.set(sx, sy, sz);
      // local = rest world − head joint head (0, 1.49, 0.025)
      this.parts.push({ mesh: m, local: new THREE.Vector3(x - 0, y - 1.49, z - 0.025) });
      this.group.add(m);
    };
    const eye = new THREE.SphereGeometry(0.022, 16, 12);
    const glint = new THREE.SphereGeometry(0.0065, 8, 6);
    const nose = new THREE.SphereGeometry(0.03, 16, 12);
    add(eye, eyeMat, 0.072, 1.6, 0.155);
    add(eye, eyeMat, -0.072, 1.6, 0.155);
    add(glint, glintMat, 0.079, 1.607, 0.169);
    add(glint, glintMat, -0.065, 1.607, 0.169);
    add(nose, noseMat, 0, 1.563, 0.285, 1.25, 0.8, 0.85);
  }

  update(rig: Rig): void {
    if (this.headIndex === null) this.headIndex = rig.index("head");
    const m = rig.world[this.headIndex];
    for (const p of this.parts) p.mesh.position.copy(p.local).applyMatrix4(m);
  }
}

// ---- tapered capsule meshes (part 1's "the parts") -------------------------------
// One lathe profile per bone: hemisphere of r0, cone flank, hemisphere of r1.

export function capsulePartMeshes(material: THREE.Material): { group: THREE.Group; parts: { mesh: THREE.Mesh; center: THREE.Vector3 }[] } {
  const group = new THREE.Group();
  const parts: { mesh: THREE.Mesh; center: THREE.Vector3 }[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  for (const b of BONES) {
    const a = new THREE.Vector3(...b.head);
    const c = new THREE.Vector3(...b.tail);
    const dir = c.clone().sub(a);
    const len = dir.length();
    const pts: THREE.Vector2[] = [];
    const N = 12;
    for (let i = 0; i <= N; i++) {
      const t = (i / N) * Math.PI * 0.5;
      pts.push(new THREE.Vector2(Math.cos(t - Math.PI / 2) * b.r0, Math.sin(t - Math.PI / 2) * b.r0));
    }
    for (let i = 0; i <= N; i++) {
      const t = (i / N) * Math.PI * 0.5;
      pts.push(new THREE.Vector2(Math.cos(t) * b.r1, len + Math.sin(t) * b.r1));
    }
    const geo = new THREE.LatheGeometry(pts, 24);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.copy(a);
    if (len > 1e-6) mesh.quaternion.setFromUnitVectors(up, dir.normalize());
    group.add(mesh);
    parts.push({ mesh, center: a.clone().add(c).multiplyScalar(0.5) });
  }
  return { group, parts };
}
