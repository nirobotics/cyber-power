import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SupplyLimitEstimate } from "../log-analysis/core";
import {
  buildSupplyLimitTableRows,
  parseSupplyLimitDraftValue,
  SupplyLimitSimulator,
  type SupplyLimitDraft,
  type SupplyLimitSimulatorProps,
  type SupplyLimitTargetOption,
} from "./supply-limit-simulator";

const targets: SupplyLimitTargetOption[] = [
  {
    id: "s0/frontLeft",
    subsystemId: "s0",
    subsystemName: "drive",
    leaderName: "frontLeft",
    motorNames: ["frontLeft", "frontRight"],
    motorType: "NEO",
    motorCount: 2,
    peakCurrentA: 180,
    peakPowerW: 2_000,
    averagePowerW: 500,
    energyWh: 40,
    robotPositiveInputRatio: 0.8,
  },
  {
    id: "s1/belt",
    subsystemId: "s1",
    subsystemName: "indexer",
    leaderName: "belt",
    motorNames: ["belt"],
    motorType: "NEO",
    motorCount: 1,
    peakCurrentA: 120,
    peakPowerW: 1_200,
    averagePowerW: 200,
    energyWh: 8,
    robotPositiveInputRatio: 0.16,
  },
];

const callbacks = {
  onSimulationEnabledChange: () => undefined,
  onUpdateDraft: () => undefined,
  onClear: () => undefined,
};

function renderSimulator(overrides: Partial<SupplyLimitSimulatorProps> = {}) {
  return renderToStaticMarkup(createElement(SupplyLimitSimulator, {
    targets,
    draftLimits: [],
    errors: [],
    estimate: null,
    simulationEnabled: false,
    ...callbacks,
    ...overrides,
  }));
}

describe("buildSupplyLimitTableRows", () => {
  it("sorts flat Manifest motor groups by energy", () => {
    expect(buildSupplyLimitTableRows([...targets].reverse()).map((target) => target.id))
      .toEqual(["s0/frontLeft", "s1/belt"]);
  });
});

describe("parseSupplyLimitDraftValue", () => {
  it("accepts finite nonnegative limits and rejects invalid values", () => {
    expect(parseSupplyLimitDraftValue("0")).toBe(0);
    expect(parseSupplyLimitDraftValue(" 42.5 ")).toBe(42.5);
    expect(parseSupplyLimitDraftValue("")).toBeNull();
    expect(parseSupplyLimitDraftValue("-1")).toBeNull();
    expect(parseSupplyLimitDraftValue("Infinity")).toBeNull();
  });
});

