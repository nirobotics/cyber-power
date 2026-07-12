export const OFFLINE_NAVIGATION_CACHE = "cyber-power-navigation-v1";
export const PWA_STATUS_EVENT = "cyber-power-pwa-status";

export async function hasOfflineShell() {
  if (typeof globalThis.caches === "undefined") return false;
  return globalThis.caches.has(OFFLINE_NAVIGATION_CACHE);
}

export async function clearOfflineShell() {
  if (typeof globalThis.caches === "undefined") return;
  await globalThis.caches.delete(OFFLINE_NAVIGATION_CACHE);
}
