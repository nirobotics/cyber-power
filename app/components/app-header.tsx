import type { LucideIcon } from "lucide-react";
import { Boxes } from "lucide-react";
import { NavLink } from "react-router";
import { ThemeToggle } from "./theme-toggle";
import { UserStatus } from "./user-status";
import type { SessionUser } from "../lib/auth-types";

export function AppHeader({
  appName,
  appSubtitle,
  centerTitle,
  user,
  authLoading,
  allowGuest,
  onLogin,
  Icon = Boxes,
  demoHref,
}: {
  appName: string;
  appSubtitle: string;
  centerTitle?: string | null;
  user: SessionUser | null;
  authLoading: boolean;
  allowGuest: boolean;
  onLogin: () => void;
  Icon?: LucideIcon;
  demoHref?: string;
}) {
  return (
    <header className="border-b border-[var(--border)] bg-[var(--panel)]">
      <div className="grid w-full gap-2 px-3 py-3 sm:px-4">
        <div className="relative flex min-w-0 items-center gap-3">
          <NavLink
            to="/"
            className="flex min-w-0 flex-1 items-center gap-3 rounded-md transition hover:opacity-85 focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:ring-offset-2 focus:ring-offset-[var(--panel)] md:flex-none md:basis-80"
          >
            <div className="grid size-10 shrink-0 place-items-center rounded-md bg-[var(--accent)] text-[var(--accent-foreground)]">
              <Icon className="size-5" aria-hidden />
            </div>
            <div className="min-w-0">
              <p className="truncate text-base font-semibold leading-tight">{appName}</p>
              <p className="hidden truncate text-xs text-[var(--muted)] sm:block">{appSubtitle}</p>
            </div>
          </NavLink>
          <div className="pointer-events-none absolute left-1/2 top-1/2 hidden w-[min(38vw,34rem)] -translate-x-1/2 -translate-y-1/2 text-center md:block">
            {centerTitle ? <p className="truncate text-base font-semibold">{centerTitle}</p> : null}
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {demoHref ? (
              <NavLink
                to={demoHref}
                className={({ isActive }) => [
                  "inline-flex h-9 shrink-0 items-center rounded-md border px-3 text-xs font-black tracking-wider transition focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:ring-offset-2 focus:ring-offset-[var(--panel)]",
                  isActive
                    ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-foreground)]"
                    : "border-[var(--border)] bg-[var(--panel)] text-[var(--muted)] hover:bg-[var(--background)] hover:text-[var(--foreground)]",
                ].join(" ")}
              >
                DEMO
              </NavLink>
            ) : null}
            <ThemeToggle className="shrink-0" />
            <UserStatus user={user} loading={authLoading} allowGuest={allowGuest} onLogin={onLogin} />
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
