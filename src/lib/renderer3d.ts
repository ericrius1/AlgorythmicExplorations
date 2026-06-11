import render3d from "../shaders/render3d.wgsl?raw";
import { OrbitCamera } from "./camera3d";

export class Renderer3D {
  readonly camera = new OrbitCamera();

  private dev: GPUDevice;
  private ctx: GPUCanvasContext;
  private pipeline: GPURenderPipeline;
  private params: GPUBuffer;
  private group: GPUBindGroup = null!;

  constructor(dev: GPUDevice, ctx: GPUCanvasContext) {
    this.dev = dev;
    this.ctx = ctx;
    const module = dev.createShaderModule({ code: render3d });
    this.pipeline = dev.createRenderPipeline({
      layout: "auto",
      vertex: { module, entryPoint: "vs" },
      fragment: {
        module,
        entryPoint: "fs",
        targets: [
          {
            format: navigator.gpu.getPreferredCanvasFormat(),
            blend: {
              color: { srcFactor: "src-alpha", dstFactor: "one", operation: "add" },
              alpha: { srcFactor: "one", dstFactor: "one", operation: "add" },
            },
          },
        ],
      },
      primitive: { topology: "triangle-list" },
    });
    this.params = dev.createBuffer({ size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  }

  bind(pos: GPUBuffer, vel: GPUBuffer): void {
    this.group = this.dev.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.params } },
        { binding: 1, resource: { buffer: pos } },
        { binding: 2, resource: { buffer: vel } },
      ],
    });
  }

  encode(enc: GPUCommandEncoder, count: number, opts: { size?: number; colorScale?: number } = {}): void {
    const canvas = this.ctx.canvas as HTMLCanvasElement;
    const { viewProj, right, up } = this.camera.matrices(canvas.width / canvas.height);
    const f = new Float32Array(24);
    f.set(viewProj, 0);
    f.set(right, 16);
    f[19] = opts.size ?? 0.004;
    f.set(up, 20);
    f[23] = opts.colorScale ?? 2.0;
    this.dev.queue.writeBuffer(this.params, 0, f);
    const pass = enc.beginRenderPass({
      colorAttachments: [
        {
          view: this.ctx.getCurrentTexture().createView(),
          clearValue: { r: 0.024, g: 0.027, b: 0.043, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.group);
    pass.draw(6, count);
    pass.end();
  }
}
