// Trees grown, not modeled. Space colonization (Runions et al. 2007): scatter
// attraction points where foliage could live, let branch tips grow toward the
// ones they can see, kill points as they're reached — branching emerges from
// competition for space, the way it does outdoors. Radii come from the pipe
// model (a parent carries the cross-section of its children), and the
// skeleton stays around after meshing so it can be queried (for perches:
// branches a bird could stand on).

import * as THREE from "three/webgpu";
import type { Node } from "three/webgpu";
import {
  attribute,
  positionLocal,
  positionGeometry,
  positionWorld,
  cameraPosition,
  normalWorldGeometry,
  sin,
  uniform,
  vec3,
  vec4,
  float,
  dot,
  normalize,
} from "three/tsl";
import { hash2 } from "./noise";
import type { Look } from "./look";

type F = Node<"float">;
type V3 = Node<"vec3">;

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
// skeleton, not the mesh — the bird will ask the tree, not the triangles.
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

// Bark is a ring of SIDES vertices around every node, joined to the ring
// around its parent, with smooth normals pointing straight out from the
// branch. It's non-indexed and stored in growth order, so drawing the first
// k vertices shows the tree as it was after the first few rounds of growth.
// Leaves are small diamond-shaped cards scattered along the thin twigs.
// Both carry aLight = (sun, occlusion), estimated from where each point sits
// in the crown: deep inside and on the far side from the sun is darker.

const C_BARK_LO = new THREE.Color().setHex(0x3e3226, THREE.SRGBColorSpace);
const C_BARK_HI = new THREE.Color().setHex(0x6b5a46, THREE.SRGBColorSpace);
const C_LEAF_A = new THREE.Color().setHex(0x3f6b2a, THREE.SRGBColorSpace);
const C_LEAF_B = new THREE.Color().setHex(0x7d9c3a, THREE.SRGBColorSpace);
const C_LEAF_C = new THREE.Color().setHex(0x9a9442, THREE.SRGBColorSpace);

export interface TreeBuild {
  bark: THREE.BufferGeometry; // non-indexed, in growth order — drawRange animates growth
  leaves: THREE.BufferGeometry;
  perches: Perch[];
  segmentCount: number;
  leafCount: number;
  crown: { x: number; y: number; z: number; r: number; top: number };
}

const SIDES = 6;
const DEFAULT_SUN = new THREE.Vector3(0.5, 0.45, -0.6).normalize();

