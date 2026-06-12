// Shared chrome for every interactive figure: a canvas, a control strip, an
// fps/info readout, and lazy lifecycle — demos only run while on screen.

export interface Demo {
  // Called every animation frame while the demo is visible.
  frame(): void;
  dispose?(): void;
}

export interface SliderSpec {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  log?: boolean;
  format?: (v: number) => string;
  onInput: (v: number) => void;
}

export class Shell {
  readonly canvas: HTMLCanvasElement;
  readonly controls: HTMLDivElement;
  readonly readout: HTMLSpanElement;

  private fpsEma = 60;
  private last = performance.now();
  private info: (() => string) | null = null;

  constructor(container: HTMLElement, aspect = 0.62) {
    container.classList.add("demo");
    this.canvas = document.createElement("canvas");
    this.canvas.className = "demo-canvas";
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    // Heroes stretch to the full window width, so render them at native size
    // (capped in device pixels) — the 900px article cap leaves them blurry.
    const hero = container.closest("header.hero") !== null;
    const w = hero
      ? Math.min(container.clientWidth || 1280, 2560 / dpr)
      : Math.min(container.clientWidth || 720, 900);
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(w * aspect * dpr);
    container.appendChild(this.canvas);

    this.controls = document.createElement("div");
    this.controls.className = "demo-controls";
    container.appendChild(this.controls);

    const bar = document.createElement("div");
    bar.className = "demo-readout";
    this.readout = document.createElement("span");
    bar.appendChild(this.readout);
    container.appendChild(bar);
  }

  slider(spec: SliderSpec): HTMLInputElement {
    const wrap = document.createElement("label");
    wrap.className = "demo-slider";
    const text = document.createElement("span");
    const input = document.createElement("input");
    input.type = "range";
    const enc = (v: number): number => (spec.log ? Math.log10(v) : v);
    const dec = (v: number): number => (spec.log ? Math.pow(10, v) : v);
    input.min = String(enc(spec.min));
    input.max = String(enc(spec.max));
    input.step = spec.log ? "0.01" : String(spec.step);
    input.value = String(enc(spec.value));
    const fmt = spec.format ?? ((v: number) => String(Math.round(v * 1000) / 1000));
    const sync = (v: number): void => {
      text.textContent = `${spec.label}: ${fmt(v)}`;
    };
    sync(spec.value);
    input.addEventListener("input", () => {
      let v = dec(Number(input.value));
      if (spec.log) v = Math.round(v / spec.step) * spec.step;
      sync(v);
      spec.onInput(v);
    });
    wrap.appendChild(text);
    wrap.appendChild(input);
    this.controls.appendChild(wrap);
    return input;
  }

  button(label: string, onClick: () => void): void {
    const b = document.createElement("button");
    b.className = "demo-button";
    b.textContent = label;
    b.addEventListener("click", onClick);
    this.controls.appendChild(b);
  }

  setInfo(fn: () => string): void {
    this.info = fn;
  }

  tick(): void {
    const now = performance.now();
    const dt = now - this.last;
    this.last = now;
    this.fpsEma += (1000 / Math.max(dt, 0.01) - this.fpsEma) * 0.05;
    const extra = this.info ? ` · ${this.info()}` : "";
    this.readout.textContent = `${this.fpsEma.toFixed(0)} fps${extra}`;
  }
}

// Runs a demo only while its container is near the viewport. Demos are built
// on first approach (so eight WebGPU sims don't all spin up on page load).
// Visibility comes from an IntersectionObserver when available, backed by a
// rect poll — some embedded/preview browsers report bogus viewport sizes or
// never deliver observer entries.
export function mountLazy(container: HTMLElement, build: () => Demo | Promise<Demo>): void {
  let demo: Demo | null = null;
  let running = false;
  let raf = 0;
  let timer = 0;
  let building = false;
  let lastFrame = 0;

  // rAF-driven when the browser delivers frames; a timer takes over when it
  // doesn't (hidden embeds and aggressive webview throttling suspend rAF).
  const loop = (): void => {
    if (!running || !demo) return;
    lastFrame = performance.now();
    demo.frame();
    raf = requestAnimationFrame(loop);
  };

  const watchdog = (): void => {
    if (!running || !demo) return;
    if (performance.now() - lastFrame > 700) {
      cancelAnimationFrame(raf);
      lastFrame = performance.now();
      demo.frame();
      raf = requestAnimationFrame(loop);
    }
    timer = window.setTimeout(watchdog, 250);
  };

  const start = (): void => {
    running = true;
    lastFrame = performance.now();
    raf = requestAnimationFrame(loop);
    timer = window.setTimeout(watchdog, 250);
  };

  const stop = (): void => {
    running = false;
    cancelAnimationFrame(raf);
    clearTimeout(timer);
  };

  const setVisible = (visible: boolean): void => {
    if (visible && !demo && !building) {
      building = true;
      Promise.resolve(build())
        .then((d) => {
          demo = d;
          building = false;
          if (!running) start();
        })
        .catch((err) => {
          building = false;
          console.error("demo failed to build", err);
        });
    } else if (visible && demo && !running) {
      start();
    } else if (!visible && running) {
      stop();
    }
  };

  const nearViewport = (): boolean => {
    const r = container.getBoundingClientRect();
    const vh = Math.max(window.innerHeight, 400);
    return r.top < vh + 300 && r.bottom > -300;
  };

  if (typeof IntersectionObserver !== "undefined") {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) setVisible(entry.isIntersecting);
      },
      { rootMargin: "200px" },
    );
    observer.observe(container);
  }
  setVisible(nearViewport());
  setInterval(() => setVisible(nearViewport()), 500);
}

export function gpuMissing(container: HTMLElement): Demo {
  const note = document.createElement("p");
  note.className = "demo-fallback";
  note.textContent =
    "This demo needs WebGPU (Chrome or Edge 113+, recent Safari). The CPU demos above still work — but this one is exactly the part your browser is missing.";
  container.appendChild(note);
  return { frame: () => {} };
}
