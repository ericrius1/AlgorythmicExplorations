// Part 1's interactive figures, all views of the same pipeline:
//   parts  — the lofted tubes the bear is welded from, with an explode slider
//   loft   — sides / ring-density sliders re-lofting live, wireframe on top
//   sculpt — radius / belly sliders: modeling by moving vertices
//   final  — the shaded bear: palettes, fur grain, rim light
//   hero   — the finished animal on a turntable
// Every variant rebuilds from the same BONES table and the same loft.

import * as THREE from "three/webgpu";
import { Shell, gpuMissing, type Demo } from "../lib/demoShell";
import { createStage, Face } from "../lib/bear/stage";
import { buildBearMesh, buildBearParts } from "../lib/bear/build";
import { createBearMaterial, paintZones, PALETTE_NAMES } from "../lib/bear/material";

export interface BearStudioOptions {
  hero?: boolean;
  view: "parts" | "loft" | "sculpt" | "final" | "hero";
}

export async function mountBearStudio(container: HTMLElement, opts: BearStudioOptions): Promise<Demo> {
  const shell = new Shell(container, opts.hero ? 0.52 : 0.62);
  let stage;
  try {
    stage = await createStage(shell.canvas);
  } catch (err) {
    console.error("three/webgpu failed to init", err);
    return gpuMissing(container);
  }
  const { scene } = stage;
  const clay = new THREE.MeshStandardMaterial({ color: 0x9f8676, roughness: 0.85, flatShading: true });

  // ---- parts: the kit, exploded -----------------------------------------------------
  if (opts.view === "parts") {
    const { parts } = buildBearParts({ skin: false });
    const group = new THREE.Group();
    const meshes = parts.map((p) => {
      const m = new THREE.Mesh(p.geometry, clay);
      group.add(m);
      return { mesh: m, center: p.center };
    });
    scene.add(group);
    const bodyCenter = new THREE.Vector3(0, 1.05, 0);
    let explode = 0.5;
    const apply = (): void => {
      for (const p of meshes) {
        const dir = p.center.clone().sub(bodyCenter);
        p.mesh.position.copy(dir.multiplyScalar(explode * 0.9));
      }
    };
    apply();
    shell.slider({ label: "explode", min: 0, max: 1, step: 0.01, value: explode, onInput: (v) => { explode = v; apply(); } });
    shell.setInfo(() => `${meshes.length} tubes · 0 sculpting tools`);
    return { frame: () => { stage.render(); shell.tick(); } };
  }

  // ---- the lofting views: a mesh we rebuild on demand --------------------------------
  const params = { sides: 10, rings: 1, radiusScale: 1, belly: 1 };
  let mesh: THREE.Mesh | null = null;
  let wire: THREE.Mesh | null = null;
  let wireframe = opts.view === "loft";
  let lastBuild = { triangleCount: 0, vertexCount: 0, buildMs: 0, partCount: 0 };

  const bearMat = createBearMaterial(null);
  const wireMat = new THREE.MeshBasicMaterial({ color: 0x6fd6ff, wireframe: true, transparent: true, opacity: 0.5 });
  const useFur = opts.view === "final" || opts.view === "hero";
  let palette = "cinnamon";

  const rebuild = (): void => {
    const built = buildBearMesh({ ...params, skin: false });
    if (useFur) paintZones(built.geometry, palette);
    lastBuild = built;
    if (!mesh) {
      mesh = new THREE.Mesh(built.geometry, useFur ? bearMat.material : clay);
      scene.add(mesh);
      wire = new THREE.Mesh(built.geometry, wireMat);
      scene.add(wire);
    } else {
      mesh.geometry.dispose();
      mesh.geometry = built.geometry;
      wire!.geometry = built.geometry;
    }
    wire!.visible = wireframe;
  };
  rebuild();

  let face: Face | null = null;
  if (useFur) {
    face = new Face();
    scene.add(face.group);
    // static stage: park the face on the rest-pose head by faking a rig lookup
    const fakeRig = { index: () => 0, world: [new THREE.Matrix4().makeTranslation(0, 1.49, 0.025)] };
    face.update(fakeRig as never);
  }

  if (opts.view === "loft") {
    shell.slider({ label: "sides per ring", min: 3, max: 18, step: 1, value: params.sides, onInput: (v) => { params.sides = Math.round(v); rebuild(); } });
    shell.slider({ label: "ring density", min: 0.4, max: 2.5, step: 0.05, value: params.rings, onInput: (v) => { params.rings = v; rebuild(); } });
    const modes = ["wire + surface", "surface", "wireframe"];
    let mode = 0;
    shell.button("view: wire + surface", () => {
      mode = (mode + 1) % modes.length;
      const b = shell.controls.querySelectorAll("button")[0];
      b.textContent = `view: ${modes[mode]}`;
      wire!.visible = mode !== 1;
      mesh!.visible = mode !== 2;
    });
    shell.setInfo(() => `${lastBuild.vertexCount.toLocaleString()} vertices · ${lastBuild.triangleCount.toLocaleString()} tris · lofted in ${lastBuild.buildMs.toFixed(1)} ms`);
  }

  if (opts.view === "sculpt") {
    shell.slider({ label: "radius ×", min: 0.7, max: 1.3, step: 0.01, value: 1, onInput: (v) => { params.radiusScale = v; rebuild(); } });
    shell.slider({ label: "belly", min: 0, max: 2.2, step: 0.05, value: 1, onInput: (v) => { params.belly = v; rebuild(); } });
    shell.setInfo(() => `${lastBuild.triangleCount.toLocaleString()} triangles · re-lofted in ${lastBuild.buildMs.toFixed(1)} ms`);
  }

  if (opts.view === "final") {
    let pal = 0;
    shell.button(`fur: ${PALETTE_NAMES[0]}`, () => {
      pal = (pal + 1) % PALETTE_NAMES.length;
      palette = PALETTE_NAMES[pal];
      paintZones(mesh!.geometry, palette);
      const b = shell.controls.querySelectorAll("button")[0];
      b.textContent = `fur: ${palette}`;
    });
    shell.slider({ label: "grain", min: 0, max: 0.4, step: 0.01, value: 0.16, onInput: (v) => (bearMat.furStrength.value = v) });
    shell.slider({ label: "grain scale", min: 6, max: 80, step: 1, value: 26, onInput: (v) => (bearMat.furScale.value = v) });
    shell.slider({ label: "rim", min: 0, max: 0.6, step: 0.01, value: 0.22, onInput: (v) => (bearMat.rimStrength.value = v) });
    shell.setInfo(() => `${lastBuild.vertexCount.toLocaleString()} vertices, zero modeling software`);
  }

  if (opts.view === "hero") {
    stage.orbit.distance = 3.1;
    stage.orbit.elevation = 0.12;
    shell.setInfo(() => `${lastBuild.triangleCount.toLocaleString()} triangles, every one placed by code`);
  }
  if (opts.view !== "loft") { wireframe = false; wire!.visible = false; }

  return {
    frame: () => {
      stage.render();
      shell.tick();
    },
    dispose: () => stage.dispose(),
  };
}
