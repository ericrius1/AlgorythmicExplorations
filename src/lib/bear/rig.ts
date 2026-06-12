// The runtime skeleton. Eighteen joints, each owning one rotation; forward
// kinematics multiplies them root-to-leaf into world matrices, and the skin
// matrix for each bone is world × inverse(rest world) — "undo where the bone
// was born, apply where it is now". The resulting Matrix4[] is the same array
// the materials watch through a uniformArray.

import * as THREE from "three/webgpu";
import { DEFORM_BONES, DEFORM_INDEX, type BoneDef } from "./skeleton";

export interface Joint {
  name: string;
  parent: number; // index into the joint list, -1 for the root
  restOffset: THREE.Vector3; // head − parent head, rest pose
  tailOffset: THREE.Vector3; // tail − head, rest pose (the bone's own body)
  length: number;
  rotation: THREE.Quaternion; // the one animated quantity
  posOffset: THREE.Vector3; // translation on top (root sway, crouch)
}

export class Rig {
  readonly joints: Joint[];
  readonly world: THREE.Matrix4[];
  readonly bindInverse: THREE.Matrix4[];
  readonly skinMatrices: THREE.Matrix4[]; // shared with the GPU

  private tmpM = new THREE.Matrix4();
  private tmpV = new THREE.Vector3();

  constructor() {
    this.joints = DEFORM_BONES.map((b: BoneDef) => {
      const parent = b.parent ? (DEFORM_INDEX.get(b.parent) ?? -1) : -1;
      const pHead = parent >= 0 ? DEFORM_BONES[parent].head : [0, 0, 0];
      return {
        name: b.name,
        parent,
        restOffset: new THREE.Vector3(b.head[0] - pHead[0], b.head[1] - pHead[1], b.head[2] - pHead[2]),
        tailOffset: new THREE.Vector3(b.tail[0] - b.head[0], b.tail[1] - b.head[1], b.tail[2] - b.head[2]),
        length: new THREE.Vector3(b.tail[0] - b.head[0], b.tail[1] - b.head[1], b.tail[2] - b.head[2]).length(),
        rotation: new THREE.Quaternion(),
        posOffset: new THREE.Vector3(),
      };
    });
    this.world = this.joints.map(() => new THREE.Matrix4());
    this.skinMatrices = this.joints.map(() => new THREE.Matrix4());
    // Rest world transform is a pure translation to the joint head, so the
    // bind inverse is just a translation by −head.
    this.bindInverse = DEFORM_BONES.map((b) => new THREE.Matrix4().makeTranslation(-b.head[0], -b.head[1], -b.head[2]));
    this.update();
  }

  index(name: string): number {
    const i = DEFORM_INDEX.get(name);
    if (i === undefined) throw new Error(`no joint ${name}`);
    return i;
  }

  setEulerDeg(name: string, x: number, y: number, z: number): void {
    const j = this.joints[this.index(name)];
    j.rotation.setFromEuler(new THREE.Euler((x * Math.PI) / 180, (y * Math.PI) / 180, (z * Math.PI) / 180, "XYZ"));
  }

  reset(): void {
    for (const j of this.joints) {
      j.rotation.identity();
      j.posOffset.set(0, 0, 0);
    }
  }

  // Forward kinematics: world(child) = world(parent) · T(offset) · R(q).
  // Joints are stored parents-first, so one linear pass suffices.
  update(): void {
    for (let i = 0; i < this.joints.length; i++) {
      const j = this.joints[i];
      this.tmpV.copy(j.restOffset).add(j.posOffset);
      this.tmpM.compose(this.tmpV, j.rotation, ONE);
      if (j.parent >= 0) this.world[i].multiplyMatrices(this.world[j.parent], this.tmpM);
      else this.world[i].copy(this.tmpM);
      this.skinMatrices[i].multiplyMatrices(this.world[i], this.bindInverse[i]);
    }
  }

  jointPos(name: string, out = new THREE.Vector3()): THREE.Vector3 {
    return out.setFromMatrixPosition(this.world[this.index(name)]);
  }

  tailPos(name: string, out = new THREE.Vector3()): THREE.Vector3 {
    const i = this.index(name);
    return out.copy(this.joints[i].tailOffset).applyMatrix4(this.world[i]);
  }

  worldQuat(name: string, out = new THREE.Quaternion()): THREE.Quaternion {
    this.world[this.index(name)].decompose(this.tmpV, out, DECOMP_SCALE);
    return out;
  }

  // Rotation of the joint's *parent* frame — needed to express a desired
  // world direction in the space a joint's quaternion actually lives in.
  parentQuat(name: string, out = new THREE.Quaternion()): THREE.Quaternion {
    const p = this.joints[this.index(name)].parent;
    if (p < 0) return out.identity();
    this.world[p].decompose(this.tmpV, out, DECOMP_SCALE);
    return out;
  }
}

const ONE = new THREE.Vector3(1, 1, 1);
const DECOMP_SCALE = new THREE.Vector3();

// ---- skeleton x-ray ------------------------------------------------------------
// Bones drawn as stretched octahedra (the Blender look) plus joint beads.
// One instanced mesh each; update() re-poses them from the rig.

export class SkeletonViz {
  readonly group = new THREE.Group();
  private bones: THREE.InstancedMesh;
  private beads: THREE.InstancedMesh;
  private tmpM = new THREE.Matrix4();
  private tmpQ = new THREE.Quaternion();
  private tmpV = new THREE.Vector3();
  private tmpS = new THREE.Vector3();

  constructor(color = 0x7fd4ff) {
    const n = DEFORM_BONES.length;
    // octahedron pinched near the head: classic bone glyph
    const geo = new THREE.OctahedronGeometry(1);
    geo.applyMatrix4(new THREE.Matrix4().makeScale(0.06, 0.5, 0.06));
    geo.applyMatrix4(new THREE.Matrix4().makeTranslation(0, 0.5, 0));
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthTest: false });
    this.bones = new THREE.InstancedMesh(geo, mat, n);
    this.bones.renderOrder = 10;
    const beadMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthTest: false });
    this.beads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.018, 10, 8), beadMat, n);
    this.beads.renderOrder = 11;
    this.group.add(this.bones, this.beads);
  }

  update(rig: Rig): void {
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < rig.joints.length; i++) {
      const j = rig.joints[i];
      const head = this.tmpV.setFromMatrixPosition(rig.world[i]);
      const tail = j.tailOffset.clone().applyMatrix4(rig.world[i]);
      const dir = tail.clone().sub(head);
      const len = dir.length() || 0.001;
      this.tmpQ.setFromUnitVectors(up, dir.normalize());
      this.tmpS.set(1, len, 1);
      this.tmpM.compose(head, this.tmpQ, this.tmpS);
      this.bones.setMatrixAt(i, this.tmpM);
      this.tmpM.compose(head, IDENT_Q, ONE_V);
      this.beads.setMatrixAt(i, this.tmpM);
    }
    this.bones.instanceMatrix.needsUpdate = true;
    this.beads.instanceMatrix.needsUpdate = true;
  }
}

const IDENT_Q = new THREE.Quaternion();
const ONE_V = new THREE.Vector3(1, 1, 1);
