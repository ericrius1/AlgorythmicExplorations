// Dev HUD for Three.js / raw WebGPU sketches: a params panel (lib/kit.ts, the
// interface kit every project on ericlevin.dev shares) fixed top right, with
// an fps/ms readout in its foot, persisted params, keyboard shortcuts. Params
// and panel metadata live together in a single schema object — bump
// schemaVersion when that shape changes.

import { Group, Panel, kit } from "./kit";
import { KIT_HUE } from "./demoShell";

export interface NumberSpec {
  value: number;
  min: number;
  max: number;
  step?: number;
  label?: string;
}

export interface BoolSpec {
  value: boolean;
  label?: string;
}

export interface SelectSpec<T extends string = string> {
  value: T;
  options: Record<string, T>;
  label?: string;
}

export type LeafSpec = NumberSpec | BoolSpec | SelectSpec;

export type ParamSchema = { [key: string]: ParamSchema | LeafSpec };

export type ParamValues<S extends ParamSchema> = {
  [K in keyof S]: S[K] extends LeafSpec ? S[K]["value"] : S[K] extends ParamSchema ? ParamValues<S[K]> : never;
};

export interface DevToolsOptions<S extends ParamSchema> {
  schema: S;
  /** Bump whenever folders/keys change — stale localStorage is discarded. */
  schemaVersion: string;
  storageKey: string;
  /** The panel's name (its title, in the kit's serif); "Params" without. */
  title?: string;
  onChange?: (values: ParamValues<S>, path: string) => void;
  /** Called when debug.landmarks (or landmarks) toggles via panel or "m". */
  onLandmarksChange?: (visible: boolean) => void;
}

export interface DevTools<S extends ParamSchema> {
  values: ParamValues<S>;
  panel: Panel;
  visible: boolean;
  landmarksVisible: boolean;
  setVisible(visible: boolean): void;
  reset(): void;
  /** Write current values to localStorage (e.g. after programmatic edits). */
  persist(): void;
  /** Call once per frame after rendering. */
  tick(): void;
  dispose(): void;
}

function isLeaf(spec: ParamSchema | LeafSpec): spec is LeafSpec {
  return "value" in spec;
}

function isNumberSpec(spec: LeafSpec): spec is NumberSpec {
  return typeof spec.value === "number" && "min" in spec && "max" in spec;
}

function isSelectSpec(spec: LeafSpec): spec is SelectSpec {
  return typeof spec.value === "string" && "options" in spec;
}

function extractDefaults<S extends ParamSchema>(schema: S): ParamValues<S> {
  const out: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(schema)) {
    out[key] = isLeaf(spec) ? spec.value : extractDefaults(spec);
  }
  return out as ParamValues<S>;
}

function deepAssign(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      if (!target[key] || typeof target[key] !== "object") target[key] = {};
      deepAssign(target[key] as Record<string, unknown>, value as Record<string, unknown>);
    } else {
      target[key] = value;
    }
  }
}

function mergeStored<S extends ParamSchema>(schema: S, stored: unknown): ParamValues<S> {
  const defaults = extractDefaults(schema);
  if (!stored || typeof stored !== "object") return defaults;
  return mergeBranch(schema, defaults as Record<string, unknown>, stored as Record<string, unknown>) as ParamValues<S>;
}

function mergeBranch(
  schema: ParamSchema,
  defaults: Record<string, unknown>,
  stored: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(schema)) {
    if (isLeaf(spec)) {
      const v = stored[key];
      out[key] = typeof v === typeof spec.value ? v : spec.value;
    } else {
      const child = stored[key];
      out[key] = mergeBranch(
        spec,
        defaults[key] as Record<string, unknown>,
        child && typeof child === "object" ? (child as Record<string, unknown>) : {},
      );
    }
  }
  return out;
}

function loadValues<S extends ParamSchema>(
  schema: S,
  schemaVersion: string,
  storageKey: string,
): ParamValues<S> {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return extractDefaults(schema);
    const parsed = JSON.parse(raw) as { schemaVersion?: string; values?: unknown };
    if (parsed.schemaVersion !== schemaVersion) return extractDefaults(schema);
    return mergeStored(schema, parsed.values);
  } catch {
    return extractDefaults(schema);
  }
}

function saveValues<S extends ParamSchema>(
  values: ParamValues<S>,
  schemaVersion: string,
  storageKey: string,
): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify({ schemaVersion, values }));
  } catch {
    // quota / private mode — ignore
  }
}

function findLandmarks(values: Record<string, unknown>): boolean | undefined {
  const debug = values.debug;
  if (!debug || typeof debug !== "object") return undefined;
  const d = debug as Record<string, unknown>;
  if (typeof d.landmarks === "boolean") return d.landmarks;
  if (typeof d.showLandmarks === "boolean") return d.showLandmarks;
  return undefined;
}

