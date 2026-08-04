import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { OFFLINE_NAVIGATION_CACHE } from "./app/lib/pwa";

const appVersion = readFileSync(new URL("./VERSION", import.meta.url), "utf8").trim();

if (!/^\d{4}\.\d+\.\d+$/.test(appVersion)) {
  throw new Error(`VERSION must use the YYYY.M.P format; received: ${appVersion || "<empty>"}`);
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  plugins: [
    tailwindcss(),
    reactRouter(),
    VitePWA({
      injectRegister: false,
      registerType: "autoUpdate",
      manifest: {
        name: "Cyber Power",
        short_name: "Cyber Power",
        description: "面向 NI EnergyLogger 的本地优先 FRC WPILOG 能量分析工具。",
        lang: "zh-CN",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#111015",
        theme_color: "#5b35d5",
        icons: [
          {
            src: "/pwa-icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/pwa-icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/pwa-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        globIgnores: ["**/pwa-icon-*.png", "**/pwa-maskable-*.png"],
        globPatterns: ["**/*.{js,css,png,svg,woff2}"],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallback: undefined,
        skipWaiting: true,
        runtimeCaching: [
          {
            urlPattern: ({ url }) =>
              url.origin === self.location.origin &&
              url.pathname.startsWith("/api/"),
            handler: "NetworkOnly",
          },
          {
            urlPattern: ({ request, url }) =>
              (request.mode === "navigate" || request.headers.get("accept")?.includes("text/html")) &&
              url.origin === self.location.origin &&
              !url.pathname.startsWith("/api/"),
            handler: "NetworkFirst",
            options: {
              cacheName: OFFLINE_NAVIGATION_CACHE,
              networkTimeoutSeconds: 3,
              expiration: { maxEntries: 8, maxAgeSeconds: 7 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
});
