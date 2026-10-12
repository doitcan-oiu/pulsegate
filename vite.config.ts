import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": { target: "http://127.0.0.1:8787", changeOrigin: false },
      "/v1": { target: "http://127.0.0.1:8787", changeOrigin: false },
      "/health": { target: "http://127.0.0.1:8787", changeOrigin: false },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const path = id.replaceAll("\\", "/");
          if (!path.includes("/node_modules/")) return;
          if (/\/node_modules\/(react|react-dom|scheduler)\//.test(path))
            return "react";
          if (
            /\/node_modules\/(recharts|recharts-scale|d3-[^/]+|victory-vendor)\//.test(
              path,
            )
          )
            return "charts";
          if (path.includes("/node_modules/lucide-react/")) return "ui";
          if (path.includes("/node_modules/@heroui/")) return "heroui";
          return "vendor";
        },
      },
    },
  },
});
