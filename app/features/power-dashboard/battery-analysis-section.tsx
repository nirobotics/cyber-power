import { memo, useMemo, useState, useSyncExternalStore, type ComponentProps } from "react";
import type { LineSeriesOption } from "echarts/charts";
import { getInitialTheme, THEME_EVENT, type ThemeMode } from "../../lib/theme";
import { binBatteryLoadObservedCurve } from "../log-analysis/core/battery-proxy";
import type {
  BatteryLoadLocalWindows,
  BatteryLoadObservedCurve,
  BatteryLoadObservedDistribution,
  BatteryLoadObservedDistributionBin,
  BatteryLoadResponseAnalysis,
  BatteryLoadResponseComponentUnavailableReason,
  BatteryLoadResponseUnavailableReason,
} from "../log-analysis/core/battery-proxy";
import type {
  EnergyLogDataset,
  TimeRange,
} from "../log-analysis/core/types";
import { StaticEChartsChart, TimelineChart } from "./energy-timeline";
import { formatDuration, formatNumber } from "./format";

type TimelineOption = ComponentProps<typeof TimelineChart>["option"];
type AvailableLocalWindows = Extract<BatteryLoadLocalWindows, { status: "available" }>;

const RAW_OBSERVED_POINT_LIMIT = 2_000;

const CHART_THEME = {
  dark: {
    text: "#d7dfeb",
    muted: "#8190a6",
    grid: "rgba(129, 144, 166, .16)",
    tooltipBackground: "rgba(8, 18, 32, .96)",
    tooltipBorder: "#30425a",
  },
  light: {
    text: "#172033",
    muted: "#68758a",
    grid: "rgba(104, 117, 138, .18)",
    tooltipBackground: "rgba(255, 255, 255, .98)",
    tooltipBorder: "#cbd5e1",
  },
} as const;

export function BatteryAnalysisSection({
  analysis,
  dataset,
  range,
  cursorUs,
  cursorPreviewActive,
  onCursorPreview,
  onCursorCommit,
}: {
  analysis: BatteryLoadResponseAnalysis;
  dataset: EnergyLogDataset;
  range: TimeRange;
  cursorUs: number;
  cursorPreviewActive: boolean;
  onCursorPreview: (cursorUs: number | null) => void;
  onCursorCommit: (cursorUs: number) => void;
}) {
  if (analysis.status === "unavailable") {
    return (
      <section className="card px-4 py-8 text-center">
        <p className="text-sm font-semibold text-ink">电池观测分析不可用</p>
        <p className="mt-1 text-xs text-ink-dim">{topLevelUnavailableReason(analysis.reason)}</p>
      </section>
    );
  }

  return (
    <div className="grid gap-2.5">
      <SummarySection analysis={analysis} />
      <LocalVoltageResponseSection
        analysis={analysis}
        dataset={dataset}
        range={range}
        cursorUs={cursorUs}
        cursorPreviewActive={cursorPreviewActive}
        onCursorPreview={onCursorPreview}
        onCursorCommit={onCursorCommit}
      />
      <ObservedDistributionCard
        curve={analysis.observedCurve}
        brownoutThresholdV={analysis.lowVoltage.status === "available"
          ? analysis.lowVoltage.averageThresholdV
          : null}
      />
      <ObservedLowVoltageSection analysis={analysis} />
    </div>
  );
}

