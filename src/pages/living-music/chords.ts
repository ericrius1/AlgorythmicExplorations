import "../../styles/music-harmony.css";
import { initNav } from "../../lib/siteNav";
import { mountLazy, type Demo } from "../../lib/demoShell";
import { mountTonnetz } from "../../demos/music/harmony/tonnetz";
import { mountTriadLab } from "../../demos/music/triadLab";
import { mountChordSpace } from "../../demos/music/harmony/chordSpace";
import { mountVoiceLoop } from "../../demos/music/voiceLoop";

initNav();

const mounts: Record<string, (el: HTMLElement) => Demo | Promise<Demo>> = {
  hero: (el) => mountTonnetz(el, { hero: true }),
  triads: (el) => mountTriadLab(el),
  space: (el) => mountChordSpace(el),
  loop: (el) => mountVoiceLoop(el),
  tonnetz: (el) => mountTonnetz(el),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const make = mounts[el.dataset.demo!];
  if (make) mountLazy(el, () => make(el));
}
