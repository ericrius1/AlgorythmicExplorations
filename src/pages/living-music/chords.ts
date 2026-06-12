import { initNav } from "../../lib/siteNav";
import { mountLazy } from "../../lib/demoShell";
import { mountTriadLab } from "../../demos/music/triadLab";
import { mountVoiceLoop } from "../../demos/music/voiceLoop";

initNav();

const mounts: Record<string, (el: HTMLElement) => ReturnType<Parameters<typeof mountLazy>[1]>> = {
  triads: (el) => mountTriadLab(el),
  loop: (el) => mountVoiceLoop(el),
};

for (const el of document.querySelectorAll<HTMLElement>("[data-demo]")) {
  const make = mounts[el.dataset.demo!];
  if (make) mountLazy(el, () => make(el));
}
