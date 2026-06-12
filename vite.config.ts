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
        fog: fileURLToPath(new URL("fog.html", import.meta.url)),
        flatland: fileURLToPath(new URL("flatland.html", import.meta.url)),
        cornell: fileURLToPath(new URL("cornell.html", import.meta.url)),
        prism: fileURLToPath(new URL("prism.html", import.meta.url)),
        ferro: fileURLToPath(new URL("ferro.html", import.meta.url)),
        vibration: fileURLToPath(new URL("vibration.html", import.meta.url)),
        harmony: fileURLToPath(new URL("harmony.html", import.meta.url)),
        twelve: fileURLToPath(new URL("twelve.html", import.meta.url)),
        scales: fileURLToPath(new URL("scales.html", import.meta.url)),
        chords: fileURLToPath(new URL("chords.html", import.meta.url)),
        jukebox: fileURLToPath(new URL("jukebox.html", import.meta.url)),
        contact: fileURLToPath(new URL("contact.html", import.meta.url)),
        harmonizer: fileURLToPath(new URL("harmonizer.html", import.meta.url)),
      },
    },
  },
});
