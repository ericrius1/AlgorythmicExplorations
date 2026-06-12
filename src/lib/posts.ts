// Every post on the site, in reading order. The nav, the menus, and the
// read-next cards are all generated from this one list.

export const SITE_NAME = "Cosmic Algorithmic Explorations";

export interface Post {
  href: string;
  series: string;
  part: number;
  title: string;
  subtitle: string;
}

export const POSTS: Post[] = [
  {
    href: "/index.html",
    series: "Gravity in a Browser Tab",
    part: 1,
    title: "Gravity in a Browser Tab",
    subtitle: "From two falling dots to 300,000 gravitating bodies",
  },
  {
    href: "/part2.html",
    series: "Gravity in a Browser Tab",
    part: 2,
    title: "Gravity on a Dome",
    subtitle: "The simulation leaves the plane — octrees, depth, and a planetarium",
  },
  {
    href: "/part3.html",
    series: "Gravity in a Browser Tab",
    part: 3,
    title: "Sorting Water",
    subtitle: "Neighbour search, dry sand, and 80,000 particles of water",
  },
  {
    href: "/part4.html",
    series: "Gravity in a Browser Tab",
    part: 4,
    title: "Worlds from Dust",
    subtitle: "Accretion — moons assembling themselves out of a debris disc",
  },
  {
    href: "/part5.html",
    series: "Gravity in a Browser Tab",
    part: 5,
    title: "The Music of the Spheres",
    subtitle: "Particle-mesh cosmology: growing the cosmic web from measured ripples",
  },
  {
    href: "/part6.html",
    series: "Gravity in a Browser Tab",
    part: 6,
    title: "The Sorcerer's Apprentice",
    subtitle: "Stable fluids, curl noise, hand tracking — the series becomes a toy",
  },
  {
    href: "/lava.html",
    series: "Light in a Browser Tab",
    part: 1,
    title: "The Lava Lamp",
    subtitle: "Temperature-driven SPH lit by radiance cascades — light that actually bounces",
  },
  {
    href: "/bonfire.html",
    series: "Light in a Browser Tab",
    part: 2,
    title: "The Bonfire",
    subtitle: "A thousand ember-lights for one price, multi-bounce from a time loop, the sky as the topmost cascade",
  },
  {
    href: "/fog.html",
    series: "Light in a Browser Tab",
    part: 3,
    title: "The Fog",
    subtitle: "Participating media — light taxed by the meter, fog that glows, and god rays as sideways shadows",
  },
  {
    href: "/flatland.html",
    series: "Light in a Browser Tab",
    part: 4,
    title: "Leaving Flatland",
    subtitle: "The distance field becomes a function — sphere tracing, soft shadows, and a third dimension",
  },
  {
    href: "/cornell.html",
    series: "Light in a Browser Tab",
    part: 5,
    title: "The Cornell Box",
    subtitle: "Path tracing — the rendering equation, honest dice, and the most photographed box in graphics",
  },
  {
    href: "/prism.html",
    series: "Light in a Browser Tab",
    part: 6,
    title: "The Prism",
    subtitle: "Glass, rainbows, caustics, focus — light becomes color, and the series becomes a toy",
  },
  {
    href: "/vibration.html",
    series: "Music in a Browser Tab",
    part: 1,
    title: "The Anatomy of a Note",
    subtitle: "Pitch is a speed, loudness is a size, timbre is a recipe — one string explains all three",
  },
  {
    href: "/harmony.html",
    series: "Music in a Browser Tab",
    part: 2,
    title: "Why Notes Agree",
    subtitle: "Beats, ratios, and the harmonic handshake — consonance as physics you can hear",
  },
  {
    href: "/twelve.html",
    series: "Music in a Browser Tab",
    part: 3,
    title: "Twelve Beautiful Lies",
    subtitle: "Stack twelve perfect fifths and miss — the comma, and the compromise that built the piano",
  },
  {
    href: "/scales.html",
    series: "Music in a Browser Tab",
    part: 4,
    title: "Seven of Twelve",
    subtitle: "Scales as step patterns, modes as rotations, and the circle of fifths as a map of keys",
  },
  {
    href: "/chords.html",
    series: "Music in a Browser Tab",
    part: 5,
    title: "Why Minor Sounds Sad",
    subtitle: "Triads, tension, and the pull of the dominant — harmony as motion",
  },
  {
    href: "/jukebox.html",
    series: "Music in a Browser Tab",
    part: 6,
    title: "The Infinite Jukebox",
    subtitle: "Euclidean rhythm, random-walk melody, a song that writes itself — the series becomes a toy",
  },
];

export function currentPost(): { post: Post | null; index: number } {
  let file = location.pathname.split("/").pop() || "index.html";
  if (file === "") file = "index.html";
  const index = POSTS.findIndex((p) => p.href === `/${file}`);
  return { post: index >= 0 ? POSTS[index] : null, index };
}
