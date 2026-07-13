import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type {
  EnergyLogDataset,
  NumericSeries,
  SubsystemNode,
  SupplyLimitEstimate,
  SupplyLimitMetricSnapshot,
} from "../log-analysis/core";
import {
  comparisonTimelinePairs,
  createSupplyLimitTimelineOption,
  SupplyLimitTimeline,
  timelinePairs,
  type SupplyLimitTimelineMetric,
} from "./supply-limit-timeline";

describe("supply limit timeline options", () => {
  it("renders observed and estimated robot curves on separate single-grid charts", () => {
    const dataset = testDataset();
    const estimate = testEstimate();
    const cases: Array<{
      metric: SupplyLimitTimelineMetric;
      ids: string[];
      step?: "end";
    }> = [
      { metric: "total-current", ids: ["total-current-observed", "total-current-estimated"], step: "end" },
      { metric: "total-power", ids: ["total-power-observed", "total-power-estimated"], step: "end" },
      { metric: "energy", ids: ["energy-observed", "energy-estimated"] },
    ];

    for (const testCase of cases) {
      const option = optionView(createSupplyLimitTimelineOption(
        dataset,
        estimate,
        testCase.metric,
        "indexer",
        "dark",
        `${testCase.metric}-range`,
      ));

      expect(option.grid).toHaveLength(1);
      expect(option.dataZoom[0]).toMatchObject({
        id: `${testCase.metric}-range`,
        zoomOnMouseWheel: false,
        moveOnMouseMove: false,
        moveOnMouseWheel: false,
      });
      expect(option.series.map((series) => series.id)).toEqual(testCase.ids);
      expect(option.series[0]?.step).toBe(testCase.step);
      expect(option.series[1]?.step).toBe(testCase.step);
      expect(option.series[0]?.markArea?.data).toHaveLength(2);
      expect(option.series[1]?.markArea).toBeUndefined();
      expect(option.series[0]?.emphasis).toEqual({ disabled: true });
      expect(option.series[1]?.emphasis).toEqual({ disabled: true });
    }
  });

  it("draws the selected target limit without duplicating state backgrounds", () => {
    const option = optionView(createSupplyLimitTimelineOption(
      testDataset(),
      testEstimate(),
      "target-current",
      "indexer",
      "dark",
      "target-range",
    ));

    expect(option.series.map((series) => series.id)).toEqual([
      "target-current-observed",
      "target-current-estimated",
    ]);
    expect(option.series[0]?.data).toEqual([[0, 40], [1, 80], [2, 30]]);
    expect(option.series[1]?.data).toEqual([[0, 40], [1, 50], [2, 30]]);
    expect(option.series[0]?.markLine?.data).toEqual([{ yAxis: 50 }]);
    expect(option.series[0]?.markLine?.label?.formatter).toBe("50.0 A");
    expect(option.series[0]?.markArea?.data).toHaveLength(2);
    expect(option.series[1]?.markArea).toBeUndefined();
  });

  it("keeps observed robot curves visible when reconciliation makes estimates unavailable", () => {
    const estimate = testEstimate();
    estimate.timeline.estimatedTotalCurrentA = undefined;
    estimate.timeline.estimatedTotalPowerW = undefined;
    estimate.timeline.estimatedTotalEnergyWh = undefined;

    for (const metric of ["total-current", "total-power", "energy"] as const) {
      const option = optionView(createSupplyLimitTimelineOption(
        testDataset(),
        estimate,
        metric,
        "indexer",
        "dark",
        metric,
      ));
      expect(option.series).toHaveLength(1);
      expect(option.series[0]?.id).toBe(`${metric}-observed`);
      expect(option.series[0]?.markArea?.data).toHaveLength(2);
    }
  });
});

