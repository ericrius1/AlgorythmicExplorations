import "../../styles/dome-projection.css";
import { wirePage } from "../../core/wirePage";
import { domeHero } from "../../demos/dome/domeHero";
import { mountRealtimeProjectors } from "../../demos/dome/projectionMath";

wirePage({
  hero: domeHero("realtime"),
  "realtime-projectors": mountRealtimeProjectors,
});
