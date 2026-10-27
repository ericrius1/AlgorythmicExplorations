import { defineConfig, type Plugin } from "vite";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

function collectHtml(dir: string, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of readdirSync(dir)) {
    const full = join(dir, f);
    if (statSync(full).isDirectory()) {
      Object.assign(out, collectHtml(full, prefix ? `${prefix}/${f}` : f));
    } else if (f.endsWith(".html")) {
      const name = f.replace(/\.html$/, "");
      const key = prefix ? `${prefix}/${name}` : name;
      out[key] = full;
    }
  }
  return out;
}

// Home stays at repo root; every essay lives under pages/{series}/{slug}.html
const htmlInputs: Record<string, string> = {
  index: fileURLToPath(new URL("index.html", import.meta.url)),
  ...collectHtml(join(root, "pages"), "pages"),
};

// Production lives at www.ericlevin.dev/algorythmicexplorations/ (the portfolio
// proxies that path to this project). Dev stays at the root. SITE_BASE=/
// builds a root-hosted copy instead.
const SUBPATH = "/algorythmicexplorations/";

// The pages link to each other as /pages/…, /index.html, /favicon.png. Vite
// rewrites the assets it bundles but not plain links, so prefix those here.
function prefixRootLinks(base: string): Plugin {
  return {
    name: "prefix-root-links",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler(html) {
        if (base === "/") return html;
        const prefix = (rest: string): string => (rest.startsWith(base.slice(1)) ? rest : base.slice(1) + rest);
        return html
          .replace(/(href|src)="\/(?!\/)([^"]*)"/g, (_m, attr: string, rest: string) => `${attr}="/${prefix(rest)}"`)
          .replace(/(content="\d+;\s*url=)\/(?!\/)([^"]*)"/gi, (_m, head: string, rest: string) => `${head}/${prefix(rest)}"`);
      },
    },
  };
}

export default defineConfig(({ command }) => {
  const base = command === "build" ? (process.env.SITE_BASE ?? SUBPATH) : "/";
  return {
    base,
    plugins: [prefixRootLinks(base)],
    server: process.env.PORT ? { port: Number(process.env.PORT), strictPort: true } : {},
    build: {
      target: "esnext",
      // dist/ mirrors the URL space, so the files sit under dist/algorythmicexplorations/
      outDir: join("dist", base),
      emptyOutDir: true,
      rollupOptions: { input: htmlInputs },
    },
  };
});
