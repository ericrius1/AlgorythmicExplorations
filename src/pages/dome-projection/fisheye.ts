import "../../styles/dome-projection.css";
import { wirePage } from "../../core/wirePage";
import { domeHero } from "../../demos/dome/domeHero";
import { mountFisheyeMap } from "../../demos/dome/projectionMath";

wirePage({
  hero: domeHero("fisheye"),
  "fisheye-map": mountFisheyeMap,
});
