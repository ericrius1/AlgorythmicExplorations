import MetalKit
import MetalPerformanceShaders

// Swift mirrors of the MSL structs — field order and types must match.

struct Uniforms {
  var viewScale: SIMD2<Float>
  var res: SIMD2<Float>
  var stir: SIMD2<Float>
  var stirVel: SIMD2<Float>
  var emit2: SIMD2<Float>
  var probes0: SIMD2<Float>
  var zenith: SIMD4<Float>
  var horizon: SIMD4<Float>
  var sun: SIMD4<Float>
  var sunColor: SIMD4<Float>
  var count: UInt32
  var dt: Float
  var time: Float
  var wind: Float
  var buoyancy: Float
  var drag: Float
  var emberSize: Float
  var fireScale: Float
  var stirRadius: Float
  var stirStrength: Float
  var bounce: Float
  var night: Float
  var emit2On: Float
  var glow: Float
  var worldHalfX: Float
  var pad0: Float = 0
}

struct CascadeParams {
  var probes: SIMD2<Float>
  var upperProbes: SIMD2<Float>
  var blocks: Float
  var upperBlocks: Float
  var intervalStart: Float
  var intervalLen: Float
  var isTop: Float
  var steps: Float
  var pad0: Float = 0
  var pad1: Float = 0
}

struct PostParams {
  var exposure: Float
  var emitBoost: Float
  var debugMode: Float
  var edrMax: Float
  var bloom: Float
  var grain: Float
  var vignette: Float
  var shimmer: Float
  var smoke: Float
  var nightAir: Float = 0
  var pad1: Float = 0
  var pad2: Float = 0
}

// Sky keyframes, ported from the blog demo.
private struct SkyKey {
  var zenith: SIMD3<Float>
  var horizon: SIMD3<Float>
  var sunDir: SIMD2<Float>
  var sunIntensity: Float
  var sunSharpness: Float
  var sunColor: SIMD3<Float>
}

private let NIGHT = SkyKey(zenith: [0.004, 0.006, 0.016], horizon: [0.012, 0.016, 0.035],
                           sunDir: [0.3, -1], sunIntensity: 0, sunSharpness: 40, sunColor: [1, 1, 1])
private let DUSK = SkyKey(zenith: [0.02, 0.03, 0.09], horizon: [0.5, 0.2, 0.07],
                          sunDir: [0.92, -0.2], sunIntensity: 1.3, sunSharpness: 48, sunColor: [1, 0.45, 0.15])
private let DAY = SkyKey(zenith: [0.12, 0.24, 0.5], horizon: [0.55, 0.6, 0.66],
                         sunDir: [0.35, -1], sunIntensity: 1.7, sunSharpness: 90, sunColor: [1, 0.95, 0.85])

private func skyAt(_ t: Float) -> SkyKey {
  let (a, b, f): (SkyKey, SkyKey, Float) = t < 0.5 ? (NIGHT, DUSK, t * 2) : (DUSK, DAY, (t - 0.5) * 2)
  return SkyKey(
    zenith: simd_mix(a.zenith, b.zenith, SIMD3(repeating: f)),
    horizon: simd_mix(a.horizon, b.horizon, SIMD3(repeating: f)),
    sunDir: simd_mix(a.sunDir, b.sunDir, SIMD2(repeating: f)),
    sunIntensity: a.sunIntensity + (b.sunIntensity - a.sunIntensity) * f,
    sunSharpness: a.sunSharpness + (b.sunSharpness - a.sunSharpness) * f,
    sunColor: simd_mix(a.sunColor, b.sunColor, SIMD3(repeating: f)))
}

final class Renderer: NSObject, MTKViewDelegate {
  private let device: MTLDevice
  private let queue: MTLCommandQueue
  private let settings: Settings

