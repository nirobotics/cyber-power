import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  MOTOR_COVERAGE_STATUS,
  type EnergyLoggerV2Contract,
  type EnergyLoggerV2MotorGroupMetrics,
  type EnergyLoggerV2RangeAnalysis,
  type MotorCoverageStatusCode,
  type MotorCoverageTimeline,
} from "../log-analysis/core";
import {
  coverageReasonRows,
  followerMotorNames,
  GearRatioEvidence,
  V2AnalysisSections,
} from "./v2-analysis-sections";

const sectionsSource = readFileSync(new URL("./v2-analysis-sections.tsx", import.meta.url), "utf8");

function coverage(
  coverageFraction = 0.5,
  status: MotorCoverageStatusCode = MOTOR_COVERAGE_STATUS.ZERO_STATOR_CURRENT,
): MotorCoverageTimeline {
  const validDurationSeconds = coverageFraction * 2;
  const invalidDurationSeconds = 2 - validDurationSeconds;
  const durationSecondsByStatus = new Float64Array(7);
  durationSecondsByStatus[MOTOR_COVERAGE_STATUS.VALID] = validDurationSeconds;
  durationSecondsByStatus[status] = invalidDurationSeconds;
  return {
    boundariesUs: Float64Array.from([1_000_000, 1_000_000 + validDurationSeconds * 1_000_000, 3_000_000]),
    statusCodes: Uint8Array.from([
      MOTOR_COVERAGE_STATUS.VALID,
      status,
    ]),
    durationSecondsByStatus,
    totalDurationSeconds: 2,
    validDurationSeconds,
    coverageFraction,
  };
}

function analysisFixture(
  groupCoverage = coverage(),
  motorNames: string[] = ["left", "right"],
): EnergyLoggerV2RangeAnalysis {
  return {
    range: { startUs: 1_000_000, endUs: 3_000_000 },
    subsystems: [
      {
        id: "s0",
        name: "drive",
        states: [],
        motorGroups: [
          {
            analysisAvailable: true,
            id: "s0/left",
            leaderName: "left",
            motorNames,
            motorType: "KRAKEN_X60_FOC",
            motorCount: motorNames.length,
            analysisReduction: 6.75,
            coverage: groupCoverage,
            efficiency: {
              available: true,
              model: {
                type: "KRAKEN_X60_FOC",
                nominalVoltageV: 12,
                stallTorqueNm: 9.37,
                stallCurrentA: 483,
                freeCurrentA: 2,
                freeSpeedRpm: 5800,
                freeSpeedRadPerSec: 607.37,
                resistanceOhm: 12 / 483,
                torqueConstantNmPerA: 9.37 / 483,
                velocityConstantRadPerSecPerVolt: 50.8,
              },
              motorCount: 2,
              metrics: {
                durationSeconds: 1,
                batteryConsumedEnergyWh: 0.2,
                estimatedMechanicalEnergyWh: 0.15,
                estimatedCopperLossWh: 0.02,
                estimatedDriveEfficiency: 0.75,
                averageRotorSpeedRadPerSec: 40,
                peakRotorSpeedRadPerSec: 55,
                averageLeaderStatorCurrentA: 30,
                peakLeaderStatorCurrentA: 50,
              },
              quality: {
                intervalCount: 100,
                validIntervalCount: 50,
                droppedIntervalCount: 50,
                physicallyImpossibleIntervalCount: 0,
                coverageFraction: groupCoverage.coverageFraction,
              },
            },
            gearRatio: {
              available: true,
              model: {
                type: "KRAKEN_X60_FOC",
                nominalVoltageV: 12,
                stallTorqueNm: 9.37,
                stallCurrentA: 483,
                freeCurrentA: 2,
                freeSpeedRpm: 5800,
                freeSpeedRadPerSec: 607.37,
                resistanceOhm: 12 / 483,
                torqueConstantNmPerA: 9.37 / 483,
                velocityConstantRadPerSecPerVolt: 50.8,
              },
              currentRatio: 6.75,
              recommendedRatio: 7.5,
              activeSampleCount: 100,
              activeDurationSeconds: 2,
              observedStateCount: 1,
              currentCopperLossWh: 0.05,
              recommendedCopperLossWh: 0.03,
              estimatedCopperReductionWh: 0.02,
              measuredGroupInputEnergyWh: 0.2,
              reductionShareOfMeasuredInput: 0.1,
              reasons: ["保持历史机械侧速度与负载扭矩不变。"],
              limitations: ["结果只代表日志覆盖的历史工况。"],
            },
          },
        ],
      },
    ],
  };
}

