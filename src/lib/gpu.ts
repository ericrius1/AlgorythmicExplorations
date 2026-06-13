// One shared GPUDevice for every demo on the page.

let devicePromise: Promise<GPUDevice | null> | null = null;

export function getDevice(): Promise<GPUDevice | null> {
  devicePromise ??= (async () => {
    if (!navigator.gpu) return null;
    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) return null;
      const requiredFeatures: GPUFeatureName[] = [];
      if (adapter.features.has("timestamp-query")) requiredFeatures.push("timestamp-query");
      const device = await adapter.requestDevice({ requiredFeatures });
      device.addEventListener("uncapturederror", (e) => {
        console.error("WebGPU uncaptured error:", (e as GPUUncapturedErrorEvent).error.message);
      });
      return device;
    } catch {
      return null;
    }
  })();
  return devicePromise;
}

export function configureContext(canvas: HTMLCanvasElement, device: GPUDevice): GPUCanvasContext {
  const ctx = canvas.getContext("webgpu");
  if (!ctx) throw new Error("no webgpu context");
  ctx.configure({ device, format: navigator.gpu.getPreferredCanvasFormat(), alphaMode: "premultiplied" });
  return ctx;
}
