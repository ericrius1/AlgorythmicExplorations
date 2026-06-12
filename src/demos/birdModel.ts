// The figures of Feather & Bone part 1: the station scaffold (rings in space,
// explodable into components), the loft stitching one component live, the
// feather workbench with every shape parameter on a slider, the feather coat
// fanning over the wing skeleton, and the finished eagle on a turntable.

import * as THREE from "three/webgpu";
import { Shell, type Demo } from "../lib/demoShell";
import { createStage3D, addGroundDisc } from "../lib/stage3d";
import {
  eagleLofts,
  loftRings,
  buildLoftGeometry,
  buildEagleBody,
  ZONE_COLORS,
  type Loft,
} from "../lib/bird/body";
import { makeFeatherGeometry, FeatherCoat, COAT_POSE_REST, type FeatherShape } from "../lib/bird/feathers";
import { createEagle } from "../lib/bird/bird";
import { createBirdRig } from "../lib/bird/rig";
import { WINGS, applyWingTip, unfoldTarget } from "../lib/bird/wing";

export const EAGLE_STAGE = {
  target: [0, 0.42, 0] as [number, number, number],
  distance: 2.4,
  minDistance: 0.9,
  maxDistance: 7,
  elevation: 0.12,
  azimuth: 0.6,
  hemi: { sky: 0x9db8d6, ground: 0x4a4035, intensity: 1.0 },
  key: { color: 0xfff0dd, intensity: 2.2, position: [2.5, 3.5, 2] as [number, number, number] },
  rim: { color: 0x86a8ff, intensity: 1.1, position: [-2, 2.2, -2.6] as [number, number, number] },
};

// ---- the scaffold: every station ring, before any skin -----------------------------

export async function mountBirdStations(container: HTMLElement): Promise<Demo> {
  const shell = new Shell(container);
  const stage = await createStage3D(shell.canvas, EAGLE_STAGE);
  addGroundDisc(stage.scene, { radius: 1.5, shadowRadius: 0.35 });

  const palette = ZONE_COLORS.map((hex) => new THREE.Color().setHex(hex, THREE.SRGBColorSpace));
  const centroid = new THREE.Vector3(0, 0.42, 0);

  interface Part {
    group: THREE.Group;
    home: THREE.Vector3;
    dir: THREE.Vector3;
  }
  const parts: Part[] = [];
  const lofts = eagleLofts();
  let ringCount = 0;

  const addPart = (loft: Loft, flip: boolean): void => {
    const group = new THREE.Group();
    const color = palette[loft.zone].clone().lerp(new THREE.Color(1, 1, 1), 0.25);
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95 });
    const center = new THREE.Vector3();
    let n = 0;
    for (const ring of loftRings(loft, flip)) {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i < ring.length; i += 3) {
        pts.push(new THREE.Vector3(ring[i], ring[i + 1], ring[i + 2]));
        center.add(pts[pts.length - 1]);
        n++;
      }
      pts.push(pts[0].clone());
      group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat));
      ringCount++;
    }
    // spine: connect station centers so the path reads
    const spine = loft.stations.map((s) => new THREE.Vector3((flip ? -1 : 1) * s.c[0], s.c[1], s.c[2]));
    group.add(
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(spine),
        new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4 }),
      ),
    );
    center.multiplyScalar(1 / Math.max(n, 1));
    const part: Part = { group, home: new THREE.Vector3(), dir: center.clone().sub(centroid) };
    parts.push(part);
    stage.scene.add(group);
  };

  for (const loft of lofts) {
    addPart(loft, false);
    if (loft.mirror) addPart(loft, true);
  }

  const apply = (explode: number): void => {
    for (const p of parts) p.group.position.copy(p.dir).multiplyScalar(explode);
  };
  shell.slider({ label: "explode", min: 0, max: 1.1, step: 0.01, value: 0, onInput: apply });
  shell.setInfo(() => `${parts.length} lofts · ${ringCount} stationed rings — no triangles yet, just hoops on paths`);

  return {
    frame() {
      stage.render();
      shell.tick();
    },
    dispose: () => stage.dispose(),
  };
}

// ---- the loft, stitching one component live ------------------------------------------

