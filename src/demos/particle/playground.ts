// Part six's toy: a 64³ stable-fluids grid (advect → curl-noise forces →
// Jacobi-projected pressure) advecting hundreds of thousands of paint
// particles, rendered as velocity-stretched capsules into an HDR trail
// buffer. Stirred by cursor, by an idle "ghost", or — opt-in — by your
// actual hands through micro-handpose.

import simShader from "../../shaders/playground.wgsl?raw";
import renderShader from "../../shaders/render6.wgsl?raw";
import { Shell, gpuMissing, type Demo } from "../../lib/demoShell";
import { getDevice, configureContext } from "../../lib/gpu";
import { OrbitCamera } from "../../lib/camera3d";
import { BONES, type HandTracker } from "../../lib/hands";

const N = 64;
const CELLS = N * N * N;
const WG_GRID = N / 4; // workgroup_size(4,4,4)
const JACOBI = 10;
const MAX_STIR = 8;
const FOV_TAN = Math.tan(0.45); // camera3d's fov 0.9 halved

interface ModePreset {
  name: string;
  mode: number; // respawn flavour in the shader
  swirl: number;
  noiseScale: number;
  buoy: number;
  centerPull: number;
  drag: number;
  dyeDecay: number;
  speedLimit: number;
  drift: number;
  flow: number;
  lifeMin: number;
  lifeMax: number;
  // render
  colA: [number, number, number];
  colB: [number, number, number];
  colC: [number, number, number];
  colorScale: number;
  size: number;
  stretch: number;
  fade: number;
  exposure: number;
  glow: number;
}

const MODES: ModePreset[] = [
  {
    name: "ink",
    mode: 0,
    swirl: 1.1, noiseScale: 1.7, buoy: 0, centerPull: 0.06, drag: 0.5,
    dyeDecay: 0.45, speedLimit: 2.6, drift: 0.05, flow: 1.0, lifeMin: 3, lifeMax: 8,
    colA: [0.05, 0.16, 0.55], colB: [0.10, 0.55, 0.95], colC: [0.85, 0.98, 1.0],
    colorScale: 0.85, size: 0.010, stretch: 0.055, fade: 0.86, exposure: 0.8, glow: 0.32,
  },
  {
    name: "embers",
    mode: 1,
    swirl: 0.55, noiseScale: 2.3, buoy: 3.4, centerPull: 0.0, drag: 0.85,
    dyeDecay: 0.7, speedLimit: 2.4, drift: 0.10, flow: 1.0, lifeMin: 1.5, lifeMax: 4.5,
    colA: [0.45, 0.05, 0.01], colB: [1.0, 0.45, 0.08], colC: [1.0, 0.92, 0.55],
    colorScale: 1.0, size: 0.008, stretch: 0.045, fade: 0.84, exposure: 1.0, glow: 0.55,
  },
  {
    name: "nebula",
    mode: 2,
    swirl: 0.6, noiseScale: 1.2, buoy: 0.15, centerPull: 0.2, drag: 0.22,
    dyeDecay: 0.3, speedLimit: 1.7, drift: 0.03, flow: 1.0, lifeMin: 4, lifeMax: 10,
    colA: [0.22, 0.04, 0.45], colB: [0.75, 0.15, 0.65], colC: [0.45, 0.95, 0.9],
    colorScale: 0.55, size: 0.012, stretch: 0.09, fade: 0.90, exposure: 0.75, glow: 0.28,
  },
];

// A stirrer is anything that pushes the field: cursor, palm, fingertip, ghost.
// Velocity is derived from successive positions and smoothed here, so every
// source gets the same treatment.
interface StirrerShape {
  radius: number;
  push: number;
  emit: number;
  attract: number;
  spin: number;
}

class Stirrers {
  private live = new Map<string, { pos: number[]; vel: number[]; shape: StirrerShape; seen: number }>();

  set(id: string, pos: number[], shape: StirrerShape, dt: number): void {
    const s = this.live.get(id);
    if (s) {
      const inv = 1 / Math.max(dt, 1e-3);
      for (let k = 0; k < 3; k++) {
        const v = (pos[k] - s.pos[k]) * inv;
        s.vel[k] += (Math.max(-5, Math.min(5, v)) - s.vel[k]) * 0.35;
      }
      s.pos = pos.slice();
      s.shape = shape;
      s.seen = performance.now();
    } else {
      this.live.set(id, { pos: pos.slice(), vel: [0, 0, 0], shape, seen: performance.now() });
    }
  }

