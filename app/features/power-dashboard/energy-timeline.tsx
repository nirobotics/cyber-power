import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ECharts, EChartsOption } from "echarts";
import { getInitialTheme, THEME_EVENT, type ThemeMode } from "../../lib/theme";
import type {
  EnergyLogDataset,
  NumericSeries,
  RangeAnalysis,
  SubsystemNode,
} from "../log-analysis/core";

const COLORS = {
  voltage: "#f5b82e",
  current: "#49c3df",
  power: "#5b8ff9",
  energy: "#b084ff",
  subsystem: ["#9b7cff", "#ef5b5b", "#55c2b0", "#f58a35", "#9acb34"],
};

const CHART_THEME = {
  dark: {
    text: "#c9d1df",
    muted: "#8390a7",
    grid: "rgba(128, 143, 170, .14)",
    tooltipBackground: "rgba(10, 19, 32, .96)",
    tooltipBorder: "#33435e",
    tooltipText: "#f4f7fb",
    zoomBackground: "#0d1828",
    zoomBorder: "#2b3950",
    zoomFill: "rgba(91, 143, 249, .16)",
  },
  light: {
    text: "#272333",
    muted: "#6b6875",
    grid: "rgba(94, 84, 116, .14)",
    tooltipBackground: "rgba(255, 255, 255, .98)",
    tooltipBorder: "#cbc5d8",
    tooltipText: "#17151f",
    zoomBackground: "#f7f7fa",
    zoomBorder: "#d5d0df",
    zoomFill: "rgba(91, 53, 213, .13)",
  },
} as const;

type SubsystemMetric = "power" | "current" | "energy";

