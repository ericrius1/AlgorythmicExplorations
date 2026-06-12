// Trees grown, not modeled. Space colonization (Runions et al. 2007): scatter
// attraction points where foliage could live, let branch tips grow toward the
// ones they can see, kill points as they're reached — branching emerges from
// competition for space, the way it does outdoors. Radii come from the pipe
// model (a parent carries the cross-section of its children), the mesh is
// deliberately faceted to match this site's creatures, and every tree ships
// a list of perches — because a wren from the sister series is going to need
// somewhere to land.

import * as THREE from "three/webgpu";
import { hash2 } from "./noise";

export interface TreeParams {
  seed: number;
  attractors: number; // foliage candidates scattered in the crown
  trunkHeight: number; // bare trunk before branching starts
  crownRadius: number; // horizontal half-width of the crown volume
  crownHeight: number; // vertical half-height
  influence: number; // how far a tip can "see" an attractor
  kill: number; // how close counts as "reached"
  step: number; // growth per iteration
  upBias: number; // phototropism: every shoot leans a little skyward
  thickness: number; // radius multiplier from the pipe model
}

export const TREE_DEFAULTS: TreeParams = {
  seed: 1,
  attractors: 320,
  trunkHeight: 1.5,
  crownRadius: 1.6,
  crownHeight: 1.3,
  influence: 1.1,
  kill: 0.28,
  step: 0.17,
  upBias: 0.18,
  thickness: 1.0,
};

export interface TreeNode {
  x: number;
  y: number;
  z: number;
  parent: number; // -1 at the root
  children: number;
  depth: number;
  radius: number;
}

export interface TreeSkeleton {
  nodes: TreeNode[]; // in growth order: parents always before children
  params: TreeParams;
  iterations: number;
}

// ---- growth ---------------------------------------------------------------------------

