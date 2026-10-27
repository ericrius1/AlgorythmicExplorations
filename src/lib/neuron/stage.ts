// The chassis every Spark & Signal figure runs on: a Shell canvas with a
// WebGPU context, an orbit camera (drag to turn, pinch or ⌘/ctrl-scroll to
// zoom, click to poke), the site's HDR bloom finish, and a transparent 2D
// overlay for labels and oscilloscope traces. Particles are drawn additively
// as soft sprites or as streaks, so nothing needs sorting.

import { Shell } from "../demoShell";
import { configureContext, getDevice } from "../gpu";
import { HDR_FORMAT, PostFX, type PostSettings } from "../postfx";
import type { Mat4 } from "../camera3d";
import { multiply, perspective } from "../camera3d";

export type V3 = [number, number, number];

const FOV = 0.8;

export class Orbit {
  azimuth = -Math.PI / 2;
  elevation = 0.25;
  distance = 3;
  minDistance = 0.6;
  maxDistance = 9;
  target: V3 = [0, 0, 0];
  // idle motion: a slow sway around the start azimuth instead of a full spin,
  // for subjects that only read well from the side
  sway = 0.35;
  swaySpeed = 0.06;
  spin = 0;
  onClick: ((x: number, y: number) => void) | null = null;

  eye: V3 = [0, 0, 0];
  right: V3 = [1, 0, 0];
  up: V3 = [0, 0, 1];
  fwd: V3 = [0, 1, 0];

  private base = 0;
  private idleT = 0;
  private lastInteraction = -1e9;
  private swayOffset = 0;

  attach(canvas: HTMLCanvasElement): void {
    this.base = this.azimuth;
    let dragging = false;
    let moved = 0;
    let lx = 0;
    let ly = 0;
    canvas.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      dragging = true;
      moved = 0;
      lx = e.clientX;
      ly = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const dx = e.clientX - lx;
      const dy = e.clientY - ly;
      moved += Math.abs(dx) + Math.abs(dy);
      if (moved > 4) {
        this.touch();
        this.azimuth -= dx * 0.005;
        this.elevation = Math.min(1.45, Math.max(-1.2, this.elevation + dy * 0.005));
      }
      lx = e.clientX;
      ly = e.clientY;
    });
    const end = (e: PointerEvent): void => {
      if (!dragging) return;
      dragging = false;
      if (moved <= 4 && this.onClick) {
        const r = canvas.getBoundingClientRect();
        this.onClick(((e.clientX - r.left) / r.width) * 2 - 1, 1 - ((e.clientY - r.top) / r.height) * 2);
      }
    };
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", () => (dragging = false));
    canvas.addEventListener(
      "wheel",
      (e) => {
        // plain wheel scrolls the article; pinch (ctrl+wheel) or ⌘-scroll zooms
        if (!(e.ctrlKey || e.metaKey)) return;
        e.preventDefault();
        this.touch();
        this.distance = Math.min(
          this.maxDistance,
          Math.max(this.minDistance, this.distance * Math.exp(e.deltaY * 0.002)),
        );
      },
      { passive: false },
    );
  }

  private touch(): void {
    // fold the idle sway into the real azimuth so grabbing never jumps
    this.azimuth += this.swayOffset;
    this.swayOffset = 0;
    this.idleT = 0;
    this.lastInteraction = performance.now();
  }

  update(dt: number): void {
    if (performance.now() - this.lastInteraction > 3000) {
      this.idleT += dt;
      if (this.spin) this.azimuth += this.spin * dt;
      else {
        // ease back toward the composed view, then sway around it
        this.azimuth += (this.base - this.azimuth) * Math.min(1, dt * 0.25);
        this.swayOffset =
          Math.sin(this.idleT * this.swaySpeed * Math.PI * 2) * this.sway * Math.min(1, this.idleT * 0.2);
      }
    }
    const az = this.azimuth + this.swayOffset;
    const ce = Math.cos(this.elevation);
    const [tx, ty, tz] = this.target;
    this.eye = [
      tx + Math.cos(az) * ce * this.distance,
      ty + Math.sin(az) * ce * this.distance,
      tz + Math.sin(this.elevation) * this.distance,
    ];
    const f = normalize([tx - this.eye[0], ty - this.eye[1], tz - this.eye[2]]);
    const r = normalize(cross(f, [0, 0, 1]));
    this.fwd = f;
    this.right = r;
    this.up = cross(r, f);
  }

  viewProj(aspect: number): Mat4 {
    const [r, u, f, e] = [this.right, this.up, this.fwd, this.eye];
    const view = new Float32Array(16);
    view[0] = r[0];
    view[4] = r[1];
    view[8] = r[2];
    view[1] = u[0];
    view[5] = u[1];
    view[9] = u[2];
    view[2] = -f[0];
    view[6] = -f[1];
    view[10] = -f[2];
    view[12] = -(r[0] * e[0] + r[1] * e[1] + r[2] * e[2]);
    view[13] = -(u[0] * e[0] + u[1] * e[1] + u[2] * e[2]);
    view[14] = f[0] * e[0] + f[1] * e[1] + f[2] * e[2];
    view[15] = 1;
    return multiply(perspective(FOV, aspect, 0.02, 60), view);
  }

  // World-space ray through a point in normalized device coordinates.
  ray(nx: number, ny: number, aspect: number): { o: V3; d: V3 } {
    const t = Math.tan(FOV / 2);
    const d = normalize([
      this.fwd[0] + this.right[0] * nx * t * aspect + this.up[0] * ny * t,
      this.fwd[1] + this.right[1] * nx * t * aspect + this.up[1] * ny * t,
      this.fwd[2] + this.right[2] * nx * t * aspect + this.up[2] * ny * t,
    ]);
    return { o: [...this.eye], d };
  }
}

