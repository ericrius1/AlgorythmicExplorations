import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  server: process.env.PORT ? { port: Number(process.env.PORT), strictPort: true } : {},
  build: {
    target: "esnext",
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("index.html", import.meta.url)),
        part2: fileURLToPath(new URL("part2.html", import.meta.url)),
        part3: fileURLToPath(new URL("part3.html", import.meta.url)),
        part4: fileURLToPath(new URL("part4.html", import.meta.url)),
        part5: fileURLToPath(new URL("part5.html", import.meta.url)),
        part6: fileURLToPath(new URL("part6.html", import.meta.url)),
        lava: fileURLToPath(new URL("lava.html", import.meta.url)),
        bonfire: fileURLToPath(new URL("bonfire.html", import.meta.url)),
      },
    },
  },
});
