// Demo 3: the same O(n²) sum, but one GPU thread per body with
// workgroup-shared tiles. The wall moves out by ~50×. It does not go away.

import naiveShader from "../../shaders/naive.wgsl?raw";
import { Shell, gpuMissing, type Demo } from "../../lib/demoShell";
import { getDevice, configureContext } from "../../lib/gpu";
import { ParticleRenderer } from "../../lib/particleRenderer";
import { seedDisk, G } from "../../lib/seed";

const WG = 256;

export async function mountNaiveGpu(container: HTMLElement): Promise<Demo> {
  const dev = await getDevice();
  const shell = new Shell(container);
  if (!dev) return gpuMissing(container);
  const ctx = configureContext(shell.canvas, dev);
  const renderer = new ParticleRenderer(dev, ctx);

  const pipeline = dev.createComputePipeline({
    layout: "auto",
    compute: { module: dev.createShaderModule({ code: naiveShader }), entryPoint: "main" },
  });
  const params = dev.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

  let count = 30000;
  let bodies: [GPUBuffer, GPUBuffer] = [null!, null!];
  let mass: GPUBuffer = null!;
  let groups: [GPUBindGroup, GPUBindGroup] = [null!, null!];
  let cur = 0;

  const rebuild = (): void => {
    const init = seedDisk(count);
    for (const b of bodies) b?.destroy();
    mass?.destroy();
    const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
    bodies = [dev.createBuffer({ size: count * 16, usage }), dev.createBuffer({ size: count * 16, usage })];
    dev.queue.writeBuffer(bodies[0], 0, init.state as BufferSource);
    mass = dev.createBuffer({ size: count * 4, usage });
    dev.queue.writeBuffer(mass, 0, init.mass as BufferSource);
    const mk = (a: GPUBuffer, b: GPUBuffer): GPUBindGroup =>
      dev.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: params } },
          { binding: 1, resource: { buffer: a } },
          { binding: 2, resource: { buffer: b } },
          { binding: 3, resource: { buffer: mass } },
        ],
      });
    groups = [mk(bodies[0], bodies[1]), mk(bodies[1], bodies[0])];
    cur = 0;
  };
  rebuild();

  shell.slider({
    label: "bodies",
    min: 1000,
    max: 120000,
    step: 1000,
    value: count,
    log: true,
    format: (v) => Math.round(v).toLocaleString(),
    onInput: (v) => {
      count = Math.round(v);
      rebuild();
    },
  });
  shell.button("re-seed", rebuild);
  shell.setInfo(() => `${(count * count / 1e6).toFixed(0)}M pair forces per step, every step`);

  return {
    frame() {
      shell.tick();
      const dv = new DataView(new ArrayBuffer(16));
      dv.setUint32(0, count, true);
      dv.setFloat32(4, 0.016, true);
      dv.setFloat32(8, G, true);
      dv.setFloat32(12, 0.05, true);
      dev.queue.writeBuffer(params, 0, dv.buffer);

      const enc = dev.createCommandEncoder();
      const pass = enc.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, groups[cur]);
      pass.dispatchWorkgroups(Math.ceil(count / WG));
      pass.end();
      cur = 1 - cur;
      renderer.bind(bodies[cur]);
      renderer.encode(enc, count, { scale: 1.0 });
      dev.queue.submit([enc.finish()]);
    },
  };
}