const SummarySection = memo(function SummarySection({
  analysis,
}: {
  analysis: Extract<BatteryLoadResponseAnalysis, { status: "available" }>;
}) {
  const { summary, quality } = analysis;
  return (
    <section className="card overflow-hidden">
      <div className="border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold text-ink">电池与整机输入摘要</h2>
      </div>
      <div className="grid divide-y divide-line sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-7">
        <SummaryMetric label="平均电池电压" value={`${formatNumber(summary.averageVoltageV, 2)} V`} />
        <SummaryMetric
          label="电池电压范围"
          value={`${formatNumber(summary.minimumVoltageV, 2)}–${formatNumber(summary.maximumVoltageV, 2)} V`}
        />
        <SummaryMetric
          label="整机正向输入能量"
          value={`${formatNumber(summary.positiveRegisteredInputEnergyWh, 4)} Wh`}
        />
        <SummaryMetric
          label="整机正向输入电量"
          value={`${formatNumber(summary.positiveRegisteredChargeAh, 4)} Ah`}
        />
        <SummaryMetric
          label="整机峰值正向电流"
          value={`${formatNumber(summary.maximumPositiveRegisteredCurrentA, 1)} A`}
        />
        <SummaryMetric
          label="整机电流 I²t"
          value={`${formatNumber(summary.registeredCurrentSquaredTimeA2Seconds, 1)} A²·s`}
        />
        <SummaryMetric
          label="完整区间覆盖率"
          value={`${formatNumber(quality.coverageFraction * 100, 1)}%`}
        />
      </div>
      <p className="border-t border-line px-4 py-2 text-[11px] text-ink-faint">
        完整区间 {formatNumber(quality.completeIntervalCount, 0)} 个，丢弃区间{
        " "}{formatNumber(quality.droppedIntervalCount, 0)} 个，覆盖{
        " "}{formatDuration(quality.coveredDurationSeconds)}。
      </p>
    </section>
  );
});

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 px-4 py-3">
      <span className="block text-[11px] font-medium text-ink-faint">{label}</span>
      <span className="mt-1 block truncate font-mono text-base font-semibold text-ink">{value}</span>
    </div>
  );
}

function LocalVoltageResponseSection({
  analysis,
  dataset,
  range,
  cursorUs,
  cursorPreviewActive,
  onCursorPreview,
  onCursorCommit,
}: {
  analysis: Extract<BatteryLoadResponseAnalysis, { status: "available" }>;
  dataset: EnergyLogDataset;
  range: TimeRange;
  cursorUs: number;
  cursorPreviewActive: boolean;
  onCursorPreview: (cursorUs: number | null) => void;
  onCursorCommit: (cursorUs: number) => void;
}) {
  const theme = useSyncExternalStore(subscribeTheme, getInitialTheme, getServerTheme);
  const windows = analysis.localWindows;
  const zoomId = "battery-local-response";
  const option = useMemo(
    () => windows.status === "available"
      ? createLocalWindowTimelineOption(dataset, windows, theme, zoomId)
      : null,
    [dataset, theme, windows],
  );

  return (
    <section className="card overflow-hidden">
      <div className="border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold text-ink">局部电压响应</h2>
      </div>
      {windows.status === "available" && option ? (
        <div className="grid gap-3 px-4 py-3">
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <CompactMetric
              label="窗口等效压降代理中位数"
              value={`${formatNumber(windows.voltageDropProxyQuantilesOhm.median * 1_000, 2)} mΩ`}
            />
            <CompactMetric
              label="代理 IQR（P25–P75）"
              value={`${formatNumber(windows.voltageDropProxyQuantilesOhm.p25 * 1_000, 2)}–${formatNumber(windows.voltageDropProxyQuantilesOhm.p75 * 1_000, 2)} mΩ`}
            />
            <CompactMetric
              label="窗口 RMSE 范围"
              value={formatFiniteRange(windows.residualRmsV, 1_000, "mV", 2)}
            />
            <CompactMetric
              label="有效窗口"
              value={`${formatNumber(windows.windowStartUs.length, 0)} / ${formatNumber(windows.evaluatedWindowCount, 0)}`}
            />
          </div>
          <div>
            <h3 className="mb-1 text-xs font-semibold text-ink">局部窗口时序</h3>
            <div className="mb-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-ink-dim" aria-label="局部窗口图例">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-0 w-4 border-t-2 border-[#9b7cff]" aria-hidden />
                窗口等效压降代理 (mΩ)
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-0 w-4 border-t-2 border-[#4ec5df]" aria-hidden />
                窗口 RMSE (mV)
              </span>
            </div>
            <TimelineChart
              dataset={dataset}
              option={option}
              zoomId={zoomId}
              cursorAxisIndex={0}
              range={range}
              cursorUs={cursorUs}
              cursorPreviewActive={cursorPreviewActive}
              focus={null}
              onCursorPreview={onCursorPreview}
              onCursorCommit={onCursorCommit}
              className="h-[300px] min-h-[260px]"
              ariaLabel="局部窗口等效压降代理与 RMSE 时序图"
            />
          </div>
          <p className="text-[11px] leading-relaxed text-ink-faint">
            每个点来自独立局部窗口；RMSE 表示窗口内电压与局部拟合关系的残差尺度。弱电流激励窗口{
            " "}{formatNumber(windows.weakExcitationWindowCount, 0)} 个，方向不符合窗口{
            " "}{formatNumber(windows.rejectedDirectionWindowCount, 0)} 个。
          </p>
        </div>
      ) : windows.status === "unavailable" ? (
        <UnavailableBlock
          message={componentUnavailableReason(windows.reason)}
          detail={`已评估 ${formatNumber(windows.evaluatedWindowCount, 0)} 个窗口；弱激励 ${formatNumber(windows.weakExcitationWindowCount, 0)} 个，方向不符合 ${formatNumber(windows.rejectedDirectionWindowCount, 0)} 个。`}
        />
      ) : null}
    </section>
  );
}

function CompactMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-line bg-surface-2/40 px-3 py-2">
      <span className="block text-[10px] font-medium text-ink-faint">{label}</span>
      <span className="mt-1 block font-mono text-sm text-ink">{value}</span>
    </div>
  );
}

