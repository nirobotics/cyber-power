import { describe, expect, it } from "vitest";
import { analyzeBatteryLoadResponse } from "./battery-proxy";
import type {
  BooleanSeries,
  EnergyLogDataset,
  ModeInterval,
  NumericSeries,
  TimeInterval,
} from "./types";

const SECOND = 1_000_000;

function numericSeries(
  timestampsUs: readonly number[],
  values: readonly number[],
  unit: string,
  entryName = unit,
): NumericSeries {
  return {
    timestampsUs: Float64Array.from(timestampsUs),
    values: Float64Array.from(values),
    unit,
    entryName,
  };
}

function countedTimestamps(values: readonly number[]): {
  timestampsUs: Float64Array;
  readCount: () => number;
} {
  const target = Float64Array.from(values);
  let reads = 0;
  const timestampsUs = new Proxy(target, {
    get(array, property) {
      if (typeof property === "string" && /^[0-9]+$/.test(property)) reads += 1;
      const value = Reflect.get(array, property, array) as unknown;
      return typeof value === "function" ? value.bind(array) : value;
    },
  }) as Float64Array;
  return { timestampsUs, readCount: () => reads };
}

function booleanSeries(
  timestampsUs: readonly number[],
  values: readonly number[],
): BooleanSeries {
  return {
    timestampsUs: Float64Array.from(timestampsUs),
    values: Uint8Array.from(values),
    entryName: "/SystemStats/BrownedOut",
  };
}

function interval(
  startUs: number,
  endUs: number,
): TimeInterval {
  return {
    startUs,
    endUs,
    durationSeconds: (endUs - startUs) / SECOND,
  };
}

function mode(
  modeName: ModeInterval["mode"],
  startUs: number,
  endUs: number,
): ModeInterval {
  return { ...interval(startUs, endUs), mode: modeName, isPractice: false };
}

interface DatasetInput {
  current: NumericSeries;
  voltage?: NumericSeries;
  threshold?: NumericSeries;
  brownedOut?: BooleanSeries;
  brownouts?: TimeInterval[];
  modes?: ModeInterval[];
  startUs?: number;
  endUs: number;
  sourceContract?: "v1" | "v2";
  includeV2?: boolean;
}

function dataset(input: DatasetInput): EnergyLogDataset {
  const startUs = input.startUs ?? 0;
  const sourceContract = input.sourceContract ?? "v2";
  const includeV2 = input.includeV2 ?? sourceContract === "v2";
  return {
    header: {
      version: 0x0100,
      majorVersion: 1,
      minorVersion: 0,
      extraHeader: "",
      byteLength: 0,
    },
    file: {
      recordCount: 0,
      dataRecordCount: 0,
      controlRecordCount: 0,
      lastGoodOffset: 0,
    },
    root: "/RealOutputs/energyLogger",
    bounds: {
      logStartUs: startUs,
      logEndUs: input.endUs,
      energyStartUs: startUs,
      energyEndUs: input.endUs,
    },
    series: {
      totalCurrentA: input.current,
      totalPowerW: numericSeries([startUs], [999_999], "W"),
      totalEnergyWh: numericSeries([startUs], [999_999], "Wh"),
      ...(input.voltage ? { batteryVoltageV: input.voltage } : {}),
      ...(input.threshold ? { brownoutVoltageV: input.threshold } : {}),
      ...(input.brownedOut ? { brownedOut: input.brownedOut } : {}),
    },
    subsystems: [],
    segments: {
      brownouts: input.brownouts ?? [],
      enabled: [],
      modes: input.modes ?? [],
    },
    quality: {
      issues: [],
      reconciliation: {
        totalEnergyWh: 0,
        topLevelEnergyWh: 0,
        differenceWh: 0,
        differencePercent: null,
        withinTolerance: true,
      },
      droppedNonfiniteSamples: 0,
      resetCount: 0,
    },
    sourceContract,
    ...(includeV2
      ? { v2: {} as NonNullable<EnergyLogDataset["v2"]> }
      : {}),
  };
}

