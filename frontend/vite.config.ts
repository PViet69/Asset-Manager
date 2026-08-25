import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  // Dev-only: where API routes proxy to. Deliberately not VITE_-prefixed
  // so it never leaks into the client bundle.
  const proxyTarget = env.PROXY_TARGET ?? "http://localhost:8000";
  return {
    plugins: [react()],
    test: {
      environment: "jsdom",
    },
    server: {
      port: 5173,
      proxy: {
        "/v1": { target: proxyTarget, changeOrigin: true },
        "/health": { target: proxyTarget, changeOrigin: true },
        "/auth": { target: proxyTarget, changeOrigin: true },
        "/admin/sync": { target: proxyTarget, changeOrigin: true },
      },
    },
    build: {
      outDir: "dist",
      sourcemap: true,
    },
  };
});