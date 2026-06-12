// Landing page: live galaxy hero + an index of every essay, grouped by
// series. The index is generated from posts.ts, so it never drifts from the
// nav.

import "./style.css";
import { initNav } from "./lib/siteNav";
import { mountLazy } from "./lib/demoShell";
import { mountPyramidGpu } from "./demos/pyramidGpu";
import { POSTS, SERIES_TAGLINES, type Post } from "./lib/posts";

initNav();

// ---- hero: the part-1 galaxy, running as a backdrop ------------------------
const heroEl = document.querySelector<HTMLElement>("[data-demo='hero']");
if (heroEl) {
  mountLazy(heroEl, () => mountPyramidGpu(heroEl, { count: 20000, steps: 2, hero: true }));
}

// ---- stats line under the title ---------------------------------------------
const seriesNames = [...new Set(POSTS.map((p) => p.series))];
const meta = document.querySelector<HTMLElement>("[data-home-meta]");
if (meta) {
  meta.textContent = `${POSTS.length} interactive essays · ${seriesNames.length} series · every figure simulated live on your GPU`;
}

// ---- the essay index ---------------------------------------------------------
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function card(post: Post): HTMLAnchorElement {
  const a = el("a", "home-card");
  a.href = post.href;
  a.appendChild(el("span", "home-card-num", String(post.part)));
  const body = el("span", "home-card-body");
  body.appendChild(el("strong", "", post.title));
  body.appendChild(el("span", "home-card-sub", post.subtitle));
  a.appendChild(body);
  return a;
}

const index = document.querySelector<HTMLElement>("[data-home-series]");
if (index) {
  for (const name of seriesNames) {
    const posts = POSTS.filter((p) => p.series === name);
    const section = el("section", "home-series");

    const h2 = el("h2");
    const kicker = el("span", "kicker");
    kicker.textContent = `Series · ${posts.length} ${posts.length === 1 ? "part" : "parts"}`;
    h2.appendChild(kicker);
    h2.appendChild(document.createTextNode(name));
    section.appendChild(h2);

    const tagline = SERIES_TAGLINES[name];
    if (tagline) section.appendChild(el("p", "home-series-tag", tagline));

    const grid = el("div", "home-grid");
    for (const post of posts) grid.appendChild(card(post));
    section.appendChild(grid);

    index.appendChild(section);
  }
}