export function cross(a: V3, b: V3): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function normalize(v: V3): V3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

// Squared distance from a ray to a segment, and the ray parameter there.
export function raySegment(o: V3, d: V3, a: V3, b: V3): { d2: number; s: number; t: number } {
  const u: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const w: V3 = [o[0] - a[0], o[1] - a[1], o[2] - a[2]];
  const uu = u[0] * u[0] + u[1] * u[1] + u[2] * u[2] || 1e-9;
  const ud = u[0] * d[0] + u[1] * d[1] + u[2] * d[2];
  const uw = u[0] * w[0] + u[1] * w[1] + u[2] * w[2];
  const dw = d[0] * w[0] + d[1] * w[1] + d[2] * w[2];
  const den = uu - ud * ud;
  let t = den > 1e-9 ? (uw - ud * dw) / den : 0;
  t = Math.min(1, Math.max(0, t));
  const p: V3 = [a[0] + u[0] * t, a[1] + u[1] * t, a[2] + u[2] * t];
  const s = Math.max(0, (p[0] - o[0]) * d[0] + (p[1] - o[1]) * d[1] + (p[2] - o[2]) * d[2]);
  const q: V3 = [o[0] + d[0] * s - p[0], o[1] + d[1] * s - p[1], o[2] + d[2] * s - p[2]];
  return { d2: q[0] * q[0] + q[1] * q[1] + q[2] * q[2], s, t };
}

// ---- shared WGSL ---------------------------------------------------------