function renderPage(
  analysis: EnergyLoggerV2RangeAnalysis | undefined,
  contractVersion?: EnergyLoggerV2Contract["contractVersion"],
) {
  return renderToStaticMarkup(
    <V2AnalysisSections
      analysis={analysis}
      contractVersion={contractVersion}
    />,
  );
}

describe("V2AnalysisSections", () => {
  it("shows a concise V1 unavailable state while keeping calculation principles", () => {
    const html = renderPage(undefined);
    expect(html).toContain("当前日志没有可用的 EnergyLogger V2 电机数据");
    expect(html).toContain("计算原理");
  });

  it("separates the leader from followers without repeating the leader", () => {
    const group = analysisFixture().subsystems[0].motorGroups[0];
    expect(followerMotorNames(group)).toEqual(["right"]);

    const html = renderPage(analysisFixture(), "2.3");
    expect(html).toContain('aria-label="电机分析"');
    expect(html).not.toContain("电机效率与减速比推荐");
    expect(html).toContain("Leader 电机");
    expect(html).toContain('title="right"');
    expect(html).toContain(">right</span>");
    expect(html).not.toContain("Follower：");
    expect(html).not.toContain('title="left、right"');
  });

  it("does not render follower secondary text for a standalone leader", () => {
    const analysis = analysisFixture(coverage(), ["left"]);
    expect(followerMotorNames(analysis.subsystems[0].motorGroups[0])).toEqual([]);

    const html = renderPage(analysis, "2.3");
    expect(html).not.toContain('title="left"');
    expect(html.match(/>left<\/span>/g)).toHaveLength(1);
  });

  it("keeps zero-percent coverage explainable without a coverage chart", () => {
    const zeroCoverage = coverage(0, MOTOR_COVERAGE_STATUS.NONFINITE_SIGNAL);
    const html = renderPage(analysisFixture(zeroCoverage), "2.3");
    expect(html).toContain("0.0%");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("展开 drive/left 的电机分析详情");
    expect(html).not.toContain("电机分析有效覆盖时间轴");
    expect(sectionsSource).not.toContain("MotorCoverageChart");
    expect(sectionsSource).not.toContain("cursorUs");
    expect(sectionsSource).not.toContain("onCursorPreview");
    expect(coverageReasonRows(zeroCoverage)).toEqual([
      expect.objectContaining({
        code: MOTOR_COVERAGE_STATUS.NONFINITE_SIGNAL,
        durationSeconds: 2,
      }),
    ]);
  });

  it("documents the candidate model as a single-column MathML explanation with accessible formulas", () => {
    const html = renderPage(analysisFixture(), "2.2");

    expect(html).toContain('<ol class="space-y-3 px-4 py-4');
    expect(sectionsSource).not.toContain("md:grid-cols-2");
    expect(html.match(/<math display="block" aria-label=/g)).toHaveLength(12);
    expect(html).toContain("<mfrac>");
    expect(html).toContain("<msub>");
    expect(html).toContain("<msup>");
    for (const label of [
      "覆盖率等于有效时长除以选区时长",
      "机械功率加铜耗不超过一点一倍电池输入功率再加一瓦",
      "候选减速比从当前减速比的一半到两倍",
      "负载电流等于 Stator Current 减去空载电流，且不小于零",
      "所需电压等于电阻压降加反电动势",
      "评分等于铜耗积分加二十五瓦乘以电压占用四次方积分",
      "铜耗能量等于电机数量乘电流平方乘电阻和时间的总和",
      "电机组实测输入能量等于电池电压乘电机组 Supply Current 和时间的总和",
      "铜耗变化比例等于当前铜耗减推荐后铜耗再除以电机组实测输入能量",
    ]) {
      expect(html).toContain(`aria-label="${label}"`);
    }

    expect(html).toContain("0.5 倍至 2 倍");
    expect(html).toContain("61 个点");
    expect(html).toContain("机构输出转速、负载扭矩和动作时长不变");
    expect(html).toContain("25 W 是经验权重，不代表额外或预测能耗");
    expect(html).toContain("推荐减速比取最低可行评分点");
    expect(html).toContain("不保证更换减速比后整机输入能量下降");
    expect(html).toContain("Follower 只提供自己的 Supply Current");
    expect(html).toContain("不能把 Follower 伪装成独立效率曲线");
    expect(html).toContain("Stator Current 大于该型号空载电流");
    expect(html).toContain("不是整机节能比例");
    expect(html).toContain("该比例不包含控制器、传动、摩擦和其他负载");
    expect(html).toContain("V2.2 日志的 Stator Current 仅有幅值");
    expect(html).toContain("不能据此判断电池净回充");
  });

  it("distinguishes regenerative braking from net battery recharge", () => {
    const rows = coverageReasonRows(
      coverage(0.5, MOTOR_COVERAGE_STATUS.REGENERATIVE_STATOR_CURRENT),
    );
    const html = renderPage(analysisFixture(), "2.3");

    expect(rows[0]?.label).toBe(
      "Stator Current 为负：再生制动工况（不代表电池净回充）",
    );
    expect(html).not.toContain("V2.3 保留 Stator Current 符号");
    expect(html).not.toContain("负值表示再生制动工况，不代表电池净回充");
    expect(html).not.toContain("负值回生");
  });

  it("renders the requested left-aligned motor metrics without ratio suffixes", () => {
    const html = renderPage(analysisFixture(), "2.3");
    const headers = [
      "子系统",
      "Leader 电机",
      "电机型号",
      "电机数量",
      "估算驱动效率",
      "有效覆盖率",
      "当前减速比",
      "推荐减速比",
      "当前铜耗 Wh",
      "推荐后铜耗 Wh",
      "预计铜耗变化 Wh",
      "铜耗变化 / 本组实测输入",
    ];
    const positions = headers.map((header) => html.indexOf(`>${header}</th>`));

    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
    expect(html).toContain(">6.75</td>");
    expect(html).toContain(">7.50</td>");
    expect(html).toContain(">0.0500</td>");
    expect(html).toContain(">0.0300</td>");
    expect(html).toContain("减少 0.0200 Wh");
    expect(html).toContain("减少 10.00 %");
    expect(html).not.toContain(":1");
    expect(sectionsSource).not.toContain("text-right");
    expect(sectionsSource).not.toContain("confidence");
    expect(sectionsSource).not.toContain("estimatedLossReductionPercent");
  });

  it("shows the evidence behind each available gear-ratio recommendation", () => {
    const group = analysisFixture().subsystems[0].motorGroups[0];
    if (!group.analysisAvailable) throw new Error("expected analyzable fixture");
    const html = renderToStaticMarkup(<GearRatioEvidence group={group} />);

    expect(html).toContain("本组推荐依据");
    expect(html).toContain("有效区间");
    expect(html).toContain(">100<");
    expect(html).toContain("有效工况");
    expect(html).toContain("覆盖状态");
    expect(html).toContain("本组实测输入");
    expect(html).toContain("0.2000 Wh");
    expect(html).toContain("预计铜耗变化");
    expect(html).toContain("减少 0.0200 Wh");
    expect(html).toContain("减少 10.00 %");
    expect(html).toContain("保持历史机械侧速度与负载扭矩不变");
    expect(html).toContain("限制：结果只代表日志覆盖的历史工况");
  });

  it("labels a negative reduction as an estimated copper-loss increase", () => {
    const base = analysisFixture().subsystems[0].motorGroups[0];
    if (!base.analysisAvailable) throw new Error("expected analyzable fixture");
    if (!base.gearRatio.available) throw new Error("expected available fixture");
    const group: EnergyLoggerV2MotorGroupMetrics = {
      ...base,
      gearRatio: {
        ...base.gearRatio,
        available: true,
        estimatedCopperReductionWh: -0.01,
        reductionShareOfMeasuredInput: -0.05,
      },
    };
    const html = renderToStaticMarkup(<GearRatioEvidence group={group} />);

    expect(html).toContain("增加 0.0100 Wh");
    expect(html).toContain("增加 5.00 %");
    expect(html).not.toContain("减少 -");
  });

  it("keeps the unavailable recommendation reason and limitations in the compact evidence", () => {
    const base = analysisFixture().subsystems[0].motorGroups[0];
    if (!base.analysisAvailable) throw new Error("expected analyzable fixture");
    const group: EnergyLoggerV2MotorGroupMetrics = {
      ...base,
      gearRatio: {
        available: false,
        reason: "INSUFFICIENT_ACTIVE_DATA",
        limitations: ["至少需要更多有效工况。"],
      },
    };
    const html = renderToStaticMarkup(<GearRatioEvidence group={group} />);

    expect(html).toContain("减速比推荐不可用：有效样本不足");
    expect(html).toContain("限制：至少需要更多有效工况");
  });
});
