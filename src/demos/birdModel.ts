// The four figures of Feather & Bone part 1: the capsule parts list (with an
// explode slider), the field sliced like an MRI, the surface-nets polygonizer
// with its resolution and shading exposed, and the finished low-poly wren on
// a turntable.

import * as THREE from "three/webgpu";
import { Shell, type Demo } from "../lib/demoShell";
import { createStage3D, addGroundDisc } from "../lib/stage3d";
import { BIRD_BONES } from "../lib/bird/skeleton";
import { birdField, FIELD_BOUNDS } from "../lib/bird/field";
import { buildBirdMesh, addFace, ZONE_COLORS } from "../lib/bird/build";

const WREN_STAGE = {
  target: [0, 0.38, 0] as [number, number, number],
  distance: 1.9,
  minDistance: 0.8,
  maxDistance: 5,
  elevation: 0.12,
  azimuth: 0.6,
  hemi: { sky: 0x9db8d6, ground: 0x4a4035, intensity: 1.0 },
  key: { color: 0xfff0dd, intensity: 2.2, position: [2.5, 3.5, 2] as [number, number, number] },
  rim: { color: 0x86a8ff, intensity: 1.1, position: [-2, 2.2, -2.6] as [number, number, number] },
};

// ---- the parts list: one lathe mesh per capsule, exploded on demand ---------------

export async function mountBirdParts(container: HTMLElement): Promise<Demo> {
  const shell = new Shell(container);
  const stage = await createStage3D(shell.canvas, WREN_STAGE);
  addGroundDisc(stage.scene, { radius: 1.3, shadowRadius: 0.3 });

  const palette = ZONE_COLORS.map(
    (hex) =>
      new THREE.MeshStandardMaterial({
        color: new THREE.Color().setHex(hex, THREE.SRGBColorSpace),
        roughness: 0.8,
        flatShading: true,
      }),
  );

  const centroid = new THREE.Vector3(0, 0.42, -0.02);
  const up = new THREE.Vector3(0, 1, 0);
  const parts: { mesh: THREE.Mesh; base: THREE.Matrix4; dir: THREE.Vector3 }[] = [];
  for (const b of BIRD_BONES) {
    const a = new THREE.Vector3(...b.head);
    const t = new THREE.Vector3(...b.tail);
    const dir = t.clone().sub(a);
    const len = dir.length();

    // lathe profile: hemisphere of r0, tapered flank, hemisphere of r1
    const pts: THREE.Vector2[] = [];
    const N = 8;
    for (let i = 0; i <= N; i++) {
      const u = (i / N) * Math.PI * 0.5;
      pts.push(new THREE.Vector2(Math.cos(u - Math.PI / 2) * b.r0, Math.sin(u - Math.PI / 2) * b.r0));
    }
    for (let i = 0; i <= N; i++) {
      const u = (i / N) * Math.PI * 0.5;
      pts.push(new THREE.Vector2(Math.cos(u) * b.r1, len + Math.sin(u) * b.r1));
    }
    const mesh = new THREE.Mesh(new THREE.LatheGeometry(pts, 14), palette[b.zone]);

    // world matrix: translate ∘ squash-along-world-axis ∘ rotate-into-bone
    const R = new THREE.Matrix4();
    if (len > 1e-6) R.makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(up, dir.clone().normalize()));
    const S = new THREE.Matrix4();
    if (b.flat) {
      const [nx, ny, nz] = b.flat.axis;
      const e = b.flat.s - 1;
      S.set(
        1 + e * nx * nx, e * nx * ny, e * nx * nz, 0,
        e * nx * ny, 1 + e * ny * ny, e * ny * nz, 0,
        e * nx * nz, e * ny * nz, 1 + e * nz * nz, 0,
        0, 0, 0, 1,
      );
    }
    const base = new THREE.Matrix4().multiplyMatrices(S, R);
    mesh.matrixAutoUpdate = false;
    parts.push({ mesh, base, dir: a.clone().add(t).multiplyScalar(0.5).sub(centroid) });
    stage.scene.add(mesh);
  }

  const apply = (explode: number): void => {
    for (let i = 0; i < parts.length; i++) {
      const { mesh, base, dir } = parts[i];
      const head = BIRD_BONES[i].head;
      mesh.matrix.copy(
        new THREE.Matrix4()
          .makeTranslation(head[0] + dir.x * explode, head[1] + dir.y * explode, head[2] + dir.z * explode)
          .multiply(base),
      );
    }
  };
  apply(0);
  shell.slider({ label: "explode", min: 0, max: 0.9, step: 0.01, value: 0, onInput: apply });
  shell.setInfo(() => `${BIRD_BONES.length} capsules, ${BIRD_BONES.filter((b) => b.deform).length} of them future joints`);

  return {
    frame() {
      stage.render();
      shell.tick();
    },
    dispose: () => stage.dispose(),
  };
}

// ---- the field, sliced: signed distance on a plane of constant x ------------------

