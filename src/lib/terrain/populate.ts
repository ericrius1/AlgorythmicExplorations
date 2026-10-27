// Turning the scatter rules' list of trees and rocks into things on screen:
// a few grown tree variants at a few levels of detail, a few rocks, and the
// series' shared materials. Parts five and six both plant through here.

import * as THREE from "three/webgpu";
import { growTree, buildTreeGeometry, makeTreeMaterials, TREE_DEFAULTS, type TreeBuild, type TreeMaterials } from "./trees";
import { buildRockGeometry, TREE_VARIANTS, type ScatterItem } from "./scatter";
import { plantForest, type TreeSpot } from "./forest";
import { litVertexColorMaterial, type Look } from "./look";

// Levels of detail for a grown tree: all the leaves and twigs, a third of
// the leaves (each larger) without the finest twigs, and a tenth of them
// for trees far enough away to be a silhouette.
export const TREE_LODS = [
  { leafKeep: 1, minTwig: 0 },
  { leafKeep: 0.33, minTwig: 0.022 },
  { leafKeep: 0.1, minTwig: 0.04 },
];

export interface PlantKit {
  variants: TreeBuild[][]; // [lod][variant]
  rocks: THREE.BufferGeometry[];
  treeMats: TreeMaterials;
  rockMat: THREE.MeshBasicNodeMaterial;
}

// The same six skeletons the part-four grove uses, meshed at every LOD.
export function makePlantKit(look: Look, lods: number[] = [0, 1, 2]): PlantKit {
  const skels = [];
  for (let k = 0; k < TREE_VARIANTS; k++) skels.push(growTree({ ...TREE_DEFAULTS, seed: 100 + k * 17, attractors: 300 + k * 30 }));
  const variants: TreeBuild[][] = [];
  for (let l = 0; l < TREE_LODS.length; l++) {
    variants.push(lods.includes(l) ? skels.map((sk) => buildTreeGeometry(sk, { sun: look.sunDir, ...TREE_LODS[l] })) : []);
  }
  const rocks: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 3; k++) rocks.push(buildRockGeometry(k));
  return { variants, rocks, treeMats: makeTreeMaterials(look), rockMat: litVertexColorMaterial(look) };
}

export interface Planting {
  group: THREE.Group;
  spots: TreeSpot[]; // the trees, for shadow stamping
  trees: number;
  rocks: number;
}

export function plantItems(kit: PlantKit, items: ScatterItem[], lod = 0): Planting {
  const spots: TreeSpot[] = items.filter((it) => it.kind === "tree");
  const group = plantForest(kit.variants[lod], spots, kit.treeMats);
  const m4 = new THREE.Matrix4();
  const sc = new THREE.Vector3();
  let rocks = 0;
  for (let v = 0; v < kit.rocks.length; v++) {
    const mine = items.filter((it) => it.kind === "rock" && it.variant === v);
    if (mine.length === 0) continue;
    rocks += mine.length;
    const rock = new THREE.InstancedMesh(kit.rocks[v], kit.rockMat, mine.length);
    mine.forEach((it, i) => {
      sc.setScalar(it.scale);
      m4.makeRotationY(it.yaw).scale(sc).setPosition(it.x, it.y, it.z);
      rock.setMatrixAt(i, m4);
    });
    rock.frustumCulled = false;
    group.add(rock);
  }
  return { group, spots, trees: spots.length, rocks };
}

export function disposePlanting(group: THREE.Group): void {
  group.traverse((o) => {
    if (o instanceof THREE.InstancedMesh) o.dispose();
  });
}
