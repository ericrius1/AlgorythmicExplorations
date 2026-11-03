// Pictures, the same in every project on ericlevin.dev (Boulder's ui/shot.ts, made shareable): a camera button with
// its key on it, and the key, G (another letter where a project has G already; F2 and PrintScreen too), take a picture
// of the piece as it is, without the page's interface, and keep it: a JPEG downloaded on a computer, the share sheet on
// a phone (Save Image puts it in Photos), downloaded where there's no sharing. Nothing leaves the device. A soft flash
// and, given somewhere to play it, a shutter's click. The project says how its picture is taken (`grab`: weft's Capture
// for a kit, a canvas read just after its frame otherwise); this is the button, the keys and the keeping.
// Self-contained (it brings its own CSS) so each project carries a copy: the canonical one is
// PortfolioII/src/shared/picture.ts. It wears the kit's glass and accent (kit.ts's --k-*, with values to fall back on)
// and the controls' toggle's shape: by default it stands just left of that toggle where the toggle floats, top left
// where there's none; a page with its own row of buttons mounts it.

const CAMERA = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8.5h3l1.6-2.3h6.8L17 8.5h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.6" r="3.6"/></svg>`;

// (plain class selectors, put first in the head, as the toggle's are: a page's own rules come later and win)
const CSS = `
.pic-button {
  --pic-ink: var(--k-text, #e9ecf8); --pic-bg: rgba(10, 12, 20, 0.5); --pic-edge: var(--k-line-2, rgba(160, 180, 255, 0.18));
  position: fixed; z-index: 60; top: max(12px, env(safe-area-inset-top)); left: max(12px, env(safe-area-inset-left));
  display: inline-flex; flex: none; align-items: center; gap: 7px; box-sizing: border-box; height: 38px; margin: 0; padding: 0 9px 0 10px;
  border-radius: 999px; border: 1px solid var(--pic-edge); background: var(--pic-bg); color: var(--pic-ink);
  -webkit-backdrop-filter: blur(14px) saturate(1.3); backdrop-filter: blur(14px) saturate(1.3);
  box-shadow: 0 6px 24px -10px rgba(0, 0, 0, 0.55);
  font: 500 11px/1 var(--k-mono, "JetBrains Mono"), ui-monospace, monospace; cursor: pointer; opacity: 0.55;
  touch-action: manipulation; -webkit-tap-highlight-color: transparent;
  transition: opacity 0.3s ease, background-color 0.3s ease, border-color 0.3s ease, color 0.3s ease;
}
.pic-button.pic-inline { position: relative; z-index: auto; top: auto; left: auto; }
.pic-button:hover, .pic-button:focus-visible { opacity: 1; }
.pic-button:focus-visible { outline: 2px solid var(--pic-ink); outline-offset: 2px; }
.pic-button.pic-busy { opacity: 1; color: var(--k-accent, hsl(210 90% 68%)); }
.pic-button svg { display: block; width: 18px; height: 18px; overflow: visible; }
.pic-button path, .pic-button circle { fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
.pic-button kbd {
  display: grid; place-items: center; box-sizing: border-box; min-width: 18px; height: 18px; padding: 0 4px; border-radius: 5px;
  border: 1px solid currentColor; font: inherit; line-height: 1; opacity: 0.7;
}
/* no keyboard to press it with */
@media (hover: none) and (pointer: coarse) { .pic-button kbd { display: none; } .pic-button { padding: 0 11px; } }
@media (prefers-reduced-motion: reduce) { .pic-button { transition: none; } }
.pic-note, .pic-offer {
  position: fixed; left: 50%; top: max(60px, calc(env(safe-area-inset-top) + 48px)); transform: translateX(-50%); z-index: 2147483001;
  display: flex; gap: 10px; align-items: center; box-sizing: border-box; max-width: calc(100vw - 24px);
  border-radius: 14px; border: 1px solid var(--k-line, rgba(160, 180, 255, 0.1)); background: var(--k-glass, rgba(14, 16, 26, 0.72));
  -webkit-backdrop-filter: blur(18px) saturate(1.3); backdrop-filter: blur(18px) saturate(1.3);
  color: var(--k-text, #e9ecf8); font: 500 12.5px/1.25 var(--k-ui, ui-sans-serif, system-ui, sans-serif); letter-spacing: 0.02em;
}
.pic-note { padding: 9px 14px; pointer-events: none; transition: opacity 0.4s ease; }
.pic-offer { padding: 8px 10px 8px 8px; }
.pic-offer img { height: 52px; border-radius: 8px; display: block; }
.pic-offer button {
  height: 40px; min-width: 40px; padding: 0 14px; border-radius: 999px; cursor: pointer; font: inherit;
  border: 1px solid var(--k-accent-edge, hsl(210 90% 70% / 0.45)); background: var(--k-accent-soft, hsl(210 90% 68% / 0.16)); color: inherit;
}
.pic-offer button + button { padding: 0; border-color: var(--k-line-2, rgba(160, 180, 255, 0.18)); background: none; }
`;

