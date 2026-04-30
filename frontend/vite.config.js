// vite.config.js
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/postcss";

export default defineConfig({
  plugins: [react()],

  // Inline PostCSS so Vite does not walk up to a parent postcss.config.js that
  // still uses `tailwindcss: {}` (Tailwind v4 requires @tailwindcss/postcss).
  css: {
    postcss: {
      plugins: [tailwindcss()],
    },
  },

  server: {
    host: "0.0.0.0",
    port: 3000,
    proxy: {
      "/api": {
        target: "http://localhost:5000",
        changeOrigin: true,
      },
    },
  },
});
