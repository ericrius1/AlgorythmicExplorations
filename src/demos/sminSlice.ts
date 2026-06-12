// The smooth minimum, in the flat: two circles whose distance fields are
// folded together by smin, rendered as a full-screen TSL shader. Drag to move
// one circle; the k slider widens the handshake. Contour lines show the field
// itself — modeling with SDFs is the art of reading these rings.

import * as THREE from "three/webgpu";
import {
  Fn, uniform, uv, vec2, vec3, float, mix, smoothstep, fract, abs, max, clamp, length,
} from "three/tsl";
import { Shell, gpuMissing, type Demo } from "../lib/demoShell";

export async function mountSminSlice(container: HTMLElement): Promise<Demo> {
  const shell = new Shell(container, 0.55);
  const renderer = new THREE.WebGPURenderer({ canvas: shell.canvas, antialias: true });
  try {
    await renderer.init();
  } catch (err) {
    console.error("three/webgpu failed to init", err);
    return gpuMissing(container);
  }
  renderer.setPixelRatio(1);
  renderer.setSize(shell.canvas.width, shell.canvas.height, false);

  const aspect = shell.canvas.width / shell.canvas.height;
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const k = uniform(0.25);
  const circleB = uniform(new THREE.Vector2(0.55, 0.1));

  const material = new THREE.MeshBasicNodeMaterial();
  material.colorNode = Fn(() => {
    // pixel coords in a [-aspect..aspect, -1..1] frame
    const p = uv().mul(2).sub(1).mul(vec2(aspect, 1));
    const dA = length(p.sub(vec2(-0.45, -0.05))).sub(0.42);
    const dB = length(p.sub(circleB)).sub(0.3);
    // polynomial smin — same code as field.ts, transliterated to TSL
    const h = clamp(float(0.5).add(dB.sub(dA).mul(0.5).div(max(k, 1e-4))), 0, 1);
    const d = mix(dB, dA, h).sub(k.mul(h.mul(float(1).sub(h))));

    const insideCol = vec3(0.12, 0.55, 0.62);
    const outsideCol = vec3(0.05, 0.06, 0.09);
    const base = mix(insideCol, outsideCol, smoothstep(-0.006, 0.006, d));
    // contour rings every 0.07 of distance, fading with distance
    const rings = abs(fract(d.mul(14.3)).sub(0.5)).mul(2);
    const ringLine = smoothstep(0.0, 0.18, rings).oneMinus().mul(0.18).mul(smoothstep(1.0, 0.1, abs(d)));
    // the zero contour, bright: this line *is* the surface
    const zero = smoothstep(0.012, 0.0, abs(d));
    return base.add(vec3(ringLine)).add(vec3(0.55, 0.95, 1.0).mul(zero.mul(0.8)));
  })();

  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));

  // drag moves circle B
  const toField = (e: PointerEvent): [number, number] => {
    const r = shell.canvas.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 2 - 1;
    const y = -(((e.clientY - r.top) / r.height) * 2 - 1);
    return [x * aspect, y];
  };
  let dragging = false;
  shell.canvas.addEventListener("pointerdown", (e) => {
    dragging = true;
    shell.canvas.setPointerCapture(e.pointerId);
    const [x, y] = toField(e);
    circleB.value.set(x, y);
  });
  shell.canvas.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const [x, y] = toField(e);
    circleB.value.set(x, y);
  });
  shell.canvas.addEventListener("pointerup", () => (dragging = false));

  shell.slider({
    label: "blend k", min: 0, max: 0.7, step: 0.01, value: 0.25,
    onInput: (v) => (k.value = v),
  });
  shell.setInfo(() => (k.value < 0.01 ? "k = 0: a hard union — creased" : `smin, k = ${k.value.toFixed(2)} — filleted`));

  return {
    frame: () => {
      renderer.render(scene, camera);
      shell.tick();
    },
    dispose: () => renderer.dispose(),
  };
}
