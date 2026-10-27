import { wirePage } from "../../core/wirePage";
import { mountLivingNeuron } from "../../demos/neuron/livingNeuron";
import { mountIonPatch } from "../../demos/neuron/ionPatch";
import { mountAxonRace } from "../../demos/neuron/axonRace";
import { mountSynapse3D } from "../../demos/neuron/synapse3d";
import { mountNetwork } from "../../demos/neuron/network";

wirePage({
  hero: (el) => mountLivingNeuron(el, { hero: true }),
  anatomy: (el) => mountLivingNeuron(el, { labels: true }),
  "ions-rest": (el) => mountIonPatch(el, { mode: "rest" }),
  "ions-spike": (el) => mountIonPatch(el, { mode: "spike" }),
  "axon-race": mountAxonRace,
  synapse3d: mountSynapse3D,
  cortex: mountNetwork,
});
