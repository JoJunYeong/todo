import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/todo/",
  build: { sourcemap: false, chunkSizeWarningLimit: 500 },
  server: { port: 5187, strictPort: true },
});
