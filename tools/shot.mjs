// Headless screenshots of a page's figures, for checking work without a
// visible browser. Uses the Playwright that ships with ../ericlevin-site.
//
//   node tools/shot.mjs <url> <outDir> [--wait 6000] [--width 1280] [--height 820] [--figs]
//
// Saves top.png (first screen), then with --figs one shot per [data-demo] /
// [data-scrolly] figure (scrolled into view, scrolly at 15/50/85%), and
// console errors to errors.txt. Audio is muted and WebGPU is enabled.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PW = "/Users/eric/codeprojects/ericlevin-site/node_modules/playwright/index.mjs";
const { chromium } = await import(PW);

const args = process.argv.slice(2);
const url = args[0];
const out = args[1] ?? "shots";
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : dflt;
};
const wait = opt("wait", 6000);
const width = opt("width", 1280);
const height = opt("height", 820);
const figs = args.includes("--figs");
if (!url) {
  console.error("usage: node tools/shot.mjs <url> <outDir> [--wait ms] [--width px] [--height px] [--figs]");
  process.exit(1);
}
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ["--mute-audio", "--enable-unsafe-webgpu", "--enable-features=Vulkan", "--ignore-gpu-blocklist", "--use-angle=metal"],
});
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning") errors.push(`[${m.type()}] ${m.text()}`);
});
page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));

await page.goto(url, { waitUntil: "networkidle" });
await page.waitForTimeout(wait);
const gpu = await page.evaluate(async () => !!(navigator.gpu && (await navigator.gpu.requestAdapter())));
await page.screenshot({ path: join(out, "top.png") });

if (figs) {
  const ids = await page.evaluate(() =>
    [...document.querySelectorAll("main [data-demo], main [data-scrolly]")].map((e, i) => ({
      i,
      kind: e.dataset.demo ?? `scrolly-${e.dataset.scrolly}`,
      scrolly: !!e.dataset.scrolly,
    })),
  );
  for (const f of ids) {
    const name = `${String(f.i + 1).padStart(2, "0")}-${f.kind}`;
    if (f.scrolly) {
      for (const t of [0.15, 0.5, 0.85]) {
        await page.evaluate(([i, t]) => {
          const e = document.querySelectorAll("main [data-demo], main [data-scrolly]")[i];
          const top = e.getBoundingClientRect().top + scrollY;
          scrollTo(0, top + (e.offsetHeight - innerHeight) * t);
        }, [f.i, t]);
        await page.waitForTimeout(900);
        await page.screenshot({ path: join(out, `${name}-${Math.round(t * 100)}.png`) });
      }
    } else {
      await page.evaluate((i) => {
        const e = document.querySelectorAll("main [data-demo], main [data-scrolly]")[i];
        scrollTo(0, e.getBoundingClientRect().top + scrollY - 60);
      }, f.i);
      await page.waitForTimeout(Math.min(wait, 4000));
      await page.screenshot({ path: join(out, `${name}.png`) });
    }
  }
}

writeFileSync(join(out, "errors.txt"), errors.join("\n") + "\n");
console.log(`webgpu: ${gpu} · ${errors.length} console errors/warnings · shots in ${out}`);
await browser.close();
