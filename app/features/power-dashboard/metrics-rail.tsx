import type { RangeAnalysis } from "../log-analysis/core";
import { formatDuration, formatNumber } from "./format";

export function MetricsRail({ analysis }: { analysis: RangeAnalysis }) {
  const { totals } = analysis;
  const metrics: Array<{ label: string; value: string; tone?: "warning" | "danger" }> = [
    { label: "Duration", value: formatDuration(analysis.range.durationSeconds) },
    { label: "Total Energy", value: `${formatNumber(totals.energyWh, 3)} Wh` },
    { label: "Average Power", value: `${formatNumber(totals.averagePowerW, 1)} W` },
    { label: "Peak Power", value: `${formatNumber(totals.peakPowerW, 1)} W` },
    { label: "Peak Current", value: `${formatNumber(totals.peakCurrentA, 1)} A` },
    {
      label: "Minimum Voltage",
      value: totals.minVoltageV === undefined ? "Unavailable" : `${formatNumber(totals.minVoltageV, 2)} V`,
      tone: totals.minVoltageV !== undefined && totals.minVoltageV < 7 ? "warning" : undefined,
    },
    { label: "Brownouts", value: formatNumber(totals.brownoutCount, 0), tone: totals.brownoutCount > 0 ? "danger" : undefined },
  ];

  return (
    <div className="grid divide-y divide-line border-y border-line bg-surface sm:grid-cols-4 sm:divide-x sm:divide-y-0 xl:grid-cols-7">
      {metrics.map((metric) => (
        <div key={metric.label} className="min-w-0 px-4 py-3">
          <p className="truncate text-[11px] font-medium text-ink-faint">{metric.label}</p>
          <p
            className={[
              "mt-1 truncate font-mono text-lg font-semibold tracking-tight text-ink",
              metric.tone === "warning" ? "text-warn" : "",
              metric.tone === "danger" ? "text-danger" : "",
            ].join(" ")}
          >
            {metric.value}
          </p>
        </div>
      ))}
    </div>
  );
}
