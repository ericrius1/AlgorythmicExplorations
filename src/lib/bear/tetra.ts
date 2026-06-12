// Marching tetrahedra: pull a triangle mesh out of any scalar field. The 3D
// cousin of the ferrofluid's marching squares — but where marching *cubes*
// needs a 256-row case table (and was patented until 2005; this variant was
// invented partly to dodge the license), a tetrahedron has only four corners,
// sixteen sign patterns, and three honest outcomes: nothing, one triangle, or
// a quad. Simple enough to write from scratch and be sure it's right.
//
// Each grid cube is carved into six tetrahedra around a shared body diagonal
// (so neighbouring cubes agree about their faces). Vertices land on tet edges
// where the field crosses zero, are welded by edge identity (so the mesh is
// watertight and shared between triangles), and are interpolated linearly —
// position t = d0 / (d0 - d1) along the edge.

export interface MarchResult {
  positions: Float32Array; // welded xyz triples
  indices: Uint32Array; // triangle list
  cells: number; // cubes visited (for the readout)
}

type Field = (x: number, y: number, z: number) => number;

// The six tets of a cube, as corner indices 0..7. All share the 0–6 diagonal.
//        7-------6        corners: 0=(0,0,0) 1=(1,0,0) 2=(1,1,0) 3=(0,1,0)
//       /|      /|                 4=(0,0,1) 5=(1,0,1) 6=(1,1,1) 7=(0,1,1)
//      3-------2 |
//      | 4-----|-5
//      |/      |/
//      0-------1
const TETS: [number, number, number, number][] = [
  [0, 1, 2, 6], [0, 2, 3, 6], [0, 3, 7, 6],
  [0, 7, 4, 6], [0, 4, 5, 6], [0, 5, 1, 6],
];

