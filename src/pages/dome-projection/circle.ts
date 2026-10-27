import "../../styles/dome-projection.css";
import { wirePage } from "../../core/wirePage";
import { domeHero } from "../../demos/dome/domeHero";
import { mountPolarCircle } from "../../demos/dome/projectionMath";

wirePage({
  hero: domeHero("circle"),
  "polar-circle": mountPolarCircle,
});
