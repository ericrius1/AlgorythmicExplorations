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
    "An n-body galaxy built from scratch — two falling dots to 300,000 gravitating bodies, one optimization at a time.",
  "Bounced Light":
    "Illumination that actually bounces — radiance cascades, glowing fog, soft shadows, path tracing, and a prism that makes rainbows.",
  "Strange Matter":
    "Simulated stuff you can poke — a magnetic liquid that grows spikes, its surface re-meshed from scratch every frame.",
  "Living Music":
    "The physics of sound you can hear — why notes agree, why minor sounds sad, and a song that writes itself.",
  "Waking Bodies":
    "A character built from scratch — a bear modeled by math, rigged by distances, and taught qi gong by springs.",
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
    subtitle: "The simulation leaves the plane — octrees, depth, and a planetarium",
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
    subtitle: "Accretion — moons assembling themselves out of a debris disc",
  },
  {
    href: "/part5.html",
    series: "Particle Worlds",
    part: 5,
    title: "The Music of the Spheres",
    subtitle: "Particle-mesh cosmology: growing the cosmic web from measured ripples",
  },
  {
    href: "/part6.html",
    series: "Particle Worlds",
    part: 6,
    title: "The Sorcerer's Apprentice",
    subtitle: "Stable fluids, curl noise, hand tracking — the series becomes a toy",
  },
  {
    href: "/lava.html",
    series: "Bounced Light",
    part: 1,
    title: "The Lava Lamp",
    subtitle: "Temperature-driven SPH lit by radiance cascades — light that actually bounces",
  },
  {
    href: "/bonfire.html",
    series: "Bounced Light",
    part: 2,
    title: "The Bonfire",
    subtitle: "A thousand ember-lights for one price, multi-bounce from a time loop, the sky as the topmost cascade",
  },
  {
    href: "/fog.html",
    series: "Bounced Light",
    part: 3,
    title: "The Fog",
    subtitle: "Participating media — light taxed by the meter, fog that glows, and god rays as sideways shadows",
  },
  {
    href: "/flatland.html",
    series: "Bounced Light",
    part: 4,
    title: "Leaving Flatland",
    subtitle: "The distance field becomes a function — sphere tracing, soft shadows, and a third dimension",
  },
  {
    href: "/cornell.html",
    series: "Bounced Light",
    part: 5,
    title: "The Cornell Box",
    subtitle: "Path tracing — the rendering equation, honest dice, and the most photographed box in graphics",
  },
  {
    href: "/prism.html",
    series: "Bounced Light",
    part: 6,
    title: "The Prism",
    subtitle: "Glass, rainbows, caustics, focus — light becomes color, and the series becomes a toy",
  },
  {
    href: "/ferro.html",
    series: "Strange Matter",
    part: 1,
    title: "The Ferrofluid",
    subtitle: "A magnetic liquid that grows spikes — and a surface meshed from scratch every frame",
  },
  {
    href: "/vibration.html",
    series: "Living Music",
    part: 1,
    title: "The Anatomy of a Note",
    subtitle: "Pitch is a speed, loudness is a size, timbre is a recipe — one string explains all three",
  },
  {
    href: "/harmony.html",
    series: "Living Music",
    part: 2,
    title: "Why Notes Agree",
    subtitle: "Beats, ratios, and the harmonic handshake — consonance as physics you can hear",
  },
  {
    href: "/twelve.html",
    series: "Living Music",
    part: 3,
    title: "Twelve Beautiful Lies",
    subtitle: "Stack twelve perfect fifths and miss — the comma, and the compromise that built the piano",
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
    title: "Why Minor Sounds Sad",
    subtitle: "Triads, tension, and the pull of the dominant — harmony as motion",
  },
  {
    href: "/jukebox.html",
    series: "Living Music",
    part: 6,
    title: "The Infinite Jukebox",
    subtitle: "Euclidean rhythm, random-walk melody, a song that writes itself — the series becomes a toy",
  },
  {
    href: "/accompanist.html",
    series: "Living Music",
    part: 7,
    title: "The Accompanist",
    subtitle: "Encore — play, and an algorithmic bandmate follows: key-finding, chord-guessing, and knowing when to stay out of the way",
  },
  {
    href: "/bear.html",
    series: "Waking Bodies",
    part: 1,
    title: "The Bear",
    subtitle: "A character sculpted by arithmetic — capsules, smooth unions, and a mesh marched out of a field",
  },
  {
    href: "/rig.html",
    series: "Waking Bodies",
    part: 2,
    title: "The Skeleton",
    subtitle: "Bones as a hierarchy, skin as a weighted vote — the bear learns to bend, four matrices per vertex",
  },
  {
    href: "/reach.html",
    series: "Waking Bodies",
    part: 3,
    title: "The Reach",
    subtitle: "Inverse kinematics — stop dialing angles, start asking for places; the law of cosines meets a draggable orb",
  },
  {
    href: "/qigong.html",
    series: "Waking Bodies",
    part: 4,
    title: "The Form",
    subtitle: "Qi gong at last — poses as targets, springs as blends, moves that flow into each other; the series becomes a toy",
  },
];

export function currentPost(): { post: Post | null; index: number } {
  let file = location.pathname.split("/").pop() || "index.html";
  if (file === "") file = "index.html";
  const index = POSTS.findIndex((p) => p.href === `/${file}`);
  return { post: index >= 0 ? POSTS[index] : null, index };
}
