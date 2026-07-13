import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dashboardPageTitle } from "./analysis-dashboard";

const dashboardSource = readFileSync(new URL("./analysis-dashboard.tsx", import.meta.url), "utf8");

describe("dashboardPageTitle", () => {
  it("uses the active navigation label and cyber-power suffix", () => {
    expect(dashboardPageTitle("robot")).toBe("整机 | cyber-power");
    expect(dashboardPageTitle("subsystems")).toBe("子系统 | cyber-power");
    expect(dashboardPageTitle("simulation")).toBe("模拟 | cyber-power");
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

describe("live supply limit simulation", () => {
  it("moves the report to its own navigation panel without modifying subsystem charts", () => {
    const subsystemStart = dashboardSource.indexOf('{tab === "subsystems"');
    const simulationStart = dashboardSource.indexOf('{tab === "simulation"');
    const qualityStart = dashboardSource.indexOf('{tab === "quality"');

    expect(subsystemStart).toBeGreaterThanOrEqual(0);
    expect(simulationStart).toBeGreaterThan(subsystemStart);
    expect(qualityStart).toBeGreaterThan(simulationStart);
    expect(dashboardSource.slice(subsystemStart, simulationStart)).not.toContain("SupplyLimitSimulator");
    expect(dashboardSource.slice(subsystemStart, simulationStart)).toContain("SubsystemTimelines");
    expect(dashboardSource.slice(simulationStart, qualityStart)).toContain("SupplyLimitSimulator");
    expect(dashboardSource).not.toContain("SupplyLimitTimeline");
  });

  it("uses drafts as the only configuration source and estimates once when enabled", () => {
    const parseIndex = dashboardSource.indexOf("const parsed = supplyLimitDraftsToInputs");
    const enabledGuardIndex = dashboardSource.indexOf("!supplySimulationEnabled", parseIndex);

    expect(dashboardSource).toContain("supplySimulationEnabled");
    expect(dashboardSource).toContain('tab !== "simulation"');
    expect(parseIndex).toBeGreaterThanOrEqual(0);
    expect(enabledGuardIndex).toBeGreaterThan(parseIndex);
    expect(dashboardSource).toContain("onSimulationEnabledChange={setSupplySimulationEnabled}");
    expect(dashboardSource.match(/estimateSupplyCurrentLimits\(/g)).toHaveLength(1);
    expect(dashboardSource).not.toContain("AppliedSupplyLimitScenario");
    expect(dashboardSource).not.toContain("applySupplyLimitScenario");
    expect(dashboardSource).not.toContain("revertSupplyLimitDrafts");
    expect(dashboardSource).toContain("upsertSupplyLimitDraft(current, nodeId, patch)");
    expect(dashboardSource).not.toContain("onAddTarget=");
    expect(dashboardSource).not.toContain("onRemoveTarget=");
  });

  it("keeps the shared time range available on the simulation page", () => {
    expect(dashboardSource).toContain('tab === "robot" || tab === "subsystems" || tab === "simulation"');
  });
});
