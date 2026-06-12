// Surface nets: the dual way to polygonize a field. Marching cubes puts
// vertices on cell edges and consults a 256-case table; surface nets puts one
// vertex *inside* every cell the surface passes through (at the average of
// its edge crossings) and then connects neighbors: every lattice edge that
// crosses the surface is shared by four cells, and those four cells' vertices
// make a quad. No tables, no cases — just neighbors agreeing to hold hands.

export interface NetsResult {
  positions: Float32Array;
  indices: Uint32Array;
  cells: number; // cells that produced a vertex
  samples: number; // field evaluations
}

// Corner offsets of a cell, in (x, y, z) ∈ {0, 1}³.
const CORNERS: [number, number, number][] = [
  [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0],
  [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
];

// The 12 cell edges as corner-index pairs.
const EDGES: [number, number][] = [
  [0, 1], [2, 3], [4, 5], [6, 7], // x-directed
  [0, 2], [1, 3], [4, 6], [5, 7], // y-directed
  [0, 4], [1, 5], [2, 6], [3, 7], // z-directed
];

export function surfaceNets(
  field: (x: number, y: number, z: number) => number,
  min: [number, number, number],
  max: [number, number, number],
  res: number,
): NetsResult {
  const ex = max[0] - min[0], ey = max[1] - min[1], ez = max[2] - min[2];
  const cell = Math.max(ex, ey, ez) / res;
  const nx = Math.max(1, Math.round(ex / cell));
  const ny = Math.max(1, Math.round(ey / cell));
  const nz = Math.max(1, Math.round(ez / cell));
  const sx = ex / nx, sy = ey / ny, sz = ez / nz;

  // -- sample the field once at every lattice point --------------------------------
  const SX = nx + 1, SY = ny + 1, SZ = nz + 1;
  const values = new Float32Array(SX * SY * SZ);
  let s = 0;
  for (let k = 0; k < SZ; k++) {
    const z = min[2] + k * sz;
    for (let j = 0; j < SY; j++) {
      const y = min[1] + j * sy;
      for (let i = 0; i < SX; i++) {
        values[s++] = field(min[0] + i * sx, y, z);
      }
    }
  }
  const sample = (i: number, j: number, k: number): number => values[i + SX * (j + SY * k)];

  // -- one vertex per crossed cell: the average of its edge crossings --------------
  const cellVert = new Int32Array(nx * ny * nz).fill(-1);
  const positions: number[] = [];
  let cells = 0;
  const corner = new Float32Array(8);
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          const [ci, cj, ck] = CORNERS[c];
          const v = sample(i + ci, j + cj, k + ck);
          corner[c] = v;
          if (v < 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 0xff) continue;

        let px = 0, py = 0, pz = 0, n = 0;
        for (const [a, b] of EDGES) {
          const va = corner[a], vb = corner[b];
          if (va < 0 === vb < 0) continue;
          const t = va / (va - vb || 1e-12);
          const [ax, ay, az] = CORNERS[a];
          const [bx, by, bz] = CORNERS[b];
          px += ax + (bx - ax) * t;
          py += ay + (by - ay) * t;
          pz += az + (bz - az) * t;
          n++;
        }
        cellVert[i + nx * (j + ny * k)] = positions.length / 3;
        positions.push(
          min[0] + (i + px / n) * sx,
          min[1] + (j + py / n) * sy,
          min[2] + (k + pz / n) * sz,
        );
        cells++;
      }
    }
  }

  // -- faces: every crossed lattice edge stitches its four neighbor cells ----------
  const indices: number[] = [];
  const cv = (i: number, j: number, k: number): number => cellVert[i + nx * (j + ny * k)];
  const quad = (a: number, b: number, c: number, d: number, flip: boolean): void => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) indices.push(a, d, c, a, c, b);
    else indices.push(a, b, c, a, c, d);
  };
  for (let k = 0; k < SZ; k++) {
    for (let j = 0; j < SY; j++) {
      for (let i = 0; i < SX; i++) {
        const v0 = sample(i, j, k);
        // x-directed lattice edge (i,j,k)–(i+1,j,k)
        if (i < nx && j > 0 && j < ny && k > 0 && k < nz) {
          const v1 = sample(i + 1, j, k);
          if (v0 < 0 !== v1 < 0) {
            quad(cv(i, j - 1, k - 1), cv(i, j, k - 1), cv(i, j, k), cv(i, j - 1, k), v0 < 0);
          }
        }
        // y-directed lattice edge (i,j,k)–(i,j+1,k)
        if (j < ny && i > 0 && i < nx && k > 0 && k < nz) {
          const v1 = sample(i, j + 1, k);
          if (v0 < 0 !== v1 < 0) {
            quad(cv(i - 1, j, k - 1), cv(i - 1, j, k), cv(i, j, k), cv(i, j, k - 1), v0 < 0);
          }
        }
        // z-directed lattice edge (i,j,k)–(i,j,k+1)
        if (k < nz && i > 0 && i < nx && j > 0 && j < ny) {
          const v1 = sample(i, j, k + 1);
          if (v0 < 0 !== v1 < 0) {
            quad(cv(i - 1, j - 1, k), cv(i, j - 1, k), cv(i, j, k), cv(i - 1, j, k), v0 < 0);
          }
        }
      }
    }
  }

  return {
    positions: Float32Array.from(positions),
    indices: Uint32Array.from(indices),
    cells,
    samples: values.length,
  };
}
