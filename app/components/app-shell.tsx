import type { ReactNode } from "react";
import { AppFooter } from "./app-footer";
import { AppHeader } from "./app-header";
import type { PublicUser } from "../lib/auth-types";

export function AppShell({
  centerTitle,
  user,
  authLoading,
  busy,
  onReplaceFile,
  children,
}: {
  centerTitle?: string | null;
  user: PublicUser | null;
  authLoading: boolean;
  busy: boolean;
  onReplaceFile?: (() => void) | null;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-[var(--background)] text-[var(--foreground)]">
      <TopProgressBar active={busy} />
      <AppHeader
        centerTitle={centerTitle}
        user={user}
        authLoading={authLoading}
        onReplaceFile={onReplaceFile}
      />
      <main className="flex-1 p-2.5">{children}</main>
      <AppFooter />
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
