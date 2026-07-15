import { useState } from "react";
import type {
  EnergyLogDataset,
  EnergyLoggerV2RangeAnalysis,
  EnergyLoggerV2StateMetrics,
  RangeAnalysis,
  SubsystemRangeMetrics,
} from "../log-analysis/core";
import { formatDuration, formatNumber } from "./format";
import { HierarchyPathCell } from "./hierarchy-path-cell";
import { buildHierarchyTableRows } from "./hierarchy-table";

export interface SubsystemTableRow {
  metric: SubsystemRangeMetrics;
  state?: EnergyLoggerV2StateMetrics;
  visualDepth: number;
  hasChildren: boolean;
}

function compareMetrics(
  left: SubsystemRangeMetrics,
  right: SubsystemRangeMetrics,
): number {
  const energyDifference = right.energyWh - left.energyWh;
  if (energyDifference !== 0) return energyDifference;

  const pathDifference = left.rawPath.localeCompare(right.rawPath);
  if (pathDifference !== 0) return pathDifference;

  return left.id.localeCompare(right.id);
}

export function buildSubsystemTableRows(
  metrics: readonly SubsystemRangeMetrics[],
  expandedIds: ReadonlySet<string> = new Set(),
  v2Analysis?: EnergyLoggerV2RangeAnalysis,
): SubsystemTableRow[] {
  const statesBySubsystemName = new Map(
    v2Analysis?.subsystems.map((subsystem) => [subsystem.name, subsystem.states]) ?? [],
  );

  return buildHierarchyTableRows(metrics, expandedIds, compareMetrics).flatMap(
    ({ item, visualDepth, hasChildren }) => {
      const states = item.parentId === null
        ? statesBySubsystemName.get(item.rawPath) ?? []
        : [];
      const row = {
        metric: item,
        visualDepth,
        hasChildren: hasChildren || states.length > 0,
      };
      if (!expandedIds.has(item.id)) return [row];
      return [
        row,
        ...states.map((state) => ({
          metric: item,
          state,
          visualDepth: visualDepth + 1,
          hasChildren: false,
        })),
      ];
    },
  );
}

export function SubsystemTable({
  dataset,
  analysis,
  v2Analysis,
  onLocateTimestamp,
}: {
  dataset: EnergyLogDataset;
  analysis: RangeAnalysis;
  v2Analysis?: EnergyLoggerV2RangeAnalysis;
  onLocateTimestamp: (timestampUs: number) => void;
}) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const nodesById = new Map(dataset.subsystems.map((node) => [node.id, node]));
  const rows = buildSubsystemTableRows(analysis.subsystems, expandedIds, v2Analysis);

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
      <div className="border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold text-ink">功耗明细</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1080px] text-left text-xs">
          <thead className="bg-surface-2 text-[10px] uppercase tracking-wider text-ink-faint">
            <tr>
              <th className="px-4 py-2.5 font-semibold">子系统</th>
              <th className="px-3 py-2.5 font-semibold">状态</th>
              <th className="px-3 py-2.5 text-right font-semibold">有效持续时间</th>
              <th className="px-3 py-2.5 text-right font-semibold">能量</th>
              <th className="px-3 py-2.5 text-right font-semibold">同级占比</th>
              <th className="px-3 py-2.5 text-right font-semibold">平均功率</th>
              <th className="px-3 py-2.5 text-right font-semibold">峰值功率</th>
              <th className="px-3 py-2.5 text-right font-semibold">峰值电流</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map(({ metric, state, visualDepth, hasChildren }) => {
              const node = nodesById.get(metric.id);
              const path = node?.rawPath ?? metric.rawPath;
              const expanded = expandedIds.has(metric.id);
              const peakPowerW = state?.peakPowerW ?? metric.peakPowerW;
              const peakPowerTimestampUs =
                state?.peakPowerTimestampUs ?? metric.peakPowerTimestampUs;
              const peakCurrentA = state?.peakCurrentA ?? metric.peakCurrentA;
              const peakCurrentTimestampUs =
                state?.peakCurrentTimestampUs ?? metric.peakCurrentTimestampUs;
              return (
                <tr
                  key={state ? `${metric.id}/state/${state.state}` : metric.id}
                  className={state ? "bg-surface-2/30 hover:bg-surface-2/70" : "hover:bg-surface-2/70"}
                >
                  {state ? (
                    <td className="max-w-[360px] px-4 py-2.5 font-mono text-ink-faint">
                      <span style={{ paddingLeft: `${visualDepth * 1.25}rem` }}>↳</span>
                    </td>
                  ) : (
                    <HierarchyPathCell
                      className="max-w-[360px] px-4 py-2.5 font-mono text-ink"
                      path={path}
                      visualDepth={visualDepth}
                      hasChildren={hasChildren}
                      expanded={expanded}
                      onToggle={() => toggleExpanded(metric.id)}
                    />
                  )}
                  <td className="px-3 py-2.5 font-mono text-ink">
                    {state?.state ?? "全部"}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-ink-dim">
                    {formatDuration(
                      state?.durationSeconds ?? analysis.totals.effectiveDurationSeconds,
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-ink">
                    {formatNumber(state?.energyWh ?? metric.energyWh, 4)} Wh
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-ink-dim">
                    {state
                      ? "—"
                      : `${formatNumber(
                        metric.share === null ? undefined : metric.share * 100,
                        2,
                      )}%`}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-ink-dim">
                    {formatNumber(
                      state?.averagePowerW ?? metric.averagePowerW,
                      1,
                    )} W
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono">
                    <PeakMetricButton
                      value={peakPowerW}
                      timestampUs={peakPowerTimestampUs}
                      unit="W"
                      ariaLabel={`定位 ${path}${state ? ` ${state.state}` : ""} 的峰值功率`}
                      onLocate={onLocateTimestamp}
                    />
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono">
                    <PeakMetricButton
                      value={peakCurrentA}
                      timestampUs={peakCurrentTimestampUs}
                      unit="A"
                      ariaLabel={`定位 ${path}${state ? ` ${state.state}` : ""} 的峰值电流`}
                      onLocate={onLocateTimestamp}
                    />
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

function PeakMetricButton({
  value,
  timestampUs,
  unit,
  ariaLabel,
  onLocate,
}: {
  value: number;
  timestampUs: number;
  unit: string;
  ariaLabel: string;
  onLocate: (timestampUs: number) => void;
}) {
  if (!Number.isFinite(value) || !Number.isFinite(timestampUs)) {
    return <span className="text-ink-faint">不可用</span>;
  }
  return (
    <button
      type="button"
      className="rounded text-brand outline-none hover:underline focus-visible:ring-2 focus-visible:ring-brand/50"
      aria-label={ariaLabel}
      title="定位到发生时间"
      onClick={() => onLocate(timestampUs)}
    >
      {formatNumber(value, 1)} {unit}
    </button>
  );
}
