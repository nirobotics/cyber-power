import { data, Link, redirect } from "react-router";
import type { Route } from "./+types/auth.feishu.callback";
import {
  AuthConfigurationError,
  clearOAuthSession,
  commitAuthSession,
  getAuthSession,
  sanitizeReturnTo,
  setCurrentUserSession,
  stateMatches,
} from "../lib/auth.server";
import {
  exchangeFeishuOAuthCode,
  FeishuAuthError,
  getFeishuUserInfo,
  upsertUserProfile,
} from "../lib/feishu.server";

type CallbackFailure = {
  status: "error";
  title: string;
  message: string;
};

export function meta(_args: Route.MetaArgs) {
  return [{ title: "登录回调 | cyber-power" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const session = await getAuthSession(request);
  const url = new URL(request.url);
  const error = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expectedState = session.get("oauthState");
  const pkceVerifier = session.get("pkceVerifier");

  if (!stateMatches(state, expectedState)) {
    return callbackFailure(
      session,
      "登录状态失效",
      "登录请求已过期或校验失败，请重新发起飞书登录。",
      400,
    );
  }

  if (error) {
    return callbackFailure(
      session,
      "登录已取消",
      "飞书授权被取消，未建立 Cyber Power 会话。",
      401,
    );
  }

  if (!code || !pkceVerifier) {
    return callbackFailure(
      session,
      "登录状态失效",
      "登录请求已过期或校验失败，请重新发起飞书登录。",
      400,
    );
  }

  try {
    const accessToken = await exchangeFeishuOAuthCode({
      code,
      codeVerifier: pkceVerifier,
    });
    const userInfo = await getFeishuUserInfo(accessToken);
    const currentUser = await upsertUserProfile(userInfo);
    const returnTo = sanitizeReturnTo(session.get("oauthReturnTo") ?? "/");

    clearOAuthSession(session);
    setCurrentUserSession(session, currentUser);
    throw redirect(returnTo, {
      headers: {
        "Cache-Control": "no-store",
        "Set-Cookie": await commitAuthSession(session),
      },
    });
  } catch (error) {
    if (error instanceof Response) throw error;
    const message =
      error instanceof FeishuAuthError || error instanceof AuthConfigurationError
        ? error.message
        : "登录服务暂时不可用，请稍后重试。";
    return callbackFailure(session, "飞书登录失败", message, 502);
  }
}

export default function FeishuCallback({ loaderData }: Route.ComponentProps) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-12 text-[var(--foreground)]">
      <h1 className="text-2xl font-semibold">{loaderData.title}</h1>
      <p className="mt-3 text-sm text-[var(--muted)]">{loaderData.message}</p>
      <Link to="/auth/login" className="btn btn-primary mt-6">
        重新登录
      </Link>
    </main>
  );
}

async function callbackFailure(
  session: Awaited<ReturnType<typeof getAuthSession>>,
  title: string,
  message: string,
  status: number,
) {
  clearOAuthSession(session);
  return data<CallbackFailure>(
    { status: "error", title, message },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        "Set-Cookie": await commitAuthSession(session),
      },
    },
  );
}
