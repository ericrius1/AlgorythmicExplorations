// A 2D wave simulation for the pictures: pressure on a grid, stepped with the
// standard finite-difference scheme for the wave equation. Walls are rigid
// (sound bounces) unless they're given some absorption, which damps the cells
// next to them. It runs far slower than real sound so the eye can follow it.

export class Wave2D {
  readonly gw: number;
  readonly gh: number;
  p: Float32Array;
  prev: Float32Array;
  next: Float32Array;
  readonly solid: Uint8Array;
  readonly damp: Float32Array;
  courant2 = 0.42; // (c·dt/dx)², stable below 0.5
  baseDamp = 0.0008;
  readonly canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private img: ImageData;
  private lut: Uint8ClampedArray;

  constructor(gw: number, gh: number) {
    this.gw = gw;
    this.gh = gh;
    const n = gw * gh;
    this.p = new Float32Array(n);
    this.prev = new Float32Array(n);
    this.next = new Float32Array(n);
    this.solid = new Uint8Array(n);
    this.damp = new Float32Array(n);
    this.canvas = document.createElement("canvas");
    this.canvas.width = gw;
    this.canvas.height = gh;
    this.g = this.canvas.getContext("2d")!;
    this.img = this.g.createImageData(gw, gh);
    this.lut = buildLut();
  }

  clear(): void {
    this.p.fill(0);
    this.prev.fill(0);
  }

  // Solid everywhere outside the rectangle [x0, x1) × [y0, y1); walls absorb
  // with the given coefficients (left, right, top, bottom).
  setRoom(x0: number, y0: number, x1: number, y1: number, absorb: [number, number, number, number] = [0, 0, 0, 0]): void {
    const { gw, gh } = this;
    for (let y = 0; y < gh; y++)
      for (let x = 0; x < gw; x++) {
        const i = y * gw + x;
        const inside = x >= x0 && x < x1 && y >= y0 && y < y1;
        this.solid[i] = inside ? 0 : 1;
        let d = 0;
        if (inside) {
          if (x === x0) d = Math.max(d, absorb[0]);
          if (x === x1 - 1) d = Math.max(d, absorb[1]);
          if (y === y0) d = Math.max(d, absorb[2]);
          if (y === y1 - 1) d = Math.max(d, absorb[3]);
        }
        this.damp[i] = d * 0.9;
      }
    for (let i = 0; i < gw * gh; i++) if (this.solid[i]) this.p[i] = this.prev[i] = 0;
  }

  // A smooth bump of pressure, which spreads out as a ring.
  pulse(cx: number, cy: number, amp: number, radius = 2.2): void {
    const { gw, gh } = this;
    const r = Math.ceil(radius * 3);
    for (let y = Math.max(1, Math.floor(cy) - r); y <= Math.min(gh - 2, Math.ceil(cy) + r); y++)
      for (let x = Math.max(1, Math.floor(cx) - r); x <= Math.min(gw - 2, Math.ceil(cx) + r); x++) {
        const i = y * gw + x;
        if (this.solid[i]) continue;
        const d2 = ((x - cx) ** 2 + (y - cy) ** 2) / (radius * radius);
        const v = amp * Math.exp(-d2);
        this.p[i] += v;
        this.prev[i] += v;
      }
  }

  step(n = 1): void {
    const { gw, gh, solid, damp } = this;
    const c2 = this.courant2;
    for (let s = 0; s < n; s++) {
      const p = this.p;
      const q = this.prev;
      const o = this.next;
      for (let y = 1; y < gh - 1; y++) {
        let i = y * gw + 1;
        for (let x = 1; x < gw - 1; x++, i++) {
          if (solid[i]) {
            o[i] = 0;
            continue;
          }
          const c = p[i];
          // rigid walls: a solid neighbour contributes nothing to the Laplacian
          let lap = 0;
          if (!solid[i - 1]) lap += p[i - 1] - c;
          if (!solid[i + 1]) lap += p[i + 1] - c;
          if (!solid[i - gw]) lap += p[i - gw] - c;
          if (!solid[i + gw]) lap += p[i + gw] - c;
          const d = this.baseDamp + damp[i];
          o[i] = (2 * c - (1 - d) * q[i] + c2 * lap) / (1 + d);
        }
      }
      this.prev = p;
      this.p = o;
      this.next = q;
    }
  }

  // Draw the field into the internal canvas (one pixel per cell).
  render(gain = 1): void {
    const { p, img, lut, solid } = this;
    const d = img.data;
    for (let i = 0; i < p.length; i++) {
      const j = i * 4;
      if (solid[i]) {
        d[j] = 8;
        d[j + 1] = 9;
        d[j + 2] = 14;
        d[j + 3] = 255;
        continue;
      }
      const v = Math.tanh(p[i] * gain);
      const k = Math.max(0, Math.min(255, Math.round((v * 0.5 + 0.5) * 255))) * 4;
      d[j] = lut[k];
      d[j + 1] = lut[k + 1];
      d[j + 2] = lut[k + 2];
      d[j + 3] = 255;
    }
    this.g.putImageData(img, 0, 0);
  }

  energy(): number {
    let e = 0;
    for (let i = 0; i < this.p.length; i += 7) e += this.p[i] * this.p[i];
    return e;
  }
}

// Negative pressure deep blue, zero near black, positive warm amber to white.
function buildLut(): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256 * 4);
  const neg = [
    [10, 12, 20],
    [30, 60, 140],
    [90, 150, 255],
    [200, 225, 255],
  ];
  const pos = [
    [10, 12, 20],
    [130, 60, 40],
    [255, 160, 80],
    [255, 240, 210],
  ];
  const ramp = (stops: number[][], t: number): number[] => {
    const f = t * (stops.length - 1);
    const i = Math.min(stops.length - 2, Math.floor(f));
    const k = f - i;
    return stops[i].map((a, c) => a + (stops[i + 1][c] - a) * k);
  };
  for (let i = 0; i < 256; i++) {
    const v = (i / 255) * 2 - 1;
    const t = Math.pow(Math.abs(v), 0.75);
    const c = v < 0 ? ramp(neg, t) : ramp(pos, t);
    lut[i * 4] = c[0];
    lut[i * 4 + 1] = c[1];
    lut[i * 4 + 2] = c[2];
    lut[i * 4 + 3] = 255;
  }
  return lut;
}
