// The lamp itself: temperature SPH → metaball splat → scene (emission +
// occlusion) → radiance cascades → full-resolution display pass → bloom and
// tone mapping. The cursor stirs the wax.

import renderShader from "../../shaders/lavarender.wgsl?raw"
import { Shell, gpuMissing, type Demo } from "../../lib/demoShell"
import { getDevice, configureContext } from "../../lib/gpu"
import { PostFX, HDR_FORMAT } from "../../lib/postfx"
import { LavaSim, LAMP, DEFAULT_KNOBS, H, type LavaKnobs } from "../../lib/lavaSim"
import { RadianceCascades } from "../../lib/radianceCascades"

const VIEWS = ["final", "scene (what the rays see)", "distance field", "light only"]
const VIEW_MODES = [0, 1, 3, 4] // RadianceCascades composite debug modes

function inputFocused(): boolean {
  const el = document.activeElement
  if (!el) return false
  const tag = el.tagName
  return tag === "INPUT" || tag === "TEXTAREA" || (el as HTMLElement).isContentEditable
}

export interface LavaLampOptions {
  hero?: boolean
  full?: boolean // sliders + debug views
}

// The lamp's motion: slow and steady rather than lively. The hero and the
// sandbox share these; the sliders start from them.
export const LAMP_KNOBS: LavaKnobs = {
  ...DEFAULT_KNOBS,
}

