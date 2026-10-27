// The figures of Ground Truth part 4: space colonization flat on a canvas
// where every rule is visible, the studio where a tree grows in three
// dimensions on a patch of meadow, and a hero grove on a hillside.

import * as THREE from "three/webgpu";
import { vec4 } from "three/tsl";
import { Shell, type Demo } from "../../lib/demoShell";
import { pixelRatio } from "../../lib/palette";
import { hash2 } from "../../lib/terrain/noise";
import { TERRAIN_DEFAULTS, buildTerrainGeometry, type TerrainParams } from "../../lib/terrain/heightmap";
import { EROSION_DEFAULTS, makeErosionGrid, rain, buildGridGeometry, updateGridGeometry } from "../../lib/terrain/erosion";
import { scatterOnGrid, buildGrassGeometry, makeGrassMaterial, sampleGrid, grassGroundTint } from "../../lib/terrain/grass";
import { growTree, buildTreeGeometry, makeTreeMaterials, TREE_DEFAULTS, type TreeParams, type TreeBuild } from "../../lib/terrain/trees";
import { plantForest, stampTreeShadows, type TreeSpot } from "../../lib/terrain/forest";
import { gridSampler } from "../../lib/terrain/light";
import { createTerrainStage, terrainMaterial, lin, MORNING, GOLDEN, Smooth } from "../../lib/terrain/look";
import { buildVista } from "../../lib/terrain/vista";

// ---- space colonization, flat ----------------------------------------------------------

interface Node2D { x: number; y: number; parent: number; children: number; r: number; born: number }

export function mountColonize2D(container: HTMLElement): Demo {
  const shell = new Shell(container, 0.62);
  const ctx = shell.canvas.getContext("2d")!;
  const W = shell.canvas.width, H = shell.canvas.height;
  const dpr = pixelRatio(shell.canvas);

  let influence = 0.22; // fractions of canvas height
  let kill = 0.055;
  let seed = 3;
  let ax: number[] = [], ay: number[] = [], alive: boolean[] = [];
  let nodes: Node2D[] = [];
  let round = 0;
  let done = false;
  let doneAt = 0;

  const ATTRACTORS = 240;
  const reset = (): void => {
    ax = []; ay = []; alive = [];
    nodes = [];
    round = 0;
    done = false;
    // crown: two hashed lobes in the upper part of the frame
    for (let k = 0; k < ATTRACTORS; k++) {
      const lobe = k % 2;
      const cx = W * (0.5 + (hash2(lobe, 11, seed) - 0.5) * 0.3);
      const cy = H * (0.36 + (hash2(lobe, 53, seed) - 0.5) * 0.14);
      const r = Math.sqrt(hash2(k, 101, seed)) * H * (0.2 + 0.08 * hash2(lobe, 77, seed));
      const th = hash2(k, 211, seed) * Math.PI * 2;
      ax.push(cx + Math.cos(th) * r * 1.45);
      ay.push(cy + Math.sin(th) * r);
      alive.push(true);
    }
    // a short trunk to grow from
    nodes.push({ x: W / 2, y: H * 0.97, parent: -1, children: 0, r: 0, born: 0 });
    for (let i = 1; i <= 4; i++) {
      nodes.push({ x: W / 2, y: H * 0.97 - i * H * 0.05, parent: i - 1, children: 0, r: 0, born: 0 });
      nodes[i - 1].children++;
    }
  };
  reset();

  // one round of the three rules
  const grow = (): void => {
    if (done) return;
    round++;
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
      const gx = accX[i] / accN[i] + (hash2(i, N, seed) - 0.5) * 0.2;
      const gy = accY[i] / accN[i] - 0.1; // a slight skyward pull (screen up is −y)
      const len = Math.hypot(gx, gy);
      if (len < 1e-5) continue;
      nodes.push({ x: nodes[i].x + (gx / len) * step, y: nodes[i].y + (gy / len) * step, parent: i, children: 0, r: 0, born: round });
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
    if (!grew || !anyAlive) {
      done = true;
      doneAt = performance.now();
    }
  };

  const draw = (): void => {
    ctx.fillStyle = "#0a0b10";
    ctx.fillRect(0, 0, W, H);

    // influence radius around the newest tips, faint, so you can see what a tip "sees"
    ctx.strokeStyle = "rgba(122, 162, 255, 0.07)";
    ctx.lineWidth = dpr;
    for (const n of nodes) {
      if (n.children !== 0 || done) continue;
      ctx.beginPath();
      ctx.arc(n.x, n.y, influence * H, 0, Math.PI * 2);
      ctx.stroke();
    }

    for (let k = 0; k < ax.length; k++) {
      ctx.fillStyle = alive[k] ? "rgba(103, 232, 249, 0.85)" : "rgba(103, 232, 249, 0.1)";
      ctx.beginPath();
      ctx.arc(ax[k], ay[k], (alive[k] ? 2.4 : 1.6) * dpr, 0, Math.PI * 2);
      ctx.fill();
    }

    // pipe-model radii, recomputed each frame (hundreds of nodes, cheap here)
    const acc = new Float32Array(nodes.length);
    for (let i = nodes.length - 1; i >= 1; i--) {
      const r = nodes[i].children === 0 ? 1.1 : Math.pow(acc[i], 1 / 2.4);
      nodes[i].r = r;
      if (nodes[i].parent >= 0) acc[nodes[i].parent] += Math.pow(r, 2.4);
    }
    ctx.lineCap = "round";
    for (let i = 1; i < nodes.length; i++) {
      const p = nodes[nodes[i].parent];
      const fresh = !done && nodes[i].born >= round - 1;
      ctx.strokeStyle = fresh ? "#f5d9a6" : "#b8946a";
      ctx.lineWidth = Math.min(10, nodes[i].r) * dpr;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(nodes[i].x, nodes[i].y);
      ctx.stroke();
    }
    const left = alive.filter(Boolean).length;
    shell.readout.textContent = done
      ? `done in ${round} rounds · ${nodes.length} nodes · ${left} of ${ATTRACTORS} attractors never reached`
      : `round ${round} · ${nodes.length} nodes · ${left} attractors alive`;
  };

  shell.slider({ label: "influence", min: 0.08, max: 0.5, step: 0.01, value: influence, onInput: (v) => { influence = v; reset(); } });
  shell.slider({ label: "kill radius", min: 0.02, max: 0.16, step: 0.005, value: kill, onInput: (v) => { kill = v; reset(); } });
  shell.button("new crown", () => { seed = (Math.random() * 1e6) | 0; reset(); });

  let frame = 0;
  return {
    frame() {
      if (++frame % 5 === 0) grow();
      // after a finished tree has been on show for a few seconds, grow it again
      if (done && performance.now() - doneAt > 4000) reset();
      draw();
    },
  };
}

