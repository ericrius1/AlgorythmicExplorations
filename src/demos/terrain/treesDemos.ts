// The figures of Ground Truth part 4: space colonization flat on a canvas
// where every rule is visible, the studio where a tree grows in three
// dimensions and offers its perches, and a hero grove on a hillside.

import * as THREE from "three/webgpu";
import { Shell, type Demo } from "../../lib/demoShell";
import { createStage3D } from "../../lib/stage3d";
import { hash2 } from "../../lib/terrain/noise";
import { TERRAIN_DEFAULTS, type TerrainParams } from "../../lib/terrain/heightmap";
import { EROSION_DEFAULTS, makeErosionGrid, rain, buildGridGeometry } from "../../lib/terrain/erosion";
import { scatterOnGrid, buildGrassGeometry, makeGrassMaterial, sampleGrid } from "../../lib/terrain/grass";
import { growTree, buildTreeGeometry, TREE_DEFAULTS, type TreeParams } from "../../lib/terrain/trees";

const MORNING_STAGE = {
  skyTop: [0.09, 0.13, 0.22] as [number, number, number],
  skyBottom: [0.23, 0.21, 0.22] as [number, number, number],
  hemi: { sky: 0xa8c0e0, ground: 0x46503a, intensity: 0.9 },
  key: { color: 0xfff0c8, intensity: 2.2, position: [5, 6, 2] as [number, number, number] },
  rim: { color: 0x88a8e8, intensity: 0.45, position: [-5, 3, -4] as [number, number, number] },
};

// ---- space colonization, flat ----------------------------------------------------------

interface Node2D { x: number; y: number; parent: number; children: number; r: number }

export function mountColonize2D(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.62);
  const ctx = shell.canvas.getContext("2d")!;
  const W = shell.canvas.width, H = shell.canvas.height;

  let influence = 0.22; // fractions of canvas height
  let kill = 0.055;
  let seed = 3;
  let ax: number[] = [], ay: number[] = [], alive: boolean[] = [];
  let nodes: Node2D[] = [];
  let done = false;

  const reset = (): void => {
    ax = []; ay = []; alive = [];
    nodes = [];
    done = false;
    // crown: two hashed circular lobes in the upper half
    for (let k = 0; k < 240; k++) {
      const lobe = k % 2;
      const cx = W * (0.5 + (hash2(lobe, 11, seed) - 0.5) * 0.42);
      const cy = H * (0.34 + (hash2(lobe, 53, seed) - 0.5) * 0.18);
      const r = Math.sqrt(hash2(k, 101, seed)) * H * (0.2 + 0.1 * hash2(lobe, 77, seed));
      const th = hash2(k, 211, seed) * Math.PI * 2;
      ax.push(cx + Math.cos(th) * r * 1.5);
      ay.push(cy + Math.sin(th) * r);
      alive.push(true);
    }
    // a short trunk to grow from
    nodes.push({ x: W / 2, y: H * 0.96, parent: -1, children: 0, r: 0 });
    for (let i = 1; i <= 4; i++) {
      nodes.push({ x: W / 2, y: H * 0.96 - i * H * 0.05, parent: i - 1, children: 0, r: 0 });
      nodes[i - 1].children++;
    }
  };
  reset();

  const grow = (): void => {
    if (done) return;
    const inf = influence * H, kil = kill * H, step = H * 0.028;
    const accX = new Float32Array(nodes.length);
    const accY = new Float32Array(nodes.length);
    const accN = new Int32Array(nodes.length);
    let anyAlive = false;
    for (let k = 0; k < ax.length; k++) {
      if (!alive[k]) continue;
      anyAlive = true;
      let best = -1, bestD = inf * inf;
      for (let i = 0; i < nodes.length; i++) {
        const dx = ax[k] - nodes[i].x, dy = ay[k] - nodes[i].y;
        const d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = i; }
      }
      if (best >= 0) {
        const d = Math.sqrt(bestD) || 1;
        accX[best] += (ax[k] - nodes[best].x) / d;
        accY[best] += (ay[k] - nodes[best].y) / d;
        accN[best]++;
      }
    }
    const N = nodes.length;
    let grew = false;
    for (let i = 0; i < N; i++) {
      if (accN[i] === 0) continue;
      let gx = accX[i] / accN[i] + (hash2(i, N, seed) - 0.5) * 0.2;
      let gy = accY[i] / accN[i] - 0.1; // a slight skyward pull, screen-space up
      const len = Math.hypot(gx, gy);
      if (len < 1e-5) continue;
      nodes.push({ x: nodes[i].x + (gx / len) * step, y: nodes[i].y + (gy / len) * step, parent: i, children: 0, r: 0 });
      nodes[i].children++;
      grew = true;
    }
    for (let k = 0; k < ax.length; k++) {
      if (!alive[k]) continue;
      for (let i = N; i < nodes.length; i++) {
        const dx = ax[k] - nodes[i].x, dy = ay[k] - nodes[i].y;
        if (dx * dx + dy * dy < kil * kil) { alive[k] = false; break; }
      }
    }
    if (!grew || !anyAlive) done = true;
  };

  const draw = (): void => {
    ctx.fillStyle = "#0a0b10";
    ctx.fillRect(0, 0, W, H);

    for (let k = 0; k < ax.length; k++) {
      ctx.fillStyle = alive[k] ? "rgba(103, 232, 249, 0.55)" : "rgba(103, 232, 249, 0.08)";
      ctx.beginPath();
      ctx.arc(ax[k], ay[k], 2, 0, Math.PI * 2);
      ctx.fill();
    }

    // pipe-model radii, recomputed each frame (hundreds of nodes — cheap here)
    const acc = new Float32Array(nodes.length);
    for (let i = nodes.length - 1; i >= 1; i--) {
      const r = nodes[i].children === 0 ? 1.1 : Math.pow(acc[i], 1 / 2.4);
      nodes[i].r = r;
      if (nodes[i].parent >= 0) acc[nodes[i].parent] += Math.pow(r, 2.4);
    }
    ctx.strokeStyle = "#c9a877";
    ctx.lineCap = "round";
    for (let i = 1; i < nodes.length; i++) {
      const p = nodes[nodes[i].parent];
      ctx.lineWidth = Math.min(9, nodes[i].r);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(nodes[i].x, nodes[i].y);
      ctx.stroke();
    }
    const left = alive.filter(Boolean).length;
    shell.readout.textContent = done
      ? `done — ${nodes.length} nodes · ${left} attractors never reached`
      : `${nodes.length} nodes · ${left} attractors alive`;
  };

  shell.slider({ label: "influence", min: 0.08, max: 0.5, step: 0.01, value: influence, onInput: (v) => { influence = v; } });
  shell.slider({ label: "kill radius", min: 0.02, max: 0.16, step: 0.005, value: kill, onInput: (v) => { kill = v; } });
  shell.button("regrow", () => { reset(); });
  shell.button("reroll", () => { seed = (Math.random() * 1e6) | 0; reset(); });

  let frame = 0;
  return {
    frame() {
      if (++frame % 6 === 0) grow();
      draw();
    },
  };
}

