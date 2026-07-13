import { Zap } from "lucide-react";
import { data, Form, redirect } from "react-router";
import type { Route } from "./+types/auth.login";
import { ThemeToggle } from "../components/theme-toggle";
import {
  assertAuthConfiguration,
  AuthConfigurationError,
  commitAuthSession,
  getAuthConfigurationIssue,
  getAuthSession,
  getCurrentUserFromSession,
  sanitizeReturnTo,
} from "../lib/auth.server";
import {
  createFeishuAuthorizeUrl,
  createOAuthState,
  createPkceChallenge,
  createPkceVerifier,
} from "../lib/feishu.server";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

export function meta(_args: Route.MetaArgs) {
  return [{ title: "登录 | cyber-power" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const returnTo = sanitizeReturnTo(url.searchParams.get("returnTo"));

  try {
    const session = await getAuthSession(request);
    if (getCurrentUserFromSession(session)) throw redirect(returnTo);
  } catch (error) {
    if (error instanceof Response) throw error;
    if (!(error instanceof AuthConfigurationError)) throw error;
  }

  return data(
    {
      returnTo,
      signedOut: url.searchParams.get("signedOut") === "1",
      configurationError: getAuthConfigurationIssue(),
    },
    { headers: NO_STORE_HEADERS },
  );
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const returnTo = sanitizeReturnTo(String(formData.get("returnTo") ?? "/"));

  try {
    assertAuthConfiguration();
    const session = await getAuthSession(request);
    const state = createOAuthState();
    const verifier = createPkceVerifier();
    session.set("oauthState", state);
    session.set("oauthReturnTo", returnTo);
    session.set("pkceVerifier", verifier);

    throw redirect(
      createFeishuAuthorizeUrl({
        state,
        codeChallenge: createPkceChallenge(verifier),
      }).toString(),
      { headers: { "Set-Cookie": await commitAuthSession(session) } },
    );
  } catch (error) {
    if (error instanceof Response) throw error;
    return data(
      {
        error:
          error instanceof AuthConfigurationError
            ? error.message
            : "登录服务暂时不可用，请稍后重试。",
      },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
}

export default function LoginPage({ loaderData, actionData }: Route.ComponentProps) {
  const error = actionData?.error ?? loaderData.configurationError;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
      <div className="fixed right-4 top-4 sm:right-6 sm:top-6">
        <ThemeToggle />
      </div>
      <section>
        <div className="flex items-center gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-md bg-[var(--accent)] text-[var(--accent-foreground)]">
            <Zap className="size-5" aria-hidden />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-normal">Cyber Power</h1>
            <p className="mt-1 text-sm text-[var(--muted)]">FRC 机器人能量分析工具</p>
          </div>
        </div>
        {loaderData.signedOut ? (
          <p className="mt-5 rounded-md border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-sm text-[var(--muted)]">
            已退出当前应用。
          </p>
        ) : null}
        {error ? (
          <p className="mt-5 rounded-md border border-danger/40 bg-danger/5 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        ) : null}
        <Form method="post" className="mt-6">
          <input type="hidden" name="returnTo" value={loaderData.returnTo} />
          <button
            type="submit"
            className="inline-flex w-full items-center justify-center rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-foreground)] transition hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:ring-offset-2 focus:ring-offset-[var(--background)] disabled:cursor-not-allowed disabled:opacity-50"
            disabled={Boolean(loaderData.configurationError)}
          >
            <FeishuLogo />
            飞书登录
          </button>
        </Form>
      </section>
    </main>
  );
}

function FeishuLogo() {
  return (
    <svg viewBox="0 0 24 24" className="mr-2 size-5" role="img" aria-label="飞书">
      <path fill="#00D6B9" d="M3 4.5 10.8 9v5.2L3 9.7V4.5Z" />
      <path fill="#3370FF" d="M10.8 9 21 3.1v5.2l-10.2 5.9V9Z" />
      <path fill="#1456F0" d="m10.8 14.2 4.4 2.5L21 13.4v5.2l-5.8 3.3-4.4-2.5v-5.2Z" />
      <path fill="#00BFA5" d="M3 9.7 10.8 14.2v5.2L3 14.9V9.7Z" />
    </svg>
  );
}
