# Small Minds × Google Colab A100 Compute Pack

Zero Google Drive storage required — every notebook streams data directly into Colab's ephemeral VM, trains on **A100 / L4 / T4 GPUs** (with Colab Ultra **24h background execution**), quantizes to compact `.smw` (Small Minds Weights, Q8 ~3.6× smaller), and downloads a tiny `.zip` straight to your laptop.

---

## Notebooks

### 1. Companion Brain Pre-Trainer & Species Fine-Tuner
- **File:** [`small_minds_companion_trainer.ipynb`](small_minds_companion_trainer.ipynb)
- **Open in Colab (1-click after pushing to GitHub):**
  `https://colab.research.google.com/github/ericrius1/AlgorythmicExplorations/blob/main/colab/small_minds_companion_trainer.ipynb`
- **What it does:**
  1. Streams clean cozy English stories (`roneneldan/TinyStories`) + conversational dialogue and pre-trains a bit-exact `SmallMindsTransformer` (presets: **324K compact**, **780K balanced [default]**, or **1.8M rich**) in `bf16` + `torch.compile` (~5–12 min on A100 80GB).
  2. *(Optional — uses ~$0.10 of your $40/mo Gemini API credit)* Calls **Gemini 2.5 Flash** to generate 400–800 bespoke in-character `user: ... / pet: ...` exchanges for all 6 companions (**Mochi, Kitsune, Pebble, Pip, Bramble, Luma**) — or runs with a built-in zero-key synthetic corpus.
  3. Fine-tunes all 6 distinct species checkpoints (~30 sec each on A100), lets you chat with every companion right inside Colab, packs Q8 `.smw` files (~850 KB each), and downloads `small-minds-models.zip`.

### 2. Overnight A100 AutoResearch Lab (Background Execution)
- **File:** [`small_minds_autoresearch_a100.ipynb`](small_minds_autoresearch_a100.ipynb)
- **Open in Colab:**
  `https://colab.research.google.com/github/ericrius1/AlgorythmicExplorations/blob/main/colab/small_minds_autoresearch_a100.ipynb`
- **What it does:**
  - Runs Karpathy-style autonomous architecture & optimizer search (Hill Climb / UCB Bandit / Evolutionary) over dozens or hundreds of timed A100 trials: **SwiGLU vs. GeGLU**, **AdamW vs. real Newton-Schulz Muon**, width/depth/FFN ratios (all constrained to `headDim <= 32` for WebGPU FlashAttention parity!), RoPE `θ`, learning rate, weight decay, and cosine warmdown.
  - Plots the live Pareto frontier + mutation-axis win rates and downloads `small-minds-autoresearch.zip` containing `autoresearch-results.json` and `autoresearch-best.smw`.

---

## Recommended Colab Runtime Setup (Google AI Ultra)

1. Open either notebook in Google Colab (via the GitHub link above or `File → Upload notebook`).
2. **Runtime → Change runtime type → `A100 GPU`** (or `L4` for fast cheap runs).
3. Turn on **Runtime → Manage sessions / Background execution** if you want the overnight AutoResearch sweep to keep running with your laptop closed.
4. *(Optional)* In the left sidebar **🔑 Secrets**, add `GEMINI_API_KEY` (funded by your $40/mo AI Studio Cloud credit) so Stage 2 generates rich, original species dialogue for all 6 pets.

---

## Loading Your Trained `.smw` Brains into Small Minds

### Instant test (zero rebuild!)
1. Unzip `small-minds-models.zip`.
2. Open Part 5 ([`pages/small-minds/companion.html`](../pages/small-minds/companion.html)) → **Brain Peek** tab → click **Load `.smw` Brain** and pick any species file (e.g. `mochi.smw`) — it mounts straight onto your browser's WebGPU buffers and starts chatting immediately.
3. You can also load any `.smw` checkpoint (including `autoresearch-best.smw`) into Part 3 ([`pages/small-minds/training.html`](../pages/small-minds/training.html)) via **load .smw**.

### Ship permanently on the site (zero cloud storage lock-in!)
Drop the `.smw` files into:

```text
public/models/small-minds/
  companion-base.smw
  mochi.smw
  kitsune.smw
  pebble.smw
  pip.smw
  bramble.smw
  luma.smw
```

`PetBrain` automatically detects `public/models/small-minds/<speciesId>.smw` (falling back to `companion-base.smw`, then to the instant in-browser warm-start if absent). All 6 Q8 brains at 780K params total ~5 MB raw (~3.5 MB gzipped), hosted statically with the rest of your site.
