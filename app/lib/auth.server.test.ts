import { afterEach, describe, expect, it } from "vitest";
import {
  getAuthConfigurationIssue,
  getSessionStorage,
  PRODUCTION_APP_ORIGIN,
  PRODUCTION_FEISHU_REDIRECT_URI,
  sanitizeReturnTo,
  stateMatches,
} from "./auth.server";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("sanitizeReturnTo", () => {
  it("keeps same-origin paths, queries, and fragments", () => {
    expect(sanitizeReturnTo("/timeline?from=1#cursor")).toBe(
      "/timeline?from=1#cursor",
    );
  });

  it.each([
    null,
    "",
    "https://evil.example/path",
    "//evil.example/path",
    "/\\evil.example/path",
    "/%5cevil.example/path",
    "/%2f%2fevil.example/path",
  ])("rejects unsafe returnTo value %s", (value) => {
    expect(sanitizeReturnTo(value)).toBe("/");
  });
});

describe("stateMatches", () => {
  it("only accepts an exact non-empty state", () => {
    expect(stateMatches("same-state", "same-state")).toBe(true);
    expect(stateMatches("same-state", "other-state")).toBe(false);
    expect(stateMatches(null, "same-state")).toBe(false);
    expect(stateMatches("same-state", undefined)).toBe(false);
  });
});

describe("authentication configuration", () => {
  it("requires the exact production callback", () => {
    setCompleteEnvironment();
    process.env.FEISHU_REDIRECT_URI = "https://example.com/auth/feishu/callback";

    expect(getAuthConfigurationIssue()).toContain(PRODUCTION_FEISHU_REDIRECT_URI);

    process.env.FEISHU_REDIRECT_URI = PRODUCTION_FEISHU_REDIRECT_URI;
    expect(getAuthConfigurationIssue()).toBeNull();
  });

  it("creates a signed 14-day secure HttpOnly cookie", async () => {
    setCompleteEnvironment();
    const session = await getSessionStorage().getSession();
    session.set("userId", "user-id");
    session.set("feishuOpenId", "open-id");
    session.set("displayName", "Test User");

    const cookie = await getSessionStorage().commitSession(session);
    expect(cookie).toContain("__Host-cyber_power_session=");
    expect(cookie).toContain("Max-Age=1209600");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Secure");
  });
});

function setCompleteEnvironment() {
  process.env.NODE_ENV = "production";
  process.env.VERCEL_ENV = "production";
  process.env.APP_ORIGIN = PRODUCTION_APP_ORIGIN;
  process.env.FEISHU_APP_ID = "cli_test";
  process.env.FEISHU_APP_SECRET = "test-app-secret";
  process.env.FEISHU_REDIRECT_URI = PRODUCTION_FEISHU_REDIRECT_URI;
  process.env.FEISHU_ALLOWED_TENANT_KEY = "tenant_test";
  process.env.SESSION_SECRET = "0123456789abcdef0123456789abcdef";
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SECRET_KEY = "sb_secret_test";
}
