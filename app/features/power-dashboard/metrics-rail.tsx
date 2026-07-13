import { Crosshair } from "lucide-react";
import type { RangeAnalysis } from "../log-analysis/core";
import { formatDuration, formatNumber } from "./format";

export function MetricsRail({
  analysis,
  onLocatePeakPower,
  onLocatePeakCurrent,
}: {
  analysis: RangeAnalysis;
  onLocatePeakPower: () => void;
  onLocatePeakCurrent: () => void;
}) {
  const { totals } = analysis;
  const metrics: Array<{
    label: string;
    value: string;
    tone?: "warning" | "danger";
    onClick?: () => void;
    hint?: string;
  }> = [
    { label: "有效持续时间", value: formatDuration(totals.effectiveDurationSeconds) },
    { label: "总能量", value: `${formatNumber(totals.energyWh, 3)} Wh` },
    { label: "平均功率", value: `${formatNumber(totals.averagePowerW, 1)} W` },
    { label: "峰值功率", value: `${formatNumber(totals.peakPowerW, 1)} W`, onClick: onLocatePeakPower, hint: "定位峰值功率时间" },
    { label: "峰值电流", value: `${formatNumber(totals.peakCurrentA, 1)} A`, onClick: onLocatePeakCurrent, hint: "定位峰值电流时间" },
    {
      label: "最低电压",
      value: totals.minVoltageV === undefined ? "无可用数据" : `${formatNumber(totals.minVoltageV, 2)} V`,
      tone: totals.minVoltageV !== undefined && totals.minVoltageV < 7 ? "warning" : undefined,
    },
    { label: "Brownout 次数", value: formatNumber(totals.brownoutCount, 0), tone: totals.brownoutCount > 0 ? "danger" : undefined },
  ];

  return (
    <div className="grid divide-y divide-line bg-surface sm:grid-cols-4 sm:divide-x sm:divide-y-0 xl:grid-cols-7">
      {metrics.map((metric) => {
        const content = (
          <>
            <span className="flex items-center gap-1.5 truncate text-[11px] font-medium text-ink-faint">
              {metric.label}
              {metric.onClick ? <Crosshair className="size-3 shrink-0" aria-hidden /> : null}
            </span>
            <span
              className={[
                "mt-1 block truncate font-mono text-lg font-semibold tracking-tight text-ink",
                metric.tone === "warning" ? "text-warn" : "",
                metric.tone === "danger" ? "text-danger" : "",
              ].join(" ")}
            >
              {metric.value}
            </span>
          </>
        );
        return metric.onClick ? (
          <button
            key={metric.label}
            type="button"
            onClick={metric.onClick}
            className="min-w-0 px-4 py-3 text-left transition hover:bg-brand/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/50"
            aria-label={metric.hint}
            title={metric.hint}
          >
            {content}
          </button>
        ) : (
          <div key={metric.label} className="min-w-0 px-4 py-3">
            {content}
          </div>
        );
      })}
    </div>
  );
}
