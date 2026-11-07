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
    "Gravity, water and dust, one particle at a time.",
  "Firework Systems":
    "Fireworks the GPU owns.",
  "Dome Projection":
    "Pictures for the inside of a dome.",
  "Bounced Light":
    "Fire, fog, a lava lamp, a prism: how light gets around.",
  "Strange Matter":
    "A liquid that grows spikes.",
  "Living Music":
    "Why notes sound the way they do, up to a band that writes its own songs.",
  "Acoustic Spaces":
    "Rooms as instruments.",
  "Ground Truth":
    "A world from noise: rain, grass, trees, and a horizon that never ends.",
  "Solar Stack":
    "A solar cell, photon by photon.",
  "Spark & Signal":
    "How a neuron fires, and what it tells the next.",
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
    subtitle: "The simulation goes 3D",
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
    subtitle: "Planets from a disc of debris",
  },
  {
    href: "/pages/particle-worlds/part5.html",
    series: "Particle Worlds",
    part: 5,
    title: "Gravity in Frequency Space",
    subtitle: "A cosmic web from the universe's first ripples",
  },
  {
    href: "/pages/particle-worlds/part6.html",
    series: "Particle Worlds",
    part: 6,
    title: "The Fluid Instrument",
    subtitle: "A fluid you play with your hands",
  },
  {
    href: "/pages/firework-systems/gpu-fireworks.html",
    series: "Firework Systems",
    part: 1,
    title: "Fireworks at GPU Scale",
    subtitle: "Why the CPU should describe intent, not particles",
  },
  {
    href: "/pages/dome-projection/circle.html",
    series: "Dome Projection",
    part: 1,
    title: "The Circle Under the Dome",
    subtitle: "Polar coordinates, before any projector enters the room",
  },
  {
    href: "/pages/dome-projection/fisheye.html",
    series: "Dome Projection",
    part: 2,
    title: "The Fisheye Map",
    subtitle: "Dome directions into fisheye pixels",
  },
  {
    href: "/pages/dome-projection/cubemap.html",
    series: "Dome Projection",
    part: 3,
    title: "Six Square Cameras",
    subtitle: "Cubemap or fisheye: two addresses for one direction",
  },
  {
    href: "/pages/dome-projection/show.html",
    series: "Dome Projection",
    part: 4,
    title: "The Dome Show",
    subtitle: "Many projectors, one seamless sky",
  },
  {
    href: "/pages/dome-projection/realtime.html",
    series: "Dome Projection",
    part: 5,
    title: "Dome-Native Three.js",
    subtitle: "Rendering straight to the dome, in real time",
  },
  {
    href: "/pages/bounced-light/lava.html",
    series: "Bounced Light",
    part: 1,
    title: "The Lava Lamp",
    subtitle: "Hot wax that lights itself",
  },
  {
    href: "/pages/bounced-light/bonfire.html",
    series: "Bounced Light",
    part: 2,
    title: "The Bonfire",
    subtitle: "Thousands of embers, each a light",
  },
  {
    href: "/pages/bounced-light/fog.html",
    series: "Bounced Light",
    part: 3,
    title: "The Fog",
    subtitle: "Light you can see in the air",
  },
  {
    href: "/pages/bounced-light/flatland.html",
    series: "Bounced Light",
    part: 4,
    title: "Leaving Flatland",
    subtitle: "Into 3D, with soft shadows",
  },
  {
    href: "/pages/bounced-light/cornell.html",
    series: "Bounced Light",
    part: 5,
    title: "The Cornell Box",
    subtitle: "The rendering equation, solved by rolling dice",
  },
  {
    href: "/pages/bounced-light/prism.html",
    series: "Bounced Light",
    part: 6,
    title: "The Prism",
    subtitle: "White light, split",
  },
  {
    href: "/pages/strange-matter/ferro.html",
    series: "Strange Matter",
    part: 1,
    title: "The Ferrofluid",
    subtitle: "A magnetic liquid",
  },
  {
    href: "/pages/strange-matter/crown.html",
    series: "Strange Matter",
    part: 2,
    title: "The Crown",
    subtitle: "Spikes that space themselves",
  },
  {
    href: "/pages/strange-matter/relief.html",
    series: "Strange Matter",
    part: 3,
    title: "Sharp Relief",
    subtitle: "The crown in 3D, its spikes kept sharp",
  },
  {
    href: "/pages/living-music/vibration.html",
    series: "Living Music",
    part: 1,
    title: "The Anatomy of a Note",
    subtitle: "Pitch, loudness, timbre, and illusions you can play",
  },
  {
    href: "/pages/living-music/synth.html",
    series: "Living Music",
    part: 2,
    title: "The Synthesizer",
    subtitle: "Built one module at a time",
  },
  {
    href: "/pages/living-music/harmony.html",
    series: "Living Music",
    part: 3,
    title: "Consonance and Roughness",
    subtitle: "Why some notes sit well together",
  },
  {
    href: "/pages/living-music/twelve.html",
    series: "Living Music",
    part: 4,
    title: "Twelve Imperfect Notes",
    subtitle: "Why twelve, and why none of them is quite right",
  },
  {
    href: "/pages/living-music/scales.html",
    series: "Living Music",
    part: 5,
    title: "Seven of Twelve",
    subtitle: "Scales, modes and the circle of fifths",
  },
  {
    href: "/pages/living-music/chords.html",
    series: "Living Music",
    part: 6,
    title: "Major and Minor",
    subtitle: "Why they sound the way they do",
  },
  {
    href: "/pages/living-music/jukebox.html",
    series: "Living Music",
    part: 7,
    title: "The Infinite Jukebox",
    subtitle: "A band that writes its own songs",
  },
  {
    href: "/pages/living-music/accompanist.html",
    series: "Living Music",
    part: 8,
    title: "The Accompanist",
    subtitle: "It listens, then plays along",
  },
  {
    href: "/pages/acoustic-spaces/acoustic-space.html",
    series: "Acoustic Spaces",
    part: 1,
    title: "Rooms That Play Back",
    subtitle: "Echoes, reverb, and I am sitting in a room",
  },
  {
    href: "/pages/acoustic-spaces/room-instrument.html",
    series: "Acoustic Spaces",
    part: 2,
    title: "The Room Instrument",
    subtitle: "A room whose echoes write the rhythm",
  },
  {
    href: "/pages/ground-truth/heightfield.html",
    series: "Ground Truth",
    part: 1,
    title: "The Heightfield",
    subtitle: "Mountains from noise",
  },
  {
    href: "/pages/ground-truth/erosion.html",
    series: "Ground Truth",
    part: 2,
    title: "The Rain",
    subtitle: "Rain carves the noise into valleys",
  },
  {
    href: "/pages/ground-truth/grass.html",
    series: "Ground Truth",
    part: 3,
    title: "The Grass",
    subtitle: "Tens of thousands of blades, and the wind",
  },
  {
    href: "/pages/ground-truth/trees.html",
    series: "Ground Truth",
    part: 4,
    title: "The Trees",
    subtitle: "Grown branch by branch, then a grove",
  },
  {
    href: "/pages/ground-truth/biomes.html",
    series: "Ground Truth",
    part: 5,
    title: "The Biomes",
    subtitle: "What grows where, and why",
  },
  {
    href: "/pages/ground-truth/horizon.html",
    series: "Ground Truth",
    part: 6,
    title: "The Horizon",
    subtitle: "A world that never ends",
  },
  {
    href: "/pages/solar-stack/tandem-tree.html",
    series: "Solar Stack",
    part: 1,
    title: "The Tandem Tree",
    subtitle: "A thin film that passes silicon's own limit",
  },
  {
    href: "/pages/spark-signal/signaling.html",
    series: "Spark & Signal",
    part: 1,
    title: "How Neurons Signal",
    subtitle: "From one ion to twenty thousand neurons",
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
