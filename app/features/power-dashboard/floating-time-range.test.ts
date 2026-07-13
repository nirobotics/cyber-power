import { describe, expect, it } from "vitest";
import { roundMicroseconds } from "./floating-time-range";
import { formatBytes } from "./format";

describe("floating time range precision", () => {
  it("rounds every emitted timestamp to an integer microsecond", () => {
    expect(roundMicroseconds(12.49)).toBe(12);
    expect(roundMicroseconds(12.5)).toBe(13);
    expect(roundMicroseconds(Number.NaN)).toBe(0);
  });
});

describe("formatBytes", () => {
  it("uses a Chinese fallback for an unknown size", () => {
    expect(formatBytes(undefined)).toBe("未知大小");
    expect(formatBytes(Number.NaN)).toBe("未知大小");
  });
});
