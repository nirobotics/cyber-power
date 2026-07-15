import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { BatteryLoadResponseAnalysis } from "../log-analysis/core/battery-proxy";
import type { EnergyLogDataset, NumericSeries } from "../log-analysis/core/types";
import {
  BatteryAnalysisSection,
  componentUnavailableReason,
  createLocalWindowTimelineOption,
  observedCurveSvgPoints,
  topLevelUnavailableReason,
} from "./battery-analysis-section";

function numeric(unit: string): NumericSeries {
  return {
    timestampsUs: Float64Array.from([0, 5_000_000, 10_000_000]),
    values: Float64Array.from([0, 1, 2]),
    entryName: "test",
    unit,
  };
}

function datasetFixture(): EnergyLogDataset {
  return {
    header: { version: 1, majorVersion: 1, minorVersion: 0, extraHeader: "", byteLength: 12 },
    file: { recordCount: 0, dataRecordCount: 0, controlRecordCount: 0, lastGoodOffset: 0 },
    root: "/RealOutputs/energyLogger",
    bounds: {
      logStartUs: 0,
      logEndUs: 10_000_000,
      energyStartUs: 0,
      energyEndUs: 10_000_000,
    },
    series: {
      totalCurrentA: numeric("A"),
      totalPowerW: numeric("W"),
      totalEnergyWh: numeric("Wh"),
      batteryVoltageV: numeric("V"),
    },
    subsystems: [],
    segments: {
      brownouts: [{ startUs: 7_000_000, endUs: 7_200_000, durationSeconds: 0.2 }],
      enabled: [],
      modes: [
        {
          startUs: 0,
          endUs: 5_000_000,
          durationSeconds: 5,
          mode: "autonomous",
          isPractice: false,
        },
        {
          startUs: 5_000_000,
          endUs: 10_000_000,
          durationSeconds: 5,
          mode: "teleop",
          isPractice: false,
        },
      ],
    },
    quality: {
      issues: [],
      reconciliation: {
        totalEnergyWh: 0,
        topLevelEnergyWh: 0,
        differenceWh: 0,
        differencePercent: 0,
        withinTolerance: true,
      },
      droppedNonfiniteSamples: 0,
      resetCount: 0,
    },
    sourceContract: "v2",
  };
}

const summary = {
  coveredDurationSeconds: 10,
  averageVoltageV: 11.2,
  averageRegisteredCurrentA: 42,
  positiveRegisteredInputEnergyWh: 1.2345,
  positiveRegisteredChargeAh: 0.1111,
  registeredCurrentSquaredTimeA2Seconds: 98_765.4,
  minimumVoltageV: 6.4,
  maximumVoltageV: 12.6,
  minimumRegisteredCurrentA: -8,
  maximumRegisteredCurrentA: 210,
  maximumPositiveRegisteredCurrentA: 210,
} as const;