  drop(id: string): void {
    this.live.delete(id);
  }

  /** Pack up to MAX_STIR into the params view; returns count. */
  pack(f: Float32Array, base: number): number {
    const now = performance.now();
    let n = 0;
    for (const [id, s] of this.live) {
      if (now - s.seen > 250) {
        this.live.delete(id);
        continue;
      }
      if (n >= MAX_STIR) break;
      const o = base + n * 12;
      f[o] = s.pos[0]; f[o + 1] = s.pos[1]; f[o + 2] = s.pos[2]; f[o + 3] = s.shape.radius;
      f[o + 4] = s.vel[0]; f[o + 5] = s.vel[1]; f[o + 6] = s.vel[2]; f[o + 7] = s.shape.push;
      f[o + 8] = s.shape.attract; f[o + 9] = s.shape.emit; f[o + 10] = s.shape.spin; f[o + 11] = 1;
      n++;
    }
    return n;
  }

  get count(): number {
    return this.live.size;
  }
}

export interface PlaygroundOptions {
  hero?: boolean;
  count?: number;
}

export async function mountPlayground(container: HTMLElement, opts: PlaygroundOptions = {}): Promise<Demo> {
  const dev = await getDevice();
  const shell = new Shell(container, opts.hero ? 0.52 : 0.66);
  if (!dev) return gpuMissing(container);
  // trails mean three full-screen passes a frame — cap the pixel budget so
  // fill rate never beats the simulation to the frame budget
  const maxW = 1280;
  if (shell.canvas.width > maxW) {
    shell.canvas.height = Math.round(shell.canvas.height * (maxW / shell.canvas.width));
    shell.canvas.width = maxW;
  }
  const ctx = configureContext(shell.canvas, dev);
  const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
  const camera = new OrbitCamera();
  camera.distance = 2.9;
  camera.autoSpin = 0.0009;
  camera.attach(shell.canvas);

  // ---- compute pipelines ----------------------------------------------------
  const simModule = dev.createShaderModule({ code: simShader });
  const simLayout = dev.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      { binding: 7, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
    ],
  });
  const simPipeLayout = dev.createPipelineLayout({ bindGroupLayouts: [simLayout] });
  const mkSim = (entry: string): GPUComputePipeline =>
    dev.createComputePipeline({ layout: simPipeLayout, compute: { module: simModule, entryPoint: entry } });
  const advectPipe = mkSim("advect");
  const forcesPipe = mkSim("forces");
  const divPipe = mkSim("divergence");
  const jacobiPipe = mkSim("jacobi");
  const projectPipe = mkSim("project");
  const particlePipe = mkSim("particles");

  // ---- buffers ---------------------------------------------------------------
  const params = dev.createBuffer({ size: 464, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const storage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
  const velBufs = [
    dev.createBuffer({ size: CELLS * 16, usage: storage }),
    dev.createBuffer({ size: CELLS * 16, usage: storage }),
  ];
  const prBufs = [
    dev.createBuffer({ size: CELLS * 4, usage: storage }),
    dev.createBuffer({ size: CELLS * 4, usage: storage }),
  ];
  const divBuf = dev.createBuffer({ size: CELLS * 4, usage: storage });
  const lineBuf = dev.createBuffer({ size: 2 * BONES.length * 2 * 16, usage: storage });

  let count = opts.count ?? (opts.hero ? 110_000 : 240_000);
  let ppos: GPUBuffer = null!;
  let pvel: GPUBuffer = null!;
  // simGroups[velParity][pressureParity]
  let simGroups: GPUBindGroup[][] = [];
  let vp = 0;

  // ---- render pipelines -------------------------------------------------------
  const renModule = dev.createShaderModule({ code: renderShader });
  const renParams = dev.createBuffer({ size: 160, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const additive: GPUBlendState = {
    color: { srcFactor: "one", dstFactor: "one", operation: "add" },
    alpha: { srcFactor: "one", dstFactor: "one", operation: "add" },
  };
  const particleRenderPipe = dev.createRenderPipeline({
    layout: "auto",
    vertex: { module: renModule, entryPoint: "vsParticle" },
    fragment: { module: renModule, entryPoint: "fsParticle", targets: [{ format: "rgba16float", blend: additive }] },
    primitive: { topology: "triangle-list" },
  });
  const linePipe = dev.createRenderPipeline({
    layout: "auto",
    vertex: { module: renModule, entryPoint: "vsLine" },
    fragment: { module: renModule, entryPoint: "fsLine", targets: [{ format: "rgba16float", blend: additive }] },
    primitive: { topology: "line-list" },
  });
  const fadePipe = dev.createRenderPipeline({
    layout: "auto",
    vertex: { module: renModule, entryPoint: "vsFade" },
    fragment: {
      module: renModule,
      entryPoint: "fsFade",
      targets: [
        {
          format: "rgba16float",
          blend: {
            color: { srcFactor: "zero", dstFactor: "constant", operation: "add" },
            alpha: { srcFactor: "zero", dstFactor: "constant", operation: "add" },
          },
        },
      ],
    },
    primitive: { topology: "triangle-list" },
  });
  const blitPipe = dev.createRenderPipeline({
    layout: "auto",
    vertex: { module: renModule, entryPoint: "vsBlit" },
    fragment: { module: renModule, entryPoint: "fsBlit", targets: [{ format: canvasFormat }] },
    primitive: { topology: "triangle-list" },
  });

  const accum = dev.createTexture({
    size: [shell.canvas.width, shell.canvas.height],
    format: "rgba16float",
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
  const accumView = accum.createView();
  const sampler = dev.createSampler({ magFilter: "linear", minFilter: "linear" });
  const blitGroup = dev.createBindGroup({
    layout: blitPipe.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: accumView },
      { binding: 1, resource: sampler },
      { binding: 2, resource: { buffer: renParams } },
    ],
  });
  const lineGroup = dev.createBindGroup({
    layout: linePipe.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: renParams } },
      { binding: 3, resource: { buffer: lineBuf } },
    ],
  });

  let particleRenderGroup: GPUBindGroup = null!;

  const rebuild = (): void => {
    ppos?.destroy();
    pvel?.destroy();
    ppos = dev.createBuffer({ size: count * 16, usage: storage });
    pvel = dev.createBuffer({ size: count * 16, usage: storage });
    const seedPos = new Float32Array(count * 4);
    const seedVel = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(Math.random() * 2 - 1);
      const r = 0.85 * Math.cbrt(Math.random());
      seedPos[i * 4] = Math.sin(ph) * Math.cos(th) * r;
      seedPos[i * 4 + 1] = Math.sin(ph) * Math.sin(th) * r;
      seedPos[i * 4 + 2] = Math.cos(ph) * r;
      seedPos[i * 4 + 3] = Math.random() * 6; // staggered first lives
      seedVel[i * 4 + 3] = Math.random();
    }
    dev.queue.writeBuffer(ppos, 0, seedPos as BufferSource);
    dev.queue.writeBuffer(pvel, 0, seedVel as BufferSource);

    const mkGroup = (vi: number, pi: number): GPUBindGroup =>
      dev.createBindGroup({
        layout: simLayout,
        entries: [
          { binding: 0, resource: { buffer: params } },
          { binding: 1, resource: { buffer: velBufs[vi] } },
          { binding: 2, resource: { buffer: velBufs[1 - vi] } },
          { binding: 3, resource: { buffer: prBufs[pi] } },
          { binding: 4, resource: { buffer: prBufs[1 - pi] } },
          { binding: 5, resource: { buffer: divBuf } },
          { binding: 6, resource: { buffer: ppos } },
          { binding: 7, resource: { buffer: pvel } },
        ],
      });
    simGroups = [
      [mkGroup(0, 0), mkGroup(0, 1)],
      [mkGroup(1, 0), mkGroup(1, 1)],
    ];
    particleRenderGroup = dev.createBindGroup({
      layout: particleRenderPipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: renParams } },
        { binding: 1, resource: { buffer: ppos } },
        { binding: 2, resource: { buffer: pvel } },
      ],
    });
  };
  rebuild();

  // ---- modes ------------------------------------------------------------------
  let preset = MODES[0];
  // palette eases toward the active preset so mode flips feel like dye changes
  const pal = {
    colA: [...preset.colA], colB: [...preset.colB], colC: [...preset.colC],
    exposure: preset.exposure, fade: preset.fade,
  };

  // ---- stirring ----------------------------------------------------------------
  const stirrers = new Stirrers();
  let lastInput = 0;
  let dragging = false;
  let camRight: [number, number, number] = [1, 0, 0];
  let camUp: [number, number, number] = [0, 0, 1];
  let camFwd: [number, number, number] = [0, 1, 0];

  // pointer/hand coords arrive as ndc [-1,1]; place them on the plane through
  // the origin that faces the camera
  const toWorld = (nx: number, ny: number, depth: number): number[] => {
    const s = camera.distance * FOV_TAN;
    const aspect = shell.canvas.width / shell.canvas.height;
    return [
      camRight[0] * nx * s * aspect + camUp[0] * ny * s - camFwd[0] * depth,
      camRight[1] * nx * s * aspect + camUp[1] * ny * s - camFwd[1] * depth,
      camRight[2] * nx * s * aspect + camUp[2] * ny * s - camFwd[2] * depth,
    ];
  };

  let frameDt = 1 / 60;
  shell.canvas.addEventListener("pointerdown", () => (dragging = true));
  shell.canvas.addEventListener("pointerup", () => (dragging = false));
  shell.canvas.addEventListener("pointercancel", () => (dragging = false));
  shell.canvas.addEventListener("pointermove", (e) => {
    if (dragging) return; // dragging orbits the camera instead
    const r = shell.canvas.getBoundingClientRect();
    const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
    const ny = -(((e.clientY - r.top) / r.height) * 2 - 1);
    stirrers.set("cursor", toWorld(nx, ny, 0), { radius: 0.3, push: 16, emit: 2.2, attract: 0, spin: 0.6 }, frameDt);
    lastInput = performance.now();
  });
  shell.canvas.addEventListener("pointerleave", () => stirrers.drop("cursor"));

  // ---- hands --------------------------------------------------------------------
  let tracker: HandTracker | null = null;
  let handsOn = false;
  let handsLabel: HTMLButtonElement | null = null;
  const lineData = new Float32Array(2 * BONES.length * 2 * 4);

  const toggleHands = async (): Promise<void> => {
    if (handsOn && tracker) {
      tracker.stop();
      handsOn = false;
      if (handsLabel) handsLabel.textContent = "✋ enable hands";
      return;
    }
    if (handsLabel) handsLabel.textContent = "✋ starting…";
    try {
      const { HandTracker: HT } = await import("../../lib/hands");
      const t = new HT();
      tracker = t;
      await t.start();
      handsOn = true;
      if (handsLabel) handsLabel.textContent = "✋ hands on — click to stop";
    } catch (err) {
      console.error("hand tracking failed", err);
      if (handsLabel) handsLabel.textContent = "✋ camera blocked";
    }
  };

  const handNdc = (x: number, y: number): [number, number] => [
    (x * 2 - 1) * 1.25,
    -(y * 2 - 1) * 1.25,
  ];

  const feedHands = (): void => {
    let lv = 0;
    lineData.fill(0);
    if (!handsOn || !tracker) return;
    for (const hand of tracker.hands) {
      const id = hand.handedness;
      const [px, py] = handNdc(hand.palm[0], hand.palm[1]);
      const depth = Math.max(-0.5, Math.min(0.5, hand.palm[2] * 2));
      stirrers.set(`${id}-palm`, toWorld(px, py, depth), {
        radius: 0.34,
        push: 13 + hand.spread * 8,
        emit: 1.6,
        attract: 0,
        spin: 0.4,
      }, frameDt);
      const [ix, iy] = handNdc(hand.lm[8 * 3], hand.lm[8 * 3 + 1]);
      stirrers.set(`${id}-index`, toWorld(ix, iy, depth), {
        radius: 0.15,
        push: 20,
        emit: 3.5,
        attract: 0,
        spin: 0,
      }, frameDt);
      if (hand.pinch > 0.45) {
        // pinch conjures a vortex that drinks the fluid inward
        const mx = (hand.lm[4 * 3] + hand.lm[8 * 3]) / 2;
        const my = (hand.lm[4 * 3 + 1] + hand.lm[8 * 3 + 1]) / 2;
        const [vx, vy] = handNdc(mx, my);
        const k = (hand.pinch - 0.45) / 0.55;
        stirrers.set(`${id}-pinch`, toWorld(vx, vy, depth), {
          radius: 0.42,
          push: 2,
          emit: 0.5,
          attract: 10 * k,
          spin: 7 * k,
        }, frameDt);
      } else {
        stirrers.drop(`${id}-pinch`);
      }
      lastInput = performance.now();

      // skeleton glow lines
      for (const [a, b] of BONES) {
        for (const j of [a, b]) {
          const [jx, jy] = handNdc(hand.lm[j * 3], hand.lm[j * 3 + 1]);
          const wpos = toWorld(jx, jy, depth);
          lineData[lv * 4] = wpos[0];
          lineData[lv * 4 + 1] = wpos[1];
          lineData[lv * 4 + 2] = wpos[2];
          lineData[lv * 4 + 3] = 0.35;
          lv++;
        }
      }
    }
    // hands that vanished stop stirring quickly via the 250 ms timeout
  };

  // idle ghost: keeps the toy alive before anyone touches it
  const ghost = (t: number): void => {
    if (performance.now() - lastInput < 2500) {
      stirrers.drop("ghost");
      return;
    }
    const p = [
      0.68 * Math.sin(t * 0.63),
      0.68 * Math.sin(t * 0.41 + 1.3),
      0.55 * Math.sin(t * 0.52 + 2.6),
    ];
    stirrers.set("ghost", p, { radius: 0.3, push: 11, emit: 1.2, attract: 0, spin: 1.2 }, frameDt);
  };

  // ---- controls -------------------------------------------------------------------
  // once the trails slider is touched it overrides the preset's fade
  let trailOverride: number | null = null;
  let setModeLabels: (() => void) | null = null;
  const modeButtons: HTMLButtonElement[] = [];
  const setMode = (m: ModePreset): void => {
    preset = m;
    setModeLabels?.();
  };
  if (!opts.hero) {
    for (const m of MODES) {
      shell.button(m.name, () => setMode(m));
      modeButtons.push(shell.controls.lastElementChild as HTMLButtonElement);
    }
    setModeLabels = () => {
      MODES.forEach((m, i) => {
        modeButtons[i].textContent = m === preset ? `● ${m.name}` : m.name;
      });
    };
    setModeLabels();
    shell.slider({
      label: "particles",
      min: 50_000, max: 1_000_000, step: 10_000, value: count, log: true,
      format: (v) => Math.round(v).toLocaleString(),
      onInput: (v) => {
        count = Math.round(v);
        rebuild();
      },
    });
    shell.slider({
      label: "trails",
      min: 0.5, max: 0.97, step: 0.01, value: 0.88,
      format: (v) => `${Math.round(v * 100)}%`,
      onInput: (v) => (trailOverride = v),
    });
    shell.button("✋ enable hands", () => void toggleHands());
    handsLabel = shell.controls.lastElementChild as HTMLButtonElement;
  } else {
    shell.button("✋ hands", () => void toggleHands());
    handsLabel = shell.controls.lastElementChild as HTMLButtonElement;
  }

  shell.setInfo(() => {
    const hands = handsOn ? ` · ${tracker?.hands.length ?? 0} hand${tracker?.hands.length === 1 ? "" : "s"}` : "";
    return `${count.toLocaleString()} particles · ${preset.name}${hands} — wave, pinch, stir`;
  });

  // ---- frame ---------------------------------------------------------------------
  const pf = new Float32Array(464 / 4);
  const pu = new Uint32Array(pf.buffer);
  const rf = new Float32Array(160 / 4);
  let time = 0;
  let last = performance.now();

  return {
    frame() {
      shell.tick();
      const now = performance.now();
      frameDt = Math.min(Math.max((now - last) / 1000, 1 / 240), 1 / 30);
      last = now;
      time += frameDt;

      const aspect = shell.canvas.width / shell.canvas.height;
      const { viewProj, right, up } = camera.matrices(aspect);
      camRight = right;
      camUp = up;
      camFwd = [
        up[1] * right[2] - up[2] * right[1],
        up[2] * right[0] - up[0] * right[2],
        up[0] * right[1] - up[1] * right[0],
      ]; // up × right = toward camera; negate for view dir
      camFwd = [-camFwd[0], -camFwd[1], -camFwd[2]];

      feedHands();
      ghost(time);

      // sim params
      pf[0] = frameDt; pf[1] = time; pf[2] = preset.swirl; pf[3] = preset.noiseScale;
      pf[4] = preset.buoy; pf[5] = preset.centerPull; pf[6] = preset.drag; pf[7] = preset.dyeDecay;
      pf[8] = preset.speedLimit; pf[9] = preset.drift; pf[10] = preset.lifeMin; pf[11] = preset.lifeMax;
      pu[12] = count; pu[14] = preset.mode; pf[15] = preset.flow;
      pf[16] = camFwd[0]; pf[17] = camFwd[1]; pf[18] = camFwd[2]; pf[19] = 0;
      pu[13] = stirrers.pack(pf, 20);
      dev.queue.writeBuffer(params, 0, pf as BufferSource);

      // render params — palette eases toward the preset
      const ease = 1 - Math.exp(-frameDt * 3);
      for (let k = 0; k < 3; k++) {
        pal.colA[k] += (preset.colA[k] - pal.colA[k]) * ease;
        pal.colB[k] += (preset.colB[k] - pal.colB[k]) * ease;
        pal.colC[k] += (preset.colC[k] - pal.colC[k]) * ease;
      }
      pal.exposure += (preset.exposure - pal.exposure) * ease;
      pal.fade += ((trailOverride ?? preset.fade) - pal.fade) * ease;
      rf.set(viewProj, 0);
      rf.set(right, 16); rf[19] = preset.size;
      rf.set(up, 20); rf[23] = preset.stretch;
      rf.set(pal.colA, 24); rf[27] = preset.colorScale;
      rf.set(pal.colB, 28);
      rf.set(pal.colC, 32);
      // glow normalized by count so the energy on screen stays constant when
      // the particle slider moves
      rf[36] = pal.exposure; rf[37] = aspect; rf[38] = time;
      rf[39] = (preset.glow * 9000) / count;
      dev.queue.writeBuffer(renParams, 0, rf as BufferSource);
      dev.queue.writeBuffer(lineBuf, 0, lineData as BufferSource);

      const enc = dev.createCommandEncoder();
      {
        const pass = enc.beginComputePass();
        const g0 = simGroups[vp][0];
        const g1 = simGroups[vp][1];
        pass.setBindGroup(0, g0);
        pass.setPipeline(advectPipe);
        pass.dispatchWorkgroups(WG_GRID, WG_GRID, WG_GRID);
        pass.setPipeline(forcesPipe);
        pass.dispatchWorkgroups(WG_GRID, WG_GRID, WG_GRID);
        pass.setPipeline(divPipe); // also zeroes pr[1]
        pass.dispatchWorkgroups(WG_GRID, WG_GRID, WG_GRID);
        pass.setPipeline(jacobiPipe);
        for (let j = 0; j < JACOBI; j++) {
          pass.setBindGroup(0, j % 2 === 0 ? g1 : g0);
          pass.dispatchWorkgroups(WG_GRID, WG_GRID, WG_GRID);
        }
        pass.setBindGroup(0, g1); // final pressure landed in pr[1]
        pass.setPipeline(projectPipe);
        pass.dispatchWorkgroups(WG_GRID, WG_GRID, WG_GRID);
        pass.setBindGroup(0, g0);
        pass.setPipeline(particlePipe);
        pass.dispatchWorkgroups(Math.ceil(count / 256));
        pass.end();
      }
      {
        // fade the trail buffer, then paint this frame's light into it
        const pass = enc.beginRenderPass({
          colorAttachments: [{ view: accumView, loadOp: "load", storeOp: "store" }],
        });
        pass.setPipeline(fadePipe);
        pass.setBlendConstant({ r: pal.fade, g: pal.fade, b: pal.fade, a: pal.fade });
        pass.draw(3);
        pass.setPipeline(particleRenderPipe);
        pass.setBindGroup(0, particleRenderGroup);
        pass.draw(6, count);
        if (handsOn && tracker && tracker.hands.length > 0) {
          pass.setPipeline(linePipe);
          pass.setBindGroup(0, lineGroup);
          pass.draw(tracker.hands.length * BONES.length * 2);
        }
        pass.end();
      }
      {
        const pass = enc.beginRenderPass({
          colorAttachments: [
            {
              view: ctx.getCurrentTexture().createView(),
              clearValue: { r: 0, g: 0, b: 0, a: 1 },
              loadOp: "clear",
              storeOp: "store",
            },
          ],
        });
        pass.setPipeline(blitPipe);
        pass.setBindGroup(0, blitGroup);
        pass.draw(3);
        pass.end();
      }
      dev.queue.submit([enc.finish()]);
      vp = 1 - vp;
    },
    dispose() {
      tracker?.stop();
      for (const b of [...velBufs, ...prBufs, divBuf, lineBuf, params, renParams]) b.destroy();
      ppos?.destroy();
      pvel?.destroy();
      accum.destroy();
    },
  };
}