describe("SupplyLimitSimulator", () => {
  it("renders a flat Leader-group editor with follower context and accessible controls", () => {
    const markup = renderSimulator();
    expect(markup).toContain('aria-label="限流模拟配置"');
    expect(markup).not.toContain('id="supply-limit-editor-title"');
    expect(markup).toContain(">明细</h2>");
    expect(markup).toContain('aria-label="限流模拟电机组表"');
    expect(markup).toContain('aria-label="清空限流模拟"');
    expect(markup).toContain("drive/frontLeft");
    expect(markup).toContain("frontRight");
    expect(markup).toContain("indexer/belt");
    expect(markup).toMatch(/电机组[\s\S]*电机型号[\s\S]*数量[\s\S]*能量[\s\S]*相对整机正向输入[\s\S]*平均功率[\s\S]*峰值功率[\s\S]*峰值电流[\s\S]*电机组 Supply 限流值[\s\S]*启用/);
    expect(markup).toContain("Leader 与其全部 Followers 的合计 Supply Current 上限");
    expect(markup).toContain("各行比值不可相加，合计也可能超过 100%");
    expect(markup).not.toContain("确认同构电机组");
    expect(markup).not.toContain("聚合节点");
    expect(markup).not.toContain("下级已启用");
    expect(markup).not.toContain("父子");
    expect(markup).not.toContain("text-right");
    expect(markup).not.toContain("text-center");
  });

  it("shows every available motor group", () => {
    const manyTargets = Array.from({ length: 14 }, (_, index): SupplyLimitTargetOption => ({
      ...targets[1],
      id: `s${index}/motor${index}`,
      subsystemId: `s${index}`,
      subsystemName: `subsystem${index}`,
      leaderName: `motor${index}`,
      motorNames: [`motor${index}`],
      energyWh: index,
    }));
    const markup = renderSimulator({ targets: manyTargets });
    expect(markup).toContain("subsystem0/motor0");
    expect(markup).toContain("subsystem13/motor13");
  });

  it("keeps parked row values while the master simulation is off", () => {
    const draftLimits: SupplyLimitDraft[] = [{
      motorGroupId: "s1/belt",
      enabled: false,
      limitText: "40",
    }];
    const markup = renderSimulator({ draftLimits, simulationEnabled: false });
    expect(markup).toMatch(/id="supply-limit-s1\/belt"[^>]*value="40"/);
    expect(markup).not.toContain('id="supply-limit-results-title"');
  });

  it("disables an unavailable group without hiding it", () => {
    const unavailable = {
      ...targets[1],
      unavailableReason: "该电机组没有完整的 Supply Current 区间。",
    };
    const markup = renderSimulator({ targets: [unavailable] });
    expect(markup).toContain(unavailable.unavailableReason);
    expect(markup).toMatch(/id="supply-limit-s1\/belt"[^>]*disabled=""/);
    expect(markup).toMatch(/aria-label="启用indexer\/belt限流"[^>]*disabled=""/);
  });

  it("renders an explicit V1 degradation instead of an empty editable table", () => {
    const reason = "当前 V1 日志没有电机 Manifest，无法按 Leader 电机组进行限流模拟。";
    const markup = renderSimulator({ targets: [], unavailableReason: reason });
    expect(markup).toContain(reason);
    expect(markup).not.toContain('aria-label="限流模拟电机组表"');
    expect(markup).toMatch(/role="switch"[^>]*disabled=""/);
  });

  it("shows active row validation once and hides stale reports", () => {
    const markup = renderSimulator({
      draftLimits: [{ motorGroupId: "s1/belt", enabled: true, limitText: "invalid" }],
      errors: [{ motorGroupId: "s1/belt", message: "请输入有效电流。" }],
      simulationEnabled: true,
    });
    expect(markup.match(/请输入有效电流。/g)).toHaveLength(1);
    expect(markup).not.toContain('id="supply-limit-results-title"');
  });

  it("renders a report by motor group without charts", () => {
    const markup = renderSimulator({
      draftLimits: [{ motorGroupId: "s1/belt", enabled: true, limitText: "80" }],
      estimate: buildEstimate(),
      simulationEnabled: true,
    });
    expect(markup).toMatch(/id="supply-limit-results-title"[^>]*>报告<\/h2>/);
    expect(markup).toContain("indexer/belt");
    expect(markup).toContain("120.0 → 80.0 A");
    expect(markup).toContain("整机总能量");
    expect(markup.match(/indexer\/belt 在当前范围内没有超过 80 A。/g)).toHaveLength(1);
    expect(markup).not.toContain("<canvas");
    expect(markup).not.toContain("限流估算整机总电流时间图");
  });
});

function buildEstimate() {
  return {
    limits: [{ motorGroupId: "s1/belt", limitA: 80, enabled: true }],
    range: { startUs: 0, endUs: 10_000_000, durationSeconds: 10 },
    targets: [{
      motorGroupId: "s1/belt",
      subsystemId: "s1",
      subsystemName: "indexer",
      leaderName: "belt",
      motorNames: ["belt"],
      motorType: "NEO",
      motorCount: 1,
      limitA: 80,
      baseline: { energyWh: 8, averagePowerW: 300, peakPowerW: 1_200, peakPowerTimestampUs: 1, peakCurrentA: 120, peakCurrentTimestampUs: 1 },
      estimated: { energyWh: 6, averagePowerW: 220, peakPowerW: 800, peakPowerTimestampUs: 1, peakCurrentA: 80, peakCurrentTimestampUs: 1 },
      energySavedWh: 2,
      energySavedPercent: 25,
      clippedDurationSeconds: 3,
      clippedRangeFraction: 0.3,
      ampSecondsRemoved: 40,
      warnings: [{
        code: "LIMIT_NOT_TRIGGERED",
        message: "indexer/belt 在当前范围内没有超过 80 A。",
        motorGroupId: "s1/belt",
      }],
    }],
    totals: {
      baseline: { energyWh: 40, averagePowerW: 1_000, peakPowerW: 3_000, peakPowerTimestampUs: 1, peakCurrentA: 300, peakCurrentTimestampUs: 1 },
      estimated: { energyWh: 38, averagePowerW: 920, peakPowerW: 2_600, peakPowerTimestampUs: 1, peakCurrentA: 260, peakCurrentTimestampUs: 1 },
      energySavedWh: 2,
      energySavedPercent: 5,
      clippedUnionDurationSeconds: 3,
      clippedDurationSumSeconds: 3,
      activeTargetCount: 1,
      robotEstimateAvailable: true,
    },
    warnings: [{
      code: "LIMIT_NOT_TRIGGERED",
      message: "indexer/belt 在当前范围内没有超过 80 A。",
      motorGroupId: "s1/belt",
    }],
  } as SupplyLimitEstimate;
}
