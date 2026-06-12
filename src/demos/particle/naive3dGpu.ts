// Part 2, demo 1: the part-one brute-force kernel with one more component.
// Drag to orbit the camera — the disk has thickness now.

import naive3d from "../../shaders/naive3d.wgsl?raw";
import { Shell, gpuMissing, type Demo } from "../../lib/demoShell";
import { getDevice, configureContext } from "../../lib/gpu";
import { Renderer3D } from "../../lib/renderer3d";
import { seedDisk3D } from "../../lib/seed3d";
import { G } from "../../lib/seed";

const WG = 256;

export async function mountNaive3D(container: HTMLElement): Promise<Demo> {
  const dev = await getDevice();
  const shell = new Shell(container);
  if (!dev) return gpuMissing(container);
  const ctx = configureContext(shell.canvas, dev);
  const renderer = new Renderer3D(dev, ctx);
  renderer.camera.attach(shell.canvas);

  const pipeline = dev.createComputePipeline({
    layout: "auto",
    compute: { module: dev.createShaderModule({ code: naive3d }), entryPoint: "main" },
  });
  const params = dev.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

  let count = 25000;
  let pos: [GPUBuffer, GPUBuffer] = [null!, null!];
  let vel: [GPUBuffer, GPUBuffer] = [null!, null!];
  let groups: [GPUBindGroup, GPUBindGroup] = [null!, null!];
  let cur = 0;

  const rebuild = (): void => {
    const init = seedDisk3D(count);
    for (const b of [...pos, ...vel]) b?.destroy();
    const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
    const mkBuf = (data: Float32Array): GPUBuffer => {
      const b = dev.createBuffer({ size: count * 16, usage });
      dev.queue.writeBuffer(b, 0, data as BufferSource);
      return b;
    };
    pos = [mkBuf(init.pos), dev.createBuffer({ size: count * 16, usage })];
    vel = [mkBuf(init.vel), dev.createBuffer({ size: count * 16, usage })];
    const mk = (a: 0 | 1, b: 0 | 1): GPUBindGroup =>
      dev.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: params } },
          { binding: 1, resource: { buffer: pos[a] } },
          { binding: 2, resource: { buffer: vel[a] } },
          { binding: 3, resource: { buffer: pos[b] } },
          { binding: 4, resource: { buffer: vel[b] } },
        ],
      });
    groups = [mk(0, 1), mk(1, 0)];
    cur = 0;
  };
  rebuild();

  shell.slider({
    label: "bodies",
    min: 2000,
    max: 60000,
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
  shell.setInfo(() => `O(n²) in 3D · drag to orbit, ctrl+scroll to zoom`);

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
      renderer.bind(pos[cur], vel[cur]);
      renderer.encode(enc, count, { size: 0.005 });
      dev.queue.submit([enc.finish()]);
    },
  };
}
