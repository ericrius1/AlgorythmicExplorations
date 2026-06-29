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
  "Firework Systems":
    "A WebGPU fireworks renderer designed around GPU-owned particles, compact emit commands, and live-list drawing.",
  "Dome Projection":
    "Fulldome projection math from polar coordinates to fisheye maps, projector cameras, calibrated blends, and realtime render paths.",
  "Bounced Light":
    "Light transport through radiance cascades, participating media, sphere tracing, path tracing, and spectral refraction.",
  "Strange Matter":
    "A magnetic liquid that grows spikes — its surface remeshed every frame, its particles taught to magnetize each other.",
  "Living Music":
    "Interactive explanations of sound, tuning, scales, chords, rhythm, and generative accompaniment.",
  "Acoustic Spaces":
    "Spatial audio as an instrument: band-limited materials, sparse routes, media, and shareable musical rooms.",
  "Waking Bodies":
    "A procedural bear modeled from triangles, rigged by distance, and animated with inverse kinematics and springs.",
  "Feather & Bone":
    "A bald eagle lofted ring by ring, feathered quill by quill, rigged, animated, and flown with a real aerodynamic model.",
  "Ground Truth":
    "Procedural terrain built from noise, erosion, instanced grass, trees, biomes, and streamed chunks.",
  "Spark & Signal":
    "Neurons, action potentials, synaptic transmission, and small circuits — explained with live simulations.",
};