// Every figure's shader starts with this: the camera block, the quad, a
// sprite (round, soft) and a streak (a capsule from tail to head that fades
// toward the tail), and the fragment shader both use.
export const SPRITE_WGSL = /* wgsl */ `
struct Cam {
  viewProj: mat4x4f,
  right: vec4f,
  up: vec4f,
  eye: vec4f,
  p: vec4f, // x = time (s), y = aspect, z = projection y-scale, w = min radius (NDC)
  q: vec4f, // figure-specific
}
@group(0) @binding(0) var<uniform> cam: Cam;

struct VOut {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
  @location(1) color: vec3f,
  @location(2) streak: f32,
}

const QUAD = array<vec2f, 6>(
  vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
  vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
);

fn hidden() -> VOut {
  var o: VOut;
  o.clip = vec4f(0.0, 0.0, 2.0, 1.0);
  return o;
}

// soft round sprite of world radius r; sub-pixel sprites grow to the minimum
// size and dim to match, so dense clouds keep their brightness at any zoom
fn sprite(center: vec3f, r: f32, vi: u32, color: vec3f) -> VOut {
  let q = QUAD[vi];
  var c = cam.viewProj * vec4f(center, 1.0);
  if (c.w < 0.02) { return hidden(); }
  let rn = r * cam.p.z / c.w;
  let rr = max(rn, cam.p.w);
  let gain = (rn * rn) / (rr * rr);
  c = vec4f(c.xy + vec2f(q.x * rr / cam.p.y, q.y * rr) * c.w, c.zw);
  var o: VOut;
  o.clip = c;
  o.uv = q;
  o.color = color * gain;
  o.streak = 0.0;
  return o;
}

// a capsule from a (tail) to b (head), r wide, brightest at the head
fn streak(a: vec3f, b: vec3f, r: f32, vi: u32, color: vec3f) -> VOut {
  let q = QUAD[vi];
  let ca = cam.viewProj * vec4f(a, 1.0);
  let cb = cam.viewProj * vec4f(b, 1.0);
  if (ca.w < 0.02 || cb.w < 0.02) { return hidden(); }
  let asp = vec2f(cam.p.y, 1.0);
  let sa = ca.xy / ca.w * asp;
  let sb = cb.xy / cb.w * asp;
  var dir = sb - sa;
  let len = length(dir);
  dir = select(vec2f(1.0, 0.0), dir / len, len > 1e-6);
  let n = vec2f(-dir.y, dir.x);
  let w = (ca.w + cb.w) * 0.5;
  let rn = r * cam.p.z / w;
  let rr = max(rn, cam.p.w);
  let gain = rn / rr;
  let along = q.y * 0.5 + 0.5; // 0 tail, 1 head
  let s = mix(sa - dir * rr, sb + dir * rr, along) + n * q.x * rr;
  let cw = mix(ca.w, cb.w, along);
  let cz = mix(ca.z, cb.z, along);
  var o: VOut;
  o.clip = vec4f(s / asp * cw, cz, cw);
  o.uv = vec2f(q.x, along);
  // the streak's light is spread over its length; keep total energy roughly fixed
  o.color = color * gain * min(1.0, 2.5 * rr / (len + rr));
  o.streak = 1.0;
  return o;
}

@fragment
fn fs(in: VOut) -> @location(0) vec4f {
  var a: f32;
  if (in.streak > 0.5) {
    a = exp(-4.0 * in.uv.x * in.uv.x) * (1.0 - smoothstep(0.75, 1.0, abs(in.uv.x)));
    a *= in.uv.y * in.uv.y;
  } else {
    let d2 = dot(in.uv, in.uv);
    a = exp(-4.0 * d2) * (1.0 - smoothstep(0.6, 1.0, d2));
  }
  return vec4f(in.color * a, 0.0);
}

fn hash11(n: u32) -> f32 {
  var x = n * 747796405u + 2891336453u;
  x = ((x >> ((x >> 28u) + 4u)) ^ x) * 277803737u;
  x = (x >> 22u) ^ x;
  return f32(x) / 4294967295.0;
}

fn hash3(n: u32) -> vec3f {
  return vec3f(hash11(n), hash11(n ^ 0x9e3779b9u), hash11(n ^ 0x7f4a7c15u));
}
`;

// Voltage → light. Rest is a dim indigo, small depolarizations brighten
// through violet, and the spike runs hot orange to white.
export const VOLTAGE_WGSL = /* wgsl */ `
fn voltageColor(v: f32) -> vec3f {
  let x = clamp((v + 72.0) / 110.0, 0.0, 1.0);
  let rest = vec3f(0.10, 0.16, 0.62);
  let sub = vec3f(0.45, 0.32, 1.00);
  let hot = vec3f(1.00, 0.46, 0.14);
  let white = vec3f(1.0, 0.92, 0.78);
  var c = mix(rest, sub, smoothstep(0.04, 0.35, x));
  c = mix(c, hot, smoothstep(0.38, 0.75, x));
  c = mix(c, white, 0.35 * smoothstep(0.85, 1.0, x));
  let bright = 0.07 + 0.55 * smoothstep(0.04, 0.35, x) + 0.55 * smoothstep(0.35, 1.0, x);
  return c * bright;
}
`;

// Surface WGSL compile errors with line numbers (WebGPU otherwise only
// reports an invalid pipeline much later).
export function shaderModule(device: GPUDevice, code: string, label: string): GPUShaderModule {
  const module = device.createShaderModule({ code, label });
  module.getCompilationInfo?.().then((info) => {
    for (const m of info.messages) {
      if (m.type === "error")
        console.error(`[${label}] ${m.lineNum}:${m.linePos} ${m.message}\n${code.split("\n")[m.lineNum - 1] ?? ""}`);
    }
  });
  return module;
}

// ---- the stage -------------------------------------------------------------

export interface StageOptions {
  aspect: number;
  post?: Partial<PostSettings>;
  setup?: (orbit: Orbit) => void;
}