export function growTree(params: TreeParams): TreeSkeleton {
  const p = params;
  const nodes: TreeNode[] = [];
  const addNode = (x: number, y: number, z: number, parent: number): number => {
    const depth = parent >= 0 ? nodes[parent].depth + 1 : 0;
    if (parent >= 0) nodes[parent].children++;
    nodes.push({ x, y, z, parent, children: 0, depth, radius: 0 });
    return nodes.length - 1;
  };

  // the trunk: a few straight segments with a hashed wander, so no two trees
  // stand identically even before the crown gets a vote
  let prev = addNode(0, 0, 0, -1);
  const trunkSegs = Math.max(2, Math.round(p.trunkHeight / p.step / 2));
  for (let i = 1; i <= trunkSegs; i++) {
    const t = i / trunkSegs;
    const wx = (hash2(i, 5, p.seed) - 0.5) * 0.14 * p.trunkHeight;
    const wz = (hash2(i, 47, p.seed) - 0.5) * 0.14 * p.trunkHeight;
    prev = addNode(wx * t, t * p.trunkHeight, wz * t, prev);
  }

  // attractors: two or three hashed ellipsoid lobes make an irregular crown —
  // a single ellipsoid grows suspiciously polite trees
  const lobes = 2 + (hash2(9, 9, p.seed) > 0.5 ? 1 : 0);
  const ax: number[] = [], ay: number[] = [], az: number[] = [];
  const alive: boolean[] = [];
  for (let k = 0; k < p.attractors; k++) {
    const lobe = k % lobes;
    const lx = (hash2(lobe, 33, p.seed) - 0.5) * p.crownRadius * 1.1;
    const lz = (hash2(lobe, 87, p.seed) - 0.5) * p.crownRadius * 1.1;
    const ly = p.trunkHeight + p.crownHeight * (0.55 + 0.5 * hash2(lobe, 51, p.seed));
    // rejection-free ellipsoid sample: cube-root radius for uniform density
    const u = hash2(k, 101, p.seed), v = hash2(k, 211, p.seed), w = hash2(k, 307, p.seed);
    const r = Math.cbrt(u);
    const th = v * Math.PI * 2;
    const ph = Math.acos(2 * w - 1);
    ax.push(lx + r * Math.sin(ph) * Math.cos(th) * p.crownRadius * 0.8);
    ay.push(ly + r * Math.cos(ph) * p.crownHeight * 0.85);
    az.push(lz + r * Math.sin(ph) * Math.sin(th) * p.crownRadius * 0.8);
    alive.push(true);
  }

  const acc = { x: new Float32Array(0), y: new Float32Array(0), z: new Float32Array(0), n: new Int32Array(0) };
  let iterations = 0;

  for (let iter = 0; iter < 160; iter++) {
    iterations = iter + 1;
    const N = nodes.length;
    if (acc.x.length < N) {
      acc.x = new Float32Array(N * 2);
      acc.y = new Float32Array(N * 2);
      acc.z = new Float32Array(N * 2);
      acc.n = new Int32Array(N * 2);
    } else {
      acc.x.fill(0); acc.y.fill(0); acc.z.fill(0); acc.n.fill(0);
    }

    // each living attractor votes for its nearest node within sight
    let anyAlive = false;
    for (let k = 0; k < ax.length; k++) {
      if (!alive[k]) continue;
      anyAlive = true;
      let best = -1;
      let bestD = p.influence * p.influence;
      for (let i = 0; i < N; i++) {
        const dx = ax[k] - nodes[i].x, dy = ay[k] - nodes[i].y, dz = az[k] - nodes[i].z;
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bestD) { bestD = d; best = i; }
      }
      if (best >= 0) {
        const d = Math.sqrt(bestD) || 1;
        acc.x[best] += (ax[k] - nodes[best].x) / d;
        acc.y[best] += (ay[k] - nodes[best].y) / d;
        acc.z[best] += (az[k] - nodes[best].z) / d;
        acc.n[best]++;
      }
    }
    if (!anyAlive) break;

    // every node with votes grows one shoot toward the mean of its voters
    let grew = false;
    for (let i = 0; i < N; i++) {
      if (acc.n[i] === 0) continue;
      let gx = acc.x[i] / acc.n[i] + p.upBias * 0.5;
      let gy = acc.y[i] / acc.n[i] + p.upBias;
      let gz = acc.z[i] / acc.n[i];
      // symmetric attractor pairs can cancel to zero; a hashed nudge breaks the tie
      gx += (hash2(i, iter, p.seed) - 0.5) * 0.1;
      gz += (hash2(iter, i, p.seed) - 0.5) * 0.1;
      const len = Math.hypot(gx, gy, gz);
      if (len < 1e-5) continue;
      addNode(nodes[i].x + (gx / len) * p.step, nodes[i].y + (gy / len) * p.step, nodes[i].z + (gz / len) * p.step, i);
      grew = true;
    }
    if (!grew) break;

    // reached attractors die — this is what stops branches from piling up
    for (let k = 0; k < ax.length; k++) {
      if (!alive[k]) continue;
      for (let i = N; i < nodes.length; i++) {
        const dx = ax[k] - nodes[i].x, dy = ay[k] - nodes[i].y, dz = az[k] - nodes[i].z;
        if (dx * dx + dy * dy + dz * dz < p.kill * p.kill) {
          alive[k] = false;
          break;
        }
      }
    }
  }

  // pipe-model radii: tips are twigs, and a parent's cross-section carries the
  // sum of its children's (r^E adds, E ≈ 2.4 — Leonardo said 2, hydraulics
  // says a bit more)
  const E = 2.4;
  const TIP = 0.016;
  const accR = new Float32Array(nodes.length);
  for (let i = nodes.length - 1; i >= 0; i--) {
    const r = nodes[i].children === 0 ? TIP : Math.pow(accR[i], 1 / E);
    nodes[i].radius = r * params.thickness;
    if (nodes[i].parent >= 0) accR[nodes[i].parent] += Math.pow(r, E);
  }

  return { nodes, params, iterations };
}

// ---- the perch ledger ------------------------------------------------------------------

// What a landing bird needs to know about a branch: where, pointing which
// way, how thick, and how much open air sits above it. Computed from the
// skeleton, not the mesh — the wren will ask the tree, not the triangles.
export interface Perch {
  position: THREE.Vector3;
  tangent: THREE.Vector3; // along the branch, horizontal-ish
  radius: number;
  headroom: number; // clear distance straight up before the next branch
}

