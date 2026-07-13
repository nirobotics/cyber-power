import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { RangeAnalysis } from "../log-analysis/core";
import { MetricsRail } from "./metrics-rail";

describe("MetricsRail", () => {
  it("renders the effective duration supplied by the analysis layer", () => {
    const analysis = {
      range: { startUs: 0, endUs: 120_000_000, durationSeconds: 120 },
      totals: {
        energyWh: 1,
        averagePowerW: 30,
        peakPowerW: 40,
        peakPowerTimestampUs: 1,
        peakCurrentA: 4,
        peakCurrentTimestampUs: 1,
        brownoutCount: 0,
        brownoutDurationSeconds: 0,
        enabledDurationSeconds: 75,
        effectiveDurationSeconds: 75,
      },
      subsystems: [],
    } as unknown as RangeAnalysis;

    const markup = renderToStaticMarkup(createElement(MetricsRail, {
      analysis,
      onLocatePeakPower: () => undefined,
      onLocatePeakCurrent: () => undefined,
    }));

    expect(markup).toContain("有效持续时间");
    expect(markup).toContain("1m 15.0s");
    expect(markup).not.toContain(">持续时间<");
  });
});