export async function mountLavaLamp(container: HTMLElement, opts: LavaLampOptions): Promise<Demo> {
  const dev = await getDevice()
  // the lamp is tall and narrow: on a phone-width hero give it a taller frame
  const narrow = (container.clientWidth || window.innerWidth) < 600
  const aspectRatio = opts.hero ? (narrow ? 0.95 : 0.52) : narrow ? 0.9 : 0.66
  const shell = new Shell(container, aspectRatio)
  if (!dev) return gpuMissing(container)
  const ctx = configureContext(shell.canvas, dev)
  const post = new PostFX(dev, ctx)
  post.settings.exposure = 1.8
  post.settings.bloom = 0.22
  post.settings.radius = 1.0
  post.settings.vignette = 0.3

  // a phone-width hero sits under a taller nav bar: pull back a little and
  // frame the lamp lower so the cap isn't hidden behind it
  const phoneHero = !!opts.hero && narrow
  const viewScaleY = phoneHero ? 0.74 : 1.05
  const viewY = phoneHero ? 0.2 : -0.02
  const viewScale: [number, number] = [1, viewScaleY]

  // Light transport runs at a fraction of the canvas: light is smooth, and
  // the display pass redraws every edge at full resolution anyway.
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const rcDiv = Math.max(2, 1.6 * dpr)
  const rcSize = (w: number, h: number): [number, number] => [Math.floor(w / rcDiv), Math.floor(h / rcDiv)]

  const knobs: LavaKnobs = { ...LAMP_KNOBS }
  const count = 9000
  const steps = 4
  let glow = 1.0
  let view = 0
  const splatR = H * 8.5
  const thresh = 1.5
  let time = 0

  const sim = new LavaSim(dev, count)

  // ---- pipelines ------------------------------------------------------------------
  const module = dev.createShaderModule({ code: renderShader })
  const linSamp = dev.createSampler({ magFilter: "linear", minFilter: "linear" })
  const rp = dev.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
  const dp = dev.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })

  const add: GPUBlendState = {
    color: { srcFactor: "one", dstFactor: "one", operation: "add" },
    alpha: { srcFactor: "one", dstFactor: "one", operation: "add" },
  }
  const splatPipe = dev.createRenderPipeline({
    layout: "auto",
    vertex: { module, entryPoint: "vsSplat" },
    fragment: { module, entryPoint: "fsSplat", targets: [{ format: "rgba16float", blend: add }] },
    primitive: { topology: "triangle-list" },
  })
  const scenePipe = dev.createRenderPipeline({
    layout: "auto",
    vertex: { module, entryPoint: "vsFull" },
    fragment: { module, entryPoint: "fsScene", targets: [{ format: "rgba16float" }] },
    primitive: { topology: "triangle-list" },
  })
  const blurPipe = dev.createRenderPipeline({
    layout: "auto",
    vertex: { module, entryPoint: "vsFull" },
    fragment: { module, entryPoint: "fsBlur", targets: [{ format: "rgba16float" }] },
    primitive: { topology: "triangle-list" },
  })
  const blurBufs = [[1, 0], [0, 1]].map((d) => {
    const b = dev.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    dev.queue.writeBuffer(b, 0, new Float32Array([d[0], d[1], 0, 0]))
    return b
  })
  const displayPipe = dev.createRenderPipeline({
    layout: "auto",
    vertex: { module, entryPoint: "vsFull" },
    fragment: { module, entryPoint: "fsDisplay", targets: [{ format: HDR_FORMAT }] },
    primitive: { topology: "triangle-list" },
  })

  // ---- size-dependent targets ------------------------------------------------------
  let rc: RadianceCascades = null!
  let fieldTex: GPUTexture = null!
  let fieldView: GPUTextureView = null!
  let blurTex: [GPUTexture, GPUTexture] = [null!, null!]
  let blurGroups: [GPUBindGroup, GPUBindGroup] = [null!, null!]
  let smoothView: GPUTextureView = null!
  let blurTmpView: GPUTextureView = null!
  let sceneGroup: GPUBindGroup = null!
  let displayGroup: GPUBindGroup = null!

  const updateViewScale = (w: number, h: number): void => {
    viewScale[0] = viewScaleY / (w / h)
    viewScale[1] = viewScaleY
  }

  const buildTargets = (): void => {
    rc?.dispose()
    fieldTex?.destroy()
    blurTex[0]?.destroy()
    blurTex[1]?.destroy()
    const w = shell.canvas.width
    const h = shell.canvas.height
    updateViewScale(w, h)
    const [gw, gh] = rcSize(w, h)
    rc = new RadianceCascades(dev, gw, gh, 4, 0.3)
    fieldTex = dev.createTexture({
      size: [rc.width, rc.height],
      format: "rgba16float",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    })
    fieldView = fieldTex.createView()
    // splat → horizontal blur → vertical blur; everything downstream reads
    // the smoothed field
    const mkField = (): GPUTexture =>
      dev.createTexture({
        size: [rc.width, rc.height],
        format: "rgba16float",
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      })
    blurTex = [mkField(), mkField()]
    blurTmpView = blurTex[0].createView()
    smoothView = blurTex[1].createView()
    blurGroups = [
      dev.createBindGroup({
        layout: blurPipe.getBindGroupLayout(0),
        entries: [
          { binding: 3, resource: linSamp },
          { binding: 7, resource: { buffer: blurBufs[0] } },
          { binding: 8, resource: fieldView },
        ],
      }),
      dev.createBindGroup({
        layout: blurPipe.getBindGroupLayout(0),
        entries: [
          { binding: 3, resource: linSamp },
          { binding: 7, resource: { buffer: blurBufs[1] } },
          { binding: 8, resource: blurTmpView },
        ],
      }),
    ]
    sceneGroup = dev.createBindGroup({
      layout: scenePipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: rp } },
        { binding: 2, resource: smoothView },
        { binding: 3, resource: linSamp },
      ],
    })
    displayGroup = dev.createBindGroup({
      layout: displayPipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: rp } },
        { binding: 2, resource: smoothView },
        { binding: 3, resource: linSamp },
        { binding: 5, resource: rc.fluence.view },
        { binding: 6, resource: { buffer: dp } },
      ],
    })
  }
  buildTargets()

  let splatGroups: [GPUBindGroup, GPUBindGroup] = [null!, null!]
  const bindSplat = (): void => {
    splatGroups = sim.buffers.map((b) =>
      dev.createBindGroup({
        layout: splatPipe.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: rp } },
          { binding: 1, resource: { buffer: b } },
        ],
      }),
    ) as [GPUBindGroup, GPUBindGroup]
  }

  const fitCanvas = (): void => {
    const fs = document.fullscreenElement === container
    let w: number
    let h: number
    if (fs) {
      const r = shell.canvas.getBoundingClientRect()
      w = Math.max(1, Math.floor(r.width * dpr))
      h = Math.max(1, Math.floor(r.height * dpr))
    } else {
      const cw = Math.min(container.clientWidth || 720, 900)
      w = Math.floor(cw * dpr)
      h = Math.floor(cw * aspectRatio * dpr)
    }
    if (w === shell.canvas.width && h === shell.canvas.height) return
    shell.canvas.width = w
    shell.canvas.height = h
    configureContext(shell.canvas, dev)
    buildTargets()
  }

  const writeUniforms = (): void => {
    dev.queue.writeBuffer(
      rp,
      0,
      new Float32Array([
        viewScale[0], viewScale[1], rc.width, rc.height,
        splatR, thresh, time, glow,
        LAMP.wallBottom, LAMP.wallTop, LAMP.floorY, LAMP.topY,
        LAMP.heaterY, H * 0.7, 1, viewY,
      ]),
    )
    dev.queue.writeBuffer(
      dp,
      0,
      new Float32Array([
        rc.fluence.probes[0], rc.fluence.probes[1], shell.canvas.width, shell.canvas.height,
        1.0, 3.0, 0, 0,
      ]),
    )
  }

  // ---- cursor stirring ----------------------------------------------------------
  let mouse: [number, number] = [99, 99]
  let mouseVel: [number, number] = [0, 0]
  let lastMove = 0
  shell.canvas.addEventListener("pointermove", (e) => {
    const r = shell.canvas.getBoundingClientRect()
    const cx = ((e.clientX - r.left) / r.width) * 2 - 1
    const cy = -(((e.clientY - r.top) / r.height) * 2 - 1)
    const wx = cx / viewScale[0]
    const wy = cy / viewScale[1] + viewY
    const now = performance.now()
    const dtm = Math.min((now - lastMove) / 1000, 0.1) || 0.016
    lastMove = now
    if (mouse[0] < 90) {
      const vx = (wx - mouse[0]) / dtm
      const vy = (wy - mouse[1]) / dtm
      const mag = Math.hypot(vx, vy)
      const clampF = mag > 4 ? 4 / mag : 1
      mouseVel = [mouseVel[0] * 0.6 + vx * clampF * 0.4, mouseVel[1] * 0.6 + vy * clampF * 0.4]
    }
    mouse = [wx, wy]
  })
  shell.canvas.addEventListener("pointerleave", () => {
    mouse = [99, 99]
    mouseVel = [0, 0]
  })

  // ---- fullscreen + ui chrome (sandbox only) ----------------------------------------
  let uiVisible = true
  let fullscreenBtn: HTMLButtonElement | null = null

  const applyUiVisible = (): void => {
    container.classList.toggle("demo-ui-hidden", !uiVisible)
    shell.controls.style.display = uiVisible ? "" : "none"
    if (document.fullscreenElement === container) requestAnimationFrame(() => fitCanvas())
  }
  const toggleFullscreen = async (): Promise<void> => {
    try {
      if (document.fullscreenElement === container) await document.exitFullscreen()
      else await container.requestFullscreen()
    } catch {
      // denied or unsupported
    }
  }
  const onFullscreenChange = (): void => {
    const fs = document.fullscreenElement === container
    container.classList.toggle("demo-fullscreen", fs)
    if (fullscreenBtn) fullscreenBtn.textContent = fs ? "exit fullscreen" : "fullscreen"
    requestAnimationFrame(() => fitCanvas())
  }
  const onKeyDown = (e: KeyboardEvent): void => {
    if (!opts.full || inputFocused()) return
    if (e.key === "/" || e.code === "Slash") {
      e.preventDefault()
      uiVisible = !uiVisible
      applyUiVisible()
    }
  }
  const onResize = (): void => {
    if (document.fullscreenElement === container) fitCanvas()
  }

  // ---- controls -------------------------------------------------------------------
  if (opts.full) {
    shell.slider({
      label: "coil heat",
      min: 0.5, max: 6, step: 0.1, value: knobs.heatRate,
      onInput: (v) => (knobs.heatRate = v),
    })
    shell.slider({
      label: "buoyancy",
      min: 0.5, max: 9, step: 0.1, value: knobs.buoyancy,
      onInput: (v) => (knobs.buoyancy = v),
    })
    shell.slider({
      label: "surface tension",
      min: 0, max: 8, step: 0.1, value: knobs.tension,
      onInput: (v) => (knobs.tension = v),
    })
    shell.slider({
      label: "glow",
      min: 0.3, max: 2.5, step: 0.05, value: glow,
      onInput: (v) => (glow = v),
    })
    const viewBtn = shell.button(`view: ${VIEWS[0]}`, () => {
      view = (view + 1) % VIEWS.length
      viewBtn.textContent = `view: ${VIEWS[view]}`
    })
    shell.button("re-melt", () => {
      sim.rebuild(count)
      bindSplat()
    })
    fullscreenBtn = shell.button("fullscreen", () => void toggleFullscreen())
    window.addEventListener("keydown", onKeyDown)
    document.addEventListener("fullscreenchange", onFullscreenChange)
    window.addEventListener("resize", onResize)
    shell.setInfo(() => `${count.toLocaleString()} particles · ${rc.cascadeCount} cascades over ${rc.width}×${rc.height}`)
  } else {
    shell.setInfo(() => `${count.toLocaleString()} wax particles · ${rc.cascadeCount} radiance cascades · stir with your cursor`)
  }

  // Pre-warm: run the simulation ahead so the lamp arrives mid-cycle. The
  // chunks are submitted one per idle slice so page load doesn't stall.
  sim.writeParams(knobs, 0.0016, mouse, mouseVel)
  for (let chunk = 0; chunk < 8; chunk++) {
    const enc = dev.createCommandEncoder()
    sim.encodeSteps(enc, 250)
    dev.queue.submit([enc.finish()])
  }
  await dev.queue.onSubmittedWorkDone()
  bindSplat()

  return {
    frame() {
      shell.tick()
      time += 1 / 60
      sim.writeParams(knobs, 0.0016, mouse, mouseVel)
      writeUniforms()

      const enc = dev.createCommandEncoder()
      sim.encodeSteps(enc, steps)

      // splat particles into the metaball field
      let pass = enc.beginRenderPass({
        colorAttachments: [{ view: fieldView, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "store" }],
      })
      pass.setPipeline(splatPipe)
      pass.setBindGroup(0, splatGroups[sim.currentIndex])
      pass.draw(6, sim.count)
      pass.end()

      for (let b = 0; b < 2; b++) {
        pass = enc.beginRenderPass({
          colorAttachments: [{ view: b === 0 ? blurTmpView : smoothView, loadOp: "clear", storeOp: "store" }],
        })
        pass.setPipeline(blurPipe)
        pass.setBindGroup(0, blurGroups[b])
        pass.draw(3)
        pass.end()
      }

      // field → emission + occlusion (plus coil, base, cap, table)
      pass = enc.beginRenderPass({
        colorAttachments: [{ view: rc.sceneView, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "store" }],
      })
      pass.setPipeline(scenePipe)
      pass.setBindGroup(0, sceneGroup)
      pass.draw(3)
      pass.end()

      rc.encodeGI(enc)

      if (view === 0) {
        pass = enc.beginRenderPass({
          colorAttachments: [{ view: post.sceneView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: "clear", storeOp: "store" }],
        })
        pass.setPipeline(displayPipe)
        pass.setBindGroup(0, displayGroup)
        pass.draw(3)
        pass.end()
        post.encodePresent(enc)
      } else {
        // the renderer's own stages, at the resolution the light runs at
        rc.encodeComposite(enc, ctx.getCurrentTexture().createView(), {
          exposure: 1.4,
          debugMode: VIEW_MODES[view],
          emitBoost: 0,
        })
      }
      dev.queue.submit([enc.finish()])
    },
    dispose() {
      if (opts.full) {
        window.removeEventListener("keydown", onKeyDown)
        document.removeEventListener("fullscreenchange", onFullscreenChange)
        window.removeEventListener("resize", onResize)
        if (document.fullscreenElement === container) void document.exitFullscreen()
      }
      sim.dispose()
      rc.dispose()
      fieldTex.destroy()
      blurTex[0].destroy()
      blurTex[1].destroy()
      for (const b of blurBufs) b.destroy()
      rp.destroy()
      dp.destroy()
      post.dispose()
    },
  }
}
