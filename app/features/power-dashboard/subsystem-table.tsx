import type { EnergyLogDataset, RangeAnalysis } from "../log-analysis/core";
import { formatNumber } from "./format";

export function SubsystemTable({ dataset, analysis }: { dataset: EnergyLogDataset; analysis: RangeAnalysis }) {
  const rows = analysis.subsystems
    .map((metric) => ({ metric, node: dataset.subsystems.find((node) => node.id === metric.id) }))
    .sort((a, b) => b.metric.energyWh - a.metric.energyWh);

  return (
    <section className="card overflow-hidden">
      <div className="border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold text-ink">Subsystem details</h2>
        <p className="mt-1 text-xs text-ink-dim">
          Dynamic EnergyLogger hierarchy for the selected time range. Aggregate parents are not added to their descendants.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-left text-xs">
          <thead className="bg-surface-2 text-[10px] uppercase tracking-wider text-ink-faint">
            <tr>
              <th className="px-4 py-2.5 font-semibold">Path</th>
              <th className="px-3 py-2.5 text-right font-semibold">Energy</th>
              <th className="px-3 py-2.5 text-right font-semibold">Share</th>
              <th className="px-3 py-2.5 text-right font-semibold">Average power</th>
              <th className="px-3 py-2.5 text-right font-semibold">Peak power</th>
              <th className="px-3 py-2.5 text-right font-semibold">Peak current</th>
              <th className="px-4 py-2.5 font-semibold">Kind</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map(({ metric, node }) => (
              <tr key={metric.id} className="hover:bg-surface-2/70">
                <td className="max-w-[360px] px-4 py-2.5 font-mono text-ink" title={node?.rawPath}>
                  <span style={{ paddingLeft: `${Math.min(node?.depth ?? 0, 6) * 14}px` }}>
                    {node?.rawPath ?? metric.id}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-ink">{formatNumber(metric.energyWh, 4)} Wh</td>
                <td className="px-3 py-2.5 text-right font-mono text-ink-dim">{formatNumber(metric.share === null ? undefined : metric.share * 100, 2)}%</td>
                <td className="px-3 py-2.5 text-right font-mono text-ink-dim">{formatNumber(metric.averagePowerW, 1)} W</td>
                <td className="px-3 py-2.5 text-right font-mono text-ink-dim">{formatNumber(metric.peakPowerW, 1)} W</td>
                <td className="px-3 py-2.5 text-right font-mono text-ink-dim">{formatNumber(metric.peakCurrentA, 1)} A</td>
                <td className="px-4 py-2.5 text-ink-dim">{node?.isAggregate ? "Aggregate" : "Leaf"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