export function buildTreeGeometry(skel: TreeSkeleton, opts: { sun?: THREE.Vector3; leafScale?: number } = {}): TreeBuild {
  const nodes = skel.nodes;
  const seed = skel.params.seed;
  const sun = opts.sun ?? DEFAULT_SUN;
  const segs: number[] = [];
  for (let i = 0; i < nodes.length; i++) if (nodes[i].parent >= 0) segs.push(i);

  // the crown: centroid and spread of the thin wood, where the leaves go
  let cx = 0, cy = 0, cz = 0, cn = 0, top = 0;
  for (const n of nodes) {
    top = Math.max(top, n.y);
    if (n.radius < 0.035 && n.depth > 2) { cx += n.x; cy += n.y; cz += n.z; cn++; }
  }
  cx /= cn || 1; cy /= cn || 1; cz /= cn || 1;
  let cr = 0;
  for (const n of nodes) if (n.radius < 0.035 && n.depth > 2) cr += Math.hypot(n.x - cx, (n.y - cy) * 1.3, n.z - cz);
  cr = Math.max(0.5, (cr / (cn || 1)) * 1.35);

  // light inside the crown: points on the sun side and near the surface see
  // the sun; points deep inside or behind it see less of both sun and sky
  const crownLight = (x: number, y: number, z: number): [number, number] => {
    const dx = x - cx, dy = (y - cy) * 1.3, dz = z - cz;
    const d = Math.hypot(dx, dy, dz) / cr;
    const toward = (dx * sun.x + dy * sun.y + dz * sun.z) / (Math.hypot(dx, dy, dz) || 1);
    const inside = Math.max(0, 1 - d);
    const sunVis = Math.min(1, Math.max(0.08, 0.55 + 0.6 * toward * Math.min(1, d) - 0.5 * inside));
    const ao = Math.min(1, Math.max(0.3, 0.35 + 0.75 * Math.min(1, d)));
    return [sunVis, ao];
  };

  const vPerSeg = SIDES * 6;
  const bp = new Float32Array(segs.length * vPerSeg * 3);
  const bn = new Float32Array(segs.length * vPerSeg * 3);
  const bc = new Float32Array(segs.length * vPerSeg * 3);
  const bl = new Float32Array(segs.length * vPerSeg * 2);

  const dir = new THREE.Vector3(), up = new THREE.Vector3(), side = new THREE.Vector3(), fwd = new THREE.Vector3();
  const c = new THREE.Color();
  const ring = (n: TreeNode, a: number, out: number[]): void => {
    const ca = Math.cos(a), sa = Math.sin(a);
    const ox = ca * side.x + sa * fwd.x, oy = ca * side.y + sa * fwd.y, oz = ca * side.z + sa * fwd.z;
    out[0] = n.x + ox * n.radius; out[1] = n.y + oy * n.radius; out[2] = n.z + oz * n.radius;
    out[3] = ox; out[4] = oy; out[5] = oz;
  };
  const A0: number[] = [], A1: number[] = [], B0: number[] = [], B1: number[] = [];
  const maxDepth = nodes.reduce((m, n) => Math.max(m, n.depth), 1);

  let v = 0;
  for (const i of segs) {
    const n = nodes[i];
    const par = nodes[n.parent];
    dir.set(n.x - par.x, n.y - par.y, n.z - par.z).normalize();
    up.set(0, 1, 0);
    if (Math.abs(dir.y) > 0.95) up.set(1, 0, 0);
    side.crossVectors(dir, up).normalize();
    fwd.crossVectors(side, dir).normalize();
    const tone = 0.85 + 0.3 * hash2(i, 13, seed);
    c.copy(C_BARK_LO).lerp(C_BARK_HI, (n.depth / maxDepth) * 0.8).multiplyScalar(tone);
    const [sv, ao] = crownLight(n.x, n.y, n.z);
    const baseAo = Math.min(1, 0.55 + n.y * 0.3); // a little darker at the foot of the trunk

    for (let k = 0; k < SIDES; k++) {
      const a0 = (k / SIDES) * Math.PI * 2, a1 = ((k + 1) / SIDES) * Math.PI * 2;
      ring(par, a0, A0); ring(par, a1, A1); ring(n, a0, B0); ring(n, a1, B1);
      for (const q of [A0, B0, A1, A1, B0, B1]) {
        bp[v * 3] = q[0]; bp[v * 3 + 1] = q[1]; bp[v * 3 + 2] = q[2];
        bn[v * 3] = q[3]; bn[v * 3 + 1] = q[4]; bn[v * 3 + 2] = q[5];
        bc[v * 3] = c.r; bc[v * 3 + 1] = c.g; bc[v * 3 + 2] = c.b;
        bl[v * 2] = sv; bl[v * 2 + 1] = ao * baseAo;
        v++;
      }
    }
  }

  const bark = new THREE.BufferGeometry();
  bark.setAttribute("position", new THREE.BufferAttribute(bp, 3));
  bark.setAttribute("normal", new THREE.BufferAttribute(bn, 3));
  bark.setAttribute("color", new THREE.BufferAttribute(bc, 3));
  bark.setAttribute("aLight", new THREE.BufferAttribute(bl, 2));

  // ---- leaves: diamond cards along the thin twigs ----------------------------------
  const scale = opts.leafScale ?? 1;
  const leafAt: { i: number; count: number }[] = [];
  let total = 0;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.parent < 0 || n.depth <= 3 || n.radius > 0.032) continue;
    const count = n.children === 0 ? 10 : 5 + Math.floor(hash2(i, 3, seed) * 4);
    leafAt.push({ i, count });
    total += count;
  }
  const lp = new Float32Array(total * 6 * 3);
  const ln = new Float32Array(total * 6 * 3);
  const lc = new Float32Array(total * 6 * 3);
  const ll = new Float32Array(total * 6 * 2);
  const lph = new Float32Array(total * 6);
  const P = new THREE.Vector3(), N = new THREE.Vector3(), U = new THREE.Vector3(), V = new THREE.Vector3(), O = new THREE.Vector3(), S = new THREE.Vector3();
  let lv = 0, leafCount = 0;
  for (const { i, count } of leafAt) {
    const n = nodes[i], par = nodes[n.parent];
    for (let k = 0; k < count; k++) {
      const h = (s: number): number => hash2(i * 16 + k, s, seed);
      const t = 0.3 + 0.7 * h(1);
      P.set(par.x + (n.x - par.x) * t, par.y + (n.y - par.y) * t, par.z + (n.z - par.z) * t);
      P.x += (h(2) - 0.5) * 0.12; P.y += (h(3) - 0.5) * 0.1; P.z += (h(4) - 0.5) * 0.12;
      O.set(P.x - cx, (P.y - cy) * 1.3, P.z - cz).normalize(); // outward from the crown
      N.set(O.x + (h(5) - 0.5) * 1.4, O.y + 0.6 + (h(6) - 0.5) * 1.2, O.z + (h(7) - 0.5) * 1.4).normalize();
      S.set(h(8) - 0.5, h(9) - 0.5, h(10) - 0.5);
      U.crossVectors(N, S).normalize();
      V.crossVectors(N, U).normalize();
      if (V.y < 0) V.negate(); // leaves point up and out, not down
      const len = (0.17 + 0.1 * h(11)) * scale, wid = len * (0.45 + 0.15 * h(12));
      const base = [P.x - V.x * len * 0.1, P.y - V.y * len * 0.1, P.z - V.z * len * 0.1];
      const tip = [P.x + V.x * len * 0.9, P.y + V.y * len * 0.9, P.z + V.z * len * 0.9];
      const mid = [P.x + V.x * len * 0.35, P.y + V.y * len * 0.35, P.z + V.z * len * 0.35];
      const left = [mid[0] - U.x * wid * 0.5, mid[1] - U.y * wid * 0.5, mid[2] - U.z * wid * 0.5];
      const right = [mid[0] + U.x * wid * 0.5, mid[1] + U.y * wid * 0.5, mid[2] + U.z * wid * 0.5];
      // shading normal: mostly the crown's outward direction, a little the leaf's own
      const sn = new THREE.Vector3().copy(O).multiplyScalar(0.7).addScaledVector(N, 0.3).normalize();
      const tone = 0.8 + 0.4 * h(13);
      c.copy(C_LEAF_A).lerp(C_LEAF_B, h(14)).lerp(C_LEAF_C, h(15) * h(15) * 0.6).multiplyScalar(tone);
      const [sv, ao] = crownLight(P.x, P.y, P.z);
      const phase = h(16) * Math.PI * 2;
      for (const q of [base, right, tip, base, tip, left]) {
        lp[lv * 3] = q[0]; lp[lv * 3 + 1] = q[1]; lp[lv * 3 + 2] = q[2];
        ln[lv * 3] = sn.x; ln[lv * 3 + 1] = sn.y; ln[lv * 3 + 2] = sn.z;
        lc[lv * 3] = c.r; lc[lv * 3 + 1] = c.g; lc[lv * 3 + 2] = c.b;
        ll[lv * 2] = sv; ll[lv * 2 + 1] = ao;
        lph[lv] = phase;
        lv++;
      }
      leafCount++;
    }
  }

  const leaves = new THREE.BufferGeometry();
  leaves.setAttribute("position", new THREE.BufferAttribute(lp, 3));
  leaves.setAttribute("normal", new THREE.BufferAttribute(ln, 3));
  leaves.setAttribute("color", new THREE.BufferAttribute(lc, 3));
  leaves.setAttribute("aLight", new THREE.BufferAttribute(ll, 2));
  leaves.setAttribute("aPhase", new THREE.BufferAttribute(lph, 1));

  return {
    bark,
    leaves,
    perches: findPerches(skel),
    segmentCount: segs.length,
    leafCount,
    crown: { x: cx, y: cy, z: cz, r: cr, top },
  };
}

