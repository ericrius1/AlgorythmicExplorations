// A small sound control for music pages: on/off + volume, remembered per
// visitor. Floats in the bottom-right corner unless given a parent. Also
// installs unlock-on-first-gesture, so the first tap anywhere starts audio.
//
//   mountSoundControl();

import "../../styles/music.css";
import * as Tone from "tone";
import { installUnlock } from "./lifecycle";
import { isMuted, masterVolume, onSoundChange, setMasterVolume, setMuted } from "./master";
import { masterProbe } from "./analysis";

const KEY = "algorythmic.sound";

interface Prefs {
  muted: boolean;
  volume: number;
}

function load(): Prefs | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<Prefs>;
    return {
      muted: p.muted === true,
      volume: typeof p.volume === "number" && isFinite(p.volume) ? Math.min(1, Math.max(0, p.volume)) : 1,
    };
  } catch {
    return null;
  }
}

function save(p: Prefs): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* private mode / blocked storage: settings just don't persist */
  }
}

/** False when the visitor has switched sound off with the control. */
export function soundEnabled(): boolean {
  return !isMuted();
}

let mounted: HTMLElement | null = null;

const ICON_ON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
const ICON_OFF =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"/><path d="M16 9.5l5 5M21 9.5l-5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

/**
 * Mount the page's sound control (once; later calls return the same element).
 * Restores the visitor's last on/off + volume.
 */
export function mountSoundControl(opts: { parent?: HTMLElement; meter?: boolean } = {}): HTMLElement {
  if (mounted) return mounted;
  installUnlock();
  const prefs = load();
  if (prefs) {
    setMasterVolume(prefs.volume);
    setMuted(prefs.muted);
  }

  const el = document.createElement("div");
  el.className = opts.parent ? "sound-control is-inline" : "sound-control";
  el.setAttribute("role", "group");
  el.setAttribute("aria-label", "Sound");

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "sound-control-toggle";

  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = "0";
  slider.max = "1";
  slider.step = "0.01";
  slider.className = "sound-control-volume";
  slider.setAttribute("aria-label", "Volume");

  const meter = document.createElement("span");
  meter.className = "sound-control-meter";
  meter.setAttribute("aria-hidden", "true");

  el.append(btn, slider);
  if (opts.meter ?? true) el.appendChild(meter);
  (opts.parent ?? document.body).appendChild(el);

  const sync = (): void => {
    const m = isMuted();
    const v = masterVolume();
    btn.innerHTML = m ? ICON_OFF : ICON_ON;
    btn.setAttribute("aria-pressed", String(!m));
    btn.setAttribute("aria-label", m ? "Sound off: turn on" : "Sound on: turn off");
    btn.title = m ? "Sound is off" : "Sound is on";
    el.classList.toggle("is-muted", m);
    slider.value = String(v);
    slider.style.setProperty("--fill", `${v * 100}%`);
  };
  sync();
  onSoundChange(sync);

  btn.addEventListener("click", () => {
    const m = !isMuted();
    setMuted(m);
    save({ muted: m, volume: masterVolume() });
  });
  slider.addEventListener("input", () => {
    const v = Number(slider.value);
    setMasterVolume(v);
    if (isMuted() && v > 0) setMuted(false);
    save({ muted: isMuted(), volume: v });
  });

  // a slim level indicator: only polls once audio is actually running
  if (opts.meter ?? true) {
    const probe = masterProbe();
    let level = 0;
    const tick = (): void => {
      if (document.hidden || Tone.getContext().state !== "running") {
        window.setTimeout(tick, 500);
        return;
      }
      const l = probe.levels();
      const peak = Math.max(l.peakL, l.peakR);
      const db = peak > 1e-5 ? 20 * Math.log10(peak) : -100;
      const target = Math.min(1, Math.max(0, (db + 48) / 48));
      level = target > level ? target : level * 0.9;
      meter.style.setProperty("--level", level.toFixed(3));
      el.classList.toggle("is-active", level > 0.02);
      requestAnimationFrame(tick);
    };
    window.setTimeout(tick, 500);
  }

  mounted = el;
  return el;
}
