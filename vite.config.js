import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Client-side only app. base "./" so the build works when opened from any path.
export default defineConfig({
  base: "./",
  plugins: [react()],
  // ttf2woff references node Buffer; provide a browser global via the polyfill we ship.
  optimizeDeps: {
    // wawoff2 is still used to DECOMPRESS .woff2 when importing an existing
    // font; it's a CommonJS dep loaded via dynamic import(), so pre-bundle it.
    include: ["ttf2woff", "opentype.js", "jszip", "polygon-clipping", "wawoff2"],
    esbuildOptions: {
      define: { global: "globalThis" },
    },
  },
});