export class NeuronStage {
  readonly shell: Shell;
  readonly device: GPUDevice;
  readonly ctx: GPUCanvasContext;
  readonly post: PostFX;
  readonly orbit = new Orbit();
  readonly hud: HTMLCanvasElement;
  readonly g: CanvasRenderingContext2D;
  readonly camBuf: GPUBuffer;
  readonly layout: GPUBindGroupLayout;
  readonly pipelineLayout: GPUPipelineLayout;
  // figure-specific camera block values (cam.q)
  q: [number, number, number, number] = [0, 0, 0, 0];
  time = 0;
  wallDt = 1 / 60;
  minRadiusPx = 1.1;
  private last = performance.now();
  private camData = new Float32Array(40);
  private vp: Mat4 = new Float32Array(16);

  static async create(container: HTMLElement, opts: StageOptions): Promise<NeuronStage | null> {
    const device = await getDevice();
    if (!device) return null;
    return new NeuronStage(container, device, opts);
  }

  private constructor(container: HTMLElement, device: GPUDevice, opts: StageOptions) {
    this.device = device;
    this.shell = new Shell(container, opts.aspect);
    const canvas = this.shell.canvas;
    const wrap = document.createElement("div");
    wrap.className = "nv-stage";
    canvas.replaceWith(wrap);
    wrap.appendChild(canvas);
    this.hud = document.createElement("canvas");
    this.hud.className = "nv-hud";
    this.hud.width = canvas.width;
    this.hud.height = canvas.height;
    wrap.appendChild(this.hud);
    this.g = this.hud.getContext("2d")!;

    this.ctx = configureContext(canvas, device);
    this.post = new PostFX(device, this.ctx);
    Object.assign(this.post.settings, { exposure: 1, bloom: 0.22, radius: 1.1, vignette: 0.4 }, opts.post);
    opts.setup?.(this.orbit);
    this.orbit.attach(canvas);

    this.camBuf = device.createBuffer({ size: 160, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const storage = (binding: number): GPUBindGroupLayoutEntry => ({
      binding,
      visibility: GPUShaderStage.VERTEX | GPUShaderStage.COMPUTE,
      buffer: { type: "read-only-storage" },
    });
    // one layout for every draw: camera + up to five read-only buffers
    this.layout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
        storage(1),
        storage(2),
        storage(3),
        storage(4),
        storage(5),
      ],
    });
    this.pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [this.layout] });
  }

  get canvas(): HTMLCanvasElement {
    return this.shell.canvas;
  }

  get aspect(): number {
    return this.canvas.width / this.canvas.height;
  }

  // Additive sprite pipelines, one per vertex entry point in `code`.
  pipelines(code: string, entries: string[]): Record<string, GPURenderPipeline> {
    const module = shaderModule(this.device, SPRITE_WGSL + VOLTAGE_WGSL + code, "sprites");
    const out: Record<string, GPURenderPipeline> = {};
    for (const entry of entries) {
      out[entry] = this.device.createRenderPipeline({
        layout: this.pipelineLayout,
        vertex: { module, entryPoint: entry },
        fragment: {
          module,
          entryPoint: "fs",
          targets: [
            {
              format: HDR_FORMAT,
              blend: {
                color: { srcFactor: "one", dstFactor: "one", operation: "add" },
                alpha: { srcFactor: "one", dstFactor: "one", operation: "add" },
              },
            },
          ],
        },
        primitive: { topology: "triangle-list" },
      });
    }
    return out;
  }

  // A bind group over the camera plus the given storage buffers (in binding
  // order 1…5). Missing slots are filled with the first buffer.
  group(buffers: GPUBuffer[]): GPUBindGroup {
    const entries: GPUBindGroupEntry[] = [{ binding: 0, resource: { buffer: this.camBuf } }];
    for (let i = 0; i < 5; i++) entries.push({ binding: i + 1, resource: { buffer: buffers[i] ?? buffers[0] } });
    return this.device.createBindGroup({ layout: this.layout, entries });
  }

  storage(data: ArrayBufferView | number, extraUsage = 0): GPUBuffer {
    const size = typeof data === "number" ? data : data.byteLength;
    const buf = this.device.createBuffer({
      size: Math.max(16, Math.ceil(size / 16) * 16),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | extraUsage,
    });
    if (typeof data !== "number") this.device.queue.writeBuffer(buf, 0, data.buffer, data.byteOffset, data.byteLength);
    return buf;
  }

  // Advance the clock and camera, and upload the camera block.
  begin(): void {
    const now = performance.now();
    this.wallDt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.time += this.wallDt;
    this.orbit.update(this.wallDt);
    const aspect = this.aspect;
    this.vp = this.orbit.viewProj(aspect);
    const d = this.camData;
    d.set(this.vp, 0);
    d.set([...this.orbit.right, 0], 16);
    d.set([...this.orbit.up, 0], 20);
    d.set([...this.orbit.eye, 0], 24);
    d.set([this.time, aspect, 1 / Math.tan(FOV / 2), (this.minRadiusPx * 2) / this.canvas.height], 28);
    d.set(this.q, 32);
    this.device.queue.writeBuffer(this.camBuf, 0, d);
  }

  // Encode compute work, then draw into the HDR target, bloom, and present.
  // `readback` may encode buffer copies and return what to run after submit.
  render(
    compute: ((enc: GPUCommandEncoder) => void) | null,
    draw: (pass: GPURenderPassEncoder) => void,
    readback?: (enc: GPUCommandEncoder) => (() => void) | null,
  ): void {
    const enc = this.device.createCommandEncoder();
    compute?.(enc);
    const pass = enc.beginRenderPass({
      colorAttachments: [
        { view: this.post.sceneView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: "clear", storeOp: "store" },
      ],
    });
    draw(pass);
    pass.end();
    this.post.encodePresent(enc);
    const after = readback?.(enc) ?? null;
    this.device.queue.submit([enc.finish()]);
    after?.();
  }

  clearHud(): void {
    this.g.clearRect(0, 0, this.hud.width, this.hud.height);
  }

  // World point → HUD pixel (null if behind the camera).
  project(p: V3): [number, number] | null {
    const m = this.vp;
    const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
    const y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
    const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
    if (w < 0.05) return null;
    return [((x / w) * 0.5 + 0.5) * this.hud.width, (0.5 - (y / w) * 0.5) * this.hud.height];
  }

  ray(nx: number, ny: number): { o: V3; d: V3 } {
    return this.orbit.ray(nx, ny, this.aspect);
  }

  // HUD pixels per CSS pixel, for sizing text and lines
  get px(): number {
    return this.hud.width / (this.hud.getBoundingClientRect().width || this.hud.width);
  }

  // phone-sized figure: fewer labels, smaller panels
  get compact(): boolean {
    return (this.hud.getBoundingClientRect().width || this.hud.width) < 560;
  }

  // a readout panel tucked into the bottom-right corner
  corner(w: number, h: number): { x: number; y: number; w: number; h: number } {
    const s = this.px;
    const W = this.hud.width;
    const H = this.hud.height;
    const k = this.compact ? 0.62 : 1;
    const bw = Math.min(w * s * k, W * (this.compact ? 0.46 : 0.36));
    const bh = h * s * k;
    return { x: W - bw - 10 * s, y: H - bh - 10 * s, w: bw, h: bh };
  }
}

