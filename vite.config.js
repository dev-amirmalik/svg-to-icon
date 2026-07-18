import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Client-side only app. base "./" so the build works when opened from any path.
export default defineConfig({
  base: "./",
  plugins: [react()],
  // ttf2woff references node Buffer; provide a browser global via the polyfill we ship.
  optimizeDeps: {
    // wawoff2 is a CommonJS module loaded only via dynamic import(); Vite won't
    // pre-bundle such deps automatically, which makes the dynamic import fail at
    // runtime and silently drops WOFF2. Force it (and the other CJS deps) to be
    // pre-bundled so import("wawoff2") resolves in dev and prod.
    include: ["wawoff2", "ttf2woff", "opentype.js", "jszip"],
    esbuildOptions: {
      define: { global: "globalThis" },
    },
  },
});
