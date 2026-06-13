// Three ways to pull a surface out of the same 128³ field, in ascending order
// of opinion:
//
//   mtPass        — marching tetrahedra: each cell splits into six tets, each
//                   tet has sixteen sign cases you can write by hand (no
//                   4,096-entry table), each crossing makes 1–2 triangles.
//                   Triangle soup, appended with an atomic counter.
//   dcVertexPass  — the dual move: one vertex *per mixed cell*, placed at the
//                   mass point of its edge crossings (surface nets), then
//                   optionally relaxed toward the crossing planes (Schmitz-
//                   style iteration — dual contouring's QEF minimization
//                   without the matrix algebra). sharp = 0 is surface nets;
//                   sharp = 1 chases the planes' intersection: sharp features.
//   dcFacePass    — connectivity is not a table either: every field edge that
//                   crosses the surface strings a quad between the four cells
//                   that share it.
//   finalizePass  — one thread converts the counters into indirect-draw args.
//
// All normals come from the field gradient (central differences), oriented
// outward (-∇f, the field is high inside). Triangles are emitted unwound —
// the renderer doesn't cull and flips normals toward the eye, so neither
// extractor has to care about winding.

struct SurfParams {
  fieldN: u32,
  cells: u32,     // fieldN - 1
  maxVerts: u32,
  maxIdx: u32,
  threshold: f32, // in field units (fixed-point already divided out)
  fieldScale: f32,
  sharp: f32,     // 0 = surface nets, 1 = full plane-chasing
  iters: u32,     // relax iterations when sharp > 0
}

struct MeshVert {
  pos: vec4f,
  nrm: vec4f,
}

@group(0) @binding(0) var<uniform> SP: SurfParams;
@group(0) @binding(1) var<storage, read> field: array<u32>;
@group(0) @binding(2) var<storage, read_write> verts: array<MeshVert>;
@group(0) @binding(3) var<storage, read_write> vertCount: atomic<u32>;
@group(0) @binding(4) var<storage, read_write> cellVert: array<u32>;
@group(0) @binding(5) var<storage, read_write> indices: array<u32>;
@group(0) @binding(6) var<storage, read_write> idxCount: atomic<u32>;
@group(0) @binding(7) var<storage, read_write> indirect: array<u32, 12>;

const NONE: u32 = 0xffffffffu;

fn fieldAt(v: vec3i) -> f32 {
  let n = i32(SP.fieldN);
  let c = clamp(v, vec3i(0), vec3i(n - 1));
  let idx = (u32(c.z) * SP.fieldN + u32(c.y)) * SP.fieldN + u32(c.x);
  return f32(field[idx]) / SP.fieldScale;
}

fn gradAt(v: vec3i) -> vec3f {
  return vec3f(
    fieldAt(v + vec3i(1, 0, 0)) - fieldAt(v - vec3i(1, 0, 0)),
    fieldAt(v + vec3i(0, 1, 0)) - fieldAt(v - vec3i(0, 1, 0)),
    fieldAt(v + vec3i(0, 0, 1)) - fieldAt(v - vec3i(0, 0, 1)),
  );
}

fn worldOf(v: vec3i) -> vec3f {
  let voxel = 2.0 / f32(SP.fieldN);
  return -1.0 + (vec3f(v) + 0.5) * voxel;
}

// cube corner offsets, the usual order
fn cornerOffset(i: u32) -> vec3i {
  switch (i) {
    case 0u: { return vec3i(0, 0, 0); }
    case 1u: { return vec3i(1, 0, 0); }
    case 2u: { return vec3i(1, 1, 0); }
    case 3u: { return vec3i(0, 1, 0); }
    case 4u: { return vec3i(0, 0, 1); }
    case 5u: { return vec3i(1, 0, 1); }
    case 6u: { return vec3i(1, 1, 1); }
    default: { return vec3i(0, 1, 1); }
  }
}

// ---- marching tetrahedra ------------------------------------------------------------

fn emitTri(p0: vec3f, n0: vec3f, p1: vec3f, n1: vec3f, p2: vec3f, n2: vec3f) {
  let base = atomicAdd(&vertCount, 3u);
  if (base + 3u > SP.maxVerts) { return; }
  verts[base] = MeshVert(vec4f(p0, 0.0), vec4f(n0, 0.0));
  verts[base + 1u] = MeshVert(vec4f(p1, 0.0), vec4f(n1, 0.0));
  verts[base + 2u] = MeshVert(vec4f(p2, 0.0), vec4f(n2, 0.0));
}

// the six tetrahedra around the 0–6 diagonal
fn tetCorner(t: u32, k: u32) -> u32 {
  var tets = array<vec4u, 6>(
    vec4u(0u, 5u, 1u, 6u),
    vec4u(0u, 1u, 2u, 6u),
    vec4u(0u, 2u, 3u, 6u),
    vec4u(0u, 3u, 7u, 6u),
    vec4u(0u, 7u, 4u, 6u),
    vec4u(0u, 4u, 5u, 6u),
  );
  return tets[t][k];
}

