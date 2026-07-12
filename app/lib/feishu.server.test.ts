import { afterEach, describe, expect, it } from "vitest";
import {
  createFeishuAuthorizeUrl,
  createOAuthState,
  createPkceChallenge,
  createPkceVerifier,
} from "./feishu.server";
import { PRODUCTION_FEISHU_REDIRECT_URI } from "./auth.server";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
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
    process.env.FEISHU_APP_ID = "cli_test";
    process.env.FEISHU_APP_SECRET = "test-app-secret";
    process.env.FEISHU_REDIRECT_URI = PRODUCTION_FEISHU_REDIRECT_URI;
    process.env.FEISHU_AUTH_SCOPES = "contact:user.base:readonly";

    const url = createFeishuAuthorizeUrl({
      state: "state-value",
      codeChallenge: "challenge-value",
    });

    expect(url.origin).toBe("https://accounts.feishu.cn");
    expect(url.searchParams.get("client_id")).toBe("cli_test");
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
