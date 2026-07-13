import { Eye, EyeOff } from "lucide-react";
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { ECharts, EChartsOption } from "echarts";
import { getInitialTheme, THEME_EVENT, type ThemeMode } from "../../lib/theme";
import type { EnergyLogDataset, NumericSeries, SubsystemNode, TimeRange } from "../log-analysis/core";

const COLORS = {
  voltage: "#f5b82e",
  threshold: "#ef5b5b",
  current: "#49c3df",
  power: "#5b8ff9",
  energy: "#b084ff",
  subsystem: [
    "#9b7cff",
    "#ef5b5b",
    "#55c2b0",
    "#f58a35",
    "#9acb34",
    "#f5c542",
    "#5b8ff9",
    "#df5ca6",
    "#4cc9f0",
    "#c084fc",
    "#fb7185",
    "#2dd4bf",
  ],
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

export type SubsystemMetric = "power" | "current" | "energy";
export type RobotMetric = "voltage" | "current" | "power" | "energy";
export type TimelineFocus = "power" | "current" | null;

const ROBOT_CHARTS = [
  {
    metric: "voltage",
    label: "电池电压",
    zoomId: "robot-voltage-time-range",
    ariaLabel: "机器人电池电压时间图",
    focus: null,
  },
  {
    metric: "current",
    label: "总电流",
    zoomId: "robot-current-time-range",
    ariaLabel: "机器人总电流时间图",
    focus: "current",
  },
  {
    metric: "power",
    label: "总功率",
    zoomId: "robot-power-time-range",
    ariaLabel: "机器人总功率时间图",
    focus: "power",
  },
  {
    metric: "energy",
    label: "累计能量",
    zoomId: "robot-energy-time-range",
    ariaLabel: "机器人累计能量时间图",
    focus: null,
  },
] as const satisfies ReadonlyArray<{
  metric: RobotMetric;
  label: string;
  zoomId: string;
  ariaLabel: string;
  focus: TimelineFocus;
}>;

const ROBOT_LEGEND_ITEMS = [
  { label: "电池电压", color: COLORS.voltage },
  { label: "总电流", color: COLORS.current },
  { label: "总功率", color: COLORS.power },
  { label: "累计能量", color: COLORS.energy },
] as const;

export function RobotTimeline({
  dataset,
  range,
  cursorUs,
  focus,
  onCursorChange,
}: {
  dataset: EnergyLogDataset;
  range: TimeRange;
  cursorUs: number;
  focus: TimelineFocus;
  onCursorChange: (cursorUs: number) => void;
}) {
  const theme = useSyncExternalStore(subscribeTheme, getInitialTheme, getServerTheme);
  const options = useMemo(
    () => Object.fromEntries(
      ROBOT_CHARTS.map(({ metric, zoomId }) => [metric, createRobotTimelineOption(dataset, metric, theme, zoomId)]),
    ) as Record<RobotMetric, EChartsOption>,
    [dataset, theme],
  );
  const showThreshold = (dataset.series.brownoutVoltageV?.values.length ?? 0) > 0;

  return (
    <div className="grid gap-2.5" aria-label="机器人总状态">
      <section className="card flex flex-wrap gap-x-4 gap-y-2 px-4 py-3" aria-label="整机曲线图例">
        {ROBOT_LEGEND_ITEMS.map((item) => (
          <span key={item.label} className="inline-flex items-center gap-1.5 text-xs text-ink-dim">
            <span className="h-0 w-4 border-t-2" style={{ borderColor: item.color }} aria-hidden />
            {item.label}
          </span>
        ))}
        {showThreshold ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-ink-dim">
            <span className="h-0 w-4 border-t-2 border-dashed" style={{ borderColor: COLORS.threshold }} aria-hidden />
            Brownout 电压阈值
          </span>
        ) : null}
      </section>

      {ROBOT_CHARTS.map(({ metric, label, zoomId, ariaLabel, focus: metricFocus }) => (
        <section key={metric} className="card min-w-0 overflow-hidden" aria-label={`整机${label}`}>
          <div className="border-b border-line px-4 py-2.5">
            <h2 className="text-xs font-semibold text-ink">{label}</h2>
          </div>
          <TimelineChart
            dataset={dataset}
            option={options[metric]}
            zoomId={zoomId}
            cursorAxisIndex={0}
            range={range}
            cursorUs={cursorUs}
            focus={focus === metricFocus ? focus : null}
            onCursorChange={onCursorChange}
            className="h-[300px] min-h-[260px]"
            ariaLabel={ariaLabel}
          />
        </section>
      ))}
    </div>
  );
}