function availableAnalysis(): Extract<BatteryLoadResponseAnalysis, { status: "available" }> {
  return {
    status: "available",
    range: { startUs: 0, endUs: 10_000_000, durationSeconds: 10 },
    summary,
    quality: {
      requestedDurationSeconds: 10,
      timelineIntervalCount: 102,
      completeIntervalCount: 100,
      droppedIntervalCount: 2,
      coveredDurationSeconds: 9.8,
      coverageFraction: 0.98,
      positiveCurrentDurationSeconds: 8,
      negativeCurrentDurationSeconds: 1,
      zeroCurrentDurationSeconds: 0.8,
      observedCurrentSpanA: 190,
    },
    stepResponse: {
      status: "available",
      candidateCount: 4,
      independentCount: 3,
      inverseVoltageCount: 3,
      rejectedDirectionCount: 1,
      risingStepCount: 2,
      fallingStepCount: 1,
      timestampsUs: Float64Array.from([2_000_000, 6_000_000]),
      deltaRegisteredCurrentA: Float64Array.from([50, -35]),
      deltaVoltageV: Float64Array.from([-0.8, 0.45]),
      voltageDropProxyOhm: Float64Array.from([0.016, 0.012857]),
      voltageDropProxyQuantilesOhm: {
        p05: 0.013,
        p25: 0.014,
        median: 0.015,
        p75: 0.016,
        p95: 0.017,
      },
      absoluteResidualQuantilesV: {
        p05: 0.01,
        p25: 0.02,
        median: 0.03,
        p75: 0.04,
        p95: 0.05,
      },
    },
    localWindows: {
      status: "available",
      evaluatedWindowCount: 4,
      weakExcitationWindowCount: 1,
      rejectedDirectionWindowCount: 1,
      windowStartUs: Float64Array.from([0, 5_000_000]),
      windowEndUs: Float64Array.from([5_000_000, 10_000_000]),
      coveredDurationSeconds: Float64Array.from([4.9, 4.9]),
      currentSpanA: Float64Array.from([120, 160]),
      interceptVoltageV: Float64Array.from([12.4, 12.2]),
      voltageDropProxyOhm: Float64Array.from([0.014, 0.018]),
      residualRmsV: Float64Array.from([0.05, 0.08]),
      residualMedianAbsoluteV: Float64Array.from([0.03, 0.05]),
      residualP95AbsoluteV: Float64Array.from([0.09, 0.12]),
      voltageDropProxyQuantilesOhm: {
        p05: 0.013,
        p25: 0.014,
        median: 0.016,
        p75: 0.018,
        p95: 0.019,
      },
    },
    modeStats: {
      autonomous: {
        summary: { ...summary, coveredDurationSeconds: 5, positiveRegisteredInputEnergyWh: 0.7 },
        lowVoltageDurationSeconds: 0.1,
        brownoutEventCount: 1,
        brownoutDurationSeconds: 0.02,
      },
      teleop: {
        summary: { ...summary, coveredDurationSeconds: 5, positiveRegisteredInputEnergyWh: 0.5345 },
        lowVoltageDurationSeconds: 0.2,
        brownoutEventCount: 2,
        brownoutDurationSeconds: 0.03,
      },
    },
    observedCurve: {
      timestampsUs: Float64Array.from([0, 2_000_000, 6_000_000, 9_000_000]),
      registeredCurrentA: Float64Array.from([0, 50, 180, 20]),
      voltageV: Float64Array.from([12.6, 11.8, 7.2, 12.1]),
      intervalDurationSeconds: Float64Array.from([2, 4, 3, 1]),
      registeredCurrentRangeA: { minimum: 0, maximum: 180 },
      voltageRangeV: { minimum: 7.2, maximum: 12.6 },
    },
    lowVoltage: {
      status: "available",
      coveredDurationSeconds: 9.5,
      eventCount: 3,
      durationSeconds: 0.3,
      averageThresholdV: 6.5,
      minimumMarginV: -0.25,
    },
    brownoutEvents: {
      status: "available",
      eventCount: 2,
      durationSeconds: 0.05,
    },
    limitations: ["核心限制说明。"],
  };
}

function renderAnalysis(analysis: BatteryLoadResponseAnalysis) {
  return renderToStaticMarkup(
    <BatteryAnalysisSection
      analysis={analysis}
      dataset={datasetFixture()}
      range={{ startUs: 0, endUs: 10_000_000 }}
      cursorUs={4_000_000}
      cursorPreviewActive={false}
      onCursorPreview={() => undefined}
      onCursorCommit={() => undefined}
    />,
  );
}

