import { defineConfig } from "vite";
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

export default defineConfig({
  server: process.env.PORT ? { port: Number(process.env.PORT), strictPort: true } : {},
  build: {
    target: "esnext",
    rollupOptions: { input: htmlInputs },
  },
});
