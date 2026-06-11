// A small clickable piano, used wherever naming actual notes beats sliders.
// Pure DOM — the WebGPU canvas above it stays free for the interesting part.

export interface PianoOpts {
  low: number; // midi, should land on a C for tidy layout
  high: number; // midi, inclusive
  onPress(midi: number): void;
}

const BLACK = new Set([1, 3, 6, 8, 10]);

export class Piano {
  readonly el: HTMLDivElement;
  private keys = new Map<number, HTMLDivElement>();

  constructor(opts: PianoOpts) {
    this.el = document.createElement("div");
    this.el.className = "piano";

    const whites: number[] = [];
    for (let m = opts.low; m <= opts.high; m++) {
      if (!BLACK.has(m % 12)) whites.push(m);
    }
    const whiteW = 100 / whites.length;

    whites.forEach((m, i) => {
      const k = document.createElement("div");
      k.className = "piano-key piano-white";
      k.style.left = `${i * whiteW}%`;
      k.style.width = `${whiteW}%`;
      this.wire(k, m, opts);
      this.el.appendChild(k);
      this.keys.set(m, k);
    });
    whites.forEach((m, i) => {
      const black = m + 1;
      if (black > opts.high || !BLACK.has(black % 12)) return;
      const k = document.createElement("div");
      k.className = "piano-key piano-black";
      k.style.left = `${(i + 0.68) * whiteW}%`;
      k.style.width = `${whiteW * 0.64}%`;
      this.wire(k, black, opts);
      this.el.appendChild(k);
      this.keys.set(black, k);
    });
  }

  private wire(k: HTMLDivElement, midi: number, opts: PianoOpts): void {
    k.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      opts.onPress(midi);
    });
  }

  // Light up a chord: roots warm, the rest cool.
  setHeld(midis: number[], root = -1): void {
    for (const [m, k] of this.keys) {
      k.classList.toggle("is-held", midis.includes(m) && m !== root);
      k.classList.toggle("is-root", m === root);
    }
  }
}
