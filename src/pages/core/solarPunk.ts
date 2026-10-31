import { mountLazy } from "../../lib/demoShell";
import { home } from "../../lib/home";
import { mountSolarPunk } from "../../demos/light/solarPunk";

const mount = document.querySelector<HTMLElement>("[data-demo='solar-punk']");
if (mount) mountLazy(mount, () => mountSolarPunk(mount));

// the way home to ericlevin.dev (lib/home.ts, the same in every project on it): just its mark, before the way back
// to the essays (this page has no site nav to carry it)
const back = document.querySelector(".solar-punk-back");
if (back?.parentElement) home({ mount: back.parentElement, before: back, mark: true });
