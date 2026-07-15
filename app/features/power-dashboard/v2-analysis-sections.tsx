import { ChevronDown, ChevronRight } from "lucide-react";
import { Fragment, useState } from "react";
import {
  MOTOR_COVERAGE_STATUS,
  type EnergyLoggerV2Contract,
  type EnergyLoggerV2MotorGroupMetrics,
  type EnergyLoggerV2RangeAnalysis,
  type MotorCoverageStatusCode,
  type MotorCoverageTimeline,
} from "../log-analysis/core";
import { formatDuration, formatNumber } from "./format";

const COVERAGE_REASONS = [
  { code: MOTOR_COVERAGE_STATUS.NONFINITE_SIGNAL, label: "信号不是有限值" },
  { code: MOTOR_COVERAGE_STATUS.INVALID_BATTERY_VOLTAGE, label: "电池电压无效" },
  { code: MOTOR_COVERAGE_STATUS.NONPOSITIVE_SUPPLY_CURRENT, label: "Supply Current 非正" },
  { code: MOTOR_COVERAGE_STATUS.ZERO_STATOR_CURRENT, label: "Stator Current 为零" },
  {
    code: MOTOR_COVERAGE_STATUS.REGENERATIVE_STATOR_CURRENT,
    label: "Stator Current 为负：再生制动工况（不代表电池净回充）",
  },
  { code: MOTOR_COVERAGE_STATUS.PHYSICALLY_IMPOSSIBLE, label: "功率守恒检查未通过" },
] as const satisfies ReadonlyArray<{ code: MotorCoverageStatusCode; label: string }>;

export function followerMotorNames(group: EnergyLoggerV2MotorGroupMetrics): string[] {
  return group.motorNames.filter((name) => name !== group.leaderName);
}

export function coverageReasonRows(coverage: MotorCoverageTimeline) {
  return COVERAGE_REASONS.flatMap(({ code, label }) => {
    const durationSeconds = coverage.durationSecondsByStatus[code] ?? 0;
    return durationSeconds > 0 ? [{ code, label, durationSeconds }] : [];
  });
}

