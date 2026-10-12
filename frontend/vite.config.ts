import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolveApiProxyTarget } from "./src/lib/apiProxy.ts";
import { publicTraceDevPort } from "./src/lib/viteDevServer.ts";

const BACKEND_ENV_DIR = "../backend";

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, ".", "VITE_");
  // Read the same backend/.env value that FastAPI uses to build QR URLs.
  const backendEnv = loadEnv(mode, BACKEND_ENV_DIR, "PUBLIC_TRACE_");
  const apiProxyTarget = resolveApiProxyTarget(env);
  const serverPort = command === "serve"
    ? publicTraceDevPort(backendEnv.PUBLIC_TRACE_BASE_URL)
    : undefined;
  return {
    plugins: [react()],
    server: {
      host: "0.0.0.0",
      ...(serverPort ? { port: serverPort } : {}),
      strictPort: true,
      proxy: {
        "/api/v1": { target: apiProxyTarget, changeOrigin: true },
        "/health": { target: apiProxyTarget, changeOrigin: true },
      },
    },
    test: {
      environment: "jsdom",
      setupFiles: "./src/test/setup.ts",
      restoreMocks: true,
      clearMocks: true,
    },
  };
});
