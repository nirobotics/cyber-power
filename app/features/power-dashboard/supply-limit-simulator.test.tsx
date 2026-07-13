import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SupplyLimitEstimate } from "../log-analysis/core";
import {
  buildSupplyLimitTableRows,
  findSupplyLimitHierarchyConflicts,
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
    peakPowerW: 2_000,
    averagePowerW: 500,
    energyWh: 40,
    share: 0.8,
  },
  {
    id: "swerve/moduleFL",
    rawPath: "swerve/moduleFL",
    parentId: "swerve",
    depth: 1,
    childrenIds: [],
    peakCurrentA: 60,
    peakPowerW: 700,
    averagePowerW: 120,
    energyWh: 10,
    share: 0.25,
  },
  {
    id: "indexer",
    rawPath: "indexer",
    parentId: null,
    depth: 0,
    childrenIds: [],
    peakCurrentA: 120,
    peakPowerW: 1_200,
    averagePowerW: 200,
    energyWh: 8,
    share: 0.2,
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
  it("matches the subsystem table hierarchy, energy order, and default collapse", () => {
    expect(buildSupplyLimitTableRows(targets).map(({ target }) => target.id)).toEqual([
      "swerve",
      "indexer",
    ]);

    expect(
      buildSupplyLimitTableRows(targets, new Set(["swerve"])).map(
        ({ target, visualDepth, hasChildren }) => ({
          id: target.id,
          visualDepth,
          hasChildren,
        }),
      ),
    ).toEqual([
      { id: "swerve", visualDepth: 0, hasChildren: true },
      { id: "swerve/moduleFL", visualDepth: 1, hasChildren: false },
      { id: "indexer", visualDepth: 0, hasChildren: false },
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

    expect(markup).toMatch(/id="supply-limit-editor-title"[^>]*>明细<\/h2>/);
    expect(markup).toContain('role="switch"');
    expect(markup).toContain('aria-checked="false"');
    expect(markup).toContain("border-ink-faint/70 bg-surface-2");
    expect(markup).not.toContain("bg-line-strong");
    expect(markup).toContain('aria-label="清空限流模拟"');
    expect(markup).toContain('aria-label="限流模拟路径表"');
    expect(markup).toContain('tabindex="0"');
    expect(markup).toContain('aria-describedby="supply-limit-help-content"');
    expect(markup).toContain('role="tooltip"');
    expect(markup).toMatch(
      /路径[\s\S]*能量[\s\S]*同级占比[\s\S]*平均功率[\s\S]*峰值功率[\s\S]*峰值电流[\s\S]*Supply 限流值[\s\S]*启用/,
    );
    expect(markup).toContain('id="supply-limit-indexer"');
    expect(markup).not.toContain('id="supply-limit-swerve/moduleFL"');
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
    expect(markup).not.toContain("可添加的限流目标");
    expect(markup).not.toContain("移除目标");
    expect(markup).not.toContain("text-right");
    expect(markup).not.toContain("text-center");
  });

  it("shows every available target without the old twelve-item search limit", () => {
    const manyTargets = Array.from({ length: 14 }, (_, index): SupplyLimitTargetOption => ({
      id: `motor-${index}`,
      rawPath: `motor-${index}`,
      parentId: null,
      depth: 0,
      childrenIds: [],
      peakCurrentA: index + 1,
      peakPowerW: index + 1,
      averagePowerW: index + 1,
      energyWh: index + 1,
      share: null,
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
    const markup = renderSimulator({ targets: [targets[2]], draftLimits });

    expect(markup).toContain('value="80"');
    expect(markup).not.toContain("预计会触发");
    expect(markup).not.toContain("确认同构电机组");
  });

  it("shows aggregate confirmation and blocks the master switch on parent-child conflicts", () => {
    const draftLimits: SupplyLimitDraft[] = [
      { nodeId: "swerve", enabled: true, limitText: "100", aggregateConfirmed: false },
      { nodeId: "swerve/moduleFL", enabled: true, limitText: "40", aggregateConfirmed: false },
    ];
    const markup = renderSimulator({ draftLimits });

    expect(markup).toContain("确认同构电机组");
    expect(markup).toContain("下级已启用 1");
    expect(markup).toContain("不能同时模拟");
    expect(markup).toContain("swerve/moduleFL");
    expect(markup).toMatch(/role="switch"[^>]*disabled=""/);
  });

  it("keeps a folded enabled descendant error visible below the table", () => {
    const markup = renderSimulator({
      draftLimits: [{
        nodeId: "swerve/moduleFL",
        enabled: true,
        limitText: "invalid",
        aggregateConfirmed: false,
      }],
      errors: [{
        nodeId: "swerve/moduleFL",
        message: "请输入大于或等于 0 的有限电流值。",
      }],
    });

    expect(markup).not.toContain('id="supply-limit-swerve/moduleFL"');
    expect(markup).toContain("下级已启用 1");
    expect(markup).toContain("「swerve/moduleFL」请输入大于或等于 0 的有限电流值。");
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
    expect(markup).toMatch(/id="supply-limit-indexer"[^>]*value="40"[^>]*>/);
    expect(markup).not.toMatch(/id="supply-limit-indexer"[^>]*disabled=""/);
    expect(markup).not.toContain('id="supply-limit-results-title"');
  });

  it("keeps unavailable nodes visible but disables their row controls", () => {
    const unavailable = {
      ...targets[2],
      unavailableReason: "该节点没有有效的 Supply 电流样本。",
    };
    const markup = renderSimulator({ targets: [unavailable] });

    expect(markup).toContain("该节点没有有效的 Supply 电流样本。");
    expect(markup).toMatch(/id="supply-limit-indexer"[^>]*disabled=""/);
    expect(markup).toMatch(/aria-label="启用indexer限流"[^>]*disabled=""/);
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
    expect(markup).not.toContain('id="supply-limit-results-title"');
  });

  it("omits non-actionable row status copy before a report exists", () => {
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

    expect(markup).not.toContain("预计会触发");
    expect(markup).not.toContain("模拟中");
    expect(markup).not.toContain("supply-limit-status-");
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
    expect(markup).toMatch(/id="supply-limit-results-title"[^>]*>报告<\/h2>/);
    expect(markup).not.toContain("限流模拟报告");
    expect(markup).not.toContain("固定历史时间轴");
    expect(markup).not.toContain("个目标");
    expect(markup).toContain("整机总能量");
    expect(markup).toContain("40.000 Wh");
    expect(markup).toContain("38.000 Wh");
    expect(markup).toContain("预计节省能量");
    expect(markup).not.toContain("模拟中");
    expect(markup).toContain("120.0 → 80.0 A");
    expect(markup).not.toContain("EnergyLogger 路径");
    expect(markup).not.toMatch(/<th[^>]*>状态<\/th>/);
    expect(markup).not.toContain("<details");
    expect(markup).not.toContain("累计能量发生重置，已分段估算。");
    expect(markup).not.toContain("text-right");
    expect(markup).not.toContain("text-center");
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
