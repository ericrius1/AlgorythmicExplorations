# Bonfire — native Metal

The blog's radiance-cascades bonfire (part two of *Light in a Browser Tab*),
rebuilt as a fullscreen native macOS app. Same algorithm — emission/occlusion
scene → jump flood → distance field → cascade march with sky merge →
composite, multi-bounce via last frame's cascade 0 — plus everything the
browser couldn't reach:

- **EDR / HDR output** — rgba16float drawable in extended linear Display P3.
  On an XDR display the flame is genuinely brighter than white; tone mapping
  targets the display's actual EDR headroom each frame.
- **120 Hz ProMotion**, GI resolution and ray-step count on sliders instead of
  hardcoded (web: fixed canvas/2.5, 28 steps).
- **Up to 65,536 embers** (web: 8,192), every one a light and an occluder.
- **Post chain**: bloom (bright pass + Gaussian), heat shimmer above the fire,
  a lit smoke column, film grain, vignette.
- **Moonlight** — a dim directional source in the top-cascade sky, for cool
  rim light and a second set of soft shadows.
- **Night air** — exponential absorption of the GI wash in empty pixels. In
  2D cascades a hit returns full emission at any distance, so a fullscreen
  night sky otherwise washes gray; this is the cheap stand-in for the
  participating media the blog deferred to "next part".

## Run

```sh
swift run -c release
```

Launches straight into fullscreen.

## Controls

| input | action |
|---|---|
| mouse move / drag | stir the wind |
| hold click | shed embers at the cursor |
| `tab` | toggle settings panel |
| `space` | pause |
| `f` / `esc` | toggle / leave fullscreen |
| `cmd+q` | quit |

The settings panel has the full set: embers, wind, bounce strength, time of
day (night → dusk → day), fire size, glow, exposure, bloom, smoke, night air,
heat shimmer, grain, vignette, HDR toggle, render scale, ray steps, and the
debug views from the blog (scene / occupancy / distance field / light only).

## Headless debugging

```sh
BONFIRE_SNAPSHOT=/tmp/frame.png swift run -c release   # writes a frame, exits
```

`BONFIRE_STATS=1` prints linear pixel samples + fps. `BONFIRE_DEBUG`,
`BONFIRE_TOD`, `BONFIRE_SMOKE`, `BONFIRE_BLOOM`, `BONFIRE_EMBERS`,
`BONFIRE_GLOW`, `BONFIRE_NIGHTAIR` override the matching settings.
