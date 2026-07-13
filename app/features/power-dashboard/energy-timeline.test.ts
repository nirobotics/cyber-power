import * as echarts from "echarts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { EnergyLogDataset, NumericSeries, SubsystemNode } from "../log-analysis/core";
import {
  createRobotTimelineOption,
  createSubsystemTimelineOption,
  heldSeriesPairs,
  RobotTimeline,
  seriesPairs,
  syncCursor,
  type RobotMetric,
  type SubsystemMetric,
} from "./energy-timeline";

function numeric(values: number[], unit = "W"): NumericSeries {
  return {
    timestampsUs: Float64Array.from(values, (_value, index) => index * 1_000_000),
    values: Float64Array.from(values),
    unit,
    entryName: "test",
  };
}

describe("timeline downsampling", () => {
  it("keeps every point when the series is below the display limit", () => {
    expect(seriesPairs(numeric([1, 2, 3]), 4)).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
    ]);
  });

  it("preserves bucket extrema and chronological order", () => {
    const pairs = seriesPairs(numeric([0, 2, 50, -20, 3, 4, -40, 75, 6, 0]), 6);
    const values = pairs.map((pair) => pair[1]);

    expect(pairs).toHaveLength(6);
    expect(values).toEqual([0, 50, -20, -40, 75, 0]);
    expect(pairs.map((pair) => pair[0])).toEqual([...pairs.map((pair) => pair[0])].sort((a, b) => a - b));
  });
});

describe("sample-and-hold timeline", () => {
  it("extends the held value to both selected boundaries", () => {
    const series = numeric([7, 6, 5]);
    expect(heldSeriesPairs(series, 500_000, 2_500_000)).toEqual([
      [0.5, 7],
      [1, 6],
      [2, 5],
      [2.5, 5],
    ]);
  });

  it("does not invent a value before the first sample", () => {
    const series = numeric([7, 6]);
    series.timestampsUs = Float64Array.from([1_000_000, 2_000_000]);
    expect(heldSeriesPairs(series, 0, 500_000)).toEqual([]);
  });
});

describe("shared ECharts cursor", () => {
  it("dispatches a real pixel-based axis pointer without writing the programmatic event back", () => {
    const chart = cursorChart();
    const suppression = { current: false };
    let externalWrites = 0;
    let emittedAxes: Array<{ axisDim?: string; axisIndex?: number; value?: number }> = [];
    chart.on("updateAxisPointer", (...args: unknown[]) => {
      const event = args[0] as { axesInfo?: typeof emittedAxes };
      emittedAxes = event.axesInfo ?? [];
      if (!suppression.current) externalWrites += 1;
    });
    const dispatch = vi.spyOn(chart, "dispatchAction");

    try {
      syncCursor(chart, 3, 5_000_000, "power", suppression);

      expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
        type: "updateAxisPointer",
        x: expect.any(Number),
        y: expect.any(Number),
        axesInfo: [{ axisDim: "x", axisIndex: 2 }],
      }));
      expect(emittedAxes).toEqual(expect.arrayContaining([
        expect.objectContaining({ axisDim: "x", axisIndex: 2, value: 5 }),
      ]));
      expect(externalWrites).toBe(0);
      expect(suppression.current).toBe(false);
    } finally {
      dispatch.mockRestore();
      chart.dispose();
    }
  });

  it("synchronizes the same cursor across all three subsystem charts", () => {
    const charts = Array.from({ length: 3 }, () => cursorChart());
    const suppression = { current: false };
    const emittedValues = charts.map(() => Number.NaN);
    let externalWrites = 0;

    charts.forEach((chart, index) => {
      chart.on("updateAxisPointer", (...args: unknown[]) => {
        const event = args[0] as { axesInfo?: Array<{ axisDim?: string; axisIndex?: number; value?: number }> };
        const xAxis = event.axesInfo?.find((axis) => axis.axisDim === "x" && axis.axisIndex === 0);
        emittedValues[index] = xAxis?.value ?? Number.NaN;
        if (!suppression.current) externalWrites += 1;
      });
    });

    try {
      charts.forEach((chart) => syncCursor(chart, 0, 4_250_000, null, suppression));

      expect(emittedValues).toEqual([4.25, 4.25, 4.25]);
      expect(externalWrites).toBe(0);
      expect(suppression.current).toBe(false);
    } finally {
      charts.forEach((chart) => chart.dispose());
    }
  });

  it("falls back to the only axis when a peak focus targets a split robot chart", () => {
    const chart = cursorChart(1);
    let emittedAxisIndex = -1;
    chart.on("updateAxisPointer", (...args: unknown[]) => {
      const event = args[0] as { axesInfo?: Array<{ axisDim?: string; axisIndex?: number }> };
      emittedAxisIndex = event.axesInfo?.find((axis) => axis.axisDim === "x")?.axisIndex ?? -1;
    });

    try {
      syncCursor(chart, 0, 5_000_000, "power");
      expect(emittedAxisIndex).toBe(0);
    } finally {
      chart.dispose();
    }
  });
});

