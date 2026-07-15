import { memo, useMemo, useSyncExternalStore, type ComponentProps } from "react";
import { getInitialTheme, THEME_EVENT, type ThemeMode } from "../../lib/theme";
import type {
  BatteryLoadLocalWindows,
  BatteryLoadObservedCurve,
  BatteryLoadResponseAnalysis,
  BatteryLoadResponseComponentUnavailableReason,
  BatteryLoadResponseUnavailableReason,
} from "../log-analysis/core/battery-proxy";
import type {
  DriverStationMode,
  EnergyLogDataset,
  TimeRange,
} from "../log-analysis/core/types";
import { TimelineChart } from "./energy-timeline";
import { formatDuration, formatNumber } from "./format";

type TimelineOption = ComponentProps<typeof TimelineChart>["option"];
type AvailableLocalWindows = Extract<BatteryLoadLocalWindows, { status: "available" }>;

const MODE_ORDER = ["autonomous", "teleop", "enabled", "test", "disabled"] as const;
const MODE_LABELS: Readonly<Record<DriverStationMode, string>> = {
  autonomous: "AUTO",
  teleop: "TELEOP",
  enabled: "ENABLED",
  test: "TEST",
  disabled: "DISABLED",
};

const REQUIRED_LIMITATIONS = [
  "本页电流只包含 EnergyLogger V2 已注册电机，不是整机总电流。",
  "本页不估算电池 SOC 或容量。",
  "等效压降代理不是纯内阻，包含供电路径、动态恢复和未记录负载的影响。",
  "本页只描述日志中的实际观测，不提供配置变更后的电压、Brownout 或节能反事实。",
] as const;

const OBSERVED_CURVE_POINT_LIMIT = 800;
const LOAD_STEP_ROW_LIMIT = 200;

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
      <div className="grid gap-2.5">
        <section className="card px-4 py-8 text-center">
          <p className="text-sm font-semibold text-ink">电池观测分析不可用</p>
          <p className="mt-1 text-xs text-ink-dim">{topLevelUnavailableReason(analysis.reason)}</p>
        </section>
        <Limitations items={analysis.limitations} />
      </div>
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
      <ObservedCurveCard curve={analysis.observedCurve} />
      <LoadStepTable stepResponse={analysis.stepResponse} />
      <ModeStatsTable analysis={analysis} />
      <ObservedLowVoltageSection analysis={analysis} />
      <Limitations items={analysis.limitations} />
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
        <h2 className="text-sm font-semibold text-ink">电池与已注册电机输入摘要</h2>
      </div>
      <div className="grid divide-y divide-line sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-7">
        <SummaryMetric label="平均电池电压" value={`${formatNumber(summary.averageVoltageV, 2)} V`} />
        <SummaryMetric
          label="电池电压范围"
          value={`${formatNumber(summary.minimumVoltageV, 2)}–${formatNumber(summary.maximumVoltageV, 2)} V`}
        />
        <SummaryMetric
          label="已注册电机正向输入能量"
          value={`${formatNumber(summary.positiveRegisteredInputEnergyWh, 4)} Wh`}
        />
        <SummaryMetric
          label="已注册电机正向输入电量"
          value={`${formatNumber(summary.positiveRegisteredChargeAh, 4)} Ah`}
        />
        <SummaryMetric
          label="峰值正向已注册电机电流"
          value={`${formatNumber(summary.maximumPositiveRegisteredCurrentA, 1)} A`}
        />
        <SummaryMetric
          label="已注册电机电流 I²t"
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

