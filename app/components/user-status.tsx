import { LogOut } from "lucide-react";
import { useRef } from "react";
import type { PublicUser } from "../lib/auth-types";
import { clearOfflineShell } from "../lib/pwa";

export function UserStatus({
  user,
  loading,
}: {
  user: PublicUser | null;
  loading: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const submittingRef = useRef(false);

  if (loading) {
    return (
      <div
        className="grid size-9 place-items-center rounded-md border border-[var(--border)] bg-[var(--panel)]"
        role="status"
        aria-label="正在读取登录状态"
      >
        <div className="size-4 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
      </div>
    );
  }

  if (!user) return null;

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
        action="/auth/logout"
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
          aria-label="退出登录"
          title="退出登录"
        >
          <LogOut className="size-4" aria-hidden />
        </button>
      </form>
    </>
  );
}
