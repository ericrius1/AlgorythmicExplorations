import sceneShader from "../shaders/fireworks/scene.wgsl?raw";
import simShader from "../shaders/fireworks/fireworks_sim.wgsl?raw";
import renderShader from "../shaders/fireworks/fireworks_render.wgsl?raw";
import { configureContext, getDevice } from "../lib/gpu";
import type { Demo } from "../lib/demoShell";

type FireworkSystemId = "accretion-collapse" | "classic";

interface Settings {
  system: { fireworkSystem: FireworkSystemId };
  scene: { parallaxStrength: number; depthPower: number; exposure: number; depthOcclusion: number };
  particles: {
    launch: {
      sparks: number;
      flightTime: number;
      burstSpeed: number;
      holdTriggersPer500ms: number;
      rocketsPerTrigger: number;
      pyramidLevels: number;
      gridCells: number;
    };
    physics: { gravity: number; drag: number; wind: number; gridScale: number; gridStrength: number; pyramidSpin: number };
    render: { sparkle: number; sparkSize: number; rocketSize: number; trailStretch: number; smokeSize: number; glow: number };
    accretion: {
      grainMultiplier: number;
      shells: number;
      collapseDelay: number;
      collapseDuration: number;
      collapseStrength: number;
      stickiness: number;
      hashCellSize: number;
      spiralStrength: number;
      returnScatter: number;
    };
  };
  debug: {
    overlays: {
      landmarks: boolean;
      depthView: boolean;
      hashGrid: boolean;
      collapseAttractor: boolean;
      pyramidShells: boolean;
    };
  };
}

function createHeroSettings(): Settings {
  return {
    system: { fireworkSystem: "classic" },
    scene: { parallaxStrength: 0.042, depthPower: 0.92, exposure: 0.88, depthOcclusion: 0.78 },
    particles: {
      launch: {
        sparks: 920,
        flightTime: 0.72,
        burstSpeed: 0.88,
        holdTriggersPer500ms: 8,
        rocketsPerTrigger: 3,
        pyramidLevels: 6,
        gridCells: 11,
      },
      physics: { gravity: 0.42, drag: 0.985, wind: 0.11, gridScale: 18, gridStrength: 0.32, pyramidSpin: 0.18 },
      render: { sparkle: 0.72, sparkSize: 1.05, rocketSize: 1.0, trailStretch: 1.35, smokeSize: 0.85, glow: 1.22 },
      accretion: {
        grainMultiplier: 1.85,
        shells: 9,
        collapseDelay: 0.92,
        collapseDuration: 1.15,
        collapseStrength: 4.1,
        stickiness: 0.92,
        hashCellSize: 0.044,
        spiralStrength: 0.42,
        returnScatter: 1.05,
      },
    },
    debug: {
      overlays: {
        landmarks: false,
        depthView: false,
        hashGrid: false,
        collapseAttractor: false,
        pyramidShells: false,
      },
    },
  };
}

const PARTICLE_FLOATS = 20;
const PARTICLE_STRIDE = PARTICLE_FLOATS * 4;
const UNIFORM_FLOATS = 44;
const EMIT_COMMAND_BYTES = 96;
const INITIAL_EMIT_COMMAND_CAPACITY = 65_536;
const COUNTER_BYTES = 32;
const DRAW_INDIRECT_BYTES = 16;
const DISPATCH_INDIRECT_BYTES = 12;
const WORKGROUP_SIZE = 256;
const TAU = Math.PI * 2;
const ACCRETION_SYSTEM_ID: FireworkSystemId = "accretion-collapse";
const CLASSIC_SYSTEM_ID: FireworkSystemId = "classic";

const enum EmitKind {
  Rocket = 1,
  Trail = 2,
  Explosion = 3,
  AccretionCollapse = 4,
}

type Vec2 = [number, number];
type Color = [number, number, number];

interface TextureAsset {
  texture: GPUTexture;
  width: number;
  height: number;
}

interface Launch {
  system: FireworkSystemId;
  start: Vec2;
  target: Vec2;
  velocity: Vec2;
  born: number;
  flightTime: number;
  nextTrail: number;
  color: Color;
  accent: Color;
  seed: number;
}

interface ScheduledBurst {
  system: FireworkSystemId;
  at: number;
  target: Vec2;
  color: Color;
  accent: Color;
  seed: number;
  scale: number;
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
  param2: number;
}

