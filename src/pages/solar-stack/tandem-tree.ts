import "../../styles/solar-stack.css";
import { wirePage } from "../../core/wirePage";
import { mountTandemHero } from "../../demos/solar/hero";
import { mountTandemTechTree } from "../../demos/solar/tandemExplainers";
import { mountBandgapLossMap, mountSpectrumSplitter } from "../../demos/solar/spectrumFigs";
import {
  mountBandAlignment,
  mountLayerStack,
  mountSiliconArchitecture,
  mountTandemJV,
  mountTextureCoating,
} from "../../demos/solar/deviceFigs";
import { mountCostPerWatt, mountLifetimeEnergy, mountYieldArea } from "../../demos/solar/factoryFigs";

wirePage({
  hero: mountTandemHero,
  "tandem-tree": mountTandemTechTree,
  "bandgap-loss-map": mountBandgapLossMap,
  "spectrum-splitter": mountSpectrumSplitter,
  "silicon-architecture": mountSiliconArchitecture,
  "layer-stack": mountLayerStack,
  "band-alignment": mountBandAlignment,
  "tandem-jv": mountTandemJV,
  "texture-coating": mountTextureCoating,
  "yield-area": mountYieldArea,
  "lifetime-energy": mountLifetimeEnergy,
  "cost-per-watt": mountCostPerWatt,
});
