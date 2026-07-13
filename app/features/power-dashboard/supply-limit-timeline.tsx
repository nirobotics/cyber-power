import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { ECharts, EChartsOption } from "echarts";
import { getInitialTheme, THEME_EVENT, type ThemeMode } from "../../lib/theme";
import type {
  EnergyLogDataset,
  SupplyLimitEstimate,
  TimeRange,
} from "../log-analysis/core";
import {
  bindTimelinePointerInteractions,
  captureWheelForPageScroll,
  isEchoedLocalPreview,
  syncCursor,
} from "./energy-timeline";

const COLORS = {
  observed: "#49c3df",
  estimated: "#b084ff",
  limit: "#f5b82e",
};

const CHART_THEME = {
  dark: {
    text: "#c9d1df",
    muted: "#8390a7",
    grid: "rgba(128, 143, 170, .14)",
    tooltipBackground: "rgba(10, 19, 32, .96)",
    tooltipBorder: "#33435e",
    tooltipText: "#f4f7fb",
  },
  light: {
    text: "#272333",
    muted: "#6b6875",
    grid: "rgba(94, 84, 116, .14)",
    tooltipBackground: "rgba(255, 255, 255, .98)",
    tooltipBorder: "#cbc5d8",
    tooltipText: "#17151f",
  },
} as const;

export type SupplyLimitTimelineMetric = "total-current" | "total-power" | "energy" | "target-current";

const CHARTS = [
  {
    metric: "total-current",
    label: "整机总电流",
    ariaLabel: "限流估算整机总电流时间图",
    zoomId: "supply-limit-total-current-range",
  },
  {
    metric: "total-power",
    label: "整机总功率",
    ariaLabel: "限流估算整机总功率时间图",
    zoomId: "supply-limit-total-power-range",
  },
  {
    metric: "energy",
    label: "累计能量",
    ariaLabel: "限流估算累计能量时间图",
    zoomId: "supply-limit-energy-range",
  },
  {
    metric: "target-current",
    label: "当前目标电流",
    ariaLabel: "限流估算当前目标电流时间图",
    zoomId: "supply-limit-target-current-range",
  },
] as const satisfies ReadonlyArray<{
  metric: SupplyLimitTimelineMetric;
  label: string;
  ariaLabel: string;
  zoomId: string;
}>;

