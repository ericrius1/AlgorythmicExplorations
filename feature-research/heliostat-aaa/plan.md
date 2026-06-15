# Heliostat — prototype → premium (AAA) visual upgrade  (revised post-review)

Director skill route: AAA graphics builder + QA/release. Subject is a procedural
kinetic art piece (not a game), so game scorecard categories are *mapped* to the
artwork (mapping at bottom). External 3D/image/audio generation is **blocked**:
credential probe shows `TRIPO_API_KEY`, `GEMINI_API_KEY`, `ELEVENLABS_API_KEY` all
MISSING — and the premise is "generated live in WebGPU", so static GLB/textures
would break the 12s seamless loop. Procedural-only is the correct + only path.

## Goal

Lift the heliostat from flat-lit prototype to a cinematic, premium WebGPU scene
while preserving: the 12-second seamless loop, WebGPU→WebGL2 fallback, drag-orbit,
pause/restart, and the two signature techniques (curl-noise wind, SDF sun-seed).

## Current state (verified)

- `stage3d.ts`: `new WebGPURenderer` per mount (each demo gets its OWN renderer
  instance), `antialias:true`, `pixelRatio 1`. **No tone mapping, no post, no env
  map, no shadows.** Gradient sky node, hemi + 2 directional lights.
- `heliostat.ts`: MeshStandard brass/dark/paleBrass, 150 instanced flat-hex panels
  (per-instance brass→green color, `DoubleSide`), SDF sun-seed (additive, reads
  `camLocal`), 180 flat-icosahedron pollen (MeshBasic gold), 2 point lights.

## Key technical decisions (revised)

1. **All changes live in `heliostat.ts`; `stage3d.ts` NOT touched.** Honest framing
   (per review): this is lower *coordination* cost, slightly higher *coupling* — the
   demo replicates `stage.render()`'s two lines. Accepted because (a) `createStage3D`
   builds a fresh `WebGPURenderer` per mount, so setting `renderer.toneMapping` is
   scoped to THIS demo's renderer and cannot leak to bird/bear/terrain; (b) threading
   opt-in flags through the shared chassis while 3 other demos sit uncommitted in the
   tree is the bigger hazard. Per frame: `stage.orbit.apply(stage.camera)` →
   **then** update `camLocal` → **then** `post.render()`.

2. **camLocal ordering (correctness fix from review).** Today `camLocal` is set in
   `frame()` *before* `stage.render()` (1-frame camera lag, currently invisible). In
   the new order we MUST: `orbit.apply(camera)` first, recompute `camLocal` from the
   now-updated camera, then `post.render()`. Otherwise the SDF seed lags a frame.

3. **Render pipeline — sequenced (the biggest uplift, landed in stages).**
   - **Stage A (land + verify before any VFX):** tone mapping +
     `PostProcessing(pass(scene,camera))`, NO bloom yet. `renderer.toneMapping =
     ACESFilmicToneMapping`, `toneMappingExposure ≈ 1.0`. `PostProcessing`
     (`three/webgpu`) default `outputColorTransform=true` applies tone map + sRGB once
     at output. **ACES renders the scene linear then tonemaps once → it WILL
     desaturate/roll the additive seed highlights.** So Stage A includes re-tuning the
     seed WGSL color constants (`core` multiplier, gold/green weights, the
     `0.9+0.35*sin(ph)` breath) under ACES so the molten heart still reads. Tune once,
     here — not twice.
   - **Stage B:** add `bloom(scenePassColor, strength, radius, threshold)`
     (`three/addons/tsl/display/BloomNode.js`), `outputNode = scenePassColor.add(bloom)`.
     **Explicit bloom budget:** `threshold ≈ 0.8–1.0` (only the genuinely-HDR seed
     core blooms, not every mote), `strength ≈ 0.3–0.5`, `radius ≈ 0.4–0.6`. Verify in
     a PAUSED screenshot that the SDF center detail (AO, penumbra, smin seams) still
     reads and is not a clipped white disc.
   - **No film grain** (cut — loop-seam + darkness-stacking hazard). Vignette: rely on
     the existing CSS vignette; no added TSL vignette.

4. **Environment reflections — deterministic, not hopeful (review fix).**
   Build a small procedural gradient env scene (teal dome + one warm sun card + one
   green fill card). `const pmrem = new THREE.PMREMGenerator(stage.renderer);` then
   `try { scene.environment = pmrem.fromScene(envScene, 0.2).texture } catch { … }`.
   **sigma = 0.2** (review: 0.04 is near-mirror and shows the crude 3-card scene as
   banding on brass). After building, assert `scene.environment != null`; if the
   build threw or is null, log it and leave metals on the emissive+bloom look
   (`envMapIntensity` paths degrade gracefully). Decided once at mount → QA
   screenshots stay deterministic.

5. **Materials.**
   - Panels → `MeshPhysicalNodeMaterial`, **baseline = clearcoat + env reflections
     only** (keep per-instance brass→green color, subtle emissive). Clearcoat + the new
     env already reads as "solar glass". **Iridescence is NOT baseline** — it is the
     expensive, hue-shifting term that fights ACES + bloom for control of the panel
     color; add a LOW-intensity iridescence pass only if post-change measurement shows
     ≥60fps headroom on the WebGL2 path. Once env reflections exist, switch panels to
     `side: FrontSide` (DoubleSide doubles fragment cost on the hero geometry that
     overlaps heavily at the dish center).
   - brass / paleBrass / darkMetal → keep MeshStandard, nudge roughness down slightly,
     set `envMapIntensity` so the new env gives them reflections.