export function findPerches(
  skel: TreeSkeleton,
  opts: { minRadius?: number; maxRadius?: number; maxTilt?: number; minHeadroom?: number } = {},
): Perch[] {
  const minR = opts.minRadius ?? 0.018;
  const maxR = opts.maxRadius ?? 0.07;
  const maxTilt = opts.maxTilt ?? 0.5; // |dir.y| limit: birds don't land on flagpoles
  const minHead = opts.minHeadroom ?? 0.32;
  const out: Perch[] = [];
  const nodes = skel.nodes;

  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.parent < 0) continue;
    if (n.radius < minR || n.radius > maxR) continue;
    const par = nodes[n.parent];
    const dx = n.x - par.x, dy = n.y - par.y, dz = n.z - par.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    if (Math.abs(dy / len) > maxTilt) continue;

    // headroom: nearest node vertically above, within a small horizontal ring
    let head = 3;
    for (let j = 0; j < nodes.length; j++) {
      if (j === i) continue;
      const hx = nodes[j].x - n.x, hz = nodes[j].z - n.z;
      const hy = nodes[j].y - n.y;
      if (hy > 0.04 && hx * hx + hz * hz < 0.12 * 0.12) head = Math.min(head, hy);
    }
    if (head < minHead) continue;

    out.push({
      position: new THREE.Vector3(n.x, n.y + n.radius, n.z),
      tangent: new THREE.Vector3(dx / len, dy / len, dz / len),
      radius: n.radius,
      headroom: head,
    });
  }
  return out;
}

// ---- the mesh ---------------------------------------------------------------------------

const C_BARK_LO = new THREE.Color().setHex(0x4a3c2e, THREE.SRGBColorSpace);
const C_BARK_HI = new THREE.Color().setHex(0x77614a, THREE.SRGBColorSpace);
const C_LEAF_A = new THREE.Color().setHex(0x4d7a35, THREE.SRGBColorSpace);
const C_LEAF_B = new THREE.Color().setHex(0x86a843, THREE.SRGBColorSpace);

export interface TreeBuild {
  bark: THREE.BufferGeometry; // non-indexed, in growth order — drawRange animates growth
  leaves: THREE.BufferGeometry;
  perches: Perch[];
  segmentCount: number;
  leafCount: number;
}

const SIDES = 5; // pentagonal branches: low-poly enough to read as deliberate

