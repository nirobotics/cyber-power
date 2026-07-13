import { CloudOff, Cloudy, Wifi } from "lucide-react";
import { useEffect, useState } from "react";
import { hasOfflineShell, PWA_STATUS_EVENT } from "../lib/pwa";

type PwaState = "online" | "ready" | "offline" | "error";

export function OfflineStatus() {
  const [state, setState] = useState<PwaState>("online");

  useEffect(() => {
    let alive = true;
    const updateNetwork = () => {
      if (!navigator.onLine) {
        setState("offline");
        return;
      }
      void hasOfflineShell().then((cached) => {
        if (alive) setState(cached && navigator.serviceWorker?.controller ? "ready" : "online");
      });
    };
    const updatePwa = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      if (detail === "ready" || detail === "error") setState(detail);
    };
    updateNetwork();
    globalThis.addEventListener("online", updateNetwork);
    globalThis.addEventListener("offline", updateNetwork);
    globalThis.addEventListener(PWA_STATUS_EVENT, updatePwa);
    return () => {
      alive = false;
      globalThis.removeEventListener("online", updateNetwork);
      globalThis.removeEventListener("offline", updateNetwork);
      globalThis.removeEventListener(PWA_STATUS_EVENT, updatePwa);
    };
  }, []);

  const Icon = state === "offline" ? CloudOff : state === "ready" ? Wifi : Cloudy;
  const label = state === "offline" ? "离线" : state === "ready" ? "可离线使用" : state === "error" ? "仅限在线" : "在线";

  return (
    <span
      className={[
        "inline-flex items-center gap-1.5 text-[11px]",
        state === "offline" ? "text-warn" : state === "ready" ? "text-ok" : "text-ink-faint",
      ].join(" ")}
      title={state === "ready" ? "应用静态资源已缓存，可离线使用。" : label}
      aria-label={label}
    >
      <Icon className="size-3.5" aria-hidden />
      <span className="hidden sm:inline">{label}</span>
    </span>
  );
}
