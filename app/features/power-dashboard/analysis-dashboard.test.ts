import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { AnalysisResult } from "../log-analysis/core";
import { createBatteryAnalysisCache, dashboardPageTitle } from "./analysis-dashboard";

const dashboardSource = readFileSync(new URL("./analysis-dashboard.tsx", import.meta.url), "utf8");
const subsystemShareSource = readFileSync(new URL("./subsystem-share.tsx", import.meta.url), "utf8");

describe("dashboardPageTitle", () => {
  it("uses the active navigation label and cyber-power suffix", () => {
    expect(dashboardPageTitle("robot")).toBe("整机 | cyber-power");
    expect(dashboardPageTitle("battery")).toBe("电池 | cyber-power");
    expect(dashboardPageTitle("subsystems")).toBe("子系统 | cyber-power");
    expect(dashboardPageTitle("motors")).toBe("电机 | cyber-power");
    expect(dashboardPageTitle("simulation")).toBe("模拟 | cyber-power");
    expect(dashboardPageTitle("quality")).toBe("数据质量 | cyber-power");
  });

  it("keeps the requested navigation order", () => {
    const labels = ["整机", "电池", "子系统", "电机", "模拟", "数据质量"];
    const positions = labels.map((label) => dashboardSource.indexOf(`label: "${label}"`));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
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

describe("EnergyLogger v2 sections", () => {
  it("analyzes the committed range only for subsystem and motor pages", () => {
    const analysisStart = dashboardSource.indexOf("const v2Analysis = useMemo");
    const analysisEnd = dashboardSource.indexOf("const batteryAnalysis", analysisStart);
    const block = dashboardSource.slice(analysisStart, analysisEnd);
    expect(dashboardSource).toContain(
      'const needsV2Analysis = tab === "subsystems" || tab === "motors"',
    );
    expect(block).toContain("needsV2Analysis");
    expect(block).toContain("analyzeEnergyLoggerV2Range(dataset, committedRange)");
    expect(block).toContain("[committedRange, dataset, needsV2Analysis]");
    expect(block).not.toContain("[committedRange, dataset, tab]");
  });

  it("keeps motor analysis out of the subsystem page and renders it on the motor page", () => {
    const subsystemStart = dashboardSource.indexOf('{tab === "subsystems"');
    const motorStart = dashboardSource.indexOf('{tab === "motors"');
    const simulationStart = dashboardSource.indexOf('{tab === "simulation"');
    const subsystemPanel = dashboardSource.slice(subsystemStart, motorStart);
    const motorPanel = dashboardSource.slice(motorStart, simulationStart);

    expect(subsystemStart).toBeGreaterThanOrEqual(0);
    expect(motorStart).toBeGreaterThan(subsystemStart);
    expect(simulationStart).toBeGreaterThan(motorStart);
    expect(subsystemPanel).not.toContain("V2AnalysisSections");
    expect(subsystemPanel).toContain("v2Analysis={v2Analysis}");
    expect(motorPanel).toContain("<V2AnalysisSections");
    expect(motorPanel).not.toContain("onCursorPreview={previewCursor}");
    expect(motorPanel).not.toContain("onCursorCommit={commitCursorNow}");
  });
});

describe("battery load response", () => {
  it("lazily reuses the same dataset and committed-range analysis across tab revisits", () => {
    const analysis = {
      status: "unavailable",
      reason: "V2_REQUIRED",
      limitations: [],
    } as const;
    const analyze = vi.fn(() => analysis);
    const getBatteryAnalysis = createBatteryAnalysisCache(analyze);
    const dataset = {} as AnalysisResult["dataset"];
    const range = { startUs: 1_000_000, endUs: 2_000_000 };

    expect(getBatteryAnalysis(false, dataset, range)).toBeUndefined();
    expect(analyze).not.toHaveBeenCalled();

    expect(getBatteryAnalysis(true, dataset, range)).toBe(analysis);
    expect(getBatteryAnalysis(false, dataset, range)).toBeUndefined();
    expect(getBatteryAnalysis(true, dataset, range)).toBe(analysis);
    expect(analyze).toHaveBeenCalledOnce();

    expect(getBatteryAnalysis(true, dataset, { ...range, endUs: 3_000_000 })).toBe(analysis);
    expect(analyze).toHaveBeenCalledTimes(2);
    expect(getBatteryAnalysis(true, {} as AnalysisResult["dataset"], range)).toBe(analysis);
    expect(analyze).toHaveBeenCalledTimes(3);
  });

  it("keeps the chart range aligned with the committed analysis", () => {
    expect(dashboardSource).toContain(
      'getBatteryAnalysis(tab === "battery", dataset, committedRange)',
    );
    expect(dashboardSource).toContain("<BatteryAnalysisSection");
    expect(dashboardSource).toContain("analysis={batteryAnalysis}");
    expect(dashboardSource).toContain("range={committedRange}");
    const batteryPanelStart = dashboardSource.indexOf('{tab === "battery"');
    const subsystemPanelStart = dashboardSource.indexOf('{tab === "subsystems"');
    const batteryPanel = dashboardSource.slice(batteryPanelStart, subsystemPanelStart);
    expect(batteryPanel).toContain("metrics={BATTERY_TIMELINE_METRICS}");
    expect(batteryPanel).toContain("range={previewRange}");
    expect(batteryPanel).toContain("range={committedRange}");
    const robotPanelStart = dashboardSource.indexOf('{tab === "robot"');
    expect(dashboardSource.slice(robotPanelStart, batteryPanelStart)).toContain(
      "metrics={ROBOT_OVERVIEW_METRICS}",
    );
  });
});

describe("requested section copy", () => {
  it("uses the concise subsystem energy-share title", () => {
    expect(subsystemShareSource).toContain("能量占比");
    expect(subsystemShareSource).not.toContain("子系统能量占比");
  });
});

describe("live supply limit simulation", () => {
  it("moves the report to its own navigation panel without modifying subsystem charts", () => {
    const subsystemStart = dashboardSource.indexOf('{tab === "subsystems"');
    const motorStart = dashboardSource.indexOf('{tab === "motors"');
    const simulationStart = dashboardSource.indexOf('{tab === "simulation"');
    const qualityStart = dashboardSource.indexOf('{tab === "quality"');

    expect(subsystemStart).toBeGreaterThanOrEqual(0);
    expect(motorStart).toBeGreaterThan(subsystemStart);
    expect(simulationStart).toBeGreaterThan(motorStart);
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
    expect(dashboardSource).toContain("upsertSupplyLimitDraft(current, motorGroupId, patch)");
    expect(dashboardSource).toContain('tab !== "simulation" || !dataset.v2');
    expect(dashboardSource).toContain("当前 V1 日志没有电机 Manifest");
    expect(dashboardSource).not.toContain("onAddTarget=");
    expect(dashboardSource).not.toContain("onRemoveTarget=");
  });

  it("keeps the shared time range available on the simulation page", () => {
    expect(dashboardSource).toContain(
      'tab === "robot" || tab === "battery" || tab === "subsystems" || tab === "motors" || tab === "simulation"',
    );
  });
});
