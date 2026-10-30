// Shared chrome for every interactive figure: a canvas, a control strip, an
// fps/info readout, and lazy lifecycle — demos only run while on screen.
// The controls are built from the interface kit (lib/kit.ts, the one every
// project on ericlevin.dev shares): its sliders, its buttons, its mono for the
// readout. The essays keep their own type; only the figures' interface is the
// site's.

import { Group, kit } from "./kit";

// the kit's accent, turned to the site's blue (#7aa2ff)
export const KIT_HUE = 222;

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

const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));

export class Shell {
  readonly canvas: HTMLCanvasElement;
  readonly controls: HTMLDivElement;
  readonly readout: HTMLSpanElement;

  private fpsEma = 60;
  private last = performance.now();
  private info: (() => string) | null = null;

  constructor(container: HTMLElement, aspect = 0.62) {
    kit({ hue: KIT_HUE });
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

  // A kit slider in the strip. What comes back is a native range input, hidden
  // inside the slider's label: figures move a slider from code by setting its
  // .value (and firing "input" to have it take effect), as they always did, and
  // the kit's knob follows. The kit slider itself walks the range's steps by
  // index, so it lands exactly where the native one did (counted from min).
  slider(spec: SliderSpec): HTMLInputElement {
    const wrap = document.createElement("label");
    wrap.className = "demo-slider";
    const input = document.createElement("input");
    input.type = "range";
    input.hidden = true;
    input.tabIndex = -1;
    const enc = (v: number): number => (spec.log ? Math.log10(v) : v);
    const dec = (v: number): number => (spec.log ? Math.pow(10, v) : v);
    input.min = String(enc(spec.min));
    input.max = String(enc(spec.max));
    input.step = spec.log ? "0.01" : String(spec.step);
    input.value = String(enc(spec.value));
    wrap.appendChild(input);

    // the grid the slider walks: the range's own steps, or hundredths of a decade when logarithmic
    const lo = enc(spec.min);
    const fine = spec.log ? 0.01 : spec.step;
    const n = Math.max(1, Math.round((enc(spec.max) - lo) / fine));
    const places = decimals(fine);
    const toIndex = (v: number): number => clamp(Math.round((enc(v) - lo) / fine), 0, n);
    const fromIndex = (i: number): number => {
      const v = dec(+(lo + i * fine).toFixed(places));
      return spec.log ? Math.round(v / spec.step) * spec.step : v;
    };
    // a programmatic value, read back from the native input (which snaps it to its steps)
    const fromInput = (): number => {
      const v = dec(Number(input.value));
      return spec.log ? Math.round(v / spec.step) * spec.step : v;
    };

    const fmt = spec.format ?? ((v: number) => String(Math.round(v * 1000) / 1000));
    const native = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!;
    const state = { i: toIndex(spec.value) };
    const ctl = new Group(wrap).bind(state, "i", { label: spec.label, min: 0, max: n, step: 1, format: (i) => fmt(fromIndex(i)) });
    ctl.on((i) => {
      const v = fromIndex(i);
      native.set!.call(input, String(enc(v)));
      spec.onInput(v);
    });
    // (the value reads in whatever units the figure formats it, so it isn't typed into)
    const val = wrap.querySelector<HTMLInputElement>(".k-val");
    if (val) {
      val.readOnly = true;
      val.tabIndex = -1;
    }

    // setting .value moves the knob at once, with or without an "input" to follow
    Object.defineProperty(input, "value", {
      configurable: true,
      get: () => native.get!.call(input) as string,
      set: (v: string) => {
        native.set!.call(input, v);
        state.i = toIndex(fromInput());
        ctl.refresh();
      },
    });
    input.addEventListener("input", () => {
      const v = fromInput();
      state.i = toIndex(v);
      ctl.refresh();
      spec.onInput(v);
    });

    this.controls.appendChild(wrap);
    return input;
  }

  button(label: string, onClick: () => void): void {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "demo-button k-b";
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

// how many decimal places a step has (0.002 → 3), to keep stepped values tidy
function decimals(step: number): number {
  const s = String(step);
  if (s.includes("e")) return Math.max(0, -Math.floor(Math.log10(step)));
  return (s.split(".")[1] ?? "").length;
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
