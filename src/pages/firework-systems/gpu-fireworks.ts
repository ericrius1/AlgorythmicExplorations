import "../../styles/firework-systems.css";
import { wirePage } from "../../core/wirePage";
import {
  mountCapacityMap,
  mountCommandBudget,
  mountFireworksLive,
  mountHeroFireworks,
  mountLiveCompaction,
  mountPipelineGraph,
} from "../../demos/fireworkSystems";

wirePage({
  "hero-fireworks": mountHeroFireworks,
  "command-budget": mountCommandBudget,
  "live-compaction": mountLiveCompaction,
  "pipeline-graph": mountPipelineGraph,
  "capacity-map": mountCapacityMap,
  "fireworks-live": mountFireworksLive,
});