export function createLocalWindowTimelineOption(
  dataset: EnergyLogDataset,
  windows: AvailableLocalWindows,
  theme: ThemeMode,
  zoomId: string,
): TimelineOption {
  const palette = CHART_THEME[theme];
  const proxyData: Array<[number, number]> = [];
  const rmsData: Array<[number, number]> = [];
  for (let index = 0; index < windows.windowStartUs.length; index += 1) {
    const seconds = (windows.windowStartUs[index] + windows.windowEndUs[index]) / 2_000_000;
    proxyData.push([seconds, windows.voltageDropProxyOhm[index] * 1_000]);
    rmsData.push([seconds, windows.residualRmsV[index] * 1_000]);
  }
  const areas = timelineAreas(dataset, theme);
  return {
    backgroundColor: "transparent",
    animation: false,
    textStyle: {
      fontFamily: "Inter, Segoe UI, Microsoft YaHei, sans-serif",
      color: palette.text,
    },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "line" },
      borderWidth: 1,
      borderColor: palette.tooltipBorder,
      backgroundColor: palette.tooltipBackground,
      textStyle: { color: palette.text, fontSize: 11 },
    },
    grid: [{ left: 64, right: 64, top: 20, bottom: 42 }],
    xAxis: [{
      type: "value",
      min: dataset.bounds.energyStartUs / 1_000_000,
      max: dataset.bounds.energyEndUs / 1_000_000,
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: palette.grid } },
      axisLabel: {
        color: palette.muted,
        fontSize: 10,
        formatter: (value: number) => `${value.toFixed(0)}s`,
      },
      axisPointer: {
        show: true,
        snap: false,
        triggerTooltip: true,
        lineStyle: { color: "#91a7ff", width: 1 },
        label: {
          show: true,
          color: palette.text,
          backgroundColor: palette.tooltipBorder,
          formatter: ({ value }: { value?: unknown }) =>
            typeof value === "number" ? `${value.toFixed(3)}s` : String(value ?? ""),
        },
      },
    }],
    yAxis: [
      {
        type: "value",
        name: "压降代理 (mΩ)",
        nameLocation: "middle",
        nameGap: 42,
        nameTextStyle: { color: "#9b7cff", fontSize: 10, fontWeight: 600 },
        axisLabel: { color: palette.muted, fontSize: 10 },
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: palette.grid } },
      },
      {
        type: "value",
        name: "RMSE (mV)",
        nameLocation: "middle",
        nameGap: 42,
        nameTextStyle: { color: "#4ec5df", fontSize: 10, fontWeight: 600 },
        axisLabel: { color: palette.muted, fontSize: 10 },
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
      },
    ],
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
      {
        id: "battery-local-proxy",
        name: "窗口等效压降代理 (mΩ)",
        type: "line",
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: proxyData,
        showSymbol: true,
        symbolSize: 5,
        smooth: false,
        connectNulls: false,
        lineStyle: { color: "#9b7cff", width: 1.5 },
        itemStyle: { color: "#9b7cff" },
        markArea: {
          silent: true,
          data: areas,
        },
      },
      {
        id: "battery-local-rmse",
        name: "窗口 RMSE (mV)",
        type: "line",
        xAxisIndex: 0,
        yAxisIndex: 1,
        data: rmsData,
        showSymbol: true,
        symbolSize: 5,
        smooth: false,
        connectNulls: false,
        lineStyle: { color: "#4ec5df", width: 1.5 },
        itemStyle: { color: "#4ec5df" },
      },
    ],
  } as TimelineOption;
}