describe("registered motor load and battery voltage proxies", () => {
  it("time-weights asynchronous samples and counts a spanning Brownout in each overlapped mode", () => {
    const analysis = analyzeBatteryLoadResponse(
      dataset({
        current: numericSeries(
          [0, SECOND, 3 * SECOND],
          [10, -5, 20],
          "A",
        ),
        voltage: numericSeries(
          [0, 0.5 * SECOND, 2 * SECOND],
          [12, 10, 8],
          "V",
        ),
        threshold: numericSeries([0], [9], "V"),
        brownedOut: booleanSeries(
          [0, 2.5 * SECOND, 3.2 * SECOND],
          [0, 1, 0],
        ),
        brownouts: [interval(2.5 * SECOND, 3.2 * SECOND)],
        modes: [
          mode("disabled", 0, SECOND),
          mode("autonomous", SECOND, 3 * SECOND),
          mode("teleop", 3 * SECOND, 4 * SECOND),
        ],
        endUs: 4 * SECOND,
      }),
      {},
      {
        stepWindowSamples: 1,
        stepGapSamples: 1,
        minimumIndependentSteps: 1,
        localWindowMinimumIntervals: 2,
      },
    );

    expect(analysis.status).toBe("available");
    if (analysis.status !== "available") return;

    expect(analysis.summary).toMatchObject({
      coveredDurationSeconds: 4,
      averageVoltageV: 9.25,
      averageRegisteredCurrentA: 5,
      registeredCurrentSquaredTimeA2Seconds: 550,
      minimumVoltageV: 8,
      maximumVoltageV: 12,
      minimumRegisteredCurrentA: -5,
      maximumRegisteredCurrentA: 20,
      maximumPositiveRegisteredCurrentA: 20,
    });
    expect(analysis.summary.positiveRegisteredInputEnergyWh).toBeCloseTo(0.075, 12);
    expect(analysis.summary.positiveRegisteredChargeAh).toBeCloseTo(30 / 3600, 12);
    expect(analysis.quality).toMatchObject({
      timelineIntervalCount: 5,
      completeIntervalCount: 5,
      droppedIntervalCount: 0,
      coverageFraction: 1,
      positiveCurrentDurationSeconds: 2,
      negativeCurrentDurationSeconds: 2,
      zeroCurrentDurationSeconds: 0,
      observedCurrentSpanA: 25,
    });
    expect(Array.from(analysis.observedCurve.timestampsUs)).toEqual([
      0,
      0.5 * SECOND,
      SECOND,
      2 * SECOND,
      3 * SECOND,
    ]);
    expect(Array.from(analysis.observedCurve.intervalDurationSeconds)).toEqual([
      0.5,
      0.5,
      1,
      1,
      1,
    ]);

    expect(analysis.lowVoltage).toMatchObject({
      status: "available",
      coveredDurationSeconds: 4,
      eventCount: 1,
      durationSeconds: 2,
      averageThresholdV: 9,
      minimumMarginV: -1,
    });
    expect(analysis.brownoutEvents).toMatchObject({
      status: "available",
      eventCount: 1,
      durationSeconds: 0.7,
    });
    expect(analysis.modeStats.disabled?.summary).toMatchObject({
      coveredDurationSeconds: 1,
      averageVoltageV: 11,
      averageRegisteredCurrentA: 10,
    });
    expect(analysis.modeStats.autonomous).toMatchObject({
      lowVoltageDurationSeconds: 1,
      brownoutEventCount: 1,
      brownoutDurationSeconds: 0.5,
    });
    expect(analysis.modeStats.teleop).toMatchObject({
      lowVoltageDurationSeconds: 1,
      brownoutEventCount: 1,
      brownoutDurationSeconds: 0.2,
    });
    expect(analysis.modeStats.autonomous?.summary.positiveRegisteredInputEnergyWh).toBe(0);
  });

  it("reports top-level unavailability without a validated V2 surface or Battery Voltage", () => {
    const current = numericSeries([0], [10], "A");
    const voltage = numericSeries([0], [12], "V");

    expect(
      analyzeBatteryLoadResponse(
        dataset({
          current,
          voltage,
          endUs: SECOND,
          sourceContract: "v1",
          includeV2: false,
        }),
      ),
    ).toMatchObject({ status: "unavailable", reason: "V2_REQUIRED" });
    expect(
      analyzeBatteryLoadResponse(dataset({ current, endUs: SECOND })),
    ).toMatchObject({
      status: "unavailable",
      reason: "BATTERY_VOLTAGE_UNAVAILABLE",
    });
  });

  it("reports weak excitation instead of manufacturing a load-response proxy", () => {
    const timestamps = Array.from({ length: 11 }, (_, index) => index * SECOND);
    const analysis = analyzeBatteryLoadResponse(
      dataset({
        current: numericSeries(timestamps, timestamps.map(() => 15), "A"),
        voltage: numericSeries(timestamps, timestamps.map(() => 12), "V"),
        endUs: 10 * SECOND,
      }),
      {},
      {
        stepWindowSamples: 1,
        stepGapSamples: 1,
        localWindowMinimumIntervals: 3,
      },
    );

    expect(analysis.status).toBe("available");
    if (analysis.status !== "available") return;
    expect(analysis.quality.observedCurrentSpanA).toBe(0);
    expect(analysis.stepResponse).toMatchObject({
      status: "unavailable",
      reason: "WEAK_CURRENT_EXCITATION",
      candidateCount: 0,
    });
    expect(analysis.localWindows).toMatchObject({
      status: "unavailable",
      reason: "WEAK_CURRENT_EXCITATION",
    });
    expect(analysis.lowVoltage).toEqual({
      status: "unavailable",
      reason: "BROWNOUT_VOLTAGE_UNAVAILABLE",
    });
    expect(analysis.brownoutEvents).toEqual({
      status: "unavailable",
      reason: "BROWNOUT_SIGNAL_UNAVAILABLE",
    });
  });

  it("rejects a fake load step whose before and after windows cross a log gap", () => {
    const timestamps = [
      0,
      20_000,
      40_000,
      60_000,
      80_000,
      5_000_000,
      5_020_000,
      5_040_000,
      5_060_000,
      5_080_000,
      5_100_000,
    ];
    const current = [20, 20, 20, 20, 20, 100, 100, 100, 100, 100, 100];
    const voltage = [12, 12, 12, 12, 12, 10.4, 10.4, 10.4, 10.4, 10.4, 10.4];
    const source = dataset({
      current: numericSeries(timestamps, current, "A"),
      voltage: numericSeries(timestamps, voltage, "V"),
      endUs: 5_120_000,
    });
    const options = {
      stepCurrentThresholdA: 30,
      stepWindowSamples: 2,
      stepGapSamples: 1,
      stepRefractorySeconds: 0.2,
      minimumIndependentSteps: 1,
      localWindowMinimumIntervals: 2,
    } as const;

    const protectedAnalysis = analyzeBatteryLoadResponse(source, {}, options);
    expect(protectedAnalysis.status).toBe("available");
    if (protectedAnalysis.status !== "available") return;
    expect(protectedAnalysis.stepResponse).toMatchObject({
      status: "unavailable",
      reason: "INSUFFICIENT_SAMPLES",
    });
    if (protectedAnalysis.stepResponse.status === "unavailable") {
      expect(protectedAnalysis.stepResponse.candidateCount).toBeGreaterThan(0);
      expect(protectedAnalysis.stepResponse.discontinuousCandidateCount).toBe(
        protectedAnalysis.stepResponse.candidateCount,
      );
    }

    const explicitlyPermissiveAnalysis = analyzeBatteryLoadResponse(source, {}, {
      ...options,
      stepMaximumSampleGapSeconds: 10,
    });
    expect(explicitlyPermissiveAnalysis.status).toBe("available");
    if (explicitlyPermissiveAnalysis.status !== "available") return;
    expect(explicitlyPermissiveAnalysis.stepResponse.status).toBe("available");
    if (explicitlyPermissiveAnalysis.stepResponse.status === "available") {
      expect(
        explicitlyPermissiveAnalysis.stepResponse.voltageDropProxyQuantilesOhm.median,
      ).toBeCloseTo(0.02, 12);
    }
  });

  it("keeps step and fixed-window proxies robust to an isolated voltage outlier", () => {
    const timestamps: number[] = [];
    const currents: number[] = [];
    const voltages: number[] = [];
    for (let index = 0; index <= 200; index += 1) {
      const currentA = Math.floor(index / 20) % 2 === 0 ? 20 : 100;
      timestamps.push(index * 100_000);
      currents.push(currentA);
      voltages.push(
        index === 73
          ? 20
          : 12.6 - 0.018 * currentA + ((index % 5) - 2) * 0.001,
      );
    }
    const analysis = analyzeBatteryLoadResponse(
      dataset({
        current: numericSeries(timestamps, currents, "A"),
        voltage: numericSeries(timestamps, voltages, "V"),
        endUs: 20 * SECOND,
      }),
      {},
      {
        stepCurrentThresholdA: 40,
        stepWindowSamples: 4,
        stepGapSamples: 1,
        stepRefractorySeconds: 0.4,
        minimumIndependentSteps: 5,
        localWindowDurationSeconds: 4,
        localWindowMinimumCurrentSpanA: 40,
        localWindowMinimumIntervals: 20,
        localWindowMinimumCoverageFraction: 0.95,
      },
    );

    expect(analysis.status).toBe("available");
    if (analysis.status !== "available") return;
    expect(analysis.stepResponse.status).toBe("available");
    if (analysis.stepResponse.status === "available") {
      expect(analysis.stepResponse.independentCount).toBeGreaterThanOrEqual(9);
      expect(analysis.stepResponse.voltageDropProxyQuantilesOhm.median).toBeCloseTo(
        0.018,
        3,
      );
      expect(analysis.stepResponse.absoluteResidualQuantilesV.median).toBeLessThan(0.01);
    }
    expect(analysis.localWindows.status).toBe("available");
    if (analysis.localWindows.status === "available") {
      expect(analysis.localWindows.windowStartUs.length).toBe(5);
      expect(analysis.localWindows.voltageDropProxyQuantilesOhm.median).toBeCloseTo(
        0.018,
        3,
      );
      expect(analysis.localWindows.residualMedianAbsoluteV[1]).toBeLessThan(0.01);
    }
  });

  it("holds samples across the selected start, excludes the end, and drops nonfinite intervals", () => {
    const analysis = analyzeBatteryLoadResponse(
      dataset({
        current: numericSeries(
          [-SECOND, SECOND, 2 * SECOND, 3 * SECOND, 4 * SECOND],
          [7, 9, Number.NaN, 11, 13],
          "A",
        ),
        voltage: numericSeries(
          [-0.5 * SECOND, 2.5 * SECOND, 4 * SECOND],
          [12, 10, 9],
          "V",
        ),
        endUs: 4 * SECOND,
      }),
      { startUs: 0, endUs: 4 * SECOND },
      {
        stepWindowSamples: 1,
        stepGapSamples: 1,
        localWindowMinimumIntervals: 2,
      },
    );

    expect(analysis.status).toBe("available");
    if (analysis.status !== "available") return;
    expect(analysis.quality).toMatchObject({
      requestedDurationSeconds: 4,
      timelineIntervalCount: 5,
      completeIntervalCount: 3,
      droppedIntervalCount: 2,
      coveredDurationSeconds: 3,
      coverageFraction: 0.75,
    });
    expect(analysis.summary.averageRegisteredCurrentA).toBe(9);
    expect(analysis.summary.averageVoltageV).toBeCloseTo(34 / 3, 12);
    expect(Array.from(analysis.observedCurve.timestampsUs)).toEqual([
      0,
      SECOND,
      3 * SECOND,
    ]);
    expect(Array.from(analysis.observedCurve.intervalDurationSeconds)).toEqual([1, 1, 1]);
    expect(Array.from(analysis.observedCurve.timestampsUs).every((value) => value < 4 * SECOND)).toBe(
      true,
    );
  });

  it("bounds timestamp scanning to a narrow selected range", () => {
    const timestamps = Array.from({ length: 20_000 }, (_, index) => index * 20_000);
    const currents = timestamps.map((_, index) =>
      Math.floor(index / 5) % 2 === 0 ? 20 : 100,
    );
    const voltages = currents.map((currentA) => 12.6 - 0.016 * currentA);
    const counted = countedTimestamps(timestamps);
    const current = numericSeries(timestamps, currents, "A");
    current.timestampsUs = counted.timestampsUs;
    const startUs = timestamps[10_000];
    const endUs = timestamps[10_050];
    const analysis = analyzeBatteryLoadResponse(
      dataset({
        current,
        voltage: numericSeries(timestamps, voltages, "V"),
        endUs: timestamps.at(-1)! + 20_000,
      }),
      { startUs, endUs },
      {
        stepCurrentThresholdA: 30,
        stepWindowSamples: 2,
        stepGapSamples: 1,
        minimumIndependentSteps: 1,
        localWindowMinimumIntervals: 4,
      },
    );

    expect(analysis.status).toBe("available");
    if (analysis.status !== "available") return;
    expect(analysis.quality.timelineIntervalCount).toBe(50);
    expect(counted.readCount()).toBeLessThan(5_000);
    expect(
      Array.from(analysis.observedCurve.timestampsUs).every(
        (timestampUs) => timestampUs >= startUs && timestampUs < endUs,
      ),
    ).toBe(true);
    if (analysis.stepResponse.status === "available") {
      expect(
        Array.from(analysis.stepResponse.timestampsUs).every(
          (timestampUs) => timestampUs >= startUs && timestampUs < endUs,
        ),
      ).toBe(true);
    }
  });

  it("reports invalid and uncovered ranges explicitly", () => {
    const base = dataset({
      current: numericSeries([0], [Number.NaN], "A"),
      voltage: numericSeries([0], [12], "V"),
      endUs: SECOND,
    });
    expect(
      analyzeBatteryLoadResponse(base, { startUs: SECOND, endUs: SECOND }),
    ).toMatchObject({ status: "unavailable", reason: "INVALID_RANGE" });
    expect(analyzeBatteryLoadResponse(base)).toMatchObject({
      status: "unavailable",
      reason: "NO_COMPLETE_INTERVALS",
    });
  });
});