// ---- HUD drawing helpers ---------------------------------------------------

export const HUD_FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';

export function hudLabel(
  stage: NeuronStage,
  at: V3,
  text: string,
  offset: [number, number],
  color = "rgba(214, 222, 240, 0.85)",
): void {
  const p = stage.project(at);
  if (!p) return;
  const g = stage.g;
  const s = stage.px;
  const k = stage.compact ? 0.6 : 1;
  g.font = `600 ${(stage.compact ? 10 : 11.5) * s}px ${HUD_FONT}`;
  // keep the text on the canvas: flip it to the other side if it would run off
  const tw = g.measureText(text).width + 8 * s;
  let ox = offset[0] * k * s;
  if (ox < 0 && p[0] + ox - tw < 0) ox = Math.abs(ox);
  else if (ox >= 0 && p[0] + ox + tw > stage.hud.width) ox = -Math.max(ox, 6 * s);
  const tx = Math.min(stage.hud.width - 4 * s, Math.max(4 * s, p[0] + ox));
  const ty = Math.min(stage.hud.height - 8 * s, Math.max(10 * s, p[1] + offset[1] * k * s));
  const left = ox < 0;
  g.strokeStyle = "rgba(170, 185, 220, 0.35)";
  g.lineWidth = 1 * s;
  g.beginPath();
  g.moveTo(p[0], p[1]);
  g.lineTo(tx, ty);
  g.stroke();
  g.fillStyle = "rgba(230, 236, 255, 0.9)";
  g.beginPath();
  g.arc(p[0], p[1], 2 * s, 0, Math.PI * 2);
  g.fill();
  g.textAlign = left ? "right" : "left";
  g.textBaseline = "middle";
  g.fillStyle = color;
  g.fillText(text, tx + (left ? -4 : 4) * s, ty);
  g.textAlign = "left";
}

