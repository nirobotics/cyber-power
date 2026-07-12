import { LogIn, LogOut } from "lucide-react";
import { useRef } from "react";
import type { PublicUser } from "../lib/auth-types";
import { clearOfflineShell } from "../lib/pwa";

export function UserStatus({
  user,
  loading,
  allowGuest,
  onLogin,
  logoutHref = "/auth/logout",
}: {
  user: PublicUser | null;
  loading: boolean;
  allowGuest: boolean;
  onLogin: () => void;
  logoutHref?: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const submittingRef = useRef(false);

  if (loading) {
    return (
      <div className="grid size-9 place-items-center rounded-md border border-[var(--border)] bg-[var(--panel)]">
        <div className="size-4 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
      </div>
    );
  }

  if (!user) {
    if (!allowGuest) return null;
    return (
      <button
        type="button"
        className="inline-flex h-9 shrink-0 items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--panel)] px-3 text-sm font-medium text-[var(--muted)] transition hover:bg-[var(--background)] hover:text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:ring-offset-2 focus:ring-offset-[var(--panel)]"
        onClick={onLogin}
      >
        <LogIn className="size-4" aria-hidden />
        <span className="hidden sm:inline">Login</span>
      </button>
    );
  }

  return (
    <>
      <div className="flex shrink-0 items-center gap-2 text-sm text-[var(--muted)]">
        {user.avatarUrl ? (
          <img
            src={user.avatarUrl}
            alt=""
            className="size-7 shrink-0 rounded-full border border-[var(--border)]"
          />
        ) : (
          <div className="grid size-7 shrink-0 place-items-center rounded-full bg-[var(--background)] text-xs">
            {user.displayName.slice(0, 1)}
          </div>
        )}
        <span className="hidden max-w-32 truncate sm:inline">{user.displayName}</span>
      </div>
      <form
        ref={formRef}
        method="post"
        action={logoutHref}
        onSubmit={(event) => {
          if (submittingRef.current) return;
          event.preventDefault();
          void clearOfflineShell().finally(() => {
            submittingRef.current = true;
            formRef.current?.requestSubmit();
          });
        }}
      >
        <button
          type="submit"
          className="grid size-9 shrink-0 place-items-center rounded-md text-[var(--muted)] transition hover:bg-[var(--background)] hover:text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:ring-offset-2 focus:ring-offset-[var(--panel)]"
          aria-label="Logout"
          title="Logout"
        >
          <LogOut className="size-4" aria-hidden />
        </button>
      </form>
    </>
  );
}
