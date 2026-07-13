import type { EnergyLogDataset, RangeAnalysis } from "../log-analysis/core";
import { formatNumber } from "./format";
import { SUBSYSTEM_COLORS } from "./subsystem-colors";

export function SubsystemShare({
  dataset,
  analysis,
}: {
  dataset: EnergyLogDataset;
  analysis: RangeAnalysis;
}) {
  const nodesById = new Map(dataset.subsystems.map((node) => [node.id, node]));
  const rows = analysis.subsystems
    .map((metric) => ({
      metric,
      node: nodesById.get(metric.id),
    }))
    .filter(({ metric }) => metric.parentId === null)
    .sort(
      (left, right) =>
        right.metric.energyWh - left.metric.energyWh ||
        left.metric.rawPath.localeCompare(right.metric.rawPath),
    );

  return (
    <section className="card flex min-h-0 flex-col overflow-hidden" aria-labelledby="subsystem-share-title">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 id="subsystem-share-title" className="text-sm font-semibold text-ink">
          子系统能量占比
        </h2>
        <span className="text-[10px] text-ink-faint">能量（Wh） · 同级占比</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
        {rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-ink-dim">
            未找到顶层子系统序列。
          </p>
        ) : (
          <ol>
            {rows.map(({ metric, node }, index) => (
              <li key={metric.id} className="border-b border-line/70 py-2.5 last:border-b-0">
                <div className="flex items-center gap-2 text-xs">
                  <span className="size-2 shrink-0 rounded-full" style={{ background: SUBSYSTEM_COLORS[index % SUBSYSTEM_COLORS.length] }} />
                  <span className="min-w-0 flex-1 truncate font-mono text-ink" title={node?.rawPath}>
                    {node?.rawPath ?? metric.rawPath}
                  </span>
                  <span className="font-mono text-ink">{formatNumber(metric.energyWh, 3)}</span>
                  <span className="w-12 text-right font-mono text-ink-dim">{formatNumber((metric.share ?? 0) * 100, 1)}%</span>
                </div>
                <div className="mt-2 h-0.5 overflow-hidden rounded-full bg-line">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.max(0, Math.min(100, (metric.share ?? 0) * 100))}%`,
                      background: SUBSYSTEM_COLORS[index % SUBSYSTEM_COLORS.length],
                    }}
                  />
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
