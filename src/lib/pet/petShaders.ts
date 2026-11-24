// Weft / Loom / Mana-inspired custom TSL WebGPU shaders for Small Minds pets:
//   - makePlushSssMaterial : SDF vertex color + baked AO + backlit subsurface scattering +
//                            warm terminator wrap + cool violet shadow glaze + velvet rim + micro-fur grain
//   - addFurShells         : Mana-style extruded multi-shell procedural volumetric fur!
//   - makeBioSssMaterial   : Wet clearcoat + deep backlit SSS + iridescent Fresnel (Axolotl & Dumbo Jelly)
//   - makeJewelEyeMaterial : Deep procedural iris fibers, limbal ring, caustics & clearcoat cornea
//   - Artisan materials    : Brushed brass/gold, velvet silk, and HDR bloom-ready spirit glow

import * as THREE from "three/webgpu";
import type { Node } from "three/webgpu";

type F = Node<"float">;
export type FloatUniform = { value: number } & F;

const floatAttr = (name: string): F => attribute(name, "float") as unknown as F;
import {
  Fn,
  attribute,
  cameraPosition,
  clamp,
  color,
  dot,
  float,
  floor,
  fract,
  instanceIndex,
  length,
  max,
  mix,
  normalLocal,
  normalWorld,
  normalize,
  positionLocal,
  positionWorld,
  pow,
  saturate,
  sin,
  smoothstep,
  uniform,
  vec2,
  vec3,
  vertexColor,
} from "three/tsl";

// Shared reactive key-light direction uniform updated per environment!
export const uSanctuaryKeyDir = uniform(new THREE.Vector3(0.55, 0.72, 0.42).normalize());
export const uSanctuaryKeyColor = uniform(new THREE.Color(0xffe0b8));
export const uSanctuaryRimColor = uniform(new THREE.Color(0x88b4ff));

// Fast deterministic 3D hash & value noise in TSL (bind space: rides cleanly with the pet!)
const hash3 = Fn(([p]: [any]) => {
  return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))).mul(43758.5453));
});

const noise3 = Fn(([p]: [any]) => {
  const i = floor(p);
  const f = fract(p);
  const u = f.mul(f).mul(vec3(3.0).sub(f.mul(2.0)));
  const n000 = hash3(i);
  const n100 = hash3(i.add(vec3(1, 0, 0)));
  const n010 = hash3(i.add(vec3(0, 1, 0)));
  const n110 = hash3(i.add(vec3(1, 1, 0)));
  const n001 = hash3(i.add(vec3(0, 0, 1)));
  const n101 = hash3(i.add(vec3(1, 0, 1)));
  const n011 = hash3(i.add(vec3(0, 1, 1)));
  const n111 = hash3(i.add(vec3(1, 1, 1)));
  const nx00 = mix(n000, n100, u.x);
  const nx10 = mix(n010, n110, u.x);
  const nx01 = mix(n001, n101, u.x);
  const nx11 = mix(n011, n111, u.x);
  const nxy0 = mix(nx00, nx10, u.y);
  const nxy1 = mix(nx01, nx11, u.y);
  return mix(nxy0, nxy1, u.z);
});

// ---- 1. Plush Fur / Feather Subsurface Scattering Material -----------------

export interface PlushSssOptions {
  /** Base tint multiplied with vertex colors (or standalone color if useVertexColor=false) */
  baseColor?: number;
  /** Whether geometry carries SDF vertex colors + aAo + aThick attributes */
  useSdfAttrs?: boolean;
  /** Warm subsurface scattering transmission tint (e.g. warm peach 0xff8a65 or rose 0xff7096) */
  sssColor?: number;
  /** Overall backlit & wrap SSS intensity (default 0.72) */
  sssStrength?: number;
  /** Surface roughness (default 0.82 for soft plush) */
  roughness?: number;
  /** Velvet sheen strength (default 0.65) */
  sheen?: number;
  /** Bind-space micro-fur stroke grain frequency (default 34) */
  grainScale?: number;
  /** Optional dynamic pulse uniform (0..1) from live WebGPU attention */
  pulseUniform?: FloatUniform;
}