function uploadCanvasTexture(device: GPUDevice, canvas: HTMLCanvasElement): TextureAsset {
  const texture = device.createTexture({
    size: [canvas.width, canvas.height],
    format: "rgba8unorm",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
  });
  device.queue.copyExternalImageToTexture({ source: canvas }, { texture }, [canvas.width, canvas.height]);
  return { texture, width: canvas.width, height: canvas.height };
}

function createSceneTextures(device: GPUDevice): [TextureAsset, TextureAsset] {
  const w = 1280;
  const h = 720;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;

  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, "#10182e");
  sky.addColorStop(0.38, "#1a1438");
  sky.addColorStop(0.72, "#2a1830");
  sky.addColorStop(1, "#4a2818");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  for (let ridge = 0; ridge < 3; ridge++) {
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let i = 0; i <= 40; i++) {
      const x = (i / 40) * w;
      const y = h * (0.62 + ridge * 0.1) + Math.sin(i * 0.55 + ridge * 1.7) * h * 0.04 + hash01(i + ridge * 40) * h * 0.06;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    const shade = 8 + ridge * 6;
    ctx.fillStyle = `rgb(${shade}, ${shade + 8}, ${shade + 18})`;
    ctx.fill();
  }

  const backdrop = uploadCanvasTexture(device, canvas);

  const depthCanvas = document.createElement("canvas");
  depthCanvas.width = w;
  depthCanvas.height = h;
  const dctx = depthCanvas.getContext("2d")!;
  const dg = dctx.createLinearGradient(0, 0, 0, h);
  dg.addColorStop(0, "#e8e8f0");
  dg.addColorStop(0.55, "#9090a8");
  dg.addColorStop(0.72, "#404058");
  dg.addColorStop(1, "#101018");
  dctx.fillStyle = dg;
  dctx.fillRect(0, 0, w, h);
  for (let ridge = 0; ridge < 3; ridge++) {
    dctx.beginPath();
    dctx.moveTo(0, h);
    for (let i = 0; i <= 40; i++) {
      const x = (i / 40) * w;
      const y = h * (0.62 + ridge * 0.1) + Math.sin(i * 0.55 + ridge * 1.7) * h * 0.04 + hash01(i + ridge * 40) * h * 0.06;
      dctx.lineTo(x, y);
    }
    dctx.lineTo(w, h);
    dctx.closePath();
    const depthVal = 80 - ridge * 25;
    dctx.fillStyle = `rgb(${depthVal}, ${depthVal}, ${depthVal + 10})`;
    dctx.fill();
  }

  return [backdrop, uploadCanvasTexture(device, depthCanvas)];
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

class HeroFireworks {
  private readonly device: GPUDevice;
  private readonly context: GPUCanvasContext;
  private readonly format: GPUTextureFormat;
  private readonly canvas: HTMLCanvasElement;
  private readonly backdrop: TextureAsset;
  private readonly depth: TextureAsset;
  private readonly settings: Settings;
  private readonly sampler: GPUSampler;
  private readonly uniformBuffer: GPUBuffer;
  private readonly particleBuffers: [GPUBuffer, GPUBuffer];
  private readonly counterBuffer: GPUBuffer;
  private readonly drawIndirectBuffer: GPUBuffer;
  private readonly dispatchIndirectBuffer: GPUBuffer;
  private emitCommandBuffer: GPUBuffer;
  private readonly scenePipeline: GPURenderPipeline;
  private readonly beginFramePipeline: GPUComputePipeline;
  private readonly simulatePipeline: GPUComputePipeline;
  private readonly emitPipeline: GPUComputePipeline;
  private readonly finishFramePipeline: GPUComputePipeline;
  private readonly renderPipeline: GPURenderPipeline;
  private readonly sceneBindGroup: GPUBindGroup;
  private readonly beginFrameBindGroup: GPUBindGroup;
  private readonly finishFrameBindGroup: GPUBindGroup;
  private readonly simulateBindGroups: [GPUBindGroup, GPUBindGroup];
  private emitBindGroups: [GPUBindGroup, GPUBindGroup];
  private readonly renderBindGroups: [GPUBindGroup, GPUBindGroup];
  private readonly retiredEmitCommandBuffers: GPUBuffer[] = [];
  private readonly particleCapacity: number;
  private emitCommandCapacity = INITIAL_EMIT_COMMAND_CAPACITY;
  private readonly storageMemoryLimitBytes: number;
  private readonly uniforms = new Float32Array(UNIFORM_FLOATS);
  private readonly pendingEmitCommands: EmitCommand[] = [];
  private readonly launches: Launch[] = [];
  private readonly scheduledBursts: ScheduledBurst[] = [];
  private mouse: Vec2 = [0, 0];
  private mouseTarget: Vec2 = [0, 0];
  private nextAutoLaunch = 0;
  private activeBufferIndex = 0;
  private pendingEmitParticleCount = 0;
  private lastFrameEmitParticleCount = 0;
  private particleClock = 0;
  private lastFrameTime = 0;
  private lastLaunchTime = -999;
  private lastStartUv: Vec2 = [0.5, 0.92];
  private lastTargetUv: Vec2 = [0.5, 0.35];