export function V2AnalysisSections({
  analysis,
  contractVersion,
}: {
  analysis: EnergyLoggerV2RangeAnalysis | undefined;
  contractVersion?: EnergyLoggerV2Contract["contractVersion"];
}) {
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(() => new Set());
  const groups = analysis?.subsystems.flatMap((subsystem) =>
    subsystem.motorGroups.map((group) => ({ subsystem, group })),
  ) ?? [];

  const toggleGroup = (groupId: string) => {
    setExpandedGroupIds((current) => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  return (
    <div className="grid gap-2.5">
      {analysis ? (
        <section className="card overflow-hidden">
          <div className="border-b border-line px-4 py-3">
            <h2 className="text-sm font-semibold text-ink">电机效率与减速比推荐</h2>
          </div>
          {groups.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-ink-dim">
              当前 Manifest 没有可分析的 Leader 电机。
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1640px] text-left text-xs">
                <thead className="bg-surface-2 text-[10px] tracking-wider text-ink-faint">
                  <tr>
                    <th className="px-4 py-2.5 font-semibold">子系统</th>
                    <th className="px-3 py-2.5 font-semibold">Leader 电机</th>
                    <th className="px-3 py-2.5 font-semibold">电机型号</th>
                    <th className="px-3 py-2.5 font-semibold">电机数量</th>
                    <th className="px-3 py-2.5 font-semibold">估算驱动效率</th>
                    <th className="px-3 py-2.5 font-semibold">有效覆盖率</th>
                    <th className="px-3 py-2.5 font-semibold">当前减速比</th>
                    <th className="px-3 py-2.5 font-semibold">推荐减速比</th>
                    <th className="px-3 py-2.5 font-semibold">当前铜耗 Wh</th>
                    <th className="px-3 py-2.5 font-semibold">推荐后铜耗 Wh</th>
                    <th className="px-3 py-2.5 font-semibold">预计铜耗变化 Wh</th>
                    <th className="px-3 py-2.5 font-semibold">铜耗变化 / 本组实测输入</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {groups.map(({ subsystem, group }) => {
                    const expanded = expandedGroupIds.has(group.id);
                    const followers = followerMotorNames(group);
                    const recommendation = group.gearRatio;
                    const detailsId = `motor-details-${encodeURIComponent(group.id)}`;
                    return (
                      <Fragment key={group.id}>
                        <tr className="hover:bg-surface-2/70">
                          <td className="max-w-[220px] px-4 py-2.5 align-top font-mono text-ink">
                            {subsystem.name}
                          </td>
                          <td className="px-3 py-2.5 align-top text-ink">
                            <button
                              type="button"
                              className="flex max-w-[260px] items-start gap-1.5 rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
                              aria-expanded={expanded}
                              aria-controls={detailsId}
                              aria-label={`${expanded ? "收起" : "展开"} ${subsystem.name}/${group.leaderName} 的电机分析详情`}
                              onClick={() => toggleGroup(group.id)}
                            >
                              {expanded ? (
                                <ChevronDown className="mt-0.5 size-3.5 shrink-0 text-brand" aria-hidden />
                              ) : (
                                <ChevronRight className="mt-0.5 size-3.5 shrink-0 text-brand" aria-hidden />
                              )}
                              <span className="min-w-0">
                                <span className="block break-all font-mono">{group.leaderName}</span>
                                {followers.length > 0 ? (
                                  <span
                                    className="block whitespace-normal break-all text-[10px] text-ink-faint"
                                    title={followers.join("、")}
                                  >
                                    {followers.join("、")}
                                  </span>
                                ) : null}
                              </span>
                            </button>
                          </td>
                          <td className="px-3 py-2.5 align-top font-mono text-ink-dim">{group.motorType}</td>
                          <td className="px-3 py-2.5 align-top font-mono text-ink-dim">
                            {group.motorCount}
                          </td>
                          <td className="px-3 py-2.5 align-top font-mono text-ink">
                            {group.efficiency.available &&
                            group.efficiency.metrics.estimatedDriveEfficiency !== null
                              ? `${formatNumber(group.efficiency.metrics.estimatedDriveEfficiency * 100, 1)}%`
                              : "不可用"}
                          </td>
                          <td className="px-3 py-2.5 align-top font-mono text-ink-dim">
                            {formatNumber(group.coverage.coverageFraction * 100, 1)}%
                          </td>
                          <td className="px-3 py-2.5 align-top font-mono text-ink-dim">
                            {formatNumber(group.analysisReduction, 2)}
                          </td>
                          <td className="px-3 py-2.5 align-top font-mono text-ink">
                            {recommendation.available
                              ? formatNumber(recommendation.recommendedRatio, 2)
                              : "不可用"}
                          </td>
                          <td className="px-3 py-2.5 align-top font-mono text-ink-dim">
                            {recommendation.available
                              ? formatNumber(recommendation.currentCopperLossWh, 4)
                              : "—"}
                          </td>
                          <td className="px-3 py-2.5 align-top font-mono text-ink-dim">
                            {recommendation.available
                              ? formatNumber(recommendation.recommendedCopperLossWh, 4)
                              : "—"}
                          </td>
                          <td className="px-3 py-2.5 align-top font-mono text-ink">
                            {recommendation.available
                              ? copperChangeLabel(recommendation.estimatedCopperReductionWh, "Wh")
                              : "—"}
                          </td>
                          <td className="px-3 py-2.5 align-top font-mono text-ink">
                            {recommendation.available
                              ? copperChangeLabel(
                                  recommendation.reductionShareOfMeasuredInput * 100,
                                  "%",
                                )
                              : "—"}
                          </td>
                        </tr>
                        {expanded ? (
                          <tr id={detailsId}>
                            <td colSpan={12} className="bg-surface-2/30 px-4 py-3">
                              <MotorAnalysisDetails group={group} />
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : (
        <section className="card px-4 py-8 text-center">
          <p className="text-sm font-semibold text-ink">当前日志没有可用的 EnergyLogger V2 电机数据。</p>
          <p className="mt-1 text-xs text-ink-dim">V1 日志仍可使用整机、子系统、模拟和数据质量分析。</p>
        </section>
      )}

      <CalculationPrinciples contractVersion={contractVersion} />
    </div>
  );
}

function MotorAnalysisDetails({ group }: { group: EnergyLoggerV2MotorGroupMetrics }) {
  const coverage = group.coverage;
  const reasons = coverageReasonRows(coverage);
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-ink">有效估算区间</h3>
        <p className="font-mono text-xs text-ink-dim">
          有效时长 {formatDuration(coverage.validDurationSeconds)} / 选区时长{
          " "}{formatDuration(coverage.totalDurationSeconds)} ={
          " "}{formatNumber(coverage.coverageFraction * 100, 1)}%
        </p>
      </div>
      <div>
        <p className="mb-1.5 text-[10px] font-semibold tracking-wider text-ink-faint">无效原因分布</p>
        {reasons.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {reasons.map((reason) => (
              <span
                key={reason.code}
                className="rounded border border-line bg-surface px-2 py-1 text-[10px] text-ink-dim"
              >
                {reason.label}：{formatDuration(reason.durationSeconds)}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-[10px] text-ink-faint">没有无效区间。</p>
        )}
      </div>
      <GearRatioEvidence group={group} />
    </div>
  );
}

export function GearRatioEvidence({ group }: { group: EnergyLoggerV2MotorGroupMetrics }) {
  const recommendation = group.gearRatio;
  if (!recommendation.available) {
    return (
      <div className="grid gap-1 rounded border border-line bg-surface px-3 py-2 text-xs text-ink-dim">
        <p>减速比推荐不可用：{unavailableReason(recommendation.reason)}。</p>
        {recommendation.limitations.length > 0 ? (
          <p className="text-[11px] leading-relaxed text-ink-faint">
            限制：{recommendation.limitations.join("；")}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="grid gap-2 rounded border border-line bg-surface px-3 py-3">
      <h3 className="text-xs font-semibold text-ink">本组推荐依据</h3>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4 lg:grid-cols-6">
        <div>
          <dt className="text-ink-faint">有效区间</dt>
          <dd className="font-mono text-ink">{recommendation.activeSampleCount}</dd>
        </div>
        <div>
          <dt className="text-ink-faint">有效工况</dt>
          <dd className="font-mono text-ink">{formatDuration(recommendation.activeDurationSeconds)}</dd>
        </div>
        <div>
          <dt className="text-ink-faint">覆盖状态</dt>
          <dd className="font-mono text-ink">{recommendation.observedStateCount}</dd>
        </div>
        <div>
          <dt className="text-ink-faint">本组实测输入</dt>
          <dd className="font-mono text-ink">
            {formatNumber(recommendation.measuredGroupInputEnergyWh, 4)} Wh
          </dd>
        </div>
        <div>
          <dt className="text-ink-faint">预计铜耗变化</dt>
          <dd className="font-mono text-ink">
            {copperChangeLabel(recommendation.estimatedCopperReductionWh, "Wh")}
          </dd>
        </div>
        <div>
          <dt className="text-ink-faint">铜耗变化 / 本组实测输入</dt>
          <dd className="font-mono text-ink">
            {copperChangeLabel(recommendation.reductionShareOfMeasuredInput * 100, "%")}
          </dd>
        </div>
      </dl>
      {recommendation.reasons.length > 0 ? (
        <ul className="list-disc space-y-1 pl-4 text-[11px] leading-relaxed text-ink-dim">
          {recommendation.reasons.map((reason) => <li key={reason}>{reason}</li>)}
        </ul>
      ) : null}
      {recommendation.limitations.length > 0 ? (
        <p className="text-[11px] leading-relaxed text-ink-faint">
          限制：{recommendation.limitations.join("；")}
        </p>
      ) : null}
    </div>
  );
}

function CalculationPrinciples({
  contractVersion,
}: {
  contractVersion?: EnergyLoggerV2Contract["contractVersion"];
}) {
  const magnitudeOnly = contractVersion === "2.1" || contractVersion === "2.2";
  return (
    <section className="card overflow-hidden" aria-labelledby="motor-calculation-principles">
      <div className="border-b border-line px-4 py-3">
        <h2 id="motor-calculation-principles" className="text-sm font-semibold text-ink">
          计算原理
        </h2>
      </div>
      <ol className="grid gap-2 px-4 py-4 text-xs leading-relaxed text-ink-dim md:grid-cols-2">
        <li>1. 覆盖率按相邻样本的实际 dt 累计，以有效时长除以选区时长，不按样本数量计算。</li>
        <li>
          2. 效率只使用有限信号、正电池电压、正 Supply Current 和正 Stator Current；功率守恒检查为
          <span className="font-mono"> Pmech + Pcu ≤ 1.1 × Pbat + 1 W</span>，即容差为 1.1× + 1 W。
        </li>
        <li>3. 减速比候选覆盖当前减速比的 0.5×–2×，按对数间隔评估 61 个点。</li>
        <li>
          4. 每个候选保持日志中的机械侧速度与负载扭矩不变。先以
          <span className="font-mono"> Iload = max(Istator - I0, 0)</span> 扣除不随传动比缩放的空载电流，再按
          <span className="font-mono"> f = N′ / N、ω′ = fω、I′ = I0 + Iload / f、Vreq = I′R + |ω′| / Kv</span>
          换算电机侧转速、单台电机 Stator Current 与所需电压。
        </li>
        <li>
          5. 超过堵转电流、105% 空载转速或 105% 电池电压的候选会被淘汰；评分为
          <span className="font-mono"> Score = Σ(nI′²RΔt) + 25 W × Σ((Vreq/Vbat)^4Δt)</span>，
          其中 25 W 是保留电压余量的经验权重，不是电机物理常数；推荐减速比取最低可行评分点。
        </li>
        <li>
          6. Follower 只提供自己的 Supply Current；效率与覆盖率使用 Leader 的原生 Stator Current、原生转速和整组 Supply Current 合计计算，不能把 Follower 伪装成独立效率曲线。
        </li>
        <li>
          7. 减速比推荐只使用带子系统状态且 Stator Current 大于该型号空载电流的工作区间；当前与推荐后铜耗均在完全相同的有效区间内按
          <span className="font-mono"> Σ(nI²RΔt)</span> 计算。
        </li>
        <li>
          8. “预计铜耗变化”只是该电机组绕组铜耗模型的“当前值−推荐后值”；负值按“增加”显示。比例的分母是同一批有效区间内
          <span className="font-mono"> Σ(Vbattery × Isupply,group × Δt)</span>。它不是整机节能比例，也不包含控制器、传动、摩擦和其他负载。
        </li>
        <li>9. 结果只代表日志覆盖的历史工况；不预测机构摩擦、控制器限流变化、闭环稳定性或瞬态响应。</li>
      </ol>
      {magnitudeOnly ? (
        <p className="border-t border-line px-4 py-3 text-xs text-warn">
          当前 V{contractVersion} 日志的 Stator Current 仅有幅值，不能区分驱动与再生制动工况，
          也不能据此判断电池净回充。
        </p>
      ) : contractVersion === "2.3" ? (
        <p className="border-t border-line px-4 py-3 text-xs text-ink-dim">
          V2.3 保留 Stator Current 符号；负值表示再生制动工况，不代表电池净回充。该区间保留在有效性统计中，
          但不参与效率与减速比估算。
        </p>
      ) : null}
    </section>
  );
}

function unavailableReason(reason: string): string {
  const labels: Record<string, string> = {
    UNKNOWN_MOTOR_TYPE: "未知电机型号",
    EMPTY_SERIES: "无样本",
    LENGTH_MISMATCH: "信号不完整",
    NO_VALID_INTERVALS: "无有效工况",
    INVALID_CURRENT_RATIO: "分析减速比无效",
    MISSING_STATE_DISTRIBUTION: "缺少状态",
    INSUFFICIENT_ACTIVE_DATA: "有效样本不足",
    NO_FEASIBLE_CANDIDATE: "无可行候选",
  };
  return labels[reason] ?? "不可用";
}

function copperChangeLabel(value: number, unit: "Wh" | "%"): string {
  const direction = value >= 0 ? "减少" : "增加";
  const digits = unit === "Wh" ? 4 : 2;
  return `${direction} ${formatNumber(Math.abs(value), digits)} ${unit}`;
}