const ObservedDistributionCard = memo(function ObservedDistributionCard({
  curve,
  brownoutThresholdV,
}: {
  curve: BatteryLoadObservedCurve;
  brownoutThresholdV: number | null;
}) {
  const theme = useSyncExternalStore(subscribeTheme, getInitialTheme, getServerTheme);
  const [showRawPoints, setShowRawPoints] = useState(false);
  const distribution = useMemo(() => binBatteryLoadObservedCurve(curve), [curve]);
  const option = useMemo(
    () => createObservedVoltageCurrentDistributionOption(
      curve,
      distribution,
      theme,
      brownoutThresholdV,
      showRawPoints,
    ),
    [brownoutThresholdV, curve, distribution, showRawPoints, theme],
  );
  const hasData = distribution.bins.some((bin) => Number.isFinite(bin.voltageMedianV));

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">整机电压与电流关系</h2>
          {hasData ? (
            <p className="mt-0.5 text-[11px] text-ink-faint">
              每 {formatNumber(distribution.binWidthA, 2)} A 一档 ·{
              " "}{formatNumber(distribution.validObservationSegmentCount, 0)} 个观测段 · 覆盖{
              " "}{formatDuration(distribution.totalObservedDurationSeconds)}
            </p>
          ) : null}
        </div>
        {hasData ? (
          <button
            type="button"
            className={`rounded border px-2.5 py-1 text-[11px] font-medium transition-colors ${showRawPoints
              ? "border-accent bg-accent/15 text-accent"
              : "border-line bg-surface-2 text-ink-dim hover:border-accent/60 hover:text-ink"}`}
            aria-pressed={showRawPoints}
            onClick={() => setShowRawPoints((visible) => !visible)}
          >
            {showRawPoints ? "隐藏原始点" : "显示原始点"}
          </button>
        ) : null}
      </div>
      {hasData ? (
        <div className="px-4 py-3">
          <div className="mb-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-ink-dim" aria-label="整机电压与电流图例">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-[#9b7cff]" aria-hidden />
              取电中位数
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full border border-[#4ec5df] bg-transparent" aria-hidden />
              回流中位数
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-4 rounded-sm bg-[#9b7cff]/20" aria-hidden />
              P25–P75
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-4 rounded-sm bg-ink-faint/45" aria-hidden />
              观测时长
            </span>
            {brownoutThresholdV !== null && Number.isFinite(brownoutThresholdV) ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="w-4 border-t border-dashed border-[#ef5b5b]" aria-hidden />
                Brownout 电压
              </span>
            ) : null}
          </div>
          <StaticEChartsChart
            option={option}
            className="h-[410px] min-h-[380px]"
            ariaLabel="整机电压与电流观测分布图"
          />
        </div>
      ) : (
        <UnavailableBlock message="没有可绘制的完整整机电流与电池电压观测段。" />
      )}
    </section>
  );
});

export function createObservedVoltageCurrentDistributionOption(
  curve: BatteryLoadObservedCurve,
  distribution: BatteryLoadObservedDistribution,
  theme: ThemeMode,
  brownoutThresholdV: number | null,
  showRawPoints: boolean,
): TimelineOption {
  const palette = CHART_THEME[theme];
  const positive = (bin: BatteryLoadObservedDistributionBin) => bin.currentMinimumA >= 0;
  const negative = (bin: BatteryLoadObservedDistributionBin) => bin.currentMaximumA <= 0;
  const pointData = (
    predicate: (bin: BatteryLoadObservedDistributionBin) => boolean,
    value: (bin: BatteryLoadObservedDistributionBin) => number,
  ) => distribution.bins.map((bin) => [
    bin.currentCenterA,
    predicate(bin) && Number.isFinite(value(bin)) ? value(bin) : null,
  ]);
  const positiveP25 = pointData(positive, (bin) => bin.voltageP25V);
  const positiveIqr = pointData(
    positive,
    (bin) => bin.voltageP75V - bin.voltageP25V,
  );
  const negativeP25 = pointData(negative, (bin) => bin.voltageP25V);
  const negativeIqr = pointData(
    negative,
    (bin) => bin.voltageP75V - bin.voltageP25V,
  );
  const durationData = distribution.bins.map((bin) => ({
    value: [bin.currentCenterA, bin.observedDurationSeconds],
    itemStyle: {
      color: negative(bin) ? "rgba(78, 197, 223, .52)" : "rgba(155, 124, 255, .52)",
      borderColor: negative(bin) ? "#4ec5df" : "#9b7cff",
      borderWidth: bin.observedDurationSeconds > 0 ? 0.5 : 0,
    },
  }));
  const rawPoints = showRawPoints
    ? sampleObservedVoltageCurrentPoints(curve, RAW_OBSERVED_POINT_LIMIT)
    : { positive: [], negative: [] };
  const referenceSeries: LineSeriesOption[] = [];
  if (distribution.axisMinimumA <= 0 && distribution.axisMaximumA >= 0) {
    referenceSeries.push({
      id: "observed-zero-current",
      name: "0 A",
      type: "line",
      xAxisIndex: 0,
      yAxisIndex: 0,
      data: [[0, 3], [0, 13.5]],
      showSymbol: false,
      silent: true,
      lineStyle: { color: palette.muted, width: 1, type: "dashed", opacity: 0.7 },
      emphasis: { disabled: true },
      z: 1,
    });
  }
  if (brownoutThresholdV !== null && Number.isFinite(brownoutThresholdV)) {
    referenceSeries.push({
      id: "observed-brownout-voltage",
      name: "Brownout 电压",
      type: "line",
      xAxisIndex: 0,
      yAxisIndex: 0,
      data: [
        [distribution.axisMinimumA, brownoutThresholdV],
        [distribution.axisMaximumA, brownoutThresholdV],
      ],
      showSymbol: false,
      silent: true,
      lineStyle: { color: "#ef5b5b", width: 1.25, type: "dashed" },
      emphasis: { disabled: true },
      z: 2,
    });
  }

  return {
    backgroundColor: "transparent",
    animation: false,
    textStyle: {
      fontFamily: "Inter, Segoe UI, Microsoft YaHei, sans-serif",
      color: palette.text,
    },
    tooltip: {
      trigger: "item",
      confine: true,
      transitionDuration: 0,
      borderWidth: 1,
      borderColor: palette.tooltipBorder,
      backgroundColor: palette.tooltipBackground,
      textStyle: { color: palette.text, fontSize: 11 },
      formatter: (raw: unknown) => {
        const params = raw as { dataIndex?: number };
        const bin = typeof params.dataIndex === "number"
          ? distribution.bins[params.dataIndex]
          : undefined;
        return bin ? formatObservedVoltageCurrentBinTooltip(bin) : "";
      },
    },
    grid: [
      { left: 64, right: 32, top: 22, height: 236 },
      { left: 64, right: 32, top: 294, height: 58 },
    ],
    xAxis: [
      {
        type: "value",
        gridIndex: 0,
        min: distribution.axisMinimumA,
        max: distribution.axisMaximumA,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { show: false },
        splitLine: { lineStyle: { color: palette.grid } },
      },
      {
        type: "value",
        gridIndex: 1,
        min: distribution.axisMinimumA,
        max: distribution.axisMaximumA,
        name: "整机电流 (A)",
        nameLocation: "middle",
        nameGap: 28,
        nameTextStyle: { color: palette.text, fontSize: 10, fontWeight: 600 },
        axisLine: { lineStyle: { color: palette.grid } },
        axisTick: { show: false },
        axisLabel: {
          color: palette.muted,
          fontSize: 10,
          formatter: (value: number) => formatNumber(value, 0),
        },
        splitLine: { show: false },
      },
    ],
    yAxis: [
      {
        type: "value",
        gridIndex: 0,
        min: 3,
        max: 13.5,
        name: "电池电压 (V)",
        nameLocation: "middle",
        nameGap: 42,
        nameTextStyle: { color: palette.text, fontSize: 10, fontWeight: 600 },
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: palette.muted, fontSize: 10 },
        splitLine: { lineStyle: { color: palette.grid } },
      },
      {
        type: "value",
        gridIndex: 1,
        min: 0,
        name: "时长 (s)",
        nameLocation: "middle",
        nameGap: 42,
        nameTextStyle: { color: palette.muted, fontSize: 9 },
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: palette.muted, fontSize: 9 },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        id: "observed-positive-p25",
        name: "取电 P25",
        type: "line",
        xAxisIndex: 0,
        yAxisIndex: 0,
        stack: "observed-positive-iqr",
        data: positiveP25,
        showSymbol: false,
        connectNulls: false,
        silent: true,
        lineStyle: { opacity: 0 },
        areaStyle: { opacity: 0 },
        emphasis: { disabled: true },
        z: 1,
      },
      {
        id: "observed-positive-iqr",
        name: "取电 P25–P75",
        type: "line",
        xAxisIndex: 0,
        yAxisIndex: 0,
        stack: "observed-positive-iqr",
        data: positiveIqr,
        showSymbol: false,
        connectNulls: false,
        silent: true,
        lineStyle: { opacity: 0 },
        areaStyle: { color: "rgba(155, 124, 255, .24)" },
        emphasis: { disabled: true },
        z: 1,
      },
      {
        id: "observed-negative-p25",
        name: "回流 P25",
        type: "line",
        xAxisIndex: 0,
        yAxisIndex: 0,
        stack: "observed-negative-iqr",
        data: negativeP25,
        showSymbol: false,
        connectNulls: false,
        silent: true,
        lineStyle: { opacity: 0 },
        areaStyle: { opacity: 0 },
        emphasis: { disabled: true },
        z: 1,
      },
      {
        id: "observed-negative-iqr",
        name: "回流 P25–P75",
        type: "line",
        xAxisIndex: 0,
        yAxisIndex: 0,
        stack: "observed-negative-iqr",
        data: negativeIqr,
        showSymbol: false,
        connectNulls: false,
        silent: true,
        lineStyle: { opacity: 0 },
        areaStyle: { color: "rgba(78, 197, 223, .20)" },
        emphasis: { disabled: true },
        z: 1,
      },
      ...referenceSeries,
      {
        id: "observed-positive-median",
        name: "取电中位数",
        type: "line",
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: pointData(positive, (bin) => bin.voltageMedianV),
        showSymbol: true,
        symbol: "circle",
        symbolSize: 7,
        connectNulls: false,
        lineStyle: { color: "#9b7cff", width: 1.75 },
        itemStyle: { color: "#9b7cff", borderColor: "#9b7cff", borderWidth: 1 },
        emphasis: { disabled: true },
        z: 4,
      },
      {
        id: "observed-negative-median",
        name: "回流中位数",
        type: "line",
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: pointData(negative, (bin) => bin.voltageMedianV),
        showSymbol: true,
        symbol: "emptyCircle",
        symbolSize: 7,
        connectNulls: false,
        lineStyle: { color: "#4ec5df", width: 1.75 },
        itemStyle: { color: palette.tooltipBackground, borderColor: "#4ec5df", borderWidth: 1.5 },
        emphasis: { disabled: true },
        z: 4,
      },
      ...(showRawPoints
        ? [
            {
              id: "observed-positive-raw",
              name: "取电原始点",
              type: "line",
              xAxisIndex: 0,
              yAxisIndex: 0,
              data: rawPoints.positive,
              showSymbol: true,
              symbol: "circle",
              symbolSize: 2.5,
              silent: true,
              lineStyle: { opacity: 0, width: 0 },
              itemStyle: { color: "rgba(155, 124, 255, .16)" },
              emphasis: { disabled: true },
              z: 2,
            },
            {
              id: "observed-negative-raw",
              name: "回流原始点",
              type: "line",
              xAxisIndex: 0,
              yAxisIndex: 0,
              data: rawPoints.negative,
              showSymbol: true,
              symbol: "emptyCircle",
              symbolSize: 2.5,
              silent: true,
              lineStyle: { opacity: 0, width: 0 },
              itemStyle: { color: "rgba(78, 197, 223, .18)", borderColor: "rgba(78, 197, 223, .30)" },
              emphasis: { disabled: true },
              z: 2,
            },
          ]
        : []),
      {
        id: "observed-duration",
        name: "观测时长",
        type: "bar",
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: durationData,
        barWidth: "68%",
        emphasis: { disabled: true },
        z: 2,
      },
    ],
  } as TimelineOption;
}

