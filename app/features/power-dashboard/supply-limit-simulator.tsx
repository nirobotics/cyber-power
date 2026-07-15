import { AlertTriangle, CircleHelp, Trash2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import type { SupplyLimitEstimate } from "../log-analysis/core";
import { formatDuration, formatNumber } from "./format";
import { ToggleSwitch } from "./toggle-switch";

export interface SupplyLimitTargetOption {
  id: string;
  subsystemId: string;
  subsystemName: string;
  leaderName: string;
  motorNames: readonly string[];
  motorType: string;
  motorCount: number;
  peakCurrentA: number;
  peakPowerW: number;
  averagePowerW: number;
  energyWh: number;
  robotPositiveInputRatio: number | null;
  unavailableReason?: string;
}

export interface SupplyLimitDraft {
  motorGroupId: string;
  enabled: boolean;
  limitText: string;
}

export interface SupplyLimitDisplayError {
  message: string;
  motorGroupId?: string;
}

export type SupplyLimitDraftPatch = Partial<Pick<SupplyLimitDraft, "enabled" | "limitText">>;

export interface SupplyLimitSimulatorProps {
  targets: readonly SupplyLimitTargetOption[];
  draftLimits: readonly SupplyLimitDraft[];
  errors: readonly SupplyLimitDisplayError[];
  estimate: SupplyLimitEstimate | null;
  simulationEnabled: boolean;
  unavailableReason?: string;
  onSimulationEnabledChange: (enabled: boolean) => void;
  onUpdateDraft: (motorGroupId: string, patch: SupplyLimitDraftPatch) => void;
  onClear: () => void;
}

export function buildSupplyLimitTableRows(
  targets: readonly SupplyLimitTargetOption[],
): SupplyLimitTargetOption[] {
  return [...targets].sort((left, right) =>
    right.energyWh - left.energyWh || left.id.localeCompare(right.id),
  );
}

export function parseSupplyLimitDraftValue(value: string): number | null {
  if (value.trim().length === 0) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function followerNames(target: Pick<SupplyLimitTargetOption, "leaderName" | "motorNames">) {
  return target.motorNames.filter((name) => name !== target.leaderName);
}

export function SupplyLimitSimulator({
  targets,
  draftLimits,
  errors,
  estimate,
  simulationEnabled,
  unavailableReason,
  onSimulationEnabledChange,
  onUpdateDraft,
  onClear,
}: SupplyLimitSimulatorProps) {
  const rows = useMemo(() => buildSupplyLimitTableRows(targets), [targets]);
  const targetById = useMemo(
    () => new Map(targets.map((target) => [target.id, target])),
    [targets],
  );
  const draftById = useMemo(
    () => new Map(draftLimits.map((draft) => [draft.motorGroupId, draft])),
    [draftLimits],
  );
  const errorsByGroupId = useMemo(() => {
    const result = new Map<string, string[]>();
    for (const error of errors) {
      if (!error.motorGroupId) continue;
      result.set(error.motorGroupId, [
        ...(result.get(error.motorGroupId) ?? []),
        error.message,
      ]);
    }
    return result;
  }, [errors]);
  const globalErrors = errors.filter((error) => !error.motorGroupId);
  const enabledDrafts = draftLimits.filter((draft) => draft.enabled);
  const hasInvalidDraft = enabledDrafts.some((draft) => {
    const target = targetById.get(draft.motorGroupId);
    return !target || Boolean(target.unavailableReason) ||
      parseSupplyLimitDraftValue(draft.limitText) === null;
  });
  const canEnableSimulation =
    !unavailableReason &&
    enabledDrafts.length > 0 &&
    errors.length === 0 &&
    !hasInvalidDraft;

  return (
    <div className="grid gap-2.5">
      <section className="card overflow-hidden" aria-label="限流模拟配置">
        <div className="flex flex-wrap items-center justify-end gap-2 border-b border-line px-4 py-3">
          <div className="flex items-center gap-2">
            <ToggleSwitch
              checked={simulationEnabled}
              ariaLabel={simulationEnabled ? "关闭限流模拟" : "启用限流模拟"}
              title={simulationEnabled ? "关闭限流模拟" : "启用限流模拟"}
              disabled={!simulationEnabled && !canEnableSimulation}
              onCheckedChange={onSimulationEnabledChange}
            />
            <button
              type="button"
              className="grid size-8 place-items-center rounded-md border border-line text-ink-dim transition hover:border-danger/50 hover:text-danger disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="清空限流模拟"
              title="清空限流模拟"
              disabled={draftLimits.length === 0 && !simulationEnabled}
              onClick={onClear}
            >
              <Trash2 className="size-4" aria-hidden />
            </button>
          </div>
        </div>

        {unavailableReason ? (
          <div className="flex items-start gap-2 px-4 py-5 text-sm text-warn" role="status">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p>{unavailableReason}</p>
          </div>
        ) : rows.length === 0 ? (
          <p className="px-4 py-5 text-sm text-ink-dim">
            当前 Manifest 没有可用的 Leader 电机组。
          </p>
        ) : (
          <div className="overflow-x-auto" role="region" aria-label="限流模拟电机组表" tabIndex={0}>
            <table className="w-full min-w-[1380px] table-fixed text-left text-xs">
              <colgroup>
                <col className="w-[270px]" />
                <col className="w-[150px]" />
                <col className="w-[90px]" />
                <col />
                <col />
                <col />
                <col />
                <col />
                <col className="w-[180px]" />
                <col className="w-[80px]" />
              </colgroup>
              <thead className="bg-surface-2 text-[10px] tracking-wider text-ink-faint">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">电机组</th>
                  <th className="px-3 py-2.5 font-semibold">电机型号</th>
                  <th className="px-3 py-2.5 font-semibold">数量</th>
                  <th className="px-3 py-2.5 font-semibold">能量</th>
                  <th className="px-3 py-2.5 font-semibold">相对整机正向输入</th>
                  <th className="px-3 py-2.5 font-semibold">平均功率</th>
                  <th className="px-3 py-2.5 font-semibold">峰值功率</th>
                  <th className="px-3 py-2.5 font-semibold">峰值电流</th>
                  <th className="px-3 py-2.5 font-semibold">电机组 Supply 限流值</th>
                  <th className="px-4 py-2.5 font-semibold">启用</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((target, rowIndex) => {
                  const draft = draftById.get(target.id) ?? {
                    motorGroupId: target.id,
                    enabled: false,
                    limitText: "",
                  };
                  const parsedLimit = parseSupplyLimitDraftValue(draft.limitText);
                  const rowErrors = errorsByGroupId.get(target.id) ?? [];
                  const validationMessage = draft.enabled
                    ? rowErrors[0] ?? (parsedLimit === null ? "请输入有效限流值。" : null)
                    : null;
                  const statusId = `supply-limit-status-${rowIndex}`;
                  const unavailableId = target.unavailableReason
                    ? `supply-limit-unavailable-${rowIndex}`
                    : undefined;
                  const describedBy = [
                    validationMessage ? statusId : undefined,
                    unavailableId,
                  ].filter(Boolean).join(" ") || undefined;
                  const followers = followerNames(target);
                  const disabled = Boolean(target.unavailableReason);
                  return (
                    <tr key={target.id} className="hover:bg-surface-2/70">
                      <td className="max-w-[270px] px-4 py-2.5 align-top text-ink">
                        <span className="block break-all font-mono">
                          {target.subsystemName}/{target.leaderName}
                        </span>
                        {followers.length > 0 ? (
                          <span className="block break-all text-[10px] text-ink-faint">
                            {followers.join("、")}
                          </span>
                        ) : null}
                        {target.unavailableReason ? (
                          <span id={unavailableId} className="mt-1 block text-[10px] text-warn">
                            {target.unavailableReason}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2.5 align-top font-mono text-ink-dim">{target.motorType}</td>
                      <td className="px-3 py-2.5 align-top font-mono text-ink-dim">{target.motorCount}</td>
                      <td className="px-3 py-2.5 align-top font-mono text-ink">{formatNumber(target.energyWh, 4)} Wh</td>
                      <td className="px-3 py-2.5 align-top font-mono text-ink-dim">
                        {target.robotPositiveInputRatio === null
                          ? "—"
                          : `${formatNumber(target.robotPositiveInputRatio * 100, 2)}%`}
                      </td>
                      <td className="px-3 py-2.5 align-top font-mono text-ink-dim">{formatNumber(target.averagePowerW, 1)} W</td>
                      <td className="px-3 py-2.5 align-top font-mono text-ink-dim">{formatNumber(target.peakPowerW, 1)} W</td>
                      <td className="px-3 py-2.5 align-top font-mono text-ink-dim">{formatNumber(target.peakCurrentA, 1)} A</td>
                      <td className="px-3 py-2 align-top">
                        <label className="sr-only" htmlFor={`supply-limit-${target.id}`}>
                          {target.subsystemName}/{target.leaderName} 电机组合计 Supply Current 限流值
                        </label>
                        <div className="relative">
                          <input
                            id={`supply-limit-${target.id}`}
                            type="text"
                            inputMode="decimal"
                            value={draft.limitText}
                            onChange={(event) => onUpdateDraft(target.id, {
                              limitText: event.currentTarget.value,
                            })}
                            className="input py-1.5 pr-8"
                            aria-invalid={Boolean(validationMessage) || undefined}
                            aria-describedby={describedBy}
                            disabled={disabled}
                          />
                          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 font-mono text-xs text-ink-faint">A</span>
                        </div>
                        {validationMessage ? (
                          <span id={statusId} className="mt-1 block text-[10px] text-danger" aria-live="polite">
                            {validationMessage}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-2.5 align-top">
                        <ToggleSwitch
                          checked={draft.enabled}
                          ariaLabel={`${draft.enabled ? "停用" : "启用"}${target.subsystemName}/${target.leaderName}限流`}
                          ariaDescribedBy={describedBy}
                          disabled={disabled}
                          onCheckedChange={(enabled) => onUpdateDraft(target.id, { enabled })}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {globalErrors.length > 0 ? (
          <div className="border-t border-danger/40 bg-danger/5 px-4 py-3 text-xs text-danger" role="alert">
            {globalErrors.map((error) => <p key={error.message}>{error.message}</p>)}
          </div>
        ) : null}
      </section>

      {simulationEnabled && estimate ? <SupplyLimitResults estimate={estimate} /> : null}
      <SupplyLimitHelp />
    </div>
  );
}

function SupplyLimitResults({ estimate }: { estimate: SupplyLimitEstimate }) {
  const { totals } = estimate;
  const globalWarnings = estimate.warnings.filter(
    (warning) => warning.motorGroupId === undefined,
  );
  return (
    <section className="card overflow-hidden" aria-labelledby="supply-limit-results-title" aria-live="polite">
      <div className="border-b border-line px-4 py-3">
        <h2 id="supply-limit-results-title" className="text-sm font-semibold text-ink">报告</h2>
      </div>
      <div className="grid divide-y divide-line sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-4">
        <ComparisonMetric label="整机总能量" baseline={totals.baseline.energyWh} estimated={totals.estimated?.energyWh} unit="Wh" digits={3} />
        <ComparisonMetric label="整机峰值电流" baseline={totals.baseline.peakCurrentA} estimated={totals.estimated?.peakCurrentA} unit="A" digits={1} />
        <ComparisonMetric label="整机峰值功率" baseline={totals.baseline.peakPowerW} estimated={totals.estimated?.peakPowerW} unit="W" digits={1} />
        <ComparisonMetric label="整机平均功率" baseline={totals.baseline.averagePowerW} estimated={totals.estimated?.averagePowerW} unit="W" digits={1} />
      </div>
      <div className="grid border-t border-line sm:grid-cols-2 lg:grid-cols-4">
        <ResultValue label={totals.robotEstimateAvailable ? "预计节省能量" : "各电机组节省量合计"} value={`${formatNumber(totals.energySavedWh, 3)} Wh`} />
        <ResultValue label="预计节省比例" value={totals.robotEstimateAvailable ? formatPercent(totals.energySavedPercent, 2) : "—"} />
        <ResultValue label="限流时间并集" value={formatDuration(totals.clippedUnionDurationSeconds)} />
        <ResultValue label="各电机组限流时间之和" value={formatDuration(totals.clippedDurationSumSeconds)} />
      </div>
      {!totals.robotEstimateAvailable ? (
        <div className="flex items-start gap-2 border-t border-warn/40 bg-warn/5 px-4 py-3 text-xs text-warn" role="status">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          电机组与整机数据无法可靠调和；逐电机组结果仍可查看，整机估算不可用。
        </div>
      ) : null}
      <div className="overflow-x-auto border-t border-line">
        <table className="w-full min-w-[1050px] table-fixed text-left text-xs">
          <colgroup><col className="w-[280px]" /><col /><col /><col /><col /><col /><col /></colgroup>
          <thead className="bg-surface-2 text-[10px] tracking-wider text-ink-faint">
            <tr>
              <th className="px-4 py-2.5 font-semibold">电机组</th>
              <th className="px-3 py-2.5 font-semibold">限制</th>
              <th className="px-3 py-2.5 font-semibold">峰值电流</th>
              <th className="px-3 py-2.5 font-semibold">峰值功率</th>
              <th className="px-3 py-2.5 font-semibold">能量</th>
              <th className="px-3 py-2.5 font-semibold">节省</th>
              <th className="px-3 py-2.5 font-semibold">限流时间</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {estimate.targets.map((target) => {
              const followers = target.motorNames.filter((name) => name !== target.leaderName);
              return (
                <tr key={target.motorGroupId} className="hover:bg-surface-2/60">
                  <td className="max-w-[280px] px-4 py-2.5">
                    <span className="block break-all font-mono text-ink">{target.subsystemName}/{target.leaderName}</span>
                    {followers.length > 0 ? <span className="block break-all text-[10px] text-ink-faint">{followers.join("、")}</span> : null}
                    {target.warnings.length > 0 ? (
                      <ul className="mt-1 space-y-0.5 text-[10px] leading-4 text-warn">
                        {target.warnings.map((warning) => (
                          <li key={`${warning.code}:${warning.message}`}>{warning.message}</li>
                        ))}
                      </ul>
                    ) : null}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-ink">{formatNumber(target.limitA, 1)} A</td>
                  <td className="px-3 py-2.5 font-mono text-ink-dim">{formatComparison(target.baseline.peakCurrentA, target.estimated.peakCurrentA, "A", 1)}</td>
                  <td className="px-3 py-2.5 font-mono text-ink-dim">{formatComparison(target.baseline.peakPowerW, target.estimated.peakPowerW, "W", 1)}</td>
                  <td className="px-3 py-2.5 font-mono text-ink-dim">{formatComparison(target.baseline.energyWh, target.estimated.energyWh, "Wh", 3)}</td>
                  <td className="px-3 py-2.5 font-mono text-ok">{formatNumber(target.energySavedWh, 3)} Wh · {formatPercent(target.energySavedPercent, 2)}</td>
                  <td className="px-3 py-2.5 font-mono text-ink-dim">{formatDuration(target.clippedDurationSeconds)} · {formatNumber(target.clippedRangeFraction * 100, 1)}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {globalWarnings.length > 0 ? (
        <div className="border-t border-warn/40 bg-warn/5 px-4 py-3 text-xs text-warn">
          {globalWarnings.map((warning) => <p key={`${warning.code}:${warning.message}`}>{warning.message}</p>)}
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
          if (!event.currentTarget.contains(document.activeElement)) setOpen(false);
        }}
      >
        <button
          type="button"
          className="grid size-9 place-items-center rounded-full border border-line bg-surface text-ink-dim shadow-sm outline-none transition hover:border-brand/50 hover:text-brand focus-visible:ring-2 focus-visible:ring-brand/50"
          aria-label="查看限流模拟说明"
          aria-describedby="supply-limit-help-content"
          aria-expanded={open}
          onPointerDown={(event) => { pointerTypeRef.current = event.pointerType; }}
          onClick={() => {
            if (pointerTypeRef.current === "touch" || pointerTypeRef.current === "pen") {
              setOpen((current) => !current);
            } else {
              setOpen(true);
            }
          }}
          onFocus={() => {
            if (pointerTypeRef.current !== "touch" && pointerTypeRef.current !== "pen") setOpen(true);
          }}
          onBlur={() => { pointerTypeRef.current = null; setOpen(false); }}
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
            "absolute bottom-11 right-0 z-20 w-[min(36rem,calc(100vw-2rem))] rounded-lg border border-line bg-surface px-4 py-3 text-xs leading-5 text-ink-dim shadow-xl transition",
            open ? "visible translate-y-0 opacity-100" : "invisible translate-y-1 opacity-0",
          ].join(" ")}
        >
          <ul className="list-disc space-y-1 pl-4">
            <li>输入值是一台 Leader 与其全部 Followers 的合计 Supply Current 上限，不是单个电机控制器的限流配置。</li>
            <li>Follower 自动归入对应 Leader 电机组，不会作为独立限流目标重复计算。</li>
            <li>“相对整机正向输入”是该组正向输入能量与整机正向输入能量的比值；整机电流会先汇总有符号电流，回生可能抵消其他电机组的输入，因此各行比值不可相加，合计也可能超过 100%。</li>
            <li>模拟按历史正向 Supply Current 的限流比例缩放该组功率与能量，保留原动作时长和电池电压轨迹。</li>
            <li>报告不会改动原图表，也不重新预测最低电压、Brownout、Stator Current、扭矩、温升或机构动作结果。</li>
          </ul>
        </div>
      </div>
    </aside>
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
        {formatNumber(baseline, digits)} {unit}<span className="mx-2 text-ink-faint">→</span>
        <span className="text-brand">{estimated === undefined ? "不可用" : `${formatNumber(estimated, digits)} ${unit}`}</span>
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

function formatComparison(baseline: number, estimated: number, unit: string, digits: number) {
  return `${formatNumber(baseline, digits)} → ${formatNumber(estimated, digits)} ${unit}`;
}
