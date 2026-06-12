// The bear's skin, written in TSL. Three materials share one trick — a vec4
// of bone indices and a vec4 of weights per vertex, blended against a uniform
// array of skin matrices, entirely in the vertex stage:
//   · the fur material (zone palette + noise grain + fresnel rim)
//   · the weight heatmap (part 2's x-ray of the rig)
//   · the ghost shell (part 2's see-through bear with the skeleton inside)
// Pass the same Matrix4[] the rig mutates and the GPU re-reads it every frame.

import * as THREE from "three/webgpu";
import {
  Fn, attribute, uniform, uniformArray, float, int, vec3, vec4, vertexColor,
  positionGeometry, normalGeometry, transformNormalToView,
  positionWorld, normalWorld, cameraPosition,
  mix, smoothstep, mx_noise_float,
} from "three/tsl";
import { DEFORM_BONES } from "./skeleton";

// @types/three loses the fluent node interface through attribute() and
// uniformArray().element(); these aliases put the swizzles and operators back.
import type { Node } from "three/webgpu";
type FloatNode = Node<"float">;
type Vec3Node = Node<"vec3">;
type Vec4Node = Node<"vec4">;
type Mat4Node = Node<"mat4">;
const vec4Attribute = (name: string): Vec4Node => attribute(name, "vec4") as unknown as Vec4Node;

// ---- palettes (zones: body, belly, muzzle, ear, paw, foot, tail) ---------------

export const PALETTES: Record<string, number[]> = {
  cinnamon: [0x8a5a3a, 0xb98c62, 0xc9a37a, 0x6b4226, 0x6e452c, 0x66402a, 0x9a6a44],
  panda: [0xf0ebdf, 0xf0ebdf, 0xf4f0e6, 0x2b2826, 0x2b2826, 0x2b2826, 0xf0ebdf],
  polar: [0xe9eef4, 0xf4f6f8, 0xdfe6ee, 0xd5dde8, 0xccd6e2, 0xc6d0dd, 0xf0f3f7],
  moon: [0x3a3331, 0xcfc3a8, 0x8c7458, 0x2e2927, 0x2e2927, 0x2e2927, 0x3a3331],
};
export const PALETTE_NAMES = Object.keys(PALETTES);

// ---- GPU skinning --------------------------------------------------------------

export interface SkinBinding {
  matrices: THREE.Matrix4[]; // one per deform bone; mutated in place by the rig
}

export function makeSkinMatrices(): THREE.Matrix4[] {
  return DEFORM_BONES.map(() => new THREE.Matrix4());
}

// Linear blend skinning: position' = Σᵢ wᵢ · Mᵢ · position. Four influences,
// indices and weights baked as attributes in build.ts.
function skinNodes(skin: SkinBinding) {
  const boneMats = uniformArray(skin.matrices);
  const idx = vec4Attribute("skinIndex");
  const wgt = vec4Attribute("skinWeight");
  const bone = (i: FloatNode): Mat4Node => boneMats.element(int(i)) as unknown as Mat4Node;
  const blend = (v: Vec4Node): Vec4Node =>
    bone(idx.x).mul(v).mul(wgt.x)
      .add(bone(idx.y).mul(v).mul(wgt.y))
      .add(bone(idx.z).mul(v).mul(wgt.z))
      .add(bone(idx.w).mul(v).mul(wgt.w));
  return {
    positionNode: blend(vec4(positionGeometry, 1)).xyz,
    normalNode: transformNormalToView(blend(vec4(normalGeometry, 0)).xyz.normalize()),
  };
}

function fresnel(power: number) {
  return Fn(() => {
    const viewDir = cameraPosition.sub(positionWorld).normalize();
    return float(1).sub(normalWorld.dot(viewDir).clamp(0, 1)).pow(power);
  })();
}

// ---- the fur material ----------------------------------------------------------

// Bake palette colors into the geometry's color attribute from its zone ids.
// Swapping the whole bear from cinnamon to panda is one buffer rewrite.
export function paintZones(geometry: THREE.BufferGeometry, palette: string): void {
  const zones = geometry.getAttribute("zone") as THREE.BufferAttribute;
  const colors = geometry.getAttribute("color") as THREE.BufferAttribute;
  const pal = (PALETTES[palette] ?? PALETTES.cinnamon).map((c) => new THREE.Color(c));
  for (let i = 0; i < zones.count; i++) {
    const c = pal[zones.getX(i)] ?? pal[0];
    colors.setXYZ(i, c.r, c.g, c.b);
  }
  colors.needsUpdate = true;
}