export function SupplyLimitTimeline({
  dataset,
  estimate,
  selectedTargetId,
  range,
  cursorUs,
  cursorPreviewActive,
  onCursorPreview,
  onCursorCommit,
}: {
  dataset: EnergyLogDataset;
  estimate: SupplyLimitEstimate;
  selectedTargetId: string | null;
  range: TimeRange;
  cursorUs: number;
  cursorPreviewActive: boolean;
  onCursorPreview: (cursorUs: number | null) => void;
  onCursorCommit: (cursorUs: number) => void;
}) {
  const theme = useSyncExternalStore(subscribeTheme, getInitialTheme, getServerTheme);
  const selectedNode = dataset.subsystems.find((node) => node.id === selectedTargetId);
  const selectedEstimate = estimate.targets.find((target) => target.nodeId === selectedTargetId);
  const options = useMemo(
    () => Object.fromEntries(CHARTS.map(({ metric, zoomId }) => [
      metric,
      createSupplyLimitTimelineOption(dataset, estimate, metric, selectedTargetId, theme, zoomId),
    ])) as Record<SupplyLimitTimelineMetric, EChartsOption>,
    [dataset, estimate, selectedTargetId, theme],
  );

  return (
    <div className="grid gap-2.5" aria-label="多子系统 Supply 电流限流估算图表">
      <section className="card flex flex-wrap gap-x-4 gap-y-2 px-4 py-3" aria-label="限流估算曲线图例">
        <LegendItem label="实测" color={COLORS.observed} />
        <LegendItem label="估算" color={COLORS.estimated} dashed />
        <LegendItem label="输入上限（仅当前目标图）" color={COLORS.limit} dashed />
      </section>

      {CHARTS.map(({ metric, label, ariaLabel, zoomId }) => {
        const isTarget = metric === "target-current";
        const totalUnavailable = !isTarget && metric !== "energy"
          ? estimate.timeline[metric === "total-current" ? "estimatedTotalCurrentA" : "estimatedTotalPowerW"] === undefined
          : metric === "energy" && estimate.timeline.estimatedTotalEnergyWh === undefined;
        const targetUnavailable = isTarget && (!selectedNode || !selectedEstimate);
        return (
          <section key={metric} className="card min-w-0 overflow-hidden" aria-label={label}>
            <div className="flex min-h-10 items-center justify-between gap-3 border-b border-line px-4 py-2.5">
              <h2 className="min-w-0 truncate text-xs font-semibold text-ink">
                {label}
                {isTarget && selectedNode ? (
                  <span className="ml-2 font-mono font-normal text-ink-dim" title={selectedNode.rawPath}>
                    {selectedNode.rawPath}
                  </span>
                ) : null}
              </h2>
              {totalUnavailable ? (
                <span className="shrink-0 text-[10px] text-warn">整机估算不可用</span>
              ) : null}
            </div>
            {targetUnavailable ? (
              <div className="flex h-[300px] min-h-[260px] items-center justify-center px-4 text-sm text-ink-dim">
                请选择一个已应用的限流目标。
              </div>
            ) : (
              <ControlledTimelineChart
                dataset={dataset}
                option={options[metric]}
                zoomId={zoomId}
                range={range}
                cursorUs={cursorUs}
                cursorPreviewActive={cursorPreviewActive}
                onCursorPreview={onCursorPreview}
                onCursorCommit={onCursorCommit}
                ariaLabel={ariaLabel}
              />
            )}
          </section>
        );
      })}
    </div>
  );
}

function LegendItem({ label, color, dashed = false }: { label: string; color: string; dashed?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-ink-dim">
      <span
        className={`h-0 w-4 border-t-2${dashed ? " border-dashed" : ""}`}
        style={{ borderColor: color }}
        aria-hidden
      />
      {label}
    </span>
  );
}

function ControlledTimelineChart({
  dataset,
  option,
  zoomId,
  range,
  cursorUs,
  cursorPreviewActive,
  onCursorPreview,
  onCursorCommit,
  ariaLabel,
}: {
  dataset: EnergyLogDataset;
  option: EChartsOption;
  zoomId: string;
  range: TimeRange;
  cursorUs: number;
  cursorPreviewActive: boolean;
  onCursorPreview: (cursorUs: number | null) => void;
  onCursorCommit: (cursorUs: number) => void;
  ariaLabel: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ECharts | null>(null);
  const optionRef = useRef(option);
  const rangeRef = useRef(range);
  const cursorRef = useRef(cursorUs);
  const previewCallbackRef = useRef(onCursorPreview);
  const commitCallbackRef = useRef(onCursorCommit);
  const syncingCursorRef = useRef(false);
  const localPreviewRef = useRef<number | null>(null);
  optionRef.current = option;
  rangeRef.current = range;
  cursorRef.current = cursorUs;
  previewCallbackRef.current = onCursorPreview;
  commitCallbackRef.current = onCursorCommit;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    return captureWheelForPageScroll(container);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let resizeObserver: ResizeObserver | undefined;
    let cleanupPointerInteractions: (() => void) | undefined;

    void import("echarts").then((echarts) => {
      if (cancelled || !containerRef.current) return;
      const chart = echarts.init(containerRef.current, undefined, { renderer: "canvas" });
      chartRef.current = chart;
      chart.setOption(optionRef.current, { notMerge: true });
      syncRange(chart, zoomId, rangeRef.current, dataset);
      syncCursor(chart, 0, cursorRef.current, null, syncingCursorRef);
      cleanupPointerInteractions = bindTimelinePointerInteractions(
        chart,
        containerRef.current,
        0,
        syncingCursorRef,
        localPreviewRef,
        (nextUs) => previewCallbackRef.current(nextUs),
        (nextUs) => commitCallbackRef.current(nextUs),
      );
      resizeObserver = new ResizeObserver(() => chart.resize());
      resizeObserver.observe(containerRef.current);
    });

    return () => {
      cancelled = true;
      cleanupPointerInteractions?.();
      resizeObserver?.disconnect();
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, [dataset, zoomId]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.setOption(option, { notMerge: true, lazyUpdate: true });
    syncRange(chart, zoomId, rangeRef.current, dataset);
    syncCursor(chart, 0, cursorRef.current, null, syncingCursorRef);
  }, [dataset, option, zoomId]);

  useEffect(() => {
    if (chartRef.current) syncRange(chartRef.current, zoomId, range, dataset);
  }, [dataset, range, zoomId]);

  useEffect(() => {
    const originatedHere = isEchoedLocalPreview(cursorPreviewActive, localPreviewRef.current, cursorUs);
    if (!originatedHere && chartRef.current) {
      localPreviewRef.current = null;
      syncCursor(chartRef.current, 0, cursorUs, null, syncingCursorRef);
    }
  }, [cursorPreviewActive, cursorUs]);

  return (
    <div
      ref={containerRef}
      className="h-[300px] min-h-[260px] w-full cursor-default [&_*]:!cursor-default"
      role="img"
      aria-label={ariaLabel}
    />
  );
}