export function sampleObservedVoltageCurrentPoints(
  curve: BatteryLoadObservedCurve,
  limit: number,
): { positive: Array<[number, number]>; negative: Array<[number, number]> } {
  const count = Math.min(
    curve.registeredCurrentA.length,
    curve.voltageV.length,
    curve.intervalDurationSeconds.length,
  );
  const sampleCount = Math.min(count, Math.max(0, Math.floor(limit)));
  const positive: Array<[number, number]> = [];
  const negative: Array<[number, number]> = [];
  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    const index = sampleCount <= 1
      ? 0
      : Math.round((sampleIndex * (count - 1)) / (sampleCount - 1));
    const currentA = curve.registeredCurrentA[index];
    const voltageV = curve.voltageV[index];
    const durationSeconds = curve.intervalDurationSeconds[index];
    if (
      !Number.isFinite(currentA) ||
      !Number.isFinite(voltageV) ||
      !(voltageV > 0) ||
      !Number.isFinite(durationSeconds) ||
      !(durationSeconds > 0)
    ) continue;
    (currentA < 0 ? negative : positive).push([currentA, voltageV]);
  }
  return { positive, negative };
}

export function formatObservedVoltageCurrentBinTooltip(
  bin: BatteryLoadObservedDistributionBin,
): string {
  return [
    `<strong>整机电流 ${formatNumber(bin.currentMinimumA, 1)} 至 &lt; ${formatNumber(bin.currentMaximumA, 1)} A</strong>`,
    `加权中位电压：${formatNumber(bin.voltageMedianV, 2)} V`,
    `P25–P75：${formatNumber(bin.voltageP25V, 2)}–${formatNumber(bin.voltageP75V, 2)} V`,
    `累计观测时长：${formatDuration(bin.observedDurationSeconds)}`,
    `观测段数：${formatNumber(bin.observationSegmentCount, 0)}`,
  ].join("<br/>");
}