export async function mountBirdLoft(container: HTMLElement): Promise<Demo> {
  const shell = new Shell(container);
  const stage = await createStage3D(shell.canvas, { ...EAGLE_STAGE, distance: 1.6, target: [0, 0.55, 0.1] });
  addGroundDisc(stage.scene, { radius: 1.5, shadowRadius: 0.35 });

  const lofts = eagleLofts();
  const choices = ["torso", "beak-upper", "sleeve-humL", "thighL", "tarsusL", "tail-root"];
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });

  let mesh: THREE.Mesh | null = null;
  let ringGroup: THREE.Group | null = null;
  let pick = 0;
  let stitch = 1;
  let triTotal = 0;

  const rebuild = (): void => {
    const loft = lofts.find((l) => l.name === choices[pick])!;
    const geo = buildLoftGeometry(loft);
    triTotal = geo.getAttribute("position").count / 3;
    if (mesh) {
      mesh.geometry.dispose();
      mesh.geometry = geo;
    } else {
      mesh = new THREE.Mesh(geo, material);
      stage.scene.add(mesh);
    }
    if (ringGroup) {
      stage.scene.remove(ringGroup);
      ringGroup.traverse((o) => {
        if (o instanceof THREE.Line) o.geometry.dispose();
      });
    }
    ringGroup = new THREE.Group();
    const mat = new THREE.LineBasicMaterial({ color: 0xffd98a, transparent: true, opacity: 0.85, depthTest: false });
    for (const ring of loftRings(loft)) {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i < ring.length; i += 3) pts.push(new THREE.Vector3(ring[i], ring[i + 1], ring[i + 2]));
      pts.push(pts[0].clone());
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat);
      line.renderOrder = 5;
      ringGroup.add(line);
    }
    stage.scene.add(ringGroup);
    applyStitch();
  };

  const applyStitch = (): void => {
    if (!mesh) return;
    const verts = Math.floor((triTotal * stitch)) * 3;
    mesh.geometry.setDrawRange(0, verts);
  };

  shell.slider({
    label: "component",
    min: 0,
    max: choices.length - 1,
    step: 1,
    value: 0,
    format: (v) => choices[Math.round(v)],
    onInput: (v) => {
      pick = Math.round(v);
      rebuild();
    },
  });
  shell.slider({ label: "stitch", min: 0, max: 1, step: 0.005, value: 1, onInput: (v) => { stitch = v; applyStitch(); } });
  shell.button("wireframe", () => (material.wireframe = !material.wireframe));
  shell.setInfo(() => `ring pairs become quad strips, quads become triangles — ${Math.floor(triTotal * stitch)} of ${triTotal}`);
  rebuild();

  return {
    frame() {
      stage.render();
      shell.tick();
    },
    dispose: () => stage.dispose(),
  };
}

// ---- the feather workbench -----------------------------------------------------------

export async function mountFeather(container: HTMLElement): Promise<Demo> {
  const shell = new Shell(container);
  const stage = await createStage3D(shell.canvas, {
    ...EAGLE_STAGE,
    target: [0, 0.42, 0.45],
    distance: 1.5,
    elevation: 0.35,
    azimuth: 0.15,
  });

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    color: new THREE.Color().setHex(0x6b5436, THREE.SRGBColorSpace),
    roughness: 0.8,
    side: THREE.DoubleSide,
    flatShading: true,
  });

  const shape: Required<FeatherShape> = {
    rows: 5,
    peak: 0.42,
    baseW: 0.42,
    fold: 0.5,
    droop: 0.1,
    emarginate: 0,
    tip: "round",
  };
  const tips: FeatherShape["tip"][] = ["round", "point", "square"];
  let tipIdx = 0;

  const mesh = new THREE.Mesh(makeFeatherGeometry(shape), material);
  mesh.scale.setScalar(0.9);
  mesh.position.set(0, 0.42, 0);
  stage.scene.add(mesh);

  let tris = 0;
  const rebuild = (): void => {
    mesh.geometry.dispose();
    mesh.geometry = makeFeatherGeometry(shape);
    tris = mesh.geometry.getAttribute("position").count / 3;
  };
  rebuild();

  shell.slider({ label: "widest at", min: 0.2, max: 0.7, step: 0.01, value: shape.peak, onInput: (v) => { shape.peak = v; rebuild(); } });
  shell.slider({ label: "tent fold", min: 0, max: 1, step: 0.01, value: shape.fold, onInput: (v) => { shape.fold = v; rebuild(); } });
  shell.slider({ label: "droop", min: 0, max: 0.35, step: 0.01, value: shape.droop, onInput: (v) => { shape.droop = v; rebuild(); } });
  shell.slider({ label: "emarginate", min: 0, max: 0.6, step: 0.01, value: 0, onInput: (v) => { shape.emarginate = v < 0.05 ? 0 : 1 - v; rebuild(); } });
  shell.button("tip: round / point / square", () => {
    tipIdx = (tipIdx + 1) % 3;
    shape.tip = tips[tipIdx]!;
    rebuild();
  });
  shell.setInfo(() => `${tris} triangles — a shaft ridge, two vanes, and a width profile`);

  return {
    frame() {
      stage.render();
      shell.tick();
    },
    dispose: () => stage.dispose(),
  };
}

