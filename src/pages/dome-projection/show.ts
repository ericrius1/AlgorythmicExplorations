import "../../styles/dome-projection.css";
import { wirePage } from "../../core/wirePage";
import { domeHero } from "../../demos/dome/domeHero";
import { mountWarpBlendShow } from "../../demos/dome/projectionMath";

wirePage({
  hero: domeHero("show"),
  "warp-blend-show": mountWarpBlendShow,
});
