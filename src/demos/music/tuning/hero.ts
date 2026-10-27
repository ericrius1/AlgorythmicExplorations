// Layout helpers for the two music heroes. The essay page chrome lays the
// fixed nav over the top of the hero and (on wide screens) the title over the
// bottom, so the live figure has to fit in the band between them.

export function heroAspect(container: HTMLElement): (w: number) => number {
  return (w: number) => {
    if (w < 736) return 1.02; // phones: title sits below, so go tall
    const below = container.closest(".hero-title-below") !== null;
    if (below) return 0.5;
    return Math.min(0.75, Math.max(0.45, (window.innerHeight * 0.86) / w));
  };
}

export interface Band {
  top: number; // CSS px from the canvas top
  bottom: number;
  left: number;
  right: number;
}

// The free band of the hero canvas, in canvas CSS pixels. Measured from the
// page layout at scroll 0, so it doesn't move as you scroll.
export function heroBand(canvas: HTMLCanvasElement, w: number, h: number): Band {
  const rect = canvas.getBoundingClientRect();
  const canvasTop = rect.top + window.scrollY;
  const nav = document.querySelector<HTMLElement>(".site-nav");
  const navH = nav ? nav.getBoundingClientRect().height : 0;
  const top = Math.max(0, navH - canvasTop) + 8;
  let bottom = h;
  const header = canvas.closest("header.hero");
  const title = header?.querySelector<HTMLElement>(".hero-title");
  if (title && getComputedStyle(title).position === "absolute") {
    const first = title.querySelector<HTMLElement>(".hero-kicker") ?? title.querySelector("h1");
    if (first) {
      const ft = first.getBoundingClientRect().top + window.scrollY - canvasTop;
      bottom = Math.min(h, ft - 14);
    }
  }
  // the readout and controls float in the top corners on wide screens
  const extra = w >= 736 ? 30 : 0;
  return { top: top + extra, bottom: Math.max(top + extra + 80, bottom), left: 0, right: w };
}
