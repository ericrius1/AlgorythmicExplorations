// Every post on the site, in reading order. The nav, the menus, and the
// read-next cards are all generated from this one list.

export const SITE_NAME = "Algorythmic Explorations";

// The site is served from a subpath (www.ericlevin.dev/algorythmicexplorations/),
// so post hrefs stay site-relative ("/pages/…") and links are built with siteUrl().
export const BASE = import.meta.env.BASE_URL; // always ends in "/"

export function siteUrl(path: string): string {
  return BASE + path.replace(/^\//, "");
}
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
    "Rooms as instruments: echoes, reverberation, materials, room modes, binaural hearing, and a room that plays music.",
  "Ground Truth":
    "Procedural terrain built from noise, erosion, instanced grass, trees, biomes, and streamed chunks.",
  "Solar Stack":
    "Perovskite-on-silicon tandem solar cells, worked through with live detailed-balance models: bandgaps, current matching, contacts, texture, yield, lifetime and cost.",
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
    href: "/pages/dome-projection/cubemap.html",
    series: "Dome Projection",
    part: 3,
    title: "Six Square Cameras",
    subtitle: "Cubemaps versus fisheye masters: two addresses for one direction, what each costs to render, and how to choose",
  },
  {
    href: "/pages/dome-projection/show.html",
    series: "Dome Projection",
    part: 4,
    title: "The Dome Show",
    subtitle: "Projector cameras, warp meshes, edge blends, color matching, and seamless visuals across projectors",
  },
  {
    href: "/pages/dome-projection/realtime.html",
    series: "Dome Projection",
    part: 5,
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
    subtitle: "Pitch, loudness, and timbre: standing waves, the harmonic series, formants, and pitch illusions you can play",
  },
  {
    href: "/pages/living-music/synth.html",
    series: "Living Music",
    part: 2,
    title: "The Synthesizer",
    subtitle: "Oscillators, filters, envelopes, FM and a plucked string, built one module at a time",
  },
  {
    href: "/pages/living-music/harmony.html",
    series: "Living Music",
    part: 3,
    title: "Consonance and Roughness",
    subtitle: "Beats, whole-number ratios, harmonic alignment, and consonance",
  },
  {
    href: "/pages/living-music/twelve.html",
    series: "Living Music",
    part: 4,
    title: "Twelve Imperfect Notes",
    subtitle: "The Pythagorean comma, temperament, and the twelve-note equal division",
  },
  {
    href: "/pages/living-music/scales.html",
    series: "Living Music",
    part: 5,
    title: "Seven of Twelve",
    subtitle: "Scales as step patterns, modes as rotations, and the circle of fifths as a map of keys",
  },
  {
    href: "/pages/living-music/chords.html",
    series: "Living Music",
    part: 6,
    title: "Major and Minor",
    subtitle: "Why major and minor sound the way they do, tension and release, and the Tonnetz",
  },
  {
    href: "/pages/living-music/jukebox.html",
    series: "Living Music",
    part: 7,
    title: "The Infinite Jukebox",
    subtitle: "Euclidean rhythm, polyrhythm, swing, a melody walker, and a band that writes its own songs",
  },
  {
    href: "/pages/living-music/accompanist.html",
    series: "Living Music",
    part: 8,
    title: "The Accompanist",
    subtitle: "Real-time key estimation, chord inference, voice leading, and generated accompaniment",
  },
  {
    href: "/pages/acoustic-spaces/acoustic-space.html",
    series: "Acoustic Spaces",
    part: 1,
    title: "Rooms That Play Back",
    subtitle: "Image sources, Sabine's reverberation time, absorption by frequency, room modes, two-ear hearing, and I am sitting in a room",
  },
  {
    href: "/pages/acoustic-spaces/room-instrument.html",
    series: "Acoustic Spaces",
    part: 2,
    title: "The Room Instrument",
    subtitle: "A room whose echoes write the rhythm, heard binaurally and shared as a link",
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
    subtitle: "Tens of thousands of blades planted from sediment, merged into one buffer, and moved by wind in the shader",
  },
  {
    href: "/pages/ground-truth/trees.html",
    series: "Ground Truth",
    part: 4,
    title: "The Trees",
    subtitle: "Space colonization, pipe-model thickness, bark rings and leaf cards, and an instanced grove",
  },
  {
    href: "/pages/ground-truth/biomes.html",
    series: "Ground Truth",
    part: 5,
    title: "The Biomes",
    subtitle: "A moisture field, biome classification, and a world-indexed jittered grid that places every tree and rock",
  },
  {
    href: "/pages/ground-truth/horizon.html",
    series: "Ground Truth",
    part: 6,
    title: "The Horizon",
    subtitle: "Chunks, LOD rings, skirts, a millisecond build budget and a coarse backdrop for an endless streamed world",
  },
  {
    href: "/pages/solar-stack/tandem-tree.html",
    series: "Solar Stack",
    part: 1,
    title: "The Tandem Tree",
    subtitle: "Why a thin perovskite film on silicon can pass silicon's own limit, and what decides whether it lasts on a roof",
  },
  {
    href: "/pages/spark-signal/signaling.html",
    series: "Spark & Signal",
    part: 1,
    title: "How Neurons Signal",
    subtitle: "From a single ion to twenty thousand neurons: resting potential, spikes, myelin, synapses, and circuits, live on the GPU",
  },
];

export function currentPost(): { post: Post | null; index: number } {
  let path = location.pathname;
  if (path.startsWith(BASE)) path = "/" + path.slice(BASE.length);
  path = path.replace(/\/$/, "") || "/index.html";
  const file = path.split("/").pop() || "index.html";
  const index = POSTS.findIndex((p) => p.href === path || p.href.endsWith(`/${file}`));
  return { post: index >= 0 ? POSTS[index] : null, index };
}
