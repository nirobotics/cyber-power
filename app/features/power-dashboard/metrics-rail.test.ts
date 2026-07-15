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

  it("labels every V2 electrical total as a whole-robot metric without duplicate prefixes", () => {
    const analysis = {
      range: { startUs: 0, endUs: 1_000_000, durationSeconds: 1 },
      totals: {
        energyWh: 1,
        averagePowerW: 30,
        peakPowerW: 40,
        peakPowerTimestampUs: 1,
        peakCurrentA: 4,
        peakCurrentTimestampUs: 1,
        brownoutCount: 0,
        brownoutDurationSeconds: 0,
        enabledDurationSeconds: 1,
        effectiveDurationSeconds: 1,
      },
      subsystems: [],
    } as unknown as RangeAnalysis;

    const markup = renderToStaticMarkup(createElement(MetricsRail, {
      analysis,
      sourceContract: "v2",
      onLocatePeakPower: () => undefined,
      onLocatePeakCurrent: () => undefined,
    }));

    expect(markup).toContain("整机能量");
    expect(markup).toContain("整机平均功率");
    expect(markup).toContain("整机峰值功率");
    expect(markup).toContain("整机峰值电流");
    expect(markup).toContain('aria-label="定位整机峰值功率时间"');
    expect(markup).toContain('aria-label="定位整机峰值电流时间"');
    expect(markup).not.toContain("整机整机");
  });
});
