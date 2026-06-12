// Site-wide navigation, injected by every page's entry module:
//   · a slim fixed bar — masthead, prev/next within the series, an
//     "all posts" menu grouped by series
//   · "read next" cards above the footer
// All generated from posts.ts, so adding a post is a one-line change.

import { POSTS, SITE_NAME, SITE_REPO, currentPost, type Post } from "./posts";

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

function buildMenu(current: Post | null): HTMLElement {
  const menu = el("div", "site-nav-menu");
  const seriesNames = [...new Set(POSTS.map((p) => p.series))];
  for (const name of seriesNames) {
    menu.appendChild(el("div", "site-nav-series", name));
    for (const post of POSTS.filter((p) => p.series === name)) {
      const a = el("a", "site-nav-item" + (post === current ? " is-current" : ""));
      a.href = post.href;
      const head = el("span", "site-nav-item-title");
      head.appendChild(el("span", "site-nav-item-num", String(post.part)));
      head.appendChild(document.createTextNode(post.title));
      a.appendChild(head);
      a.appendChild(el("span", "site-nav-item-sub", post.subtitle));
      menu.appendChild(a);
    }
  }
  return menu;
}

function wireScrollHint(): void {
  const hero = document.querySelector("header.hero");
  const hint = document.querySelector<HTMLElement>(".hero-scroll-hint");
  if (!hero || !hint) return;
  const syncHint = () => {
    const pastHero = hero.getBoundingClientRect().bottom < 80;
    hint.classList.toggle("is-hidden", window.scrollY > 120 || pastHero);
  };
  window.addEventListener("scroll", syncHint, { passive: true });
  window.addEventListener("resize", syncHint, { passive: true });
  syncHint();
}

export function initNav(): void {
  const { post, index } = currentPost();

  // ---- top bar ---------------------------------------------------------------
  const nav = el("nav", "site-nav");
  const home = el("a", "site-nav-home", SITE_NAME);
  home.href = "/index.html";
  nav.appendChild(home);

  const right = el("div", "site-nav-right");
  if (post) {
    const prev = index > 0 ? POSTS[index - 1] : null;
    const next = index < POSTS.length - 1 ? POSTS[index + 1] : null;
    const arrow = (p: Post | null, glyph: string, label: string): void => {
      const a = el("a", "site-nav-arrow" + (p ? "" : " is-off"), glyph);
      if (p) {
        a.href = p.href;
        a.title = `${label}: ${p.title}`;
      }
      right.appendChild(a);
    };
    arrow(prev, "←", "Previous");
    right.appendChild(el("span", "site-nav-where", `${post.series} · ${post.part} of ${POSTS.filter((p) => p.series === post.series).length}`));
    arrow(next, "→", "Next");
  }

  const contact = el("a", "site-nav-github", "Contact");
  contact.href = "/pages/core/contact.html";
  contact.title = "Get in touch";
  right.appendChild(contact);

  const github = el("a", "site-nav-github", "GitHub");
  github.href = SITE_REPO;
  github.target = "_blank";
  github.rel = "noopener noreferrer";
  github.title = "Source on GitHub";
  right.appendChild(github);

  const toggle = el("button", "site-nav-toggle", "all posts ▾");
  right.appendChild(toggle);
  nav.appendChild(right);

  const menu = buildMenu(post);
  nav.appendChild(menu);
  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    menu.classList.toggle("is-open");
  });
  document.addEventListener("click", (e) => {
    if (!menu.contains(e.target as Node)) menu.classList.remove("is-open");
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") menu.classList.remove("is-open");
  });

  document.body.prepend(nav);

  // ---- hero scroll hint (markup lives in each page's <header.hero>) ----------
  wireScrollHint();

  // ---- read-next cards -------------------------------------------------------
  const footer = document.querySelector("footer");
  if (!footer || !post) return;
  const wrap = el("section", "read-next");
  wrap.appendChild(el("h2", "read-next-title", "Keep reading"));
  const grid = el("div", "read-next-grid");

  const picks: { label: string; post: Post }[] = [];
  if (index < POSTS.length - 1) picks.push({ label: "Next", post: POSTS[index + 1] });
  if (index > 0) picks.push({ label: "Previous", post: POSTS[index - 1] });
  // and the start of the *other* series, the cross-pollination link
  const other = POSTS.find((p) => p.series !== post.series && p.part === 1);
  if (other && !picks.some((x) => x.post === other)) picks.push({ label: other.series, post: other });

  for (const { label, post: p } of picks.slice(0, 3)) {
    const a = el("a", "read-next-card");
    a.href = p.href;
    a.appendChild(el("span", "read-next-label", label));
    a.appendChild(el("strong", "", `${p.part}. ${p.title}`));
    a.appendChild(el("span", "read-next-sub", p.subtitle));
    grid.appendChild(a);
  }
  wrap.appendChild(grid);
  footer.parentNode?.insertBefore(wrap, footer);
}
