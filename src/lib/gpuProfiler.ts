// Samples occasional compute-pass timestamps through a readback ring so
// profiling never waits for the GPU queue on the frame path.
const MAX_QUERIES = 32;
const SAMPLE_EVERY = 30;

interface Readback {
  buffer: GPUBuffer;
  busy: boolean;
}

interface PendingRead {
  slot: Readback;
  labels: string[];
  count: number;
}

export class GpuProfiler {
  private querySet: GPUQuerySet | null = null;
  private resolveBuffer: GPUBuffer | null = null;
  private readbacks: Readback[] = [];
  private pending: PendingRead | null = null;
  private labels: string[] = [];
  private queryCount = 0;
  private frame = 0;
  private active = false;
  private disposed = false;
  private summary = "";

  constructor(dev: GPUDevice) {
    if (!dev.features.has("timestamp-query")) return;
    const size = MAX_QUERIES * 8;
    this.querySet = dev.createQuerySet({ type: "timestamp", count: MAX_QUERIES });
    this.resolveBuffer = dev.createBuffer({
      size,
      usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
    });
    for (let i = 0; i < 2; i++) {
      this.readbacks.push({
        buffer: dev.createBuffer({ size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }),
        busy: false,
      });
    }
  }

  beginFrame(): void {
    this.frame++;
    this.labels = [];
    this.queryCount = 0;
    this.active =
      this.querySet !== null &&
      this.frame % SAMPLE_EVERY === 0 &&
      this.pending === null &&
      this.readbacks.some((slot) => !slot.busy);
  }

  timestampWrites(label: string): GPUComputePassTimestampWrites | undefined {
    if (!this.active || !this.querySet || this.queryCount + 2 > MAX_QUERIES) return undefined;
    const beginningOfPassWriteIndex = this.queryCount;
    this.queryCount += 2;
    this.labels.push(label);
    return {
      querySet: this.querySet,
      beginningOfPassWriteIndex,
      endOfPassWriteIndex: beginningOfPassWriteIndex + 1,
    };
  }

  resolve(enc: GPUCommandEncoder): void {
    if (!this.active || !this.querySet || !this.resolveBuffer || this.queryCount === 0) return;
    const slot = this.readbacks.find((candidate) => !candidate.busy);
    if (!slot) return;
    const bytes = this.queryCount * 8;
    enc.resolveQuerySet(this.querySet, 0, this.queryCount, this.resolveBuffer, 0);
    enc.copyBufferToBuffer(this.resolveBuffer, 0, slot.buffer, 0, bytes);
    slot.busy = true;
    this.pending = { slot, labels: [...this.labels], count: this.queryCount };
    this.active = false;
  }

  afterSubmit(): void {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    void pending.slot.buffer.mapAsync(GPUMapMode.READ).then(() => {
      if (this.disposed) return;
      const values = new BigUint64Array(pending.slot.buffer.getMappedRange());
      const totals = new Map<string, number>();
      for (let i = 0; i < pending.count; i += 2) {
        const ms = Number(values[i + 1] - values[i]) / 1e6;
        totals.set(pending.labels[i / 2], (totals.get(pending.labels[i / 2]) ?? 0) + ms);
      }
      this.summary = `gpu ${[...totals].map(([label, ms]) => `${label} ${ms.toFixed(2)} ms`).join(" · ")}`;
      pending.slot.buffer.unmap();
      pending.slot.busy = false;
    }).catch(() => {
      pending.slot.busy = false;
    });
  }

  format(): string {
    return this.summary;
  }

  dispose(): void {
    this.disposed = true;
    this.querySet?.destroy();
    this.resolveBuffer?.destroy();
    for (const slot of this.readbacks) slot.buffer.destroy();
  }
}