export const POSTS: Post[] = [
  {
    href: "/pages/particle-worlds/part1.html",
    series: "Particle Worlds",
    part: 1,
    title: "Two Falling Dots",
    subtitle: "From two falling dots to 300,000 gravitating bodies",
  },
  {
    href: "/pages/particle-worlds/part2.html",
    series: "Particle Worlds",
    part: 2,
    title: "Gravity on a Dome",
    subtitle: "Extending the simulation to 3D with octrees and particle rendering",
  },
  {
    href: "/pages/particle-worlds/part3.html",
    series: "Particle Worlds",
    part: 3,
    title: "Sorting Water",
    subtitle: "Neighbour search, dry sand, and 80,000 particles of water",
  },
  {
    href: "/pages/particle-worlds/part4.html",
    series: "Particle Worlds",
    part: 4,
    title: "Worlds from Dust",
    subtitle: "Accretion in a debris disc using gravity, collisions, and dissipation",
  },
  {
    href: "/pages/particle-worlds/part5.html",
    series: "Particle Worlds",
    part: 5,
    title: "Gravity in Frequency Space",
    subtitle: "Particle-mesh cosmology from measured initial density fluctuations",
  },
  {
    href: "/pages/particle-worlds/part6.html",
    series: "Particle Worlds",
    part: 6,
    title: "The Fluid Instrument",
    subtitle: "Stable fluids, curl noise, particle trails, and hand tracking",
  },
  {
    href: "/pages/firework-systems/gpu-fireworks.html",
    series: "Firework Systems",
    part: 1,
    title: "Fireworks at GPU Scale",
    subtitle: "Emit commands, live-list compaction, indirect drawing, and why the CPU should describe intent instead of particles",
  },
  {
    href: "/pages/dome-projection/circle.html",
    series: "Dome Projection",
    part: 1,
    title: "The Circle Under the Dome",
    subtitle: "Polar coordinates, radians, seams, and normalized UVs before any projector enters the room",
  },
  {
    href: "/pages/dome-projection/fisheye.html",
    series: "Dome Projection",
    part: 2,
    title: "The Fisheye Map",
    subtitle: "Turning dome directions into fisheye pixels, inverse mapping, projection lenses, and sampler seams",
  },
  {
    href: "/pages/dome-projection/show.html",
    series: "Dome Projection",
    part: 3,
    title: "The Dome Show",
    subtitle: "Projector cameras, warp meshes, edge blends, color matching, and seamless visuals across projectors",
  },
  {
    href: "/pages/dome-projection/realtime.html",
    series: "Dome Projection",
    part: 4,
    title: "Dome-Native Three.js",
    subtitle: "Realtime scene rendering for domes: direct projector cameras, render targets, calibration meshes, and when fisheye masters still help",
  },
  {
    href: "/pages/bounced-light/lava.html",
    series: "Bounced Light",
    part: 1,
    title: "The Lava Lamp",
    subtitle: "Temperature-driven SPH illuminated by radiance cascades",
  },
  {
    href: "/pages/bounced-light/bonfire.html",
    series: "Bounced Light",
    part: 2,
    title: "The Bonfire",
    subtitle: "Thousands of ember lights, temporal multi-bounce, and environment lighting",
  },
  {
    href: "/pages/bounced-light/fog.html",
    series: "Bounced Light",
    part: 3,
    title: "The Fog",
    subtitle: "Participating media, Beer-Lambert extinction, and visible light shafts",
  },
  {
    href: "/pages/bounced-light/flatland.html",
    series: "Bounced Light",
    part: 4,
    title: "Leaving Flatland",
    subtitle: "3D distance fields, sphere tracing, surface normals, and soft shadows",
  },
  {
    href: "/pages/bounced-light/cornell.html",
    series: "Bounced Light",
    part: 5,
    title: "The Cornell Box",
    subtitle: "The rendering equation, Monte Carlo integration, and next-event estimation",
  },
  {
    href: "/pages/bounced-light/prism.html",
    series: "Bounced Light",
    part: 6,
    title: "The Prism",
    subtitle: "Refraction, dispersion, spectral color, caustics, and depth of field",
  },
  {
    href: "/pages/strange-matter/ferro.html",
    series: "Strange Matter",
    part: 1,
    title: "The Ferrofluid",
    subtitle: "Magnetic SPH and a surface reconstructed with marching squares every frame",
  },
  {
    href: "/pages/strange-matter/crown.html",
    series: "Strange Matter",
    part: 2,
    title: "The Crown",
    subtitle: "Mutual magnetization and an inward-pointing force grow self-spacing Rosensweig spikes",
  },
  {
    href: "/pages/strange-matter/relief.html",
    series: "Strange Matter",
    part: 3,
    title: "Sharp Relief",
    subtitle: "The crown in 3D — marching tetrahedra, surface nets, and dual contouring keep the spikes sharp",
  },
  {
    href: "/pages/living-music/vibration.html",
    series: "Living Music",
    part: 1,
    title: "The Anatomy of a Note",
    subtitle: "Pitch, loudness, and timbre explained with oscillators and one vibrating string",
  },
  {
    href: "/pages/living-music/harmony.html",
    series: "Living Music",
    part: 2,
    title: "Consonance and Roughness",
    subtitle: "Beats, whole-number ratios, harmonic alignment, and consonance",
  },
  {
    href: "/pages/living-music/twelve.html",
    series: "Living Music",
    part: 3,
    title: "Twelve Imperfect Notes",
    subtitle: "The Pythagorean comma, temperament, and the twelve-note equal division",
  },
  {
    href: "/pages/living-music/scales.html",
    series: "Living Music",
    part: 4,
    title: "Seven of Twelve",
    subtitle: "Scales as step patterns, modes as rotations, and the circle of fifths as a map of keys",
  },
  {
    href: "/pages/living-music/chords.html",
    series: "Living Music",
    part: 5,
    title: "Major and Minor",
    subtitle: "Triad construction, functional harmony, and voice leading",
  },
  {
    href: "/pages/living-music/jukebox.html",
    series: "Living Music",
    part: 6,
    title: "The Infinite Jukebox",
    subtitle: "Euclidean rhythm, random-walk melody, voice leading, and generative form",
  },
  {
    href: "/pages/living-music/accompanist.html",
    series: "Living Music",
    part: 7,
    title: "The Accompanist",
    subtitle: "Real-time key estimation, chord inference, voice leading, and generated accompaniment",
  },
  {
    href: "/pages/acoustic-spaces/acoustic-space.html",
    series: "Acoustic Spaces",
    part: 1,
    title: "Rooms That Play Back",
    subtitle: "Probe-based acoustic simulation, sparse pathing, material transmittance, and generative spatial sound",
  },
  {
    href: "/pages/acoustic-spaces/room-instrument.html",
    series: "Acoustic Spaces",
    part: 2,
    title: "The Room Instrument",
    subtitle: "A shareable spatial-audio music toy for composing with materials, media, distance, and routed sound",
  },
  {
    href: "/pages/waking-bodies/bear.html",
    series: "Waking Bodies",
    part: 1,
    title: "The Bear",
    subtitle: "A procedural character lofted from vertex rings, stitched into triangles, and shaded in TSL",
  },
  {
    href: "/pages/waking-bodies/rig.html",
    series: "Waking Bodies",
    part: 2,
    title: "The Skeleton",
    subtitle: "A bone hierarchy, proximity-based skin weights, and linear blend skinning",
  },
  {
    href: "/pages/waking-bodies/reach.html",
    series: "Waking Bodies",
    part: 3,
    title: "The Reach",
    subtitle: "Two-bone inverse kinematics, pole vectors, gaze constraints, and FABRIK",
  },
  {
    href: "/pages/waking-bodies/qigong.html",
    series: "Waking Bodies",
    part: 4,
    title: "The Form",
    subtitle: "Poses as targets, springs as blends, and layered procedural motion",
  },
  {
    href: "/pages/feather-bone/eagle.html",
    series: "Feather & Bone",
    part: 1,
    title: "The Eagle",
    subtitle: "A bald eagle lofted from rings of vertices, with every flight feather its own mesh",
  },
  {
    href: "/pages/feather-bone/bones.html",
    series: "Feather & Bone",
    part: 2,
    title: "The Bones",
    subtitle: "Seventeen joints, proximity-based skin weights, pinned beaks and talons, and idle motion",
  },
  {
    href: "/pages/feather-bone/wingbeat.html",
    series: "Feather & Bone",
    part: 3,
    title: "The Wingbeat",
    subtitle: "The law of cosines unfolds the wing; slots, splay, and lag make the feathers fly it",
  },
  {
    href: "/pages/feather-bone/flight.html",
    series: "Feather & Bone",
    part: 4,
    title: "Flight",
    subtitle: "Lift, drag, weight, and flap thrust integrated every frame — at eagle weight and speed",
  },
  {
    href: "/pages/feather-bone/landing.html",
    series: "Feather & Bone",
    part: 5,
    title: "The Landing",
    subtitle: "Guidance laws, a landing flare, procedural boughs, and a two-voiced scream",
  },
  {
    href: "/pages/feather-bone/sky.html",
    series: "Feather & Bone",
    part: 6,
    title: "The Sky",
    subtitle: "The simulated eagle and the grown terrain combined in one manual or autopilot demo",
  },
  {
    href: "/pages/ground-truth/heightfield.html",
    series: "Ground Truth",
    part: 1,
    title: "The Heightfield",
    subtitle: "Hashed gradient noise, fractal sums, ridges, domain warping, and heightfield meshes",
  },
  {
    href: "/pages/ground-truth/erosion.html",
    series: "Ground Truth",
    part: 2,
    title: "The Rain",
    subtitle: "Hydraulic erosion turns procedural noise into connected drainage networks",
  },
  {
    href: "/pages/ground-truth/grass.html",
    series: "Ground Truth",
    part: 3,
    title: "The Grass",
    subtitle: "A hundred thousand instanced blades placed from sediment and animated in the vertex shader",
  },
  {
    href: "/pages/ground-truth/trees.html",
    series: "Ground Truth",
    part: 4,
    title: "The Trees",
    subtitle: "Space colonization, pipe-model thickness, low-poly meshes, and indexed perches",
  },
  {
    href: "/pages/ground-truth/biomes.html",
    series: "Ground Truth",
    part: 5,
    title: "The Biomes",
    subtitle: "A moisture field, biome classification, and deterministic placement of a million plants",
  },
  {
    href: "/pages/ground-truth/horizon.html",
    series: "Ground Truth",
    part: 6,
    title: "The Horizon",
    subtitle: "Chunks, LOD rings, skirts, and a millisecond build budget for continuous terrain streaming",
  },
  {
    href: "/pages/spark-signal/signaling.html",
    series: "Spark & Signal",
    part: 1,
    title: "How Neurons Signal",
    subtitle: "Resting potential, action potentials, synaptic transmission, and neural circuits",
  },
];

export function currentPost(): { post: Post | null; index: number } {
  const path = location.pathname.replace(/\/$/, "") || "/index.html";
  const file = path.split("/").pop() || "index.html";
  const index = POSTS.findIndex((p) => p.href === path || p.href.endsWith(`/${file}`));
  return { post: index >= 0 ? POSTS[index] : null, index };
}
