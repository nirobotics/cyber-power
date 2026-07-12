import { createHash, randomBytes } from "node:crypto";
import type { SessionUser } from "./auth-types";
import {
  getOptionalEnv,
  getRequiredEnv,
} from "./auth.server";
import { getSupabaseServiceClient } from "./supabase.server";

const FEISHU_AUTHORIZE_URL =
  "https://accounts.feishu.cn/open-apis/authen/v1/authorize";
const FEISHU_TOKEN_URL = "https://open.feishu.cn/open-apis/authen/v2/oauth/token";
const FEISHU_USER_INFO_URL =
  "https://open.feishu.cn/open-apis/authen/v1/user_info";
const FEISHU_REQUEST_TIMEOUT_MS = 10_000;

export type FeishuUserInfo = {
  open_id: string;
  union_id?: string;
  tenant_key?: string;
  name?: string;
  en_name?: string;
  avatar_url?: string;
  avatar_thumb?: string;
  avatar_middle?: string;
  avatar_big?: string;
};

export class FeishuAuthError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "FeishuAuthError";
  }
}

export function createOAuthState() {
  return randomBytes(32).toString("base64url");
}

export function createPkceVerifier() {
  return randomBytes(32).toString("base64url");
}

export function createPkceChallenge(verifier: string) {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function createFeishuAuthorizeUrl({
  state,
  codeChallenge,
}: {
  state: string;
  codeChallenge: string;
}) {
  const url = new URL(FEISHU_AUTHORIZE_URL);
  url.searchParams.set("client_id", getRequiredEnv("FEISHU_APP_ID"));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", getRequiredEnv("FEISHU_REDIRECT_URI"));
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");

  const scope = getOptionalEnv("FEISHU_AUTH_SCOPES");
  if (scope) url.searchParams.set("scope", scope);
  return url;
}

export async function exchangeFeishuOAuthCode({
  code,
  codeVerifier,
}: {
  code: string;
  codeVerifier: string;
}) {
  const response = await fetch(FEISHU_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: getRequiredEnv("FEISHU_APP_ID"),
      client_secret: getRequiredEnv("FEISHU_APP_SECRET"),
      code,
      redirect_uri: getRequiredEnv("FEISHU_REDIRECT_URI"),
      code_verifier: codeVerifier,
    }),
    signal: AbortSignal.timeout(FEISHU_REQUEST_TIMEOUT_MS),
  });

  const payload = await readJson<{
    code?: number;
    access_token?: string;
  }>(response);
  if (!response.ok || payload?.code !== 0 || !payload.access_token) {
    throw new FeishuAuthError("飞书授权失败，请重新登录。", "token_exchange_failed");
  }
  return payload.access_token;
}

export async function getFeishuUserInfo(accessToken: string): Promise<FeishuUserInfo> {
  const response = await fetch(FEISHU_USER_INFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(FEISHU_REQUEST_TIMEOUT_MS),
  });
  const payload = await readJson<{
    code?: number;
    data?: FeishuUserInfo;
  }>(response);

  if (!response.ok || payload?.code !== 0 || !payload.data?.open_id) {
    throw new FeishuAuthError("飞书用户身份读取失败，请重新登录。", "user_info_failed");
  }

  assertAllowedTenant(payload.data);
  return payload.data;
}

export async function upsertUserProfile(
  userInfo: FeishuUserInfo,
): Promise<SessionUser> {
  const displayName = userInfo.name || userInfo.en_name || userInfo.open_id;
  const avatarUrl =
    userInfo.avatar_url ||
    userInfo.avatar_big ||
    userInfo.avatar_middle ||
    userInfo.avatar_thumb ||
    null;

  const { data, error } = await getSupabaseServiceClient()
    .from("user_profiles")
    .upsert(
      {
        feishu_open_id: userInfo.open_id,
        display_name: displayName,
        avatar_url: avatarUrl,
        last_login_at: new Date().toISOString(),
      },
      { onConflict: "feishu_open_id" },
    )
    .select("id, feishu_open_id, display_name, avatar_url")
    .single();

  if (error || !data) {
    throw new FeishuAuthError(
      "登录身份保存失败，请稍后重试。",
      "profile_upsert_failed",
    );
  }

  return {
    id: String(data.id),
    feishuOpenId: String(data.feishu_open_id),
    displayName: String(data.display_name),
    avatarUrl: data.avatar_url ? String(data.avatar_url) : null,
  };
}

function assertAllowedTenant(userInfo: FeishuUserInfo) {
  const allowedTenantKey = getRequiredEnv("FEISHU_ALLOWED_TENANT_KEY");
  if (userInfo.tenant_key !== allowedTenantKey) {
    throw new FeishuAuthError(
      "当前飞书组织无权访问 Cyber Power。",
      "unauthorized_tenant",
    );
  }
}

async function readJson<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}
