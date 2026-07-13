import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SupplyLimitEstimate } from "../log-analysis/core";
import {
  findSupplyLimitHierarchyConflicts,
  orderSupplyLimitTargets,
  parseSupplyLimitDraftValue,
  SupplyLimitSimulator,
  type SupplyLimitDraft,
  type SupplyLimitSimulatorProps,
  type SupplyLimitTargetOption,
} from "./supply-limit-simulator";

const targets: SupplyLimitTargetOption[] = [
  {
    id: "swerve",
    rawPath: "swerve/",
    parentId: null,
    depth: 0,
    childrenIds: ["swerve/moduleFL"],
    peakCurrentA: 180,
    energyWh: 40,
  },
  {
    id: "swerve/moduleFL",
    rawPath: "swerve/moduleFL",
    parentId: "swerve",
    depth: 1,
    childrenIds: [],
    peakCurrentA: 60,
    energyWh: 10,
  },
  {
    id: "indexer",
    rawPath: "indexer",
    parentId: null,
    depth: 0,
    childrenIds: [],
    peakCurrentA: 120,
    energyWh: 8,
  },
];

const callbacks = {
  onSimulationEnabledChange: () => undefined,
  onAddTarget: () => undefined,
  onUpdateDraft: () => undefined,
  onRemoveTarget: () => undefined,
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

describe("orderSupplyLimitTargets", () => {
  it("places children immediately after their parent instead of grouping by depth", () => {
    expect(orderSupplyLimitTargets(targets).map((target) => target.id)).toEqual([
      "indexer",
      "swerve",
      "swerve/moduleFL",
    ]);
  });
});

describe("findSupplyLimitHierarchyConflicts", () => {
  it("rejects an enabled ancestor and descendant but ignores disabled rows", () => {
    expect(findSupplyLimitHierarchyConflicts(targets, [
      { nodeId: "swerve", enabled: true },
      { nodeId: "swerve/moduleFL", enabled: true },
      { nodeId: "indexer", enabled: true },
    ])).toEqual([{ ancestorId: "swerve", descendantId: "swerve/moduleFL" }]);

    expect(findSupplyLimitHierarchyConflicts(targets, [
      { nodeId: "swerve", enabled: true },
      { nodeId: "swerve/moduleFL", enabled: false },
    ])).toEqual([]);
  });

  it("does not invent a conflict for independent top-level terminal groups", () => {
    expect(findSupplyLimitHierarchyConflicts(targets, [
      { nodeId: "indexer", enabled: true },
      { nodeId: "swerve/moduleFL", enabled: true },
    ])).toEqual([]);
  });

  it("terminates safely when malformed target metadata contains a parent cycle", () => {
    const cyclic: SupplyLimitTargetOption[] = [
      { ...targets[0], id: "a", rawPath: "a", parentId: "b" },
      { ...targets[1], id: "b", rawPath: "b", parentId: "a" },
    ];
    expect(() => findSupplyLimitHierarchyConflicts(cyclic, [
      { nodeId: "a", enabled: true },
    ])).not.toThrow();
  });
});

describe("parseSupplyLimitDraftValue", () => {
  it("accepts finite nonnegative limits and rejects empty, negative, or nonfinite input", () => {
    expect(parseSupplyLimitDraftValue("0")).toBe(0);
    expect(parseSupplyLimitDraftValue(" 42.5 ")).toBe(42.5);
    expect(parseSupplyLimitDraftValue("")).toBeNull();
    expect(parseSupplyLimitDraftValue("-1")).toBeNull();
    expect(parseSupplyLimitDraftValue("Infinity")).toBeNull();
    expect(parseSupplyLimitDraftValue("not-a-number")).toBeNull();
  });
});

describe("SupplyLimitSimulator", () => {
  it("renders the streamlined editor, accessible controls, and bottom help", () => {
    const markup = renderSimulator();

    expect(markup).toContain("限流模拟");
    expect(markup).toContain('role="switch"');
    expect(markup).toContain('aria-checked="false"');
    expect(markup).toContain('aria-label="清空限流模拟"');
    expect(markup).toContain('aria-describedby="supply-limit-help-content"');
    expect(markup).toContain('role="tooltip"');
    expect(markup).toContain("合计 Supply Current 上限");
    expect(markup).toContain("Stator Current");
    expect(markup).not.toContain("多子系统 Supply 电流限流方案");
    expect(markup).not.toContain("个启用目标");
    expect(markup).not.toContain("添加限流目标");
    expect(markup).not.toContain("搜索 EnergyLogger 路径");
    expect(markup).not.toContain("搜索并添加一个或多个");
    expect(markup).not.toContain("撤销未应用修改");
    expect(markup).not.toContain("应用方案");
    expect(markup).not.toContain("清空方案");
  });

  it("shows every available target without the old twelve-item search limit", () => {
    const manyTargets = Array.from({ length: 14 }, (_, index): SupplyLimitTargetOption => ({
      id: `motor-${index}`,
      rawPath: `motor-${index}`,
      parentId: null,
      depth: 0,
      childrenIds: [],
      peakCurrentA: index + 1,
      energyWh: index + 1,
    }));

    const markup = renderSimulator({ targets: manyTargets });
    expect(markup).toContain("motor-0");
    expect(markup).toContain("motor-13");
    expect(markup).not.toContain("当前显示前 12 项");
  });

  it("treats a root node without children as a directly configurable motor group", () => {
    const draftLimits: SupplyLimitDraft[] = [{
      nodeId: "indexer",
      enabled: true,
      limitText: "80",
      aggregateConfirmed: false,
    }];
    const markup = renderSimulator({ draftLimits });

    expect(markup).toContain("顶层终端电机组");
    expect(markup).toContain("可直接估算");
    expect(markup).toContain('value="80"');
    expect(markup).toContain("预计会触发");
    expect(markup).not.toContain("确认该聚合路径代表同构电机组");
  });

  it("shows aggregate confirmation and blocks the master switch on parent-child conflicts", () => {
    const draftLimits: SupplyLimitDraft[] = [
      { nodeId: "swerve", enabled: true, limitText: "100", aggregateConfirmed: false },
      { nodeId: "swerve/moduleFL", enabled: true, limitText: "40", aggregateConfirmed: false },
    ];
    const markup = renderSimulator({ draftLimits });

    expect(markup).toContain("确认该聚合路径代表同构电机组");
    expect(markup).toContain("需要修正");
    expect(markup).toContain("不能同时模拟");
    expect(markup).toContain("存在祖先与后代重复计算冲突");
    expect(markup).toMatch(/role="switch"[^>]*disabled=""/);
  });

  it("keeps disabled row values while the master simulation is off", () => {
    const markup = renderSimulator({
      draftLimits: [{
        nodeId: "indexer",
        enabled: false,
        limitText: "40",
        aggregateConfirmed: false,
      }],
      estimate: buildEstimate(),
      simulationEnabled: false,
    });

    expect(markup).toContain('value="40"');
    expect(markup).toContain("未启用");
    expect(markup).not.toContain("限流模拟报告");
  });

  it("shows current validation errors without rendering a stale report", () => {
    const markup = renderSimulator({
      draftLimits: [{
        nodeId: "indexer",
        enabled: true,
        limitText: "invalid",
        aggregateConfirmed: false,
      }],
      errors: [{ nodeId: "indexer", message: "请输入有效电流。" }],
      estimate: null,
      simulationEnabled: true,
    });

    expect(markup).toContain('aria-checked="true"');
    expect(markup).toContain("请输入有效电流。");
    expect(markup.match(/请输入有效电流。/g)).toHaveLength(1);
    expect(markup).not.toContain("限流模拟报告");
  });

  it("does not label valid rows as actively simulated until a current report exists", () => {
    const markup = renderSimulator({
      draftLimits: [{
        nodeId: "indexer",
        enabled: true,
        limitText: "80",
        aggregateConfirmed: false,
      }],
      estimate: null,
      simulationEnabled: true,
    });

    expect(markup).toContain("预计会触发");
    expect(markup).not.toContain("模拟中");
  });

  it("renders the live report without target-selection buttons or charts", () => {
    const estimate = buildEstimate();
    const markup = renderSimulator({
      draftLimits: [{
        nodeId: "indexer",
        enabled: true,
        limitText: "80",
        aggregateConfirmed: false,
      }],
      estimate,
      simulationEnabled: true,
    });

    expect(markup).toContain('aria-checked="true"');
    expect(markup).toContain("限流模拟报告");
    expect(markup).toContain("整机总能量");
    expect(markup).toContain("40.000 Wh");
    expect(markup).toContain("38.000 Wh");
    expect(markup).toContain("预计节省能量");
    expect(markup).toContain("模拟中");
    expect(markup).toContain("120.0 → 80.0 A");
    expect(markup).toContain("<details");
    expect(markup).toContain("累计能量发生重置，已分段估算。");
    expect(markup).not.toContain("查看indexer");
    expect(markup).not.toContain("限流估算整机总电流时间图");
  });
});

function buildEstimate() {
  return {
    limits: [{ nodeId: "indexer", limitA: 80, enabled: true }],
    range: { startUs: 0, endUs: 10_000_000 },
    targets: [{
      nodeId: "indexer",
      rawPath: "indexer",
      limitA: 80,
      kind: "terminal",
      baseline: { energyWh: 8, averagePowerW: 300, peakPowerW: 1_200, peakCurrentA: 120 },
      estimated: { energyWh: 6, averagePowerW: 220, peakPowerW: 800, peakCurrentA: 80 },
      energySavedWh: 2,
      energySavedPercent: 25,
      clippedDurationSeconds: 3,
      clippedRangeFraction: 0.3,
      ampSecondsRemoved: 40,
      warnings: [{ code: "SOURCE_ENERGY_RESET", message: "累计能量发生重置，已分段估算。" }],
    }],
    totals: {
      baseline: { energyWh: 40, averagePowerW: 1_000, peakPowerW: 3_000, peakCurrentA: 300 },
      estimated: { energyWh: 38, averagePowerW: 920, peakPowerW: 2_600, peakCurrentA: 260 },
      energySavedWh: 2,
      energySavedPercent: 5,
      clippedUnionDurationSeconds: 3,
      clippedDurationSumSeconds: 3,
      activeTargetCount: 1,
      robotEstimateAvailable: true,
    },
    timeline: {},
    warnings: [{ code: "CONFIRMED_AGGREGATE", message: "历史动作时长保持不变。" }],
  } as unknown as SupplyLimitEstimate;
}