describe("robot timeline cards", () => {
  it("builds one chart option per metric without the old multi-grid legend", () => {
    const dataset = robotDataset();
    const cases: Array<{ metric: RobotMetric; zoomId: string; seriesIds: string[] }> = [
      { metric: "voltage", zoomId: "robot-voltage-time-range", seriesIds: ["battery-voltage", "brownout-voltage"] },
      { metric: "current", zoomId: "robot-current-time-range", seriesIds: ["total-current"] },
      { metric: "power", zoomId: "robot-power-time-range", seriesIds: ["total-power"] },
      { metric: "energy", zoomId: "robot-energy-time-range", seriesIds: ["total-energy"] },
    ];

    for (const testCase of cases) {
      const option = robotOptionView(createRobotTimelineOption(dataset, testCase.metric, "dark", testCase.zoomId));
      expect(option.grid).toHaveLength(1);
      expect(option.xAxis).toHaveLength(1);
      expect(option.yAxis).toHaveLength(1);
      expect(option.dataZoom[0]?.id).toBe(testCase.zoomId);
      expect(option.legend).toBeUndefined();
      expect(option.series.map((series) => series.id)).toEqual(testCase.seriesIds);
    }
  });

  it("keeps the mode and brownout areas on voltage only", () => {
    const dataset = robotDataset();
    const voltage = robotOptionView(createRobotTimelineOption(dataset, "voltage", "dark", "voltage"));
    const current = robotOptionView(createRobotTimelineOption(dataset, "current", "dark", "current"));

    expect(voltage.series[0]?.markArea?.data).toHaveLength(2);
    expect(current.series[0]?.markArea).toBeUndefined();
  });

  it("renders a separate legend and four equal-height chart cards", () => {
    const dataset = robotDataset();
    const markup = renderToStaticMarkup(createElement(RobotTimeline, {
      dataset,
      range: { startUs: 0, endUs: 1_000_000 },
      cursorUs: 500_000,
      focus: "power",
      onCursorChange: () => undefined,
    }));

    expect(markup).toContain('aria-label="整机曲线图例"');
    expect(markup).toContain('aria-label="整机电池电压"');
    expect(markup).toContain('aria-label="整机总电流"');
    expect(markup).toContain('aria-label="整机总功率"');
    expect(markup).toContain('aria-label="整机累计能量"');
    expect(markup.match(/h-\[300px\] min-h-\[260px\]/g)).toHaveLength(4);
  });
});

describe("subsystem timeline options", () => {
  it("builds separate power, current, and energy charts with their own zoom controls", () => {
    const node = subsystemNode();
    const dataset = subsystemDataset(node);
    const cases: Array<{
      metric: SubsystemMetric;
      zoomId: string;
      data: Array<[number, number]>;
      step?: "end";
    }> = [
      { metric: "power", zoomId: "subsystem-power-time-range", data: [[0, 100], [1, 200]], step: "end" },
      { metric: "current", zoomId: "subsystem-current-time-range", data: [[0, 10], [1, 20]], step: "end" },
      { metric: "energy", zoomId: "subsystem-energy-time-range", data: [[0, 0], [1, 2]] },
    ];

    for (const testCase of cases) {
      const option = optionView(createSubsystemTimelineOption(
        dataset,
        [node],
        new Set(),
        testCase.metric,
        "dark",
        testCase.zoomId,
      ));

      expect(option.dataZoom[0]?.id).toBe(testCase.zoomId);
      expect(option.series).toHaveLength(1);
      expect(option.series[0]).toMatchObject({ id: node.id, data: testCase.data });
      expect(option.series[0]?.step).toBe(testCase.step);
    }
  });

  it("applies the shared subsystem visibility selection to every metric", () => {
    const node = subsystemNode();
    const dataset = subsystemDataset(node);

    for (const metric of ["power", "current", "energy"] as const) {
      const option = optionView(createSubsystemTimelineOption(
        dataset,
        [node],
        new Set([node.id]),
        metric,
        "dark",
        `subsystem-${metric}-time-range`,
      ));
      expect(option.series).toEqual([]);
    }
  });
});

