// Radiance cascades over a caller-drawn scene texture. The caller renders
// emission (rgb) + occlusion (a) into `sceneTex` however it likes — metaball
// wax, paint strokes — then encodeGI() runs seed → jump flood → distance
// field → cascades, and encodeComposite() resolves cascade 0 into lit pixels.

import rcShader from "../shaders/rc.wgsl?raw";

export interface CompositeOpts {
  exposure?: number;
  emitBoost?: number;
  debugMode?: number; // 0 final · 1 scene · 2 occupancy · 3 distance · 4 light only
}

export interface BrushStamp {
  x: number; // scene pixels
  y: number;
  radius: number;
  color: [number, number, number];
  occlusion: number;
  hardness?: number;
  erase?: boolean;
}

export interface SkyOpts {
  zenith: [number, number, number];
  horizon: [number, number, number];
  /** direction the sun shines FROM, scene px space (y down); e.g. [0.4, -1] = high, slightly east */
  sunDir?: [number, number];
  sunSharpness?: number;
  sunIntensity?: number;
  sunColor?: [number, number, number];
  /** 0 disables the sky entirely (the pre-sky black-void behaviour) */
  strength?: number;
}

const BRUSH_POOL = 64;

export class RadianceCascades {
  readonly width: number;
  readonly height: number;
  readonly cascadeCount: number;
  readonly sceneTex: GPUTexture;
  readonly sceneView: GPUTextureView;

  private dev: GPUDevice;

  private jfa: [GPUTexture, GPUTexture];
  private dist: GPUTexture;
  private casc: [GPUTexture, GPUTexture];
  private probes0: [number, number];

  private seedPipe: GPURenderPipeline;
  private jfaPipe: GPURenderPipeline;
  private distPipe: GPURenderPipeline;
  private cascadePipe: GPURenderPipeline;
  private compositePipe: GPURenderPipeline;
  private paintPipe: GPURenderPipeline;
  private erasePipe: GPURenderPipeline;

  private seedGroup: GPUBindGroup;
  private jfaGroups: GPUBindGroup[] = []; // one per jump-flood pass
  private jfaOffsets: number[] = [];
  private distGroup: GPUBindGroup;
  private cascGroups: { main: GPUBindGroup; top: GPUBindGroup; region: [number, number] }[] = [];
  private compositeGroup: GPUBindGroup;
  private compositeBuf: GPUBuffer;
  private skyBuf: GPUBuffer;
  private casc0View: GPUTextureView;
  private brushBufs: GPUBuffer[] = [];
  private brushGroups: GPUBindGroup[] = [];
  private brushCursor = 0;

  // temporal accumulation (opt-in): EMA history of cascade 0
  private texFull: [number, number];
  private histTex: GPUTexture | null = null;
  private histView: GPUTextureView | null = null;
  private tempTex: GPUTexture | null = null;
  private temporalPipe: GPURenderPipeline | null = null;
  private temporalGroup: GPUBindGroup | null = null;
  private temporalBuf: GPUBuffer | null = null;

