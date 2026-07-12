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
  return [{ title: "Cyber Power | 登录" }];
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
    <main className="grid min-h-dvh place-items-center bg-[var(--background)] px-4 text-[var(--foreground)]">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <section className="w-full max-w-md">
        <div className="mb-5 flex items-center gap-3">
          <div className="grid size-11 place-items-center rounded-md bg-[var(--accent)] text-[var(--accent-foreground)]">
            NI
          </div>
          <div>
            <h1 className="text-2xl font-semibold">Cyber Power</h1>
            <p className="text-sm text-[var(--muted)]">Sign in with Feishu</p>
          </div>
        </div>
        {loaderData.signedOut ? (
          <p className="mb-4 rounded-md border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-sm text-[var(--muted)]">
            已退出当前应用 session。
          </p>
        ) : null}
        {error ? (
          <p className="mb-4 rounded-md border border-danger/40 bg-danger/5 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        ) : null}
        <Form method="post" className="card grid gap-4 p-5">
          <input type="hidden" name="returnTo" value={loaderData.returnTo} />
          <button
            type="submit"
            className="btn btn-primary w-full"
            disabled={Boolean(loaderData.configurationError)}
          >
            Feishu Login
          </button>
        </Form>
      </section>
    </main>
  );
}