export interface BearMaterial {
  material: THREE.MeshPhysicalNodeMaterial;
  furScale: { value: number };
  furStrength: { value: number };
  rimStrength: { value: number };
}

export function createBearMaterial(skin: SkinBinding | null): BearMaterial {
  const material = new THREE.MeshPhysicalNodeMaterial();

  const furScale = uniform(26.0);
  const furStrength = uniform(0.16);
  const rimStrength = uniform(0.22);

  const base = (vertexColor() as unknown as Vec3Node).toVar();

  // Fur grain: two octaves of noise in *rest-pose* space, so the pattern is
  // glued to the body and deforms with it instead of swimming.
  const grain = mx_noise_float(positionGeometry.mul(furScale))
    .add(mx_noise_float(positionGeometry.mul(furScale.mul(3.13))).mul(0.4));
  const lit = base.mul(grain.mul(furStrength).add(1));

  // Belly-to-back gradient: a touch darker along the spine, lighter below.
  const tilt = smoothstep(-0.9, 0.9, normalWorld.y.negate().add(normalWorld.z.mul(0.4)));
  material.colorNode = mix(lit.mul(0.92), lit.mul(1.06), tilt);

  material.roughnessNode = float(0.88).sub(grain.mul(0.08));
  material.metalnessNode = float(0);
  // Sheen sells "fuzzy" better than any map: backlit edges catch the light.
  // (sheenNode carries color × intensity in one vec3.)
  material.sheenNode = base.mul(0.5);
  material.sheenRoughnessNode = float(0.6);
  material.emissiveNode = base.mul(fresnel(2.6)).mul(rimStrength);

  if (skin) {
    const nodes = skinNodes(skin);
    material.positionNode = nodes.positionNode;
    material.normalNode = nodes.normalNode;
  }

  return { material, furScale, furStrength, rimStrength };
}

// ---- the weight heatmap (part 2) ----------------------------------------------

export interface WeightMaterial {
  material: THREE.MeshBasicNodeMaterial;
  selectedBone: { value: number };
}

export function createWeightMaterial(skin: SkinBinding | null): WeightMaterial {
  const material = new THREE.MeshBasicNodeMaterial();
  const selectedBone = uniform(6); // a default arm bone reads well

  const idx = vec4Attribute("skinIndex");
  const wgt = vec4Attribute("skinWeight");
  const sel = selectedBone;
  const pick = (i: FloatNode, w: FloatNode) =>
    i.equal(sel.toFloat()).select(w, float(0));
  const w = pick(idx.x, wgt.x).add(pick(idx.y, wgt.y)).add(pick(idx.z, wgt.z)).add(pick(idx.w, wgt.w));

  // Cold steel → cyan → warm amber, with a hint of head-on lambert so the
  // shape still reads. sqrt stretches the low weights you actually debug.
  const t = w.sqrt();
  const cold = vec3(0.13, 0.15, 0.19);
  const mid = vec3(0.1, 0.65, 0.75);
  const hot = vec3(1.0, 0.72, 0.25);
  const ramp = mix(mix(cold, mid, smoothstep(0.0, 0.55, t)), hot, smoothstep(0.55, 1.0, t));
  const shade = transformNormalToView(normalGeometry).z.abs().mul(0.35).add(0.65);
  material.colorNode = ramp.mul(shade);

  if (skin) {
    const nodes = skinNodes(skin);
    material.positionNode = nodes.positionNode;
    // weight view keeps lighting fake, so no normal override needed beyond shade
  }

  return { material, selectedBone };
}

// ---- the ghost shell (x-ray bear) ----------------------------------------------

export function createGhostMaterial(skin: SkinBinding | null): THREE.MeshBasicNodeMaterial {
  const material = new THREE.MeshBasicNodeMaterial();
  material.transparent = true;
  material.depthWrite = false;
  material.side = THREE.FrontSide;
  material.colorNode = vec3(0.62, 0.74, 0.86);
  material.opacityNode = fresnel(1.8).mul(0.45).add(0.05);
  if (skin) {
    const nodes = skinNodes(skin);
    material.positionNode = nodes.positionNode;
  }
  return material;
}
