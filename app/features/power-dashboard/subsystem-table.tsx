import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import type {
  EnergyLogDataset,
  RangeAnalysis,
  SubsystemRangeMetrics,
} from "../log-analysis/core";
import { formatNumber } from "./format";

export interface SubsystemTableRow {
  metric: SubsystemRangeMetrics;
  visualDepth: number;
  hasChildren: boolean;
}

interface IndexedMetric {
  metric: SubsystemRangeMetrics;
  sourceIndex: number;
}

function compareMetrics(left: IndexedMetric, right: IndexedMetric): number {
  const energyDifference = right.metric.energyWh - left.metric.energyWh;
  if (energyDifference !== 0) return energyDifference;

  const pathDifference = left.metric.rawPath.localeCompare(right.metric.rawPath);
  if (pathDifference !== 0) return pathDifference;

  const idDifference = left.metric.id.localeCompare(right.metric.id);
  return idDifference !== 0 ? idDifference : left.sourceIndex - right.sourceIndex;
}

export function buildSubsystemTableRows(
  metrics: readonly SubsystemRangeMetrics[],
  expandedIds: ReadonlySet<string> = new Set(),
): SubsystemTableRow[] {
  const indexed = metrics.map((metric, sourceIndex) => ({ metric, sourceIndex }));
  const metricsById = new Map(indexed.map((item) => [item.metric.id, item]));
  const childrenByParentId = new Map<string, IndexedMetric[]>();

  for (const item of indexed) {
    const parentId = item.metric.parentId;
    if (parentId === null || !metricsById.has(parentId)) continue;
    const siblings = childrenByParentId.get(parentId) ?? [];
    siblings.push(item);
    childrenByParentId.set(parentId, siblings);
  }

  for (const siblings of childrenByParentId.values()) siblings.sort(compareMetrics);

  const rows: SubsystemTableRow[] = [];
  const visited = new Set<string>();
  const visit = (item: IndexedMetric, visualDepth: number, visible: boolean) => {
    if (visited.has(item.metric.id)) return;
    visited.add(item.metric.id);
    const children = childrenByParentId.get(item.metric.id) ?? [];
    if (visible) {
      rows.push({
        metric: item.metric,
        visualDepth,
        hasChildren: children.length > 0,
      });
    }
    const childrenVisible = visible && expandedIds.has(item.metric.id);
    for (const child of children) {
      visit(child, visualDepth + 1, childrenVisible);
    }
  };

  const roots = indexed
    .filter((item) => item.metric.parentId === null)
    .sort(compareMetrics);
  for (const root of roots) visit(root, 0, true);

  const orphanRoots = indexed
    .filter(
      (item) =>
        item.metric.parentId !== null && !metricsById.has(item.metric.parentId),
    )
    .sort(compareMetrics);
  for (const orphanRoot of orphanRoots) visit(orphanRoot, 0, true);

  // Malformed disconnected cycles also remain visible instead of disappearing.
  for (const item of [...indexed].sort(compareMetrics)) visit(item, 0, true);

  return rows;
}

export function SubsystemTable({ dataset, analysis }: { dataset: EnergyLogDataset; analysis: RangeAnalysis }) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const nodesById = new Map(dataset.subsystems.map((node) => [node.id, node]));
  const rows = buildSubsystemTableRows(analysis.subsystems, expandedIds);

  const toggleExpanded = (id: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <section id="subsystem-details" className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-xs">
          <thead className="bg-surface-2 text-[10px] uppercase tracking-wider text-ink-faint">
            <tr>
              <th className="px-4 py-2.5 font-semibold">路径</th>
              <th className="px-3 py-2.5 text-right font-semibold">能量</th>
              <th className="px-3 py-2.5 text-right font-semibold">同级占比</th>
              <th className="px-3 py-2.5 text-right font-semibold">平均功率</th>
              <th className="px-3 py-2.5 text-right font-semibold">峰值功率</th>
              <th className="px-3 py-2.5 text-right font-semibold">峰值电流</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map(({ metric, visualDepth, hasChildren }) => {
              const node = nodesById.get(metric.id);
              const path = node?.rawPath ?? metric.rawPath;
              const expanded = expandedIds.has(metric.id);
              return (
                <tr key={metric.id} className="hover:bg-surface-2/70">
                  <td
                    className="max-w-[360px] px-4 py-2.5 font-mono text-ink"
                    title={path}
                  >
                    <div
                      className="flex min-w-0 items-center gap-1"
                      style={{ paddingLeft: `${visualDepth * 16}px` }}
                    >
                      {hasChildren ? (
                        <button
                          type="button"
                          className="grid size-6 shrink-0 place-items-center rounded text-ink-dim outline-none transition hover:bg-bg hover:text-ink focus-visible:ring-2 focus-visible:ring-brand/50"
                          onClick={() => toggleExpanded(metric.id)}
                          aria-expanded={expanded}
                          aria-label={`${expanded ? "收起" : "展开"}${path}的下级子系统`}
                          title={expanded ? "收起下级子系统" : "展开下级子系统"}
                        >
                          {expanded ? (
                            <ChevronDown className="size-3.5" aria-hidden />
                          ) : (
                            <ChevronRight className="size-3.5" aria-hidden />
                          )}
                        </button>
                      ) : (
                        <span className="size-6 shrink-0" aria-hidden="true" />
                      )}
                      <span className="min-w-0 truncate">{path}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-ink">
                    {formatNumber(metric.energyWh, 4)} Wh
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-ink-dim">
                    {formatNumber(
                      metric.share === null ? undefined : metric.share * 100,
                      2,
                    )}%
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-ink-dim">
                    {formatNumber(metric.averagePowerW, 1)} W
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-ink-dim">
                    {formatNumber(metric.peakPowerW, 1)} W
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-ink-dim">
                    {formatNumber(metric.peakCurrentA, 1)} A
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
