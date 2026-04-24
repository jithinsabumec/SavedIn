import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
  },
  worker: {
    format: "es",
  },
  optimizeDeps: {
    exclude: ["@xenova/transformers"],
  },
});