export function buildTreeGeometry(skel: TreeSkeleton): TreeBuild {
  const nodes = skel.nodes;
  const segs: number[] = [];
  for (let i = 0; i < nodes.length; i++) if (nodes[i].parent >= 0) segs.push(i);

  const vPerSeg = SIDES * 6; // 5 quads = 10 triangles, non-indexed
  const bp = new Float32Array(segs.length * vPerSeg * 3);
  const bn = new Float32Array(segs.length * vPerSeg * 3);
  const bc = new Float32Array(segs.length * vPerSeg * 3);

  const up = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const side = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const c = new THREE.Color();
  const ringA: THREE.Vector3[] = [], ringB: THREE.Vector3[] = [];
  for (let s = 0; s < SIDES; s++) {
    ringA.push(new THREE.Vector3());
    ringB.push(new THREE.Vector3());
  }
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), fnorm = new THREE.Vector3();

  let v = 0;
  const maxDepth = nodes.reduce((m, n) => Math.max(m, n.depth), 1);

  for (let s2 = 0; s2 < segs.length; s2++) {
    const i = segs[s2];
    const n = nodes[i];
    const par = nodes[n.parent];
    dir.set(n.x - par.x, n.y - par.y, n.z - par.z).normalize();
    up.set(0, 1, 0);
    if (Math.abs(dir.y) > 0.95) up.set(1, 0, 0);
    side.crossVectors(dir, up).normalize();
    fwd.crossVectors(side, dir).normalize();

    // the child ring is rotated half a step — twisting the facets hides the
    // pentagon's seams and reads as bark grain
    for (let sct = 0; sct < SIDES; sct++) {
      const a0 = (sct / SIDES) * Math.PI * 2;
      const a1 = a0 + Math.PI / SIDES;
      ringA[sct].set(
        par.x + (Math.cos(a0) * side.x + Math.sin(a0) * fwd.x) * par.radius,
        par.y + (Math.cos(a0) * side.y + Math.sin(a0) * fwd.y) * par.radius,
        par.z + (Math.cos(a0) * side.z + Math.sin(a0) * fwd.z) * par.radius,
      );
      ringB[sct].set(
        n.x + (Math.cos(a1) * side.x + Math.sin(a1) * fwd.x) * n.radius,
        n.y + (Math.cos(a1) * side.y + Math.sin(a1) * fwd.y) * n.radius,
        n.z + (Math.cos(a1) * side.z + Math.sin(a1) * fwd.z) * n.radius,
      );
    }

    const tone = 0.85 + 0.3 * hash2(i, 13, skel.params.seed);
    c.copy(C_BARK_LO).lerp(C_BARK_HI, (n.depth / maxDepth) * 0.8).multiplyScalar(tone);

    for (let sct = 0; sct < SIDES; sct++) {
      const a = ringA[sct], b = ringA[(sct + 1) % SIDES];
      const d = ringB[sct], e = ringB[(sct + 1) % SIDES];
      // two flat triangles per quad, each with its honest face normal
      const tri = (p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3): void => {
        e1.subVectors(p1, p0);
        e2.subVectors(p2, p0);
        fnorm.crossVectors(e1, e2).normalize();
        for (const pt of [p0, p1, p2]) {
          bp[v * 3] = pt.x; bp[v * 3 + 1] = pt.y; bp[v * 3 + 2] = pt.z;
          bn[v * 3] = fnorm.x; bn[v * 3 + 1] = fnorm.y; bn[v * 3 + 2] = fnorm.z;
          bc[v * 3] = c.r; bc[v * 3 + 1] = c.g; bc[v * 3 + 2] = c.b;
          v++;
        }
      };
      tri(a, d, b);
      tri(b, d, e);
    }
  }

  const bark = new THREE.BufferGeometry();
  bark.setAttribute("position", new THREE.BufferAttribute(bp, 3));
  bark.setAttribute("normal", new THREE.BufferAttribute(bn, 3));
  bark.setAttribute("color", new THREE.BufferAttribute(bc, 3));

  // ---- leaves: a hash-dented icosahedron at every twig --------------------------------
  const ico = new THREE.IcosahedronGeometry(1, 0);
  const ipos = ico.getAttribute("position");
  const leafNodes: number[] = [];
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].children === 0 && nodes[i].depth > 3) leafNodes.push(i);
  }

  const lvPer = ipos.count; // already non-indexed: 60 verts, 20 faces
  const lp = new Float32Array(leafNodes.length * lvPer * 3);
  const ln = new Float32Array(leafNodes.length * lvPer * 3);
  const lc = new Float32Array(leafNodes.length * lvPer * 3);
  let lv = 0;
  const p0 = new THREE.Vector3(), p1 = new THREE.Vector3(), p2 = new THREE.Vector3();

  for (let k = 0; k < leafNodes.length; k++) {
    const n = nodes[leafNodes[k]];
    const scale = 0.16 + 0.18 * hash2(k, 17, skel.params.seed);
    const sy = scale * (0.7 + 0.4 * hash2(k, 29, skel.params.seed)); // squashed blobs read leafier
    c.copy(C_LEAF_A).lerp(C_LEAF_B, hash2(k, 41, skel.params.seed));

    for (let f = 0; f < lvPer; f += 3) {
      // dent each face's corners by a hash of the *face*, keeping it flat
      const read = (slot: number, out: THREE.Vector3): void => {
        const idx = f + slot;
        const dent = 1 + (hash2(k * 64 + f, 71 + slot, skel.params.seed) - 0.5) * 0.5;
        out.set(ipos.getX(idx) * scale * dent, ipos.getY(idx) * sy * dent, ipos.getZ(idx) * scale * dent);
        out.x += n.x;
        out.y += n.y + scale * 0.4;
        out.z += n.z;
      };
      read(0, p0); read(1, p1); read(2, p2);
      e1.subVectors(p1, p0);
      e2.subVectors(p2, p0);
      fnorm.crossVectors(e1, e2).normalize();
      const tone = 0.82 + 0.36 * hash2(f, k, skel.params.seed);
      for (const pt of [p0, p1, p2]) {
        lp[lv * 3] = pt.x; lp[lv * 3 + 1] = pt.y; lp[lv * 3 + 2] = pt.z;
        ln[lv * 3] = fnorm.x; ln[lv * 3 + 1] = fnorm.y; ln[lv * 3 + 2] = fnorm.z;
        lc[lv * 3] = c.r * tone; lc[lv * 3 + 1] = c.g * tone; lc[lv * 3 + 2] = c.b * tone;
        lv++;
      }
    }
  }

  const leaves = new THREE.BufferGeometry();
  leaves.setAttribute("position", new THREE.BufferAttribute(lp, 3));
  leaves.setAttribute("normal", new THREE.BufferAttribute(ln, 3));
  leaves.setAttribute("color", new THREE.BufferAttribute(lc, 3));

  return {
    bark,
    leaves,
    perches: findPerches(skel),
    segmentCount: segs.length,
    leafCount: leafNodes.length,
  };
}