const ObservedCurveCard = memo(function ObservedCurveCard({
  curve,
}: {
  curve: BatteryLoadObservedCurve;
}) {
  const points = observedCurveSvgPoints(curve);
  return (
    <section className="card overflow-hidden">
      <div className="border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold text-ink">观测范围内的电压－已注册电机电流关系</h2>
      </div>
      <div className="px-4 py-3">
        {points ? (
          <>
            <svg
              viewBox="0 0 720 280"
              className="pointer-events-none mx-auto h-auto w-full max-w-[720px] text-ink-dim"
              role="img"
              aria-label="观测范围内电池电压与已注册电机电流关系曲线"
              preserveAspectRatio="xMidYMid meet"
            >
              <line x1="58" y1="20" x2="58" y2="238" stroke="currentColor" opacity="0.35" />
              <line x1="58" y1="238" x2="700" y2="238" stroke="currentColor" opacity="0.35" />
              <polyline
                points={points}
                fill="none"
                stroke="#9b7cff"
                strokeWidth="1.5"
                strokeLinejoin="round"
                strokeLinecap="round"
                opacity="0.9"
              />
              <text x="379" y="270" textAnchor="middle" fill="currentColor" fontSize="11">
                已注册电机电流 (A)
              </text>
              <text
                x="15"
                y="130"
                textAnchor="middle"
                fill="currentColor"
                fontSize="11"
                transform="rotate(-90 15 130)"
              >
                电池电压 (V)
              </text>
              <text x="58" y="254" fill="currentColor" fontSize="10">
                {formatNumber(curve.registeredCurrentRangeA.minimum, 1)}
              </text>
              <text x="700" y="254" textAnchor="end" fill="currentColor" fontSize="10">
                {formatNumber(curve.registeredCurrentRangeA.maximum, 1)}
              </text>
              <text x="50" y="238" textAnchor="end" fill="currentColor" fontSize="10">
                {formatNumber(curve.voltageRangeV.minimum, 2)}
              </text>
              <text x="50" y="28" textAnchor="end" fill="currentColor" fontSize="10">
                {formatNumber(curve.voltageRangeV.maximum, 2)}
              </text>
            </svg>
            <p className="mt-1 text-[11px] leading-relaxed text-ink-faint">
              曲线按日志时间顺序连接观测点，仅展示所选范围内的关联，不代表恒定电池模型。
            </p>
          </>
        ) : (
          <UnavailableBlock message="没有可绘制的完整电压与已注册电机电流观测点。" />
        )}
      </div>
    </section>
  );
});

export function observedCurveSvgPoints(curve: BatteryLoadObservedCurve): string | null {
  const count = Math.min(curve.registeredCurrentA.length, curve.voltageV.length);
  if (count === 0) return null;
  const xMinimum = curve.registeredCurrentRangeA.minimum;
  const xMaximum = curve.registeredCurrentRangeA.maximum;
  const yMinimum = curve.voltageRangeV.minimum;
  const yMaximum = curve.voltageRangeV.maximum;
  if (![xMinimum, xMaximum, yMinimum, yMaximum].every(Number.isFinite)) return null;
  const indices = observedCurveSampleIndices(curve, count);
  const width = 642;
  const height = 218;
  return indices.flatMap((index) => {
    const currentA = curve.registeredCurrentA[index];
    const voltageV = curve.voltageV[index];
    if (!Number.isFinite(currentA) || !Number.isFinite(voltageV)) return [];
    const xFraction = xMaximum > xMinimum ? (currentA - xMinimum) / (xMaximum - xMinimum) : 0.5;
    const yFraction = yMaximum > yMinimum ? (voltageV - yMinimum) / (yMaximum - yMinimum) : 0.5;
    const x = 58 + Math.max(0, Math.min(1, xFraction)) * width;
    const y = 20 + (1 - Math.max(0, Math.min(1, yFraction))) * height;
    return [`${x.toFixed(2)},${y.toFixed(2)}`];
  }).join(" ") || null;
}

function observedCurveSampleIndices(
  curve: BatteryLoadObservedCurve,
  count: number,
): number[] {
  if (count <= OBSERVED_CURVE_POINT_LIMIT) {
    return Array.from({ length: count }, (_, index) => index);
  }

  const indices = [0];
  const interiorCount = count - 2;
  const bucketCount = Math.min(
    interiorCount,
    Math.floor((OBSERVED_CURVE_POINT_LIMIT - 2) / 4),
  );
  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const start = 1 + Math.floor((bucket * interiorCount) / bucketCount);
    const end = 1 + Math.floor(((bucket + 1) * interiorCount) / bucketCount);
    let minimumCurrentIndex = -1;
    let maximumCurrentIndex = -1;
    let minimumVoltageIndex = -1;
    let maximumVoltageIndex = -1;
    for (let index = start; index < end; index += 1) {
      const currentA = curve.registeredCurrentA[index];
      const voltageV = curve.voltageV[index];
      if (!Number.isFinite(currentA) || !Number.isFinite(voltageV)) continue;
      if (
        minimumCurrentIndex < 0 ||
        currentA < curve.registeredCurrentA[minimumCurrentIndex]
      ) {
        minimumCurrentIndex = index;
      }
      if (
        maximumCurrentIndex < 0 ||
        currentA > curve.registeredCurrentA[maximumCurrentIndex]
      ) {
        maximumCurrentIndex = index;
      }
      if (
        minimumVoltageIndex < 0 ||
        voltageV < curve.voltageV[minimumVoltageIndex]
      ) {
        minimumVoltageIndex = index;
      }
      if (
        maximumVoltageIndex < 0 ||
        voltageV > curve.voltageV[maximumVoltageIndex]
      ) {
        maximumVoltageIndex = index;
      }
    }
    const bucketIndices = [
      minimumCurrentIndex,
      maximumCurrentIndex,
      minimumVoltageIndex,
      maximumVoltageIndex,
    ]
      .filter((index) => index >= 0)
      .sort((left, right) => left - right);
    for (const index of new Set(bucketIndices)) indices.push(index);
  }
  indices.push(count - 1);
  return indices;
}