const ObservedLowVoltageSection = memo(function ObservedLowVoltageSection({
  analysis,
}: {
  analysis: Extract<BatteryLoadResponseAnalysis, { status: "available" }>;
}) {
  return (
    <section className="card overflow-hidden">
      <div className="border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold text-ink">实际低压与 Brownout</h2>
      </div>
      <div className="grid gap-3 px-4 py-3 lg:grid-cols-2">
        <div className="rounded border border-line bg-surface-2/40 px-3 py-3">
          <h3 className="text-xs font-semibold text-ink">相对 Brownout 电压的实际低压</h3>
          {analysis.lowVoltage.status === "available" ? (
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <MetricTerm label="事件次数" value={formatNumber(analysis.lowVoltage.eventCount, 0)} />
              <MetricTerm label="累计时长" value={formatDuration(analysis.lowVoltage.durationSeconds)} />
              <MetricTerm label="平均阈值" value={`${formatNumber(analysis.lowVoltage.averageThresholdV, 2)} V`} />
              <MetricTerm label="最小电压余量" value={`${formatNumber(analysis.lowVoltage.minimumMarginV, 2)} V`} />
              <MetricTerm label="阈值覆盖时长" value={formatDuration(analysis.lowVoltage.coveredDurationSeconds)} />
            </dl>
          ) : (
            <p className="mt-2 text-xs text-ink-dim">{componentUnavailableReason(analysis.lowVoltage.reason)}</p>
          )}
        </div>
        <div className="rounded border border-line bg-surface-2/40 px-3 py-3">
          <h3 className="text-xs font-semibold text-ink">实际 Brownout 状态</h3>
          {analysis.brownoutEvents.status === "available" ? (
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <MetricTerm label="事件次数" value={formatNumber(analysis.brownoutEvents.eventCount, 0)} />
              <MetricTerm label="累计时长" value={formatDuration(analysis.brownoutEvents.durationSeconds)} />
            </dl>
          ) : (
            <p className="mt-2 text-xs text-ink-dim">{componentUnavailableReason(analysis.brownoutEvents.reason)}</p>
          )}
        </div>
      </div>
    </section>
  );
});

