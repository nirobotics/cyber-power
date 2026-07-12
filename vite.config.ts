import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { OFFLINE_NAVIGATION_CACHE } from "./app/lib/pwa";

export default defineConfig({
  plugins: [
    tailwindcss(),
    reactRouter(),
    VitePWA({
      injectRegister: false,
      registerType: "autoUpdate",
      manifest: {
        name: "Cyber Power",
        short_name: "Cyber Power",
        description: "Local-first FRC WPILOG energy analysis for NI EnergyLogger.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#07101c",
        theme_color: "#5b35d5",
        icons: [
          {
            src: "/cyber-unicorn-mark.png",
            sizes: "any",
            type: "image/png",
            purpose: "any maskable",
          },
        ],
      },
      workbox: {
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        globPatterns: ["**/*.{js,css,png,svg,woff2}"],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallback: undefined,
        skipWaiting: true,
        runtimeCaching: [
          {
            urlPattern: ({ url }) =>
              url.origin === self.location.origin &&
              (url.pathname.startsWith("/auth/") || url.pathname.startsWith("/api/")),
            handler: "NetworkOnly",
          },
          {
            urlPattern: ({ request, url }) =>
              (request.mode === "navigate" || request.headers.get("accept")?.includes("text/html")) &&
              url.origin === self.location.origin &&
              !url.pathname.startsWith("/auth/") &&
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
