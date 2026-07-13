export function AppFooter() {
  return (
    <footer className="shrink-0 border-t border-[var(--border)] bg-white text-[var(--foreground)] dark:bg-[var(--panel)]">
      <div className="mx-auto grid max-w-[1680px] grid-cols-1 items-center gap-2 px-4 py-2 text-center sm:grid-cols-[1fr_auto_1fr] sm:px-6">
        <img
          src="/ni-logo-purple-word-transparent.png"
          alt="Next Innovation 标志"
          className="mx-auto h-6 w-auto max-w-40 object-contain sm:mx-0"
          loading="lazy"
        />
        <p className="text-[11px] text-[var(--muted)]">
          © 2026 NI Robotics Limited。保留所有权利。
        </p>
        <p className="text-[11px] text-[var(--muted)] sm:justify-self-end">v1.0.0</p>
      </div>
    </footer>
  );
}