  // pipelines
  private let emberSimPipe: MTLComputePipelineState
  private let scenePipe: MTLRenderPipelineState
  private let emberPipe: MTLRenderPipelineState
  private let seedPipe: MTLRenderPipelineState
  private let jfaPipe: MTLRenderPipelineState
  private let distPipe: MTLRenderPipelineState
  private let cascadePipe: MTLRenderPipelineState
  private let resolvePipe: MTLRenderPipelineState
  private let brightPipe: MTLRenderPipelineState
  private let finalPipe: MTLRenderPipelineState
  private let sampler: MTLSamplerState
  private let emberBuf: MTLBuffer

  // size-dependent resources
  private var sceneTex: MTLTexture!
  private var distTex: MTLTexture!
  private var jfa: [MTLTexture] = []
  private var casc: [MTLTexture] = []
  private var hdrTex: MTLTexture!
  private var brightTex: MTLTexture!
  private var bloomTex: MTLTexture!
  private var blur: MPSImageGaussianBlur!
  private var jfaOffsets: [Float] = []
  private var cascadeParams: [CascadeParams] = []
  private var cascadeRegions: [(Int, Int)] = []
  private var probes0 = SIMD2<Float>(1, 1)
  private(set) var cascadeCount = 0
  private var builtScale = -1.0
  private var builtSize = CGSize.zero
  private var needsCascClear = true

  // interaction (set from the view, read in draw)
  private var stir = SIMD2<Float>(99, 99)
  private var stirVel = SIMD2<Float>(0, 0)
  private var lastMove: CFTimeInterval = 0
  private var emit2 = SIMD2<Float>(99, 99)
  private var emit2On: Float = 0

  private var viewScale = SIMD2<Float>(1, 1)
  private var time: Float = 0
  private var lastFrame = CACurrentMediaTime()
  private var fpsAccum = 0.0
  private var fpsFrames = 0
  private var fpsLast = CACurrentMediaTime()

  // BONFIRE_SNAPSHOT=/path.png — write a frame to disk and exit (debug/verify)
  private var snapshotPath = ProcessInfo.processInfo.environment["BONFIRE_SNAPSHOT"]
  private var frameIndex = 0