export function mountBirdSlice(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.72);
  const ctx = shell.canvas.getContext("2d")!;

  const RW = 280, RH = 224; // sample resolution; upscaled smoothly to the canvas
  const off = document.createElement("canvas");
  off.width = RW;
  off.height = RH;
  const octx = off.getContext("2d")!;
  const img = octx.createImageData(RW, RH);

  const zMin = FIELD_BOUNDS.min[2], zMax = FIELD_BOUNDS.max[2];
  const yMin = FIELD_BOUNDS.min[1], yMax = FIELD_BOUNDS.max[1];

  let sliceX = 0;
  let blend = 1;
  let dirty = true;

  const draw = (): void => {
    const data = img.data;
    let p = 0;
    for (let row = 0; row < RH; row++) {
      const y = yMax - ((row + 0.5) / RH) * (yMax - yMin);
      for (let col = 0; col < RW; col++) {
        const z = zMin + ((col + 0.5) / RW) * (zMax - zMin);
        const d = birdField(sliceX, y, z, { blendScale: blend });
        const band = 0.5 + 0.5 * Math.cos((d * Math.PI * 2) / 0.05);
        let r: number, g: number, b: number;
        if (Math.abs(d) < 0.004) {
          r = 255; g = 214; b = 150; // the zero contour — the skin itself
        } else if (d < 0) {
          const k = 0.75 + band * 0.25;
          r = 156 * k; g = 102 * k; b = 62 * k;
        } else {
          const fade = Math.max(0, 1 - d * 2.2);
          const k = (0.5 + band * 0.5) * fade;
          r = 28 + 38 * k; g = 32 + 48 * k; b = 46 + 66 * k;
        }
        data[p++] = r; data[p++] = g; data[p++] = b; data[p++] = 255;
      }
    }
    octx.putImageData(img, 0, 0);

    const cw = shell.canvas.width, ch = shell.canvas.height;
    ctx.fillStyle = "#0a0b10";
    ctx.fillRect(0, 0, cw, ch);
    const scale = Math.min(cw / RW, ch / RH);
    const dw = RW * scale, dh = RH * scale;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(off, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
    shell.readout.textContent = `slice x = ${sliceX.toFixed(2)} · smooth-union width × ${blend.toFixed(2)}`;
  };

  shell.slider({ label: "slice x", min: -0.24, max: 0.24, step: 0.005, value: 0, onInput: (v) => { sliceX = v; dirty = true; } });
  shell.slider({ label: "blend ×", min: 0, max: 2, step: 0.05, value: 1, onInput: (v) => { blend = v; dirty = true; } });

  return {
    frame() {
      if (dirty) {
        dirty = false;
        draw();
      }
    },
  };
}

// ---- the polygonizer, with its knobs showing --------------------------------------

export async function mountBirdNets(container: HTMLElement): Promise<Demo> {
  const shell = new Shell(container);
  const stage = await createStage3D(shell.canvas, WREN_STAGE);
  addGroundDisc(stage.scene, { radius: 1.3, shadowRadius: 0.3 });

  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });
  let mesh: THREE.Mesh | null = null;
  let stats = "";

  let res = 48;
  let blend = 1;
  let style: "faceted" | "smooth" = "faceted";
  let timer = 0;

  const rebuild = (): void => {
    const built = buildBirdMesh({ res, blendScale: blend, style });
    if (mesh) {
      mesh.geometry.dispose();
      mesh.geometry = built.geometry;
    } else {
      mesh = new THREE.Mesh(built.geometry, material);
      stage.scene.add(mesh);
    }
    stats = `${style} · res ${res} · ${built.triangleCount.toLocaleString()} tris · built in ${built.buildMs.toFixed(0)} ms`;
  };
  rebuild();

  const queueRebuild = (): void => {
    stats = "building…";
    clearTimeout(timer);
    timer = window.setTimeout(rebuild, 180);
  };

  shell.slider({ label: "resolution", min: 16, max: 96, step: 4, value: res, onInput: (v) => { res = v; queueRebuild(); } });
  shell.slider({ label: "blend ×", min: 0, max: 2, step: 0.05, value: blend, onInput: (v) => { blend = v; queueRebuild(); } });
  shell.button("smooth ⇄ faceted", () => { style = style === "faceted" ? "smooth" : "faceted"; queueRebuild(); });
  shell.button("wireframe", () => { material.wireframe = !material.wireframe; });
  shell.setInfo(() => stats);

  return {
    frame() {
      stage.render();
      shell.tick();
    },
    dispose: () => stage.dispose(),
  };
}

// ---- the finished wren -------------------------------------------------------------

export async function mountBirdFull(container: HTMLElement, opts: { hero?: boolean } = {}): Promise<Demo> {
  const shell = new Shell(container, opts.hero ? 0.5 : 0.62);
  const stage = await createStage3D(shell.canvas, { ...WREN_STAGE, distance: opts.hero ? 1.7 : 1.9 });
  addGroundDisc(stage.scene, { radius: 1.3, shadowRadius: 0.3 });

  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });
  const group = new THREE.Group();
  stage.scene.add(group);
  addFace(group);

  let mesh: THREE.Mesh | null = null;
  let fluff = 1;
  let timer = 0;
  const rebuild = (): void => {
    const built = buildBirdMesh({ res: 64, radiusScale: fluff });
    if (mesh) {
      mesh.geometry.dispose();
      mesh.geometry = built.geometry;
    } else {
      mesh = new THREE.Mesh(built.geometry, material);
      group.add(mesh);
    }
  };
  rebuild();

  if (!opts.hero) {
    shell.slider({
      label: "fluff",
      min: 0.85,
      max: 1.2,
      step: 0.01,
      value: 1,
      onInput: (v) => {
        fluff = v;
        clearTimeout(timer);
        timer = window.setTimeout(rebuild, 180);
      },
    });
    shell.setInfo(() => "one number, scaled into every radius — a cold wren fluffs up exactly like this");
  }

  return {
    frame() {
      stage.render();
      if (!opts.hero) shell.tick();
    },
    dispose: () => stage.dispose(),
  };
}