// One leaf, bound straight to its slot in the values object: a slider for a
// number between min and max, a select for a choice, a switch for a boolean.
function bindLeaf(
  host: Group,
  key: string,
  spec: LeafSpec,
  target: Record<string, unknown>,
  notify: () => void,
): void {
  const label = spec.label ?? key;
  if (isNumberSpec(spec)) {
    host.bind(target, key, {
      label,
      min: spec.min,
      max: spec.max,
      step: spec.step ?? (Number.isInteger(spec.value) ? 1 : 0.001),
    }).on(notify);
    return;
  }
  if (isSelectSpec(spec)) {
    host.bind(target, key, { label, options: spec.options }).on(notify);
    return;
  }
  host.bind(target, key, { label }).on(notify);
}

// The schema's folders become the panel's sections (a folder inside a folder,
// a card). The substance and the particles start open; the rest folded, until
// a hand unfolds them (the kit keeps which, under the panel's name).
function buildPanel<S extends ParamSchema>(
  host: Group,
  schema: S,
  values: ParamValues<S>,
  onLeafChange: (path: string) => void,
  prefix = "",
): void {
  for (const [key, spec] of Object.entries(schema)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const branch = (values as Record<string, unknown>)[key];
    if (isLeaf(spec)) {
      bindLeaf(host, key, spec, values as Record<string, unknown>, () => onLeafChange(path));
    } else {
      const section = host.section(key, key === "particles" || key === "substance");
      buildPanel(section, spec, branch as ParamValues<ParamSchema>, onLeafChange, path);
    }
  }
}

function inputFocused(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || (el as HTMLElement).isContentEditable;
}

export function createDevTools<S extends ParamSchema>(opts: DevToolsOptions<S>): DevTools<S> {
  kit({ hue: KIT_HUE });
  const values = loadValues(opts.schema, opts.schemaVersion, opts.storageKey);
  let landmarksVisible = findLandmarks(values as Record<string, unknown>) ?? false;

  // the panel keeps its folded sections under the params' storage key
  const panel = new Panel({ title: opts.title ?? "Params", name: opts.storageKey });
  const foot = document.createElement("span");
  panel.foot.append(Object.assign(document.createElement("i"), { className: "k-dot" }), foot);

  let lastPath = "";

  const persist = (path: string): void => {
    lastPath = path;
    saveValues(values, opts.schemaVersion, opts.storageKey);
    const next = findLandmarks(values as Record<string, unknown>);
    if (next !== undefined && next !== landmarksVisible) {
      landmarksVisible = next;
      opts.onLandmarksChange?.(landmarksVisible);
    }
    opts.onChange?.(values, path);
  };

  buildPanel(panel, opts.schema, values, persist);

  // Shown unless the site's controls toggle (siteNav's, in the bar: /) has the
  // figures' interface folded away; it follows that toggle after. Without one
  // on the page, / is the panel's own.
  const siteToggle = document.querySelector(".ctl-toggle") !== null;
  let visible = !document.body.classList.contains("ui-off");
  const applyVisible = (): void => {
    panel.show(visible);
  };

  const reset = (): void => {
    deepAssign(values as Record<string, unknown>, extractDefaults(opts.schema) as Record<string, unknown>);
    localStorage.removeItem(opts.storageKey);
    panel.refresh();
    landmarksVisible = findLandmarks(values as Record<string, unknown>) ?? false;
    opts.onLandmarksChange?.(landmarksVisible);
    opts.onChange?.(values, "reset");
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (inputFocused()) return;
    if (!siteToggle && (e.key === "/" || e.code === "Slash")) {
      e.preventDefault();
      visible = !visible;
      applyVisible();
      return;
    }
    if (e.key === "." || e.code === "Period") {
      e.preventDefault();
      reset();
    }
  };
  const onUiToggle = (e: Event): void => {
    visible = (e as CustomEvent<boolean>).detail;
    applyVisible();
  };

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("ui-toggle", onUiToggle);

  // the foot: frame rate and frame time, smoothed, told a few times a second
  let fpsEma = 60;
  let msEma = 16;
  let last = performance.now();
  let lastFoot = 0;

  const devTools: DevTools<S> = {
    panel,
    values,
    get visible() {
      return visible;
    },
    get landmarksVisible() {
      return landmarksVisible;
    },
    setVisible(v: boolean) {
      visible = v;
      applyVisible();
    },
    reset,
    persist: () => saveValues(values, opts.schemaVersion, opts.storageKey),
    tick() {
      const now = performance.now();
      const dt = now - last;
      last = now;
      fpsEma += (1000 / Math.max(dt, 0.01) - fpsEma) * 0.05;
      msEma += (dt - msEma) * 0.05;
      if (panel.open && now - lastFoot > 250) {
        lastFoot = now;
        foot.textContent = `${fpsEma.toFixed(0)} fps · ${msEma.toFixed(1)} ms · . resets`;
      }
    },
    dispose() {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("ui-toggle", onUiToggle);
      panel.root.remove();
    },
  };

  applyVisible();
  opts.onChange?.(values, lastPath);
  opts.onLandmarksChange?.(landmarksVisible);

  return devTools;
}
