// Dev HUD for Three.js / raw WebGPU sketches: Tweakpane + fps/ms readout,
// persisted params, keyboard shortcuts. Params and pane metadata live together
// in a single schema object — bump schemaVersion when that shape changes.

import { Pane, type FolderApi } from "tweakpane";
import Stats from "stats.js";

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
  onChange?: (values: ParamValues<S>, path: string) => void;
  /** Called when debug.landmarks (or landmarks) toggles via pane or "m". */
  onLandmarksChange?: (visible: boolean) => void;
}

export interface DevTools<S extends ParamSchema> {
  values: ParamValues<S>;
  pane: Pane;
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

function bindLeaf(
  host: FolderApi,
  key: string,
  spec: LeafSpec,
  target: Record<string, unknown>,
  notify: () => void,
): void {
  const label = spec.label ?? key;
  if (isNumberSpec(spec)) {
    host.addBinding(target, key, {
      label,
      min: spec.min,
      max: spec.max,
      step: spec.step ?? (Number.isInteger(spec.value) ? 1 : 0.001),
    }).on("change", notify);
    return;
  }
  if (isSelectSpec(spec)) {
    host.addBinding(target, key, { label, options: spec.options }).on("change", notify);
    return;
  }
  host.addBinding(target, key, { label }).on("change", notify);
}

function buildPane<S extends ParamSchema>(
  host: FolderApi,
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
      const folder = host.addFolder({ title: key, expanded: key === "particles" || key === "substance" });
      buildPane(folder, spec, branch as ParamValues<ParamSchema>, onLeafChange, path);
    }
  }
}

function inputFocused(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || (el as HTMLElement).isContentEditable;
}

function mountPane(): Pane {
  const pane = new Pane({ title: "params", expanded: true });
  pane.element.style.position = "fixed";
  pane.element.style.top = "8px";
  pane.element.style.right = "8px";
  pane.element.style.zIndex = "10000";
  pane.element.style.maxHeight = "calc(100vh - 16px)";
  pane.element.style.overflow = "auto";
  return pane;
}

export function createDevTools<S extends ParamSchema>(opts: DevToolsOptions<S>): DevTools<S> {
  const values = loadValues(opts.schema, opts.schemaVersion, opts.storageKey);
  let landmarksVisible = findLandmarks(values as Record<string, unknown>) ?? false;

  const hud = document.createElement("div");
  hud.className = "dev-hud";
  hud.style.cssText =
    "position:fixed;top:0;left:0;z-index:10000;pointer-events:none;display:flex;flex-direction:column;gap:0;";

  const statsFps = new Stats();
  statsFps.showPanel(0);
  statsFps.dom.style.position = "relative";
  statsFps.dom.style.pointerEvents = "none";

  const statsMs = new Stats();
  statsMs.showPanel(1);
  statsMs.dom.style.position = "relative";
  statsMs.dom.style.pointerEvents = "none";

  const statsWrap = document.createElement("div");
  statsWrap.className = "dev-hud-stats";
  statsWrap.style.cssText = "display:flex;flex-direction:column;gap:0;pointer-events:none;";
  statsWrap.append(statsFps.dom, statsMs.dom);
  hud.appendChild(statsWrap);

  let pane = mountPane();
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

  const rebuildPane = (): void => {
    pane.dispose();
    pane = mountPane();
    pane.element.style.display = visible ? "" : "none";
    buildPane(pane as FolderApi, opts.schema, values, persist);
  };

  buildPane(pane as FolderApi, opts.schema, values, persist);

  let visible = true;
  const applyVisible = (): void => {
    hud.style.display = visible ? "flex" : "none";
    pane.element.style.display = visible ? "" : "none";
  };

  const reset = (): void => {
    deepAssign(values as Record<string, unknown>, extractDefaults(opts.schema) as Record<string, unknown>);
    localStorage.removeItem(opts.storageKey);
    rebuildPane();
    landmarksVisible = findLandmarks(values as Record<string, unknown>) ?? false;
    opts.onLandmarksChange?.(landmarksVisible);
    opts.onChange?.(values, "reset");
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (inputFocused()) return;
    if (e.key === "/" || e.code === "Slash") {
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

  document.body.append(hud);
  window.addEventListener("keydown", onKeyDown);

  const devTools: DevTools<S> = {
    get pane() {
      return pane;
    },
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
      statsFps.update();
      statsMs.update();
    },
    dispose() {
      window.removeEventListener("keydown", onKeyDown);
      hud.remove();
      pane.dispose();
    },
  };

  applyVisible();
  opts.onChange?.(values, lastPath);
  opts.onLandmarksChange?.(landmarksVisible);

  return devTools;
}