function MetricTerm({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-ink-faint">{label}</dt>
      <dd className="font-mono text-ink">{value}</dd>
    </div>
  );
}

function UnavailableBlock({ message, detail }: { message: string; detail?: string }) {
  return (
    <div className="px-4 py-6 text-center">
      <p className="text-sm font-medium text-ink-dim">{message}</p>
      {detail ? <p className="mt-1 text-[11px] text-ink-faint">{detail}</p> : null}
    </div>
  );
}

export function topLevelUnavailableReason(reason: BatteryLoadResponseUnavailableReason): string {
  const labels: Readonly<Record<BatteryLoadResponseUnavailableReason, string>> = {
    V2_REQUIRED: "需要包含整机电机数据的 EnergyLogger V2 日志。",
    BATTERY_VOLTAGE_UNAVAILABLE: "日志没有可用的电池电压序列。",
    INVALID_RANGE: "所选时间范围无效或没有重叠数据。",
    NO_COMPLETE_INTERVALS: "所选范围没有完整的整机电流与电池电压区间。",
  };
  return labels[reason];
}

export function componentUnavailableReason(
  reason: BatteryLoadResponseComponentUnavailableReason,
): string {
  const labels: Readonly<Record<BatteryLoadResponseComponentUnavailableReason, string>> = {
    INSUFFICIENT_SAMPLES: "有效样本不足。",
    WEAK_CURRENT_EXCITATION: "整机电流变化范围不足。",
    NO_INVERSE_VOLTAGE_STEPS: "没有足够的电流与电压反向变化窗口。",
    NO_INVERSE_VOLTAGE_WINDOWS: "局部窗口没有稳定的电流与电压反向变化关系。",
    BROWNOUT_VOLTAGE_UNAVAILABLE: "日志没有可用的 Brownout 电压序列。",
    BROWNOUT_SIGNAL_UNAVAILABLE: "日志没有可用的 Brownout 状态序列。",
  };
  return labels[reason];
}

function formatFiniteRange(
  values: ArrayLike<number>,
  multiplier: number,
  unit: string,
  digits: number,
): string {
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index] * multiplier;
    if (!Number.isFinite(value)) continue;
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
  }
  return Number.isFinite(minimum)
    ? `${formatNumber(minimum, digits)}–${formatNumber(maximum, digits)} ${unit}`
    : "不可用";
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
  const modeAreas = dataset.segments.modes.map((segment) => [
    {
      name: "",
      xAxis: segment.startUs / 1_000_000,
      itemStyle: { color: modeColors[segment.mode] },
      label: { show: false },
    },
    { xAxis: segment.endUs / 1_000_000 },
  ]);
  const brownoutAreas = dataset.segments.brownouts.map((segment) => [
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
