import "../../styles/dome-projection.css";
import { wirePage } from "../../core/wirePage";
import { domeHero } from "../../demos/dome/domeHero";
import { mountMasterFormats } from "../../demos/dome/projectionMath";

wirePage({
  hero: domeHero("cubemap"),
  "master-formats": mountMasterFormats,
});
