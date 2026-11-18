import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig } from "vite";
import productConfig from "../vite.config";

// This supported Vite alias keeps the static build free of Vercel telemetry
// without changing the legacy build, product code, or published release tools.
export default defineConfig(mergeConfig(productConfig, {
  resolve: { alias: { "@vercel/analytics": fileURLToPath(new URL("./analytics-disabled.ts", import.meta.url)) } },
}));