// ---- the studio: one tree, grown in front of you ---------------------------------------

export async function mountTreeStudio(container: HTMLElement): Promise<Demo> {
  const shell = new Shell(container);
  const stage = await createStage3D(shell.canvas, {
    ...MORNING_STAGE,
    target: [0, 1.7, 0],
    distance: 6.5,
    minDistance: 2,
    maxDistance: 18,
    elevation: 0.15,
    azimuth: 0.5,
    fov: 45,
    far: 120,
  });

  const params: TreeParams = { ...TREE_DEFAULTS };
  const barkMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
  const leafMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, transparent: true, opacity: 0 });
  let bark: THREE.Mesh | null = null;
  let leaves: THREE.Mesh | null = null;
  let perchGroup: THREE.Group | null = null;
  let segs = 0, leafCount = 0, perchCount = 0, iters = 0;
  let growT = 0; // 0..1 reveal of the bark buffer
  let showPerches = false;
  let timer = 0;

  const regrow = (): void => {
    const skel = growTree(params);
    const built = buildTreeGeometry(skel);
    segs = built.segmentCount;
    leafCount = built.leafCount;
    perchCount = built.perches.length;
    iters = skel.iterations;

    if (bark) { bark.geometry.dispose(); bark.geometry = built.bark; }
    else { bark = new THREE.Mesh(built.bark, barkMat); stage.scene.add(bark); }
    if (leaves) { leaves.geometry.dispose(); leaves.geometry = built.leaves; }
    else { leaves = new THREE.Mesh(built.leaves, leafMat); stage.scene.add(leaves); }

    if (perchGroup) stage.scene.remove(perchGroup);
    perchGroup = new THREE.Group();
    const marker = new THREE.SphereGeometry(0.035, 8, 6);
    const markerMat = new THREE.MeshBasicMaterial({ color: 0x67e8f9 });
    for (const p of built.perches) {
      const m = new THREE.Mesh(marker, markerMat);
      m.position.copy(p.position);
      perchGroup.add(m);
    }
    perchGroup.visible = showPerches;
    stage.scene.add(perchGroup);

    growT = 0;
    leafMat.opacity = 0;
  };
  regrow();

  const queue = (): void => {
    clearTimeout(timer);
    timer = window.setTimeout(regrow, 250);
  };

  shell.slider({ label: "attractors", min: 80, max: 800, step: 20, value: params.attractors, onInput: (v) => { params.attractors = v; queue(); } });
  shell.slider({ label: "influence", min: 0.5, max: 2.5, step: 0.05, value: params.influence, onInput: (v) => { params.influence = v; queue(); } });
  shell.slider({ label: "kill radius", min: 0.18, max: 0.7, step: 0.02, value: params.kill, onInput: (v) => { params.kill = v; queue(); } });
  shell.button("replay growth", () => { growT = 0; leafMat.opacity = 0; });
  shell.button("perches", () => {
    showPerches = !showPerches;
    if (perchGroup) perchGroup.visible = showPerches;
  });
  shell.button("reroll", () => { params.seed = (Math.random() * 1e6) | 0; regrow(); });
  shell.setInfo(() => `${segs} segments · ${leafCount} leaf blobs · ${perchCount} perches · grew in ${iters} rounds`);

  let last = performance.now();
  return {
    frame() {
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (bark) {
        growT = Math.min(1, growT + dt * 0.45);
        const totalVerts = bark.geometry.getAttribute("position").count;
        // ease so the trunk shoots up and the twigs finish gently
        const eased = 1 - Math.pow(1 - growT, 2.2);
        bark.geometry.setDrawRange(0, Math.floor(totalVerts * eased));
        if (growT > 0.6 && leaves) leafMat.opacity = Math.min(1, leafMat.opacity + dt * 1.2);
      }
      stage.render();
      shell.tick();
    },
    dispose: () => stage.dispose(),
  };
}