export function EnergyTimeline({
  dataset,
  analysis,
  onRangeChange,
}: {
  dataset: EnergyLogDataset;
  analysis: RangeAnalysis;
  onRangeChange: (startUs: number, endUs: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ECharts | null>(null);
  const [subsystemMetric, setSubsystemMetric] = useState<SubsystemMetric>("power");
  const [cursorSeconds, setCursorSeconds] = useState(() => midpointSeconds(dataset));
  const cursorRef = useRef(cursorSeconds);
  cursorRef.current = cursorSeconds;
  const theme = useSyncExternalStore(subscribeTheme, getInitialTheme, getServerTheme);
  const option = useMemo(
    () => createOption(dataset, analysis, subsystemMetric, theme, cursorRef.current),
    [analysis, dataset, subsystemMetric, theme],
  );
  const optionRef = useRef(option);
  optionRef.current = option;

  useEffect(() => {
    setCursorSeconds(midpointSeconds(dataset));
  }, [dataset]);

  useEffect(() => {
    let cancelled = false;
    let resizeObserver: ResizeObserver | undefined;

    void import("echarts").then((echarts) => {
      if (cancelled || !containerRef.current) return;
      const chart = echarts.init(containerRef.current, undefined, { renderer: "canvas" });
      chartRef.current = chart;
      chart.setOption(optionRef.current, { notMerge: true });
      chart.dispatchAction({
        type: "updateAxisPointer",
        xAxisIndex: 4,
        value: midpointSeconds(dataset),
      });

      chart.on("datazoom", (...args: unknown[]) => {
        const event = args[0] as DataZoomEvent;
        const zoom = event.batch?.[0] ?? event;
        const start = zoom.start ?? 0;
        const end = zoom.end ?? 100;
        const lower = dataset.bounds.energyStartUs;
        const span = dataset.bounds.energyEndUs - lower;
        onRangeChange(lower + (span * start) / 100, lower + (span * end) / 100);
      });

      chart.on("updateAxisPointer", (...args: unknown[]) => {
        const event = args[0] as AxisPointerEvent;
        const axis = event.axesInfo?.find((candidate) => candidate.axisDim === "x");
        if (typeof axis?.value === "number" && Number.isFinite(axis.value)) {
          setCursorSeconds(axis.value);
        }
      });

      resizeObserver = new ResizeObserver(() => chart.resize());
      resizeObserver.observe(containerRef.current);
    });

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, [dataset, onRangeChange]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.setOption(option, { notMerge: true, lazyUpdate: true });
  }, [option]);

  const updateCursor = (value: number) => {
    const startSeconds = dataset.bounds.energyStartUs / 1_000_000;
    const endSeconds = dataset.bounds.energyEndUs / 1_000_000;
    const nextValue = Math.max(startSeconds, Math.min(endSeconds, value));
    setCursorSeconds(nextValue);
    chartRef.current?.dispatchAction({
      type: "updateAxisPointer",
      xAxisIndex: 4,
      value: nextValue,
    });
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2">
        <div className="inline-flex rounded-md border border-line bg-surface-2 p-0.5" aria-label="Subsystem timeline metric">
          {(["power", "current", "energy"] as const).map((metric) => (
            <button
              key={metric}
              type="button"
              aria-pressed={subsystemMetric === metric}
              className={[
                "rounded px-2.5 py-1 text-[11px] font-medium capitalize transition",
                subsystemMetric === metric ? "bg-brand text-brand-fg" : "text-ink-dim hover:text-ink",
              ].join(" ")}
              onClick={() => setSubsystemMetric(metric)}
            >
              {metric[0].toUpperCase() + metric.slice(1)}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-[11px] text-ink-dim">
          Cursor
          <input
            type="number"
            min={dataset.bounds.energyStartUs / 1_000_000}
            max={dataset.bounds.energyEndUs / 1_000_000}
            step="0.001"
            value={cursorSeconds.toFixed(3)}
            onChange={(event) => {
              const value = Number(event.currentTarget.value);
              if (Number.isFinite(value)) updateCursor(value);
            }}
            className="w-28 rounded border border-line bg-surface px-2 py-1 font-mono text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
            aria-label="Timeline cursor in seconds"
          />
          <span className="font-mono text-ink-faint">s</span>
        </label>
      </div>
      <div
        ref={containerRef}
        className="h-[680px] min-h-[620px] w-full"
        role="img"
        aria-label="Linked battery voltage, total current, total power, cumulative energy, and subsystem timeline with draggable cursor and range handles"
      />
    </div>
  );
}

function createOption(
  dataset: EnergyLogDataset,
  analysis: RangeAnalysis,
  subsystemMetric: SubsystemMetric,
  theme: ThemeMode,
  cursorSeconds: number,
): EChartsOption {
  const palette = CHART_THEME[theme];
  const startSeconds = dataset.bounds.energyStartUs / 1_000_000;
  const endSeconds = dataset.bounds.energyEndUs / 1_000_000;
  const selectedStart = percent(analysis.range.startUs, dataset.bounds.energyStartUs, dataset.bounds.energyEndUs);
  const selectedEnd = percent(analysis.range.endUs, dataset.bounds.energyStartUs, dataset.bounds.energyEndUs);
  const nodesById = new Map(dataset.subsystems.map((node) => [node.id, node]));
  const topSubsystems = [...analysis.subsystems]
    .filter((item) => nodesById.get(item.id)?.depth === 0)
    .sort((a, b) => b.energyWh - a.energyWh)
    .slice(0, 5)
    .map((item, index) => ({
      node: nodesById.get(item.id),
      color: COLORS.subsystem[index],
    }))
    .filter((entry): entry is { node: SubsystemNode; color: string } => entry.node !== undefined);

  const axisCommon = {
    type: "value" as const,
    min: startSeconds,
    max: endSeconds,
    axisLine: { show: false },
    axisTick: { show: false },
    splitLine: { lineStyle: { color: palette.grid } },
    axisLabel: { color: palette.muted, fontSize: 10 },
    axisPointer: {
      show: true,
      value: cursorSeconds,
      snap: false,
      triggerTooltip: true,
      lineStyle: { color: "#91a7ff", width: 1 },
      label: { show: true, color: palette.tooltipText, backgroundColor: palette.tooltipBorder },
    },
  };

  const labelAxis = (name: string, color: string, gridIndex: number) => ({
    type: "value" as const,
    gridIndex,
    name,
    nameLocation: "middle" as const,
    nameGap: 40,
    nameTextStyle: { color, fontSize: 10, fontWeight: 600 },
    axisLabel: { color: palette.muted, fontSize: 10 },
    axisLine: { show: false },
    axisTick: { show: false },
    splitLine: { lineStyle: { color: palette.grid } },
  });

  const areas = timelineAreas(dataset, theme);
  const line = (
    name: string,
    data: Array<[number, number]>,
    color: string,
    xAxisIndex: number,
    yAxisIndex: number,
    withAreas = false,
  ) => ({
    name,
    type: "line" as const,
    data,
    xAxisIndex,
    yAxisIndex,
    showSymbol: false,
    animation: false,
    lineStyle: { width: 1.3, color },
    itemStyle: { color },
    emphasis: { focus: "series" as const, lineStyle: { width: 2 } },
    ...(withAreas && areas.length > 0
      ? { markArea: { silent: true, label: { show: xAxisIndex === 0 }, data: areas } }
      : {}),
  });

  const subsystemConfig = {
    power: { label: "Subsystem W", unit: "W", series: (node: SubsystemNode) => node.powerW },
    current: { label: "Subsystem A", unit: "A", series: (node: SubsystemNode) => node.currentA },
    energy: { label: "Subsystem Wh", unit: "Wh", series: (node: SubsystemNode) => node.energyWh },
  }[subsystemMetric];

  const xAxisIndexes = [0, 1, 2, 3, 4];
  return {
    backgroundColor: "transparent",
    animation: false,
    color: [COLORS.voltage, COLORS.current, COLORS.power, COLORS.energy, ...COLORS.subsystem],
    textStyle: { fontFamily: "Inter, Segoe UI, sans-serif", color: palette.text },
    axisPointer: { link: [{ xAxisIndex: xAxisIndexes }] },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "line" },
      borderWidth: 1,
      borderColor: palette.tooltipBorder,
      backgroundColor: palette.tooltipBackground,
      textStyle: { color: palette.tooltipText, fontSize: 11 },
      valueFormatter: (value) => typeof value === "number" ? value.toFixed(3) : String(value),
    },
    legend: {
      type: "scroll",
      top: 0,
      left: 56,
      right: 12,
      icon: "roundRect",
      itemWidth: 12,
      itemHeight: 3,
      pageIconColor: COLORS.energy,
      pageTextStyle: { color: palette.muted },
      textStyle: { color: palette.muted, fontSize: 10 },
    },
    grid: [
      { left: 64, right: 18, top: 38, height: 82 },
      { left: 64, right: 18, top: 148, height: 82 },
      { left: 64, right: 18, top: 258, height: 82 },
      { left: 64, right: 18, top: 368, height: 82 },
      { left: 64, right: 18, top: 478, height: 92 },
    ],
    xAxis: xAxisIndexes.map((gridIndex) => ({
      ...axisCommon,
      gridIndex,
      axisPointer: gridIndex === 4
        ? {
            ...axisCommon.axisPointer,
            handle: {
              show: true,
              color: COLORS.energy,
              margin: 24,
              size: 18,
              shadowBlur: 3,
              shadowColor: "rgba(0, 0, 0, .25)",
            },
          }
        : axisCommon.axisPointer,
      axisLabel: gridIndex === 4
        ? { color: palette.muted, fontSize: 10, formatter: (value: number) => `${value.toFixed(0)}s` }
        : { show: false },
    })),
    yAxis: [
      labelAxis("Voltage (V)", COLORS.voltage, 0),
      labelAxis("Current (A)", COLORS.current, 1),
      labelAxis("Power (W)", COLORS.power, 2),
      labelAxis("Energy (Wh)", COLORS.energy, 3),
      labelAxis(subsystemConfig.label, COLORS.subsystem[0], 4),
    ],
    dataZoom: [
      { type: "inside", xAxisIndex: xAxisIndexes, start: selectedStart, end: selectedEnd, filterMode: "none" },
      {
        type: "slider",
        xAxisIndex: xAxisIndexes,
        start: selectedStart,
        end: selectedEnd,
        bottom: 5,
        height: 28,
        borderColor: palette.zoomBorder,
        backgroundColor: palette.zoomBackground,
        fillerColor: palette.zoomFill,
        handleStyle: { color: COLORS.energy, borderColor: theme === "dark" ? "#d9d0ff" : "#5b35d5" },
        textStyle: { color: palette.muted, fontSize: 10 },
        labelFormatter: (value: number) => `${value.toFixed(1)}s`,
      },
    ],
    series: [
      line("Battery voltage", seriesPairs(dataset.series.batteryVoltageV), COLORS.voltage, 0, 0, true),
      line("Total current", seriesPairs(dataset.series.totalCurrentA), COLORS.current, 1, 1, true),
      line("Total power", seriesPairs(dataset.series.totalPowerW), COLORS.power, 2, 2, true),
      line("Total energy", relativeEnergyPairs(dataset.series.totalEnergyWh), COLORS.energy, 3, 3, true),
      ...topSubsystems.map(({ node, color }, index) =>
        line(
          `${node.displayName} (${subsystemConfig.unit})`,
          subsystemMetric === "energy"
            ? relativeEnergyPairs(subsystemConfig.series(node))
            : seriesPairs(subsystemConfig.series(node)),
          color,
          4,
          4,
          index === 0,
        ),
      ),
    ],
  };
}

export function seriesPairs(series?: NumericSeries, maxPoints = 8_000): Array<[number, number]> {
  if (!series) return [];
  const { timestampsUs, values } = series;
  if (values.length <= maxPoints) {
    return Array.from(values, (value, index) => [timestampsUs[index] / 1_000_000, value]);
  }

  const result: Array<[number, number]> = [[timestampsUs[0] / 1_000_000, values[0]]];
  const bucketCount = Math.max(1, Math.floor((maxPoints - 2) / 2));
  const bucketSize = Math.ceil((values.length - 2) / bucketCount);
  for (let start = 1; start < values.length - 1; start += bucketSize) {
    const end = Math.min(values.length - 1, start + bucketSize);
    let minIndex = start;
    let maxIndex = start;
    for (let index = start + 1; index < end; index += 1) {
      if (values[index] < values[minIndex]) minIndex = index;
      if (values[index] > values[maxIndex]) maxIndex = index;
    }
    for (const index of minIndex < maxIndex ? [minIndex, maxIndex] : [maxIndex, minIndex]) {
      if (result.at(-1)?.[0] !== timestampsUs[index] / 1_000_000) {
        result.push([timestampsUs[index] / 1_000_000, values[index]]);
      }
    }
  }
  const last = values.length - 1;
  if (result.at(-1)?.[0] !== timestampsUs[last] / 1_000_000) {
    result.push([timestampsUs[last] / 1_000_000, values[last]]);
  }
  return result;
}

function relativeEnergyPairs(series?: NumericSeries) {
  const pairs = seriesPairs(series);
  const baseline = pairs[0]?.[1] ?? 0;
  return pairs.map(([time, value]) => [time, value - baseline] as [number, number]);
}

function percent(value: number, min: number, max: number) {
  if (max <= min) return 0;
  return Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
}

function midpointSeconds(dataset: EnergyLogDataset) {
  return (dataset.bounds.energyStartUs + dataset.bounds.energyEndUs) / 2_000_000;
}

function timelineAreas(dataset: EnergyLogDataset, theme: ThemeMode) {
  const modeColors = theme === "dark"
    ? {
        disabled: "rgba(126, 139, 157, .07)",
        autonomous: "rgba(155, 124, 255, .13)",
        teleop: "rgba(85, 194, 176, .10)",
        enabled: "rgba(73, 195, 223, .09)",
      }
    : {
        disabled: "rgba(91, 83, 108, .06)",
        autonomous: "rgba(91, 53, 213, .10)",
        teleop: "rgba(20, 122, 61, .08)",
        enabled: "rgba(37, 99, 235, .08)",
      };
  const labels = {
    disabled: "DISABLED",
    autonomous: "AUTO",
    teleop: "TELEOP",
    enabled: "ENABLED",
  } as const;

  const modeAreas: TimelineArea[] = dataset.segments.modes.map((segment) => [
      {
        name: labels[segment.mode],
        xAxis: segment.startUs / 1_000_000,
        itemStyle: { color: modeColors[segment.mode] },
        label: { color: CHART_THEME[theme].muted, fontSize: 8, position: "insideTop" as const },
      },
      { xAxis: segment.endUs / 1_000_000 },
    ]);
  const brownoutAreas: TimelineArea[] = dataset.segments.brownouts.map((segment) => [
      {
        name: "BROWNOUT",
        xAxis: segment.startUs / 1_000_000,
        itemStyle: { color: "rgba(239, 68, 68, .18)" },
        label: { color: "#ef5b5b", fontSize: 8, position: "insideTop" as const },
      },
      { xAxis: segment.endUs / 1_000_000 },
    ]);
  return [...modeAreas, ...brownoutAreas];
}

function subscribeTheme(onStoreChange: () => void) {
  globalThis.addEventListener(THEME_EVENT, onStoreChange);
  globalThis.addEventListener("storage", onStoreChange);
  const colorScheme = globalThis.matchMedia?.("(prefers-color-scheme: dark)");
  colorScheme?.addEventListener("change", onStoreChange);
  return () => {
    globalThis.removeEventListener(THEME_EVENT, onStoreChange);
    globalThis.removeEventListener("storage", onStoreChange);
    colorScheme?.removeEventListener("change", onStoreChange);
  };
}

function getServerTheme(): ThemeMode {
  return "dark";
}

interface DataZoomEvent {
  start?: number;
  end?: number;
  batch?: Array<{ start?: number; end?: number }>;
}

interface AxisPointerEvent {
  axesInfo?: Array<{ axisDim?: string; axisIndex?: number; value?: number }>;
}

type TimelineArea = [
  {
    name: string;
    xAxis: number;
    itemStyle: { color: string };
    label: { color: string; fontSize: number; position: "insideTop" };
  },
  { xAxis: number },
];