describe("BatteryAnalysisSection", () => {
  it("renders the complete registered-motor battery observation story", () => {
    const html = renderAnalysis(availableAnalysis());

    expect(html).toContain("电池与已注册电机输入摘要");
    expect(html).toContain("平均电池电压");
    expect(html).toContain("11.20 V");
    expect(html).toContain("已注册电机正向输入能量");
    expect(html).toContain("1.2345 Wh");
    expect(html).toContain("已注册电机正向输入电量");
    expect(html).toContain("0.1111 Ah");
    expect(html).toContain("峰值正向已注册电机电流");
    expect(html).toContain("210.0 A");
    expect(html).toContain("已注册电机电流 I²t");
    expect(html).toContain("98,765.4 A²·s");

    expect(html).toContain("局部电压响应");
    expect(html).toContain("窗口等效压降代理中位数");
    expect(html).toContain("16.00 mΩ");
    expect(html).toContain("14.00–18.00 mΩ");
    expect(html).toContain("50.00–80.00 mV");
    expect(html).toContain('aria-label="局部窗口等效压降代理与 RMSE 时序图"');

    expect(html).toContain("观测范围内的电压－已注册电机电流关系");
    expect(html).toContain('aria-label="观测范围内电池电压与已注册电机电流关系曲线"');
    expect(html).toContain("pointer-events-none");
    expect(html).toContain('preserveAspectRatio="xMidYMid meet"');
    expect(html).toContain("h-auto w-full max-w-[720px]");
    expect(html).toContain("负载阶跃");
    expect(html).toContain("50.00");
    expect(html).toContain("16.00");
    expect(html).toContain("Robot Mode 条件统计");
    expect(html).toContain("AUTO");
    expect(html).toContain("TELEOP");
    expect(html).toContain("重叠 Brownout 事件 / 时长");
    expect(html).toContain("各模式事件数不可相加为总数");
    expect(html).toContain("实际低压与 Brownout");
    expect(html).toContain("核心限制说明");
    expect(html).toContain("不是整机总电流");
    expect(html).toContain("不估算电池 SOC 或容量");
    expect(html).toContain("不是纯内阻");
    expect(html).toContain("不提供配置变更后的电压、Brownout 或节能反事实");
    expect(html).not.toContain("内阻估算");
    expect(html).not.toContain("整机总电流：");
  });

  it("labels a positive-current peak precisely for negative-only observations", () => {
    const base = availableAnalysis();
    const negativeSummary = {
      ...base.summary,
      averageRegisteredCurrentA: -18,
      minimumRegisteredCurrentA: -40,
      maximumRegisteredCurrentA: -5,
      maximumPositiveRegisteredCurrentA: 0,
    };
    const autonomous = base.modeStats.autonomous;
    if (!autonomous) throw new Error("fixture mismatch");
    const html = renderAnalysis({
      ...base,
      summary: negativeSummary,
      modeStats: {
        autonomous: {
          ...autonomous,
          summary: { ...negativeSummary, coveredDurationSeconds: 5 },
        },
      },
    });

    expect(html.match(/峰值正向已注册电机电流/g)).toHaveLength(2);
    expect(html).toContain("0.0 A");
    expect(html).not.toContain("峰值已注册电机电流");
  });

  it("limits the load-step DOM and reports displayed and total rows", () => {
    const base = availableAnalysis();
    if (base.stepResponse.status !== "available") throw new Error("fixture mismatch");
    const rowCount = 205;
    const html = renderAnalysis({
      ...base,
      stepResponse: {
        ...base.stepResponse,
        candidateCount: rowCount,
        independentCount: rowCount,
        inverseVoltageCount: rowCount,
        rejectedDirectionCount: 0,
        risingStepCount: rowCount,
        fallingStepCount: 0,
        timestampsUs: Float64Array.from(
          { length: rowCount },
          (_, index) => (index + 1) * 1_000_000,
        ),
        deltaRegisteredCurrentA: new Float64Array(rowCount).fill(40),
        deltaVoltageV: new Float64Array(rowCount).fill(-0.4),
        voltageDropProxyOhm: new Float64Array(rowCount).fill(0.01),
      },
    });

    expect(html).toContain("表格按时间顺序显示前 200 / 共 205 条有效阶跃");
    expect(html).toContain("200.000 s");
    expect(html).not.toContain("201.000 s");
  });

  it("degrades each optional analysis independently", () => {
    const base = availableAnalysis();
    const analysis: Extract<BatteryLoadResponseAnalysis, { status: "available" }> = {
      ...base,
      stepResponse: {
        status: "unavailable",
        reason: "NO_INVERSE_VOLTAGE_STEPS",
        candidateCount: 2,
        independentCount: 2,
        inverseVoltageCount: 1,
        rejectedDirectionCount: 1,
      },
      localWindows: {
        status: "unavailable",
        reason: "NO_INVERSE_VOLTAGE_WINDOWS",
        evaluatedWindowCount: 3,
        weakExcitationWindowCount: 1,
        rejectedDirectionWindowCount: 2,
      },
      modeStats: {},
      lowVoltage: { status: "unavailable", reason: "BROWNOUT_VOLTAGE_UNAVAILABLE" },
      brownoutEvents: { status: "unavailable", reason: "BROWNOUT_SIGNAL_UNAVAILABLE" },
    };
    const html = renderAnalysis(analysis);

    expect(html).toContain("没有足够的电流与电压反向变化窗口");
    expect(html).toContain("局部窗口没有稳定的电流与电压反向变化关系");
    expect(html).toContain("当前范围没有可用的 Robot Mode 条件区间");
    expect(html).toContain("日志没有可用的 Brownout Voltage 序列");
    expect(html).toContain("日志没有可用的 Brownout 状态序列");
    expect(html).not.toContain('aria-label="局部窗口等效压降代理与 RMSE 时序图"');
  });

  it("renders a localized top-level unavailable result with the same scope limits", () => {
    const html = renderAnalysis({
      status: "unavailable",
      reason: "V2_REQUIRED",
      limitations: ["日志契约不兼容。"],
    });

    expect(html).toContain("电池观测分析不可用");
    expect(html).toContain("需要包含已注册电机数据的 EnergyLogger V2 日志");
    expect(html).toContain("日志契约不兼容");
    expect(html).toContain("不是整机总电流");
    expect(topLevelUnavailableReason("NO_COMPLETE_INTERVALS")).toContain("没有完整的电压");
    expect(componentUnavailableReason("WEAK_CURRENT_EXCITATION")).toContain("电流变化范围不足");
  });
});