6. **Sun-seed corona.** Add ONE camera-facing additive radial-gradient billboard
   behind the seed (`renderOrder` below seed), alpha/scale pulsing on `phase`
   (seamless). **Clamp peak color ≤ ~1.5 and alpha ≤ 1** so it feeds bloom without
   clipping to white over the SDF center. Optional tiny bump to the WGSL `core` term
   (integer-phase only → seamless), done as part of Stage A re-tuning.

7. **Pollen.** Mat → additive, warm→green brightness variation so a few read as bright
   embers; bloom turns them into drifting light motes. **Background depth-glint layer
   CUT** (review: low payoff behind `fog.far:26`, new loop-seam surface). World depth
   instead comes from env + ground + existing fog/sky.

8. **Grounding.** Add a subtle reflective dark ground disc + soft fake contact shadow
   under the base (reuse `addGroundDisc` from stage3d, or a local node variant). No
   dynamic shadow maps.

9. **Loop discipline (review).** Grain is STATIC (or omitted). Every new motion term
   must be `k * phase` with integer `k`. Acceptance check: diff first frame vs frame at
   exactly `LOOP_SECONDS` (sample canvas pixels paused at phase 0 and phase 2π).

10. **Performance — corrected cut order (review).** The iridescent/physical panels are
    the real cost driver, not bloom. If FPS drops below 60 on the WebGL2 path, cut in
    THIS order: (1) iridescence→clearcoat-only, then panels→MeshStandard; (2) reduce
    bloom resolution; (3) reduce pollen count. Measure `renderer.info` (calls /
    triangles) + FPS before and after via `preview_eval`.

## Verification (QA phase)

- `npm run typecheck` clean.
- Dev server (running, port 65155). Console + page error check.
- Active-play screenshots: ≥3 orbit angles + paused state, desktop + mobile (375px).
- Nonblank canvas pixel check; `renderer.info` diagnostics before/after.
- Seamless-loop check: paused phase-0 vs phase-2π pixel compare.
- Fill the 10-category visual scorecard (mapped), report average + auto-failures.

## Files touched

- `src/demos/light/heliostat.ts` — ALL pipeline + material + VFX work (sole code file).
- `feature-research/heliostat-aaa/plan.md`, `…/audit.md` — process docs (not shipped).
- **NOT touched:** `src/lib/stage3d.ts`, `src/pages/core/heliostat.ts`,
  `pages/core/heliostat.html` (HTML dropped from scope per review — no concrete change
  named).

## Revisions from reviewer critique

Accepted: (1) sequence tone-mapping before VFX + re-tune seed WGSL under ACES;
(2) explicit bloom budget threshold 0.8–1.0 / strength 0.3–0.5 / radius 0.4–0.6 +
protect SDF center; (3) deterministic PMREM try/catch + null assert, sigma 0.2;
(4) fix camLocal-after-orbit-apply ordering; (5) static/omitted grain + integer-phase
loop terms + first/last-frame acceptance check; (6) reorder perf cuts so physical
panels drop first; (7) cut background glints; (8) cut film grain; (9) iridescence
demoted to measured-headroom-only, clearcoat+env baseline; (10) panels→FrontSide once
env exists; (11) drop HTML from Files touched; (12) reword in-demo justification as
lower-coordination/higher-coupling, not "lower risk".

Rejected / modified: **none outright.** Iridescence is kept as an *optional measured
add-on* rather than fully cut — the dichroic sheen is the signature solar-punk look, so
it stays on the table contingent on the 60fps headroom check, not removed.

## Scorecard category mapping (art piece, not a game)

- Hero/player → SDF sun-seed + corona.
- Obstacles/enemies → N/A as adversaries; scored as the phyllotaxis panel dish
  (silhouette variety / structural cast of forms).
- Rewards/interactables → pollen motes.
- World/environment → ground, fog, sky gradient, env reflections.
- UI/HUD → title card + pause/restart controls + loop readout.
- Art direction, Materials, Lighting/render, VFX/motion, Performance → direct.

## Todo

- [ ] Procedural gradient env scene + PMREM(sigma 0.2) → scene.environment (try/catch+assert).
- [ ] Stage A: ACES tone mapping + PostProcessing(pass), NO bloom; re-tune seed WGSL.
- [ ] Per-frame reorder: orbit.apply → recompute camLocal → post.render().
- [ ] Stage B: add bloom (threshold 0.8–1.0 / strength 0.3–0.5 / radius 0.4–0.6).
- [ ] Panels → MeshPhysicalNodeMaterial (clearcoat + env, FrontSide); iridescence only if headroom.
- [ ] Brass/metal roughness + envMapIntensity tuning.
- [ ] Sun-seed corona billboard (clamped) + optional WGSL core bump.
- [ ] Pollen additive + brightness variation.
- [ ] Reflective ground disc + contact shadow.
- [ ] Verify: typecheck, console, renderer.info before/after, loop pixel-compare,
      active-play screenshots (desktop+mobile), fill scorecard.
