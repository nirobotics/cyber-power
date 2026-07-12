import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { AppFooter } from "./app-footer";
import { AppHeader } from "./app-header";
import type { SessionUser } from "../lib/auth-types";

export function AppShell({
  appName,
  appSubtitle,
  centerTitle,
  version,
  user,
  authLoading,
  allowGuest,
  busy,
  onLogin,
  children,
  Icon,
  demoHref,
  fixedDesktop = false,
}: {
  appName: string;
  appSubtitle: string;
  centerTitle?: string | null;
  version: string;
  user: SessionUser | null;
  authLoading: boolean;
  allowGuest: boolean;
  busy: boolean;
  onLogin: () => void;
  children: ReactNode;
  Icon?: LucideIcon;
  demoHref?: string;
  fixedDesktop?: boolean;
}) {
  return (
    <div
      className={[
        "flex min-h-dvh flex-col bg-[var(--background)] text-[var(--foreground)]",
        fixedDesktop ? "md:h-dvh md:overflow-hidden" : "",
      ].join(" ")}
    >
      <TopProgressBar active={busy} />
      <AppHeader
        appName={appName}
        appSubtitle={appSubtitle}
        centerTitle={centerTitle}
        user={user}
        authLoading={authLoading}
        allowGuest={allowGuest}
        onLogin={onLogin}
        Icon={Icon}
        demoHref={demoHref}
      />
      <main className={fixedDesktop ? "flex-1 p-2.5 md:min-h-0 md:overflow-hidden" : "flex-1 p-2.5"}>
        {children}
      </main>
      <AppFooter version={version} />
    </div>
  );
}

function TopProgressBar({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-50 h-1 overflow-hidden bg-[var(--accent)]/20">
      <div className="h-full w-1/3 animate-[route-progress_1s_ease-in-out_infinite] bg-[var(--accent)]" />
    </div>
  );
}