// ---- hero: the grove --------------------------------------------------------------------

export async function mountGroveHero(container: HTMLElement): Promise<Demo> {
  const shell = new Shell(container, 0.5);
  const stage = await createStage3D(shell.canvas, {
    ...MORNING_STAGE,
    fog: { color: 0x151a24, near: 12, far: 60 },
    fov: 55,
    far: 200,
  });

  const tp: TerrainParams = { ...TERRAIN_DEFAULTS, seed: 31, amplitude: 3.2, frequency: 0.06 };
  const grid = makeErosionGrid(tp, 56, 280);
  rain(grid, { ...EROSION_DEFAULTS, radius: 2 }, 30_000, tp.seed + 5);
  stage.scene.add(new THREE.Mesh(buildGridGeometry(grid, tp.amplitude), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 })));

  const grassMat = makeGrassMaterial();
  grassMat.strength.value = 0.55;
  const blades = scatterOnGrid(grid, tp.amplitude, { count: 160_000, seed: 77 });
  stage.scene.add(new THREE.Mesh(buildGrassGeometry(blades).geometry, grassMat.material));

  // four grown variants, instanced across the hillside
  const variants = [0, 1, 2, 3].map((k) => buildTreeGeometry(growTree({ ...TREE_DEFAULTS, seed: 100 + k * 17 })));
  const barkMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
  const leafMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });

  // hashed placement with a greedy spacing rule: a tree keeps its spot only
  // if no earlier tree stands within 4 units
  const spots: { x: number; z: number; y: number; yaw: number; s: number; v: number }[] = [];
  for (let k = 0; k < 400 && spots.length < 26; k++) {
    const x = (hash2(k, 3, 9) * 2 - 1) * 24;
    const z = (hash2(k, 71, 9) * 2 - 1) * 24;
    const g = sampleGrid(grid, x, z);
    const h01 = g.h / tp.amplitude;
    if (h01 < 0.04 || h01 > 0.42 || g.slope > 0.6) continue;
    if (spots.some((s) => (s.x - x) * (s.x - x) + (s.z - z) * (s.z - z) < 16)) continue;
    spots.push({ x, z, y: g.h - 0.04, yaw: hash2(k, 97, 9) * Math.PI * 2, s: 0.8 + 0.7 * hash2(k, 157, 9), v: k % 4 });
  }

  const m4 = new THREE.Matrix4();
  for (let v = 0; v < 4; v++) {
    const mine = spots.filter((s) => s.v === v);
    if (mine.length === 0) continue;
    const barkInst = new THREE.InstancedMesh(variants[v].bark, barkMat, mine.length);
    const leafInst = new THREE.InstancedMesh(variants[v].leaves, leafMat, mine.length);
    mine.forEach((s, i) => {
      m4.makeRotationY(s.yaw).scale(new THREE.Vector3(s.s, s.s, s.s)).setPosition(s.x, s.y, s.z);
      barkInst.setMatrixAt(i, m4);
      leafInst.setMatrixAt(i, m4);
    });
    stage.scene.add(barkInst, leafInst);
  }

  let theta = 0;
  let camY = 5;
  let last = performance.now();
  const R = 13;

  return {
    frame() {
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      theta += dt * 0.026;
      grassMat.time.value = (now / 1000) % 10000;

      const cx = Math.cos(theta) * R;
      const cz = Math.sin(theta) * R;
      camY += (sampleGrid(grid, cx, cz).h + 1.6 - camY) * Math.min(1, dt * 2);
      stage.camera.position.set(cx, camY, cz);

      const la = theta + 0.65;
      const lx = Math.cos(la) * R * 1.1;
      const lz = Math.sin(la) * R * 1.1;
      stage.camera.lookAt(lx, sampleGrid(grid, lx, lz).h + 1.6, lz);

      stage.renderer.render(stage.scene, stage.camera);
    },
    dispose: () => stage.dispose(),
  };
}
