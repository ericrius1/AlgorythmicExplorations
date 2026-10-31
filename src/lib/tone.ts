// Tone.js, without what its index does as it loads. `import * as Tone from "tone"`
// builds Tone's global AudioContext on the spot (for its Transport, Destination,
// Listener, Draw and context exports, none of which the site uses), and in Chrome
// opening the audio device holds the page up 0.2–0.3 s before its first figure
// builds, for a context that stays silent until a tap. The same classes and
// functions from Tone's own modules instead; the context is made the first time
// something asks for it (a node built, getContext(), start()).

import { getContext } from "tone/build/esm/core/Global.js";

export * from "tone/build/esm/classes.js";
export { getContext, setContext, start } from "tone/build/esm/core/Global.js";

export function now(): number {
  return getContext().now();
}

export function immediate(): number {
  return getContext().immediate();
}
