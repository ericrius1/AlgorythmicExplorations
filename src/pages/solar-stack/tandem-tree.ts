import { wirePage } from "../../core/wirePage";
import {
  mountLayerTradeoffs,
  mountSpectrumSplitter,
  mountTandemTechTree,
} from "../../demos/solar/tandemExplainers";

wirePage({
  "tandem-tree": mountTandemTechTree,
  "spectrum-splitter": mountSpectrumSplitter,
  "layer-tradeoffs": mountLayerTradeoffs,
});