const SUBSYSTEM_CHARTS = [
  { metric: "power", label: "功率", zoomId: "subsystem-power-time-range", ariaLabel: "子系统功率共享时间图" },
  { metric: "current", label: "电流", zoomId: "subsystem-current-time-range", ariaLabel: "子系统电流共享时间图" },
  { metric: "energy", label: "能量", zoomId: "subsystem-energy-time-range", ariaLabel: "子系统能量共享时间图" },
] as const satisfies ReadonlyArray<{
  metric: SubsystemMetric;
  label: string;
  zoomId: string;
  ariaLabel: string;
}>;

export function SubsystemTimelines({
  dataset,
  range,
  cursorUs,
  hiddenSubsystemIds,
  onCursorChange,
  onToggleSubsystem,
}: {
  dataset: EnergyLogDataset;
  range: TimeRange;
  cursorUs: number;
  hiddenSubsystemIds: ReadonlySet<string>;
  onCursorChange: (cursorUs: number) => void;
  onToggleSubsystem: (id: string) => void;
}) {
  const theme = useSyncExternalStore(subscribeTheme, getInitialTheme, getServerTheme);
  const topSubsystems = useMemo(() => topLevelSubsystems(dataset), [dataset]);
  const options = useMemo(
    () => Object.fromEntries(
      SUBSYSTEM_CHARTS.map(({ metric, zoomId }) => [
        metric,
        createSubsystemTimelineOption(dataset, topSubsystems, hiddenSubsystemIds, metric, theme, zoomId),
      ]),
    ) as Record<SubsystemMetric, EChartsOption>,
    [dataset, hiddenSubsystemIds, theme, topSubsystems],
  );

  return (
    <div className="grid gap-2.5">
      <section className="card flex flex-wrap gap-1.5 px-4 py-3" aria-label="子系统曲线显隐">
        {topSubsystems.map((node, index) => {
          const visible = !hiddenSubsystemIds.has(node.id);
          return (
            <button
              key={node.id}
              type="button"
              aria-pressed={visible}
              onClick={() => onToggleSubsystem(node.id)}
              className={[
                "inline-flex max-w-52 items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[10px] transition",
                visible ? "border-line bg-surface-2 text-ink" : "border-transparent bg-surface-2/60 text-ink-faint",
              ].join(" ")}
              title={node.rawPath}
            >
              <span className="size-2 shrink-0 rounded-full" style={{ background: COLORS.subsystem[index % COLORS.subsystem.length] }} />
              <span className="truncate">{node.rawPath}</span>
              {visible ? <Eye className="size-3 shrink-0" aria-hidden /> : <EyeOff className="size-3 shrink-0" aria-hidden />}
            </button>
          );
        })}
      </section>

      {SUBSYSTEM_CHARTS.map(({ metric, label, zoomId, ariaLabel }) => (
        <section key={metric} className="card min-w-0 overflow-hidden" aria-label={`子系统${label}`}>
          <div className="border-b border-line px-4 py-2.5">
            <h2 className="text-xs font-semibold text-ink">{label}</h2>
          </div>
          <TimelineChart
            dataset={dataset}
            option={options[metric]}
            zoomId={zoomId}
            cursorAxisIndex={0}
            range={range}
            cursorUs={cursorUs}
            focus={null}
            onCursorChange={onCursorChange}
            className="h-[300px] min-h-[260px]"
            ariaLabel={ariaLabel}
          />
        </section>
      ))}
    </div>
  );
}

