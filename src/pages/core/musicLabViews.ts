// Views section of the music lab: every audio view on the master output, plus
// a few test sounds to put real signal through them. Add ?music2d to the URL
// to see the Canvas 2D fallback renderer.

import { Tone, masterBus, unlockAudio } from "../../lib/audio";
import { Oscilloscope, SpectrumView, Spectrogram, LevelMeter } from "../../lib/music/views";
import { masterProbe } from "../../lib/music/analysis";

export function mountLabViews(el: HTMLElement): void {
  el.textContent = "";
  const controls = document.createElement("div");
  controls.className = "demo-controls";
  controls.style.padding = "0 0.2rem 0.7rem";
  el.appendChild(controls);

  const row = document.createElement("div");
  row.className = "music-row";
  el.appendChild(row);
  const scope = new Oscilloscope(row, { height: 180 });
  const vmeter = new LevelMeter(row, { orientation: "vertical", height: 180 });
  const spectrum = new SpectrumView(el, { height: 200, markers: [440], labels: "both" });
  const gram = new Spectrogram(el, { height: 200, seconds: 6 });
  const meter = new LevelMeter(el);

  const status = document.createElement("div");
  status.className = "demo-readout";
  el.appendChild(status);
  const probe = masterProbe();
  window.setInterval(() => {
    status.textContent =
      `renderers: scope ${scope.renderer} · spectrum ${spectrum.renderer} · spectrogram ${gram.renderer} · ` +
      `meters ${meter.renderer}/${vmeter.renderer} · probe ${probe.active ? `active @ ${probe.sampleRate} Hz` : "waiting for audio"}`;
  }, 400);

  // ---- test sounds
  let out: Tone.Gain | null = null;
  let osc: Tone.Oscillator | null = null;
  let poly: Tone.PolySynth | null = null;
  const bus = (): Tone.Gain => {
    out ??= new Tone.Gain(1).connect(masterBus());
    return out;
  };
  const stopOsc = (): void => {
    if (!osc) return;
    const o = osc;
    osc = null;
    o.volume.rampTo(-80, 0.08);
    window.setTimeout(() => o.dispose(), 200);
  };

  const button = (label: string, fn: () => void): HTMLButtonElement => {
    const b = document.createElement("button");
    b.className = "demo-button";
    b.textContent = label;
    b.addEventListener("click", () => void unlockAudio().then(fn));
    controls.appendChild(b);
    return b;
  };

  button("▶ sine sweep", () => {
    stopOsc();
    const o = new Tone.Oscillator(50, "sine").connect(bus());
    o.volume.value = -12;
    o.start();
    o.frequency.exponentialRampTo(8000, 8);
    osc = o;
    window.setTimeout(() => osc === o && stopOsc(), 8200);
  });
  button("▶ A4 sine", () => {
    stopOsc();
    const o = new Tone.Oscillator(440, "sine").connect(bus());
    o.volume.value = -12;
    o.start();
    osc = o;
  });
  button("▶ saw chord", () => {
    poly ??= new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "sawtooth" },
      envelope: { attack: 0.02, decay: 0.3, sustain: 0.6, release: 0.8 },
      volume: -18,
    }).connect(bus());
    poly.triggerAttackRelease(["A2", "E3", "A3", "C#4", "E4"], 3);
  });
  button("■ stop", () => {
    stopOsc();
    poly?.releaseAll();
  });
}
