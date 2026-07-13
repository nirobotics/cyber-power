import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const stylesheet = readFileSync(new URL("./app.css", import.meta.url), "utf8");

function occurrences(value: string) {
  return stylesheet.split(value).length - 1;
}

describe("Cyber Apps shell theme", () => {
  it("keeps the Cyber Parts light and dark shell tokens in sync", () => {
    const lightTokens = [
      "--background: #f7f7fa;",
      "--foreground: #17151f;",
      "--muted: #6b6875;",
      "--border: #dedbe7;",
      "--panel: #ffffff;",
      "--accent: #5b35d5;",
    ];
    const darkTokens = [
      "--background: #111015;",
      "--foreground: #f3f0fb;",
      "--muted: #aaa3ba;",
      "--border: #2d2938;",
      "--panel: #191720;",
      "--accent: #9b7cff;",
    ];

    for (const token of [...lightTokens, ...darkTokens]) {
      expect(occurrences(token), token).toBe(2);
    }
  });
});