export function makePlushSssMaterial(opts: PlushSssOptions = {}): THREE.MeshPhysicalNodeMaterial {
  const mat = new THREE.MeshPhysicalNodeMaterial({
    roughness: opts.roughness ?? 0.82,
    metalness: 0.02,
    sheen: opts.sheen ?? 0.72,
    sheenRoughness: 0.62,
    sheenColor: new THREE.Color(opts.sssColor ?? 0xffe4d0),
  });

  const baseTint = color(opts.baseColor ?? 0xffffff);
  const sssCol = color(opts.sssColor ?? 0xff8c69);
  const sssStr = float(opts.sssStrength ?? 0.72);
  const grainScale = float(opts.grainScale ?? 38.0);
  const useSdf = opts.useSdfAttrs ?? true;

  // Albedo: vertex colors * subtle bind-space painterly fur strokes * baked SDF crease AO
  mat.colorNode = Fn(() => {
    const vc = useSdf ? vertexColor() : vec3(1.0);
    const ao = useSdf ? mix(float(0.46), float(1.0), attribute("aAo", "float")) : float(1.0);
    // Anisotropic fur stroke variation along vertical/lengthwise grain
    const n1 = noise3(positionLocal.mul(vec3(grainScale, grainScale.mul(0.55), grainScale)));
    const n2 = noise3(positionLocal.mul(grainScale.mul(2.4)).add(vec3(5.3, 1.7, 9.1)));
    const grain = float(0.91).add(n1.mul(0.11)).add(n2.mul(0.06));
    return vc.mul(baseTint).mul(grain).mul(ao);
  })();

  // Subsurface Scattering + Warm Terminator Wrap + Cool Lavender Shade Lift + Velvet Rim
  // (bringing sevenhavens/bison.wgsl + mana/people.wgsl lighting straight into TSL!)
  mat.emissiveNode = Fn(() => {
    const N = normalize(normalWorld);
    const V = normalize(cameraPosition.sub(positionWorld));
    const L = normalize(uSanctuaryKeyDir);
    const ndl = dot(N, L);
    const ndv = saturate(dot(N, V));
    const ao = useSdf ? mix(float(0.45), float(1.0), floatAttr("aAo")) : float(1.0);
    const thick = useSdf ? floatAttr("aThick") : float(0.35);

    // 1. Backlit Subsurface Transmission (light passing through thin ears, tufts, paws!)
    const backDir = normalize(L.negate().add(N.mul(0.45)));
    const backGlow = pow(saturate(dot(V, backDir)), float(2.8)).mul(thick.mul(0.85).add(0.15));

    // 2. Soft Warm Terminator Bleed (where direct light wraps around curved plush fur)
    const terminator = smoothstep(float(-0.42), float(0.15), ndl).mul(
      float(1.0).sub(smoothstep(float(0.05), float(0.55), ndl)),
    );
    const sss = sssCol
      .mul(backGlow.mul(0.46).add(terminator.mul(0.18)).mul(sssStr))
      .mul(uSanctuaryKeyColor)
      .mul(ao);

    // 3. Soft Velvet Rim Halo catching the sky/rim light along the fuzzy silhouette
    const fres = pow(float(1.0).sub(ndv), float(3.1));
    const rimLight = mix(uSanctuaryRimColor, sssCol, float(0.32)).mul(fres).mul(0.22).mul(ao);

    // 4. Subtle cool violet ambient lift in deep shadows so shadows feel painterly, never muddy
    const shadeMask = smoothstep(float(0.15), float(-0.55), ndl);
    const coolLift = vec3(0.032, 0.028, 0.072).mul(shadeMask).mul(ao);

    const pulse = opts.pulseUniform ? sssCol.mul(opts.pulseUniform).mul(fres).mul(0.3) : vec3(0.0);
    return sss.add(rimLight).add(coolLift).add(pulse);
  })();

  return mat;
}

// ---- 2. Mana-Inspired Layered Volumetric Fur Shells ------------------------

