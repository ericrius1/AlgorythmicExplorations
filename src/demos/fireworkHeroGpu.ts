// The GPU fireworks. One FireworksWorld per page owns the particle buffers,
// the compute pipeline and the launch schedule; each canvas that shows it (the
// hero, the live figure) is a FireworksView with its own HDR target and
// uniforms. The world steps once per animation frame no matter how many
// views draw it, and both views share one pair of particle buffers, so the
// page only allocates them once.

import sceneShader from "../shaders/fireworks/scene.wgsl?raw";
import simShader from "../shaders/fireworks/fireworks_sim.wgsl?raw";
import renderShader from "../shaders/fireworks/fireworks_render.wgsl?raw";
import { getDevice } from "../lib/gpu";
import { PostFX, HDR_FORMAT } from "../lib/postfx";

export type FireworkSystemId = "classic" | "collapse";

export interface LaunchStyle {
  system: FireworkSystemId;
  sparks: number; // main-shell sparks for one rocket
}

export interface FireworkStats {
  live: number; // particles alive after the last frame (GPU write counter)
  emitted: number; // particles created by emit commands that frame
  commands: number; // emit commands uploaded that frame
  overflow: number; // appends that didn't fit that frame
  capacity: number; // particles per buffer
  storageLimit: number; // device.limits.maxStorageBufferBindingSize
  gpuBytes: number; // everything this world allocated
  rockets: number; // rockets in flight (CPU side)
  queued: number; // follow-up bursts waiting to fire (CPU side)
}

const PARTICLE_FLOATS = 20;
export const PARTICLE_STRIDE = PARTICLE_FLOATS * 4; // 80 bytes
const UNIFORM_FLOATS = 44;
export const EMIT_COMMAND_BYTES = 96;
const INITIAL_EMIT_COMMAND_CAPACITY = 65_536;
const COUNTER_BYTES = 32;
const DRAW_INDIRECT_BYTES = 16;
const DISPATCH_INDIRECT_BYTES = 12;
const WORKGROUP_SIZE = 256;
const TRAIL_INTERVAL = 0.018; // seconds between a rocket's trail commands
const TAU = Math.PI * 2;

const enum EmitKind {
  Rocket = 1,
  Trail = 2,
  Explosion = 3,
  Collapse = 4,
}

type Vec2 = [number, number];
type Color = [number, number, number];

interface Settings {
  scene: { parallaxStrength: number; depthPower: number; exposure: number; depthOcclusion: number };
  launch: { flightTime: number; burstSpeed: number; pyramidLevels: number; gridCells: number };
  physics: { gravity: number; drag: number; wind: number; gridScale: number; gridStrength: number; pyramidSpin: number };
  render: { sparkSize: number; rocketSize: number; trailStretch: number; smokeSize: number; glow: number };
  collapse: {
    grainMultiplier: number;
    shells: number;
    delay: number;
    duration: number;
    strength: number;
    stickiness: number;
    hashCellSize: number;
    spiralStrength: number;
    returnScatter: number;
  };
}

function createSettings(): Settings {
  return {
    scene: { parallaxStrength: 0.042, depthPower: 1.0, exposure: 1.0, depthOcclusion: 0.9 },
    launch: { flightTime: 0.72, burstSpeed: 0.88, pyramidLevels: 6, gridCells: 11 },
    physics: { gravity: 0.42, drag: 0.985, wind: 0.11, gridScale: 18, gridStrength: 0.32, pyramidSpin: 0.18 },
    render: { sparkSize: 0.6, rocketSize: 0.75, trailStretch: 2.6, smokeSize: 0.85, glow: 1.25 },
    collapse: {
      grainMultiplier: 1.85,
      shells: 9,
      delay: 0.92,
      duration: 1.15,
      strength: 4.1,
      stickiness: 0.92,
      hashCellSize: 0.044,
      spiralStrength: 0.42,
      returnScatter: 1.05,
    },
  };
}

interface Launch {
  style: LaunchStyle;
  start: Vec2;
  target: Vec2;
  velocity: Vec2;
  born: number;
  flightTime: number;
  nextTrail: number;
  color: Color;
  accent: Color;
  seed: number;
  aspect: number;
}

interface ScheduledBurst {
  at: number;
  target: Vec2;
  color: Color;
  accent: Color;
  seed: number;
  scale: number;
  sparks: number;
}

interface EmitCommand {
  kind: EmitKind;
  count: number;
  start: number;
  aux: number;
  pos: Vec2;
  scale: number;
  seed: number;
  vel: Vec2;
  life: number;
  size: number;
  color: Color;
  accent: Color;
  home: Vec2;
  param0: number;
  param1: number;
}

