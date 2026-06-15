# Heliostat AAA upgrade — implementation audit

## Files changed

- `src/demos/light/heliostat.ts` — ALL pipeline + material + VFX work (sole code file modified).

No other code files were touched. `src/lib/stage3d.ts`, `src/pages/core/heliostat.ts`,
and `pages/core/heliostat.html` are unchanged.

## What I implemented, per step

### Imports
Added `PostProcessing` from `three/webgpu`; `pass`, `vec3`, `mix`, `float`,
`smoothstep` from `three/tsl`; `bloom` from
`three/addons/tsl/display/BloomNode.js`.

### 1. Environment reflections (PMREM)
Built a small procedural env scene in a scoped block: a BackSide sphere
(radius 10) with a vertical teal gradient (`MeshBasicNodeMaterial`, colorNode
`mix(bottomTeal, topTeal, …)`), one warm gold emissive plane card at
`(5.5, 4.0, 3.0)` and one green emissive plane card at `(-5.5, 2.5, -3.5)`, both
`lookAt(0,0,0)`. `new THREE.PMREMGenerator(stage.renderer)`, then
`try { stage.scene.environment = pmrem.fromScene(envScene, 0.2).texture } catch …`.
After the try, a null-check logs a warning and continues. `pmrem.dispose()` plus
all temp materials/geometries disposed.
- Env colors: bottomTeal `vec3(0.01,0.06,0.055)`, topTeal `vec3(0.05,0.22,0.2)`,
  warm card `vec3(1.6,1.0,0.45)`, green card `vec3(0.25,1.1,0.6)`. Sigma `0.2`.
- Expected outcome: PMREM succeeds (renderer already `init()`-ed by the stage).
  The runtime success/fallback is observable only in-browser; logic degrades
  gracefully either way. Orchestrator browser QA will confirm.

### 2. Tone mapping + post (Stage A) + seed re-tune
`stage.renderer.toneMapping = THREE.ACESFilmicToneMapping;`
`stage.renderer.toneMappingExposure = 1.0;`
`const post = new PostProcessing(stage.renderer);`
`const scenePass = pass(stage.scene, stage.camera);`
`const scenePassColor = scenePass.getTextureNode();`

Seed WGSL color constants re-tuned for ACES (which rolls saturated highlights
toward white). Before → after:
- `gold`: `vec3f(1.0, 0.72, 0.30)` → `vec3f(1.0, 0.60, 0.16)` (more saturated)
- `green`: `vec3f(0.42, 1.0, 0.70)` → `vec3f(0.28, 1.0, 0.58)` (more saturated)
- body term: `(0.35 + 0.9 * dif)` → `(0.35 + 1.05 * dif)`
- emissive heart: `core * 2.6` → `core * 4.2` (pushed HDR so it survives the
  roll-off and feeds bloom)