export function createSupplyLimitTimelineOption(
  dataset: EnergyLogDataset,
  estimate: SupplyLimitEstimate,
  metric: SupplyLimitTimelineMetric,
  selectedTargetId: string | null,
  theme: ThemeMode,
  zoomId: string,
): EChartsOption {
  const palette = CHART_THEME[theme];
  const timeline = estimate.timeline;
  const selectedTimeline = timeline.targets.find((target) => target.nodeId === selectedTargetId);
  const selectedEstimate = estimate.targets.find((target) => target.nodeId === selectedTargetId);
  const config = metricConfig(metric, timeline, selectedTimeline);
  const areas = timelineAreas(dataset, theme);
  const [observedData, estimatedData] = comparisonTimelinePairs(
    timeline.timestampsUs,
    config.observed,
    config.estimated,
  );
  const observed = comparisonSeries(
    `${metric}-observed`,
    "实测",
    observedData,
    COLORS.observed,
    areas,
    config.stepped,
    false,
    metric === "target-current" ? selectedEstimate?.limitA : undefined,
  );

  return {
    backgroundColor: "transparent",
    animation: false,
    textStyle: { fontFamily: "Inter, Segoe UI, Microsoft YaHei, sans-serif", color: palette.text },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "line" },
      borderWidth: 1,
      borderColor: palette.tooltipBorder,
      backgroundColor: palette.tooltipBackground,
      textStyle: { color: palette.tooltipText, fontSize: 11 },
      valueFormatter: (value: unknown) => typeof value === "number" ? value.toFixed(3) : String(value),
    },
    grid: [{ left: 64, right: 18, top: 20, bottom: 44 }],
    xAxis: [{
      type: "value",
      min: dataset.bounds.energyStartUs / 1_000_000,
      max: dataset.bounds.energyEndUs / 1_000_000,
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: palette.grid } },
      axisLabel: { color: palette.muted, fontSize: 10, formatter: (value: number) => `${value.toFixed(0)}s` },
      axisPointer: {
        show: true,
        snap: false,
        triggerTooltip: true,
        lineStyle: { color: "#91a7ff", width: 1 },
        label: {
          show: true,
          color: palette.tooltipText,
          backgroundColor: palette.tooltipBorder,
          formatter: ({ value }: { value?: unknown }) =>
            typeof value === "number" ? `${value.toFixed(3)}s` : String(value ?? ""),
        },
      },
    }],
    yAxis: [{
      type: "value",
      min: 0,
      name: config.axisLabel,
      nameLocation: "middle",
      nameGap: 42,
      nameTextStyle: { color: COLORS.observed, fontSize: 10, fontWeight: 600 },
      axisLabel: { color: palette.muted, fontSize: 10 },
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: palette.grid } },
    }],
    dataZoom: [{
      id: zoomId,
      type: "inside",
      xAxisIndex: [0],
      start: 0,
      end: 100,
      filterMode: "none",
      zoomOnMouseWheel: false,
      moveOnMouseMove: false,
      moveOnMouseWheel: false,
    }],
    series: [
      observed,
      ...(config.estimated
        ? [comparisonSeries(
            `${metric}-estimated`,
            "估算",
            estimatedData,
            COLORS.estimated,
            [],
            config.stepped,
            true,
          )]
        : []),
    ],
  };
}