  init(view: MTKView, settings: Settings) throws {
    guard let device = view.device else { throw RendererError.noDevice }
    self.device = device
    self.settings = settings
    guard let queue = device.makeCommandQueue() else { throw RendererError.noDevice }
    self.queue = queue

    // EDR: half-float drawable in extended linear P3 — values above 1.0 hit
    // the XDR backlight instead of clipping. The whole point of going native.
    view.colorPixelFormat = .rgba16Float
    view.preferredFramesPerSecond = 120
    if ProcessInfo.processInfo.environment["BONFIRE_SNAPSHOT"] != nil {
      view.framebufferOnly = false // snapshot needs to blit the drawable back
    }
    if let layer = view.layer as? CAMetalLayer {
      layer.wantsExtendedDynamicRangeContent = true
      layer.pixelFormat = .rgba16Float
      layer.colorspace = CGColorSpace(name: CGColorSpace.extendedLinearDisplayP3)
    }

    // runtime-compile the shader source (resource file → nice error messages)
    guard let url = Bundle.module.url(forResource: "Shaders", withExtension: "metal") else {
      throw RendererError.missingShader
    }
    let source = try String(contentsOf: url, encoding: .utf8)
    let library = try device.makeLibrary(source: source, options: nil)

    func fn(_ name: String) throws -> MTLFunction {
      guard let f = library.makeFunction(name: name) else { throw RendererError.missingFunction(name) }
      return f
    }

    emberSimPipe = try device.makeComputePipelineState(function: fn("emberSim"))

    func renderPipe(vs: String = "vsFull", fs: String, format: MTLPixelFormat,
                    additive: Bool = false) throws -> MTLRenderPipelineState {
      let d = MTLRenderPipelineDescriptor()
      d.vertexFunction = try fn(vs)
      d.fragmentFunction = try fn(fs)
      d.colorAttachments[0].pixelFormat = format
      if additive {
        let c = d.colorAttachments[0]!
        c.isBlendingEnabled = true
        c.rgbBlendOperation = .add
        c.alphaBlendOperation = .add
        c.sourceRGBBlendFactor = .one
        c.destinationRGBBlendFactor = .one
        c.sourceAlphaBlendFactor = .one
        c.destinationAlphaBlendFactor = .one
      }
      return try device.makeRenderPipelineState(descriptor: d)
    }

    scenePipe = try renderPipe(fs: "fsScene", format: .rgba16Float)
    emberPipe = try renderPipe(vs: "vsEmber", fs: "fsEmber", format: .rgba16Float, additive: true)
    seedPipe = try renderPipe(fs: "fsSeed", format: .rg16Float)
    jfaPipe = try renderPipe(fs: "fsJfa", format: .rg16Float)
    distPipe = try renderPipe(fs: "fsDist", format: .r16Float)
    cascadePipe = try renderPipe(fs: "fsCascade", format: .rgba16Float)
    resolvePipe = try renderPipe(fs: "fsResolve", format: .rgba16Float)
    brightPipe = try renderPipe(fs: "fsBright", format: .rgba16Float)
    finalPipe = try renderPipe(fs: "fsFinal", format: view.colorPixelFormat)

    let sd = MTLSamplerDescriptor()
    sd.minFilter = .linear
    sd.magFilter = .linear
    sd.sAddressMode = .clampToEdge
    sd.tAddressMode = .clampToEdge
    guard let samp = device.makeSamplerState(descriptor: sd) else { throw RendererError.noDevice }
    sampler = samp

    // embers: all spawn staggered-dead, the sim respawns them at the flame
    var init0 = [Float](repeating: 0, count: Settings.maxEmbers * 8)
    for i in 0..<Settings.maxEmbers {
      init0[i * 8] = Float.random(in: -1...1)
      init0[i * 8 + 1] = Float.random(in: -1...1)
      init0[i * 8 + 4] = Float.random(in: 0...4) // life
      init0[i * 8 + 5] = 4                       // maxLife
      init0[i * 8 + 6] = Float.random(in: 0...1) // heat
      init0[i * 8 + 7] = Float.random(in: 0...1) // seed
    }
    guard let buf = device.makeBuffer(bytes: init0, length: init0.count * 4, options: .storageModeShared) else {
      throw RendererError.noDevice
    }
    emberBuf = buf

    super.init()
  }

  enum RendererError: Error {
    case noDevice
    case missingShader
    case missingFunction(String)
  }

  // ---- interaction ----------------------------------------------------------

  func clipToWorld(_ clip: SIMD2<Float>) -> SIMD2<Float> {
    SIMD2(clip.x / viewScale.x, clip.y / viewScale.y)
  }

  func pointerMoved(_ world: SIMD2<Float>) {
    let now = CACurrentMediaTime()
    var dt = Float(now - lastMove)
    dt = dt > 0.1 || dt <= 0 ? 0.016 : dt
    lastMove = now
    if stir.x < 90 {
      var v = (world - stir) / dt
      let mag = simd_length(v)
      if mag > 5 { v *= 5 / mag }
      stirVel = stirVel * 0.6 + v * 0.4
    }
    stir = world
    if emit2On > 0.5 { emit2 = world }
  }

  func pointerLeft() {
    stir = SIMD2(99, 99)
    stirVel = .zero
  }

  func setEmit(_ world: SIMD2<Float>, on: Bool) {
    emit2On = on ? 1 : 0
    if on { emit2 = world }
  }

  // ---- size-dependent rebuild -------------------------------------------------