- rim glow: `green * fres * 0.7` → `green * fres * 1.0`
- breath: `(0.9 + 0.35 * sin(ph))` → `(0.95 + 0.22 * sin(ph))` (shallower so the
  peak doesn't blow out; still a single integer-`ph` term → seamless)

The alpha line (`clamp(max(col.r,...),0,1)`) is unchanged, so opacity stays
bounded while color goes HDR.

### 3. Frame reorder
Removed the early `camLocal` assignment. At end of `frame()`:
`stage.orbit.apply(stage.camera);` → recompute
`camLocal.value.set(cam.x, cam.y - SEED_Y, cam.z)` → `post.render()`. Fixes the
1-frame seed lag. `phaseU.value = phase` is still set early (no camera
dependency).

### 4. Bloom (Stage B)
`const bloomPass = bloom(scenePassColor, 0.4, 0.5, 0.9);`
`post.outputNode = scenePassColor.add(bloomPass);`
Chosen constants: strength `0.4`, radius `0.5`, threshold `0.9` (within the
plan's 0.3–0.5 / 0.4–0.6 / 0.8–1.0 budget; high threshold so only the HDR seed
core blooms).

### 5. Panels → MeshPhysicalNodeMaterial
`MeshPhysicalNodeMaterial` with metalness `0.6`, roughness `0.25`,
emissive `0x05382c` (intensity `0.6`), `clearcoat 1.0`,
`clearcoatRoughness 0.25`, `envMapIntensity 1.0`, `side: THREE.FrontSide`
(was DoubleSide). Per-instance brass→green `setColorAt` loop kept intact.
Iridescence IS ON as a separate, clearly-commented pair of lines:
`panelMat.iridescence = 0.3; panelMat.iridescenceIOR = 1.3;` — left in but
flagged for easy removal if the perf check shows <60fps.

### 6. Metals
- brass: roughness `0.28`→`0.22`, metalness `0.85`→`0.9`, `envMapIntensity 1.1`.
- darkMetal: roughness `0.35`→`0.3`, metalness `0.7`→`0.75`, `envMapIntensity 1.0`.
- paleBrass: roughness `0.22`→`0.18`, metalness `0.82`→`0.85`, `envMapIntensity 1.2`.

### 7. Sun-seed corona
One `THREE.Sprite` with a 256² canvas radial-gradient texture (warm gold center
→ transparent), `AdditiveBlending`, `depthWrite:false`, positioned at
`(0, SEED_Y, 0)`, `renderOrder = 1` (below `seed.renderOrder = 4`). Pulse driven
by `coronaPulse = 0.5 + 0.5*sin(phase)` (single integer-`ph` term → seamless):
scale `2.8 + 0.5*coronaPulse`, opacity `0.55 + 0.3*coronaPulse` (peak 0.85,
clamped well under clipping the SDF center).

### 8. Pollen → additive + per-instance variation
`moteMat` → white base, `AdditiveBlending`, `transparent`, `depthWrite:false`.
Per-instance `setColorAt`: base warm gold `0xffc870`, ~30% mixed toward green
`0x86ffba`, ~12% boosted ×2.2 as bright embers (rest ×0.55–1.05). Existing
curl-noise motion untouched.

### 9. Ground
Custom dark reflective disc: `MeshStandardNodeMaterial`, color
`vec3(0.024,0.07,0.058)`, roughness `0.3`, metalness `0.3`,
`envMapIntensity 1.0`, radial alpha fade via
`opacityNode = 1 - smoothstep(GR*0.25, GR*0.95, positionLocal.xy.length())`,
radius 6.0 at `y=0`, laid flat. Plus a soft dark contact blob
(`MeshBasicNodeMaterial`, black, radial fade ×0.5, radius ~1.65) at `y=0.012`.
Both placed below the base; do not occlude the sculpture.

## Loop discipline
Every new animated term is a single integer multiple of `phase`: corona pulse
`sin(phase)`, seed breath `sin(ph)`. No `performance.now`-based animation added
to any new visual element. Pollen colors/embers are static per-instance.

## Constants summary
- Bloom: strength 0.4, radius 0.5, threshold 0.9.
- Exposure: 1.0; toneMapping ACESFilmic.
- PMREM sigma: 0.2.
- Panel clearcoat 1.0 / clearcoatRoughness 0.25 / iridescence 0.3 / IOR 1.3.

## PMREM env: succeeded or fell back?
Logic-level: built with try/catch + null assert + graceful fallback. Renderer is
already initialized, so PMREM is expected to succeed. Definitive
success/fallback is only observable at runtime in the browser — deferred to the
orchestrator's QA pass.

## Iridescence
ON (0.3, IOR 1.3), on a dedicated commented line for one-edit removal pending the
perf check.

## Typecheck
`npm run typecheck` → clean (no errors).

## Deviations from the plan
- None material. Bloom/exposure/material constants all fall inside the plan's
  stated budgets. Ground disc radius (6.0) and contact-blob sizing are local
  choices within the plan's "custom reflective disc" option; the plan permitted
  falling back to `addGroundDisc` but the custom disc was straightforward.

## Open risks
- Perf on the WebGL2 fallback path with `MeshPhysicalNodeMaterial` +
  iridescence + bloom is unmeasured here (no dev server / screenshots per
  instructions). If <60fps, cut order per plan: iridescence → physical→standard
  panels → bloom resolution → pollen count.
- Bloom threshold 0.9 vs the re-tuned HDR seed (`core * 4.2`): if the seed center
  reads as a clipped white disc in QA, lower exposure or raise threshold toward
  1.0.
- Corona over the additive seed: peak opacity 0.85 should not clip the SDF
  center, but confirm visually in a paused screenshot.

## QA polish pass

Browser QA passed (103–125 fps, env reflections + bloom working, no errors).
Three follow-up fixes, all in `src/demos/light/heliostat.ts` only:

1. Corona ring artifact — the 3-stop radial gradient (0.0 / 0.35 / 1.0) had a
   visible hard edge that read as a thin ring outline. Replaced it with a
   24-stop loop on a gaussian ease-out (`exp(-3·t²)`) multiplied by an
   `edgeFade = 1 - t` term so alpha falls monotonically to exactly 0 at the
   outer radius — no ring boundary. Color warms from gold core (255,196,110)
   toward amber rim (255,120,40). Size/pulse behavior, warm gold tint, and
   `AdditiveBlending` unchanged.
2. PMREM sigma warning — `pmrem.fromScene(envScene, 0.2)` requested 98 samples
   vs the 20-sample cap (clip warning). Lowered sigma to `0.04`. The env is a
   smooth low-freq gradient + 2 soft emissive cards, so the sharper blur does
   not band; it just sharpens directional reflections.
3. PostProcessing deprecation — `THREE.PostProcessing` is renamed to
   `RenderPipeline`. Swapped the import (`RenderPipeline` from `three/webgpu`)
   and the constructor (`new RenderPipeline(stage.renderer)`). outputNode, pass,
   bloom, and `.render()` are identical.

`npm run typecheck` clean after the changes. Dev server not started.
