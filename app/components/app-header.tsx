import { RefreshCw, Zap } from "lucide-react";
import { NavLink } from "react-router";
import { ThemeToggle } from "./theme-toggle";

export function AppHeader({
  centerTitle,
  onReplaceFile,
}: {
  centerTitle?: string | null;
  onReplaceFile?: (() => void) | null;
}) {
  return (
    <header className="border-b border-[var(--border)] bg-[var(--panel)]">
      <div className="grid w-full gap-2 px-3 py-2 sm:px-4">
        <div className="relative flex min-w-0 items-center gap-3">
          <NavLink
            to="/"
            className="flex min-w-0 flex-1 items-center gap-3 rounded-md transition hover:opacity-85 focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:ring-offset-2 focus:ring-offset-[var(--panel)] md:flex-none md:basis-80"
          >
            <div className="grid size-9 shrink-0 place-items-center rounded-md bg-[var(--accent)] text-[var(--accent-foreground)]">
              <Zap className="size-5" aria-hidden />
            </div>
            <div className="min-w-0">
              <p className="truncate text-base font-semibold leading-tight">Cyber Power</p>
              <p className="hidden truncate text-xs text-[var(--muted)] sm:block">FRC 机器人能量分析</p>
            </div>
          </NavLink>
          <div className="pointer-events-none absolute left-1/2 top-1/2 hidden w-[min(38vw,34rem)] -translate-x-1/2 -translate-y-1/2 text-center md:block">
            {centerTitle ? <p className="truncate text-base font-semibold">{centerTitle}</p> : null}
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {onReplaceFile ? (
              <button
                type="button"
                onClick={onReplaceFile}
                className="grid size-9 shrink-0 place-items-center rounded-md border border-[var(--border)] bg-[var(--panel)] text-[var(--muted)] transition hover:bg-[var(--background)] hover:text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:ring-offset-2 focus:ring-offset-[var(--panel)]"
                aria-label="替换当前文件"
                title="替换文件"
              >
                <RefreshCw className="size-4" aria-hidden />
              </button>
            ) : null}
            <ThemeToggle className="shrink-0" />
          </div>
        </div>
        {centerTitle ? (
          <div className="min-w-0 text-center md:hidden">
            <p className="truncate text-sm font-semibold">{centerTitle}</p>
          </div>
        ) : null}
      </div>
    </header>
  );
}