@compute @workgroup_size(4, 4, 4)
fn mtPass(@builtin(global_invocation_id) gid: vec3u) {
  let n = SP.cells;
  if (gid.x >= n || gid.y >= n || gid.z >= n) { return; }
  let base = vec3i(gid);

  var f: array<f32, 8>;
  var mask = 0u;
  for (var i = 0u; i < 8u; i++) {
    f[i] = fieldAt(base + cornerOffset(i));
    if (f[i] > SP.threshold) { mask |= 1u << i; }
  }
  if (mask == 0u || mask == 255u) { return; }

  // gradients only for mixed cells — the early-out above pays for everything
  var p: array<vec3f, 8>;
  var g: array<vec3f, 8>;
  for (var i = 0u; i < 8u; i++) {
    let v = base + cornerOffset(i);
    p[i] = worldOf(v);
    g[i] = gradAt(v);
  }

  for (var t = 0u; t < 6u; t++) {
    var inIdx: array<u32, 4>;
    var outIdx: array<u32, 4>;
    var nin = 0u;
    var nout = 0u;
    for (var k = 0u; k < 4u; k++) {
      let c = tetCorner(t, k);
      if ((mask & (1u << c)) != 0u) { inIdx[nin] = c; nin++; }
      else { outIdx[nout] = c; nout++; }
    }
    if (nin == 0u || nin == 4u) { continue; }

    // crossing on the edge a(inside) → b(outside)
    // (computed inline below to keep everything in registers)
    if (nin == 1u || nin == 3u) {
      var a: u32;
      var bs: array<u32, 3>;
      if (nin == 1u) { a = inIdx[0]; bs[0] = outIdx[0]; bs[1] = outIdx[1]; bs[2] = outIdx[2]; }
      else { a = outIdx[0]; bs[0] = inIdx[0]; bs[1] = inIdx[1]; bs[2] = inIdx[2]; }
      var ep: array<vec3f, 3>;
      var en: array<vec3f, 3>;
      for (var k = 0u; k < 3u; k++) {
        let b = bs[k];
        let tt = clamp((SP.threshold - f[a]) / (f[b] - f[a] + 1e-9), 0.0, 1.0);
        ep[k] = mix(p[a], p[b], tt);
        en[k] = normalize(-mix(g[a], g[b], tt) + vec3f(1e-9));
      }
      emitTri(ep[0], en[0], ep[1], en[1], ep[2], en[2]);
    } else { // 2 in, 2 out: a quad across four edges
      var ep: array<vec3f, 4>;
      var en: array<vec3f, 4>;
      var k = 0u;
      for (var ii = 0u; ii < 2u; ii++) {
        for (var oo = 0u; oo < 2u; oo++) {
          let a = inIdx[ii];
          let b = outIdx[oo];
          let tt = clamp((SP.threshold - f[a]) / (f[b] - f[a] + 1e-9), 0.0, 1.0);
          ep[k] = mix(p[a], p[b], tt);
          en[k] = normalize(-mix(g[a], g[b], tt) + vec3f(1e-9));
          k++;
        }
      }
      // ring order: (i0,o0) (i0,o1) (i1,o1) (i1,o0) = ep[0] ep[1] ep[3] ep[2]
      emitTri(ep[0], en[0], ep[1], en[1], ep[3], en[3]);
      emitTri(ep[0], en[0], ep[3], en[3], ep[2], en[2]);
    }
  }
}

// ---- dual: one vertex per mixed cell -------------------------------------------------

fn edgeCorner(e: u32) -> vec2u {
  switch (e) {
    case 0u: { return vec2u(0u, 1u); }
    case 1u: { return vec2u(1u, 2u); }
    case 2u: { return vec2u(2u, 3u); }
    case 3u: { return vec2u(3u, 0u); }
    case 4u: { return vec2u(4u, 5u); }
    case 5u: { return vec2u(5u, 6u); }
    case 6u: { return vec2u(6u, 7u); }
    case 7u: { return vec2u(7u, 4u); }
    case 8u: { return vec2u(0u, 4u); }
    case 9u: { return vec2u(1u, 5u); }
    case 10u: { return vec2u(2u, 6u); }
    default: { return vec2u(3u, 7u); }
  }
}