describe("battery observation charts", () => {
  it("uses the shared timeline without wheel zoom or drag", () => {
    const analysis = availableAnalysis();
    if (analysis.localWindows.status !== "available") throw new Error("fixture mismatch");
    const option = createLocalWindowTimelineOption(
      datasetFixture(),
      analysis.localWindows,
      "dark",
      "battery-local-test",
    ) as {
      dataZoom: Array<{
        id: string;
        zoomOnMouseWheel: boolean;
        moveOnMouseMove: boolean;
        moveOnMouseWheel: boolean;
      }>;
      series: Array<{
        name: string;
        data: Array<[number, number]>;
        markArea?: { data: unknown[] };
      }>;
    };

    expect(option.dataZoom[0]).toMatchObject({
      id: "battery-local-test",
      zoomOnMouseWheel: false,
      moveOnMouseMove: false,
      moveOnMouseWheel: false,
    });
    expect(option.series.map((series) => series.name)).toEqual([
      "窗口等效压降代理 (mΩ)",
      "窗口 RMSE (mV)",
    ]);
    expect(option.series[0].data).toEqual([
      [2.5, 14],
      [7.5, 18],
    ]);
    expect(option.series[0].markArea?.data).toHaveLength(3);
  });

  it("creates a bounded presentation path without changing the observed values", () => {
    const curve = availableAnalysis().observedCurve;
    const points = observedCurveSvgPoints(curve);

    expect(points).toBe("58.00,20.00 236.33,52.30 700.00,238.00 129.33,40.19");
    expect(observedCurveSvgPoints({
      ...curve,
      registeredCurrentA: new Float64Array(),
      voltageV: new Float64Array(),
    })).toBeNull();
  });

  it("keeps per-bucket current and voltage extrema in chronological order", () => {
    const count = 801;
    const current = Float64Array.from({ length: count }, (_, index) => index);
    const voltage = new Float64Array(count).fill(10);
    voltage[1] = 0;
    voltage[3] = 20;
    const points = observedCurveSvgPoints({
      timestampsUs: Float64Array.from({ length: count }, (_, index) => index),
      registeredCurrentA: current,
      voltageV: voltage,
      intervalDurationSeconds: new Float64Array(count).fill(1),
      registeredCurrentRangeA: { minimum: 0, maximum: 800 },
      voltageRangeV: { minimum: 0, maximum: 20 },
    });
    if (!points) throw new Error("expected sampled points");
    const sampled = points.split(" ");
    const xCoordinates = sampled.map((point) => Number(point.split(",")[0]));

    expect(sampled.length).toBeLessThanOrEqual(800);
    expect(sampled).toContain("58.80,238.00");
    expect(sampled).toContain("60.41,20.00");
    expect(xCoordinates).toEqual([...xCoordinates].sort((left, right) => left - right));
  });
});
