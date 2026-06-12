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
  "Feather & Bone":
    "A bird built from first principles — modeled low-poly from capsules, rigged, flapped, and finally flown over a living world.",
  "Ground Truth":
    "A world grown from noise — mountains, erosion, grass, and trees, on the way to a horizon that never runs out.",
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
  // Waking Bodies (bear.html, rig.html, reach.html, qigong.html) is unlisted
  // while its modeling pipeline is reworked from SDFs to triangle meshes —
  // restore its four posts (and its tagline above) when the rework lands.
  {
    href: "/wren.html",
    series: "Feather & Bone",
    part: 1,
    title: "The Wren",
    subtitle: "A songbird as a table of capsules — smooth unions, surface nets, and a low-poly bird with a garden-grade silhouette",
  },
  {
    href: "/bones.html",
    series: "Feather & Bone",
    part: 2,
    title: "The Bones",
    subtitle: "The capsule table's second job — seventeen joints, skin weights by proximity, and a wren who fidgets with zero keyframes",
  },
  {
    href: "/wingbeat.html",
    series: "Feather & Bone",
    part: 3,
    title: "The Wingbeat",
    subtitle: "Wingtip, be there — the law of cosines unfolds the wing, and an asymmetric clock with folding wrists teaches it to beat",
  },
  {
    href: "/heightfield.html",
    series: "Ground Truth",
    part: 1,
    title: "The Heightfield",
    subtitle: "Mountains from arithmetic — hashed gradients, fractal sums, ridges and warps, standing up as a mesh",
  },
  {
    href: "/erosion.html",
    series: "Ground Truth",
    part: 2,
    title: "The Rain",
    subtitle: "Hydraulic erosion — droplets with momentum and appetite carve the noise into drainage, and the valleys finally have a history",
  },
  {
    href: "/grass.html",
    series: "Ground Truth",
    part: 3,
    title: "The Grass",
    subtitle: "A hundred thousand blades, planted in part two's silt and bent by a wind that lives entirely in the vertex shader",
  },
  {
    href: "/trees.html",
    series: "Ground Truth",
    part: 4,
    title: "The Trees",
    subtitle: "Space colonization — branches compete for open air, thicken by Leonardo's rule, and publish their perches for a certain wren",
  },
  {
    href: "/biomes.html",
    series: "Ground Truth",
    part: 5,
    title: "The Biomes",
    subtitle: "What grows where — a moisture field, a pocket Whittaker diagram, and a jittered grid that places a million plants deterministically",
  },
  {
    href: "/horizon.html",
    series: "Ground Truth",
    part: 6,
    title: "The Horizon",
    subtitle: "Chunks, LOD rings, skirts, and a millisecond budget — the world streams in around your flight and never runs out",
  },
];

export function currentPost(): { post: Post | null; index: number } {
  let file = location.pathname.split("/").pop() || "index.html";
  if (file === "") file = "index.html";
  const index = POSTS.findIndex((p) => p.href === `/${file}`);
  return { post: index >= 0 ? POSTS[index] : null, index };
}
