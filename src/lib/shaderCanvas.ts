// The visual workhorse of the music series: every figure is one fullscreen
// fragment shader fed by a tiny uniform array plus an optional float buffer
// (waveform samples, harmonic amplitudes, polyline points…). A demo supplies
// just `fn scene(uv: vec2f) -> vec3f`; the prelude supplies the vertex stage,
// the bindings, and a small library of glow/color helpers.

const PRELUDE = /* wgsl */ `
struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn vs(@builtin(vertex_index) i: u32) -> VOut {
  var out: VOut;
  let xy = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  out.pos = vec4f(xy * 2.0 - 1.0, 0.0, 1.0);
  // uv: x rightward 0..1, y upward 0..1 (math orientation)
  out.uv = vec2f(xy.x, xy.y);
  return out;
}

// U[0] = (time, aspect, pointerX, pointerY); the rest is per-demo.
@group(0) @binding(0) var<uniform> U: array<vec4f, 8>;
@group(0) @binding(1) var<storage, read> D: array<f32>;

fn uf(i: u32) -> f32 { return U[i >> 2u][i & 3u]; }

fn hsv(h: f32, s: f32, v: f32) -> vec3f {
  let p = abs(fract(vec3f(h) + vec3f(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return v * mix(vec3f(1.0), clamp(p - 1.0, vec3f(0.0), vec3f(1.0)), s);
}

fn sdSeg(p: vec2f, a: vec2f, b: vec2f) -> f32 {
  let pa = p - a;
  let ba = b - a;
  let h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-9), 0.0, 1.0);
  return length(pa - ba * h);
}

// soft gaussian core — the bright line itself
fn glow(d: f32, r: f32) -> f32 { return exp(-(d * d) / (r * r)); }
// long 1/d tail — the bloom around it
fn halo(d: f32, r: f32) -> f32 { return r / (abs(d) + r); }

fn vignette(uv: vec2f) -> f32 {
  let q = uv * (1.0 - uv);
  return pow(clamp(q.x * q.y * 16.0, 0.0, 1.0), 0.18);
}

@fragment
fn fs(v: VOut) -> @location(0) vec4f {
  // touch D so "auto" pipeline layout keeps binding 1 even for scenes
  // that compute everything from uniforms alone
  let c = scene(v.uv) + vec3f(D[0]) * 1e-20;
  return vec4f(max(c, vec3f(0.0)), 1.0);
}
`;

export class ShaderView {
  // 32 floats; [0..3] are written by draw(): time, aspect, pointer x/y.
  readonly uniforms = new Float32Array(32);
  readonly data: Float32Array;
  readonly pointer = { x: 0.5, y: 0.5, down: false, inside: false };

  private dev: GPUDevice;
  private ctx: GPUCanvasContext;
  private broken = false;
  private pipeline: GPURenderPipeline;
  private bind: GPUBindGroup;
  private ubuf: GPUBuffer;
  private dbuf: GPUBuffer;
  private t0 = performance.now();

  constructor(dev: GPUDevice, canvas: HTMLCanvasElement, scene: string, dataLen = 4) {
    this.dev = dev;
    const ctx = canvas.getContext("webgpu");
    if (!ctx) throw new Error("no webgpu context");
    const format = navigator.gpu.getPreferredCanvasFormat();
    ctx.configure({ device: dev, format, alphaMode: "premultiplied" });
    this.ctx = ctx;

    this.data = new Float32Array(Math.max(dataLen, 4));
    this.ubuf = dev.createBuffer({ size: 128, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.dbuf = dev.createBuffer({
      size: this.data.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    const code = PRELUDE + scene;
    dev.pushErrorScope("validation");
    const module = dev.createShaderModule({ code });
    void module.getCompilationInfo().then((info) => {
      for (const m of info.messages) {
        if (m.type === "error") {
          this.broken = true;
          const line = code.split("\n")[m.lineNum - 1] ?? "";
          console.error(`WGSL error ${m.lineNum}:${m.linePos} — ${m.message}\n${line}`);
        }
      }
    });
    this.pipeline = dev.createRenderPipeline({
      layout: "auto",
      vertex: { module, entryPoint: "vs" },
      fragment: { module, entryPoint: "fs", targets: [{ format }] },
      primitive: { topology: "triangle-list" },
    });
    this.bind = dev.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.ubuf } },
        { binding: 1, resource: { buffer: this.dbuf } },
      ],
    });
    void dev.popErrorScope().then((err) => {
      if (err) {
        this.broken = true;
        console.error(`ShaderView setup failed: ${err.message}`);
      }
    });

    // pointer in uv coordinates (y up), tracked for free for every demo
    const toUV = (e: PointerEvent): [number, number] => {
      const r = canvas.getBoundingClientRect();
      return [(e.clientX - r.left) / r.width, 1 - (e.clientY - r.top) / r.height];
    };
    canvas.addEventListener("pointerdown", (e) => {
      [this.pointer.x, this.pointer.y] = toUV(e);
      this.pointer.down = true;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener("pointermove", (e) => {
      [this.pointer.x, this.pointer.y] = toUV(e);
      this.pointer.inside = true;
    });
    canvas.addEventListener("pointerup", () => (this.pointer.down = false));
    canvas.addEventListener("pointerleave", () => {
      this.pointer.inside = false;
      this.pointer.down = false;
    });

    this.uniforms[1] = canvas.width / canvas.height;
  }

  draw(): void {
    if (this.broken) return;
    this.uniforms[0] = (performance.now() - this.t0) / 1000;
    this.uniforms[2] = this.pointer.x;
    this.uniforms[3] = this.pointer.y;
    this.dev.queue.writeBuffer(this.ubuf, 0, this.uniforms as BufferSource);
    this.dev.queue.writeBuffer(this.dbuf, 0, this.data as BufferSource);

    const enc = this.dev.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [
        {
          view: this.ctx.getCurrentTexture().createView(),
          loadOp: "clear",
          storeOp: "store",
          clearValue: { r: 0.024, g: 0.027, b: 0.043, a: 1 },
        },
      ],
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bind);
    pass.draw(3);
    pass.end();
    this.dev.queue.submit([enc.finish()]);
  }
}
