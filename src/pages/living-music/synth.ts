import "../../styles/music-synth.css";
import { initNav } from "../../lib/siteNav";
import { mountSoundControl } from "../../lib/music/soundControl";
import { mountLazy, type Demo } from "../../lib/demoShell";
import { mountHero } from "../../demos/music/synth/hero";
import { mountOsc } from "../../demos/music/synth/osc";
import { mountAlias } from "../../demos/music/synth/alias";
import { mountFilter } from "../../demos/music/synth/filter";
import { mountEnv } from "../../demos/music/synth/env";
import { mountLfo } from "../../demos/music/synth/lfo";
import { mountFm } from "../../demos/music/synth/fm";
import { mountKs } from "../../demos/music/synth/ks";
import { mountPatch } from "../../demos/music/synth/patch";

initNav();
mountSoundControl();

const mounts: Record<string, (el: HTMLElement) => Demo | Promise<Demo>> = {
  hero: mountHero,
  osc: mountOsc,
  alias: mountAlias,
  filter: mountFilter,
  env: mountEnv,
  lfo: mountLfo,
  fm: mountFm,
  ks: mountKs,
  patch: mountPatch,
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const make = mounts[el.dataset.demo!];
  if (make) mountLazy(el, () => make(el));
}
