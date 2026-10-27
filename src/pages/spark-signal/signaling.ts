import { wirePage } from "../../core/wirePage";
import { mountNeuronHero } from "../../demos/neuron/neuronHero";
import { mountMembranePotential, mountSpike } from "../../demos/neuron/membranePotential";
import { mountActionPotential } from "../../demos/neuron/actionPotential";
import { mountSynapse } from "../../demos/neuron/synapseDemo";
import { mountNeuronNetwork } from "../../demos/neuron/neuronNetwork";

wirePage({
  hero: mountNeuronHero,
  membrane: mountMembranePotential,
  spike: mountSpike,
  "action-potential": mountActionPotential,
  synapse: mountSynapse,
  network: mountNeuronNetwork,
});
