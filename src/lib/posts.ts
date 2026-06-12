// Every post on the site, in reading order. The nav, the menus, and the
// read-next cards are all generated from this one list.

export const SITE_NAME = "Algorythmic Explorations";
export const SITE_REPO = "https://github.com/ericrius1/AlgorythmicExplorations";

export interface Post {
  href: string;
  series: string;
  part: number;
  title: string;
  subtitle: string;
}

// One-line pitch per series, in site order — the landing page is built from
// these plus POSTS.
export const SERIES_TAGLINES: Record<string, string> = {
  "Particle Worlds":
    "A step-by-step n-body simulation, from two falling dots to 300,000 gravitating bodies.",
  "Bounced Light":
    "Light transport through radiance cascades, participating media, sphere tracing, path tracing, and spectral refraction.",
  "Strange Matter":
    "A magnetic liquid simulation whose surface is reconstructed every frame.",
  "Living Music":
    "Interactive explanations of sound, tuning, scales, chords, rhythm, and generative accompaniment.",
  "Waking Bodies":
    "A procedural bear modeled from triangles, rigged by distance, and animated with inverse kinematics and springs.",
  "Feather & Bone":
    "A low-poly bird modeled from capsules, rigged, animated, and flown with a simple aerodynamic model.",
  "Ground Truth":
    "Procedural terrain built from noise, erosion, instanced grass, trees, biomes, and streamed chunks.",
};