  /**
   * @param temporal blend-in rate per frame for an exponential moving average
   * over cascade 0 (0 = off). ~0.2 kills most GI noise (flickering point
   * lights, bounce-feedback boiling) at the cost of ~5 frames of light lag.
   */
  constructor(dev: GPUDevice, width: number, height: number, interval0 = 4, temporal = 0) {
    this.dev = dev;
    this.width = width;
    this.height = height;

    const mk = (format: GPUTextureFormat): GPUTexture =>
      dev.createTexture({
        size: [width, height],
        format,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
    this.sceneTex = mk("rgba16float");
    this.sceneView = this.sceneTex.createView();
    this.jfa = [mk("rg16float"), mk("rg16float")];
    this.dist = mk("r16float");

    // probe grid: one probe per 2×2 scene pixels at cascade 0; the cascade
    // texture (probes × 2×2 direction blocks) is then exactly scene-sized
    this.probes0 = [Math.max(4, Math.floor(width / 2)), Math.max(4, Math.floor(height / 2))];
    const texFull: [number, number] = [this.probes0[0] * 2, this.probes0[1] * 2];
    this.casc = [
      dev.createTexture({ size: texFull, format: "rgba16float", usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING }),
      dev.createTexture({ size: texFull, format: "rgba16float", usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING }),
    ];
    this.texFull = texFull;

    // enough cascades for the top interval to reach past the diagonal
    const diag = Math.hypot(width, height);
    let nc = Math.ceil(Math.log((3 * diag) / interval0 + 1) / Math.log(4));
    while (nc > 1 && (this.probes0[0] >> (nc - 1) < 2 || this.probes0[1] >> (nc - 1) < 2)) nc--;
    this.cascadeCount = Math.max(nc, 2);

    const module = dev.createShaderModule({ code: rcShader });
    const pipe = (fs: string, format: GPUTextureFormat, blend?: GPUBlendState): GPURenderPipeline =>
      dev.createRenderPipeline({
        layout: "auto",
        vertex: { module, entryPoint: fs.startsWith("fsBrush") ? "vsBrush" : "vsFull" },
        fragment: { module, entryPoint: fs.startsWith("fsBrush") ? "fsBrush" : fs, targets: [{ format, blend }] },
        primitive: { topology: "triangle-list" },
      });
    this.seedPipe = pipe("fsSeed", "rg16float");
    this.jfaPipe = pipe("fsJfa", "rg16float");
    this.distPipe = pipe("fsDist", "r16float");
    this.cascadePipe = pipe("fsCascade", "rgba16float");
    this.compositePipe = pipe("fsComposite", navigator.gpu.getPreferredCanvasFormat());
    const over: GPUBlendState = {
      color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
      alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
    };
    const fade: GPUBlendState = {
      color: { srcFactor: "zero", dstFactor: "one-minus-src-alpha", operation: "add" },
      alpha: { srcFactor: "zero", dstFactor: "one-minus-src-alpha", operation: "add" },
    };
    this.paintPipe = pipe("fsBrush", "rgba16float", over);
    this.erasePipe = pipe("fsBrush-erase" as "fsBrush", "rgba16float", fade);

    const linSamp = dev.createSampler({ magFilter: "linear", minFilter: "linear" });

    this.seedGroup = dev.createBindGroup({
      layout: this.seedPipe.getBindGroupLayout(0),
      entries: [{ binding: 1, resource: this.sceneView }],
    });

    // jump-flood passes: offsets halve from the largest power of two
    let off = 1;
    while (off * 2 < Math.max(width, height)) off *= 2;
    for (let i = 0; off >= 1; off = Math.floor(off / 2), i++) {
      const buf = dev.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      dev.queue.writeBuffer(buf, 0, new Float32Array([off, 0, 0, 0]));
      this.jfaOffsets.push(off);
      this.jfaGroups.push(
        dev.createBindGroup({
          layout: this.jfaPipe.getBindGroupLayout(0),
          entries: [
            { binding: 5, resource: this.jfa[i % 2].createView() },
            { binding: 6, resource: { buffer: buf } },
          ],
        }),
      );
      if (off === 1) break;
    }
    const finalJfa = this.jfa[this.jfaGroups.length % 2];
    this.distGroup = dev.createBindGroup({
      layout: this.distPipe.getBindGroupLayout(0),
      entries: [{ binding: 5, resource: finalJfa.createView() }],
    });

    // sky uniform: zeroed = old behaviour (top cascade merges with darkness)
    this.skyBuf = dev.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    // cascade uniforms + bind groups (a "top" variant merges with the sky)
    const distView = this.dist.createView();
    const cascViews = [this.casc[0].createView(), this.casc[1].createView()];
    this.casc0View = cascViews[0];
    for (let n = 0; n < this.cascadeCount; n++) {
      const probes: [number, number] = [Math.max(this.probes0[0] >> n, 1), Math.max(this.probes0[1] >> n, 1)];
      const upProbes: [number, number] = [Math.max(this.probes0[0] >> (n + 1), 1), Math.max(this.probes0[1] >> (n + 1), 1)];
      const blocks = 2 << n;
      const start = (interval0 * (Math.pow(4, n) - 1)) / 3;
      const len = interval0 * Math.pow(4, n);
      const mkBuf = (isTop: number): GPUBuffer => {
        const b = dev.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        dev.queue.writeBuffer(
          b, 0,
          new Float32Array([probes[0], probes[1], upProbes[0], upProbes[1], blocks, blocks * 2, start, len, isTop, 0, 0, 0]),
        );
        return b;
      };
      const mkGroup = (buf: GPUBuffer): GPUBindGroup =>
        dev.createBindGroup({
          layout: this.cascadePipe.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: buf } },
            { binding: 1, resource: this.sceneView },
            { binding: 2, resource: distView },
            { binding: 3, resource: cascViews[(n + 1) % 2] },
            { binding: 4, resource: linSamp },
            { binding: 10, resource: { buffer: this.skyBuf } },
          ],
        });
      this.cascGroups.push({
        main: mkGroup(mkBuf(0)),
        top: mkGroup(mkBuf(1)),
        region: [probes[0] * blocks, probes[1] * blocks],
      });
    }