// ---- materials: light and a little wind ----------------------------------------------------

export interface TreeMaterials {
  bark: THREE.MeshBasicNodeMaterial;
  leaves: THREE.MeshBasicNodeMaterial;
  time: { value: number };
  wind: { value: number };
}

// The whole tree leans with a slow gust field that travels across the
// forest (so neighbours sway together and distant trees don't), more at the
// top than the bottom; leaves add a quick flutter of their own.
export function makeTreeMaterials(look: Look): TreeMaterials {
  const time = uniform(0);
  const wind = uniform(1);
  const hy = positionGeometry.y.max(0); // height in the tree's own frame
  const at = positionLocal;
  const gust = sin(at.x.mul(0.21).add(at.z.mul(0.13)).add(time.mul(0.9)))
    .mul(0.6)
    .add(sin(at.x.mul(0.47).sub(at.z.mul(0.31)).add(time.mul(1.7))).mul(0.4));
  const sway = gust.mul(0.5).add(0.5).mul(hy.mul(hy)).mul(0.006).mul(wind);
  const swayVec = vec3(sway.mul(0.82), float(0), sway.mul(0.57));

  const bark = new THREE.MeshBasicNodeMaterial();
  bark.positionNode = at.add(swayVec);
  const barkLight = attribute("aLight", "vec2") as unknown as Node<"vec2">;
  bark.colorNode = vec4(look.lit(attribute("color", "vec3") as unknown as V3, normalWorldGeometry as unknown as V3, barkLight.x, barkLight.y), 1);

  const leaves = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  const phase = attribute("aPhase", "float") as unknown as F;
  const flutter = sin(time.mul(4.3).add(phase)).mul(0.012).mul(wind);
  leaves.positionNode = at.add(swayVec).add(vec3(flutter, flutter.mul(0.6), flutter.mul(-0.7)));
  const leafLight = attribute("aLight", "vec2") as unknown as Node<"vec2">;
  const albedo = attribute("color", "vec3") as unknown as V3;
  const diffuse = look.lit(albedo, normalWorldGeometry as unknown as V3, leafLight.x, leafLight.y, 0.35);
  const viewToFrag = normalize(positionWorld.sub(cameraPosition)) as unknown as V3;
  const back = dot(viewToFrag, look.uSunDir).max(0).pow(5).mul(leafLight.x);
  const through = albedo.mul(vec3(0.85, 1.2, 0.4)).mul(look.uSun).mul(back.mul(0.55));
  leaves.colorNode = vec4(diffuse.add(through), 1);

  return { bark, leaves, time, wind };
}