  private func tex(_ w: Int, _ h: Int, _ format: MTLPixelFormat,
                   usage: MTLTextureUsage = [.renderTarget, .shaderRead]) -> MTLTexture {
    let d = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: format, width: max(w, 1), height: max(h, 1), mipmapped: false)
    d.usage = usage
    d.storageMode = .private
    return device.makeTexture(descriptor: d)!
  }

  private func rebuild(drawable: CGSize, scale: Double) {
    builtSize = drawable
    builtScale = scale

    let dw = max(Int(drawable.width), 16)
    let dh = max(Int(drawable.height), 16)
    let w = max(Int(Double(dw) * scale), 64)
    let h = max(Int(Double(dh) * scale), 64)

    let aspect = Float(dw) / Float(dh)
    viewScale = SIMD2(1 / aspect, 1)

    sceneTex = tex(w, h, .rgba16Float)
    jfa = [tex(w, h, .rg16Float), tex(w, h, .rg16Float)]
    distTex = tex(w, h, .r16Float)

    // probe grid: one probe per 2×2 scene pixels at cascade 0; the cascade
    // texture (probes × 2×2 direction blocks) is then exactly scene-sized
    let p0 = (max(4, w / 2), max(4, h / 2))
    probes0 = SIMD2(Float(p0.0), Float(p0.1))
    casc = [tex(p0.0 * 2, p0.1 * 2, .rgba16Float), tex(p0.0 * 2, p0.1 * 2, .rgba16Float)]
    needsCascClear = true

    // enough cascades for the top interval to reach past the diagonal
    let interval0 = 4.0
    let diag = (Double(w * w + h * h)).squareRoot()
    var nc = Int(ceil(log(3 * diag / interval0 + 1) / log(4)))
    while nc > 1 && (p0.0 >> (nc - 1) < 2 || p0.1 >> (nc - 1) < 2) { nc -= 1 }
    cascadeCount = max(nc, 2)

    cascadeParams = []
    cascadeRegions = []
    for n in 0..<cascadeCount {
      let probes = (max(p0.0 >> n, 1), max(p0.1 >> n, 1))
      let upper = (max(p0.0 >> (n + 1), 1), max(p0.1 >> (n + 1), 1))
      let blocks = 2 << n
      let start = interval0 * (pow(4, Double(n)) - 1) / 3
      let len = interval0 * pow(4, Double(n))
      cascadeParams.append(CascadeParams(
        probes: SIMD2(Float(probes.0), Float(probes.1)),
        upperProbes: SIMD2(Float(upper.0), Float(upper.1)),
        blocks: Float(blocks), upperBlocks: Float(blocks * 2),
        intervalStart: Float(start), intervalLen: Float(len),
        isTop: 0, steps: 40))
      cascadeRegions.append((probes.0 * blocks, probes.1 * blocks))
    }

    // jump-flood offsets: halve from the largest power of two
    jfaOffsets = []
    var off = 1
    while off * 2 < max(w, h) { off *= 2 }
    while off >= 1 {
      jfaOffsets.append(Float(off))
      if off == 1 { break }
      off /= 2
    }

    // post chain: full-res HDR, half-res bloom
    hdrTex = tex(dw, dh, .rgba16Float)
    brightTex = tex(dw / 2, dh / 2, .rgba16Float, usage: [.renderTarget, .shaderRead, .shaderWrite])
    bloomTex = tex(dw / 2, dh / 2, .rgba16Float, usage: [.shaderRead, .shaderWrite])
    blur = MPSImageGaussianBlur(device: device, sigma: max(6, Float(dh) / 170))
    blur.edgeMode = .clamp
  }

  // ---- per-frame --------------------------------------------------------------

  func mtkView(_ view: MTKView, drawableSizeWillChange size: CGSize) {
    // handled lazily in draw — builtSize comparison triggers the rebuild
  }

  private func fullPass(_ cb: MTLCommandBuffer, to target: MTLTexture, clear: Bool = true,
                        _ body: (MTLRenderCommandEncoder) -> Void) {
    let rp = MTLRenderPassDescriptor()
    rp.colorAttachments[0].texture = target
    rp.colorAttachments[0].loadAction = clear ? .clear : .load
    rp.colorAttachments[0].storeAction = .store
    rp.colorAttachments[0].clearColor = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 0)
    guard let enc = cb.makeRenderCommandEncoder(descriptor: rp) else { return }
    body(enc)
    enc.endEncoding()
  }

  func draw(in view: MTKView) {
    let size = view.drawableSize
    guard size.width > 8, size.height > 8 else { return }
    if size != builtSize || settings.renderScale != builtScale {
      rebuild(drawable: size, scale: settings.renderScale)
    }

    let now = CACurrentMediaTime()
    let rawDt = min(now - lastFrame, 1.0 / 30.0)
    lastFrame = now
    let dt = settings.paused ? 0 : Float(rawDt)
    time += dt

    // fps (smoothed, pushed to the panel twice a second)
    fpsAccum += rawDt
    fpsFrames += 1
    if now - fpsLast > 0.5 {
      let fps = Double(fpsFrames) / fpsAccum
      fpsAccum = 0
      fpsFrames = 0
      fpsLast = now
      DispatchQueue.main.async { [settings] in settings.fps = fps }
    }

    // cursor velocity decays when the cursor rests
    if now - lastMove > 0.05 { stirVel *= 0.86 }

    let count = min(max(Int(settings.emberCount), 0), Settings.maxEmbers)
    let tod = Float(settings.timeOfDay)
    let sky = skyAt(tod)
    let night = max(0, 1 - tod * 2.2)

    var U = Uniforms(
      viewScale: viewScale,
      res: SIMD2(Float(sceneTex.width), Float(sceneTex.height)),
      stir: stir, stirVel: stirVel, emit2: emit2, probes0: probes0,
      zenith: SIMD4(sky.zenith, 0),
      horizon: SIMD4(sky.horizon, 0),
      sun: SIMD4(sky.sunDir.x, sky.sunDir.y, sky.sunSharpness, sky.sunIntensity),
      sunColor: SIMD4(sky.sunColor, 1),
      count: UInt32(count), dt: dt, time: time,
      wind: Float(settings.wind), buoyancy: 0.55, drag: 0.55,
      emberSize: Float(settings.emberSize), fireScale: Float(settings.fireScale),
      stirRadius: 0.30, stirStrength: 4.0,
      bounce: Float(settings.bounce), night: night,
      emit2On: emit2On, glow: Float(settings.glow),
      worldHalfX: 1 / viewScale.x + 0.15)

    let edr = settings.hdr
      ? Float(view.window?.screen?.maximumExtendedDynamicRangeColorComponentValue ?? 1)
      : 1
    var post = PostParams(
      exposure: Float(settings.exposure), emitBoost: 0.7,
      debugMode: Float(settings.debugMode), edrMax: max(edr, 1),
      bloom: Float(settings.bloom), grain: Float(settings.grain),
      vignette: Float(settings.vignette), shimmer: Float(settings.shimmer),
      smoke: Float(settings.smoke), nightAir: Float(settings.nightAir))

    guard let cb = queue.makeCommandBuffer() else { return }

    // first frames after a rebuild: the scene pass reads casc[0] before the
    // cascades have ever written it — clear both so the bounce starts dark
    if needsCascClear {
      needsCascClear = false
      for t in casc { fullPass(cb, to: t) { _ in } }
    }

    // 1 — ember sim
    if count > 0, let enc = cb.makeComputeCommandEncoder() {
      enc.setComputePipelineState(emberSimPipe)
      enc.setBytes(&U, length: MemoryLayout<Uniforms>.stride, index: 0)
      enc.setBuffer(emberBuf, offset: 0, index: 1)
      enc.dispatchThreads(MTLSize(width: count, height: 1, depth: 1),
                          threadsPerThreadgroup: MTLSize(width: 256, height: 1, depth: 1))
      enc.endEncoding()
    }

    // 2 — scene (reads LAST frame's cascade 0 for the bounce), embers on top
    fullPass(cb, to: sceneTex) { enc in
      enc.setRenderPipelineState(scenePipe)
      enc.setVertexBytes(&U, length: MemoryLayout<Uniforms>.stride, index: 0)
      enc.setFragmentBytes(&U, length: MemoryLayout<Uniforms>.stride, index: 0)
      enc.setFragmentTexture(casc[0], index: 0)
      enc.setFragmentSamplerState(sampler, index: 0)
      enc.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
    }
    if count > 0 {
      fullPass(cb, to: sceneTex, clear: false) { enc in
        enc.setRenderPipelineState(emberPipe)
        enc.setVertexBytes(&U, length: MemoryLayout<Uniforms>.stride, index: 0)
        enc.setVertexBuffer(emberBuf, offset: 0, index: 1)
        enc.setFragmentBytes(&U, length: MemoryLayout<Uniforms>.stride, index: 0)
        enc.setFragmentBuffer(emberBuf, offset: 0, index: 1)
        enc.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 6, instanceCount: count)
      }
    }

    // 3 — seed → jump flood → distance field
    fullPass(cb, to: jfa[0]) { enc in
      enc.setRenderPipelineState(seedPipe)
      enc.setFragmentTexture(sceneTex, index: 0)
      enc.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
    }
    for (i, off) in jfaOffsets.enumerated() {
      var offset = off
      fullPass(cb, to: jfa[(i + 1) % 2]) { enc in
        enc.setRenderPipelineState(jfaPipe)
        enc.setFragmentBytes(&offset, length: 4, index: 1)
        enc.setFragmentTexture(jfa[i % 2], index: 0)
        enc.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
      }
    }
    let finalJfa = jfa[jfaOffsets.count % 2]
    fullPass(cb, to: distTex) { enc in
      enc.setRenderPipelineState(distPipe)
      enc.setFragmentTexture(finalJfa, index: 0)
      enc.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
    }

    // 4 — cascades, top down; cascade n writes casc[n % 2], reads the other
    let steps = Float(Int(settings.raySteps))
    for n in stride(from: cascadeCount - 1, through: 0, by: -1) {
      var cp = cascadeParams[n]
      cp.isTop = n == cascadeCount - 1 ? 1 : 0
      cp.steps = steps
      let region = cascadeRegions[n]
      fullPass(cb, to: casc[n % 2]) { enc in
        enc.setViewport(MTLViewport(originX: 0, originY: 0,
                                    width: Double(region.0), height: Double(region.1),
                                    znear: 0, zfar: 1))
        enc.setScissorRect(MTLScissorRect(x: 0, y: 0, width: region.0, height: region.1))
        enc.setRenderPipelineState(cascadePipe)
        enc.setFragmentBytes(&U, length: MemoryLayout<Uniforms>.stride, index: 0)
        enc.setFragmentBytes(&cp, length: MemoryLayout<CascadeParams>.stride, index: 1)
        enc.setFragmentTexture(sceneTex, index: 0)
        enc.setFragmentTexture(distTex, index: 1)
        enc.setFragmentTexture(casc[(n + 1) % 2], index: 2)
        enc.setFragmentSamplerState(sampler, index: 0)
        enc.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
      }
    }

    // 5 — resolve to linear HDR (fluence + emission + smoke)
    fullPass(cb, to: hdrTex) { enc in
      enc.setRenderPipelineState(resolvePipe)
      enc.setFragmentBytes(&U, length: MemoryLayout<Uniforms>.stride, index: 0)
      enc.setFragmentBytes(&post, length: MemoryLayout<PostParams>.stride, index: 1)
      enc.setFragmentTexture(casc[0], index: 0)
      enc.setFragmentTexture(sceneTex, index: 1)
      enc.setFragmentSamplerState(sampler, index: 0)
      enc.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
    }

    // 6 — bloom: bright pass at half res, gaussian, added back in final
    fullPass(cb, to: brightTex) { enc in
      enc.setRenderPipelineState(brightPipe)
      enc.setFragmentTexture(hdrTex, index: 0)
      enc.setFragmentSamplerState(sampler, index: 0)
      enc.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
    }
    blur.encode(commandBuffer: cb, sourceTexture: brightTex, destinationTexture: bloomTex)

    // 7 — final: shimmer, bloom, EDR tonemap, vignette, grain → drawable
    guard let rpd = view.currentRenderPassDescriptor, let drawable = view.currentDrawable else {
      cb.commit()
      return
    }
    if let enc = cb.makeRenderCommandEncoder(descriptor: rpd) {
      enc.setRenderPipelineState(finalPipe)
      enc.setFragmentBytes(&U, length: MemoryLayout<Uniforms>.stride, index: 0)
      enc.setFragmentBytes(&post, length: MemoryLayout<PostParams>.stride, index: 1)
      enc.setFragmentTexture(hdrTex, index: 0)
      enc.setFragmentTexture(bloomTex, index: 1)
      enc.setFragmentTexture(sceneTex, index: 2)
      enc.setFragmentTexture(distTex, index: 3)
      enc.setFragmentSamplerState(sampler, index: 0)
      enc.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
      enc.endEncoding()
    }

    frameIndex += 1
    if let path = snapshotPath, frameIndex >= 150 {
      snapshotPath = nil
      encodeSnapshot(cb, drawable.texture, to: path)
    }

    cb.present(drawable)
    cb.commit()
  }

  // ---- debug snapshot ----------------------------------------------------------

  private func encodeSnapshot(_ cb: MTLCommandBuffer, _ tex: MTLTexture, to path: String) {
    let w = tex.width
    let h = tex.height
    let bpr = w * 8 // rgba16Float
    guard let buf = device.makeBuffer(length: bpr * h, options: .storageModeShared),
          let blit = cb.makeBlitCommandEncoder() else { return }
    blit.copy(from: tex, sourceSlice: 0, sourceLevel: 0,
              sourceOrigin: MTLOrigin(x: 0, y: 0, z: 0),
              sourceSize: MTLSize(width: w, height: h, depth: 1),
              to: buf, destinationOffset: 0,
              destinationBytesPerRow: bpr, destinationBytesPerImage: bpr * h)
    blit.endEncoding()
    cb.addCompletedHandler { _ in
      let halves = buf.contents().bindMemory(to: Float16.self, capacity: w * h * 4)
      if ProcessInfo.processInfo.environment["BONFIRE_STATS"] != nil {
        func px(_ fx: Double, _ fy: Double) -> String {
          let i = (Int(Double(h) * fy) * w + Int(Double(w) * fx)) * 4
          return String(format: "(%.2f,%.2f): %.4f %.4f %.4f", fx, fy,
                        Float(halves[i]), Float(halves[i + 1]), Float(halves[i + 2]))
        }
        print("linear drawable samples:")
        for (fx, fy) in [(0.08, 0.08), (0.92, 0.08), (0.5, 0.1), (0.5, 0.35), (0.18, 0.3), (0.5, 0.62), (0.5, 0.95)] {
          print("  " + px(fx, fy))
        }
        print(String(format: "fps: %.1f", self.settings.fps))
      }
      var bytes = [UInt8](repeating: 0, count: w * h * 4)
      for i in 0..<(w * h) {
        for c in 0..<3 {
          let v = max(0, min(1, Float(halves[i * 4 + c])))
          bytes[i * 4 + c] = UInt8(pow(v, 1 / 2.2) * 255)
        }
        bytes[i * 4 + 3] = 255
      }
      let cs = CGColorSpaceCreateDeviceRGB()
      if let ctx = CGContext(data: &bytes, width: w, height: h, bitsPerComponent: 8,
                             bytesPerRow: w * 4, space: cs,
                             bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue),
         let img = ctx.makeImage(),
         let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: path) as CFURL,
                                                    "public.png" as CFString, 1, nil) {
        CGImageDestinationAddImage(dest, img, nil)
        CGImageDestinationFinalize(dest)
      }
      DispatchQueue.main.async { NSApp.terminate(nil) }
    }
  }
}
