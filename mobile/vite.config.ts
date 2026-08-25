import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    target: "es2022",
    sourcemap: true,
  },
  resolve: {
    dedupe: ["react", "react-dom", "three"],
  },
  worker: {
    format: "es",
  },
});
