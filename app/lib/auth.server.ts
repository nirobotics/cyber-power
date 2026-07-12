import { existsSync, readFileSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import { resolve } from "node:path";
import { createCookieSessionStorage, redirect } from "react-router";
import type { SessionUser } from "./auth-types";

export const PRODUCTION_FEISHU_REDIRECT_URI =
  "https://power.team8214.com/auth/feishu/callback";
export const PRODUCTION_APP_ORIGIN = "https://power.team8214.com";

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 14;
const REQUIRED_AUTH_ENV = [
  "APP_ORIGIN",
  "FEISHU_APP_ID",
  "FEISHU_APP_SECRET",
  "FEISHU_REDIRECT_URI",
  "FEISHU_ALLOWED_TENANT_KEY",
  "SESSION_SECRET",
  "SUPABASE_URL",
  "SUPABASE_SECRET_KEY",
] as const;

type SessionData = {
  userId: string;
  feishuOpenId: string;
  displayName: string;
  avatarUrl: string | null;
  oauthState: string;
  oauthReturnTo: string;
  pkceVerifier: string;
};

export class AuthConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthConfigurationError";
  }
}

let localEnv: Record<string, string> | null = null;
let storage: ReturnType<typeof createCookieSessionStorage<SessionData>> | null = null;

export function getOptionalEnv(name: string): string | undefined {
  const value = process.env[name];
  if (value?.trim()) return value.trim();

  const fallback = getLocalEnv()[name];
  return fallback?.trim() || undefined;
}

export function getRequiredEnv(name: string): string {
  const value = getOptionalEnv(name);
  if (!value) {
    throw new AuthConfigurationError(`服务端认证尚未配置：缺少 ${name}。`);
  }
  return value;
}

export function getAuthConfigurationIssue(): string | null {
  const missing = REQUIRED_AUTH_ENV.filter((name) => !getOptionalEnv(name));
  if (missing.length > 0) {
    return `服务端认证尚未配置：缺少 ${missing.join(", ")}。`;
  }

  const sessionSecret = getOptionalEnv("SESSION_SECRET") ?? "";
  if (sessionSecret.length < 32) {
    return "服务端认证配置无效：SESSION_SECRET 至少需要 32 个字符。";
  }

  const appOrigin = getOptionalEnv("APP_ORIGIN") ?? "";
  try {
    const parsed = new URL(appOrigin);
    const localHttp = parsed.protocol === "http:" && parsed.hostname === "localhost";
    if (
      (parsed.protocol !== "https:" && !localHttp) ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    ) {
      return "服务端认证配置无效：APP_ORIGIN 必须是无路径的 HTTPS origin，localhost 开发环境除外。";
    }
  } catch {
    return "服务端认证配置无效：APP_ORIGIN 不是合法 URL。";
  }

  if (isProduction() && appOrigin !== PRODUCTION_APP_ORIGIN) {
    return `生产环境 APP_ORIGIN 必须精确设置为 ${PRODUCTION_APP_ORIGIN}。`;
  }

  const redirectUri = getOptionalEnv("FEISHU_REDIRECT_URI") ?? "";
  try {
    const parsed = new URL(redirectUri);
    const localHttp = parsed.protocol === "http:" && parsed.hostname === "localhost";
    if (parsed.protocol !== "https:" && !localHttp) {
      return "服务端认证配置无效：FEISHU_REDIRECT_URI 必须使用 HTTPS，localhost 开发环境除外。";
    }
  } catch {
    return "服务端认证配置无效：FEISHU_REDIRECT_URI 不是合法 URL。";
  }

  if (isProduction() && redirectUri !== PRODUCTION_FEISHU_REDIRECT_URI) {
    return `生产环境 FEISHU_REDIRECT_URI 必须精确设置为 ${PRODUCTION_FEISHU_REDIRECT_URI}。`;
  }

  if (new URL(redirectUri).origin !== appOrigin) {
    return "服务端认证配置无效：FEISHU_REDIRECT_URI 与 APP_ORIGIN 必须同源。";
  }

  return null;
}

export function assertAuthConfiguration() {
  const issue = getAuthConfigurationIssue();
  if (issue) throw new AuthConfigurationError(issue);
}

