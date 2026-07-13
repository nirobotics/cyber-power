import { SVGRenderer } from "echarts/renderers";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { EnergyLogDataset, NumericSeries, SubsystemNode } from "../log-analysis/core";
import {
  bindTimelinePointerInteractions,
  captureWheelForPageScroll,
  createRobotTimelineOption,
  createSubsystemTimelineOption,
  heldSeriesPairs,
  isEchoedLocalPreview,
  RobotTimeline,
  seriesPairs,
  syncCursor,
  type RobotMetric,
  type SubsystemMetric,
} from "./energy-timeline";
import { echarts } from "./echarts-runtime";

echarts.use([SVGRenderer]);

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

describe("modular ECharts runtime", () => {
  it("registers every production component used by timeline options", () => {
    const chart = echarts.init(null, undefined, {
      renderer: "svg",
      ssr: true,
      width: 320,
      height: 180,
    });

    try {
      chart.setOption({
        animation: false,
        tooltip: { trigger: "axis" },
        grid: { left: 20, right: 20, top: 20, bottom: 20 },
        xAxis: { type: "value", min: 0, max: 1 },
        yAxis: { type: "value" },
        dataZoom: [{ type: "inside", xAxisIndex: [0], start: 0, end: 100 }],
        series: [{
          type: "line",
          data: [[0, 0], [1, 1]],
          markArea: { data: [[{ xAxis: 0.25 }, { xAxis: 0.75 }]] },
        }],
      });

      expect(chart.renderToSVGString()).toContain("<svg");
    } finally {
      chart.dispose();
    }
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

describe("chart cursor interactions", () => {
  it("keeps a peak-following hover eligible for click when the parent echoes its preview", () => {
    expect(isEchoedLocalPreview(true, 4_000_000, 4_000_000)).toBe(true);
    expect(isEchoedLocalPreview(false, 4_000_000, 4_000_000)).toBe(false);
  });

  it("previews on hover, commits only on click, and clears the preview on leave", () => {
    const chart = cursorChart(1);
    const onPreview = vi.fn();
    const onCommit = vi.fn();
    let leaveListener: EventListener | null = null;
    const container = {
      addEventListener: vi.fn((_type: string, listener: EventListener) => {
        leaveListener = listener;
      }),
      removeEventListener: vi.fn(),
    } as unknown as HTMLElement;
    const cleanup = bindTimelinePointerInteractions(
      chart,
      container,
      0,
      { current: false },
      { current: null },
      onPreview,
      onCommit,
    );

    try {
      syncCursor(chart, 0, 4_000_000, null);
      expect(onPreview).toHaveBeenLastCalledWith(4_000_000);
      expect(onCommit).not.toHaveBeenCalled();

      const directClickX = chart.convertToPixel({ xAxisIndex: 0 }, 6);
      chart.getZr().trigger("click", {
        target: null,
        topTarget: null,
        offsetX: directClickX,
        offsetY: 60,
      });
      expect(onCommit).toHaveBeenCalledOnce();
      expect(onCommit).toHaveBeenCalledWith(6_000_000);

      chart.getZr().trigger("click", {
        target: null,
        topTarget: null,
        offsetX: directClickX,
        offsetY: 490,
      });
      expect(onCommit).toHaveBeenCalledOnce();

      (leaveListener as EventListener | null)?.(new Event("mouseleave"));
      expect(onPreview).toHaveBeenLastCalledWith(null);
    } finally {
      cleanup();
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

  it("fixes the battery voltage axis to the useful operating range", () => {
    const option = robotOptionView(createRobotTimelineOption(
      robotDataset(),
      "voltage",
      "dark",
      "robot-voltage-time-range",
    ));

    expect(option.yAxis[0]).toMatchObject({ min: 3, max: 13.5 });
  });

  it("keeps the same mode and brownout areas on every robot timeline", () => {
    const dataset = robotDataset();

    for (const metric of ["voltage", "current", "power", "energy"] as const) {
      const option = robotOptionView(createRobotTimelineOption(dataset, metric, "dark", metric));
      expect(option.series[0]?.markArea?.data).toHaveLength(2);
    }

    const voltage = robotOptionView(createRobotTimelineOption(dataset, "voltage", "dark", "voltage"));
    expect(voltage.series[1]?.markArea).toBeUndefined();
  });

  it("renders a separate legend and four equal-height chart cards", () => {
    const dataset = robotDataset();
    const markup = renderToStaticMarkup(createElement(RobotTimeline, {
      dataset,
      range: { startUs: 0, endUs: 1_000_000 },
      cursorUs: 500_000,
      cursorPreviewActive: false,
      focus: "power",
      onCursorPreview: () => undefined,
      onCursorCommit: () => undefined,
    }));

    expect(markup).toContain('aria-label="整机曲线图例"');
    expect(markup).toContain('aria-label="整机电池电压"');
    expect(markup).toContain('aria-label="整机总电流"');
    expect(markup).toContain('aria-label="整机总功率"');
    expect(markup).toContain('aria-label="整机累计能量"');
    expect(markup.match(/h-\[300px\] min-h-\[260px\]/g)).toHaveLength(4);
    expect(markup.match(/cursor-default \[&amp;_\*\]:!cursor-default/g)).toHaveLength(4);
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
      expect(option.series[0]?.emphasis).toEqual({ disabled: true });
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

  it("applies state areas once to the first visible subsystem curve", () => {
    const first = subsystemNode();
    const second = { ...subsystemNode(), id: "intake", rawPath: "intake", displayName: "intake" };
    const dataset = subsystemDataset(first);
    dataset.subsystems = [first, second];
    addTimelineAreas(dataset);

    for (const metric of ["power", "current", "energy"] as const) {
      const option = optionView(createSubsystemTimelineOption(
        dataset,
        [first, second],
        new Set(),
        metric,
        "dark",
        `subsystem-${metric}-time-range`,
      ));

      expect(option.series).toHaveLength(2);
      expect(option.series[0]?.markArea?.data).toHaveLength(2);
      expect(option.series[1]?.markArea).toBeUndefined();
    }

    const firstHidden = optionView(createSubsystemTimelineOption(
      dataset,
      [first, second],
      new Set([first.id]),
      "power",
      "dark",
      "subsystem-power-time-range",
    ));
    expect(firstHidden.series).toHaveLength(1);
    expect(firstHidden.series[0]?.id).toBe(second.id);
    expect(firstHidden.series[0]?.markArea?.data).toHaveLength(2);
  });

  it("keeps state areas visible with a silent carrier when every subsystem is hidden", () => {
    const node = subsystemNode();
    const dataset = subsystemDataset(node);
    addTimelineAreas(dataset);
    for (const metric of ["power", "current", "energy"] as const) {
      const option = optionView(createSubsystemTimelineOption(
        dataset,
        [node],
        new Set([node.id]),
        metric,
        "dark",
        `subsystem-${metric}-time-range`,
      ));

      expect(option.series).toHaveLength(1);
      expect(option.series[0]).toMatchObject({
        id: `subsystem-${metric}-timeline-areas`,
        data: [],
        silent: true,
      });
      expect(option.series[0]?.markArea?.data).toHaveLength(2);
    }
  });
});

describe("chart wheel passthrough", () => {
  it("stops capture before ECharts without cancelling page scrolling and removes the listener", () => {
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    const container = { addEventListener, removeEventListener } as unknown as HTMLElement;
    const cleanup = captureWheelForPageScroll(container);
    const listener = addEventListener.mock.calls[0]?.[1] as (event: WheelEvent) => void;
    const event = {
      stopPropagation: vi.fn(),
      preventDefault: vi.fn(),
    } as unknown as WheelEvent;

    expect(addEventListener).toHaveBeenCalledWith(
      "wheel",
      listener,
      { capture: true, passive: true },
    );
    listener(event);
    expect(event.stopPropagation).toHaveBeenCalledOnce();
    expect(event.preventDefault).not.toHaveBeenCalled();

    cleanup();
    expect(removeEventListener).toHaveBeenCalledWith(
      "wheel",
      listener,
      { capture: true, passive: true },
    );
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
  addTimelineAreas(dataset);
  return dataset;
}

function addTimelineAreas(dataset: EnergyLogDataset) {
  dataset.segments.modes = [{
    startUs: 0,
    endUs: 1_000_000,
    durationSeconds: 1,
    mode: "autonomous",
    isPractice: false,
  }];
  dataset.segments.brownouts = [{ startUs: 400_000, endUs: 500_000, durationSeconds: 0.1 }];
}

function optionView(option: unknown) {
  return option as {
    dataZoom: Array<{ id?: string }>;
    series: Array<{
      id?: string;
      data?: Array<[number, number]>;
      step?: "end";
      emphasis?: { disabled?: boolean };
      silent?: boolean;
      markArea?: { data?: unknown[] };
    }>;
  };
}

function robotOptionView(option: unknown) {
  return option as {
    dataZoom: Array<{ id?: string }>;
    grid: unknown[];
    xAxis: unknown[];
    yAxis: Array<{ min?: number; max?: number }>;
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