export interface FurShellOptions {
  /** Number of concentric extruded fur shells (default 5 — crisp fuzzy silhouette at 60fps!) */
  layers?: number;
  /** Max fur strand length in world units (default 0.022) */
  length?: number;
  /** Strand density in bind space (default 58) */
  density?: number;
  /** Warm subsurface / rim tint for fuzzy backlit tips */
  sssColor?: number;
  /** Groom droop vector in local space (default [0, -0.45, -0.35]) */
  groom?: [number, number, number];
  /** Optional tint multiplied over vertex color */
  tint?: number;
}

/**
 * Wraps an SDF-sculpted mesh in concentric translucent procedural fur shells
 * (inspired by mana/src/people/people.wgsl vs_shell / fs_shell).
 * Each shell extrudes along smoothed normal + groom lean and alpha-clips per-strand
 * dual-lattice filaments, darkening roots and brightening backlit velvet tips!
 */
export function addFurShells(
  parent: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  opts: FurShellOptions = {},
): THREE.Mesh[] {
  const layers = opts.layers ?? 5;
  const maxLen = opts.length ?? 0.02;
  const density = opts.density ?? 58.0;
  const groom = opts.groom ?? [0, -0.42, -0.3];
  const sssCol = color(opts.sssColor ?? 0xffe4cc);
  const tint = color(opts.tint ?? 0xffffff);
  const hasSdf = Boolean(geometry.getAttribute("aAo"));

  // Single instanced draw call & single TSL shader compile for ALL fur shells
  // (exact architecture of mana/src/people/people.wgsl vs_shell using instanceIndex!)
  const h = instanceIndex.toFloat().add(1.0).div(float(layers));

  const mat = new THREE.MeshStandardNodeMaterial({
    roughness: 0.9,
    metalness: 0.0,
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
  });

  mat.positionNode = Fn(() => {
    const n = normalize(normalLocal);
    const g = vec3(groom[0], groom[1], groom[2]);
    const push = n.add(g.mul(0.55)).mul(float(maxLen).mul(h));
    const droop = vec3(0, float(-maxLen * 0.25).mul(h).mul(h), 0);
    return positionLocal.add(push).add(droop);
  })();

  mat.opacityNode = Fn(() => {
    const p1 = positionLocal.mul(float(density));
    const p2 = vec3(
      p1.x.mul(0.81).add(p1.z.mul(0.59)),
      p1.y.mul(0.92).add(p1.x.mul(0.25)),
      p1.z.mul(0.81).sub(p1.x.mul(0.59)),
    ).add(vec3(11.3, 4.7, 7.1));

    const r1 = hash3(floor(p1));
    const r2 = hash3(floor(p2));
    const f1 = length(fract(p1).sub(0.5));
    const f2 = length(fract(p2).sub(0.5));

    const reach1 = float(0.45).add(r1.mul(0.65));
    const reach2 = float(0.45).add(r2.mul(0.65));
    const rad1 = float(0.45).mul(clamp(float(1.0).sub(h.div(reach1)), float(0.0), float(1.0)));
    const rad2 = float(0.45).mul(clamp(float(1.0).sub(h.div(reach2)), float(0.0), float(1.0)));

    const s1 = float(1.0).sub(smoothstep(rad1.mul(0.45), rad1.add(0.06), f1));
    const s2 = float(1.0).sub(smoothstep(rad2.mul(0.45), rad2.add(0.06), f2));
    const strand = max(s1, s2);
    const tipFade = float(1.0).sub(h.mul(0.42));
    return saturate(strand.mul(tipFade).mul(0.82));
  })();

  mat.colorNode = Fn(() => {
    const vc = hasSdf ? vertexColor() : vec3(1.0);
    const ao = hasSdf ? mix(float(0.5), float(1.0), floatAttr("aAo")) : float(1.0);
    const rootToTip = mix(float(0.78), float(1.08), h);
    return vc.mul(tint).mul(rootToTip).mul(ao);
  })();

  mat.emissiveNode = Fn(() => {
    const N = normalize(normalWorld);
    const V = normalize(cameraPosition.sub(positionWorld));
    const L = normalize(uSanctuaryKeyDir);
    const ndv = saturate(dot(N, V));
    const fres = pow(float(1.0).sub(ndv), float(2.4));
    const back = pow(saturate(dot(V, L.negate().add(N.mul(0.5)))), float(2.4));
    return sssCol.mul(fres.mul(0.24).add(back.mul(0.26))).mul(h).mul(uSanctuaryKeyColor);
  })();

  const inst = new THREE.InstancedMesh(geometry, mat, layers);
  const ident = new THREE.Matrix4();
  for (let i = 0; i < layers; i++) inst.setMatrixAt(i, ident);
  inst.instanceMatrix.needsUpdate = true;
  inst.renderOrder = 2;
  parent.add(inst);
  return [inst];
}

