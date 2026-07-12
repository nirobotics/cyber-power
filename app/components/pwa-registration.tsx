import { useEffect } from "react";
import { hasOfflineShell, PWA_STATUS_EVENT } from "../lib/pwa";

export function PwaRegistration() {
  useEffect(() => {
    void import("virtual:pwa-register").then(({ registerSW }) => {
      registerSW({
        immediate: true,
        onOfflineReady() {
          void prepareOfflineShell();
        },
        onRegisterError() {
          globalThis.dispatchEvent(new CustomEvent(PWA_STATUS_EVENT, { detail: "error" }));
        },
      });
    });
  }, []);

  return null;
}

async function prepareOfflineShell() {
  try {
    await navigator.serviceWorker.ready;
    if (!(await waitForServiceWorkerController())) throw new Error("Service worker did not control the page");
    const response = await fetch(globalThis.location.href, {
      cache: "reload",
      credentials: "include",
      headers: { Accept: "text/html" },
    });
    if (!response.ok || !(await waitForOfflineShell())) throw new Error("Offline shell was not cached");
    globalThis.dispatchEvent(new CustomEvent(PWA_STATUS_EVENT, { detail: "ready" }));
  } catch {
    globalThis.dispatchEvent(new CustomEvent(PWA_STATUS_EVENT, { detail: "error" }));
  }
}

async function waitForServiceWorkerController() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (navigator.serviceWorker.controller) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

async function waitForOfflineShell() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (await hasOfflineShell()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}
