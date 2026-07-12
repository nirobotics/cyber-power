export function AppFooter({
  version,
  logoSrc = "/ni-logo-purple-word-transparent.png",
  companyName = "NI Robotics Limited",
}: {
  version: string;
  logoSrc?: string;
  companyName?: string;
}) {
  return (
    <footer className="shrink-0 border-t border-[var(--border)] bg-white text-[var(--foreground)] dark:bg-[var(--panel)]">
      <div className="mx-auto grid max-w-7xl grid-cols-1 items-center gap-4 px-4 py-5 text-center sm:grid-cols-[1fr_auto_1fr] sm:px-6 lg:px-8">
        <img
          src={logoSrc}
          alt="Next Innovation"
          className="mx-auto h-10 w-auto max-w-56 object-contain sm:mx-0"
          loading="lazy"
        />
        <p className="text-sm text-[var(--muted)]">
          Copyright © 2026 {companyName}. All rights reserved.
        </p>
        <p className="text-sm text-[var(--muted)] sm:justify-self-end">v{version}</p>
      </div>
    </footer>
  );
}