export interface PictureOptions {
  /** the project: the pictures' names (`<name>-2026-11-02-1432.jpg`) */
  name: string;
  /** the picture: the piece as it is now, without the page's interface */
  grab(): Promise<Blob>;
  /** the picture's letter, on the button too: G, as in Boulder, unless the project has G already */
  key?: string;
  /** the letter is the picture's now (false while something else has the letter keys: a keyboard instrument, say);
   *  F2 and PrintScreen always are */
  letter?: () => boolean;
  /** while this says so, no pictures (a film playing over the page, say) */
  paused?: () => boolean;
  /** where the shutter's click plays (the project's sound, so its volume and mute hold); none, no click */
  sound?: () => AudioNode | null | undefined;
  /** a page's own row of buttons to stand in; by default it floats (beside the controls' toggle where that floats) */
  mount?: HTMLElement;
  /** in `mount`, the button it stands before (by default it's put first) */
  before?: Element | null;
}

export interface Picture {
  readonly button: HTMLButtonElement;
  /** take a picture now */
  take(): Promise<void>;
}

const typing = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || !!t.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]'));
const phone = () => matchMedia('(hover: none) and (pointer: coarse)').matches;

/** the picture's name: havens-2026-11-02-1432.jpg */
const named = (name: string, type: string) => {
  const d = new Date(), p = (n: number) => String(n).padStart(2, '0');
  return `${name}-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.${type === 'image/png' ? 'png' : 'jpg'}`;
};

/** a soft flash over the screen (the page's: not in the picture) */
function flash() {
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;inset:0;z-index:2147483000;pointer-events:none;background:#fffdf8;opacity:0.38;transition:opacity 0.45s ease-out';
  document.body.append(el);
  requestAnimationFrame(() => requestAnimationFrame(() => { el.style.opacity = '0'; }));
  setTimeout(() => el.remove(), 600);
}

/** a shutter's two clicks, open and shut, a little apart: a bright tick and a duller one */
function click(out: AudioNode | null | undefined) {
  const ctx = out?.context;
  if (!out || !ctx || ctx.state !== 'running') return;
  const t = ctx.currentTime + 0.01, n = Math.round(ctx.sampleRate * 0.03);
  const noise = ctx.createBuffer(1, n, ctx.sampleRate), d = noise.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (n * 0.18));
  for (const [at, gain, freq] of [[0, 0.5, 3200], [0.075, 0.32, 1800]] as const) {
    const src = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = noise;
    bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = 0.9;
    g.gain.value = gain;
    src.connect(bp).connect(g).connect(out);
    src.start(t + at);
  }
}

