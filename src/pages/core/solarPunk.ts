import { mountLazy } from "../../lib/demoShell";
import { mountSolarPunk } from "../../demos/light/solarPunk";

const mount = document.querySelector<HTMLElement>("[data-demo='solar-punk']");
if (mount) mountLazy(mount, () => mountSolarPunk(mount));
