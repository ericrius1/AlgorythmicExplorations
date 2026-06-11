// CPU-side physics used by the early demos: direct O(n²) forces, an adaptive
// quadtree, and a Barnes-Hut tree walk. Deliberately plain code — these are
// the versions quoted in the article.

import { G, type Bodies } from "./seed";

export interface SimParams {
  dt: number;
  softening: number;
}

// Direct summation: every body against every other body. O(n²).
// Returns the number of pair interactions computed (for the counter).
export function stepNaive(b: Bodies, p: SimParams): number {
  const { state, mass, count } = b;
  const eps2 = p.softening * p.softening;
  for (let i = 0; i < count; i++) {
    const xi = state[i * 4];
    const yi = state[i * 4 + 1];
    let ax = 0;
    let ay = 0;
    for (let j = 0; j < count; j++) {
      const dx = state[j * 4] - xi;
      const dy = state[j * 4 + 1] - yi;
      const r2 = dx * dx + dy * dy + eps2;
      const inv = (G * mass[j]) / (r2 * Math.sqrt(r2));
      ax += dx * inv;
      ay += dy * inv;
    }
    state[i * 4 + 2] += ax * p.dt;
    state[i * 4 + 3] += ay * p.dt;
  }
  for (let i = 0; i < count; i++) {
    state[i * 4] += state[i * 4 + 2] * p.dt;
    state[i * 4 + 1] += state[i * 4 + 3] * p.dt;
  }
  return count * count;
}

// ---------------------------------------------------------------------------
// Adaptive quadtree (flat arrays, no pointers-to-objects).

const MAX_DEPTH = 18;

export interface QuadTree {
  nodeCount: number;
  cx: Float64Array;
  cy: Float64Array;
  half: Float64Array;
  child: Int32Array; // 4 per node, -1 = none
  comX: Float64Array;
  comY: Float64Array;
  mass: Float64Array;
}

export function buildQuadTree(b: Bodies): QuadTree {
  const { state, mass, count } = b;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < count; i++) {
    const x = state[i * 4];
    const y = state[i * 4 + 1];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (!isFinite(minX)) {
    minX = -1; minY = -1; maxX = 1; maxY = 1;
  }
  const rootHalf = Math.max(maxX - minX, maxY - minY, 1e-6) * 0.5 * 1.0001;

  const cap = count * 4 + 64;
  const cx = new Float64Array(cap);
  const cy = new Float64Array(cap);
  const half = new Float64Array(cap);
  const child = new Int32Array(cap * 4).fill(-1);
  const body = new Int32Array(cap).fill(-1);
  cx[0] = (minX + maxX) * 0.5;
  cy[0] = (minY + maxY) * 0.5;
  half[0] = rootHalf;
  let next = 1;

  const quadrant = (px: number, py: number, ncx: number, ncy: number): number =>
    (px >= ncx ? 1 : 0) + (py >= ncy ? 2 : 0);

  for (let i = 0; i < count; i++) {
    const px = state[i * 4];
    const py = state[i * 4 + 1];
    let ni = 0;
    let depth = 0;
    for (;;) {
      if (child[ni * 4] === -1) {
        if (body[ni] === -1) {
          body[ni] = i;          // empty leaf: claim it
          break;
        }
        if (depth >= MAX_DEPTH || next + 4 > cap) break;
        const old = body[ni];    // occupied leaf: subdivide,
        body[ni] = -1;           // push the old occupant down
        const h = half[ni] * 0.5;
        for (let q = 0; q < 4; q++) {
          const c = next++;
          cx[c] = cx[ni] + ((q & 1) ? h : -h);
          cy[c] = cy[ni] + ((q & 2) ? h : -h);
          half[c] = h;
          child[ni * 4 + q] = c;
        }
        body[child[ni * 4 + quadrant(state[old * 4], state[old * 4 + 1], cx[ni], cy[ni])]] = old;
      }
      ni = child[ni * 4 + quadrant(px, py, cx[ni], cy[ni])];
      depth++;
    }
  }

  // Bottom-up pass: total mass + centre of mass per node.
  const comX = new Float64Array(next);
  const comY = new Float64Array(next);
  const m = new Float64Array(next);
  for (let ni = next - 1; ni >= 0; ni--) {
    if (child[ni * 4] === -1) {
      const bi = body[ni];
      if (bi >= 0) {
        m[ni] = mass[bi];
        comX[ni] = state[bi * 4];
        comY[ni] = state[bi * 4 + 1];
      }
    } else {
      let mm = 0;
      let mx = 0;
      let my = 0;
      for (let q = 0; q < 4; q++) {
        const c = child[ni * 4 + q];
        if (c >= 0 && m[c] > 0) {
          mm += m[c];
          mx += comX[c] * m[c];
          my += comY[c] * m[c];
        } else {
          child[ni * 4 + q] = -1;
        }
      }
      m[ni] = mm;
      comX[ni] = mm > 0 ? mx / mm : cx[ni];
      comY[ni] = mm > 0 ? my / mm : cy[ni];
    }
  }
  return { nodeCount: next, cx, cy, half, child, comX, comY, mass: m };
}

