// Page chrome for series that opt in with <body class="essay">: figure
// headers that exist before their demos load (so nothing jumps when a demo
// mounts), a reading-progress line under the nav, and a rail of the
// article's steps that tracks where you are.

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function figureHeads(): void {
  let n = 0;
  for (const slot of document.querySelectorAll<HTMLElement>("main [data-demo]")) {
    const { title, hint } = slot.dataset;
    if (!title) continue;
    n++;
    slot.classList.add("demo-slot");
    const head = el("div", "demo-head");
    head.appendChild(el("span", "demo-fig", `Fig. ${n}`));
    head.appendChild(el("span", "demo-title", title));
    if (hint) head.appendChild(el("span", "demo-hint", hint));
    slot.prepend(head);
  }
}

function progressLine(): void {
  const nav = document.querySelector(".site-nav");
  if (!nav) return;
  const bar = el("div", "pw-progress");
  const fill = el("div", "pw-progress-fill");
  bar.appendChild(fill);
  nav.appendChild(bar);
  const main = document.querySelector("main");
  if (!main) return;
  let queued = false;
  const sync = (): void => {
    queued = false;
    const r = main.getBoundingClientRect();
    const span = r.height - window.innerHeight * 0.6;
    const t = span > 0 ? Math.min(1, Math.max(0, -r.top / span)) : 0;
    fill.style.transform = `scaleX(${t})`;
  };
  const queue = (): void => {
    if (!queued) {
      queued = true;
      requestAnimationFrame(sync);
    }
  };
  window.addEventListener("scroll", queue, { passive: true });
  window.addEventListener("resize", queue, { passive: true });
  sync();
}

function stepRail(): void {
  const heads = [...document.querySelectorAll<HTMLHeadingElement>("main h2[id]")];
  if (heads.length < 3) return;
  const rail = el("nav", "pw-rail");
  rail.setAttribute("aria-label", "Steps in this article");
  const links: HTMLAnchorElement[] = [];
  for (const h of heads) {
    const kicker = h.querySelector(".kicker")?.textContent ?? "";
    const label = [...h.childNodes]
      .filter((c) => !(c instanceof HTMLElement && c.classList.contains("kicker")))
      .map((c) => c.textContent)
      .join("")
      .trim();
    const a = el("a", "pw-rail-link");
    a.href = `#${h.id}`;
    a.appendChild(el("span", "pw-rail-kicker", kicker.split("·")[0].trim()));
    a.appendChild(el("span", "pw-rail-label", label));
    rail.appendChild(a);
    links.push(a);
  }
  document.body.appendChild(rail);

  // The current step is the last heading above the upper third of the screen.
  let queued = false;
  const sync = (): void => {
    queued = false;
    const line = window.innerHeight * 0.33;
    let current = -1;
    heads.forEach((h, i) => {
      if (h.getBoundingClientRect().top < line) current = i;
    });
    links.forEach((a, i) => a.classList.toggle("is-current", i === current));
    const main = document.querySelector("main");
    const inArticle = main ? main.getBoundingClientRect().top < window.innerHeight * 0.5 : true;
    rail.classList.toggle("is-visible", inArticle);
  };
  const queue = (): void => {
    if (!queued) {
      queued = true;
      requestAnimationFrame(sync);
    }
  };
  window.addEventListener("scroll", queue, { passive: true });
  window.addEventListener("resize", queue, { passive: true });
  sync();
}

export function initSeriesChrome(): void {
  if (!document.body.classList.contains("essay")) return;
  figureHeads();
  progressLine();
  stepRail();
}