function subsystemNode(): SubsystemNode {
  return {
    id: "drive",
    rawPath: "drive",
    displayName: "drive",
    parentId: null,
    depth: 0,
    childrenIds: [],
    isAggregate: false,
    currentA: numeric([10, 20], "A"),
    powerW: numeric([100, 200], "W"),
    energyWh: numeric([5, 7], "Wh"),
  };
}

function subsystemDataset(node: SubsystemNode): EnergyLogDataset {
  return {
    header: { version: 1, majorVersion: 1, minorVersion: 0, extraHeader: "", byteLength: 12 },
    file: { recordCount: 0, dataRecordCount: 0, controlRecordCount: 0, lastGoodOffset: 0 },
    root: "/RealOutputs/energyLogger",
    bounds: { logStartUs: 0, logEndUs: 1_000_000, energyStartUs: 0, energyEndUs: 1_000_000 },
    series: {
      totalCurrentA: numeric([10, 20], "A"),
      totalPowerW: numeric([100, 200], "W"),
      totalEnergyWh: numeric([5, 7], "Wh"),
    },
    subsystems: [node],
    segments: { brownouts: [], enabled: [], modes: [] },
    quality: {
      issues: [],
      reconciliation: {
        totalEnergyWh: 2,
        topLevelEnergyWh: 2,
        differenceWh: 0,
        differencePercent: 0,
        withinTolerance: true,
      },
      droppedNonfiniteSamples: 0,
      resetCount: 0,
    },
  };
}

function robotDataset(): EnergyLogDataset {
  const dataset = subsystemDataset(subsystemNode());
  dataset.series.batteryVoltageV = numeric([12.4, 10.8], "V");
  dataset.series.brownoutVoltageV = numeric([6.3, 6.2], "V");
  dataset.segments.modes = [{
    startUs: 0,
    endUs: 1_000_000,
    durationSeconds: 1,
    mode: "autonomous",
    isPractice: false,
  }];
  dataset.segments.brownouts = [{ startUs: 400_000, endUs: 500_000, durationSeconds: 0.1 }];
  return dataset;
}

function optionView(option: unknown) {
  return option as {
    dataZoom: Array<{ id?: string }>;
    series: Array<{ id?: string; data?: Array<[number, number]>; step?: "end" }>;
  };
}

function robotOptionView(option: unknown) {
  return option as {
    dataZoom: Array<{ id?: string }>;
    grid: unknown[];
    xAxis: unknown[];
    yAxis: unknown[];
    legend?: unknown;
    series: Array<{ id?: string; markArea?: { data?: unknown[] } }>;
  };
}

function cursorChart(axisCount = 4) {
  const chart = echarts.init(null, undefined, {
    renderer: "svg",
    ssr: true,
    width: 800,
    height: 500,
  });
  const grids = [20, 130, 240, 350]
    .slice(0, axisCount)
    .map((top) => ({ left: 60, right: 20, top, height: 80 }));
  chart.setOption({
    animation: false,
    tooltip: { trigger: "axis" },
    axisPointer: { link: [{ xAxisIndex: grids.map((_grid, index) => index) }] },
    grid: grids,
    xAxis: grids.map((_grid, gridIndex) => ({
      type: "value",
      min: 0,
      max: 10,
      gridIndex,
      axisPointer: { show: true, snap: false, triggerTooltip: true },
    })),
    yAxis: grids.map((_grid, gridIndex) => ({ type: "value", gridIndex })),
    series: grids.map((_grid, index) => ({
      type: "line",
      xAxisIndex: index,
      yAxisIndex: index,
      data: [[0, 0], [5, index + 1], [10, 0]],
    })),
  });
  return chart;
}
