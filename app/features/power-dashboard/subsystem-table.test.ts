import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type {
  EnergyLogDataset,
  EnergyLoggerV2RangeAnalysis,
  RangeAnalysis,
  SubsystemRangeMetrics,
} from "../log-analysis/core";
import { buildSubsystemTableRows, SubsystemTable } from "./subsystem-table";

function metric(
  id: string,
  energyWh: number,
  parentId: string | null,
  depth = 99,
): SubsystemRangeMetrics {
  return {
    id,
    rawPath: id,
    displayName: id.split("/").at(-1) ?? id,
    parentId,
    depth,
    childrenIds: [],
    isAggregate: false,
    energyWh,
    averagePowerW: energyWh,
    peakPowerW: energyWh,
    peakPowerTimestampUs: 0,
    peakCurrentA: energyWh,
    peakCurrentTimestampUs: 0,
    share: null,
  };
}

describe("buildSubsystemTableRows", () => {
  const hierarchy = [
    metric("alpha/z", 4, "alpha"),
    metric("zero", 0, null),
    metric("alpha/a/deep", 2, "alpha/a"),
    metric("beta", 20, null),
    metric("alpha/a", 4, "alpha"),
    metric("alpha", 10, null),
  ];

  it("默认只显示按能量排序的顶层子系统", () => {
    const rows = buildSubsystemTableRows(hierarchy);

    expect(rows.map(({ metric: row }) => row.id)).toEqual([
      "beta",
      "alpha",
      "zero",
    ]);
    expect(rows.map(({ visualDepth }) => visualDepth)).toEqual([0, 0, 0]);
    expect(rows.map(({ hasChildren }) => hasChildren)).toEqual([false, true, false]);
  });

  it("只按已展开的 parentId 逐级显示后代", () => {
    const firstLevel = buildSubsystemTableRows(hierarchy, new Set(["alpha"]));
    expect(firstLevel.map(({ metric: row }) => row.id)).toEqual([
      "beta",
      "alpha",
      "alpha/a",
      "alpha/z",
      "zero",
    ]);
    expect(firstLevel.map(({ visualDepth }) => visualDepth)).toEqual([0, 0, 1, 1, 0]);

    const secondLevel = buildSubsystemTableRows(
      hierarchy,
      new Set(["alpha", "alpha/a"]),
    );
    expect(secondLevel.map(({ metric: row }) => row.id)).toEqual([
      "beta",
      "alpha",
      "alpha/a",
      "alpha/a/deep",
      "alpha/z",
      "zero",
    ]);
    expect(secondLevel.map(({ visualDepth }) => visualDepth)).toEqual([
      0, 0, 1, 2, 1, 0,
    ]);
  });

  it("不会把折叠后代作为新的顶层节点泄漏出来", () => {
    const rows = buildSubsystemTableRows([
      metric("alpha/z", 4, "alpha"),
      metric("alpha", 10, null),
    ]);

    expect(rows.map(({ metric: row }) => row.id)).toEqual(["alpha"]);
  });

  it("不会丢弃零能量节点或找不到父级的节点", () => {
    const rows = buildSubsystemTableRows([
      metric("orphan/child", 8, "orphan"),
      metric("orphan", 0, "missing-parent"),
      metric("root", 0, null),
    ]);

    expect(rows.map(({ metric: row }) => row.id)).toEqual([
      "root",
      "orphan",
    ]);
    expect(rows.map(({ visualDepth }) => visualDepth)).toEqual([0, 0]);

    const expanded = buildSubsystemTableRows(
      [
        metric("orphan/child", 8, "orphan"),
        metric("orphan", 0, "missing-parent"),
        metric("root", 0, null),
      ],
      new Set(["orphan"]),
    );
    expect(expanded.map(({ metric: row }) => row.id)).toEqual([
      "root",
      "orphan",
      "orphan/child",
    ]);
    expect(expanded.map(({ visualDepth }) => visualDepth)).toEqual([0, 0, 1]);
  });

  it("按子系统 name 关联 V2 状态，并默认折叠状态行", () => {
    const v2Analysis: EnergyLoggerV2RangeAnalysis = {
      range: { startUs: 1_000_000, endUs: 3_000_000 },
      subsystems: [
        {
          id: "s0",
          name: "drive",
          motorGroups: [],
          states: [
            {
              state: "AUTO",
              durationSeconds: 1,
              energyWh: 0.1,
              averagePowerW: 360,
              peakPowerW: 500,
              peakPowerTimestampUs: 1_500_000,
              peakCurrentA: 45,
              peakCurrentTimestampUs: 1_600_000,
            },
            {
              state: "TELEOP",
              durationSeconds: 1,
              energyWh: 0.08,
              averagePowerW: 288,
              peakPowerW: 400,
              peakPowerTimestampUs: 2_500_000,
              peakCurrentA: 36,
              peakCurrentTimestampUs: 2_600_000,
            },
          ],
        },
      ],
    };

    const collapsed = buildSubsystemTableRows([metric("drive", 0.18, null)], new Set(), v2Analysis);
    expect(collapsed).toHaveLength(1);
    expect(collapsed[0]).toMatchObject({
      metric: { id: "drive" },
      hasChildren: true,
    });
    expect(collapsed[0].state).toBeUndefined();

    const expanded = buildSubsystemTableRows(
      [metric("drive", 0.18, null)],
      new Set(["drive"]),
      v2Analysis,
    );
    expect(expanded.map((row) => row.state?.state ?? "全部")).toEqual([
      "全部",
      "AUTO",
      "TELEOP",
    ]);
    expect(expanded.map(({ visualDepth }) => visualDepth)).toEqual([0, 1, 1]);
  });

  it("空 V2 状态保持旧指标回退", () => {
    const rows = buildSubsystemTableRows([metric("drive", 0.18, null)], new Set(), {
      range: { startUs: 1_000_000, endUs: 3_000_000 },
      subsystems: [{ id: "s0", name: "drive", motorGroups: [], states: [] }],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].hasChildren).toBe(false);
  });

  it("将总行显示在唯一的明细表中", () => {
    const total = {
      ...metric("drive", 9, null),
      averagePowerW: 123,
      peakPowerW: 456,
      peakCurrentA: 78,
    };
    const html = renderToStaticMarkup(
      createElement(SubsystemTable, {
        dataset: {
          subsystems: [{ id: "drive", rawPath: "drive" }],
        } as EnergyLogDataset,
        analysis: {
          subsystems: [total],
          totals: { effectiveDurationSeconds: 2 },
        } as RangeAnalysis,
        v2Analysis: {
          range: { startUs: 0, endUs: 2_000_000 },
          subsystems: [
            {
              id: "s0",
              name: "drive",
              motorGroups: [],
              states: [
                {
                  state: "AUTO",
                  durationSeconds: 1,
                  energyWh: 0.1,
                  averagePowerW: 360,
                  peakPowerW: 400,
                  peakPowerTimestampUs: 1_000_000,
                  peakCurrentA: 40,
                  peakCurrentTimestampUs: 1_000_000,
                },
              ],
            },
          ],
        },
        onLocateTimestamp: () => undefined,
      }),
    );

    expect(html.match(/>明细<\/h2>/g)).toHaveLength(1);
    expect(html).not.toContain("功耗明细");
    expect(html).toContain("全部");
    expect(html).toContain("9.0000 Wh");
    expect(html).toContain("123.0 W");
    expect(html).not.toContain("0.1000 Wh");
    expect(html).not.toContain(">类型<");
  });
});
