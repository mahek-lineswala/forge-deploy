import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The dev server proxies /api to the backend, so the browser sees one origin:
// the refresh cookie (path /api/auth) and the backend's Origin check both just work.
// FRONTEND_URL in backend/.env must stay http://localhost:5173.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://localhost:5000",
        changeOrigin: false,
      },
    },
  },
});
