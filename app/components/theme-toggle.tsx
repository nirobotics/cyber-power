import { Moon, Sun } from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";
import {
  applyThemeToDocument,
  getInitialTheme,
  THEME_EVENT,
  THEME_STORAGE_KEY,
  type ThemeMode,
} from "../lib/theme";

export function ThemeToggle({ className = "" }: { className?: string }) {
  const theme = useSyncExternalStore(
    subscribeTheme,
    getInitialTheme,
    getServerThemeSnapshot,
  );

  useEffect(() => {
    applyThemeToDocument(theme);
  }, [theme]);

  const nextTheme = theme === "dark" ? "light" : "dark";
  const Icon = theme === "dark" ? Sun : Moon;

  return (
    <button
      type="button"
      suppressHydrationWarning
      onClick={() => {
        globalThis.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
        applyThemeToDocument(nextTheme);
        globalThis.dispatchEvent(new globalThis.Event(THEME_EVENT));
      }}
      className={[
        "grid size-9 place-items-center rounded-md border border-[var(--border)] bg-[var(--panel)] text-[var(--muted)] shadow-sm transition hover:bg-[var(--background)] hover:text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:ring-offset-2 focus:ring-offset-[var(--background)]",
        className,
      ].join(" ")}
      aria-label={nextTheme === "light" ? "切换到浅色主题" : "切换到深色主题"}
      title={nextTheme === "light" ? "浅色主题" : "深色主题"}
    >
      <Icon className="size-4" aria-hidden />
    </button>
  );
}

function subscribeTheme(onStoreChange: () => void) {
  if (typeof globalThis.addEventListener === "undefined") return () => {};
  const handleThemeChange = () => {
    applyThemeToDocument(getInitialTheme());
    onStoreChange();
  };
  globalThis.addEventListener("storage", handleThemeChange);
  globalThis.addEventListener(THEME_EVENT, handleThemeChange);
  return () => {
    globalThis.removeEventListener("storage", handleThemeChange);
    globalThis.removeEventListener(THEME_EVENT, handleThemeChange);
  };
}

function getServerThemeSnapshot(): ThemeMode {
  return "dark";
}