function metricConfig(
  metric: SupplyLimitTimelineMetric,
  timeline: SupplyLimitEstimate["timeline"],
  selectedTarget: SupplyLimitEstimate["timeline"]["targets"][number] | undefined,
) {
  switch (metric) {
    case "total-current":
      return {
        observed: timeline.observedTotalCurrentA,
        estimated: timeline.estimatedTotalCurrentA,
        axisLabel: "整机总电流 (A)",
        stepped: true,
      };
    case "total-power":
      return {
        observed: timeline.observedTotalPowerW,
        estimated: timeline.estimatedTotalPowerW,
        axisLabel: "整机总功率 (W)",
        stepped: true,
      };
    case "energy":
      return {
        observed: timeline.observedTotalEnergyWh,
        estimated: timeline.estimatedTotalEnergyWh,
        axisLabel: "累计能量 (Wh)",
        stepped: false,
      };
    case "target-current":
      return {
        observed: selectedTarget?.observedCurrentA,
        estimated: selectedTarget?.estimatedCurrentA,
        axisLabel: "目标总 Supply 电流 (A)",
        stepped: true,
      };
  }
}

function comparisonSeries(
  id: string,
  name: string,
  data: Array<[number, number]>,
  color: string,
  areas: TimelineArea[],
  stepped: boolean,
  dashed = false,
  limitA?: number,
) {
  return {
    id,
    name,
    type: "line" as const,
    data,
    xAxisIndex: 0,
    yAxisIndex: 0,
    showSymbol: false,
    animation: false,
    ...(stepped ? { step: "end" as const } : {}),
    lineStyle: { width: 1.4, color, ...(dashed ? { type: "dashed" as const } : {}) },
    itemStyle: { color },
    emphasis: { disabled: true },
    ...(areas.length > 0
      ? { markArea: { silent: true, label: { show: false }, data: areas } }
      : {}),
    ...(limitA === undefined
      ? {}
      : {
          markLine: {
            silent: true,
            symbol: ["none", "none"],
            label: { show: true, formatter: `${limitA.toFixed(1)} A`, color: COLORS.limit },
            lineStyle: { color: COLORS.limit, type: "dashed" as const, width: 1.2 },
            data: [{ yAxis: limitA }],
          },
        }),
  };
}

export function timelinePairs(
  timestampsUs: Float64Array,
  values: Float64Array | undefined,
  maxPoints = 8_000,
): Array<[number, number]> {
  return comparisonTimelinePairs(timestampsUs, values, undefined, maxPoints)[0];
}