describe("supply limit timeline rendering", () => {
  it("renders an independent legend and four equal-height cards", () => {
    const markup = renderToStaticMarkup(createElement(SupplyLimitTimeline, {
      dataset: testDataset(),
      estimate: testEstimate(),
      selectedTargetId: "indexer",
      range: { startUs: 0, endUs: 2_000_000 },
      cursorUs: 1_000_000,
      cursorPreviewActive: false,
      onCursorPreview: () => undefined,
      onCursorCommit: () => undefined,
    }));

    expect(markup).toContain('aria-label="限流估算曲线图例"');
    expect(markup).toContain('aria-label="整机总电流"');
    expect(markup).toContain('aria-label="整机总功率"');
    expect(markup).toContain('aria-label="累计能量"');
    expect(markup).toContain('aria-label="当前目标电流"');
    expect(markup).toContain("indexer");
    expect(markup.match(/h-\[300px\] min-h-\[260px\]/g)).toHaveLength(4);
    expect(markup.match(/cursor-default \[&amp;_\*\]:!cursor-default/g)).toHaveLength(4);
  });

  it("keeps the target card present and explains a missing controlled selection", () => {
    const markup = renderToStaticMarkup(createElement(SupplyLimitTimeline, {
      dataset: testDataset(),
      estimate: testEstimate(),
      selectedTargetId: null,
      range: { startUs: 0, endUs: 2_000_000 },
      cursorUs: 1_000_000,
      cursorPreviewActive: false,
      onCursorPreview: () => undefined,
      onCursorCommit: () => undefined,
    }));

    expect(markup).toContain("请选择一个已应用的限流目标。");
    expect(markup.match(/h-\[300px\] min-h-\[260px\]/g)).toHaveLength(4);
  });
});

describe("supply limit timeline downsampling", () => {
  it("uses the shortest array length and keeps extrema in chronological order", () => {
    const timestamps = Float64Array.from([0, 1, 2, 3, 4, 5, 6, 7], (value) => value * 1_000_000);
    const values = Float64Array.from([0, 20, -10, 5, -30, 40, 2]);
    const pairs = timelinePairs(timestamps, values, 6);

    expect(pairs).toHaveLength(6);
    expect(pairs.map((pair) => pair[1])).toEqual([0, 20, -10, -30, 40, 2]);
    expect(pairs.map((pair) => pair[0])).toEqual([...pairs.map((pair) => pair[0])].sort((a, b) => a - b));
  });

  it("uses one shared timestamp selection for observed and estimated curves", () => {
    const timestamps = Float64Array.from({ length: 20 }, (_unused, index) => index * 1_000_000);
    const observed = Float64Array.from({ length: 20 }, (_unused, index) => index === 5 ? 100 : index);
    const estimated = Float64Array.from({ length: 20 }, (_unused, index) => index === 12 ? 80 : index / 2);
    const [observedPairs, estimatedPairs] = comparisonTimelinePairs(
      timestamps,
      observed,
      estimated,
      10,
    );

    expect(observedPairs.map(([timestamp]) => timestamp)).toEqual(
      estimatedPairs.map(([timestamp]) => timestamp),
    );
    expect(observedPairs.some(([, value]) => value === 100)).toBe(true);
    expect(estimatedPairs.some(([, value]) => value === 80)).toBe(true);
  });
});

