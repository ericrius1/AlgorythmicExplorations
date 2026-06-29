# Algorythmic Explorations

[Source on GitHub](https://github.com/ericrius1/AlgorythmicExplorations)

Three interactive series of articles with live WebGPU demos.

**Particle Worlds** — a six-part series that builds particle simulators step by step,
one data structure per article. Part one (`index.html`) goes from two falling
dots to a GPU-resident Barnes–Hut pyramid running half a million bodies live
in the page. Part two (`part2.html`) promotes the solver to 3D — quadtree to
octree — and bends a galaxy over a hemispheric dome. Part three (`part3.html`)
switches from gravity to contact forces: GPU counting sort, parallel prefix
sums, and interactive SPH water. Part four (`part4.html`) runs part one's
pyramid and part three's grid over the same buffer — dust attracts, collides,
sticks, and grows moons. Part five (`part5.html`) solves gravity in frequency
space: a WGSL Stockham FFT, Poisson's equation as one division per wave,
Zel'dovich initial conditions, and the cosmic web condensing in an expanding
periodic box. Part six (`part6.html`) turns the whole series into a toy: a 64³
stable-fluids solver (semi-Lagrangian advection + Jacobi-projected pressure),
curl-noise wind, half a million stylized paint particles with HDR trails, and
optional webcam hand tracking (`@svenflow/micro-handpose`) so you conduct the
fluid with your hands. Companion piece to the `nbody` WebGPU lab (sibling
folder).

**Bounced Light** — a new series about simulating light itself.
Part one (`lava.html`) is a lava lamp: the SPH stack from part three grows a
per-particle temperature (heated by a coil, cooled at the top, conducted
between neighbours) that drives rest density and buoyancy; metaballs turn
particles into wax whose emission follows its temperature; and the scene is
lit by 2D **radiance cascades** (Sannikov) — jump-flood distance field,
hierarchical probe cascades, real bounced light with shadows. Includes a
paint-with-light sandbox demo of the bare algorithm.
Part two (`bonfire.html`) spends what part one built: thousands of ember
particles on curl-noise wind, each a true light source at no added cost;
multi-bounce color bleeding from a one-frame temporal feedback loop
(albedo × last frame's fluence); the sky as the top cascade's merge; and
optional hand tracking so your fingertip sheds embers.
Part three (`fog.html`) adds **participating media** to the cascades:
Beer–Lambert extinction integrated along every cascade ray, fog whose glow
is last frame's fluence (multiple scattering via the same one-frame time
loop), and god rays that emerge as lit fog standing next to shadowed fog.
Part four (`flatland.html`) leaves 2D by making the distance field a
*function* instead of a texture: sphere-traced analytic SDFs, smooth-minimum
sculpture, penumbras from near misses, ambient occlusion, and a step-count
heatmap that makes the cost visible. Part five (`cornell.html`) pays part
four's debts honestly: a progressive WebGPU path tracer aimed at the Cornell
box — Monte Carlo, next-event estimation toggled live, bounce-depth slider,
movable area light, mirror/glossy materials. Part six (`prism.html`) is the
toy finale: a 2D Newton's-prism optics bench, then a **spectral** path
tracer (one random wavelength per sample, Cauchy dispersion, Fresnel coin
flips) producing real caustics, rainbow caustics, and thin-lens depth of
field.

**Living Music** — a seven-part music theory series where every figure
makes real sound (Tone.js) and every visual is a WebGPU fragment shader fed by
live analyser data. Part one (`vibration.html`) dissects a single note: an
oscilloscope you can play, a wave-equation string you pluck (audio synthesized
from its modal decomposition), and additive-synthesis drawbars. Part two
(`harmony.html`) derives consonance: beats, Lissajous figures of interval
ratios, and the Plomp–Levelt dissonance curve computed live over two 8-partial
tones. Part three (`twelve.html`) stacks fifths into a spiral that misses by
the Pythagorean comma, lets you temper it shut, A/Bs just vs equal-tempered
chords with beat-rate lights, and charts why 12-TET wins. Part four
(`scales.html`) treats scales as rotating ring patterns (modes, with a drone)
and the circle of fifths as a map of key distance. Part five (`chords.html`)
puts triads under a harmonic-alignment microscope (with a clickable piano) and
runs four-chord loops through a minimal-motion voice-leading search with a
live tension lane. Part six (`jukebox.html`) assembles the series into a
generative band: Euclidean drums, a gravity-guided random-walk melody, a
seeded progression grammar, and an FFT-driven nebula. Part seven
(`accompanist.html`) turns the theory around: play notes and a live
accompanist infers key, harmony, restraint, and response.

**Acoustic Spaces** — a spatial-audio series about rooms as instruments. Part
one (`acoustic-space.html`) builds a probe-based acoustic system with direct
audibility, sparse routed paths, material transmittance, media loss, and
band-limited control buses. Part two (`room-instrument.html`) turns the same
ideas into a shareable music toy: drag sound stones, a listener, a wall, and
water to compose a room, then copy a link that restores the creation.

Music-series plumbing: `src/lib/audio.ts` (shared Tone.js master bus +
analysers, lookahead StepClock, music math), `src/lib/shaderCanvas.ts`
(fullscreen-shader ShaderView — each figure supplies one WGSL `scene()`
colocated in its demo file), `src/lib/piano.ts` (DOM keyboard widget).

Site navigation (top bar, post menu, read-next cards) is injected by
`src/lib/siteNav.ts` from the registry in `src/lib/posts.ts` — adding a post
means: write the `*.html`, add a `src/<name>.ts` entry that calls `initNav()`,
and register it in `posts.ts`. Vite collects every HTML file under `pages/`
automatically.

```bash
npm install
npm run dev        # http://localhost:5173 (or --port of your choice)
npm run build      # typecheck + production build
```

Structure:

- `index.html` / `part2.html` / `part3.html` / `part4.html` / `part5.html` /
  `part6.html` — the articles. All prose lives there.
- `src/demos/` — the figures, named by what they teach: part one's
  `slingshot` → `naiveCpu` → `naiveGpu` → `barnesHut` → `pyramidLevels` →
  `pyramidGpu`; part three's `contactsCpu` → `gridNeighbors` → `scanViz` →
  `hashNeighbors` → `fluidGpu`; part four's `accretionGpu`; part five's
  `fourierDraw` → `poissonPaint` → `fftButterfly` → `cicDeposit` → `cosmoGpu`;
  part six's `flowField` (curl noise) → `handViz` (webcam landmarks) →
  `playground` (the stable-fluids toy, also the hero).
- `src/demos3d/` — part-two figures: `naive3dGpu` (brute force with an orbit
  camera) and `pyramid3dGpu` (octree pyramid; also drives the dome-morph and
  hero demos via options).
- `src/lib/` — shared shell (lazy mount, sliders, fps), CPU physics, WebGPU
  device/renderers, orbit camera, the 2D/3D pyramid solvers, the counting-sort
  pipelines, the particle-mesh/FFT solver, Zel'dovich seeding, and the
  micro-handpose wrapper (`hands.ts`: webcam, smoothing, pinch/spread).
- `src/shaders/` — WGSL: tiled naive kernels (2D/3D), particle renderers,
  the implicit pyramid pipelines, counting-sort and SPH kernels, the Stockham
  FFT, the particle-mesh pipeline, and part six's stable-fluids grid +
  trail renderer (`playground.wgsl`, `render6.wgsl`).

GPU demos need a WebGPU browser (Chrome/Edge 113+, recent Safari); CPU demos
work everywhere. Demos only run while scrolled into view.

## License

MIT License
