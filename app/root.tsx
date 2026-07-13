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
import "./app.css";
import { PwaRegistration } from "./components/pwa-registration";
import { themeBootstrapScript } from "./lib/theme";

export const links: Route.LinksFunction = () => [
  { rel: "icon", href: "/favicon.png", type: "image/png" },
];

export const meta = () => [
  { title: "Cyber Power · FRC 机器人能量分析" },
  {
    name: "description",
    content: "面向正确接入 NI EnergyLogger 的机器人的本地优先 WPILOG 能量分析工具。",
  },
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
        <PwaRegistration />
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
    ? `${error.status} 请求失败`
    : "页面加载失败";
  const message = "请刷新页面后重试。";

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-6 py-12">
      <p className="text-sm font-medium text-[var(--muted)]">Cyber Power</p>
      <h1 className="mt-3 text-3xl font-semibold">{title}</h1>
      <p className="mt-4 text-[var(--muted)]">{message}</p>
      <button
        type="button"
        onClick={() => globalThis.location.reload()}
        className="mt-6 w-fit rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-foreground)] transition hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
      >
        重新加载
      </button>
    </main>
  );
}