// ---- the studio: one tree, grown in front of you ---------------------------------------

export async function mountTreeStudio(container: HTMLElement): Promise<Demo> {
  const shell = new Shell(container);
  const stage = await createTerrainStage(shell.canvas, MORNING, {
    target: [0, 1.7, 0],
    distance: 11.5,
    minDistance: 3,
    maxDistance: 20,
    elevation: 0.24,
    azimuth: 2.6,
    fov: 42,
    far: 200,
  });
  const look = stage.look;

  // a small block of meadow to stand on
  const tp: TerrainParams = { ...TERRAIN_DEFAULTS, seed: 5, amplitude: 0.5, frequency: 0.12 };
  const groundBuild = buildTerrainGeometry(tp, { size: 6, segments: 60, skirt: 0.8, skirtTint: [0.05, 0.04, 0.035, 1], light: { sun: look.sunDir, reach: 4 } });
  const tint = groundBuild.geometry.getAttribute("aTint") as THREE.BufferAttribute;
  for (let i = 0; i < 61 * 61; i++) {
    if (tint.getW(i) > 0) continue; // the skirt rim keeps its paint
    tint.setXYZW(i, 0.045, 0.07, 0.022, 0.8);
  }
  const ground = terrainMaterial(look, { amplitude: 3 });
  stage.scene.add(new THREE.Mesh(groundBuild.geometry, ground.material));
  const groundY = groundBuild.heights[30 + 61 * 30];

  const grid = { W: 61, size: 6, cellWorld: 0.1, heights: groundBuild.heights, delta: new Float32Array(61 * 61), droplets: 0 };
  const grassMat = makeGrassMaterial(look);
  grassMat.strength.value = 0.45;
  const blades = scatterOnGrid(grid, 3, { count: 20_000, seed: 9, scale: 1.3, maxSlope: 2, minH01: -1 });
  const grass = new THREE.Mesh(buildGrassGeometry(blades).geometry, grassMat.material);
  stage.scene.add(grass);

  const params: TreeParams = { ...TREE_DEFAULTS };
  const mats = makeTreeMaterials(look);
  mats.wind.value = 0.6;
  let bark: THREE.Mesh | null = null;
  let leaves: THREE.Mesh | null = null;
  let perchGroup: THREE.Group | null = null;
  let segs = 0, leafCount = 0, perchCount = 0, iters = 0;
  let growT = 0; // 0..1 reveal of the bark buffer
  let showPerches = false;
  let timer = 0;
  const leafScale = { value: 0 };

  const perchMat = new THREE.MeshBasicNodeMaterial();
  perchMat.colorNode = vec4(lin(0x67e8f9).mul(3), 1);

  const regrow = (): void => {
    const skel = growTree(params);
    const built = buildTreeGeometry(skel, { sun: look.sunDir });
    segs = built.segmentCount;
    leafCount = built.leafCount;
    perchCount = built.perches.length;
    iters = skel.iterations;

    if (bark) { bark.geometry.dispose(); bark.geometry = built.bark; }
    else { bark = new THREE.Mesh(built.bark, mats.bark); stage.scene.add(bark); }
    if (leaves) { leaves.geometry.dispose(); leaves.geometry = built.leaves; }
    else { leaves = new THREE.Mesh(built.leaves, mats.leaves); stage.scene.add(leaves); }
    bark.position.y = leaves.position.y = groundY - 0.05;

    if (perchGroup) stage.scene.remove(perchGroup);
    perchGroup = new THREE.Group();
    const marker = new THREE.SphereGeometry(0.035, 10, 8);
    for (const p of built.perches) {
      const m = new THREE.Mesh(marker, perchMat);
      m.position.copy(p.position);
      perchGroup.add(m);
    }
    perchGroup.position.y = groundY - 0.05;
    perchGroup.visible = showPerches;
    stage.scene.add(perchGroup);

    growT = 0;
    leafScale.value = 0;
  };
  regrow();

  const queue = (): void => {
    clearTimeout(timer);
    timer = window.setTimeout(regrow, 250);
  };

  shell.slider({ label: "attractors", min: 80, max: 800, step: 20, value: params.attractors, onInput: (v) => { params.attractors = v; queue(); } });
  shell.slider({ label: "influence", min: 0.5, max: 2.5, step: 0.05, value: params.influence, onInput: (v) => { params.influence = v; queue(); } });
  shell.slider({ label: "kill radius", min: 0.18, max: 0.7, step: 0.02, value: params.kill, onInput: (v) => { params.kill = v; queue(); } });
  shell.button("replay growth", () => { growT = 0; leafScale.value = 0; });
  const perchBtn = shell.button("show perches", () => {
    showPerches = !showPerches;
    perchBtn.textContent = showPerches ? "hide perches" : "show perches";
    if (perchGroup) perchGroup.visible = showPerches;
  });
  shell.button("new tree", () => { params.seed = (Math.random() * 1e6) | 0; regrow(); });
  shell.setInfo(() => `${segs} segments · ${leafCount.toLocaleString()} leaves · ${perchCount} perches · grew in ${iters} rounds`);

  let last = performance.now();
  return {
    frame() {
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const time = (now / 1000) % 10000;
      grassMat.time.value = time;
      mats.time.value = time;
      if (bark && leaves) {
        growT = Math.min(1, growT + dt * 0.4);
        const totalVerts = bark.geometry.getAttribute("position").count;
        // ease so the trunk shoots up and the twigs finish gently
        const eased = 1 - Math.pow(1 - growT, 2.2);
        bark.geometry.setDrawRange(0, Math.max(36, Math.floor(totalVerts * eased)));
        // leaves come out at the end, in growth order too
        if (growT > 0.55) leafScale.value = Math.min(1, leafScale.value + dt * 0.7);
        const lv = leaves.geometry.getAttribute("position").count;
        const shown = Math.floor((lv / 6) * leafScale.value) * 6;
        leaves.visible = shown > 0;
        leaves.geometry.setDrawRange(0, shown);
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
  const stage = await createTerrainStage(shell.canvas, GOLDEN, { fov: 50, near: 0.05, far: 1500 });
  const look = stage.look;

  const tp: TerrainParams = { ...TERRAIN_DEFAULTS, seed: 31, amplitude: 7, frequency: 0.045, octaves: 7 };
  const SIZE = 64, W = 257;
  const grid = makeErosionGrid(tp, SIZE, W);
  rain(grid, { ...EROSION_DEFAULTS, radius: 2 }, 40_000, tp.seed + 5);

  const terrain = terrainMaterial(look, { amplitude: tp.amplitude, snowLine: [0.8, 0.95] });
  const vista = buildVista(tp, look.sunDir, terrain.material, [
    { half: 128, step: 1 },
    { half: 640, step: 5 },
  ], { core: SIZE / 2, reach: 60 });
  stage.scene.add(vista.group);

  // six grown variants, instanced across the slopes
  const variants: TreeBuild[] = [];
  for (let k = 0; k < 6; k++) {
    variants.push(buildTreeGeometry(growTree({ ...TREE_DEFAULTS, seed: 100 + k * 17, attractors: 300 + k * 30 }), { sun: look.sunDir }));
  }

  const R = 13; // the camera circles at this radius
  // hashed spots with a greedy spacing rule: a tree keeps its spot only if
  // no earlier tree stands within 2.6 units; groves where a slow noise says so
  const spots: TreeSpot[] = [];
  for (let k = 0; k < 4000 && spots.length < 140; k++) {
    const x = (hash2(k, 3, 9) * 2 - 1) * (SIZE / 2 - 3);
    const z = (hash2(k, 71, 9) * 2 - 1) * (SIZE / 2 - 3);
    const g = sampleGrid(grid, x, z);
    const h01 = g.h / tp.amplitude;
    if (h01 < 0.08 || h01 > 0.5 || g.slope > 0.7) continue;
    if (Math.abs(Math.hypot(x, z) - R) < 4.5) continue; // the camera's path stays clear
    const grove = Math.sin(x * 0.13 + 1.3) * Math.cos(z * 0.11 - 0.4);
    if (hash2(k, 5, 9) > 0.15 + 0.85 * Math.max(0, grove)) continue;
    if (spots.some((s) => (s.x - x) ** 2 + (s.z - z) ** 2 < 2.6 * 2.6)) continue;
    spots.push({ x, z, y: g.h - 0.05, yaw: hash2(k, 97, 9) * Math.PI * 2, scale: 0.8 + 0.5 * hash2(k, 157, 9), variant: k % variants.length });
  }

  const core = buildGridGeometry(grid, {
    skirt: 0.6,
    taper: 20,
    sun: look.sunDir,
    reach: 60,
    outside: vista.heightAt,
    groundTint: grassGroundTint(grid, tp.amplitude, {}, 0.8),
  });
  const light = core.userData.state.light as Float32Array;
  stampTreeShadows(light, W, W, -SIZE / 2, -SIZE / 2, SIZE / (W - 1), spots, variants, look.sunDir);
  updateGridGeometry(core, grid);
  const coreMesh = new THREE.Mesh(core, terrain.material);
  coreMesh.frustumCulled = false;
  stage.scene.add(coreMesh);

  const mats = makeTreeMaterials(look);
  mats.wind.value = 0.7;
  stage.scene.add(plantForest(variants, spots, mats));

  const sunAt = gridSampler(light.filter((_, i) => i % 2 === 0), W, W, -SIZE / 2, -SIZE / 2, SIZE / (W - 1));
  const grassMat = makeGrassMaterial(look);
  grassMat.strength.value = 0.5;
  const blades = scatterOnGrid(grid, tp.amplitude, { count: 260_000, seed: 77, scale: 1.3, sun: sunAt });
  const grass = new THREE.Mesh(buildGrassGeometry(blades).geometry, grassMat.material);
  grass.frustumCulled = false;
  stage.scene.add(grass);

  const heightAt = (x: number, z: number): number => sampleGrid(grid, x, z).h;
  const speed = 0.016;
  let theta = 1.2;
  let last = performance.now();
  const alt = new Smooth(2.5);
  const lookY = new Smooth(2.5);
  const envelope = (th: number): number => {
    let m = -Infinity;
    for (let k = -2; k <= 4; k++) {
      const a = th + k * 0.05;
      m = Math.max(m, heightAt(Math.cos(a) * R, Math.sin(a) * R));
    }
    return m;
  };

  return {
    frame() {
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      theta += dt * speed;
      const time = (now / 1000) % 10000;
      grassMat.time.value = time;
      mats.time.value = time;

      const cx = Math.cos(theta) * R, cz = Math.sin(theta) * R;
      const cy = alt.step(envelope(theta) + 3.2, dt);
      stage.camera.position.set(cx, cy, cz);
      // look ahead along the clearing and a little outward, across the groves
      const la = theta + 0.6;
      const lx = Math.cos(la) * R * 1.25, lz = Math.sin(la) * R * 1.25;
      stage.camera.lookAt(lx, lookY.step(cy - 1.2, dt), lz);
      stage.draw();
    },
    dispose: () => stage.dispose(),
  };
}