    // temporal history: blend cascade 0 into tempTex, copy back to histTex —
    // the copy keeps histView a stable binding for callers holding `fluence`
    if (temporal > 0) {
      this.histTex = dev.createTexture({
        size: texFull, format: "rgba16float",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      this.histView = this.histTex.createView();
      this.tempTex = dev.createTexture({
        size: texFull, format: "rgba16float",
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      });
      this.temporalPipe = pipe("fsTemporal", "rgba16float");
      this.temporalBuf = dev.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      dev.queue.writeBuffer(this.temporalBuf, 0, new Float32Array([temporal, 0, 0, 0]));
      this.temporalGroup = dev.createBindGroup({
        layout: this.temporalPipe.getBindGroupLayout(0),
        entries: [
          { binding: 8, resource: cascViews[0] },
          { binding: 11, resource: this.histView },
          { binding: 12, resource: { buffer: this.temporalBuf } },
        ],
      });
    }

    this.compositeBuf = dev.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.compositeGroup = dev.createBindGroup({
      layout: this.compositePipe.getBindGroupLayout(0),
      entries: [
        { binding: 1, resource: this.sceneView },
        { binding: 2, resource: distView },
        { binding: 4, resource: linSamp },
        { binding: 7, resource: { buffer: this.compositeBuf } },
        { binding: 8, resource: this.histView ?? cascViews[0] },
      ],
    });

    for (let i = 0; i < BRUSH_POOL; i++) {
      const buf = dev.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      this.brushBufs.push(buf);
      this.brushGroups.push(
        dev.createBindGroup({
          layout: this.paintPipe.getBindGroupLayout(0),
          entries: [{ binding: 9, resource: { buffer: buf } }],
        }),
      );
    }
  }

  // Environment light. Call once (or per frame for a moving sun) — the top
  // cascade's escaping rays return this instead of darkness.
  setSky(s: SkyOpts): void {
    const dir = s.sunDir ?? [0.3, -1];
    const sc = s.sunColor ?? [1, 0.85, 0.6];
    this.dev.queue.writeBuffer(
      this.skyBuf, 0,
      new Float32Array([
        ...s.zenith, 0,
        ...s.horizon, 0,
        dir[0], dir[1], s.sunSharpness ?? 24, s.sunIntensity ?? 0,
        ...sc, s.strength ?? 1,
      ]),
    );
  }

  // Last frame's cascade 0 (the temporal history, when enabled) — sample it
  // in a scene shader (4 direction blocks, bilinear, average) for one-frame-
  // delayed fluence: the cheap road to multi-bounce light.
  get fluence(): { view: GPUTextureView; probes: [number, number] } {
    return { view: this.histView ?? this.casc0View, probes: [this.probes0[0], this.probes0[1]] };
  }

  clearScene(enc: GPUCommandEncoder): void {
    const pass = enc.beginRenderPass({
      colorAttachments: [{ view: this.sceneView, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "store" }],
    });
    pass.end();
  }

  // Stamp a brush into the scene (paint demo). Buffers come from a small
  // ring, so many stamps can ride one command encoder.
  brush(enc: GPUCommandEncoder, s: BrushStamp): void {
    const i = this.brushCursor++ % BRUSH_POOL;
    const f = new Float32Array(12);
    f.set([s.x, s.y, this.width, this.height, s.radius, s.hardness ?? 0.25, 0, 0]);
    f.set([s.color[0], s.color[1], s.color[2], s.occlusion], 8);
    this.dev.queue.writeBuffer(this.brushBufs[i], 0, f);
    const pass = enc.beginRenderPass({
      colorAttachments: [{ view: this.sceneView, loadOp: "load", storeOp: "store" }],
    });
    pass.setPipeline(s.erase ? this.erasePipe : this.paintPipe);
    pass.setBindGroup(0, this.brushGroups[i]);
    pass.draw(6);
    pass.end();
  }

  // Light transport: seed, flood, distance, cascades top-down. Passing a
  // smaller `cascades` truncates the hierarchy — light simply stops
  // travelling further than the top interval, which is the most honest
  // possible demo of what each level contributes.
  encodeGI(enc: GPUCommandEncoder, cascades?: number): void {
    const target = (view: GPUTextureView): GPURenderPassEncoder =>
      enc.beginRenderPass({ colorAttachments: [{ view, loadOp: "clear", storeOp: "store" }] });

    let pass = target(this.jfa[0].createView());
    pass.setPipeline(this.seedPipe);
    pass.setBindGroup(0, this.seedGroup);
    pass.draw(3);
    pass.end();

    for (let i = 0; i < this.jfaGroups.length; i++) {
      pass = target(this.jfa[(i + 1) % 2].createView());
      pass.setPipeline(this.jfaPipe);
      pass.setBindGroup(0, this.jfaGroups[i]);
      pass.draw(3);
      pass.end();
    }

    pass = target(this.dist.createView());
    pass.setPipeline(this.distPipe);
    pass.setBindGroup(0, this.distGroup);
    pass.draw(3);
    pass.end();

    const nc = Math.min(Math.max(cascades ?? this.cascadeCount, 1), this.cascadeCount);
    for (let n = nc - 1; n >= 0; n--) {
      const g = this.cascGroups[n];
      pass = target(this.casc[n % 2].createView());
      pass.setViewport(0, 0, g.region[0], g.region[1], 0, 1);
      pass.setPipeline(this.cascadePipe);
      pass.setBindGroup(0, n === nc - 1 ? g.top : g.main);
      pass.draw(3);
      pass.end();
    }

    if (this.temporalPipe && this.tempTex && this.histTex) {
      pass = target(this.tempTex.createView());
      pass.setPipeline(this.temporalPipe);
      pass.setBindGroup(0, this.temporalGroup!);
      pass.draw(3);
      pass.end();
      enc.copyTextureToTexture({ texture: this.tempTex }, { texture: this.histTex }, this.texFull);
    }
  }

  encodeComposite(enc: GPUCommandEncoder, view: GPUTextureView, opts: CompositeOpts = {}): void {
    this.dev.queue.writeBuffer(
      this.compositeBuf, 0,
      new Float32Array([this.probes0[0], this.probes0[1], opts.exposure ?? 1.6, opts.debugMode ?? 0, opts.emitBoost ?? 0.55, 0, 0, 0]),
    );
    const pass = enc.beginRenderPass({
      colorAttachments: [{ view, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: "clear", storeOp: "store" }],
    });
    pass.setPipeline(this.compositePipe);
    pass.setBindGroup(0, this.compositeGroup);
    pass.draw(3);
    pass.end();
  }

  dispose(): void {
    this.sceneTex.destroy();
    this.dist.destroy();
    for (const t of this.jfa) t.destroy();
    for (const t of this.casc) t.destroy();
    for (const b of this.brushBufs) b.destroy();
    this.compositeBuf.destroy();
    this.skyBuf.destroy();
    this.histTex?.destroy();
    this.tempTex?.destroy();
    this.temporalBuf?.destroy();
  }
}