export interface Trace {
  data: Float32Array;
  head: number;
  count: number;
}

export function makeTrace(n: number): Trace {
  return { data: new Float32Array(n), head: 0, count: 0 };
}

export function pushTrace(t: Trace, v: number): void {
  t.data[t.head] = v;
  t.head = (t.head + 1) % t.data.length;
  t.count = Math.min(t.count + 1, t.data.length);
}

// A small oscilloscope panel: voltage traces against reference lines.
export function drawScope(
  stage: NeuronStage,
  box: { x: number; y: number; w: number; h: number },
  traces: { trace: Trace; color: string; width?: number }[],
  range: [number, number],
  lines: { v: number; label: string; color?: string }[],
  title?: string,
): void {
  const g = stage.g;
  const s = stage.px;
  const { x, y, w, h } = box;
  g.fillStyle = "rgba(8, 9, 15, 0.62)";
  g.strokeStyle = "rgba(122, 162, 255, 0.16)";
  g.lineWidth = 1 * s;
  g.beginPath();
  g.roundRect(x, y, w, h, 8 * s);
  g.fill();
  g.stroke();
  const pad = 8 * s;
  const vy = (v: number): number => y + pad + (1 - (v - range[0]) / (range[1] - range[0])) * (h - pad * 2);
  g.font = `${9.5 * s}px ${HUD_FONT}`;
  g.textBaseline = "middle";
  for (const l of lines) {
    const ly = vy(l.v);
    g.strokeStyle = l.color ?? "rgba(255,255,255,0.09)";
    g.setLineDash([3 * s, 4 * s]);
    g.beginPath();
    g.moveTo(x + pad, ly);
    g.lineTo(x + w - pad, ly);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = "rgba(170, 180, 205, 0.55)";
    g.textAlign = "right";
    g.fillText(l.label, x + w - pad, ly - 6 * s);
  }
  g.textAlign = "left";
  for (const { trace, color, width } of traces) {
    const n = trace.data.length;
    if (trace.count < 2) continue;
    g.strokeStyle = color;
    g.lineWidth = (width ?? 1.6) * s;
    g.lineJoin = "round";
    g.beginPath();
    for (let i = 0; i < trace.count; i++) {
      const idx = (trace.head - trace.count + i + n) % n;
      const px = x + pad + ((n - trace.count + i) / (n - 1)) * (w - pad * 2);
      const py = vy(Math.min(range[1], Math.max(range[0], trace.data[idx])));
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.stroke();
  }
  if (title) {
    g.fillStyle = "rgba(200, 210, 235, 0.7)";
    g.font = `600 ${9.5 * s}px ${HUD_FONT}`;
    g.fillText(title, x + pad, y + pad + 3 * s);
  }
}

// Reads a small GPU buffer back to the CPU without stalling: a few staging
// buffers rotate, and `latest` holds whichever copy landed most recently.
export class Readback {
  latest: Float32Array;
  private pool: { buf: GPUBuffer; busy: boolean }[] = [];
  private size: number;

  constructor(device: GPUDevice, size: number) {
    this.size = size;
    this.latest = new Float32Array(size / 4);
    for (let i = 0; i < 3; i++) {
      this.pool.push({
        buf: device.createBuffer({ size, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }),
        busy: false,
      });
    }
  }

  // Encode a copy into a free staging buffer; returns a function to call
  // after submit, or null if every buffer is still in flight.
  copy(enc: GPUCommandEncoder, src: GPUBuffer, offset = 0): (() => void) | null {
    const slot = this.pool.find((p) => !p.busy);
    if (!slot) return null;
    slot.busy = true;
    enc.copyBufferToBuffer(src, offset, slot.buf, 0, this.size);
    return () => {
      slot.buf
        .mapAsync(GPUMapMode.READ)
        .then(() => {
          this.latest = new Float32Array(slot.buf.getMappedRange().slice(0));
          slot.buf.unmap();
          slot.busy = false;
        })
        .catch(() => (slot.busy = false));
    };
  }
}

export { HDR_FORMAT };