// ---- the coat: feathers fanning over the wing skeleton --------------------------------

export async function mountCoat(container: HTMLElement): Promise<Demo> {
  const shell = new Shell(container);
  const stage = await createStage3D(shell.canvas, { ...EAGLE_STAGE, distance: 2.9, target: [0, 0.5, 0] });
  addGroundDisc(stage.scene, { radius: 1.6, shadowRadius: 0.35 });

  // body as a ghost so the feathers read as the subject
  const build = buildEagleBody();
  const ghost = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.9,
    transparent: true,
    opacity: 0.25,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const body = new THREE.Mesh(build.geometry, ghost);
  stage.scene.add(body);

  const rig = createBirdRig();
  stage.scene.add(rig.root);
  const coat = new FeatherCoat();
  stage.scene.add(coat.group);

  const pose = { ...COAT_POSE_REST };
  let spread = 1;
  const tL = new THREE.Vector3();
  const tR = new THREE.Vector3();

  shell.slider({ label: "wing spread", min: 0, max: 1, step: 0.005, value: 1, onInput: (v) => (spread = v) });
  shell.slider({ label: "tail fan", min: 0, max: 1, step: 0.01, value: 0.5, onInput: (v) => (pose.tailSpread = v) });
  shell.slider({ label: "splay", min: 0, max: 1, step: 0.01, value: 0, onInput: (v) => (pose.splay = v) });
  shell.slider({ label: "slot open", min: 0, max: 1, step: 0.01, value: 0, onInput: (v) => (pose.slot = v) });
  shell.setInfo(() => `${coat.featherCount} feathers, every one a rigid plane on a bone — zero of them skinned`);

  return {
    frame() {
      applyWingTip(rig, WINGS.L, unfoldTarget(WINGS.L, spread, tL), { twist: 0.1 * spread });
      applyWingTip(rig, WINGS.R, unfoldTarget(WINGS.R, spread, tR), { twist: 0.1 * spread });
      pose.spread = spread;
      rig.root.updateWorldMatrix(true, true);
      coat.update(rig.bones, pose);
      stage.render();
      shell.tick();
    },
    dispose: () => stage.dispose(),
  };
}

// ---- the finished eagle ----------------------------------------------------------------

export async function mountBirdFull(container: HTMLElement, opts: { hero?: boolean } = {}): Promise<Demo> {
  const shell = new Shell(container, opts.hero ? 0.5 : 0.62);
  const stage = await createStage3D(shell.canvas, { ...EAGLE_STAGE, distance: opts.hero ? 2.2 : 2.4 });
  addGroundDisc(stage.scene, { radius: 1.6, shadowRadius: 0.35 });

  const eagle = createEagle();
  stage.scene.add(eagle.group);

  let tailFan = 0.25;
  let spread = 0;
  if (!opts.hero) {
    shell.slider({ label: "wing spread", min: 0, max: 1, step: 0.005, value: 0, onInput: (v) => (spread = v) });
    shell.slider({ label: "tail fan", min: 0, max: 1, step: 0.01, value: tailFan, onInput: (v) => (tailFan = v) });
    shell.setInfo(
      () =>
        `${eagle.build.triangleCount.toLocaleString()} body triangles + ${eagle.coat.featherCount} feathers · lofted in ${eagle.build.buildMs.toFixed(1)} ms`,
    );
  }

  return {
    frame() {
      const t = performance.now() / 1000;
      const breath = Math.sin(t * Math.PI * 2 * 0.4) * 0.4;
      eagle.pose({ phase: 0, spread, flap: 0, tailFan, beak: 0, theta: breath, legExtend: 1 });
      // idle: slow head scan so she reads alive even at rest
      eagle.rig.bone("head").rotation.y = Math.sin(t * 0.5) * 0.35;
      stage.render();
      if (!opts.hero) shell.tick();
    },
    dispose: () => stage.dispose(),
  };
}