  constructor(
    canvas: HTMLCanvasElement,
    device: GPUDevice,
    context: GPUCanvasContext,
    format: GPUTextureFormat,
    backdrop: TextureAsset,
    depth: TextureAsset,
  ) {
    this.canvas = canvas;
    this.device = device;
    this.context = context;
    this.format = format;
    this.backdrop = backdrop;
    this.depth = depth;
    this.settings = createHeroSettings();
    this.storageMemoryLimitBytes = this.device.limits.maxStorageBufferBindingSize;
    this.particleCapacity = Math.max(1, Math.floor(this.storageMemoryLimitBytes / PARTICLE_STRIDE));

    this.sampler = this.device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      mipmapFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    });

    this.uniformBuffer = this.device.createBuffer({
      label: "params",
      size: UNIFORM_FLOATS * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const particleBufferSize = this.particleCapacity * PARTICLE_STRIDE;
    this.particleBuffers = [
      this.device.createBuffer({
        label: "particles a",
        size: particleBufferSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      }),
      this.device.createBuffer({
        label: "particles b",
        size: particleBufferSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      }),
    ];

    this.counterBuffer = this.device.createBuffer({
      label: "firework counters",
      size: COUNTER_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });

    this.drawIndirectBuffer = this.device.createBuffer({
      label: "firework draw indirect",
      size: DRAW_INDIRECT_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST,
    });

    this.dispatchIndirectBuffer = this.device.createBuffer({
      label: "firework dispatch indirect",
      size: DISPATCH_INDIRECT_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST,
    });

    this.emitCommandBuffer = this.device.createBuffer({
      label: "firework emit commands",
      size: this.emitCommandCapacity * EMIT_COMMAND_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.counterBuffer, 0, new Uint32Array(8));
    this.device.queue.writeBuffer(this.drawIndirectBuffer, 0, new Uint32Array([6, 0, 0, 0]));
    this.device.queue.writeBuffer(this.dispatchIndirectBuffer, 0, new Uint32Array([0, 1, 1]));

    const sceneModule = this.device.createShaderModule({ label: "scene shader", code: sceneShader });
    const simModule = this.device.createShaderModule({ label: "firework sim shader", code: simShader });
    const renderModule = this.device.createShaderModule({ label: "firework render shader", code: renderShader });
    this.logCompilationInfo("scene", sceneModule);
    this.logCompilationInfo("simulation", simModule);
    this.logCompilationInfo("render", renderModule);

    this.device.pushErrorScope("validation");
    this.scenePipeline = this.device.createRenderPipeline({
      label: "depth parallax scene",
      layout: "auto",
      vertex: {
        module: sceneModule,
        entryPoint: "vertex",
      },
      fragment: {
        module: sceneModule,
        entryPoint: "fragment",
        targets: [{ format: this.format }],
      },
      primitive: { topology: "triangle-list" },
    });
    this.device.popErrorScope().then((error) => {
      if (error) console.error(`Scene pipeline validation: ${error.message}`);
    });

    const computePipeline = (label: string, entryPoint: string): GPUComputePipeline => {
      this.device.pushErrorScope("validation");
      const pipeline = this.device.createComputePipeline({
        label,
        layout: "auto",
        compute: { module: simModule, entryPoint },
      });
      this.device.popErrorScope().then((error) => {
        if (error) console.error(`${label} validation: ${error.message}`);
      });
      return pipeline;
    };

    this.beginFramePipeline = computePipeline("firework begin frame", "beginFrame");
    this.simulatePipeline = computePipeline("firework simulate compact", "simulateCompact");
    this.emitPipeline = computePipeline("firework gpu emitter", "emitParticles");
    this.finishFramePipeline = computePipeline("firework finish frame", "finishFrame");

    this.device.pushErrorScope("validation");
    this.renderPipeline = this.device.createRenderPipeline({
      label: "firework particle render",
      layout: "auto",
      vertex: {
        module: renderModule,
        entryPoint: "vertex",
      },
      fragment: {
        module: renderModule,
        entryPoint: "fragment",
        targets: [
          {
            format: this.format,
            blend: {
              color: { operation: "add", srcFactor: "one", dstFactor: "one" },
              alpha: { operation: "add", srcFactor: "one", dstFactor: "one-minus-src-alpha" },
            },
          },
        ],
      },
      primitive: { topology: "triangle-list" },
    });
    this.device.popErrorScope().then((error) => {
      if (error) console.error(`Render pipeline validation: ${error.message}`);
    });

    this.sceneBindGroup = this.device.createBindGroup({
      label: "scene bind group",
      layout: this.scenePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: this.backdrop.texture.createView() },
        { binding: 2, resource: this.depth.texture.createView() },
        { binding: 3, resource: this.sampler },
      ],
    });

    this.beginFrameBindGroup = this.device.createBindGroup({
      label: "begin frame bind group",
      layout: this.beginFramePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 3, resource: { buffer: this.counterBuffer } },
        { binding: 5, resource: { buffer: this.drawIndirectBuffer } },
      ],
    });

    this.finishFrameBindGroup = this.device.createBindGroup({
      label: "finish frame bind group",
      layout: this.finishFramePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 3, resource: { buffer: this.counterBuffer } },
        { binding: 5, resource: { buffer: this.drawIndirectBuffer } },
        { binding: 6, resource: { buffer: this.dispatchIndirectBuffer } },
      ],
    });

    this.simulateBindGroups = [
      this.createSimulateBindGroup(0, 1),
      this.createSimulateBindGroup(1, 0),
    ];
    this.emitBindGroups = [this.createEmitBindGroup(0), this.createEmitBindGroup(1)];
    this.renderBindGroups = [
      this.createRenderBindGroup(this.particleBuffers[0]),
      this.createRenderBindGroup(this.particleBuffers[1]),
    ];

    this.attachParallax();
    this.resize();
    const seedNow = performance.now() / 1000;
    for (let i = 0; i < 4; i++) {
      const point: Vec2 = [randomRange(-0.7, 0.7), randomRange(0.05, 0.65)];
      this.launchFromPoint(this.spreadLaunchPoint(point, i, 4), i % 2 === 0 ? CLASSIC_SYSTEM_ID : ACCRETION_SYSTEM_ID, seedNow - randomRange(0.1, 0.55));
    }
    this.nextAutoLaunch = seedNow + 0.15;
  }

  private createSimulateBindGroup(readIndex: number, writeIndex: number): GPUBindGroup {
    return this.device.createBindGroup({
      label: `simulate ${readIndex} to ${writeIndex}`,
      layout: this.simulatePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
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
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 2, resource: { buffer: this.particleBuffers[writeIndex] } },
        { binding: 3, resource: { buffer: this.counterBuffer } },
        { binding: 4, resource: { buffer: this.emitCommandBuffer } },
      ],
    });
  }

  private createRenderBindGroup(particleBuffer: GPUBuffer): GPUBindGroup {
    return this.device.createBindGroup({
      label: "render bind group",
      layout: this.renderPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: { buffer: particleBuffer } },
        { binding: 2, resource: this.depth.texture.createView() },
        { binding: 3, resource: this.sampler },
      ],
    });
  }

  private logCompilationInfo(label: string, module: GPUShaderModule): void {
    module.getCompilationInfo().then((info) => {
      for (const message of info.messages) {
        const text = `${label} WGSL ${message.type}: ${message.message} (${message.lineNum}:${message.linePos})`;
        if (message.type === "error") console.error(text);
        else if (message.type === "warning") console.warn(text);
        else console.info(text);
      }
    });
  }

  frame(nowMs: number): void {
    const now = nowMs / 1000;
    const dt = this.lastFrameTime > 0 ? clamp(now - this.lastFrameTime, 0.001, 0.033) : 0.016;
    this.lastFrameTime = now;
    this.particleClock += dt;

    this.resize();
    this.mouse[0] += (this.mouseTarget[0] - this.mouse[0]) * Math.min(1, dt * 7.5);
    this.mouse[1] += (this.mouseTarget[1] - this.mouse[1]) * Math.min(1, dt * 7.5);

    this.morphShapes(now);
    this.autoLaunch(now);
    this.updateLaunches(now);
    this.updateScheduledBursts(now);
    this.flushEmitCommands();
    this.writeUniforms(now, dt);
    this.render();
  }

  dispose(): void {
    this.uniformBuffer.destroy();
    for (const buffer of this.particleBuffers) buffer.destroy();
    this.counterBuffer.destroy();
    this.drawIndirectBuffer.destroy();
    this.dispatchIndirectBuffer.destroy();
    this.emitCommandBuffer.destroy();
    for (const buffer of this.retiredEmitCommandBuffers) buffer.destroy();
    this.backdrop.texture.destroy();
    this.depth.texture.destroy();
  }

  private morphShapes(now: number): void {
    const t = now * 0.09;
    this.settings.particles.launch.pyramidLevels = 4 + Math.round(2.5 + 2.5 * Math.sin(t));
    this.settings.particles.launch.gridCells = 9 + Math.round(2 + 2 * Math.sin(t * 0.73 + 0.8));
    this.settings.particles.physics.pyramidSpin = 0.1 + 0.2 * Math.sin(t * 0.52);
    this.settings.particles.accretion.shells = 7 + Math.round(3 + 2 * Math.sin(t * 0.61 + 1.2));
    this.settings.system.fireworkSystem = Math.sin(now * 0.045) > 0 ? CLASSIC_SYSTEM_ID : ACCRETION_SYSTEM_ID;
  }

  private autoLaunch(now: number): void {
    if (now < this.nextAutoLaunch) return;
    this.nextAutoLaunch = now + randomRange(0.2, 0.38);
    const rockets = 2 + Math.floor(Math.random() * 3);
    for (let r = 0; r < rockets; r++) {
      const point: Vec2 = [randomRange(-0.82, 0.82), randomRange(-0.15, 0.78)];
      this.launchFromPoint(this.spreadLaunchPoint(point, r, rockets), this.currentFireworkSystem(), now);
    }
  }

  private attachParallax(): void {
    this.canvas.addEventListener("pointermove", (event) => {
      const rect = this.canvas.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      const y = 1 - ((event.clientY - rect.top) / rect.height) * 2;
      this.mouseTarget = [clamp(x, -1, 1), clamp(y, -1, 1)];
    });
    this.canvas.addEventListener("pointerleave", () => {
      this.mouseTarget = [0, 0];
    });
  }

  private viewportAspect(): number {
    return Math.max(0.001, this.canvas.width / Math.max(1, this.canvas.height));
  }

  private aspectCorrectedX(value: number): number {
    return value / this.viewportAspect();
  }

  private currentFireworkSystem(): FireworkSystemId {
    return this.settings.system.fireworkSystem === CLASSIC_SYSTEM_ID ? CLASSIC_SYSTEM_ID : ACCRETION_SYSTEM_ID;
  }

  private spreadLaunchPoint(point: Vec2, index: number, count: number): Vec2 {
    if (count <= 1) return point;

    const ring = index / count;
    const angle = ring * TAU + randomRange(-0.24, 0.24);
    const radius = randomRange(0.018, 0.052 + count * 0.004);
    return [
      clamp(point[0] + this.aspectCorrectedX(Math.cos(angle) * radius), -1, 1),
      clamp(point[1] + Math.sin(angle) * radius * 0.72, -1, 1),
    ];
  }

  private launchFromPoint(point: Vec2, system: FireworkSystemId, now = performance.now() / 1000): void {
    const target: Vec2 = [clamp(point[0], -0.96, 0.96), clamp(point[1], -0.58, 0.92)];
    const start: Vec2 = [clamp(point[0], -0.95, 0.95), -0.96];
    const seed = Math.random() * 1000 + performance.now() * 0.001;
    const [color, accent] = palettes[Math.floor(Math.random() * palettes.length)];
    const distance = Math.hypot(target[0] - start[0], target[1] - start[1]);
    const flightTime = clamp(this.settings.particles.launch.flightTime * (0.72 + distance * 0.28), 0.35, 1.6);
    const rocketGravity = this.settings.particles.physics.gravity * 0.13;
    const velocity: Vec2 = [
      (target[0] - start[0]) / flightTime,
      (target[1] - start[1] + 0.5 * rocketGravity * flightTime * flightTime) / flightTime,
    ];

    this.launches.push({
      system,
      start,
      target,
      velocity,
      born: now,
      flightTime,
      nextTrail: 0,
      color,
      accent,
      seed,
    });

    this.lastLaunchTime = now;
    this.lastStartUv = [start[0] * 0.5 + 0.5, 0.5 - start[1] * 0.5];
    this.lastTargetUv = [target[0] * 0.5 + 0.5, 0.5 - target[1] * 0.5];

    this.queueRocketParticle(start, velocity, accent, target, flightTime, seed);
    this.spawnIgnition(start, velocity, color, accent, seed);
  }

  private updateLaunches(now: number): void {
    for (let i = this.launches.length - 1; i >= 0; i--) {
      const launch = this.launches[i];
      const age = now - launch.born;
      if (age < launch.flightTime) {
        while (launch.nextTrail < age) {
          const pos = this.launchPosition(launch, launch.nextTrail);
          this.spawnRocketTrail(pos, launch.velocity, launch.color, launch.accent, launch.seed + launch.nextTrail);
          launch.nextTrail += 0.018;
        }
        continue;
      }

      this.spawnExplosion(launch.system, launch.target, launch.color, launch.accent, launch.seed, 1.0, false, now);
      this.launches.splice(i, 1);
    }
  }

  private updateScheduledBursts(now: number): void {
    for (let i = this.scheduledBursts.length - 1; i >= 0; i--) {
      const burst = this.scheduledBursts[i];
      if (burst.at > now) continue;
      this.spawnExplosion(burst.system, burst.target, burst.color, burst.accent, burst.seed, burst.scale, true, now);
      this.scheduledBursts.splice(i, 1);
    }
  }

  private launchPosition(launch: Launch, age: number): Vec2 {
    const rocketGravity = this.settings.particles.physics.gravity * 0.13;
    return [
      launch.start[0] + launch.velocity[0] * age,
      launch.start[1] + launch.velocity[1] * age - 0.5 * rocketGravity * age * age,
    ];
  }

  private spawnIgnition(start: Vec2, velocity: Vec2, color: Color, accent: Color, seed: number): void {
    this.queueEmitCommand({
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
      param0: 0.78,
      param1: 0,
      param2: 0,
    });
  }

  private spawnRocketTrail(pos: Vec2, velocity: Vec2, color: Color, accent: Color, seed: number): void {
    this.queueEmitCommand({
      kind: EmitKind.Trail,
      count: 4,
      aux: 1,
      pos,
      scale: 1,
      seed,
      vel: velocity,
      life: 0,
      size: 0,
      color,
      accent,
      home: pos,
      param0: 0.48,
      param1: 0,
      param2: 0,
    });
  }

  private spawnExplosion(
    system: FireworkSystemId,
    target: Vec2,
    color: Color,
    accent: Color,
    seed: number,
    scale: number,
    mini: boolean,
    now: number,
  ): void {
    if (system === ACCRETION_SYSTEM_ID) {
      this.spawnAccretionCollapseExplosion(target, color, accent, seed, scale, mini);
      return;
    }
    this.spawnClassicExplosion(target, color, accent, seed, scale, mini, now);
  }

  private spawnClassicExplosion(
    target: Vec2,
    color: Color,
    accent: Color,
    seed: number,
    scale: number,
    mini: boolean,
    now: number,
  ): void {
    const launch = this.settings.particles.launch;
    const sparkCount = Math.max(32, Math.round(launch.sparks * scale));
    const levels = Math.max(2, Math.round(launch.pyramidLevels));
    const burstSpeed = launch.burstSpeed * (mini ? 0.78 : 1.0);
    const particleDepth = target[1] > 0.05 ? 0.18 : 0.31;
    const gridCells = Math.max(3, Math.round(launch.gridCells));
    const crackleCount = Math.max(16, Math.round(gridCells * gridCells * 0.34 * scale));
    const emberCount = Math.round(64 * scale);
    const smokeCount = Math.round(30 * scale);

    this.queueEmitCommand({
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
      param0: particleDepth,
      param1: smokeCount,
      param2: mini ? 1 : 0,
    });

    if (!mini) {
      const satellites = 5 + Math.floor(Math.random() * 4);
      for (let i = 0; i < satellites; i++) {
        const angle = (i / satellites) * TAU + randomRange(-0.18, 0.18);
        const radius = randomRange(0.08, 0.18);
        this.scheduledBursts.push({
          system: CLASSIC_SYSTEM_ID,
          at: now + randomRange(0.11, 0.3),
          target: [
            clamp(target[0] + this.aspectCorrectedX(Math.cos(angle) * radius), -0.96, 0.96),
            clamp(target[1] + Math.sin(angle) * radius * 0.74, -0.48, 0.94),
          ],
          color: accent,
          accent: color,
          seed: seed + i * 23.7,
          scale: randomRange(0.18, 0.28),
        });
      }
    }
  }

  private spawnAccretionCollapseExplosion(
    target: Vec2,
    color: Color,
    accent: Color,
    seed: number,
    scale: number,
    mini: boolean,
  ): void {
    const launch = this.settings.particles.launch;
    const accretion = this.settings.particles.accretion;
    const grainMultiplier = Math.max(0.1, accretion.grainMultiplier);
    const sparkCount = Math.max(80, Math.round(launch.sparks * grainMultiplier * scale * (mini ? 0.7 : 1.0)));
    const levels = Math.max(3, Math.round(accretion.shells));
    const burstSpeed = launch.burstSpeed * (mini ? 0.86 : 1.08);
    const particleDepth = target[1] > 0.05 ? 0.16 : 0.28;

    this.queueEmitCommand({
      kind: EmitKind.AccretionCollapse,
      count: 1 + sparkCount,
      aux: sparkCount,
      pos: target,
      scale,
      seed,
      vel: [burstSpeed, levels],
      life: accretion.collapseDelay,
      size: accretion.collapseDuration,
      color,
      accent,
      home: target,
      param0: particleDepth,
      param1: mini ? 1 : 0,
      param2: 0,
    });
  }

  private queueEmitCommand(command: Omit<EmitCommand, "start">): void {
    const count = Math.max(0, Math.floor(command.count));
    if (count === 0) return;

    this.pendingEmitCommands.push({
      ...command,
      count,
      start: this.pendingEmitParticleCount,
    });
    this.pendingEmitParticleCount += count;
  }

  private queueRocketParticle(start: Vec2, velocity: Vec2, accent: Color, target: Vec2, life: number, seed: number): void {
    this.queueEmitCommand({
      kind: EmitKind.Rocket,
      count: 1,
      aux: 0,
      pos: start,
      scale: 1,
      seed,
      vel: velocity,
      life: life + 0.1,
      size: 0.0065,
      color: accent,
      accent,
      home: target,
      param0: 0.54,
      param1: 0,
      param2: 0,
    });
  }

  private ensureEmitCommandCapacity(count: number): void {
    if (count <= this.emitCommandCapacity) return;

    let nextCapacity = this.emitCommandCapacity;
    while (nextCapacity < count) nextCapacity *= 2;
    this.retiredEmitCommandBuffers.push(this.emitCommandBuffer);
    this.emitCommandCapacity = nextCapacity;
    this.emitCommandBuffer = this.device.createBuffer({
      label: "firework emit commands",
      size: this.emitCommandCapacity * EMIT_COMMAND_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.emitBindGroups = [this.createEmitBindGroup(0), this.createEmitBindGroup(1)];
  }

  private flushEmitCommands(): void {
    const commandCount = this.pendingEmitCommands.length;
    this.lastFrameEmitParticleCount = this.pendingEmitParticleCount;
    this.ensureEmitCommandCapacity(commandCount);

    if (commandCount > 0) {
      const bytes = new ArrayBuffer(commandCount * EMIT_COMMAND_BYTES);
      const view = new DataView(bytes);
      for (let i = 0; i < commandCount; i++) {
        this.writeEmitCommand(view, i * EMIT_COMMAND_BYTES, this.pendingEmitCommands[i]);
      }
      this.device.queue.writeBuffer(this.emitCommandBuffer, 0, bytes);
    }

    this.device.queue.writeBuffer(
      this.counterBuffer,
      8,
      new Uint32Array([commandCount, this.pendingEmitParticleCount]),
    );
    this.pendingEmitCommands.length = 0;
    this.pendingEmitParticleCount = 0;
  }

  private writeEmitCommand(view: DataView, offset: number, command: EmitCommand): void {
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

  private writeUniforms(now: number, dt: number): void {
    const width = Math.max(1, this.canvas.width);
    const height = Math.max(1, this.canvas.height);
    const aspect = width / height;
    const imageAspect = this.backdrop.width / this.backdrop.height;
    const s = this.settings;
    const lastAge = this.lastLaunchTime > 0 ? now - this.lastLaunchTime : 999;
    const accretion = s.particles.accretion;

    this.uniforms.set(
      [
        width,
        height,
        aspect,
        imageAspect,
        now,
        dt,
        this.mouse[0],
        this.mouse[1],
        s.scene.parallaxStrength,
        s.scene.depthPower,
        s.scene.exposure,
        s.debug.overlays.landmarks ? 1 : 0,
        this.lastStartUv[0],
        this.lastStartUv[1],
        this.lastTargetUv[0],
        this.lastTargetUv[1],
        lastAge,
        this.particleCapacity,
        s.particles.physics.gravity,
        s.particles.physics.drag,
        s.particles.physics.wind,
        s.particles.physics.gridScale,
        s.particles.physics.gridStrength,
        s.particles.physics.pyramidSpin,
        s.particles.render.sparkle,
        s.particles.render.sparkSize,
        s.particles.render.rocketSize,
        s.particles.render.trailStretch,
        s.particles.render.smokeSize,
        s.scene.depthOcclusion,
        s.particles.render.glow,
        s.debug.overlays.depthView ? 1 : 0,
        this.currentFireworkSystem() === ACCRETION_SYSTEM_ID ? 1 : 0,
        accretion.collapseDelay,
        accretion.collapseDuration,
        accretion.collapseStrength,
        accretion.hashCellSize,
        accretion.stickiness,
        accretion.spiralStrength,
        accretion.returnScatter,
        s.debug.overlays.hashGrid ? 1 : 0,
        s.debug.overlays.collapseAttractor ? 1 : 0,
        s.debug.overlays.pyramidShells ? 1 : 0,
        accretion.shells,
      ],
      0,
    );
    this.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniforms);
  }

  private resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    const height = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    if (this.canvas.width === width && this.canvas.height === height) return;

    this.canvas.width = width;
    this.canvas.height = height;
    this.context.configure({ device: this.device, format: this.format, alphaMode: "opaque" });
  }

  private render(): void {
    const readIndex = this.activeBufferIndex;
    const writeIndex = 1 - readIndex;
    const encoder = this.device.createCommandEncoder({ label: "frame" });

    const begin = encoder.beginComputePass({ label: "begin firework frame" });
    begin.setPipeline(this.beginFramePipeline);
    begin.setBindGroup(0, this.beginFrameBindGroup);
    begin.dispatchWorkgroups(1);
    begin.end();

    const simulate = encoder.beginComputePass({ label: "simulate compact fireworks" });
    simulate.setPipeline(this.simulatePipeline);
    simulate.setBindGroup(0, this.simulateBindGroups[readIndex]);
    simulate.dispatchWorkgroupsIndirect(this.dispatchIndirectBuffer, 0);
    simulate.end();

    if (this.currentEmitParticleCount() > 0) {
      const emit = encoder.beginComputePass({ label: "emit fireworks" });
      emit.setPipeline(this.emitPipeline);
      emit.setBindGroup(0, this.emitBindGroups[writeIndex]);
      emit.dispatchWorkgroups(Math.ceil(this.currentEmitParticleCount() / WORKGROUP_SIZE));
      emit.end();
    }

    const finish = encoder.beginComputePass({ label: "finish firework frame" });
    finish.setPipeline(this.finishFramePipeline);
    finish.setBindGroup(0, this.finishFrameBindGroup);
    finish.dispatchWorkgroups(1);
    finish.end();

    const pass = encoder.beginRenderPass({
      label: "render scene",
      colorAttachments: [
        {
          view: this.context.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });

    pass.setPipeline(this.scenePipeline);
    pass.setBindGroup(0, this.sceneBindGroup);
    pass.draw(3);

    pass.setPipeline(this.renderPipeline);
    pass.setBindGroup(0, this.renderBindGroups[writeIndex]);
    pass.drawIndirect(this.drawIndirectBuffer, 0);
    pass.end();

    this.device.queue.submit([encoder.finish()]);
    this.activeBufferIndex = writeIndex;
  }

  private currentEmitParticleCount(): number {
    return this.lastFrameEmitParticleCount;
  }
}

export async function mountFireworkHeroGpu(canvas: HTMLCanvasElement): Promise<Demo | null> {
  const device = await getDevice();
  if (!device) return null;

  const context = configureContext(canvas, device);
  const format = navigator.gpu.getPreferredCanvasFormat();
  const [backdrop, depth] = createSceneTextures(device);
  const engine = new HeroFireworks(canvas, device, context, format, backdrop, depth);

  return {
    frame() {
      engine.frame(performance.now());
    },
    dispose() {
      engine.dispose();
    },
  };
}
