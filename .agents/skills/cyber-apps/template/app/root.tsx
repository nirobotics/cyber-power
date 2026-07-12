import { Analytics } from "@vercel/analytics/react";
import type { ReactNode } from "react";
import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";
import type { Route } from "./+types/root";
import stylesheet from "./app.css?url";
import { themeBootstrapScript } from "./lib/theme";

export const links: Route.LinksFunction = () => [
  { rel: "stylesheet", href: stylesheet },
  { rel: "icon", href: "/favicon.png", type: "image/png" },
];

export const meta = () => [
  { title: "REPLACE_APP_NAME" },
];

export function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
        <Meta />
        <Links />
      </head>
      <body suppressHydrationWarning>
        {children}
        <Analytics mode={getAnalyticsMode()} />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

function getAnalyticsMode() {
  if (typeof window === "undefined") return "production";
  return window.location.hostname.endsWith(".team8214.com") ? "production" : "development";
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const title = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : "Page failed to load";
  const message = error instanceof Error ? error.message : "Refresh the page and try again.";

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-6 py-12">
      <p className="text-sm font-medium text-[var(--muted)]">REPLACE_APP_NAME</p>
      <h1 className="mt-3 text-3xl font-semibold">{title}</h1>
      <p className="mt-4 text-[var(--muted)]">{message}</p>
      <button
        type="button"
        onClick={() => globalThis.location.reload()}
        className="mt-6 w-fit rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-foreground)] transition hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
      >
        Reload
      </button>
    </main>
  );
}
