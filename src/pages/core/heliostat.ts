import { mountLazy } from "../../lib/demoShell";
import { mountHeliostat } from "../../demos/light/heliostat";

const mount = document.querySelector<HTMLElement>("[data-demo='heliostat']");
if (mount) mountLazy(mount, () => mountHeliostat(mount));