// ---- 3. Wet Translucent Bio-SSS + Iridescent Material (Axolotl & Jelly) ----

export interface BioSssOptions {
  baseColor?: number;
  useSdfAttrs?: boolean;
  sssColor: number;
  iridColor: number;
  sssStrength?: number;
  clearcoat?: number;
  roughness?: number;
  opacity?: number;
  pulseUniform?: FloatUniform;
}

export function makeBioSssMaterial(opts: BioSssOptions): THREE.MeshPhysicalNodeMaterial {
  const transparent = (opts.opacity ?? 1) < 0.99;
  const mat = new THREE.MeshPhysicalNodeMaterial({
    roughness: opts.roughness ?? 0.22,
    metalness: 0.04,
    clearcoat: opts.clearcoat ?? 0.88,
    clearcoatRoughness: 0.12,
    iridescence: 0.55,
    iridescenceIOR: 1.35,
    transparent,
    opacity: opts.opacity ?? 1.0,
    depthWrite: !transparent,
  });

  const baseTint = color(opts.baseColor ?? 0xffffff);
  const sssCol = color(opts.sssColor);
  const iridCol = color(opts.iridColor);
  const sssStr = float(opts.sssStrength ?? 1.05);
  const useSdf = opts.useSdfAttrs ?? true;

  mat.colorNode = Fn(() => {
    const vc = useSdf ? vertexColor() : vec3(1.0);
    const ao = useSdf ? mix(float(0.55), float(1.0), attribute("aAo", "float")) : float(1.0);
    return vc.mul(baseTint).mul(ao);
  })();

  mat.emissiveNode = Fn(() => {
    const N = normalize(normalWorld);
    const V = normalize(cameraPosition.sub(positionWorld));
    const L = normalize(uSanctuaryKeyDir);
    const ndv = saturate(dot(N, V));
    const thick = useSdf ? floatAttr("aThick") : float(0.65);

    // Deep backlit subsurface glow through translucent gills, fins, and jelly bell!
    const backDir = normalize(L.negate().add(N.mul(0.5)));
    const trans = pow(saturate(dot(V, backDir)), float(2.0)).mul(thick.mul(0.75).add(0.25));
    const fres = pow(float(1.0).sub(ndv), float(2.4));

    const caustic = noise3(positionLocal.mul(14.0)).mul(0.25).add(0.75);
    const bioGlow = sssCol.mul(trans.mul(0.7).add(thick.mul(0.18))).mul(sssStr);
    const iridRim = iridCol.mul(fres).mul(0.55).mul(caustic);
    const pulse = opts.pulseUniform ? iridCol.mul(opts.pulseUniform).mul(fres.add(0.25)).mul(0.85) : vec3(0.0);
    return bioGlow.add(iridRim).add(pulse);
  })();

  return mat;
}

// ---- 4. Studio Jewel Eye Material (Radial Iris + Limbal Ring + Caustics) ---

