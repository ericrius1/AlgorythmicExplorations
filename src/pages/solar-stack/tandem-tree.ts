import "../../styles/solar-stack.css";
import { wirePage } from "../../core/wirePage";
import type { Demo } from "../../lib/demoShell";
import { getDevice } from "../../lib/gpu";
import { mountPhotonSorter, mountSeriesStack, mountTandemHero, mountTwoGaps } from "../../demos/solar/cellFigs";
import { mountSiliconSurfaces } from "../../demos/solar/siliconSurfaces";
import { mountContactBarrier } from "../../demos/solar/contactBarrier";
import { mountPyramidField } from "../../demos/solar/pyramidField";
import { mountTandemTechTree } from "../../demos/solar/tandemExplainers";
import { mountTandemHero as mountTandemHero2D } from "../../demos/solar/hero";
import { mountBandgapLossMap, mountSpectrumSplitter } from "../../demos/solar/spectrumFigs";
import {
  mountBandAlignment,
  mountLayerStack,
  mountSiliconArchitecture,
  mountTandemJV,
  mountTextureCoating,
} from "../../demos/solar/deviceFigs";
import { mountCostPerWatt, mountLifetimeEnergy, mountYieldArea } from "../../demos/solar/factoryFigs";

type Mount = (el: HTMLElement) => Demo | Promise<Demo>;

/** the GPU simulation where the browser has WebGPU; the 2D model figure it replaced where it doesn't */
const gpu =
  (sim: Mount, flat: Mount): Mount =>
  async (el) =>
    (await getDevice()) ? sim(el) : flat(el);

wirePage({
  hero: gpu(mountTandemHero, mountTandemHero2D),
  "tandem-tree": mountTandemTechTree,
  "bandgap-loss-map": gpu(mountPhotonSorter, mountBandgapLossMap),
  "spectrum-splitter": gpu(mountTwoGaps, mountSpectrumSplitter),
  "silicon-architecture": gpu(mountSiliconSurfaces, mountSiliconArchitecture),
  "layer-stack": mountLayerStack,
  "band-alignment": gpu(mountContactBarrier, mountBandAlignment),
  "tandem-jv": gpu(mountSeriesStack, mountTandemJV),
  "texture-coating": gpu(mountPyramidField, mountTextureCoating),
  "yield-area": mountYieldArea,
  "lifetime-energy": mountLifetimeEnergy,
  "cost-per-watt": mountCostPerWatt,
});
