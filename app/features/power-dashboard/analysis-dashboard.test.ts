import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dashboardPageTitle } from "./analysis-dashboard";

const dashboardSource = readFileSync(new URL("./analysis-dashboard.tsx", import.meta.url), "utf8");

describe("dashboardPageTitle", () => {
  it("uses the active navigation label and cyber-power suffix", () => {
    expect(dashboardPageTitle("robot")).toBe("整机 | cyber-power");
    expect(dashboardPageTitle("subsystems")).toBe("子系统 | cyber-power");
    expect(dashboardPageTitle("quality")).toBe("数据质量 | cyber-power");
  });
});

describe("peak location", () => {
  it("updates the shared cursor without changing the active navigation tab", () => {
    const start = dashboardSource.indexOf("const locatePeak = useCallback");
    const end = dashboardSource.indexOf("const displayedCursorUs", start);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const handler = dashboardSource.slice(start, end);
    expect(handler).toContain("setCursorUs(timestampUs)");
    expect(handler).toContain("setFocus(kind)");
    expect(handler).not.toContain("setTab(");
  });
});

describe("multi-target supply limit scenario", () => {
  it("finishes validation and estimation before replacing the applied scenario", () => {
    const start = dashboardSource.indexOf("const applySupplyLimitScenario = useCallback");
    const end = dashboardSource.indexOf("const revertSupplyLimitDrafts", start);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const handler = dashboardSource.slice(start, end);
    expect(handler.indexOf("validateSupplyCurrentLimits")).toBeLessThan(
      handler.indexOf("estimateSupplyCurrentLimits"),
    );
    expect(handler.indexOf("estimateSupplyCurrentLimits")).toBeLessThan(
      handler.indexOf("setAppliedSupplyScenario"),
    );
    expect(handler).toContain("cachedEstimate: estimate");
    expect(handler).toContain("已保留上一次成功应用的方案");
  });

  it("keeps old estimate errors separate from draft errors", () => {
    expect(dashboardSource).toContain("errors={supplyLimitErrors}");
    expect(dashboardSource).toContain("estimateErrors={supplyEstimateState.errors}");
  });
});
