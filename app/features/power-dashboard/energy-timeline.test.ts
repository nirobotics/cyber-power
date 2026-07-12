import { describe, expect, it } from "vitest";
import type { NumericSeries } from "../log-analysis/core";
import { seriesPairs } from "./energy-timeline";

function numeric(values: number[]): NumericSeries {
  return {
    timestampsUs: Float64Array.from(values, (_value, index) => index * 1_000_000),
    values: Float64Array.from(values),
    unit: "W",
    entryName: "test",
  };
}

describe("timeline downsampling", () => {
  it("keeps every point when the series is below the display limit", () => {
    expect(seriesPairs(numeric([1, 2, 3]), 4)).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
    ]);
  });

  it("preserves bucket extrema and chronological order", () => {
    const pairs = seriesPairs(numeric([0, 2, 50, -20, 3, 4, -40, 75, 6, 0]), 6);
    const values = pairs.map((pair) => pair[1]);

    expect(pairs).toHaveLength(6);
    expect(values).toEqual([0, 50, -20, -40, 75, 0]);
    expect(pairs.map((pair) => pair[0])).toEqual([...pairs.map((pair) => pair[0])].sort((a, b) => a - b));
  });
});