// Barnes-Hut force on one point. visit() reports every accepted node so the
// demos can draw what the walk did. Returns nodes accepted.
export function bhForce(
  tree: QuadTree,
  px: number,
  py: number,
  theta: number,
  softening: number,
  out: { ax: number; ay: number },
  visit?: (node: number) => void,
): number {
  const theta2 = theta * theta;
  const eps2 = softening * softening;
  let accepted = 0;
  out.ax = 0;
  out.ay = 0;
  const stack = [0];
  while (stack.length > 0) {
    const n = stack.pop()!;
    if (tree.mass[n] <= 0) continue;
    const dx = tree.comX[n] - px;
    const dy = tree.comY[n] - py;
    const r2 = dx * dx + dy * dy + eps2;
    const w = tree.half[n] * 2;
    const leaf = tree.child[n * 4] === -1;
    if (leaf || w * w < theta2 * r2) {
      const inv = (G * tree.mass[n]) / (r2 * Math.sqrt(r2));
      out.ax += dx * inv;
      out.ay += dy * inv;
      accepted++;
      visit?.(n);
    } else {
      for (let q = 0; q < 4; q++) {
        const c = tree.child[n * 4 + q];
        if (c >= 0) stack.push(c);
      }
    }
  }
  return accepted;
}

// Full Barnes-Hut step: rebuild tree, walk it once per body, integrate.
export function stepBarnesHut(b: Bodies, p: SimParams, theta: number): { tree: QuadTree; checks: number } {
  const tree = buildQuadTree(b);
  const { state, count } = b;
  const f = { ax: 0, ay: 0 };
  let checks = 0;
  for (let i = 0; i < count; i++) {
    checks += bhForce(tree, state[i * 4], state[i * 4 + 1], theta, p.softening, f);
    state[i * 4 + 2] += f.ax * p.dt;
    state[i * 4 + 3] += f.ay * p.dt;
  }
  for (let i = 0; i < count; i++) {
    state[i * 4] += state[i * 4 + 2] * p.dt;
    state[i * 4 + 1] += state[i * 4 + 3] * p.dt;
  }
  return { tree, checks };
}

// Canvas2d particle renderer shared by the CPU demos.
export function drawBodies(
  ctx: CanvasRenderingContext2D,
  b: Bodies,
  view: { scale: number },
  color = "rgba(140, 170, 255, 0.8)",
): void {
  const { width, height } = ctx.canvas;
  ctx.fillStyle = "#06070b";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = color;
  const s = (Math.min(width, height) / 2) * view.scale;
  const ox = width / 2;
  const oy = height / 2;
  for (let i = 0; i < b.count; i++) {
    const x = ox + b.state[i * 4] * s;
    const y = oy - b.state[i * 4 + 1] * s;
    ctx.fillRect(x, y, 1.5, 1.5);
  }
}