function testEstimate(): SupplyLimitEstimate {
  const baseline = snapshot({ energyWh: 10, peakCurrentA: 80, peakPowerW: 800 });
  const estimated = snapshot({ energyWh: 8, peakCurrentA: 50, peakPowerW: 500 });
  return {
    range: { startUs: 0, endUs: 2_000_000, durationSeconds: 2 },
    limits: [{ nodeId: "indexer", limitA: 50, enabled: true, aggregateConfirmed: false }],
    targets: [{
      nodeId: "indexer",
      rawPath: "indexer",
      displayName: "indexer",
      kind: "terminal",
      limitA: 50,
      baseline,
      estimated,
      energySavedWh: 2,
      energySavedPercent: 20,
      clippedDurationSeconds: 1,
      clippedRangeFraction: 0.5,
      ampSecondsRemoved: 30,
      warnings: [],
    }],
    totals: {
      activeTargetCount: 1,
      baseline,
      estimated,
      energySavedWh: 2,
      energySavedPercent: 20,
      clippedUnionDurationSeconds: 1,
      clippedDurationSumSeconds: 1,
      robotEstimateAvailable: true,
    },
    timeline: {
      timestampsUs: Float64Array.from([0, 1_000_000, 2_000_000]),
      observedTotalCurrentA: Float64Array.from([100, 160, 90]),
      estimatedTotalCurrentA: Float64Array.from([100, 130, 90]),
      observedTotalPowerW: Float64Array.from([1_000, 1_600, 900]),
      estimatedTotalPowerW: Float64Array.from([1_000, 1_300, 900]),
      observedTotalEnergyWh: Float64Array.from([0, 5, 10]),
      estimatedTotalEnergyWh: Float64Array.from([0, 4, 8]),
      targets: [{
        nodeId: "indexer",
        observedCurrentA: Float64Array.from([40, 80, 30]),
        estimatedCurrentA: Float64Array.from([40, 50, 30]),
      }],
    },
    warnings: [],
  };
}

function snapshot(overrides: Partial<SupplyLimitMetricSnapshot> = {}): SupplyLimitMetricSnapshot {
  return {
    energyWh: 0,
    averagePowerW: 0,
    peakPowerW: 0,
    peakPowerTimestampUs: 0,
    peakCurrentA: 0,
    peakCurrentTimestampUs: 0,
    ...overrides,
  };
}

function testDataset(): EnergyLogDataset {
  const node = subsystemNode();
  return {
    header: { version: 1, majorVersion: 1, minorVersion: 0, extraHeader: "", byteLength: 12 },
    file: { recordCount: 0, dataRecordCount: 0, controlRecordCount: 0, lastGoodOffset: 0 },
    root: "/RealOutputs/energyLogger",
    bounds: { logStartUs: 0, logEndUs: 2_000_000, energyStartUs: 0, energyEndUs: 2_000_000 },
    series: {
      totalCurrentA: numeric([100, 160, 90], "A"),
      totalPowerW: numeric([1_000, 1_600, 900], "W"),
      totalEnergyWh: numeric([0, 5, 10], "Wh"),
    },
    subsystems: [node],
    segments: {
      enabled: [],
      modes: [{
        startUs: 0,
        endUs: 2_000_000,
        durationSeconds: 2,
        mode: "teleop",
        isPractice: false,
      }],
      brownouts: [{ startUs: 1_000_000, endUs: 1_100_000, durationSeconds: 0.1 }],
    },
    quality: {
      issues: [],
      reconciliation: {
        totalEnergyWh: 10,
        topLevelEnergyWh: 10,
        differenceWh: 0,
        differencePercent: 0,
        withinTolerance: true,
      },
      droppedNonfiniteSamples: 0,
      resetCount: 0,
    },
  };
}

function subsystemNode(): SubsystemNode {
  return {
    id: "indexer",
    rawPath: "indexer",
    displayName: "indexer",
    parentId: null,
    depth: 0,
    childrenIds: [],
    isAggregate: false,
    currentA: numeric([40, 80, 30], "A"),
    powerW: numeric([400, 800, 300], "W"),
    energyWh: numeric([0, 4, 10], "Wh"),
  };
}

function numeric(values: number[], unit: string): NumericSeries {
  return {
    timestampsUs: Float64Array.from(values, (_value, index) => index * 1_000_000),
    values: Float64Array.from(values),
    unit,
    entryName: "test",
  };
}

function optionView(option: unknown) {
  return option as {
    grid: unknown[];
    dataZoom: Array<{
      id?: string;
      zoomOnMouseWheel?: boolean;
      moveOnMouseMove?: boolean;
      moveOnMouseWheel?: boolean;
    }>;
    series: Array<{
      id?: string;
      data?: Array<[number, number]>;
      step?: "end";
      emphasis?: { disabled?: boolean };
      markArea?: { data?: unknown[] };
      markLine?: {
        data?: Array<{ yAxis: number }>;
        label?: { formatter?: string };
      };
    }>;
  };
}
