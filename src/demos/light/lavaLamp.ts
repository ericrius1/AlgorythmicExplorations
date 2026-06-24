// The lamp itself: temperature SPH → metaball splat → scene (emission +
// occlusion) → radiance cascades → composite. Cursor stirs the wax.

import renderShader from "../../shaders/lavarender.wgsl?raw"
import { Shell, gpuMissing, type Demo } from "../../lib/demoShell"
import { getDevice, configureContext } from "../../lib/gpu"
import {
  LavaSim,
  LAMP,
  DEFAULT_KNOBS,
  H,
  type LavaKnobs
} from "../../lib/lavaSim"
import { RadianceCascades } from "../../lib/radianceCascades"

const DEBUG_NAMES = [
  "final",
  "scene (what the rays see)",
  "occupancy",
  "distance field",
  "light only"
]

function inputFocused(): boolean {
  const el = document.activeElement
  if (!el) return false
  const tag = el.tagName
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    (el as HTMLElement).isContentEditable
  )
}

export interface LavaLampOptions {
  hero?: boolean
  full?: boolean // sliders + debug views
}

export async function mountLavaLamp(
  container: HTMLElement,
  opts: LavaLampOptions
): Promise<Demo> {
  const dev = await getDevice()
  const aspectRatio = opts.hero ? 0.52 : 0.66
  const shell = new Shell(container, aspectRatio)
  if (!dev) return gpuMissing(container)
  const ctx = configureContext(shell.canvas, dev)

  const viewScaleY = 1.12
  const viewScale: [number, number] = [1, viewScaleY]

  // light transport at half resolution — /3 read soft once the canvas
  // upscaled; /2 keeps blob edges crisp and still runs comfortably
  let rc = new RadianceCascades(
    dev,
    Math.floor(shell.canvas.width / 2),
    Math.floor(shell.canvas.height / 2)
  )

  const knobs: LavaKnobs = { ...DEFAULT_KNOBS }
  let count = opts.hero ? 9000 : 10000
  let steps = 4
  let glow = 1.0
  let exposure = 1.35
  let debugMode = 0
  let time = 0

  const sim = new LavaSim(dev, count)

  // ---- field + scene pipelines ------------------------------------------------
  const module = dev.createShaderModule({ code: renderShader })
  let fieldTex = dev.createTexture({
    size: [rc.width, rc.height],
    format: "rgba16float",
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
  })
  let fieldView = fieldTex.createView()
  const linSamp = dev.createSampler({
    magFilter: "linear",
    minFilter: "linear"
  })
  const rp = dev.createBuffer({
    size: 64,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
  })

  const splatPipe = dev.createRenderPipeline({
    layout: "auto",
    vertex: { module, entryPoint: "vsSplat" },
    fragment: {
      module,
      entryPoint: "fsSplat",
      targets: [
        {
          format: "rgba16float",
          blend: {
            color: { srcFactor: "one", dstFactor: "one", operation: "add" },
            alpha: { srcFactor: "one", dstFactor: "one", operation: "add" }
          }
        }
      ]
    },
    primitive: { topology: "triangle-list" }
  })
  const scenePipe = dev.createRenderPipeline({
    layout: "auto",
    vertex: { module, entryPoint: "vsFull" },
    fragment: {
      module,
      entryPoint: "fsScene",
      targets: [{ format: "rgba16float" }]
    },
    primitive: { topology: "triangle-list" }
  })

  let splatGroups: [GPUBindGroup, GPUBindGroup] = [null!, null!]
  const bindSplat = (): void => {
    splatGroups = sim.buffers.map((b) =>
      dev.createBindGroup({
        layout: splatPipe.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: rp } },
          { binding: 1, resource: { buffer: b } }
        ]
      })
    ) as [GPUBindGroup, GPUBindGroup]
  }
  let sceneGroup = dev.createBindGroup({
    layout: scenePipe.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: rp } },
      { binding: 2, resource: fieldView },
      { binding: 3, resource: linSamp }
    ]
  })

  const updateViewScale = (w: number, h: number): void => {
    const aspect = w / h
    viewScale[0] = viewScaleY / aspect
    viewScale[1] = viewScaleY
  }
  updateViewScale(shell.canvas.width, shell.canvas.height)

  const rebuildTargets = (): void => {
    rc.dispose()
    fieldTex.destroy()
    const w = shell.canvas.width
    const h = shell.canvas.height
    updateViewScale(w, h)
    rc = new RadianceCascades(dev, Math.floor(w / 2), Math.floor(h / 2))
    fieldTex = dev.createTexture({
      size: [rc.width, rc.height],
      format: "rgba16float",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
    })
    fieldView = fieldTex.createView()
    sceneGroup = dev.createBindGroup({
      layout: scenePipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: rp } },
        { binding: 2, resource: fieldView },
        { binding: 3, resource: linSamp }
      ]
    })
  }

  const fitCanvas = (): void => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
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
    rebuildTargets()
  }

  const writeRP = (): void => {
    const f = new Float32Array([
      viewScale[0],
      viewScale[1],
      rc.width,
      rc.height,
      H * 6.2,
      1.1,
      time,
      glow,
      LAMP.wallBottom,
      LAMP.wallTop,
      LAMP.floorY,
      LAMP.topY,
      LAMP.heaterY,
      H * 0.7,
      1,
      0
    ])
    dev.queue.writeBuffer(rp, 0, f)
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
    const wy = cy / viewScale[1]
    const now = performance.now()
    const dtm = Math.min((now - lastMove) / 1000, 0.1) || 0.016
    lastMove = now
    if (mouse[0] < 90) {
      const vx = (wx - mouse[0]) / dtm
      const vy = (wy - mouse[1]) / dtm
      const mag = Math.hypot(vx, vy)
      const clampF = mag > 4 ? 4 / mag : 1
      mouseVel = [
        mouseVel[0] * 0.6 + vx * clampF * 0.4,
        mouseVel[1] * 0.6 + vy * clampF * 0.4
      ]
    }
    mouse = [wx, wy]
  })
  shell.canvas.addEventListener("pointerleave", () => {
    mouse = [99, 99]
    mouseVel = [0, 0]
  })

  // ---- fullscreen + ui chrome (final lamp only) -----------------------------------
  let uiVisible = true
  const readoutBar = shell.readout.parentElement as HTMLDivElement
  let fullscreenBtn: HTMLButtonElement | null = null

  const applyUiVisible = (): void => {
    container.classList.toggle("demo-ui-hidden", !uiVisible)
    shell.controls.style.display = uiVisible ? "" : "none"
    if (document.fullscreenElement === container)
      requestAnimationFrame(() => fitCanvas())
  }

  const toggleFullscreen = async (): Promise<void> => {
    try {
      if (document.fullscreenElement === container)
        await document.exitFullscreen()
      else await container.requestFullscreen()
    } catch {
      // user denied or unsupported
    }
  }

  const onFullscreenChange = (): void => {
    const fs = document.fullscreenElement === container
    container.classList.toggle("demo-fullscreen", fs)
    if (fullscreenBtn)
      fullscreenBtn.textContent = fs ? "exit fullscreen" : "fullscreen"
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
      min: 0.5,
      max: 6,
      step: 0.1,
      value: knobs.heatRate,
      onInput: (v) => (knobs.heatRate = v)
    })
    shell.slider({
      label: "buoyancy",
      min: 3.0,
      max: 9,
      step: 0.1,
      value: knobs.buoyancy,
      onInput: (v) => (knobs.buoyancy = v)
    })
    shell.slider({
      label: "surface tension",
      min: 0,
      max: 8,
      step: 0.1,
      value: knobs.tension,
      onInput: (v) => (knobs.tension = v)
    })
    shell.slider({
      label: "gooiness (XSPH)",
      min: 0.0,
      max: 0.3,
      step: 0.01,
      value: knobs.xsph,
      onInput: (v) => (knobs.xsph = v)
    })
    shell.slider({
      label: "glow",
      min: 0.3,
      max: 2.5,
      step: 0.05,
      value: glow,
      onInput: (v) => (glow = v)
    })
    shell.button("view: final", function (this: void) {
      debugMode = (debugMode + 1) % DEBUG_NAMES.length
    })
    // relabel the debug button as it cycles
    const btn = shell.controls.querySelectorAll("button")[0]
    btn?.addEventListener(
      "click",
      () => (btn.textContent = `view: ${DEBUG_NAMES[debugMode]}`)
    )
    shell.button("re-melt", () => {
      sim.rebuild(count)
      bindSplat()
    })
    shell.button("fullscreen", () => {
      void toggleFullscreen()
    })
    fullscreenBtn = shell.controls.querySelectorAll("button")[2] ?? null
    window.addEventListener("keydown", onKeyDown)
    document.addEventListener("fullscreenchange", onFullscreenChange)
    window.addEventListener("resize", onResize)
    readoutBar.style.display = "none"
  } else {
    shell.setInfo(() =>
      opts.hero
        ? `${count.toLocaleString()} wax particles · ${rc.cascadeCount} radiance cascades · stir with your cursor`
        : `${count.toLocaleString()} particles · ${rc.cascadeCount} cascades over a ${rc.width}×${rc.height} field · stir with your cursor`,
    )
  }

  // pre-warm: a head start of pure simulation so the lamp arrives mid-churn
  {
    sim.writeParams(knobs, 0.0016, mouse, mouseVel)
    for (let chunk = 0; chunk < 6; chunk++) {
      const enc = dev.createCommandEncoder()
      sim.encodeSteps(enc, 250)
      dev.queue.submit([enc.finish()])
    }
  }
  bindSplat()

  return {
    frame() {
      if (!opts.full) shell.tick()
      time += 1 / 60
      sim.writeParams(knobs, 0.0016, mouse, mouseVel)
      writeRP()

      const enc = dev.createCommandEncoder()
      sim.encodeSteps(enc, steps)

      // splat particles into the metaball field
      let pass = enc.beginRenderPass({
        colorAttachments: [
          {
            view: fieldView,
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: "clear",
            storeOp: "store"
          }
        ]
      })
      pass.setPipeline(splatPipe)
      pass.setBindGroup(0, splatGroups[sim.currentIndex])
      pass.draw(6, sim.count)
      pass.end()

      // field → emission + occlusion (plus coil, base, cap, glass)
      pass = enc.beginRenderPass({
        colorAttachments: [
          {
            view: rc.sceneView,
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: "clear",
            storeOp: "store"
          }
        ]
      })
      pass.setPipeline(scenePipe)
      pass.setBindGroup(0, sceneGroup)
      pass.draw(3)
      pass.end()

      rc.encodeGI(enc)
      rc.encodeComposite(enc, ctx.getCurrentTexture().createView(), {
        exposure,
        debugMode,
        emitBoost: 0.55
      })
      dev.queue.submit([enc.finish()])
    },
    dispose() {
      if (opts.full) {
        window.removeEventListener("keydown", onKeyDown)
        document.removeEventListener("fullscreenchange", onFullscreenChange)
        window.removeEventListener("resize", onResize)
        if (document.fullscreenElement === container)
          void document.exitFullscreen()
      }
      sim.dispose()
      rc.dispose()
      fieldTex.destroy()
      rp.destroy()
    }
  }
}
