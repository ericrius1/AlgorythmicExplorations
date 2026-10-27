import { initNav } from "../../lib/siteNav";
import { mountLazy, type Demo } from "../../lib/demoShell";
import { mountSoundControl } from "../../lib/music/soundControl";
import { mountNoteHero } from "../../demos/music/noteHero";
import { mountOscillo } from "../../demos/music/oscillo";
import { mountPluckString } from "../../demos/music/pluckString";
import { mountHarmonics } from "../../demos/music/harmonics";
import { mountLadder } from "../../demos/music/sound/ladder";
import { mountVowels } from "../../demos/music/sound/vowels";
import { mountMissing } from "../../demos/music/sound/missing";
import { mountShepard } from "../../demos/music/sound/shepard";
import "../../styles/music-sound.css";

initNav();
mountSoundControl();

const mounts: Record<string, (el: HTMLElement) => Demo | Promise<Demo>> = {
  hero: mountNoteHero,
  oscillo: mountOscillo,
  string: mountPluckString,
  harmonics: mountHarmonics,
  ladder: mountLadder,
  vowels: mountVowels,
  missing: mountMissing,
  shepard: mountShepard,
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const make = mounts[el.dataset.demo!];
  if (make) mountLazy(el, () => make(el));
}
