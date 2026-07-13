import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFeishuAuthorizeUrl,
  createOAuthState,
  createPkceChallenge,
  createPkceVerifier,
  exchangeFeishuOAuthCode,
  getFeishuUserInfo,
  upsertUserProfile,
} from "./feishu.server";
import { PRODUCTION_FEISHU_REDIRECT_URI } from "./auth.server";
import { getSupabaseServiceClient } from "./supabase.server";

vi.mock("./supabase.server", () => ({
  getSupabaseServiceClient: vi.fn(),
}));

const originalEnv = { ...process.env };
const TEST_ENV = {
  FEISHU_APP_ID: "cli_unit_test",
  FEISHU_APP_SECRET: "not-a-real-app-secret",
  FEISHU_REDIRECT_URI: PRODUCTION_FEISHU_REDIRECT_URI,
  FEISHU_ALLOWED_TENANT_KEY: "tenant_allowed",
};
const mockedGetSupabaseServiceClient = vi.mocked(getSupabaseServiceClient);

beforeEach(() => {
  Object.assign(process.env, TEST_ENV);
});

afterEach(() => {
  process.env = { ...originalEnv };
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.resetAllMocks();
});

describe("PKCE", () => {
  it("uses the RFC 7636 S256 base64url encoding", () => {
    expect(
      createPkceChallenge(
        "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
      ),
    ).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("creates high-entropy base64url state and verifier values", () => {
    const state = createOAuthState();
    const verifier = createPkceVerifier();

    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(state).not.toBe(verifier);
  });
});

describe("createFeishuAuthorizeUrl", () => {
  it("includes state and PKCE without exposing the app secret", () => {
    process.env.FEISHU_AUTH_SCOPES = "contact:user.base:readonly";

    const url = createFeishuAuthorizeUrl({
      state: "state-value",
      codeChallenge: "challenge-value",
    });

    expect(url.origin).toBe("https://accounts.feishu.cn");
    expect(url.searchParams.get("client_id")).toBe(TEST_ENV.FEISHU_APP_ID);
    expect(url.searchParams.get("redirect_uri")).toBe(
      PRODUCTION_FEISHU_REDIRECT_URI,
    );
    expect(url.searchParams.get("state")).toBe("state-value");
    expect(url.searchParams.get("code_challenge")).toBe("challenge-value");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")).toBe("contact:user.base:readonly");
    expect(url.toString()).not.toContain(process.env.FEISHU_APP_SECRET);
  });
});

describe("exchangeFeishuOAuthCode", () => {
  it("posts the complete authorization-code request and returns the access token", async () => {
    const fetchMock = stubFetch({ code: 0, access_token: "access-token" });

    await expect(
      exchangeFeishuOAuthCode({
        code: "authorization-code",
        codeVerifier: "pkce-verifier",
      }),
    ).resolves.toBe("access-token");

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://open.feishu.cn/open-apis/authen/v2/oauth/token");
    expect(init).toEqual(
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        signal: expect.any(AbortSignal),
      }),
    );
    expect(JSON.parse(String(init?.body))).toEqual({
      grant_type: "authorization_code",
      client_id: TEST_ENV.FEISHU_APP_ID,
      client_secret: TEST_ENV.FEISHU_APP_SECRET,
      code: "authorization-code",
      redirect_uri: TEST_ENV.FEISHU_REDIRECT_URI,
      code_verifier: "pkce-verifier",
    });
  });

  it.each([
    {
      name: "non-success HTTP status",
      status: 401,
      body: { code: 0, access_token: "ignored-token" },
    },
    {
      name: "Feishu error code",
      status: 200,
      body: { code: 20001, access_token: "ignored-token" },
    },
    {
      name: "missing access token",
      status: 200,
      body: { code: 0 },
    },
  ])("rejects a $name response", async ({ status, body }) => {
    stubFetch(body, status);

    await expect(
      exchangeFeishuOAuthCode({
        code: "authorization-code",
        codeVerifier: "pkce-verifier",
      }),
    ).rejects.toMatchObject({
      name: "FeishuAuthError",
      code: "token_exchange_failed",
    });
  });
});

describe("getFeishuUserInfo", () => {
  it("maps a successful response and authenticates with the access token", async () => {
    const userInfo = {
      open_id: "open-id",
      union_id: "union-id",
      tenant_key: TEST_ENV.FEISHU_ALLOWED_TENANT_KEY,
      name: "Test User",
      en_name: "Test User EN",
      avatar_url: "https://example.test/avatar.png",
    };
    const fetchMock = stubFetch({ code: 0, data: userInfo });

    await expect(getFeishuUserInfo("access-token")).resolves.toEqual(userInfo);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://open.feishu.cn/open-apis/authen/v1/user_info",
      expect.objectContaining({
        headers: { Authorization: "Bearer access-token" },
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("rejects a user from a different tenant", async () => {
    stubFetch({
      code: 0,
      data: {
        open_id: "open-id",
        tenant_key: "tenant_not_allowed",
        name: "External User",
      },
    });

    await expect(getFeishuUserInfo("access-token")).rejects.toMatchObject({
      name: "FeishuAuthError",
      code: "unauthorized_tenant",
    });
  });
});

describe("upsertUserProfile", () => {
  it("upserts the expected profile and maps the stored row to SessionUser", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-13T01:02:03.000Z"));
    const database = stubSupabaseUpsert({
      data: {
        id: "profile-id",
        feishu_open_id: "open-id",
        display_name: "Test User",
        avatar_url: "https://example.test/avatar.png",
      },
      error: null,
    });

    await expect(
      upsertUserProfile({
        open_id: "open-id",
        tenant_key: TEST_ENV.FEISHU_ALLOWED_TENANT_KEY,
        name: "Test User",
        avatar_url: "https://example.test/avatar.png",
      }),
    ).resolves.toEqual({
      id: "profile-id",
      feishuOpenId: "open-id",
      displayName: "Test User",
      avatarUrl: "https://example.test/avatar.png",
    });

    expect(database.from).toHaveBeenCalledWith("user_profiles");
    expect(database.upsert).toHaveBeenCalledWith(
      {
        feishu_open_id: "open-id",
        display_name: "Test User",
        avatar_url: "https://example.test/avatar.png",
        last_login_at: "2026-07-13T01:02:03.000Z",
      },
      { onConflict: "feishu_open_id" },
    );
    expect(database.select).toHaveBeenCalledWith(
      "id, feishu_open_id, display_name, avatar_url",
    );
    expect(database.single).toHaveBeenCalledOnce();
  });

  it.each([
    {
      name: "database error",
      result: { data: null, error: { message: "write failed" } },
    },
    {
      name: "missing returned row",
      result: { data: null, error: null },
    },
  ])("rejects a $name", async ({ result }) => {
    stubSupabaseUpsert(result);

    await expect(
      upsertUserProfile({ open_id: "open-id", name: "Test User" }),
    ).rejects.toMatchObject({
      name: "FeishuAuthError",
      code: "profile_upsert_failed",
    });
  });
});

function stubFetch(body: unknown, status = 200) {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function stubSupabaseUpsert(result: { data: unknown; error: unknown }) {
  const single = vi.fn().mockResolvedValue(result);
  const select = vi.fn(() => ({ single }));
  const upsert = vi.fn(() => ({ select }));
  const from = vi.fn(() => ({ upsert }));
  mockedGetSupabaseServiceClient.mockReturnValue({ from } as never);
  return { from, upsert, select, single };
}