export const POSTS: Post[] = [
  {
    href: "/part1.html",
    series: "Particle Worlds",
    part: 1,
    title: "Two Falling Dots",
    subtitle: "From two falling dots to 300,000 gravitating bodies",
  },
  {
    href: "/part2.html",
    series: "Particle Worlds",
    part: 2,
    title: "Gravity on a Dome",
    subtitle: "Extending the simulation to 3D with octrees and particle rendering",
  },
  {
    href: "/part3.html",
    series: "Particle Worlds",
    part: 3,
    title: "Sorting Water",
    subtitle: "Neighbour search, dry sand, and 80,000 particles of water",
  },
  {
    href: "/part4.html",
    series: "Particle Worlds",
    part: 4,
    title: "Worlds from Dust",
    subtitle: "Accretion in a debris disc using gravity, collisions, and dissipation",
  },
  {
    href: "/part5.html",
    series: "Particle Worlds",
    part: 5,
    title: "Gravity in Frequency Space",
    subtitle: "Particle-mesh cosmology from measured initial density fluctuations",
  },
  {
    href: "/part6.html",
    series: "Particle Worlds",
    part: 6,
    title: "The Fluid Instrument",
    subtitle: "Stable fluids, curl noise, particle trails, and hand tracking",
  },
  {
    href: "/lava.html",
    series: "Bounced Light",
    part: 1,
    title: "The Lava Lamp",
    subtitle: "Temperature-driven SPH illuminated by radiance cascades",
  },
  {
    href: "/bonfire.html",
    series: "Bounced Light",
    part: 2,
    title: "The Bonfire",
    subtitle: "Thousands of ember lights, temporal multi-bounce, and environment lighting",
  },
  {
    href: "/fog.html",
    series: "Bounced Light",
    part: 3,
    title: "The Fog",
    subtitle: "Participating media, Beer-Lambert extinction, and visible light shafts",
  },
  {
    href: "/flatland.html",
    series: "Bounced Light",
    part: 4,
    title: "Leaving Flatland",
    subtitle: "3D distance fields, sphere tracing, surface normals, and soft shadows",
  },
  {
    href: "/cornell.html",
    series: "Bounced Light",
    part: 5,
    title: "The Cornell Box",
    subtitle: "The rendering equation, Monte Carlo integration, and next-event estimation",
  },
  {
    href: "/prism.html",
    series: "Bounced Light",
    part: 6,
    title: "The Prism",
    subtitle: "Refraction, dispersion, spectral color, caustics, and depth of field",
  },
  {
    href: "/ferro.html",
    series: "Strange Matter",
    part: 1,
    title: "The Ferrofluid",
    subtitle: "Magnetic SPH and a surface reconstructed with marching squares every frame",
  },
  {
    href: "/vibration.html",
    series: "Living Music",
    part: 1,
    title: "The Anatomy of a Note",
    subtitle: "Pitch, loudness, and timbre explained with oscillators and one vibrating string",
  },
  {
    href: "/harmony.html",
    series: "Living Music",
    part: 2,
    title: "Consonance and Roughness",
    subtitle: "Beats, whole-number ratios, harmonic alignment, and consonance",
  },
  {
    href: "/twelve.html",
    series: "Living Music",
    part: 3,
    title: "Twelve Imperfect Notes",
    subtitle: "The Pythagorean comma, temperament, and the twelve-note equal division",
  },
  {
    href: "/scales.html",
    series: "Living Music",
    part: 4,
    title: "Seven of Twelve",
    subtitle: "Scales as step patterns, modes as rotations, and the circle of fifths as a map of keys",
  },
  {
    href: "/chords.html",
    series: "Living Music",
    part: 5,
    title: "Major and Minor",
    subtitle: "Triad construction, functional harmony, and voice leading",
  },
  {
    href: "/jukebox.html",
    series: "Living Music",
    part: 6,
    title: "The Infinite Jukebox",
    subtitle: "Euclidean rhythm, random-walk melody, voice leading, and generative form",
  },
  {
    href: "/accompanist.html",
    series: "Living Music",
    part: 7,
    title: "The Accompanist",
    subtitle: "Real-time key estimation, chord inference, voice leading, and generated accompaniment",
  },
  {
    href: "/bear.html",
    series: "Waking Bodies",
    part: 1,
    title: "The Bear",
    subtitle: "A procedural character lofted from vertex rings, stitched into triangles, and shaded in TSL",
  },
  {
    href: "/rig.html",
    series: "Waking Bodies",
    part: 2,
    title: "The Skeleton",
    subtitle: "A bone hierarchy, proximity-based skin weights, and linear blend skinning",
  },
  {
    href: "/reach.html",
    series: "Waking Bodies",
    part: 3,
    title: "The Reach",
    subtitle: "Two-bone inverse kinematics, pole vectors, gaze constraints, and FABRIK",
  },
  {
    href: "/qigong.html",
    series: "Waking Bodies",
    part: 4,
    title: "The Form",
    subtitle: "Poses as targets, springs as blends, and layered procedural motion",
  },
  {
    href: "/wren.html",
    series: "Feather & Bone",
    part: 1,
    title: "The Wren",
    subtitle: "A songbird modeled from capsules with smooth unions and surface nets",
  },
  {
    href: "/bones.html",
    series: "Feather & Bone",
    part: 2,
    title: "The Bones",
    subtitle: "Seventeen joints, proximity-based skin weights, and procedural idle motion",
  },
  {
    href: "/wingbeat.html",
    series: "Feather & Bone",
    part: 3,
    title: "The Wingbeat",
    subtitle: "The law of cosines unfolds the wing; an asymmetric clock drives the wingbeat",
  },
  {
    href: "/flight.html",
    series: "Feather & Bone",
    part: 4,
    title: "Flight",
    subtitle: "Lift, drag, weight, and flap thrust integrated every frame",
  },
  {
    href: "/landing.html",
    series: "Feather & Bone",
    part: 5,
    title: "The Landing",
    subtitle: "Guidance laws, a landing flare, procedural perches, and a two-voiced syrinx",
  },
  {
    href: "/sky.html",
    series: "Feather & Bone",
    part: 6,
    title: "The Sky",
    subtitle: "The simulated wren and streamed terrain combined in one manual or autopilot demo",
  },
  {
    href: "/heightfield.html",
    series: "Ground Truth",
    part: 1,
    title: "The Heightfield",
    subtitle: "Hashed gradient noise, fractal sums, ridges, domain warping, and heightfield meshes",
  },
  {
    href: "/erosion.html",
    series: "Ground Truth",
    part: 2,
    title: "The Rain",
    subtitle: "Hydraulic erosion turns procedural noise into connected drainage networks",
  },
  {
    href: "/grass.html",
    series: "Ground Truth",
    part: 3,
    title: "The Grass",
    subtitle: "A hundred thousand instanced blades placed from sediment and animated in the vertex shader",
  },
  {
    href: "/trees.html",
    series: "Ground Truth",
    part: 4,
    title: "The Trees",
    subtitle: "Space colonization, pipe-model thickness, low-poly meshes, and indexed perches",
  },
  {
    href: "/biomes.html",
    series: "Ground Truth",
    part: 5,
    title: "The Biomes",
    subtitle: "A moisture field, biome classification, and deterministic placement of a million plants",
  },
  {
    href: "/horizon.html",
    series: "Ground Truth",
    part: 6,
    title: "The Horizon",
    subtitle: "Chunks, LOD rings, skirts, and a millisecond build budget for continuous terrain streaming",
  },
];

export function currentPost(): { post: Post | null; index: number } {
  let file = location.pathname.split("/").pop() || "index.html";
  if (file === "") file = "index.html";
  const index = POSTS.findIndex((p) => p.href === `/${file}`);
  return { post: index >= 0 ? POSTS[index] : null, index };
}