export function comparisonTimelinePairs(
  timestampsUs: Float64Array,
  observed: Float64Array | undefined,
  estimated: Float64Array | undefined,
  maxPoints = 8_000,
): [Array<[number, number]>, Array<[number, number]>] {
  if (!observed || observed.length === 0 || timestampsUs.length === 0) return [[], []];
  const length = Math.min(
    timestampsUs.length,
    observed.length,
    estimated?.length ?? Number.POSITIVE_INFINITY,
  );
  const series = estimated ? [observed, estimated] : [observed];
  const indices = sharedTimelineIndices(series, length, maxPoints);
  const pairs = (values: Float64Array | undefined) => values
    ? indices.map((index) => [timestampsUs[index] / 1_000_000, values[index]] as [number, number])
    : [];
  return [pairs(observed), pairs(estimated)];
}

function sharedTimelineIndices(
  series: readonly Float64Array[],
  length: number,
  maxPoints: number,
): number[] {
  if (length <= 0) return [];
  if (length <= maxPoints) return Array.from({ length }, (_unused, index) => index);
  if (maxPoints <= 1) return [0];
  if (maxPoints < 4) return [0, length - 1].slice(0, maxPoints);

  const result = [0];
  const extremaPerBucket = series.length * 2;
  const bucketCount = Math.max(1, Math.floor((maxPoints - 2) / extremaPerBucket));
  const bucketSize = Math.ceil((length - 2) / bucketCount);
  for (let start = 1; start < length - 1; start += bucketSize) {
    const end = Math.min(length - 1, start + bucketSize);
    const bucketIndices = new Set<number>();
    for (const values of series) {
      let minimum = start;
      let maximum = start;
      for (let index = start + 1; index < end; index += 1) {
        if (values[index] < values[minimum]) minimum = index;
        if (values[index] > values[maximum]) maximum = index;
      }
      bucketIndices.add(minimum);
      bucketIndices.add(maximum);
    }
    result.push(...[...bucketIndices].sort((left, right) => left - right));
  }
  result.push(length - 1);
  return [...new Set(result)];
}

function syncRange(chart: ECharts, zoomId: string, range: TimeRange, dataset: EnergyLogDataset) {
  chart.dispatchAction({
    type: "dataZoom",
    dataZoomId: zoomId,
    start: percent(range.startUs, dataset.bounds.energyStartUs, dataset.bounds.energyEndUs),
    end: percent(range.endUs, dataset.bounds.energyStartUs, dataset.bounds.energyEndUs),
  });
}

function percent(value: number, minimum: number, maximum: number) {
  if (maximum <= minimum) return 0;
  return Math.max(0, Math.min(100, ((value - minimum) / (maximum - minimum)) * 100));
}

function timelineAreas(dataset: EnergyLogDataset, theme: ThemeMode): TimelineArea[] {
  const modeColors = theme === "dark"
    ? {
        disabled: "rgba(126, 139, 157, .07)",
        autonomous: "rgba(155, 124, 255, .13)",
        teleop: "rgba(85, 194, 176, .10)",
        enabled: "rgba(73, 195, 223, .09)",
        test: "rgba(251, 146, 60, .10)",
      }
    : {
        disabled: "rgba(91, 83, 108, .06)",
        autonomous: "rgba(91, 53, 213, .10)",
        teleop: "rgba(20, 122, 61, .08)",
        enabled: "rgba(37, 99, 235, .08)",
        test: "rgba(234, 88, 12, .08)",
      };
  const modes: TimelineArea[] = dataset.segments.modes.map((segment) => [
    {
      xAxis: segment.startUs / 1_000_000,
      itemStyle: { color: modeColors[segment.mode] },
      label: { show: false },
    },
    { xAxis: segment.endUs / 1_000_000 },
  ]);
  const brownouts: TimelineArea[] = dataset.segments.brownouts.map((segment) => [
    {
      xAxis: segment.startUs / 1_000_000,
      itemStyle: { color: "rgba(239, 68, 68, .18)" },
      label: { show: false },
    },
    { xAxis: segment.endUs / 1_000_000 },
  ]);
  return [...modes, ...brownouts];
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

type TimelineArea = [
  {
    xAxis: number;
    itemStyle: { color: string };
    label: { show: false };
  },
  { xAxis: number },
];
