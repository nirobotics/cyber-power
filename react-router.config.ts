import type { Config } from "@react-router/dev/config";
import { vercelPreset } from "@vercel/react-router/vite";

// The static release prerenders the version resource; the legacy SSR build stays available.
export default (process.env.CYBER_POWER_STATIC === "1"
  ? { ssr: false, prerender: ["/", "/api/version"], routeDiscovery: { mode: "initial" } }
  : { ssr: true, presets: [vercelPreset()] }) satisfies Config;