const palettes: Array<[Color, Color]> = [
  [
    [1.0, 0.28, 0.08],
    [1.0, 0.78, 0.28],
  ],
  [
    [0.35, 0.72, 1.0],
    [0.78, 0.95, 1.0],
  ],
  [
    [0.92, 0.24, 1.0],
    [0.24, 0.88, 1.0],
  ],
  [
    [0.52, 1.0, 0.42],
    [1.0, 0.92, 0.36],
  ],
  [
    [1.0, 0.9, 0.72],
    [1.0, 0.35, 0.16],
  ],
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function hash01(n: number): number {
  const value = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

// ---------------------------------------------------------------------------
// The painted backdrop: sky, stars, three ridges with haze between them, and a
// depth map that matches (0 = sky, larger = nearer). Drawn once on the CPU.

const SCENE_W = 1600;
const SCENE_H = 900;

function ridgeHeights(layer: number, samples: number): Float32Array {
  const out = new Float32Array(samples + 1);
  const base = [0.6, 0.7, 0.81][layer];
  const amp = [0.07, 0.065, 0.06][layer];
  for (let i = 0; i <= samples; i++) {
    const x = i / samples;
    let y = 0;
    let a = 1;
    let f = 1.6 + layer * 0.7;
    for (let o = 0; o < 6; o++) {
      const ph = hash01(layer * 31 + o * 7.3) * TAU;
      y += a * Math.sin(x * f * TAU * 0.5 + ph) + a * 0.5 * Math.sin(x * f * 1.7 * TAU * 0.5 + ph * 1.3);
      a *= 0.5;
      f *= 2.1;
    }
    out[i] = base + y * amp * 0.6;
  }
  return out;
}

function traceRidge(ctx: CanvasRenderingContext2D, heights: Float32Array, w: number, h: number): void {
  ctx.beginPath();
  ctx.moveTo(0, h);
  for (let i = 0; i < heights.length; i++) ctx.lineTo((i / (heights.length - 1)) * w, heights[i] * h);
  ctx.lineTo(w, h);
  ctx.closePath();
}

function createSceneTextures(device: GPUDevice): { backdrop: GPUTexture; depth: GPUTexture } {
  const w = SCENE_W;
  const h = SCENE_H;
  const ridges = [0, 1, 2].map((l) => ridgeHeights(l, 220));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  const sky = ctx.createLinearGradient(0, 0, 0, h * 0.85);
  sky.addColorStop(0, "#04050d");
  sky.addColorStop(0.45, "#0b0d26");
  sky.addColorStop(0.72, "#1a1636");
  sky.addColorStop(0.86, "#32203a");
  sky.addColorStop(1, "#45293a");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  // stars, thinning toward the horizon
  for (let i = 0; i < 520; i++) {
    const x = hash01(i * 3.1) * w;
    const y = Math.pow(hash01(i * 7.7), 1.6) * h * 0.66;
    const b = Math.pow(hash01(i * 1.9), 3) * (1 - y / (h * 0.7));
    const r = 0.5 + b * 1.1;
    ctx.fillStyle = `rgba(220, 228, 255, ${0.25 + b * 0.75})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  }

  const fills = ["#151a33", "#0c0f1f", "#05060c"];
  for (let l = 0; l < 3; l++) {
    // haze sitting in the valley behind each ridge
    const top = Math.min(...ridges[l]) * h;
    const haze = ctx.createLinearGradient(0, top - h * 0.06, 0, top + h * 0.1);
    haze.addColorStop(0, "rgba(70, 52, 92, 0)");
    haze.addColorStop(1, `rgba(70, 52, 92, ${0.28 - l * 0.07})`);
    ctx.fillStyle = haze;
    ctx.fillRect(0, top - h * 0.06, w, h * 0.16);
    traceRidge(ctx, ridges[l], w, h);
    ctx.fillStyle = fills[l];
    ctx.fill();
  }
  // a few lit windows down in the near valley
  for (let i = 0; i < 18; i++) {
    const x = (0.08 + hash01(i * 5.3) * 0.84) * w;
    const ridgeY = ridges[2][Math.round((x / w) * 220)] * h;
    const y = ridgeY + (0.02 + hash01(i * 2.9) * 0.08) * h;
    ctx.fillStyle = `rgba(255, 196, 120, ${0.35 + hash01(i * 8.1) * 0.4})`;
    ctx.fillRect(x, y, 2, 2);
  }

  const depthCanvas = document.createElement("canvas");
  depthCanvas.width = w;
  depthCanvas.height = h;
  const dctx = depthCanvas.getContext("2d")!;
  dctx.fillStyle = "rgb(10, 10, 10)";
  dctx.fillRect(0, 0, w, h);
  const depthLevels = [115, 160, 210];
  for (let l = 0; l < 3; l++) {
    traceRidge(dctx, ridges[l], w, h);
    dctx.fillStyle = `rgb(${depthLevels[l]}, ${depthLevels[l]}, ${depthLevels[l]})`;
    dctx.fill();
  }

  const upload = (source: HTMLCanvasElement, format: GPUTextureFormat): GPUTexture => {
    const texture = device.createTexture({
      size: [w, h],
      format,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    device.queue.copyExternalImageToTexture({ source }, { texture }, [w, h]);
    return texture;
  };
  // sRGB format, so sampling returns linear light for the HDR target
  return { backdrop: upload(canvas, "rgba8unorm-srgb"), depth: upload(depthCanvas, "rgba8unorm") };
}

// ---------------------------------------------------------------------------

export class FireworksView {
  readonly canvas: HTMLCanvasElement;
  readonly post: PostFX;
  readonly context: GPUCanvasContext;
  readonly uniformBuffer: GPUBuffer;
  sceneBindGroup!: GPUBindGroup;
  renderBindGroups!: [GPUBindGroup, GPUBindGroup];
  mouse: Vec2 = [0, 0];
  mouseTarget: Vec2 = [0, 0];

  constructor(world: FireworksWorld, canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const context = canvas.getContext("webgpu");
    if (!context) throw new Error("no webgpu context");
    this.context = context;
    context.configure({ device: world.device, format: navigator.gpu.getPreferredCanvasFormat(), alphaMode: "opaque" });
    this.post = new PostFX(world.device, context);
    this.post.settings.exposure = 1.15;
    this.post.settings.bloom = 0.2;
    this.post.settings.vignette = 0.3;
    this.uniformBuffer = world.device.createBuffer({
      label: "firework view params",
      size: UNIFORM_FLOATS * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    world.bindView(this);
    canvas.addEventListener("pointermove", (event) => {
      const rect = canvas.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      const y = 1 - ((event.clientY - rect.top) / rect.height) * 2;
      this.mouseTarget = [clamp(x, -1, 1), clamp(y, -1, 1)];
    });
    canvas.addEventListener("pointerleave", () => {
      this.mouseTarget = [0, 0];
    });
  }

  aspect(): number {
    return Math.max(0.001, this.canvas.width / Math.max(1, this.canvas.height));
  }

  // Match the canvas to its CSS size, capped the same way demoShell caps heroes.
  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = this.canvas.clientWidth;
    const cssH = this.canvas.clientHeight;
    if (cssW === 0 || cssH === 0) return;
    const scale = Math.min(dpr, 2560 / cssW);
    const width = Math.max(1, Math.floor(cssW * scale));
    const height = Math.max(1, Math.floor(cssH * scale));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  dispose(): void {
    this.post.dispose();
    this.uniformBuffer.destroy();
  }
}

export class FireworksWorld {
  readonly device: GPUDevice;
  readonly capacity: number;
  readonly storageLimit: number;
  readonly gpuBytes: number;
  private readonly settings = createSettings();
  private readonly backdrop: GPUTexture;
  private readonly depth: GPUTexture;
  private readonly sampler: GPUSampler;
  private readonly simUniformBuffer: GPUBuffer;
  private readonly particleBuffers: [GPUBuffer, GPUBuffer];
  private readonly counterBuffer: GPUBuffer;
  private readonly readbackBuffer: GPUBuffer;
  private readonly drawIndirectBuffer: GPUBuffer;
  private readonly dispatchIndirectBuffer: GPUBuffer;
  private emitCommandBuffer: GPUBuffer;
  private readonly scenePipeline: GPURenderPipeline;
  private readonly renderPipeline: GPURenderPipeline;
  private readonly beginFramePipeline: GPUComputePipeline;
  private readonly simulatePipeline: GPUComputePipeline;
  private readonly emitPipeline: GPUComputePipeline;
  private readonly finishFramePipeline: GPUComputePipeline;
  private readonly beginFrameBindGroup: GPUBindGroup;
  private readonly finishFrameBindGroup: GPUBindGroup;
  private readonly simulateBindGroups: [GPUBindGroup, GPUBindGroup];
  private emitBindGroups: [GPUBindGroup, GPUBindGroup];
  private readonly retiredEmitCommandBuffers: GPUBuffer[] = [];
  private emitCommandCapacity = INITIAL_EMIT_COMMAND_CAPACITY;
  private readonly simUniforms = new Float32Array(UNIFORM_FLOATS);
  private readonly viewUniforms = new Float32Array(UNIFORM_FLOATS);
  private readonly pendingEmitCommands: EmitCommand[] = [];
  private pendingEmitParticleCount = 0;
  private lastFrameEmitParticleCount = 0;
  private readonly launches: Launch[] = [];
  private readonly scheduledBursts: ScheduledBurst[] = [];
  private activeBufferIndex = 0;
  private lastStepMs = 0;
  private lastBurstTime = -999;
  private lastBurstUv: Vec2 = [0.5, 0.3];
  private lastBurstColor: Color = [1, 0.6, 0.3];
  private readbackBusy = false;
  private lastReadbackMs = 0;
  private statsWantedMs = -1e9;
  private latestStats: FireworkStats | null = null;
  private emittedAcc = 0;
  private commandsAcc = 0;
  // seconds of simulated time; every launch and shader clock reads this
  clock = 0;
  prewarmed = false;

  private static instance: Promise<FireworksWorld | null> | null = null;

  static get(): Promise<FireworksWorld | null> {
    FireworksWorld.instance ??= getDevice().then((device) => (device ? new FireworksWorld(device) : null));
    return FireworksWorld.instance;
  }

  private constructor(device: GPUDevice) {
    this.device = device;
    // Capacity is whatever one storage binding on this device can hold.
    this.storageLimit = device.limits.maxStorageBufferBindingSize;
    this.capacity = Math.max(1, Math.floor(this.storageLimit / PARTICLE_STRIDE));
    const { backdrop, depth } = createSceneTextures(device);
    this.backdrop = backdrop;
    this.depth = depth;

    this.sampler = device.createSampler({ magFilter: "linear", minFilter: "linear" });
    this.simUniformBuffer = device.createBuffer({
      label: "firework sim params",
      size: UNIFORM_FLOATS * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const particleBufferSize = this.capacity * PARTICLE_STRIDE;
    const particleBuffer = (label: string): GPUBuffer =>
      device.createBuffer({ label, size: particleBufferSize, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.particleBuffers = [particleBuffer("particles a"), particleBuffer("particles b")];
    this.counterBuffer = device.createBuffer({
      label: "firework counters",
      size: COUNTER_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
    this.readbackBuffer = device.createBuffer({
      label: "firework counter readback",
      size: COUNTER_BYTES,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    this.drawIndirectBuffer = device.createBuffer({
      label: "firework draw indirect",
      size: DRAW_INDIRECT_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST,
    });
    this.dispatchIndirectBuffer = device.createBuffer({
      label: "firework dispatch indirect",
      size: DISPATCH_INDIRECT_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST,
    });
    this.emitCommandBuffer = device.createBuffer({
      label: "firework emit commands",
      size: this.emitCommandCapacity * EMIT_COMMAND_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(this.counterBuffer, 0, new Uint32Array(8));
    device.queue.writeBuffer(this.drawIndirectBuffer, 0, new Uint32Array([6, 0, 0, 0]));
    device.queue.writeBuffer(this.dispatchIndirectBuffer, 0, new Uint32Array([0, 1, 1]));
    this.gpuBytes =
      particleBufferSize * 2 +
      this.emitCommandCapacity * EMIT_COMMAND_BYTES +
      COUNTER_BYTES * 2 +
      DRAW_INDIRECT_BYTES +
      DISPATCH_INDIRECT_BYTES +
      UNIFORM_FLOATS * 4;

    const sceneModule = device.createShaderModule({ label: "firework scene", code: sceneShader });
    const simModule = device.createShaderModule({ label: "firework sim", code: simShader });
    const renderModule = device.createShaderModule({ label: "firework render", code: renderShader });
    this.logCompilationInfo("scene", sceneModule);
    this.logCompilationInfo("simulation", simModule);
    this.logCompilationInfo("render", renderModule);

    const checked = <T>(label: string, make: () => T): T => {
      device.pushErrorScope("validation");
      const result = make();
      void device.popErrorScope().then((error) => {
        if (error) console.error(`${label} validation: ${error.message}`);
      });
      return result;
    };

    this.scenePipeline = checked("firework scene pipeline", () =>
      device.createRenderPipeline({
        label: "firework scene",
        layout: "auto",
        vertex: { module: sceneModule, entryPoint: "vertex" },
        fragment: { module: sceneModule, entryPoint: "fragment", targets: [{ format: HDR_FORMAT }] },
        primitive: { topology: "triangle-list" },
      }),
    );
    const compute = (label: string, entryPoint: string): GPUComputePipeline =>
      checked(label, () => device.createComputePipeline({ label, layout: "auto", compute: { module: simModule, entryPoint } }));
    this.beginFramePipeline = compute("firework begin frame", "beginFrame");
    this.simulatePipeline = compute("firework simulate compact", "simulateCompact");
    this.emitPipeline = compute("firework emit", "emitParticles");
    this.finishFramePipeline = compute("firework finish frame", "finishFrame");
    this.renderPipeline = checked("firework particle pipeline", () =>
      device.createRenderPipeline({
        label: "firework particles",
        layout: "auto",
        vertex: { module: renderModule, entryPoint: "vertex" },
        fragment: {
          module: renderModule,
          entryPoint: "fragment",
          targets: [
            {
              format: HDR_FORMAT,
              blend: {
                color: { operation: "add", srcFactor: "one", dstFactor: "one" },
                alpha: { operation: "add", srcFactor: "one", dstFactor: "one-minus-src-alpha" },
              },
            },
          ],
        },
        primitive: { topology: "triangle-list" },
      }),
    );

    this.beginFrameBindGroup = device.createBindGroup({
      label: "begin frame",
      layout: this.beginFramePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 3, resource: { buffer: this.counterBuffer } },
        { binding: 5, resource: { buffer: this.drawIndirectBuffer } },
      ],
    });
    this.finishFrameBindGroup = device.createBindGroup({
      label: "finish frame",
      layout: this.finishFramePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.simUniformBuffer } },
        { binding: 3, resource: { buffer: this.counterBuffer } },
        { binding: 5, resource: { buffer: this.drawIndirectBuffer } },
        { binding: 6, resource: { buffer: this.dispatchIndirectBuffer } },
      ],
    });
    this.simulateBindGroups = [this.createSimulateBindGroup(0, 1), this.createSimulateBindGroup(1, 0)];
    this.emitBindGroups = [this.createEmitBindGroup(0), this.createEmitBindGroup(1)];
  }

  bindView(view: FireworksView): void {
    view.sceneBindGroup = this.device.createBindGroup({
      label: "firework scene",
      layout: this.scenePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: view.uniformBuffer } },
        { binding: 1, resource: this.backdrop.createView() },
        { binding: 2, resource: this.depth.createView() },
        { binding: 3, resource: this.sampler },
      ],
    });
    const renderGroup = (buffer: GPUBuffer): GPUBindGroup =>
      this.device.createBindGroup({
        label: "firework particles",
        layout: this.renderPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: view.uniformBuffer } },
          { binding: 1, resource: { buffer } },
          { binding: 2, resource: this.depth.createView() },
          { binding: 3, resource: this.sampler },
        ],
      });
    view.renderBindGroups = [renderGroup(this.particleBuffers[0]), renderGroup(this.particleBuffers[1])];
  }

  private createSimulateBindGroup(readIndex: number, writeIndex: number): GPUBindGroup {
    return this.device.createBindGroup({
      label: `simulate ${readIndex} to ${writeIndex}`,
      layout: this.simulatePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.simUniformBuffer } },
        { binding: 1, resource: { buffer: this.particleBuffers[readIndex] } },
        { binding: 2, resource: { buffer: this.particleBuffers[writeIndex] } },
        { binding: 3, resource: { buffer: this.counterBuffer } },
      ],
    });
  }

  private createEmitBindGroup(writeIndex: number): GPUBindGroup {
    return this.device.createBindGroup({
      label: `emit to ${writeIndex}`,
      layout: this.emitPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.simUniformBuffer } },
        { binding: 2, resource: { buffer: this.particleBuffers[writeIndex] } },
        { binding: 3, resource: { buffer: this.counterBuffer } },
        { binding: 4, resource: { buffer: this.emitCommandBuffer } },
      ],
    });
  }

  private logCompilationInfo(label: string, module: GPUShaderModule): void {
    void module.getCompilationInfo().then((info) => {
      for (const message of info.messages) {
        const text = `${label} WGSL ${message.type}: ${message.message} (${message.lineNum}:${message.linePos})`;
        if (message.type === "error") console.error(text);
        else if (message.type === "warning") console.warn(text);
      }
    });
  }

  // ---- launching -----------------------------------------------------------

  // Launch one rocket toward `point` (x and y both -1..1, y up). `aspect` is
  // the canvas the click came from, used to keep spreads round.
  launch(point: Vec2, style: LaunchStyle, aspect: number): void {
    const now = this.clock;
    const target: Vec2 = [clamp(point[0], -0.96, 0.96), clamp(point[1], -0.58, 0.92)];
    const start: Vec2 = [clamp(point[0] + randomRange(-0.06, 0.06), -0.95, 0.95), -0.96];
    const seed = Math.random() * 1000 + now * 0.37;
    const [color, accent] = palettes[Math.floor(Math.random() * palettes.length)];
    const distance = Math.hypot(target[0] - start[0], target[1] - start[1]);
    const flightTime = clamp(this.settings.launch.flightTime * (0.72 + distance * 0.28), 0.35, 1.6);
    const rocketGravity = this.settings.physics.gravity * 0.13;
    const velocity: Vec2 = [
      (target[0] - start[0]) / flightTime,
      (target[1] - start[1] + 0.5 * rocketGravity * flightTime * flightTime) / flightTime,
    ];
    this.launches.push({ style, start, target, velocity, born: now, flightTime, nextTrail: 0, color, accent, seed, aspect });
    this.queue({
      kind: EmitKind.Rocket,
      count: 1,
      aux: 0,
      pos: start,
      scale: 1,
      seed,
      vel: velocity,
      life: flightTime + 0.1,
      size: 0.0065,
      color: accent,
      accent,
      home: target,
      param0: 0.54,
      param1: 0,
    });
    this.queue({
      kind: EmitKind.Trail,
      count: 42,
      aux: 0,
      pos: start,
      scale: 1,
      seed,
      vel: velocity,
      life: 0,
      size: 0,
      color,
      accent,
      home: start,
      param0: 0.5,
      param1: 0,
    });
  }

  // A small ring of launch points around `point`, so a volley doesn't stack.
  spread(point: Vec2, index: number, count: number, aspect: number): Vec2 {
    if (count <= 1) return point;
    const angle = (index / count) * TAU + randomRange(-0.24, 0.24);
    const radius = randomRange(0.018, 0.052 + count * 0.004);
    return [
      clamp(point[0] + (Math.cos(angle) * radius) / aspect, -1, 1),
      clamp(point[1] + Math.sin(angle) * radius * 0.72, -1, 1),
    ];
  }

  private updateLaunches(): void {
    const now = this.clock;
    const gravity = this.settings.physics.gravity * 0.13;
    for (let i = this.launches.length - 1; i >= 0; i--) {
      const launch = this.launches[i];
      const age = now - launch.born;
      if (age < launch.flightTime) {
        while (launch.nextTrail < age) {
          const t = launch.nextTrail;
          const pos: Vec2 = [
            launch.start[0] + launch.velocity[0] * t,
            launch.start[1] + launch.velocity[1] * t - 0.5 * gravity * t * t,
          ];
          this.queue({
            kind: EmitKind.Trail,
            count: 6,
            aux: 1,
            pos,
            scale: 1,
            seed: launch.seed + t,
            vel: launch.velocity,
            life: 0,
            size: 0,
            color: launch.color,
            accent: launch.accent,
            home: pos,
            param0: 0.48,
            param1: TRAIL_INTERVAL,
          });
          launch.nextTrail += TRAIL_INTERVAL;
        }
        continue;
      }
      if (launch.style.system === "collapse") {
        this.spawnCollapse(launch.target, launch.color, launch.accent, launch.seed, 1, false, launch.style.sparks);
      } else {
        this.spawnClassic(launch.target, launch.color, launch.accent, launch.seed, 1, false, launch.style.sparks, launch.aspect);
      }
      this.launches.splice(i, 1);
    }
    for (let i = this.scheduledBursts.length - 1; i >= 0; i--) {
      const b = this.scheduledBursts[i];
      if (b.at > now) continue;
      this.spawnClassic(b.target, b.color, b.accent, b.seed, b.scale, true, b.sparks, 1);
      this.scheduledBursts.splice(i, 1);
    }
  }

  private noteBurst(target: Vec2, color: Color): void {
    this.lastBurstTime = this.clock;
    this.lastBurstUv = [target[0] * 0.5 + 0.5, 0.5 - target[1] * 0.5];
    this.lastBurstColor = color;
  }

  private spawnClassic(
    target: Vec2,
    color: Color,
    accent: Color,
    seed: number,
    scale: number,
    mini: boolean,
    sparks: number,
    aspect: number,
  ): void {
    const launch = this.settings.launch;
    const sparkCount = Math.max(32, Math.round(sparks * scale));
    const levels = Math.max(2, Math.round(launch.pyramidLevels));
    const burstSpeed = launch.burstSpeed * (mini ? 0.78 : 1.0);
    const depth = target[1] > 0.05 ? 0.18 : 0.31;
    const gridCells = Math.max(3, Math.round(launch.gridCells));
    const crackleCount = Math.max(16, Math.round(gridCells * gridCells * 0.34 * scale));
    const emberCount = Math.round(64 * scale);
    const smokeCount = Math.round(30 * scale);
    if (!mini) this.noteBurst(target, color);

    // One command describes the whole shell: flash, sparks, crackle, embers, smoke.
    this.queue({
      kind: EmitKind.Explosion,
      count: 1 + sparkCount + crackleCount + emberCount + smokeCount,
      aux: sparkCount,
      pos: target,
      scale,
      seed,
      vel: [burstSpeed, levels],
      life: crackleCount,
      size: emberCount,
      color,
      accent,
      home: target,
      param0: depth,
      param1: smokeCount,
    });

    if (!mini) {
      // follow-up pops around the main shell a moment later
      const satellites = 5 + Math.floor(Math.random() * 4);
      for (let i = 0; i < satellites; i++) {
        const angle = (i / satellites) * TAU + randomRange(-0.18, 0.18);
        const radius = randomRange(0.08, 0.18);
        this.scheduledBursts.push({
          at: this.clock + randomRange(0.11, 0.3),
          target: [
            clamp(target[0] + (Math.cos(angle) * radius) / aspect, -0.96, 0.96),
            clamp(target[1] + Math.sin(angle) * radius * 0.74, -0.48, 0.94),
          ],
          color: accent,
          accent: color,
          seed: seed + i * 23.7,
          scale: randomRange(0.18, 0.28),
          sparks,
        });
      }
    }
  }

  private spawnCollapse(target: Vec2, color: Color, accent: Color, seed: number, scale: number, mini: boolean, sparks: number): void {
    const c = this.settings.collapse;
    const grainCount = Math.max(80, Math.round(sparks * c.grainMultiplier * scale * (mini ? 0.7 : 1.0)));
    const levels = Math.max(3, Math.round(c.shells));
    const burstSpeed = this.settings.launch.burstSpeed * (mini ? 0.86 : 1.08);
    const depth = target[1] > 0.05 ? 0.16 : 0.28;
    this.noteBurst(target, accent);
    this.queue({
      kind: EmitKind.Collapse,
      count: 1 + grainCount,
      aux: grainCount,
      pos: target,
      scale,
      seed,
      vel: [burstSpeed, levels],
      life: c.delay,
      size: c.duration,
      color,
      accent,
      home: target,
      param0: depth,
      param1: mini ? 1 : 0,
    });
  }

  private queue(command: Omit<EmitCommand, "start">): void {
    const count = Math.max(0, Math.floor(command.count));
    if (count === 0) return;
    this.pendingEmitCommands.push({ ...command, count, start: this.pendingEmitParticleCount });
    this.pendingEmitParticleCount += count;
  }

  private ensureEmitCommandCapacity(count: number): void {
    if (count <= this.emitCommandCapacity) return;
    let next = this.emitCommandCapacity;
    while (next < count) next *= 2;
    this.retiredEmitCommandBuffers.push(this.emitCommandBuffer);
    this.emitCommandCapacity = next;
    this.emitCommandBuffer = this.device.createBuffer({
      label: "firework emit commands",
      size: next * EMIT_COMMAND_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.emitBindGroups = [this.createEmitBindGroup(0), this.createEmitBindGroup(1)];
  }

  private flushEmitCommands(): void {
    const commandCount = this.pendingEmitCommands.length;
    this.lastFrameEmitParticleCount = this.pendingEmitParticleCount;
    this.emittedAcc += this.pendingEmitParticleCount;
    this.commandsAcc += commandCount;
    this.ensureEmitCommandCapacity(commandCount);
    if (commandCount > 0) {
      const bytes = new ArrayBuffer(commandCount * EMIT_COMMAND_BYTES);
      const view = new DataView(bytes);
      for (let i = 0; i < commandCount; i++) writeEmitCommand(view, i * EMIT_COMMAND_BYTES, this.pendingEmitCommands[i]);
      this.device.queue.writeBuffer(this.emitCommandBuffer, 0, bytes);
    }
    // counters.commandCount and counters.totalEmit
    this.device.queue.writeBuffer(this.counterBuffer, 8, new Uint32Array([commandCount, this.pendingEmitParticleCount]));
    this.pendingEmitCommands.length = 0;
    this.pendingEmitParticleCount = 0;
  }

  // ---- stepping ------------------------------------------------------------

  // Advance once per animation frame, however many views call this.
  step(nowMs: number): void {
    if (nowMs - this.lastStepMs < 4) return;
    const dt = this.lastStepMs > 0 ? clamp((nowMs - this.lastStepMs) / 1000, 0.001, 0.033) : 1 / 60;
    this.lastStepMs = nowMs;
    this.advance(dt);
  }

  // Run the show for a while before anyone sees it, so the first visible
  // frame is mid-show instead of an empty sky. `tick` schedules launches.
  prewarm(seconds: number, tick: (clock: number) => void): void {
    this.prewarmed = true;
    const steps = Math.round(seconds * 60);
    for (let i = 0; i < steps; i++) {
      tick(this.clock);
      this.advance(1 / 60);
    }
  }

  private advance(dt: number): void {
    this.clock += dt;
    const t = this.clock * 0.09;
    // slow drift in the shell shapes so consecutive bursts differ
    this.settings.launch.pyramidLevels = 4 + Math.round(2.5 + 2.5 * Math.sin(t));
    this.settings.launch.gridCells = 9 + Math.round(2 + 2 * Math.sin(t * 0.73 + 0.8));
    this.settings.physics.pyramidSpin = 0.1 + 0.2 * Math.sin(t * 0.52);
    this.settings.collapse.shells = 7 + Math.round(3 + 2 * Math.sin(t * 0.61 + 1.2));

    this.updateLaunches();
    this.flushEmitCommands();
    this.fillUniforms(this.simUniforms, dt, [0, 0], 1);
    this.device.queue.writeBuffer(this.simUniformBuffer, 0, this.simUniforms);

    const readIndex = this.activeBufferIndex;
    const writeIndex = 1 - readIndex;
    const encoder = this.device.createCommandEncoder({ label: "firework step" });
    const pass = encoder.beginComputePass({ label: "firework frame" });
    pass.setPipeline(this.beginFramePipeline);
    pass.setBindGroup(0, this.beginFrameBindGroup);
    pass.dispatchWorkgroups(1);
    // dispatch size was written by last frame's finishFrame, from the live count
    pass.setPipeline(this.simulatePipeline);
    pass.setBindGroup(0, this.simulateBindGroups[readIndex]);
    pass.dispatchWorkgroupsIndirect(this.dispatchIndirectBuffer, 0);
    if (this.lastFrameEmitParticleCount > 0) {
      pass.setPipeline(this.emitPipeline);
      pass.setBindGroup(0, this.emitBindGroups[writeIndex]);
      pass.dispatchWorkgroups(Math.ceil(this.lastFrameEmitParticleCount / WORKGROUP_SIZE));
    }
    pass.setPipeline(this.finishFramePipeline);
    pass.setBindGroup(0, this.finishFrameBindGroup);
    pass.dispatchWorkgroups(1);
    pass.end();

    const nowMs = performance.now();
    const wantStats = nowMs - this.statsWantedMs < 1000 && !this.readbackBusy && nowMs - this.lastReadbackMs > 250;
    if (wantStats) encoder.copyBufferToBuffer(this.counterBuffer, 0, this.readbackBuffer, 0, COUNTER_BYTES);
    this.device.queue.submit([encoder.finish()]);
    this.activeBufferIndex = writeIndex;
    if (wantStats) this.readCounters(nowMs);
  }

  // Copy eight u32s off the GPU without waiting for them: the numbers show up
  // a frame or two later, and the simulation never stalls on the overlay.
  private readCounters(nowMs: number): void {
    this.readbackBusy = true;
    this.lastReadbackMs = nowMs;
    const rockets = this.launches.length;
    const queued = this.scheduledBursts.length;
    this.readbackBuffer
      .mapAsync(GPUMapMode.READ)
      .then(() => {
        const c = new Uint32Array(this.readbackBuffer.getMappedRange().slice(0));
        this.readbackBuffer.unmap();
        this.latestStats = {
          live: c[0],
          commands: c[2],
          emitted: c[3],
          overflow: c[4],
          capacity: this.capacity,
          storageLimit: this.storageLimit,
          gpuBytes: this.gpuBytes + this.retiredEmitCommandBuffers.reduce((s, b) => s + b.size, 0),
          rockets,
          queued,
        };
      })
      .catch(() => {})
      .finally(() => {
        this.readbackBusy = false;
      });
  }

  // The most recent counters, and a request to keep reading them.
  stats(): FireworkStats | null {
    const now = performance.now();
    if (now - this.statsWantedMs > 1000) {
      // nobody was watching; don't report a backlog
      this.emittedAcc = 0;
      this.commandsAcc = 0;
    }
    this.statsWantedMs = now;
    return this.latestStats;
  }

  // Particles and commands the CPU asked for since the last call.
  emittedSinceLastRead(): number {
    const v = this.emittedAcc;
    this.emittedAcc = 0;
    return v;
  }

  commandsSinceLastRead(): number {
    const v = this.commandsAcc;
    this.commandsAcc = 0;
    return v;
  }

  private fillUniforms(u: Float32Array, dt: number, mouse: Vec2, aspect: number, width = 1, height = 1): void {
    const s = this.settings;
    const c = s.collapse;
    u.set(
      [
        width,
        height,
        aspect,
        SCENE_W / SCENE_H,
        this.clock,
        dt,
        mouse[0],
        mouse[1],
        s.scene.parallaxStrength,
        s.scene.depthPower,
        s.scene.exposure,
        0,
        this.lastBurstUv[0],
        this.lastBurstUv[1],
        0,
        0,
        this.clock - this.lastBurstTime,
        this.capacity,
        s.physics.gravity,
        s.physics.drag,
        s.physics.wind,
        s.physics.gridScale,
        s.physics.gridStrength,
        s.physics.pyramidSpin,
        0,
        s.render.sparkSize,
        s.render.rocketSize,
        s.render.trailStretch,
        s.render.smokeSize,
        s.scene.depthOcclusion,
        s.render.glow,
        0,
        0,
        c.delay,
        c.duration,
        c.strength,
        c.hashCellSize,
        c.stickiness,
        c.spiralStrength,
        c.returnScatter,
        this.lastBurstColor[0],
        this.lastBurstColor[1],
        this.lastBurstColor[2],
        0,
      ],
      0,
    );
  }

  // ---- drawing -------------------------------------------------------------

  render(view: FireworksView, dt = 1 / 60): void {
    view.resize();
    const k = Math.min(1, dt * 7.5);
    view.mouse[0] += (view.mouseTarget[0] - view.mouse[0]) * k;
    view.mouse[1] += (view.mouseTarget[1] - view.mouse[1]) * k;
    this.fillUniforms(this.viewUniforms, dt, view.mouse, view.aspect(), view.canvas.width, view.canvas.height);
    this.device.queue.writeBuffer(view.uniformBuffer, 0, this.viewUniforms);

    const encoder = this.device.createCommandEncoder({ label: "firework draw" });
    const pass = encoder.beginRenderPass({
      label: "firework scene",
      colorAttachments: [
        { view: view.post.sceneView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: "clear", storeOp: "store" },
      ],
    });
    pass.setPipeline(this.scenePipeline);
    pass.setBindGroup(0, view.sceneBindGroup);
    pass.draw(3);
    // the instance count was written by finishFrame on the GPU
    pass.setPipeline(this.renderPipeline);
    pass.setBindGroup(0, view.renderBindGroups[this.activeBufferIndex]);
    pass.drawIndirect(this.drawIndirectBuffer, 0);
    pass.end();
    view.post.encodePresent(encoder);
    this.device.queue.submit([encoder.finish()]);
  }
}

function writeEmitCommand(view: DataView, offset: number, command: EmitCommand): void {
  view.setUint32(offset, command.kind, true);
  view.setUint32(offset + 4, command.count, true);
  view.setUint32(offset + 8, command.start, true);
  view.setUint32(offset + 12, command.aux, true);
  view.setFloat32(offset + 16, command.pos[0], true);
  view.setFloat32(offset + 20, command.pos[1], true);
  view.setFloat32(offset + 24, command.scale, true);
  view.setFloat32(offset + 28, command.seed, true);
  view.setFloat32(offset + 32, command.vel[0], true);
  view.setFloat32(offset + 36, command.vel[1], true);
  view.setFloat32(offset + 40, command.life, true);
  view.setFloat32(offset + 44, command.size, true);
  view.setFloat32(offset + 48, command.color[0], true);
  view.setFloat32(offset + 52, command.color[1], true);
  view.setFloat32(offset + 56, command.color[2], true);
  view.setFloat32(offset + 60, 1, true);
  view.setFloat32(offset + 64, command.accent[0], true);
  view.setFloat32(offset + 68, command.accent[1], true);
  view.setFloat32(offset + 72, command.accent[2], true);
  view.setFloat32(offset + 76, 1, true);
  view.setFloat32(offset + 80, command.home[0], true);
  view.setFloat32(offset + 84, command.home[1], true);
  view.setFloat32(offset + 88, command.param0, true);
  view.setFloat32(offset + 92, command.param1, true);
}

// A calm automatic show: a rocket or three every second or so, mostly classic
// shells with the occasional collapse. Returns a tick to call each frame.
export function autoShow(
  world: FireworksWorld,
  aspect: () => number,
  style: () => { sparks: number; rockets: [number, number]; interval: [number, number]; collapseEvery: number },
): (clock: number) => void {
  let next = world.clock + 0.15;
  let volley = 0;
  return (clock) => {
    if (clock < next) return;
    const s = style();
    next = clock + randomRange(s.interval[0], s.interval[1]);
    volley++;
    const system: FireworkSystemId = s.collapseEvery > 0 && volley % s.collapseEvery === 0 ? "collapse" : "classic";
    const rockets = s.rockets[0] + Math.floor(Math.random() * (s.rockets[1] - s.rockets[0] + 1));
    const a = aspect();
    for (let r = 0; r < rockets; r++) {
      // spread across the sky, kept clear of the bottom of the frame
      const point: Vec2 = [randomRange(-0.78, 0.78), randomRange(0.12, 0.76)];
      world.launch(point, { system, sparks: s.sparks }, a);
    }
  };
}
