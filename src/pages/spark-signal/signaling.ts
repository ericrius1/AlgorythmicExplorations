import { wirePage } from "../../core/wirePage";
import { mountMembranePotential } from "../../demos/neuron/membranePotential";
import { mountActionPotential } from "../../demos/neuron/actionPotential";
import { mountSynapse } from "../../demos/neuron/synapseDemo";
import { mountNeuronNetwork } from "../../demos/neuron/neuronNetwork";

wirePage({
  membrane: mountMembranePotential,
  "action-potential": mountActionPotential,
  synapse: mountSynapse,
  network: mountNeuronNetwork,
});
