export type ThemeMode = "light" | "dark";

export const THEME_STORAGE_KEY = "REPLACE_APP_SLUG-theme";
export const THEME_EVENT = "REPLACE_APP_SLUG-theme-change";

export function applyThemeToDocument(theme: ThemeMode) {
  if (typeof globalThis.document !== "undefined") {
    globalThis.document.documentElement.dataset.theme = theme;
    globalThis.document.documentElement.classList.toggle("dark", theme === "dark");
  }
}

export function getInitialTheme(): ThemeMode {
  if (typeof globalThis.localStorage === "undefined") return "dark";
  const stored = globalThis.localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export const themeBootstrapScript = `(() => {
  try {
    const key = 'REPLACE_APP_SLUG-theme';
    const stored = localStorage.getItem(key);
    const theme = stored === 'light' || stored === 'dark'
      ? stored
      : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    document.documentElement.dataset.theme = theme;
    document.documentElement.classList.toggle('dark', theme === 'dark');
  } catch {
    document.documentElement.dataset.theme = 'dark';
    document.documentElement.classList.add('dark');
  }
})();`;
