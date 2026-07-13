import {
  AlertTriangle,
  Check,
  CircleHelp,
  Plus,
  Trash2,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import type { SupplyLimitEstimate } from "../log-analysis/core";
import { formatDuration, formatNumber } from "./format";

export interface SupplyLimitTargetOption {
  id: string;
  rawPath: string;
  parentId: string | null;
  depth: number;
  childrenIds: readonly string[];
  peakCurrentA: number;
  energyWh: number;
  unavailableReason?: string;
}

export interface SupplyLimitDraft {
  nodeId: string;
  enabled: boolean;
  limitText: string;
  aggregateConfirmed: boolean;
}

export interface SupplyLimitDisplayError {
  message: string;
  nodeId?: string;
  relatedNodeId?: string;
}

export type SupplyLimitDraftPatch = Partial<
  Pick<SupplyLimitDraft, "enabled" | "limitText" | "aggregateConfirmed">
>;

export interface SupplyLimitSimulatorProps {
  targets: readonly SupplyLimitTargetOption[];
  draftLimits: readonly SupplyLimitDraft[];
  errors: readonly SupplyLimitDisplayError[];
  estimate: SupplyLimitEstimate | null;
  simulationEnabled: boolean;
  onSimulationEnabledChange: (enabled: boolean) => void;
  onAddTarget: (nodeId: string) => void;
  onUpdateDraft: (nodeId: string, patch: SupplyLimitDraftPatch) => void;
  onRemoveTarget: (nodeId: string) => void;
  onClear: () => void;
}

export interface SupplyLimitHierarchyConflict {
  ancestorId: string;
  descendantId: string;
}

export function orderSupplyLimitTargets(
  targets: readonly SupplyLimitTargetOption[],
): SupplyLimitTargetOption[] {
  const targetById = new Map(targets.map((target) => [target.id, target]));
  const childrenByParentId = new Map<string | null, SupplyLimitTargetOption[]>();
  for (const target of targets) {
    const parentId = target.parentId !== null && targetById.has(target.parentId)
      ? target.parentId
      : null;
    const children = childrenByParentId.get(parentId) ?? [];
    children.push(target);
    childrenByParentId.set(parentId, children);
  }
  for (const children of childrenByParentId.values()) {
    children.sort((left, right) => left.rawPath.localeCompare(right.rawPath));
  }

  const ordered: SupplyLimitTargetOption[] = [];
  const visited = new Set<string>();
  const visit = (target: SupplyLimitTargetOption) => {
    if (visited.has(target.id)) return;
    visited.add(target.id);
    ordered.push(target);
    for (const child of childrenByParentId.get(target.id) ?? []) visit(child);
  };
  for (const root of childrenByParentId.get(null) ?? []) visit(root);
  for (const target of targets) visit(target);
  return ordered;
}

export function parseSupplyLimitDraftValue(value: string): number | null {
  if (value.trim().length === 0) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function findSupplyLimitHierarchyConflicts(
  targets: readonly SupplyLimitTargetOption[],
  limits: readonly Pick<SupplyLimitDraft, "nodeId" | "enabled">[],
): SupplyLimitHierarchyConflict[] {
  const targetById = new Map(targets.map((target) => [target.id, target]));
  const activeIds = new Set(
    limits.filter((limit) => limit.enabled).map((limit) => limit.nodeId),
  );
  const conflicts: SupplyLimitHierarchyConflict[] = [];

  for (const descendantId of activeIds) {
    const visited = new Set<string>([descendantId]);
    let parentId = targetById.get(descendantId)?.parentId ?? null;
    while (parentId !== null && !visited.has(parentId)) {
      if (activeIds.has(parentId)) {
        conflicts.push({ ancestorId: parentId, descendantId });
        break;
      }
      visited.add(parentId);
      parentId = targetById.get(parentId)?.parentId ?? null;
    }
  }

  return conflicts.sort(
    (left, right) =>
      left.ancestorId.localeCompare(right.ancestorId) ||
      left.descendantId.localeCompare(right.descendantId),
  );
}

export function SupplyLimitSimulator({
  targets,
  draftLimits,
  errors,
  estimate,
  simulationEnabled,
  onSimulationEnabledChange,
  onAddTarget,
  onUpdateDraft,
  onRemoveTarget,
  onClear,
}: SupplyLimitSimulatorProps) {
  const targetById = useMemo(
    () => new Map(targets.map((target) => [target.id, target])),
    [targets],
  );
  const draftIds = useMemo(
    () => new Set(draftLimits.map((limit) => limit.nodeId)),
    [draftLimits],
  );
  const orderedTargets = useMemo(() => orderSupplyLimitTargets(targets), [targets]);
  const availableTargets = useMemo(
    () => orderedTargets.filter((target) => !draftIds.has(target.id)),
    [draftIds, orderedTargets],
  );
  const hierarchyConflicts = useMemo(
    () => findSupplyLimitHierarchyConflicts(targets, draftLimits),
    [draftLimits, targets],
  );
  const conflictByNodeId = useMemo(() => {
    const result = new Map<string, SupplyLimitHierarchyConflict>();
    for (const conflict of hierarchyConflicts) {
      result.set(conflict.ancestorId, conflict);
      result.set(conflict.descendantId, conflict);
    }
    return result;
  }, [hierarchyConflicts]);
  const errorsByNodeId = useMemo(() => {
    const result = new Map<string, string[]>();
    const add = (nodeId: string | undefined, message: string) => {
      if (!nodeId) return;
      const current = result.get(nodeId) ?? [];
      current.push(message);
      result.set(nodeId, current);
    };
    for (const error of errors) {
      add(error.nodeId, error.message);
      add(error.relatedNodeId, error.message);
    }
    return result;
  }, [errors]);
  const globalErrors = errors.filter((error) => !error.nodeId);
  const hasInvalidDraft = draftLimits.some((draft) => {
    if (!draft.enabled) return false;
    const target = targetById.get(draft.nodeId);
    return (
      !target ||
      Boolean(target.unavailableReason) ||
      parseSupplyLimitDraftValue(draft.limitText) === null ||
      (target.childrenIds.length > 0 && !draft.aggregateConfirmed)
    );
  });
  const hasErrors =
    errors.length > 0 || hierarchyConflicts.length > 0 || hasInvalidDraft;
  const enabledDraftCount = draftLimits.filter((limit) => limit.enabled).length;
  const canEnableSimulation = enabledDraftCount > 0 && !hasErrors;

  return (
    <div className="grid gap-2.5">
      <section
        className="card overflow-hidden"
        aria-labelledby="supply-limit-editor-title"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <h2
            id="supply-limit-editor-title"
            className="text-sm font-semibold text-ink"
          >
            限流模拟
          </h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              role="switch"
              aria-checked={simulationEnabled}
              aria-label={simulationEnabled ? "关闭限流模拟" : "启用限流模拟"}
              title={simulationEnabled ? "关闭限流模拟" : "启用限流模拟"}
              disabled={!simulationEnabled && !canEnableSimulation}
              onClick={() => onSimulationEnabledChange(!simulationEnabled)}
              className={[
                "relative h-6 w-11 rounded-full outline-none transition focus-visible:ring-2 focus-visible:ring-brand/50 disabled:cursor-not-allowed disabled:opacity-40",
                simulationEnabled ? "bg-brand" : "bg-line-strong",
              ].join(" ")}
            >
              <span
                className={[
                  "absolute top-0.5 size-5 rounded-full bg-white shadow-sm transition-transform",
                  simulationEnabled ? "translate-x-5" : "translate-x-0.5",
                ].join(" ")}
                aria-hidden
              />
            </button>
            <button
              type="button"
              className="grid size-8 place-items-center rounded-md text-ink-faint outline-none transition hover:bg-danger/10 hover:text-danger focus-visible:ring-2 focus-visible:ring-danger/40"
              onClick={onClear}
              disabled={draftLimits.length === 0}
              aria-label="清空限流模拟"
              title="清空限流模拟"
            >
              <Trash2 className="size-4" aria-hidden />
            </button>
          </div>
        </div>

        <div className="border-b border-line px-4 py-3">
          <ul
            className="grid max-h-56 overflow-y-auto rounded-md border border-line bg-surface sm:grid-cols-2 xl:grid-cols-3"
            aria-label="可添加的限流目标"
          >
            {availableTargets.length === 0 ? (
              <li className="px-3 py-4 text-center text-xs text-ink-faint sm:col-span-2 xl:col-span-3">
                所有可用节点均已加入模拟。
              </li>
            ) : (
              availableTargets.map((target) => {
                  const aggregate = target.childrenIds.length > 0;
                  return (
                    <li
                      key={target.id}
                      className="border-b border-line/70 sm:border-r sm:[&:nth-child(2n)]:border-r-0 xl:[&:nth-child(2n)]:border-r xl:[&:nth-child(3n)]:border-r-0"
                    >
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 px-3 py-2 text-left outline-none transition hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
                        onClick={() => {
                          if (!target.unavailableReason) onAddTarget(target.id);
                        }}
                        aria-disabled={Boolean(target.unavailableReason)}
                        title={target.unavailableReason}
                      >
                        <Plus className="size-3.5 shrink-0 text-brand" aria-hidden />
                        <span
                          className="min-w-0 flex-1 truncate font-mono text-xs text-ink"
                          title={target.rawPath}
                          style={{ paddingLeft: `${Math.min(target.depth, 6) * 10}px` }}
                        >
                          {target.rawPath}
                        </span>
                        <span
                          className="max-w-40 shrink-0 truncate text-[10px] text-ink-faint"
                          title={target.unavailableReason}
                        >
                          {target.unavailableReason
                            ? target.unavailableReason
                            : aggregate
                              ? "聚合节点 · 需确认"
                              : target.parentId === null
                                ? "顶层终端组"
                                : "叶节点"}
                        </span>
                      </button>
                    </li>
                  );
                })
            )}
          </ul>
        </div>

        {draftLimits.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-xs">
              <thead className="bg-surface-2 text-[10px] uppercase tracking-wider text-ink-faint">
                <tr>
                  <th className="w-16 px-4 py-2.5 text-center font-semibold">启用</th>
                  <th className="px-3 py-2.5 font-semibold">EnergyLogger 路径</th>
                  <th className="px-3 py-2.5 text-right font-semibold">范围峰值</th>
                  <th className="px-3 py-2.5 text-right font-semibold">范围能量</th>
                  <th className="w-48 px-3 py-2.5 font-semibold">总 Supply 上限</th>
                  <th className="w-48 px-3 py-2.5 font-semibold">节点确认</th>
                  <th className="w-40 px-3 py-2.5 font-semibold">状态</th>
                  <th className="w-16 px-4 py-2.5 text-center font-semibold">移除</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {draftLimits.map((draft, rowIndex) => {
                  const target = targetById.get(draft.nodeId);
                  const aggregate = (target?.childrenIds.length ?? 0) > 0;
                  const nodeErrors = errorsByNodeId.get(draft.nodeId) ?? [];
                  const conflict = conflictByNodeId.get(draft.nodeId);
                  const parsedLimit = parseSupplyLimitDraftValue(draft.limitText);
                  const inputInvalid =
                    nodeErrors.length > 0 ||
                    (draft.enabled && parsedLimit === null) ||
                    Boolean(target?.unavailableReason);
                  const statusId = `supply-limit-status-${rowIndex}`;
                  const errorId = nodeErrors.length > 0 || conflict
                    ? `supply-limit-errors-${rowIndex}`
                    : undefined;
                  return (
                    <tr key={draft.nodeId} className="hover:bg-surface-2/60">
                      <td className="px-4 py-3 text-center align-top">
                        <input
                          type="checkbox"
                          checked={draft.enabled}
                          onChange={(event) =>
                            onUpdateDraft(draft.nodeId, {
                              enabled: event.currentTarget.checked,
                            })
                          }
                          className="size-4 accent-[rgb(var(--brand))]"
                          aria-label={`${draft.enabled ? "禁用" : "启用"}${target?.rawPath ?? draft.nodeId}限流目标`}
                        />
                      </td>
                      <td className="max-w-[340px] px-3 py-3 align-top">
                        <span
                          className="block max-w-full truncate font-mono text-ink"
                          title={target?.rawPath ?? draft.nodeId}
                        >
                          {target?.rawPath ?? draft.nodeId}
                        </span>
                        <span className="mt-1 block text-[10px] text-ink-faint">
                          {aggregate
                            ? "聚合节点"
                            : target?.parentId === null
                              ? "顶层终端电机组"
                              : "叶节点"}
                        </span>
                        {nodeErrors.map((message) => (
                          <span key={message} className="mt-1 block text-[10px] text-danger">
                            {message}
                          </span>
                        ))}
                        {conflict ? (
                          <span className="mt-1 block text-[10px] text-danger">
                            与 {targetById.get(conflict.ancestorId)?.rawPath ?? conflict.ancestorId}
                            {" / "}
                            {targetById.get(conflict.descendantId)?.rawPath ?? conflict.descendantId}
                            存在祖先与后代重复计算冲突。
                          </span>
                        ) : null}
                        {errorId ? (
                          <span id={errorId} className="sr-only">
                            {nodeErrors.join(" ")}
                            {conflict ? " 当前目标与另一目标存在祖先和后代重复计算冲突。" : ""}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-3 text-right align-top font-mono text-ink-dim">
                        {formatNumber(target?.peakCurrentA, 1)} A
                      </td>
                      <td className="px-3 py-3 text-right align-top font-mono text-ink-dim">
                        {formatNumber(target?.energyWh, 3)} Wh
                      </td>
                      <td className="px-3 py-2 align-top">
                        <label className="sr-only" htmlFor={`supply-limit-${draft.nodeId}`}>
                          {target?.rawPath ?? draft.nodeId} 总 Supply 电流上限
                        </label>
                        <div className="relative">
                          <input
                            id={`supply-limit-${draft.nodeId}`}
                            type="text"
                            inputMode="decimal"
                            value={draft.limitText}
                            onChange={(event) =>
                              onUpdateDraft(draft.nodeId, {
                                limitText: event.currentTarget.value,
                              })
                            }
                            className="input py-1.5 pr-8"
                            aria-invalid={inputInvalid || undefined}
                            aria-describedby={[statusId, errorId].filter(Boolean).join(" ")}
                            disabled={!draft.enabled}
                          />
                          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 font-mono text-xs text-ink-faint">
                            A
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-3 align-top">
                        {aggregate ? (
                          <label className="flex items-start gap-2 text-[11px] leading-4 text-ink-dim">
                            <input
                              type="checkbox"
                              checked={draft.aggregateConfirmed}
                              onChange={(event) =>
                                onUpdateDraft(draft.nodeId, {
                                  aggregateConfirmed: event.currentTarget.checked,
                                })
                              }
                              className="mt-0.5 size-4 shrink-0 accent-[rgb(var(--brand))]"
                              disabled={!draft.enabled}
                            />
                            确认该聚合路径代表同构电机组
                          </label>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] text-ok">
                            <Check className="size-3.5" aria-hidden />
                            可直接估算
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3 align-top">
                        <span id={statusId}>
                          <LimitStatus
                            draft={draft}
                            peakCurrentA={target?.peakCurrentA}
                            hasError={inputInvalid || Boolean(conflict)}
                            aggregateConfirmationMissing={aggregate && !draft.aggregateConfirmed}
                            parsedLimit={parsedLimit}
                            simulationEnabled={simulationEnabled && estimate !== null}
                          />
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-center align-top">
                        <button
                          type="button"
                          className="grid size-8 place-items-center rounded-md text-ink-faint outline-none transition hover:bg-danger/10 hover:text-danger focus-visible:ring-2 focus-visible:ring-danger/40"
                          onClick={() => onRemoveTarget(draft.nodeId)}
                          aria-label={`移除${target?.rawPath ?? draft.nodeId}限流目标`}
                          title="移除目标"
                        >
                          <Trash2 className="size-4" aria-hidden />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}

        {hierarchyConflicts.length > 0 || globalErrors.length > 0 ? (
          <div className="border-t border-danger/40 bg-danger/5 px-4 py-3 text-xs text-danger" role="alert">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <div>
                {hierarchyConflicts.map((conflict) => (
                  <p key={`${conflict.ancestorId}:${conflict.descendantId}`}>
                    不能同时模拟「{targetById.get(conflict.ancestorId)?.rawPath ?? conflict.ancestorId}」和其下级「
                    {targetById.get(conflict.descendantId)?.rawPath ?? conflict.descendantId}」。
                  </p>
                ))}
                {globalErrors.map((error) => (
                  <p key={error.message}>{error.message}</p>
                ))}
              </div>
            </div>
          </div>
        ) : null}
      </section>

      {simulationEnabled && estimate ? <SupplyLimitResults estimate={estimate} /> : null}
      <SupplyLimitHelp />
    </div>
  );
}

function LimitStatus({
  draft,
  peakCurrentA,
  parsedLimit,
  hasError,
  aggregateConfirmationMissing,
  simulationEnabled,
}: {
  draft: SupplyLimitDraft;
  peakCurrentA: number | undefined;
  parsedLimit: number | null;
  hasError: boolean;
  aggregateConfirmationMissing: boolean;
  simulationEnabled: boolean;
}) {
  if (!draft.enabled) return <span className="text-[11px] text-ink-faint">未启用</span>;
  if (hasError) return <span className="text-[11px] text-danger">需要修正</span>;
  if (aggregateConfirmationMissing) {
    return <span className="text-[11px] text-warn">等待同构确认</span>;
  }
  if (parsedLimit === null) {
    return <span className="text-[11px] text-danger">输入无效</span>;
  }
  if (parsedLimit === 0) {
    return <span className="text-[11px] text-warn">理论关闭场景</span>;
  }
  if (peakCurrentA !== undefined && parsedLimit >= peakCurrentA) {
    return <span className="text-[11px] text-ink-faint">当前范围不会触发</span>;
  }
  return (
    <span className="text-[11px] text-ok">
      {simulationEnabled ? "模拟中" : "预计会触发"}
    </span>
  );
}

function SupplyLimitResults({ estimate }: { estimate: SupplyLimitEstimate }) {
  const { totals } = estimate;
  const globalWarnings = estimate.warnings.filter((warning) => warning.nodeId === undefined);
  return (
    <section
      className="card overflow-hidden"
      aria-labelledby="supply-limit-results-title"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <h2 id="supply-limit-results-title" className="text-sm font-semibold text-ink">
          限流模拟报告
        </h2>
        <span className="text-[10px] text-ink-faint">
          固定历史时间轴 · {totals.activeTargetCount} 个目标
        </span>
      </div>

      <div className="grid divide-y divide-line sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-4">
        <ComparisonMetric
          label="整机总能量"
          baseline={totals.baseline.energyWh}
          estimated={totals.estimated?.energyWh}
          unit="Wh"
          digits={3}
        />
        <ComparisonMetric
          label="整机峰值电流"
          baseline={totals.baseline.peakCurrentA}
          estimated={totals.estimated?.peakCurrentA}
          unit="A"
          digits={1}
        />
        <ComparisonMetric
          label="整机峰值功率"
          baseline={totals.baseline.peakPowerW}
          estimated={totals.estimated?.peakPowerW}
          unit="W"
          digits={1}
        />
        <ComparisonMetric
          label="整机平均功率"
          baseline={totals.baseline.averagePowerW}
          estimated={totals.estimated?.averagePowerW}
          unit="W"
          digits={1}
        />
      </div>

      <div className="grid border-t border-line sm:grid-cols-2 lg:grid-cols-4">
        <ResultValue
          label={totals.robotEstimateAvailable ? "预计节省能量" : "目标节点节省量合计"}
          value={`${formatNumber(totals.energySavedWh, 3)} Wh`}
        />
        <ResultValue
          label="预计节省比例"
          value={totals.robotEstimateAvailable ? formatPercent(totals.energySavedPercent, 2) : "—"}
        />
        <ResultValue label="限流时间并集" value={formatDuration(totals.clippedUnionDurationSeconds)} />
        <ResultValue label="各目标限流时间之和" value={formatDuration(totals.clippedDurationSumSeconds)} />
      </div>

      {!totals.robotEstimateAvailable ? (
        <div className="flex items-start gap-2 border-t border-warn/40 bg-warn/5 px-4 py-3 text-xs text-warn" role="status">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          节点与整机数据无法可靠调和；逐目标结果仍可查看，整机估算不可用。
        </div>
      ) : null}

      <div className="overflow-x-auto border-t border-line">
        <table className="w-full min-w-[1120px] text-left text-xs">
          <thead className="bg-surface-2 text-[10px] uppercase tracking-wider text-ink-faint">
            <tr>
              <th className="px-4 py-2.5 font-semibold">EnergyLogger 路径</th>
              <th className="px-3 py-2.5 text-right font-semibold">限制</th>
              <th className="px-3 py-2.5 text-right font-semibold">峰值电流</th>
              <th className="px-3 py-2.5 text-right font-semibold">峰值功率</th>
              <th className="px-3 py-2.5 text-right font-semibold">能量</th>
              <th className="px-3 py-2.5 text-right font-semibold">节省</th>
              <th className="px-3 py-2.5 text-right font-semibold">限流时间</th>
              <th className="px-3 py-2.5 font-semibold">状态</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {estimate.targets.map((target) => (
              <tr key={target.nodeId} className="hover:bg-surface-2/60">
                <td className="max-w-[360px] px-4 py-2.5">
                  <span className="block max-w-full truncate font-mono text-ink" title={target.rawPath}>
                    {target.rawPath}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-ink">
                  {formatNumber(target.limitA, 1)} A
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-ink-dim">
                  {formatComparison(target.baseline.peakCurrentA, target.estimated.peakCurrentA, "A", 1)}
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-ink-dim">
                  {formatComparison(target.baseline.peakPowerW, target.estimated.peakPowerW, "W", 1)}
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-ink-dim">
                  {formatComparison(target.baseline.energyWh, target.estimated.energyWh, "Wh", 3)}
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-ok">
                  {formatNumber(target.energySavedWh, 3)} Wh · {formatPercent(target.energySavedPercent, 2)}
                </td>
                <td className="px-3 py-2.5 text-right font-mono text-ink-dim">
                  {formatDuration(target.clippedDurationSeconds)} · {formatNumber(target.clippedRangeFraction * 100, 1)}%
                </td>
                <td className="px-3 py-2.5">
                  <TargetEstimateStatus warnings={target.warnings} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {globalWarnings.length > 0 ? (
        <div className="border-t border-warn/40 bg-warn/5 px-4 py-3 text-xs text-warn">
          {globalWarnings.map((warning) => (
            <p key={`${warning.code}:${warning.nodeId ?? ""}:${warning.message}`}>
              {warning.message}
            </p>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function SupplyLimitHelp() {
  const [open, setOpen] = useState(false);
  const pointerTypeRef = useRef<string | null>(null);
  return (
    <aside className="relative flex justify-end" aria-label="限流模拟说明">
      <div
        className="relative"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={(event) => {
          if (event.currentTarget.contains(document.activeElement)) return;
          setOpen(false);
        }}
      >
        <button
          type="button"
          className="grid size-9 place-items-center rounded-full border border-line bg-surface text-ink-dim shadow-sm outline-none transition hover:border-brand/50 hover:text-brand focus-visible:ring-2 focus-visible:ring-brand/50"
          aria-label="查看限流模拟说明"
          aria-describedby="supply-limit-help-content"
          aria-expanded={open}
          onPointerDown={(event) => {
            pointerTypeRef.current = event.pointerType;
          }}
          onClick={() => {
            if (pointerTypeRef.current === "touch" || pointerTypeRef.current === "pen") {
              setOpen((current) => !current);
              return;
            }
            setOpen(true);
          }}
          onFocus={() => {
            if (pointerTypeRef.current !== "touch" && pointerTypeRef.current !== "pen") {
              setOpen(true);
            }
          }}
          onBlur={() => {
            pointerTypeRef.current = null;
            setOpen(false);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            pointerTypeRef.current = null;
            setOpen(false);
            event.currentTarget.blur();
          }}
        >
          <CircleHelp className="size-4" aria-hidden />
        </button>
        <div
          id="supply-limit-help-content"
          role="tooltip"
          className={[
            "absolute bottom-11 right-0 z-20 w-[min(34rem,calc(100vw-2rem))] rounded-lg border border-line bg-surface px-4 py-3 text-xs leading-5 text-ink-dim shadow-xl transition",
            open ? "visible translate-y-0 opacity-100" : "invisible translate-y-1 opacity-0",
          ].join(" ")}
        >
          <ul className="list-disc space-y-1 pl-4">
            <li>输入值是 EnergyLogger 节点记录的合计 Supply Current 上限，不是单台电机控制器的限流值。</li>
            <li>顶层终端电机组可直接配置；带下级节点的聚合路径必须确认其代表同构电机组。</li>
            <li>同一模拟不能同时启用祖先和后代节点，避免重复计算。</li>
            <li>模拟保持历史动作时长和电池电压轨迹不变，不重新预测最低电压或 Brownout。</li>
            <li>报告不预测 Stator Current、扭矩、温升、机构动作或动作结果。</li>
          </ul>
        </div>
      </div>
    </aside>
  );
}

function TargetEstimateStatus({ warnings }: { warnings: SupplyLimitEstimate["targets"][number]["warnings"] }) {
  if (warnings.length === 0) return <span className="text-ok">正常</span>;
  const onlyNotTriggered = warnings.every((warning) => warning.code === "LIMIT_NOT_TRIGGERED");
  return (
    <details className={onlyNotTriggered ? "text-ink-faint" : "text-warn"}>
      <summary className="cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-brand/50">
        {onlyNotTriggered ? "未触发" : `${warnings.length} 条提示`}
      </summary>
      <ul className="mt-1 min-w-64 list-disc space-y-1 pl-4 text-[10px] leading-4">
        {warnings.map((warning) => (
          <li key={`${warning.code}:${warning.message}`}>{warning.message}</li>
        ))}
      </ul>
    </details>
  );
}

function formatPercent(value: number | null, digits: number) {
  return value === null ? "—" : `${formatNumber(value, digits)}%`;
}

function ComparisonMetric({
  label,
  baseline,
  estimated,
  unit,
  digits,
}: {
  label: string;
  baseline: number;
  estimated: number | undefined;
  unit: string;
  digits: number;
}) {
  return (
    <div className="min-w-0 px-4 py-3">
      <span className="text-[11px] font-medium text-ink-faint">{label}</span>
      <span className="mt-1 block truncate font-mono text-sm font-semibold text-ink">
        {formatNumber(baseline, digits)} {unit}
        <span className="mx-2 text-ink-faint">→</span>
        <span className="text-brand">
          {estimated === undefined ? "不可用" : `${formatNumber(estimated, digits)} ${unit}`}
        </span>
      </span>
    </div>
  );
}

function ResultValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-line px-4 py-3 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
      <span className="text-[11px] text-ink-faint">{label}</span>
      <span className="mt-1 block font-mono text-sm font-semibold text-ink">{value}</span>
    </div>
  );
}

function formatComparison(
  baseline: number,
  estimated: number,
  unit: string,
  digits: number,
) {
  return `${formatNumber(baseline, digits)} → ${formatNumber(estimated, digits)} ${unit}`;
}
