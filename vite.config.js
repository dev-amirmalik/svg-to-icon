import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Client-side only app. base "./" so the build works when opened from any path.
export default defineConfig({
  base: "./",
  plugins: [react()],
  // ttf2woff references node Buffer; provide a browser global via the polyfill we ship.
  optimizeDeps: {
    esbuildOptions: {
      define: { global: "globalThis" },
    },
  },
});
