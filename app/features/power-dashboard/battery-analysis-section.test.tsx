import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  binBatteryLoadObservedCurve,
  type BatteryLoadResponseAnalysis,
} from "../log-analysis/core/battery-proxy";
import type { EnergyLogDataset, NumericSeries } from "../log-analysis/core/types";
import {
  BatteryAnalysisSection,
  componentUnavailableReason,
  createLocalWindowTimelineOption,
  createObservedVoltageCurrentDistributionOption,
  formatObservedVoltageCurrentBinTooltip,
  sampleObservedVoltageCurrentPoints,
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
  it("renders the complete whole-robot battery observation story", () => {
    const html = renderAnalysis(availableAnalysis());

    expect(html).toContain("电池与整机输入摘要");
    expect(html).toContain("平均电池电压");
    expect(html).toContain("11.20 V");
    expect(html).toContain("整机正向输入能量");
    expect(html).toContain("1.2345 Wh");
    expect(html).toContain("整机正向输入电量");
    expect(html).toContain("0.1111 Ah");
    expect(html).toContain("整机峰值正向电流");
    expect(html).toContain("210.0 A");
    expect(html).toContain("整机电流 I²t");
    expect(html).toContain("98,765.4 A²·s");

    expect(html).toContain("局部电压响应");
    expect(html).toContain("窗口等效压降代理中位数");
    expect(html).toContain("16.00 mΩ");
    expect(html).toContain("14.00–18.00 mΩ");
    expect(html).toContain("50.00–80.00 mV");
    expect(html).toContain('aria-label="局部窗口等效压降代理与 RMSE 时序图"');

    expect(html).toContain("整机电压与电流关系");
    expect(html).toContain('aria-label="整机电压与电流观测分布图"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain("显示原始点");
    expect(html).toContain("取电中位数");
    expect(html).toContain("回流中位数");
    expect(html).toContain("P25–P75");
    expect(html).toContain("观测时长");
    expect(html).toContain("Brownout 电压 6.50 V");
    expect(html).not.toContain("按持续时间加权的电压中位数");
    expect(html).not.toContain("不代表恒定电池模型");
    expect(html).not.toContain("Brownout Voltage");
    expect(html).toContain("实际低压与 Brownout");
    expect(html).toContain("相对 Brownout 电压的实际低压");
    expect(html).not.toContain("内阻估算");
    expect(html).not.toContain("已注册电机");
    expect(html).not.toContain("负载阶跃");
    expect(html).not.toContain("Robot Mode 条件统计");
    expect(html).not.toContain("限制说明");
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
    const html = renderAnalysis({
      ...base,
      summary: negativeSummary,
    });

    expect(html.match(/整机峰值正向电流/g)).toHaveLength(1);
    expect(html).toContain("0.0 A");
    expect(html).not.toContain("整机峰值电流");
  });

  it("degrades each optional analysis independently", () => {
    const base = availableAnalysis();
    const analysis: Extract<BatteryLoadResponseAnalysis, { status: "available" }> = {
      ...base,
      localWindows: {
        status: "unavailable",
        reason: "NO_INVERSE_VOLTAGE_WINDOWS",
        evaluatedWindowCount: 3,
        weakExcitationWindowCount: 1,
        rejectedDirectionWindowCount: 2,
      },
      lowVoltage: { status: "unavailable", reason: "BROWNOUT_VOLTAGE_UNAVAILABLE" },
      brownoutEvents: { status: "unavailable", reason: "BROWNOUT_SIGNAL_UNAVAILABLE" },
    };
    const html = renderAnalysis(analysis);

    expect(html).toContain("局部窗口没有稳定的电流与电压反向变化关系");
    expect(html).toContain("日志没有可用的 Brownout 电压序列");
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
    expect(html).toContain("需要包含整机电机数据的 EnergyLogger V2 日志");
    expect(html).not.toContain("日志契约不兼容");
    expect(topLevelUnavailableReason("NO_COMPLETE_INTERVALS")).toContain("整机电流");
    expect(componentUnavailableReason("WEAK_CURRENT_EXCITATION")).toContain("整机电流变化范围不足");
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

  it("builds the voltage-current distribution with fixed voltage bounds and reference lines", () => {
    const curve = availableAnalysis().observedCurve;
    const distribution = binBatteryLoadObservedCurve(curve, { currentBinWidthA: 50 });
    const option = createObservedVoltageCurrentDistributionOption(
      curve,
      distribution,
      "dark",
      6.5,
      false,
    ) as {
      dataZoom?: unknown;
      xAxis: Array<{ min?: number; max?: number }>;
      yAxis: Array<{ min?: number; max?: number }>;
      series: Array<{
        id?: string;
        name?: string;
        type?: string;
        xAxisIndex?: number;
        yAxisIndex?: number;
        stack?: string;
        symbol?: string;
        connectNulls?: boolean;
        data?: unknown[];
        endLabel?: unknown;
        lineStyle?: { opacity?: number; width?: number };
      }>;
    };
    const seriesById = Object.fromEntries(option.series.map((series) => [series.id, series]));

    expect(option.dataZoom).toBeUndefined();
    expect(option.xAxis[0]).toMatchObject({ min: 0, max: 200 });
    expect(option.xAxis[1]).toMatchObject({ min: 0, max: 200 });
    expect(option.yAxis[0]).toMatchObject({ min: 3, max: 13.5 });
    expect(seriesById["observed-zero-current"]?.data).toEqual([[0, 3], [0, 13.5]]);
    expect(seriesById["observed-brownout-voltage"]).toMatchObject({
      name: "Brownout 电压",
      data: [[0, 6.5], [200, 6.5]],
    });
    expect(seriesById["observed-brownout-voltage"]?.endLabel).toBeUndefined();
    expect(seriesById["observed-positive-iqr"]).toMatchObject({
      type: "line",
      stack: "observed-positive-iqr",
      connectNulls: false,
    });
    expect(seriesById["observed-positive-median"]).toMatchObject({
      type: "line",
      symbol: "circle",
      connectNulls: false,
    });
    expect(seriesById["observed-negative-median"]).toMatchObject({
      type: "line",
      symbol: "emptyCircle",
      connectNulls: false,
    });
    expect(seriesById["observed-duration"]).toMatchObject({
      type: "bar",
      xAxisIndex: 1,
      yAxisIndex: 1,
    });
    expect(seriesById["observed-positive-raw"]).toBeUndefined();
    expect(seriesById["observed-negative-raw"]).toBeUndefined();

    const optionWithoutThreshold = createObservedVoltageCurrentDistributionOption(
      curve,
      distribution,
      "light",
      null,
      false,
    ) as { series: Array<{ id?: string }> };
    expect(optionWithoutThreshold.series.some((series) =>
      series.id === "observed-brownout-voltage"
    )).toBe(false);
  });

  it("adds bounded raw observations without connecting them", () => {
    const curve = {
      ...availableAnalysis().observedCurve,
      timestampsUs: Float64Array.from([0, 1, 2, 3, 4]),
      registeredCurrentA: Float64Array.from([-10, 0, 50, 100, 150]),
      voltageV: Float64Array.from([12.8, 12.6, 11.8, 10, 8]),
      intervalDurationSeconds: new Float64Array(5).fill(1),
      registeredCurrentRangeA: { minimum: -10, maximum: 150 },
      voltageRangeV: { minimum: 8, maximum: 12.8 },
    };

    expect(sampleObservedVoltageCurrentPoints(curve, 3)).toEqual({
      negative: [[-10, 12.8]],
      positive: [[50, 11.8], [150, 8]],
    });
    expect(sampleObservedVoltageCurrentPoints(curve, 0)).toEqual({ negative: [], positive: [] });

    const distribution = binBatteryLoadObservedCurve(curve, { currentBinWidthA: 20 });
    const option = createObservedVoltageCurrentDistributionOption(
      curve,
      distribution,
      "dark",
      null,
      true,
    ) as {
      series: Array<{
        id?: string;
        data?: unknown[];
        lineStyle?: { opacity?: number; width?: number };
      }>;
    };
    const seriesById = Object.fromEntries(option.series.map((series) => [series.id, series]));

    expect(seriesById["observed-positive-raw"]?.data).toHaveLength(4);
    expect(seriesById["observed-negative-raw"]?.data).toHaveLength(1);
    expect(seriesById["observed-positive-raw"]?.lineStyle).toMatchObject({ opacity: 0, width: 0 });
    expect(seriesById["observed-negative-raw"]?.lineStyle).toMatchObject({ opacity: 0, width: 0 });
  });

  it("formats a bin tooltip with the interval, weighted voltage, duration, and count", () => {
    const tooltip = formatObservedVoltageCurrentBinTooltip({
      currentMinimumA: -20,
      currentMaximumA: 0,
      currentCenterA: -10,
      voltageP25V: 10.1,
      voltageMedianV: 10.5,
      voltageP75V: 10.9,
      observedDurationSeconds: 2.5,
      observationSegmentCount: 42,
    });

    expect(tooltip).toContain("整机电流 -20.0 至 &lt; 0.0 A");
    expect(tooltip).toContain("加权中位电压：10.50 V");
    expect(tooltip).toContain("P25–P75：10.10–10.90 V");
    expect(tooltip).toContain("累计观测时长：2.50 s");
    expect(tooltip).toContain("观测段数：42");
  });
});