/** a line under the buttons for a moment */
function note(text: string) {
  document.querySelector('.pic-note')?.remove();
  const el = document.createElement('div');
  el.className = 'pic-note';
  el.setAttribute('role', 'status');
  el.textContent = text;
  document.body.append(el);
  setTimeout(() => { el.style.opacity = '0'; }, 2200);
  setTimeout(() => el.remove(), 2700);
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name; a.style.display = 'none';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/** "Save the picture": a small card with the picture, its tap the share sheet's (the tap that asked was spent) */
function offer(file: File, blob: Blob) {
  document.querySelector('.pic-offer')?.remove();
  const url = URL.createObjectURL(blob), el = document.createElement('div');
  el.className = 'pic-offer';
  el.innerHTML = `<img src="${url}" alt=""><button type="button">Save the picture</button><button type="button" aria-label="Close">✕</button>`;
  const [save, close] = el.querySelectorAll('button');
  const done = () => { el.remove(); URL.revokeObjectURL(url); };
  save.addEventListener('click', async () => {
    try { await navigator.share({ files: [file] }); done(); }
    catch (e) { if ((e as DOMException).name !== 'AbortError') { download(blob, file.name); done(); } }
  });
  close.addEventListener('click', done);
  document.body.append(el);
  setTimeout(() => { if (el.isConnected) done(); }, 20000);
}

/** kept: the share sheet on a phone, a download elsewhere (or where it can't share) */
async function keep(blob: Blob, name: string) {
  const file = new File([blob], name, { type: blob.type });
  if (!phone() || !navigator.canShare?.({ files: [file] })) { download(blob, name); note(`Picture saved: ${name}`); return; }
  try { await navigator.share({ files: [file] }); }
  catch (e) { if ((e as DOMException).name !== 'AbortError') offer(file, blob); }
}

export function picture(o: PictureOptions): Picture {
  if (!document.getElementById('pic-button-css')) {
    const style = document.createElement('style');
    style.id = 'pic-button-css';
    style.textContent = CSS;
    document.head.prepend(style);
  }
  const key = (o.key ?? 'G').toUpperCase();
  const button = document.createElement('button');
  button.type = 'button';
  button.className = o.mount ? 'pic-button pic-inline' : 'pic-button';
  button.title = `Take a picture  ( ${key} )`;
  button.setAttribute('aria-label', 'Take a picture');
  button.setAttribute('aria-keyshortcuts', key);
  button.innerHTML = `${CAMERA}<kbd aria-hidden="true">${key}</kbd>`;
  // (a page whose letter keys are taken from the start, a keyboard instrument's: F2 on its title, no letter on it)
  if (o.letter && !o.letter()) { button.querySelector('kbd')!.style.display = 'none'; button.title = 'Take a picture  ( F2 )'; button.setAttribute('aria-keyshortcuts', 'F2'); }
  if (o.mount) o.mount.insertBefore(button, o.before === undefined ? o.mount.firstChild : o.before);
  else {
    document.body.append(button);
    // (beside the controls' toggle where it floats: just left of it, whatever its width, as tall as it is)
    const toggle = [...document.querySelectorAll<HTMLElement>('.ctl-toggle')].find((t) => getComputedStyle(t).position === 'fixed');
    if (toggle) {
      const place = () => {
        const r = toggle.getBoundingClientRect();
        if (!r.width) return;
        button.style.left = 'auto';
        button.style.top = `${r.top}px`;
        button.style.height = `${r.height}px`;
        button.style.right = `${innerWidth - r.left + 8}px`;
      };
      place();
      new ResizeObserver(place).observe(toggle);
      addEventListener('resize', place);
    }
  }

  let busy = false;
  const take = async () => {
    if (busy || o.paused?.()) return;
    busy = true;
    button.classList.add('pic-busy');
    flash();
    click(o.sound?.());
    try {
      const blob = await o.grab();
      await keep(blob, named(o.name, blob.type));
    } catch (e) {
      console.warn('picture:', e);
      note('The picture couldn’t be taken');
    } finally {
      busy = false;
      button.classList.remove('pic-busy');
    }
  };

  // (not the focus ring, nor a Space or Enter meant for the piece landing on it afterwards)
  button.addEventListener('pointerdown', (e) => e.preventDefault());
  button.addEventListener('click', (e) => { e.preventDefault(); button.blur(); void take(); });
  let printDown = false;
  addEventListener('keydown', (e) => {
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
    const letter = e.code === `Key${key}` && (o.letter?.() ?? true);
    if (!letter && e.code !== 'F2' && e.code !== 'PrintScreen') return;
    e.preventDefault();
    if (e.code === 'PrintScreen') printDown = true;
    void take();
  });
  // (PrintScreen is often seen only on its way up: the system takes the press)
  addEventListener('keyup', (e) => {
    if (e.code !== 'PrintScreen') return;
    if (!printDown) void take();
    printDown = false;
  });
  return { button, take };
}

/** a canvas's picture, read just after a frame of it is drawn (a WebGPU canvas is readable until that frame is shown):
 *  for a page that draws itself on requestAnimationFrame, this one asked for after its own is, so it runs after it.
 *  (A hidden tab draws nothing: after a second it's read as it is rather than waited on for ever) */
export function canvasPicture(canvas: HTMLCanvasElement, type = 'image/jpeg', quality = 0.92): Promise<Blob> {
  return new Promise((done, fail) => {
    let read = false;
    const now = () => {
      if (read) return;
      read = true;
      try {
        const c = document.createElement('canvas');
        c.width = canvas.width; c.height = canvas.height;
        const g = c.getContext('2d')!;
        g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
        g.drawImage(canvas, 0, 0);
        c.toBlob((b) => (b ? done(b) : fail(new Error('no picture'))), type, quality);
      } catch (e) { fail(e); }
    };
    requestAnimationFrame(now);
    setTimeout(now, 1000);
  });
}