function TimelineChart({
  dataset,
  option,
  zoomId,
  cursorAxisIndex,
  range,
  cursorUs,
  focus,
  onCursorChange,
  className,
  ariaLabel,
}: {
  dataset: EnergyLogDataset;
  option: EChartsOption;
  zoomId: string;
  cursorAxisIndex: number;
  range: TimeRange;
  cursorUs: number;
  focus: TimelineFocus;
  onCursorChange: (cursorUs: number) => void;
  className: string;
  ariaLabel: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ECharts | null>(null);
  const optionRef = useRef(option);
  const rangeRef = useRef(range);
  const cursorRef = useRef(cursorUs);
  const focusRef = useRef(focus);
  const callbackRef = useRef(onCursorChange);
  const syncingCursorRef = useRef(false);
  const localCursorRef = useRef<number | null>(null);
  optionRef.current = option;
  rangeRef.current = range;
  cursorRef.current = cursorUs;
  focusRef.current = focus;
  callbackRef.current = onCursorChange;

  useEffect(() => {
    let cancelled = false;
    let resizeObserver: ResizeObserver | undefined;

    void import("echarts").then((echarts) => {
      if (cancelled || !containerRef.current) return;
      const chart = echarts.init(containerRef.current, undefined, { renderer: "canvas" });
      chartRef.current = chart;
      chart.setOption(optionRef.current, { notMerge: true });
      syncRange(chart, zoomId, rangeRef.current, dataset);
      syncCursor(chart, cursorAxisIndex, cursorRef.current, focusRef.current, syncingCursorRef);
      chart.on("updateAxisPointer", (...args: unknown[]) => {
        if (syncingCursorRef.current) return;
        const event = args[0] as AxisPointerEvent;
        const axis = event.axesInfo?.find((candidate) => candidate.axisDim === "x");
        if (typeof axis?.value !== "number" || !Number.isFinite(axis.value)) return;
        const nextUs = Math.round(axis.value * 1_000_000);
        if (Math.abs(nextUs - cursorRef.current) >= 1) {
          localCursorRef.current = nextUs;
          callbackRef.current(nextUs);
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
  }, [cursorAxisIndex, dataset, zoomId]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.setOption(option, { notMerge: true, lazyUpdate: true });
    syncRange(chart, zoomId, rangeRef.current, dataset);
    syncCursor(chart, cursorAxisIndex, cursorRef.current, focusRef.current, syncingCursorRef);
  }, [cursorAxisIndex, dataset, option, zoomId]);

  useEffect(() => {
    if (chartRef.current) syncRange(chartRef.current, zoomId, range, dataset);
  }, [dataset, range, zoomId]);

  useEffect(() => {
    const originatedHere =
      focus === null &&
      localCursorRef.current !== null &&
      Math.abs(localCursorRef.current - Math.round(cursorUs)) < 1;
    localCursorRef.current = null;
    if (!originatedHere && chartRef.current) {
      syncCursor(chartRef.current, cursorAxisIndex, cursorUs, focus, syncingCursorRef);
    }
  }, [cursorAxisIndex, cursorUs, focus]);

  return <div ref={containerRef} className={`w-full ${className}`} role="img" aria-label={ariaLabel} />;
}

export function createRobotTimelineOption(
  dataset: EnergyLogDataset,
  metric: RobotMetric,
  theme: ThemeMode,
  zoomId: string,
): EChartsOption {
  const palette = CHART_THEME[theme];
  const startSeconds = dataset.bounds.energyStartUs / 1_000_000;
  const endSeconds = dataset.bounds.energyEndUs / 1_000_000;
  const config: Record<RobotMetric, {
    label: string;
    unit: string;
    color: string;
    id: string;
    series: NumericSeries | undefined;
    stepped: boolean;
  }> = {
    voltage: {
      label: "电池电压",
      unit: "V",
      color: COLORS.voltage,
      id: "battery-voltage",
      series: dataset.series.batteryVoltageV,
      stepped: true,
    },
    current: {
      label: "总电流",
      unit: "A",
      color: COLORS.current,
      id: "total-current",
      series: dataset.series.totalCurrentA,
      stepped: true,
    },
    power: {
      label: "总功率",
      unit: "W",
      color: COLORS.power,
      id: "total-power",
      series: dataset.series.totalPowerW,
      stepped: true,
    },
    energy: {
      label: "累计能量",
      unit: "Wh",
      color: COLORS.energy,
      id: "total-energy",
      series: dataset.series.totalEnergyWh,
      stepped: false,
    },
  };
  const selected = config[metric];
  const areas = metric === "voltage" ? timelineAreas(dataset, theme) : [];
  const data = metric === "energy" ? relativeEnergyPairs(selected.series) : seriesPairs(selected.series);
  const threshold = metric === "voltage"
    ? heldSeriesPairs(dataset.series.brownoutVoltageV, dataset.bounds.energyStartUs, dataset.bounds.energyEndUs)
    : [];

  return {
    backgroundColor: "transparent",
    animation: false,
    textStyle: { fontFamily: "Inter, Segoe UI, Microsoft YaHei, sans-serif", color: palette.text },
    tooltip: tooltipOption(palette),
    grid: [{ left: 64, right: 18, top: 20, bottom: 44 }],
    xAxis: [{
      ...xAxisCommon(startSeconds, endSeconds, palette),
      gridIndex: 0,
      axisLabel: { color: palette.muted, fontSize: 10, formatter: (value: number) => `${value.toFixed(0)}s` },
    }],
    yAxis: [yAxis(`${selected.label} (${selected.unit})`, selected.color, 0, palette)],
    dataZoom: [controlledZoom(zoomId, [0])],
    series: [
      lineSeries(selected.id, selected.label, data, selected.color, 0, 0, areas, selected.stepped),
      ...(threshold.length > 0
        ? [{
            id: "brownout-voltage",
            name: "Brownout 电压阈值",
            type: "line" as const,
            data: threshold,
            xAxisIndex: 0,
            yAxisIndex: 0,
            step: "end" as const,
            showSymbol: false,
            animation: false,
            lineStyle: { width: 1.2, type: "dashed" as const, color: COLORS.threshold },
            itemStyle: { color: COLORS.threshold },
          }]
        : []),
    ],
  };
}

export function createSubsystemTimelineOption(
  dataset: EnergyLogDataset,
  nodes: SubsystemNode[],
  hiddenIds: ReadonlySet<string>,
  metric: SubsystemMetric,
  theme: ThemeMode,
  zoomId: string,
): EChartsOption {
  const palette = CHART_THEME[theme];
  const startSeconds = dataset.bounds.energyStartUs / 1_000_000;
  const endSeconds = dataset.bounds.energyEndUs / 1_000_000;
  const config = {
    power: { label: "子系统功率 (W)", unit: "W", series: (node: SubsystemNode) => node.powerW },
    current: { label: "子系统电流 (A)", unit: "A", series: (node: SubsystemNode) => node.currentA },
    energy: { label: "子系统能量 (Wh)", unit: "Wh", series: (node: SubsystemNode) => node.energyWh },
  }[metric];

  return {
    backgroundColor: "transparent",
    animation: false,
    textStyle: { fontFamily: "Inter, Segoe UI, Microsoft YaHei, sans-serif", color: palette.text },
    tooltip: tooltipOption(palette),
    grid: [{ left: 64, right: 18, top: 20, bottom: 44 }],
    xAxis: [{
      ...xAxisCommon(startSeconds, endSeconds, palette),
      gridIndex: 0,
      axisLabel: { color: palette.muted, fontSize: 10, formatter: (value: number) => `${value.toFixed(0)}s` },
    }],
    yAxis: [yAxis(config.label, COLORS.subsystem[0], 0, palette)],
    dataZoom: [controlledZoom(zoomId, [0])],
    series: nodes
      .map((node, index) => ({ node, color: COLORS.subsystem[index % COLORS.subsystem.length] }))
      .filter(({ node }) => !hiddenIds.has(node.id))
      .map(({ node, color }) => lineSeries(
        node.id,
        `${node.rawPath} (${config.unit})`,
        metric === "energy" ? relativeEnergyPairs(config.series(node)) : seriesPairs(config.series(node)),
        color,
        0,
        0,
        [],
        metric !== "energy",
      )),
  };
}

function lineSeries(
  id: string,
  name: string,
  data: Array<[number, number]>,
  color: string,
  xAxisIndex: number,
  yAxisIndex: number,
  areas: TimelineArea[] = [],
  stepped = false,
) {
  return {
    id,
    name,
    type: "line" as const,
    data,
    xAxisIndex,
    yAxisIndex,
    showSymbol: false,
    animation: false,
    ...(stepped ? { step: "end" as const } : {}),
    lineStyle: { width: 1.3, color },
    itemStyle: { color },
    emphasis: { focus: "series" as const, lineStyle: { width: 2 } },
    ...(areas.length > 0
      ? { markArea: { silent: true, label: { show: false }, data: areas } }
      : {}),
  };
}

function xAxisCommon(start: number, end: number, palette: (typeof CHART_THEME)[ThemeMode]) {
  return {
    type: "value" as const,
    min: start,
    max: end,
    axisLine: { show: false },
    axisTick: { show: false },
    splitLine: { lineStyle: { color: palette.grid } },
    axisLabel: { color: palette.muted, fontSize: 10 },
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
  };
}

function yAxis(name: string, color: string, gridIndex: number, palette: (typeof CHART_THEME)[ThemeMode]) {
  return {
    type: "value" as const,
    gridIndex,
    name,
    nameLocation: "middle" as const,
    nameGap: 42,
    nameTextStyle: { color, fontSize: 10, fontWeight: 600 },
    axisLabel: { color: palette.muted, fontSize: 10 },
    axisLine: { show: false },
    axisTick: { show: false },
    splitLine: { lineStyle: { color: palette.grid } },
  };
}

function tooltipOption(palette: (typeof CHART_THEME)[ThemeMode]) {
  return {
    trigger: "axis" as const,
    axisPointer: { type: "line" as const },
    borderWidth: 1,
    borderColor: palette.tooltipBorder,
    backgroundColor: palette.tooltipBackground,
    textStyle: { color: palette.tooltipText, fontSize: 11 },
    valueFormatter: (value: unknown) => typeof value === "number" ? value.toFixed(3) : String(value),
  };
}

function controlledZoom(id: string, xAxisIndex: number[]) {
  return {
    id,
    type: "inside" as const,
    xAxisIndex,
    start: 0,
    end: 100,
    filterMode: "none" as const,
    zoomOnMouseWheel: false,
    moveOnMouseMove: false,
    moveOnMouseWheel: false,
  };
}

function syncRange(chart: ECharts, zoomId: string, range: TimeRange, dataset: EnergyLogDataset) {
  chart.dispatchAction({
    type: "dataZoom",
    dataZoomId: zoomId,
    start: percent(range.startUs, dataset.bounds.energyStartUs, dataset.bounds.energyEndUs),
    end: percent(range.endUs, dataset.bounds.energyStartUs, dataset.bounds.energyEndUs),
  });
}

export function syncCursor(
  chart: ECharts,
  defaultAxisIndex: number,
  cursorUs: number,
  focus: TimelineFocus,
  suppression?: { current: boolean },
) {
  const focusedAxisIndex = focus === "current" ? 1 : focus === "power" ? 2 : defaultAxisIndex;
  const option = chart.getOption() as { xAxis?: unknown[] };
  const axisIndex = focusedAxisIndex < (option.xAxis?.length ?? 0) ? focusedAxisIndex : defaultAxisIndex;
  const seconds = Math.round(cursorUs) / 1_000_000;
  const point = axisCursorPoint(chart, axisIndex, seconds);
  if (!point) return;

  const previousSuppression = suppression?.current ?? false;
  if (suppression) suppression.current = true;
  try {
    chart.dispatchAction({
      type: "updateAxisPointer",
      x: point[0],
      y: point[1],
      axesInfo: [{ axisDim: "x", axisIndex }],
    });
  } finally {
    if (suppression) suppression.current = previousSuppression;
  }
}

function axisCursorPoint(chart: ECharts, axisIndex: number, seconds: number): [number, number] | null {
  const x = chart.convertToPixel({ xAxisIndex: axisIndex }, seconds);
  if (typeof x !== "number" || !Number.isFinite(x)) return null;

  const option = chart.getOption() as {
    xAxis?: Array<{ gridIndex?: number }>;
    grid?: Array<{ top?: number | string; bottom?: number | string; height?: number | string }>;
  };
  const gridIndex = option.xAxis?.[axisIndex]?.gridIndex ?? 0;
  const grid = option.grid?.[gridIndex];
  const chartHeight = chart.getHeight();
  const top = layoutPixel(grid?.top, chartHeight, 0);
  const bottom = layoutPixel(grid?.bottom, chartHeight, 0);
  const height = layoutPixel(grid?.height, chartHeight, chartHeight - top - bottom);
  const y = top + Math.max(0, height) / 2;
  return Number.isFinite(y) ? [x, y] : null;
}

function layoutPixel(value: number | string | undefined, total: number, fallback: number) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return fallback;
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return fallback;
  return value.trim().endsWith("%") ? (parsed / 100) * total : parsed;
}

export function seriesPairs(series?: NumericSeries, maxPoints = 8_000): Array<[number, number]> {
  if (!series || series.values.length === 0) return [];
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

export function heldSeriesPairs(series: NumericSeries | undefined, startUs: number, endUs: number): Array<[number, number]> {
  if (!series || series.values.length === 0 || endUs < startUs) return [];
  const result: Array<[number, number]> = [];
  const firstAfterStart = upperBound(series.timestampsUs, startUs);
  const heldAtStart = firstAfterStart - 1;
  if (heldAtStart >= 0) result.push([startUs / 1_000_000, series.values[heldAtStart]]);
  for (let index = firstAfterStart; index < series.values.length && series.timestampsUs[index] <= endUs; index += 1) {
    result.push([series.timestampsUs[index] / 1_000_000, series.values[index]]);
  }
  if (result.length === 0) return [];
  const lastValue = result.at(-1)![1];
  if (result.at(-1)![0] !== endUs / 1_000_000) result.push([endUs / 1_000_000, lastValue]);
  return result;
}

function relativeEnergyPairs(series?: NumericSeries) {
  const pairs = seriesPairs(series);
  const baseline = pairs[0]?.[1] ?? 0;
  return pairs.map(([time, value]) => [time, value - baseline] as [number, number]);
}

function topLevelSubsystems(dataset: EnergyLogDataset) {
  return dataset.subsystems
    .filter((node) => node.parentId === null)
    .map((node) => ({ node, energy: fullSeriesEnergy(node.energyWh) }))
    .sort((left, right) => right.energy - left.energy || left.node.rawPath.localeCompare(right.node.rawPath))
    .map(({ node }) => node);
}

function fullSeriesEnergy(series: NumericSeries) {
  let energy = 0;
  let previous = 0;
  for (const value of series.values) {
    if (value >= previous) energy += value - previous;
    previous = value;
  }
  return energy;
}

function upperBound(values: Float64Array, target: number) {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (values[middle] <= target) low = middle + 1;
    else high = middle;
  }
  return low;
}

function percent(value: number, minimum: number, maximum: number) {
  if (maximum <= minimum) return 0;
  return Math.max(0, Math.min(100, ((value - minimum) / (maximum - minimum)) * 100));
}

function timelineAreas(dataset: EnergyLogDataset, theme: ThemeMode) {
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
  const modeAreas: TimelineArea[] = dataset.segments.modes.map((segment) => [
    {
      name: "",
      xAxis: segment.startUs / 1_000_000,
      itemStyle: { color: modeColors[segment.mode] },
      label: { show: false },
    },
    { xAxis: segment.endUs / 1_000_000 },
  ]);
  const brownoutAreas: TimelineArea[] = dataset.segments.brownouts.map((segment) => [
    {
      name: "BROWNOUT",
      xAxis: segment.startUs / 1_000_000,
      itemStyle: { color: "rgba(239, 68, 68, .18)" },
      label: { show: false },
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

interface AxisPointerEvent {
  axesInfo?: Array<{ axisDim?: string; axisIndex?: number; value?: number }>;
}

type TimelineArea = [
  {
    name: string;
    xAxis: number;
    itemStyle: { color: string };
    label: { show: false };
  },
  { xAxis: number },
];