const LoadStepTable = memo(function LoadStepTable({
  stepResponse,
}: {
  stepResponse: Extract<BatteryLoadResponseAnalysis, { status: "available" }>["stepResponse"];
}) {
  const totalRowCount = stepResponse.status === "available"
    ? Math.min(
        stepResponse.timestampsUs.length,
        stepResponse.deltaRegisteredCurrentA.length,
        stepResponse.deltaVoltageV.length,
        stepResponse.voltageDropProxyOhm.length,
      )
    : 0;
  const displayedRowCount = Math.min(totalRowCount, LOAD_STEP_ROW_LIMIT);
  return (
    <section className="card overflow-hidden">
      <div className="border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold text-ink">负载阶跃</h2>
      </div>
      {stepResponse.status === "available" ? (
        <>
          <p className="border-b border-line px-4 py-2 text-[11px] text-ink-faint">
            表格按时间顺序显示前 {formatNumber(displayedRowCount, 0)} / 共{
            " "}{formatNumber(totalRowCount, 0)} 条有效阶跃；候选{
            " "}{formatNumber(stepResponse.candidateCount, 0)}，独立{
            " "}{formatNumber(stepResponse.independentCount, 0)}，电流上升{
            " "}{formatNumber(stepResponse.risingStepCount, 0)}，电流下降{
            " "}{formatNumber(stepResponse.fallingStepCount, 0)}，方向不符合{
            " "}{formatNumber(stepResponse.rejectedDirectionCount, 0)}。
          </p>
          <div className="max-h-[360px] overflow-auto">
            <table className="w-full min-w-[720px] text-left text-xs">
              <thead className="sticky top-0 bg-surface-2 text-[10px] tracking-wider text-ink-faint">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">时间</th>
                  <th className="px-3 py-2.5 font-semibold">已注册电机电流变化 A</th>
                  <th className="px-3 py-2.5 font-semibold">电池电压变化 V</th>
                  <th className="px-3 py-2.5 font-semibold">等效压降代理 mΩ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {Array.from({ length: displayedRowCount }, (_, index) => {
                  const timestampUs = stepResponse.timestampsUs[index];
                  return (
                    <tr key={`${timestampUs}-${index}`} className="hover:bg-surface-2/70">
                      <td className="px-4 py-2.5 font-mono text-ink">
                        {formatNumber(timestampUs / 1_000_000, 3)} s
                      </td>
                      <td className="px-3 py-2.5 font-mono text-ink-dim">
                        {formatNumber(stepResponse.deltaRegisteredCurrentA[index], 2)}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-ink-dim">
                        {formatNumber(stepResponse.deltaVoltageV[index], 3)}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-ink">
                        {formatNumber(stepResponse.voltageDropProxyOhm[index] * 1_000, 2)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <UnavailableBlock
          message={componentUnavailableReason(stepResponse.reason)}
          detail={`候选 ${formatNumber(stepResponse.candidateCount, 0)}，独立 ${formatNumber(stepResponse.independentCount, 0)}，方向符合 ${formatNumber(stepResponse.inverseVoltageCount, 0)}。`}
        />
      )}
    </section>
  );
});

const ModeStatsTable = memo(function ModeStatsTable({
  analysis,
}: {
  analysis: Extract<BatteryLoadResponseAnalysis, { status: "available" }>;
}) {
  const rows = MODE_ORDER.flatMap((mode) => {
    const stats = analysis.modeStats[mode];
    return stats ? [{ mode, stats }] : [];
  });
  return (
    <section className="card overflow-hidden">
      <div className="border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold text-ink">Robot Mode 条件统计</h2>
      </div>
      {rows.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1280px] text-left text-xs">
            <thead className="bg-surface-2 text-[10px] tracking-wider text-ink-faint">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Robot Mode</th>
                <th className="px-3 py-2.5 font-semibold">覆盖时长</th>
                <th className="px-3 py-2.5 font-semibold">平均电压 V</th>
                <th className="px-3 py-2.5 font-semibold">最低电压 V</th>
                <th className="px-3 py-2.5 font-semibold">已注册电机正向输入 Wh</th>
                <th className="px-3 py-2.5 font-semibold">已注册电机正向输入 Ah</th>
                <th className="px-3 py-2.5 font-semibold">峰值正向已注册电机电流 A</th>
                <th className="px-3 py-2.5 font-semibold">I²t A²·s</th>
                <th className="px-3 py-2.5 font-semibold">实际低压时长</th>
                <th className="px-3 py-2.5 font-semibold">重叠 Brownout 事件 / 时长</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map(({ mode, stats }) => (
                <tr key={mode} className="hover:bg-surface-2/70">
                  <td className="px-4 py-2.5 font-mono text-ink">{MODE_LABELS[mode]}</td>
                  <td className="px-3 py-2.5 font-mono text-ink-dim">
                    {formatDuration(stats.summary.coveredDurationSeconds)}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-ink-dim">
                    {formatNumber(stats.summary.averageVoltageV, 2)}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-ink-dim">
                    {formatNumber(stats.summary.minimumVoltageV, 2)}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-ink">
                    {formatNumber(stats.summary.positiveRegisteredInputEnergyWh, 4)}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-ink-dim">
                    {formatNumber(stats.summary.positiveRegisteredChargeAh, 4)}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-ink-dim">
                    {formatNumber(stats.summary.maximumPositiveRegisteredCurrentA, 1)}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-ink-dim">
                    {formatNumber(stats.summary.registeredCurrentSquaredTimeA2Seconds, 1)}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-ink-dim">
                    {stats.lowVoltageDurationSeconds === null
                      ? "不可用"
                      : formatDuration(stats.lowVoltageDurationSeconds)}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-ink-dim">
                    {stats.brownoutEventCount === null || stats.brownoutDurationSeconds === null
                      ? "不可用"
                      : `${formatNumber(stats.brownoutEventCount, 0)} / ${formatDuration(stats.brownoutDurationSeconds)}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-line px-4 py-2 text-[11px] text-ink-faint">
            同一 Brownout 事件跨越 Robot Mode 边界时会计入每个重叠模式；各模式事件数不可相加为总数。
          </p>
        </div>
      ) : (
        <UnavailableBlock message="当前范围没有可用的 Robot Mode 条件区间。" />
      )}
    </section>
  );
});

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
          <h3 className="text-xs font-semibold text-ink">相对 Brownout Voltage 的实际低压</h3>
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

const Limitations = memo(function Limitations({ items }: { items: readonly string[] }) {
  const supersededCoreLimitations = [
    "电流只覆盖 EnergyLogger V2 已注册电机",
    "等效压降代理同时包含供电路径",
    "结果只描述所选日志范围内的观测关系",
  ];
  const limitations = [
    ...REQUIRED_LIMITATIONS,
    ...items.filter((item) =>
      !supersededCoreLimitations.some((prefix) => item.startsWith(prefix)),
    ),
  ];
  return (
    <section className="card overflow-hidden">
      <div className="border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold text-ink">限制说明</h2>
      </div>
      <ul className="list-disc space-y-1 px-8 py-4 text-xs leading-relaxed text-ink-dim">
        {limitations.map((item) => <li key={item}>{item}</li>)}
      </ul>
    </section>
  );
});

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
    V2_REQUIRED: "需要包含已注册电机数据的 EnergyLogger V2 日志。",
    BATTERY_VOLTAGE_UNAVAILABLE: "日志没有可用的电池电压序列。",
    INVALID_RANGE: "所选时间范围无效或没有重叠数据。",
    NO_COMPLETE_INTERVALS: "所选范围没有完整的电压与已注册电机电流区间。",
  };
  return labels[reason];
}

export function componentUnavailableReason(
  reason: BatteryLoadResponseComponentUnavailableReason,
): string {
  const labels: Readonly<Record<BatteryLoadResponseComponentUnavailableReason, string>> = {
    INSUFFICIENT_SAMPLES: "有效样本不足。",
    WEAK_CURRENT_EXCITATION: "已注册电机电流变化范围不足。",
    NO_INVERSE_VOLTAGE_STEPS: "没有足够的电流与电压反向变化窗口。",
    NO_INVERSE_VOLTAGE_WINDOWS: "局部窗口没有稳定的电流与电压反向变化关系。",
    BROWNOUT_VOLTAGE_UNAVAILABLE: "日志没有可用的 Brownout Voltage 序列。",
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
