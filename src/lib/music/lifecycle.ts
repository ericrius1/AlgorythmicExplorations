// Small lifecycle helpers for music figures: unlock audio on the first
// gesture anywhere on the page, fade and stop things cleanly, silence a
// figure when it scrolls away, and a global panic list.

import * as Tone from "tone";
import { unlockAudio } from "../audio";

let unlockInstalled = false;

/**
 * Unlock audio on the first pointerdown / keydown / touchend anywhere on the
 * page (browsers only allow an AudioContext to start inside a gesture).
 * Idempotent. Listeners remove themselves once the context is running.
 */
export function installUnlock(): void {
  if (unlockInstalled || typeof document === "undefined") return;
  unlockInstalled = true;
  const events = ["pointerdown", "keydown", "touchend"] as const;
  const handler = (e: Event): void => {
    // ignore modifier-only and browser-shortcut key presses
    if (e instanceof KeyboardEvent && (e.metaKey || e.ctrlKey || e.altKey)) return;
    void unlockAudio().then(() => {
      if (Tone.getContext().state === "running") {
        for (const ev of events) document.removeEventListener(ev, handler, true);
      }
    });
  };
  for (const ev of events) document.addEventListener(ev, handler, { capture: true, passive: true });
}

type GainLike = Tone.Gain | Tone.Param<"gain"> | Tone.Param<"decibels"> | AudioParam;

function paramOf(g: GainLike): Tone.Param<"gain"> | Tone.Param<"decibels"> | AudioParam {
  return g instanceof Tone.Gain ? g.gain : g;
}

/** Ramp a gain (Tone.Gain, a Tone gain Param or a native AudioParam) to `value` over `seconds`. */
export function fadeTo(g: GainLike, value: number, seconds = 0.1): void {
  const p = paramOf(g);
  if (p instanceof Tone.Param) {
    const now = Tone.getContext().currentTime;
    p.cancelScheduledValues(now);
    p.setValueAtTime(p.getValueAtTime(now), now);
    p.linearRampToValueAtTime(value, now + Math.max(seconds, 0.005));
  } else {
    const ctxTime = (p as unknown as { context?: BaseAudioContext }).context?.currentTime;
    const now = ctxTime ?? Tone.getContext().currentTime;
    p.cancelScheduledValues(now);
    p.setValueAtTime(p.value, now);
    p.linearRampToValueAtTime(value, now + Math.max(seconds, 0.005));
  }
}

/** Ramp to silence; resolves once it's silent (wall-clock). */
export function fadeOut(g: GainLike, seconds = 0.15): Promise<void> {
  fadeTo(g, 0, seconds);
  return new Promise((resolve) => window.setTimeout(resolve, seconds * 1000 + 20));
}

/**
 * Call `onLeave` when `el` scrolls out of view and `onEnter` when it comes
 * back (IntersectionObserver; `margin` widens the visible zone). Returns a
 * disposer.
 */
export function whenOffscreen(
  el: HTMLElement,
  onLeave: () => void,
  onEnter?: () => void,
  opts: { margin?: string } = {},
): () => void {
  if (typeof IntersectionObserver === "undefined") return () => {};
  let visible: boolean | null = null;
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting === visible) continue;
        const wasKnown = visible !== null;
        visible = e.isIntersecting;
        if (!visible && wasKnown) onLeave();
        else if (visible && wasKnown) onEnter?.();
      }
    },
    { rootMargin: opts.margin ?? "0px" },
  );
  io.observe(el);
  return () => io.disconnect();
}

// ---- global panic list ----------------------------------------------------------

const voices = new Set<() => void>();

/** Add a silencer to the global stopAll() list. Returns an unregister function. */
export function registerVoice(stop: () => void): () => void {
  voices.add(stop);
  return () => voices.delete(stop);
}

/** Silence every registered instrument and voice on the page. */
export function stopAll(): void {
  for (const stop of voices) {
    try {
      stop();
    } catch (err) {
      console.warn("music: stopAll handler failed", err);
    }
  }
}