export function getSessionStorage() {
  if (storage) return storage;

  const sessionSecret = getRequiredEnv("SESSION_SECRET");
  if (sessionSecret.length < 32) {
    throw new AuthConfigurationError(
      "服务端认证配置无效：SESSION_SECRET 至少需要 32 个字符。",
    );
  }

  storage = createCookieSessionStorage<SessionData>({
    cookie: {
      name: getSessionCookieName(),
      httpOnly: true,
      maxAge: SESSION_MAX_AGE_SECONDS,
      path: "/",
      sameSite: "lax",
      secrets: [sessionSecret],
      secure: isProduction(),
    },
  });
  return storage;
}

export async function getAuthSession(request: Request) {
  return getSessionStorage().getSession(request.headers.get("Cookie"));
}

export async function commitAuthSession(
  session: Awaited<ReturnType<typeof getAuthSession>>,
) {
  return getSessionStorage().commitSession(session);
}

export async function destroyAuthSession(
  session: Awaited<ReturnType<typeof getAuthSession>>,
) {
  return getSessionStorage().destroySession(session);
}

export function getExpiredAuthCookie() {
  const secure = isProduction() ? "; Secure" : "";
  return `${getSessionCookieName()}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure}`;
}

export function getCurrentUserFromSession(
  session: Awaited<ReturnType<typeof getAuthSession>>,
): SessionUser | null {
  const id = session.get("userId");
  const feishuOpenId = session.get("feishuOpenId");
  const displayName = session.get("displayName");
  const avatarUrl = session.get("avatarUrl") ?? null;

  if (!id || !feishuOpenId || !displayName) return null;
  return { id, feishuOpenId, displayName, avatarUrl };
}

export async function getOptionalCurrentUser(request: Request) {
  return getCurrentUserFromSession(await getAuthSession(request));
}

export async function requireCurrentUser(request: Request) {
  const user = await getOptionalCurrentUser(request);
  if (user) return user;

  const url = new URL(request.url);
  const returnTo = sanitizeReturnTo(`${url.pathname}${url.search}`);
  throw redirect(`/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
}

export function setCurrentUserSession(
  session: Awaited<ReturnType<typeof getAuthSession>>,
  user: SessionUser,
) {
  session.set("userId", user.id);
  session.set("feishuOpenId", user.feishuOpenId);
  session.set("displayName", user.displayName);
  session.set("avatarUrl", user.avatarUrl);
}

export function clearOAuthSession(
  session: Awaited<ReturnType<typeof getAuthSession>>,
) {
  session.unset("oauthState");
  session.unset("oauthReturnTo");
  session.unset("pkceVerifier");
}

export function sanitizeReturnTo(value: string | null) {
  if (
    !value ||
    value.length > 2048 ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    containsControlCharacters(value)
  ) {
    return "/";
  }

  try {
    const decoded = decodeURIComponent(value);
    if (
      decoded.startsWith("//") ||
      decoded.includes("\\") ||
      containsControlCharacters(decoded)
    ) {
      return "/";
    }

    const base = new URL("https://cyber-power.invalid");
    const parsed = new URL(value, base);
    if (parsed.origin !== base.origin) return "/";
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "/";
  }
}

function containsControlCharacters(value: string) {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
}

export function stateMatches(actual: string | null, expected: string | undefined) {
  if (!actual || !expected) return false;
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return (
    actualBytes.length === expectedBytes.length &&
    timingSafeEqual(actualBytes, expectedBytes)
  );
}

function getSessionCookieName() {
  return isProduction()
    ? "__Host-cyber_power_session"
    : "cyber_power_session";
}

function isProduction() {
  return process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";
}

function getLocalEnv() {
  if (localEnv) return localEnv;

  localEnv = {};
  for (const filename of [".env.local", ".env"]) {
    const path = resolve(process.cwd(), filename);
    if (!existsSync(path)) continue;

    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const parsed = parseEnvLine(line);
      if (parsed) localEnv[parsed.key] ??= parsed.value;
    }
  }
  return localEnv;
}

function parseEnvLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;

  const separator = trimmed.indexOf("=");
  if (separator <= 0) return null;

  const key = trimmed.slice(0, separator).trim();
  let value = trimmed.slice(separator + 1).trim();
  const quote = value[0];
  if ((quote === '"' || quote === "'") && value.endsWith(quote)) {
    value = value.slice(1, -1);
  }
  return { key, value };
}