export function makeJewelEyeMaterial(
  irisHex: number,
  highlightHex: number,
  pupilRadius = 0.42,
): THREE.MeshPhysicalNodeMaterial {
  const mat = new THREE.MeshPhysicalNodeMaterial({
    roughness: 0.05,
    metalness: 0.05,
    clearcoat: 1.0,
    clearcoatRoughness: 0.03,
  });

  const irisCol = color(irisHex);
  const hiCol = color(highlightHex);

  // Expects an eye sphere centered at origin facing +Z with unit or arbitrary radius:
  // normalize(positionLocal).xy gives radial coordinate on the front cornea!
  mat.colorNode = Fn(() => {
    const dir = normalize(positionLocal);
    const r = length(dir.xy);
    const angle = dir.y.atan(dir.x);

    // Subtle radial iris fibers
    const fiber = sin(angle.mul(22.0)).mul(0.5).add(0.5).mul(0.16).add(0.88);
    // Warm caustic glow crescent in lower iris opposite top-right studio light
    const lowerGlow = smoothstep(float(0.1), float(-0.55), dir.y).mul(0.65);
    const baseIris = mix(irisCol, hiCol, lowerGlow).mul(fiber);

    // Dark crisp limbal ring around outer iris edge
    const limbal = smoothstep(float(0.62), float(0.78), r);
    const withRim = mix(baseIris, irisCol.mul(0.18), limbal);

    // Deep glossy obsidian pupil
    const pupilMask = smoothstep(float(pupilRadius + 0.04), float(pupilRadius - 0.03), r);
    const scleraMask = smoothstep(float(0.76), float(0.85), r);
    const eyeCol = mix(withRim, vec3(0.015, 0.018, 0.03), pupilMask);
    return mix(eyeCol, vec3(0.95, 0.94, 0.96), scleraMask);
  })();

  mat.emissiveNode = Fn(() => {
    const dir = normalize(positionLocal);
    const r = length(dir.xy);
    const inIris = smoothstep(float(pupilRadius - 0.02), float(pupilRadius + 0.06), r).mul(
      float(1.0).sub(smoothstep(float(0.65), float(0.78), r)),
    );
    const lowerGlow = smoothstep(float(0.08), float(-0.58), dir.y);
    // Crisp twin specular catchlights baked in cornea space so eyes always sparkle with life!
    const c1 = float(1.0).sub(smoothstep(float(0.11), float(0.16), length(dir.xy.sub(vec2(0.24, 0.27)))));
    const c2 = float(1.0).sub(smoothstep(float(0.05), float(0.085), length(dir.xy.sub(vec2(-0.22, -0.2)))));
    const catchlight = vec3(1.8, 1.85, 2.0).mul(max(c1, c2.mul(0.85))).mul(smoothstep(float(0.2), float(0.5), dir.z));
    return hiCol.mul(inIris).mul(lowerGlow).mul(0.55).add(catchlight);
  })();

  return mat;
}

// ---- 5. Artisan Adornment Materials (Brass, Silk, Crystal, HDR Spirit Glow) -

export function makeArtisanMetalMaterial(hex = 0xe6be68, roughness = 0.24): THREE.MeshPhysicalNodeMaterial {
  return new THREE.MeshPhysicalNodeMaterial({
    color: hex,
    roughness,
    metalness: 0.88,
    clearcoat: 0.35,
    clearcoatRoughness: 0.2,
  });
}

export function makeSilkFabricMaterial(hex: number, sheenHex = 0xffffff): THREE.MeshPhysicalNodeMaterial {
  return new THREE.MeshPhysicalNodeMaterial({
    color: hex,
    roughness: 0.62,
    metalness: 0.04,
    sheen: 0.9,
    sheenRoughness: 0.38,
    sheenColor: new THREE.Color(sheenHex),
  });
}

export function makeHdrGlowMaterial(
  hex: number,
  intensity = 1.65,
  pulseUniform?: FloatUniform,
): THREE.MeshStandardNodeMaterial {
  const mat = new THREE.MeshStandardNodeMaterial({
    color: hex,
    roughness: 0.18,
    metalness: 0.1,
  });
  const c = color(hex);
  const baseI = float(intensity);
  mat.emissiveNode = pulseUniform
    ? c.mul(baseI.add(pulseUniform.mul(1.3)))
    : c.mul(baseI);
  return mat;
}
