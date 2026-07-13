import { describe, expect, it } from "vitest";
import type { SubsystemRangeMetrics } from "../log-analysis/core";
import { buildSubsystemTableRows } from "./subsystem-table";

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
});
