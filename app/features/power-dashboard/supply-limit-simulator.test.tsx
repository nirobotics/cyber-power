import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type {
  SupplyCurrentLimitInput,
  SupplyLimitEstimate,
} from "../log-analysis/core";
import {
  findSupplyLimitHierarchyConflicts,
  orderSupplyLimitTargets,
  parseSupplyLimitDraftValue,
  SupplyLimitSimulator,
  type SupplyLimitDraft,
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
  onAddTarget: () => undefined,
  onUpdateDraft: () => undefined,
  onRemoveTarget: () => undefined,
  onApply: () => undefined,
  onRevert: () => undefined,
  onClear: () => undefined,
  onSelectTarget: () => undefined,
};

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
    expect(
      findSupplyLimitHierarchyConflicts(targets, [
        { nodeId: "swerve", enabled: true },
        { nodeId: "swerve/moduleFL", enabled: true },
        { nodeId: "indexer", enabled: true },
      ]),
    ).toEqual([
      { ancestorId: "swerve", descendantId: "swerve/moduleFL" },
    ]);

    expect(
      findSupplyLimitHierarchyConflicts(targets, [
        { nodeId: "swerve", enabled: true },
        { nodeId: "swerve/moduleFL", enabled: false },
      ]),
    ).toEqual([]);
  });

  it("does not invent a conflict for independent top-level terminal groups", () => {
    expect(
      findSupplyLimitHierarchyConflicts(targets, [
        { nodeId: "indexer", enabled: true },
        { nodeId: "swerve/moduleFL", enabled: true },
      ]),
    ).toEqual([]);
  });

  it("terminates safely when malformed target metadata contains a parent cycle", () => {
    const cyclic: SupplyLimitTargetOption[] = [
      { ...targets[0], id: "a", rawPath: "a", parentId: "b" },
      { ...targets[1], id: "b", rawPath: "b", parentId: "a" },
    ];

    expect(() =>
      findSupplyLimitHierarchyConflicts(cyclic, [
        { nodeId: "a", enabled: true },
      ]),
    ).not.toThrow();
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
  it("treats a root node without children as a directly configurable motor group", () => {
    const draftLimits: SupplyLimitDraft[] = [
      {
        nodeId: "indexer",
        enabled: true,
        limitText: "80",
        aggregateConfirmed: false,
      },
    ];

    const markup = renderToStaticMarkup(
      createElement(SupplyLimitSimulator, {
        targets,
        draftLimits,
        appliedLimits: [],
        errors: [],
        estimate: null,
        selectedTargetId: "indexer",
        hasUnappliedChanges: true,
        ...callbacks,
      }),
    );

    expect(markup).toContain("多子系统 Supply 电流限流方案");
    expect(markup).toContain("indexer");
    expect(markup).toContain("顶层终端电机组");
    expect(markup).toContain("可直接估算");
    expect(markup).toContain("value=\"80\"");
    expect(markup).toContain("预计会触发");
    expect(markup).not.toContain("确认该聚合路径代表同构电机组");
  });

  it("shows aggregate confirmation and blocks atomic apply on parent-child conflicts", () => {
    const draftLimits: SupplyLimitDraft[] = [
      {
        nodeId: "swerve",
        enabled: true,
        limitText: "100",
        aggregateConfirmed: false,
      },
      {
        nodeId: "swerve/moduleFL",
        enabled: true,
        limitText: "40",
        aggregateConfirmed: false,
      },
    ];

    const markup = renderToStaticMarkup(
      createElement(SupplyLimitSimulator, {
        targets,
        draftLimits,
        appliedLimits: [],
        errors: [],
        estimate: null,
        selectedTargetId: null,
        hasUnappliedChanges: true,
        ...callbacks,
      }),
    );

    expect(markup).toContain("确认该聚合路径代表同构电机组");
    expect(markup).toContain("需要修正");
    expect(markup).toContain("不能同时应用");
    expect(markup).toContain("存在祖先与后代重复计算冲突");
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>应用方案<\/button>/);
  });

  it("does not apply an aggregate target before homogeneous-group confirmation", () => {
    const markup = renderToStaticMarkup(
      createElement(SupplyLimitSimulator, {
        targets,
        draftLimits: [
          {
            nodeId: "swerve",
            enabled: true,
            limitText: "100",
            aggregateConfirmed: false,
          },
        ],
        appliedLimits: [],
        errors: [],
        estimate: null,
        selectedTargetId: null,
        hasUnappliedChanges: true,
        ...callbacks,
      }),
    );

    expect(markup).toContain("等待同构确认");
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>应用方案<\/button>/);
  });

  it("keeps the applied result visible while marking draft edits as unapplied", () => {
    const draftLimits: SupplyLimitDraft[] = [
      {
        nodeId: "indexer",
        enabled: true,
        limitText: "70",
        aggregateConfirmed: false,
      },
    ];
    const appliedLimits: SupplyCurrentLimitInput[] = [
      { nodeId: "indexer", limitA: 80, enabled: true },
    ];

    const markup = renderToStaticMarkup(
      createElement(SupplyLimitSimulator, {
        targets,
        draftLimits,
        appliedLimits,
        errors: [],
        estimate: null,
        selectedTargetId: "indexer",
        hasUnappliedChanges: true,
        ...callbacks,
      }),
    );

    expect(markup).toContain("存在未应用修改");
    expect(markup).toContain("已应用 80.0 A");
    expect(markup).toContain("value=\"70\"");
    expect(markup).not.toMatch(/<button[^>]*disabled=""[^>]*>应用方案<\/button>/);
  });

  it("requires at least one enabled target before applying a scenario", () => {
    const markup = renderToStaticMarkup(
      createElement(SupplyLimitSimulator, {
        targets,
        draftLimits: [
          {
            nodeId: "indexer",
            enabled: false,
            limitText: "",
            aggregateConfirmed: false,
          },
        ],
        appliedLimits: [],
        errors: [],
        estimate: null,
        selectedTargetId: "indexer",
        hasUnappliedChanges: true,
        ...callbacks,
      }),
    );

    expect(markup).toContain("0 个启用目标");
    expect(markup).toContain("未启用");
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>应用方案<\/button>/);
  });

  it("shows an old estimate error without blocking a corrected draft", () => {
    const markup = renderToStaticMarkup(
      createElement(SupplyLimitSimulator, {
        targets,
        draftLimits: [{
          nodeId: "indexer",
          enabled: true,
          limitText: "70",
          aggregateConfirmed: false,
        }],
        appliedLimits: [{ nodeId: "indexer", limitA: 80 }],
        errors: [],
        estimateErrors: [{ message: "旧方案估算失败。" }],
        estimate: null,
        selectedTargetId: "indexer",
        hasUnappliedChanges: true,
        ...callbacks,
      }),
    );

    expect(markup).toContain("旧方案估算失败。");
    expect(markup).not.toMatch(/<button[^>]*disabled=""[^>]*>应用方案<\/button>/);
  });

  it("renders robot and per-target comparison results without changing raw paths", () => {
    const estimate = {
      limits: [{ nodeId: "indexer", limitA: 80, enabled: true }],
      range: { startUs: 0, endUs: 10_000_000 },
      targets: [
        {
          nodeId: "indexer",
          rawPath: "indexer",
          limitA: 80,
          kind: "terminal",
          baseline: {
            energyWh: 8,
            averagePowerW: 300,
            peakPowerW: 1_200,
            peakCurrentA: 120,
          },
          estimated: {
            energyWh: 6,
            averagePowerW: 220,
            peakPowerW: 800,
            peakCurrentA: 80,
          },
          energySavedWh: 2,
          energySavedPercent: 25,
          clippedDurationSeconds: 3,
          clippedRangeFraction: 0.3,
          ampSecondsRemoved: 40,
          warnings: [{
            code: "SOURCE_ENERGY_RESET",
            message: "累计能量发生重置，已分段估算。",
          }],
        },
      ],
      totals: {
        baseline: {
          energyWh: 40,
          averagePowerW: 1_000,
          peakPowerW: 3_000,
          peakCurrentA: 300,
        },
        estimated: {
          energyWh: 38,
          averagePowerW: 920,
          peakPowerW: 2_600,
          peakCurrentA: 260,
        },
        energySavedWh: 2,
        energySavedPercent: 5,
        clippedUnionDurationSeconds: 3,
        clippedDurationSumSeconds: 3,
        activeTargetCount: 1,
        robotEstimateAvailable: true,
      },
      timeline: {},
      warnings: [
        {
          code: "CONFIRMED_AGGREGATE",
          message: "历史动作时长保持不变。",
        },
      ],
    } as unknown as SupplyLimitEstimate;

    const markup = renderToStaticMarkup(
      createElement(SupplyLimitSimulator, {
        targets,
        draftLimits: [
          {
            nodeId: "indexer",
            enabled: true,
            limitText: "80",
            aggregateConfirmed: false,
          },
        ],
        appliedLimits: estimate.limits,
        errors: [],
        estimate,
        selectedTargetId: "indexer",
        hasUnappliedChanges: false,
        ...callbacks,
      }),
    );

    expect(markup).toContain("限流估算结果");
    expect(markup).toContain("整机总能量");
    expect(markup).toContain("40.000 Wh");
    expect(markup).toContain("38.000 Wh");
    expect(markup).toContain("预计节省能量");
    expect(markup).toContain("indexer");
    expect(markup).toContain("<details");
    expect(markup).toContain("累计能量发生重置，已分段估算。");
    expect(markup).toContain("120.0 → 80.0 A");
    expect(markup).toContain("历史动作时长保持不变。");
  });
});
