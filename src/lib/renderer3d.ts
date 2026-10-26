import render3d from "../shaders/render3d.wgsl?raw";
import { OrbitCamera, FOV_Y } from "./camera3d";
import { PostFX, HDR_FORMAT } from "./postfx";

export class Renderer3D {
  readonly camera = new OrbitCamera();
  readonly post: PostFX;

  private dev: GPUDevice;
  private ctx: GPUCanvasContext;
  private pipeline: GPURenderPipeline;
  private params: GPUBuffer;
  private group: GPUBindGroup = null!;

  constructor(dev: GPUDevice, ctx: GPUCanvasContext) {
    this.dev = dev;
    this.ctx = ctx;
    this.post = new PostFX(dev, ctx);
    const module = dev.createShaderModule({ code: render3d });
    this.pipeline = dev.createRenderPipeline({
      layout: "auto",
      vertex: { module, entryPoint: "vs" },
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

  encode(
    enc: GPUCommandEncoder,
    count: number,
    opts: { size?: number; colorScale?: number; intensity?: number } = {},
  ): void {
    const canvas = this.ctx.canvas as HTMLCanvasElement;
    const aspect = canvas.width / canvas.height;
    const { viewProj } = this.camera.matrices(aspect);
    const f = new Float32Array(24);
    f.set(viewProj, 0);
    f[16] = opts.size ?? 0.004;
    f[17] = opts.colorScale ?? 2.0;
    f[18] = opts.intensity ?? 1.0;
    f[19] = 2.2 / canvas.height; // ~1.1 px minimum radius
    f[20] = 1 / Math.tan(FOV_Y / 2);
    f[21] = aspect;
    this.dev.queue.writeBuffer(this.params, 0, f);
    const pass = enc.beginRenderPass({
      colorAttachments: [
        {
          view: this.post.sceneView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.group);
    pass.draw(6, count);
    pass.end();
    this.post.encodePresent(enc);
  }
}
