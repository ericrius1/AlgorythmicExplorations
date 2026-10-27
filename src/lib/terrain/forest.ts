// Planting grown trees in a scene: a few variants, each drawn as one
// InstancedMesh for bark and one for leaves, plus soft crown shadows stamped
// into the ground's baked light so the trees sit on the terrain instead of
// floating over it.

import * as THREE from "three/webgpu";
import type { TreeBuild, TreeMaterials } from "./trees";

export interface TreeSpot {
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
  variant: number;
}

export function plantForest(variants: TreeBuild[], spots: TreeSpot[], mats: TreeMaterials): THREE.Group {
  const group = new THREE.Group();
  const m4 = new THREE.Matrix4();
  const sc = new THREE.Vector3();
  for (let v = 0; v < variants.length; v++) {
    const mine = spots.filter((s) => s.variant === v);
    if (mine.length === 0) continue;
    const bark = new THREE.InstancedMesh(variants[v].bark, mats.bark, mine.length);
    const leaves = new THREE.InstancedMesh(variants[v].leaves, mats.leaves, mine.length);
    mine.forEach((s, i) => {
      sc.setScalar(s.scale);
      m4.makeRotationY(s.yaw).scale(sc).setPosition(s.x, s.y, s.z);
      bark.setMatrixAt(i, m4);
      leaves.setMatrixAt(i, m4);
    });
    bark.frustumCulled = false;
    leaves.frustumCulled = false;
    group.add(bark, leaves);
  }
  return group;
}

// Darken the sun term of a light grid (interleaved sun, occlusion; cols ×
// rows from (x0, z0) with spacing `step`) under each crown: an ellipse
// pushed away from the sun and stretched along its direction, the way a low
// sun throws a long soft shadow.
export function stampTreeShadows(
  light: Float32Array,
  cols: number,
  rows: number,
  x0: number,
  z0: number,
  step: number,
  spots: TreeSpot[],
  variants: TreeBuild[],
  sun: THREE.Vector3,
  stride = 2,
): void {
  const hl = Math.hypot(sun.x, sun.z) || 1;
  const sx = sun.x / hl, sz = sun.z / hl;
  const rise = sun.y / hl;
  const stretch = Math.min(2.5, 1 / Math.max(0.2, sun.y));
  for (const s of spots) {
    const crown = variants[s.variant].crown;
    const r = crown.r * s.scale * 0.85;
    const lift = crown.y * s.scale;
    const reach = lift / Math.max(0.15, rise); // how far the crown's shadow lands from the trunk
    const ccx = s.x - sx * reach, ccz = s.z - sz * reach;
    const ra = r * stretch; // along the sun direction
    const ext = Math.max(ra, r) + step;
    const i0 = Math.max(0, Math.floor((ccx - ext - x0) / step)), i1 = Math.min(cols - 1, Math.ceil((ccx + ext - x0) / step));
    const j0 = Math.max(0, Math.floor((ccz - ext - z0) / step)), j1 = Math.min(rows - 1, Math.ceil((ccz + ext - z0) / step));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const dx = x0 + i * step - ccx, dz = z0 + j * step - ccz;
        const a = (dx * sx + dz * sz) / ra, b = (-dx * sz + dz * sx) / r;
        const d = Math.hypot(a, b);
        if (d >= 1) continue;
        const shade = (1 - d * d) * 0.72;
        const k = (i + j * cols) * stride;
        light[k] *= 1 - shade;
      }
    }
  }
}
