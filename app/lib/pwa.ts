export const OFFLINE_NAVIGATION_CACHE = "cyber-power-navigation-v2";

export async function hasOfflineShell() {
  if (typeof globalThis.caches === "undefined") return false;
  return globalThis.caches.has(OFFLINE_NAVIGATION_CACHE);
}
