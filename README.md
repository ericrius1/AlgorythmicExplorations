# Algorythmic Explorations

[Source on GitHub](https://github.com/ericrius1/AlgorythmicExplorations) ·
[Live site](https://www.ericlevin.dev/algorythmicexplorations/)

Interactive essays where every figure is a live simulation, mostly WebGPU. 10 series, 39 essays.

**Particle Worlds**: A step-by-step n-body simulation, from two falling dots to 300,000 gravitating bodies.

1. [Two Falling Dots](pages/particle-worlds/part1.html)
2. [Gravity on a Dome](pages/particle-worlds/part2.html)
3. [Sorting Water](pages/particle-worlds/part3.html)
4. [Worlds from Dust](pages/particle-worlds/part4.html)
5. [Gravity in Frequency Space](pages/particle-worlds/part5.html)
6. [The Fluid Instrument](pages/particle-worlds/part6.html)

**Firework Systems**: A WebGPU fireworks renderer designed around GPU-owned particles, compact emit commands, and live-list drawing.

1. [Fireworks at GPU Scale](pages/firework-systems/gpu-fireworks.html)

**Dome Projection**: Fulldome projection math from polar coordinates to fisheye maps, projector cameras, calibrated blends, and realtime render paths.

1. [The Circle Under the Dome](pages/dome-projection/circle.html)
2. [The Fisheye Map](pages/dome-projection/fisheye.html)
3. [Six Square Cameras](pages/dome-projection/cubemap.html)
4. [The Dome Show](pages/dome-projection/show.html)
5. [Dome-Native Three.js](pages/dome-projection/realtime.html)

**Bounced Light**: Light transport through radiance cascades, participating media, sphere tracing, path tracing, and spectral refraction.

1. [The Lava Lamp](pages/bounced-light/lava.html)
2. [The Bonfire](pages/bounced-light/bonfire.html)
3. [The Fog](pages/bounced-light/fog.html)
4. [Leaving Flatland](pages/bounced-light/flatland.html)
5. [The Cornell Box](pages/bounced-light/cornell.html)
6. [The Prism](pages/bounced-light/prism.html)

**Strange Matter**: A magnetic liquid that grows spikes — its surface remeshed every frame, its particles taught to magnetize each other.

1. [The Ferrofluid](pages/strange-matter/ferro.html)
2. [The Crown](pages/strange-matter/crown.html)
3. [Sharp Relief](pages/strange-matter/relief.html)

**Living Music**: Interactive explanations of sound, tuning, scales, chords, rhythm, and generative accompaniment.

1. [The Anatomy of a Note](pages/living-music/vibration.html)
2. [The Synthesizer](pages/living-music/synth.html)
3. [Consonance and Roughness](pages/living-music/harmony.html)
4. [Twelve Imperfect Notes](pages/living-music/twelve.html)
5. [Seven of Twelve](pages/living-music/scales.html)
6. [Major and Minor](pages/living-music/chords.html)
7. [The Infinite Jukebox](pages/living-music/jukebox.html)
8. [The Accompanist](pages/living-music/accompanist.html)

**Acoustic Spaces**: Rooms as instruments: echoes, reverberation, materials, room modes, binaural hearing, and a room that plays music.

1. [Rooms That Play Back](pages/acoustic-spaces/acoustic-space.html)
2. [The Room Instrument](pages/acoustic-spaces/room-instrument.html)

**Ground Truth**: Procedural terrain built from noise, erosion, instanced grass, trees, biomes, and streamed chunks.

1. [The Heightfield](pages/ground-truth/heightfield.html)
2. [The Rain](pages/ground-truth/erosion.html)
3. [The Grass](pages/ground-truth/grass.html)
4. [The Trees](pages/ground-truth/trees.html)
5. [The Biomes](pages/ground-truth/biomes.html)
6. [The Horizon](pages/ground-truth/horizon.html)

**Solar Stack**: Perovskite-on-silicon tandem solar cells, worked through photon by photon in live GPU simulations: bandgaps, current matching, silicon surfaces, contacts, texture, yield, lifetime and cost.

1. [The Tandem Tree](pages/solar-stack/tandem-tree.html)

**Spark & Signal**: Neurons, action potentials, synaptic transmission, and small circuits — explained with live simulations.

1. [How Neurons Signal](pages/spark-signal/signaling.html)

## How it's built

Each essay is a plain HTML file under `pages/<series>/` with a TypeScript entry
under `src/pages/<series>/` that mounts its figures. Figures live in
`src/demos/` (by subject), shared code in `src/lib/`, WGSL in `src/shaders/`,
and per-series styles in `src/styles/`.

- Site navigation (top bar, post menu, read-next cards) is injected by
  `src/lib/siteNav.ts` from the registry in `src/lib/posts.ts`. The bar opens
  with the way home to ericlevin.dev, the portfolio's mark (`src/lib/home.ts`,
  a copy of the one every project there shares). Adding a post
  means writing the HTML, adding its entry TS that calls `initNav()` (or `wirePage()`), and
  registering it in `posts.ts`. Vite collects every HTML file under `pages/`.
- Rendering: `src/lib/postfx.ts` (HDR, bloom, filmic tone mapping) is shared
  by the particle, path-tracing and radiance-cascade renderers.
- Solar Stack's GPU figures run on Spark & Signal's stage (`src/lib/neuron/stage.ts`) and share
  `src/lib/solar/`: a photon-and-carrier engine (photons drawn from the sun's spectrum, stopped at
  Beer–Lambert depths, electron–hole pairs collected or recombined) whose readouts are tallies,
  checked against the detailed-balance model in `src/demos/solar/physics.ts`. Without WebGPU each
  falls back to the 2D model figure it replaced.
- Music: `src/lib/music/` is the shared audio toolkit (safe master chain with
  a limiter, instrument presets, QWERTY/MIDI input, scope/spectrum/spectrogram
  views); see its README. `src/lib/audio.ts` exports Tone.js and the master bus.
- `tools/shot.mjs` takes headless screenshots of a page's figures (muted,
  WebGPU on) for checking work without a visible browser.

```bash
npm install
npm run dev        # http://localhost:5173 (or --port of your choice)
npm run build      # typecheck + production build
```

The site is served under `/algorythmicexplorations/` on www.ericlevin.dev;
links in the HTML stay root-relative and the build prefixes them.

GPU figures need a WebGPU browser (Chrome/Edge 113+, recent Safari). Figures
only run while scrolled into view, and audio starts only after a tap.

## License

MIT License
