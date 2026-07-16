import { describe, expect, it } from "vitest";
import { loader } from "./api.version";

describe("GET /api/version", () => {
  it("returns the product version without requiring authentication", async () => {
    const response = loader();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ version: __APP_VERSION__ });
  });
});