@compute @workgroup_size(4, 4, 4)
fn dcVertexPass(@builtin(global_invocation_id) gid: vec3u) {
  let n = SP.cells;
  if (gid.x >= n || gid.y >= n || gid.z >= n) { return; }
  let base = vec3i(gid);
  let cellIdx = (gid.z * n + gid.y) * n + gid.x;

  var f: array<f32, 8>;
  var mask = 0u;
  for (var i = 0u; i < 8u; i++) {
    f[i] = fieldAt(base + cornerOffset(i));
    if (f[i] > SP.threshold) { mask |= 1u << i; }
  }
  if (mask == 0u || mask == 255u) {
    cellVert[cellIdx] = NONE;
    return;
  }

  var p: array<vec3f, 8>;
  var g: array<vec3f, 8>;
  for (var i = 0u; i < 8u; i++) {
    let v = base + cornerOffset(i);
    p[i] = worldOf(v);
    g[i] = gradAt(v);
  }

  // gather edge crossings: positions + outward plane normals
  var cp: array<vec3f, 12>;
  var cn: array<vec3f, 12>;
  var cnt = 0u;
  var nrmSum = vec3f(0.0);
  var mass = vec3f(0.0);
  for (var e = 0u; e < 12u; e++) {
    let ab = edgeCorner(e);
    let a = ab.x;
    let b = ab.y;
    let ina = (mask & (1u << a)) != 0u;
    let inb = (mask & (1u << b)) != 0u;
    if (ina == inb) { continue; }
    let tt = clamp((SP.threshold - f[a]) / (f[b] - f[a] + 1e-9), 0.0, 1.0);
    cp[cnt] = mix(p[a], p[b], tt);
    cn[cnt] = normalize(-mix(g[a], g[b], tt) + vec3f(1e-9));
    mass += cp[cnt];
    nrmSum += cn[cnt];
    cnt++;
  }
  var v = mass / f32(cnt); // surface nets: the mass point

  // dual contouring without the matrix: walk toward the crossing planes.
  // each iteration moves v by the mean plane-distance correction; sharp
  // scales the step, so 0 leaves the mass point untouched.
  if (SP.sharp > 0.001) {
    let lo = worldOf(base);
    let hi = worldOf(base + vec3i(1));
    for (var it = 0u; it < SP.iters; it++) {
      var corr = vec3f(0.0);
      for (var k = 0u; k < cnt; k++) {
        corr += cn[k] * dot(cp[k] - v, cn[k]);
      }
      v += corr * (SP.sharp / f32(cnt));
      v = clamp(v, lo, hi);
    }
  }

  let idx = atomicAdd(&vertCount, 1u);
  if (idx >= SP.maxVerts) {
    cellVert[cellIdx] = NONE;
    return;
  }
  verts[idx] = MeshVert(vec4f(v, 0.0), vec4f(normalize(nrmSum + vec3f(1e-9)), 0.0));
  cellVert[cellIdx] = idx;
}

// ---- dual: one quad per crossed field edge --------------------------------------------

fn cellVertAt(c: vec3i) -> u32 {
  let n = i32(SP.cells);
  if (any(c < vec3i(0)) || any(c >= vec3i(n))) { return NONE; }
  return cellVert[(u32(c.z) * SP.cells + u32(c.y)) * SP.cells + u32(c.x)];
}

fn emitQuad(c00: vec3i, c01: vec3i, c11: vec3i, c10: vec3i) {
  let v00 = cellVertAt(c00);
  let v01 = cellVertAt(c01);
  let v11 = cellVertAt(c11);
  let v10 = cellVertAt(c10);
  if (v00 == NONE || v01 == NONE || v11 == NONE || v10 == NONE) { return; }
  let base = atomicAdd(&idxCount, 6u);
  if (base + 6u > SP.maxIdx) { return; }
  indices[base] = v00;
  indices[base + 1u] = v01;
  indices[base + 2u] = v11;
  indices[base + 3u] = v00;
  indices[base + 4u] = v11;
  indices[base + 5u] = v10;
}

@compute @workgroup_size(4, 4, 4)
fn dcFacePass(@builtin(global_invocation_id) gid: vec3u) {
  let nf = SP.fieldN;
  if (gid.x >= nf || gid.y >= nf || gid.z >= nf) { return; }
  let v = vec3i(gid);
  let f0 = fieldAt(v) > SP.threshold;
  let x = v.x; let y = v.y; let z = v.z;

  // x-edge v → v+x̂: ringed by the four cells offset in y/z
  if (gid.x + 1u < nf) {
    let f1 = fieldAt(v + vec3i(1, 0, 0)) > SP.threshold;
    if (f0 != f1) {
      emitQuad(vec3i(x, y - 1, z - 1), vec3i(x, y - 1, z), vec3i(x, y, z), vec3i(x, y, z - 1));
    }
  }
  if (gid.y + 1u < nf) {
    let f1 = fieldAt(v + vec3i(0, 1, 0)) > SP.threshold;
    if (f0 != f1) {
      emitQuad(vec3i(x - 1, y, z - 1), vec3i(x - 1, y, z), vec3i(x, y, z), vec3i(x, y, z - 1));
    }
  }
  if (gid.z + 1u < nf) {
    let f1 = fieldAt(v + vec3i(0, 0, 1)) > SP.threshold;
    if (f0 != f1) {
      emitQuad(vec3i(x - 1, y - 1, z), vec3i(x - 1, y, z), vec3i(x, y, z), vec3i(x, y - 1, z));
    }
  }
}

// ---- counters → indirect draw args -----------------------------------------------------

@compute @workgroup_size(1)
fn finalizePass() {
  // [0..3]  non-indexed draw for the marching-tets soup
  indirect[0] = min(atomicLoad(&vertCount), SP.maxVerts);
  indirect[1] = 1u;
  indirect[2] = 0u;
  indirect[3] = 0u;
  // [4..8]  indexed draw for the dual mesh
  indirect[4] = min(atomicLoad(&idxCount), SP.maxIdx);
  indirect[5] = 1u;
  indirect[6] = 0u;
  indirect[7] = 0u;
  indirect[8] = 0u;
}