const CORNER_OFF: [number, number, number][] = [
  [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
  [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
];

export function marchTetra(
  field: Field,
  min: [number, number, number],
  max: [number, number, number],
  res: number, // cells along the longest axis
): MarchResult {
  const ext = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const longest = Math.max(ext[0], ext[1], ext[2]);
  const h = longest / res; // cube edge length
  const nx = Math.max(2, Math.round(ext[0] / h));
  const ny = Math.max(2, Math.round(ext[1] / h));
  const nz = Math.max(2, Math.round(ext[2] / h));
  const sx = nx + 1, sy = ny + 1, sz = nz + 1;

  // -- sample the field once at every grid corner --------------------------------
  const values = new Float32Array(sx * sy * sz);
  for (let iz = 0; iz < sz; iz++) {
    const z = min[2] + (ext[2] * iz) / nz;
    for (let iy = 0; iy < sy; iy++) {
      const y = min[1] + (ext[1] * iy) / ny;
      let o = iz * sx * sy + iy * sx;
      for (let ix = 0; ix < sx; ix++) {
        values[o + ix] = field(min[0] + (ext[0] * ix) / nx, y, z);
      }
    }
  }

  const positions: number[] = [];
  const indices: number[] = [];
  // One welded vertex per crossed edge, keyed by the edge's two corner ids.
  const edgeVerts = new Map<number, number>();
  const cornerCount = sx * sy * sz;

  const cornerPos = (g: number): [number, number, number] => {
    const ix = g % sx;
    const iy = ((g / sx) | 0) % sy;
    const iz = (g / (sx * sy)) | 0;
    return [min[0] + (ext[0] * ix) / nx, min[1] + (ext[1] * iy) / ny, min[2] + (ext[2] * iz) / nz];
  };

  const edgeVertex = (g0: number, g1: number): number => {
    const key = g0 < g1 ? g0 * cornerCount + g1 : g1 * cornerCount + g0;
    const found = edgeVerts.get(key);
    if (found !== undefined) return found;
    const d0 = values[g0], d1 = values[g1];
    const t = d0 / (d0 - d1); // where the field crosses zero along the edge
    const p0 = cornerPos(g0), p1 = cornerPos(g1);
    const idx = positions.length / 3;
    positions.push(p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t, p0[2] + (p1[2] - p0[2]) * t);
    edgeVerts.set(key, idx);
    return idx;
  };

  // Push a triangle wound so its normal points from inside toward outside —
  // checked against a reference direction (any vector from the inside region
  // out), so no field re-evaluation is needed.
  const emit = (a: number, b: number, c: number, refFrom: [number, number, number]): void => {
    const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2];
    const bx = positions[b * 3], by = positions[b * 3 + 1], bz = positions[b * 3 + 2];
    const cx = positions[c * 3], cy = positions[c * 3 + 1], cz = positions[c * 3 + 2];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nxx = uy * vz - uz * vy, nyy = uz * vx - ux * vz, nzz = ux * vy - uy * vx;
    const mx = (ax + bx + cx) / 3 - refFrom[0];
    const my = (ay + by + cy) / 3 - refFrom[1];
    const mz = (az + bz + cz) / 3 - refFrom[2];
    if (nxx * mx + nyy * my + nzz * mz >= 0) indices.push(a, b, c);
    else indices.push(a, c, b);
  };

  const g = new Array<number>(8); // global corner ids of the current cube
  let cells = 0;

  for (let iz = 0; iz < nz; iz++) {
    for (let iy = 0; iy < ny; iy++) {
      for (let ix = 0; ix < nx; ix++) {
        for (let c = 0; c < 8; c++) {
          const o = CORNER_OFF[c];
          g[c] = (ix + o[0]) + (iy + o[1]) * sx + (iz + o[2]) * sx * sy;
        }
        // Quick reject: all eight corners on the same side.
        let allIn = true, allOut = true;
        for (let c = 0; c < 8; c++) {
          if (values[g[c]] < 0) allOut = false;
          else allIn = false;
        }
        if (allIn || allOut) continue;
        cells++;

        for (const tet of TETS) {
          const t0 = g[tet[0]], t1 = g[tet[1]], t2 = g[tet[2]], t3 = g[tet[3]];
          let mask = 0;
          if (values[t0] < 0) mask |= 1;
          if (values[t1] < 0) mask |= 2;
          if (values[t2] < 0) mask |= 4;
          if (values[t3] < 0) mask |= 8;
          if (mask === 0 || mask === 15) continue;

          const corners = [t0, t1, t2, t3];
          const inside: number[] = [];
          const outside: number[] = [];
          for (let c = 0; c < 4; c++) (values[corners[c]] < 0 ? inside : outside).push(corners[c]);

          if (inside.length === 1) {
            // one triangle, capping the lone inside corner
            const a = inside[0];
            const ref = cornerPos(a);
            emit(edgeVertex(a, outside[0]), edgeVertex(a, outside[1]), edgeVertex(a, outside[2]), ref);
          } else if (inside.length === 3) {
            // one triangle, capping the lone outside corner (normal still outward)
            const b = outside[0];
            const v0 = edgeVertex(inside[0], b), v1 = edgeVertex(inside[1], b), v2 = edgeVertex(inside[2], b);
            const ip0 = cornerPos(inside[0]), ip1 = cornerPos(inside[1]), ip2 = cornerPos(inside[2]);
            emit(v0, v1, v2, [(ip0[0] + ip1[0] + ip2[0]) / 3, (ip0[1] + ip1[1] + ip2[1]) / 3, (ip0[2] + ip1[2] + ip2[2]) / 3]);
          } else {
            // two in, two out: a quad — four edge crossings, two triangles
            const [a0, a1] = inside;
            const [b0, b1] = outside;
            const p00 = edgeVertex(a0, b0), p01 = edgeVertex(a0, b1);
            const p10 = edgeVertex(a1, b0), p11 = edgeVertex(a1, b1);
            const A0 = cornerPos(a0), A1 = cornerPos(a1);
            const ref: [number, number, number] = [(A0[0] + A1[0]) / 2, (A0[1] + A1[1]) / 2, (A0[2] + A1[2]) / 2];
            emit(p00, p01, p11, ref);
            emit(p00, p11, p10, ref);
          }
        }
      }
    }
  }

  return { positions: new Float32Array(positions), indices: new Uint32Array(indices), cells };
}
