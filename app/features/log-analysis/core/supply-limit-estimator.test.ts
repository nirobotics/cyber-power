import { describe, expect, it } from "vitest";

import {
  estimateSupplyCurrentLimits,
  SupplyLimitValidationError,
  validateSupplyCurrentLimits,
} from "./index";
import type {
  BooleanSeries,
  EnergyLogDataset,
  LogIssue,
  NumericSeries,
  SubsystemNode,
} from "./types";

const TIMESTAMPS = [0, 1_000_000, 2_000_000, 3_000_000, 4_000_000];

function numericSeries(
  entryName: string,
  values: number[],
  timestampsUs = TIMESTAMPS,
  unit = "",
): NumericSeries {
  return {
    entryName,
    unit,
    timestampsUs: Float64Array.from(timestampsUs),
    values: Float64Array.from(values),
  };
}

function booleanSeries(
  entryName: string,
  values: number[],
  timestampsUs: number[],
): BooleanSeries {
  return {
    entryName,
    timestampsUs: Float64Array.from(timestampsUs),
    values: Uint8Array.from(values),
  };
}

function subsystem(
  id: string,
  current: number[],
  power: number[],
  energy: number[],
  options: {
    parentId?: string | null;
    childrenIds?: string[];
  } = {},
): SubsystemNode {
  const segments = id.split("/");
  const childrenIds = options.childrenIds ?? [];
  return {
    id,
    rawPath: id,
    displayName: segments.at(-1)!,
    parentId: options.parentId ?? null,
    depth: segments.length - 1,
    childrenIds,
    isAggregate: childrenIds.length > 0,
    currentA: numericSeries(`current/${id}`, current, TIMESTAMPS, "A"),
    powerW: numericSeries(`power/${id}`, power, TIMESTAMPS, "W"),
    energyWh: numericSeries(`energy/${id}`, energy, TIMESTAMPS, "Wh"),
  };
}

function buildDataset(issues: LogIssue[] = []): EnergyLogDataset {
  const indexer = subsystem(
    "indexer",
    [10, 100, 40, 80, 20],
    [120, 1_200, 480, 960, 240],
    [0, 1, 3, 5, 6],
  );
  const intake = subsystem(
    "intake",
    [20, 30, 90, 20, 20],
    [240, 360, 1_080, 240, 240],
    [0, 1, 2, 4, 5],
  );
  const shooter = subsystem(
    "shooter",
    [10, 10, 10, 10, 10],
    [120, 120, 120, 120, 120],
    [0, 1, 2, 3, 4],
    { childrenIds: ["shooter/flywheel"] },
  );
  const flywheel = subsystem(
    "shooter/flywheel",
    [10, 10, 10, 10, 10],
    [120, 120, 120, 120, 120],
    [0, 1, 2, 3, 4],
    { parentId: "shooter" },
  );
  const enabled = booleanSeries(
    "/DriverStation/Enabled",
    [1, 0, 1, 0],
    [0, 2_000_000, 3_000_000, 4_000_000],
  );

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
    root: "/Unknown/energyLogger",
    bounds: {
      logStartUs: 0,
      logEndUs: 4_000_000,
      energyStartUs: 0,
      energyEndUs: 4_000_000,
    },
    series: {
      totalCurrentA: numericSeries(
        "totalCurrent",
        [40, 140, 140, 110, 50],
        TIMESTAMPS,
        "A",
      ),
      totalPowerW: numericSeries(
        "totalPower",
        [480, 1_680, 1_680, 1_320, 600],
        TIMESTAMPS,
        "W",
      ),
      totalEnergyWh: numericSeries("totalEnergy", [0, 3, 7, 12, 15], TIMESTAMPS, "Wh"),
      enabled,
    },
    subsystems: [indexer, intake, shooter, flywheel],
    segments: {
      brownouts: [],
      enabled: [
        { startUs: 0, endUs: 2_000_000, durationSeconds: 2 },
        { startUs: 3_000_000, endUs: 4_000_000, durationSeconds: 1 },
      ],
      modes: [],
    },
    quality: {
      issues,
      reconciliation: {
        totalEnergyWh: 15,
        topLevelEnergyWh: 15,
        differenceWh: 0,
        differencePercent: 0,
        withinTolerance: true,
      },
      droppedNonfiniteSamples: 0,
      resetCount: 0,
    },
  };
}

function copyNumericValues(dataset: EnergyLogDataset): number[][] {
  return [
    ...Object.values(dataset.series)
      .filter((series): series is NumericSeries => series !== undefined && "unit" in series)
      .map((series) => Array.from(series.values)),
    ...dataset.subsystems.flatMap((node) => [
      Array.from(node.currentA.values),
      Array.from(node.powerW.values),
      Array.from(node.energyWh.values),
    ]),
  ];
}

describe("multi-target Supply current limit estimator", () => {
  it("accepts a top-level terminal node such as indexer without aggregate confirmation", () => {
    const dataset = buildDataset();

    expect(validateSupplyCurrentLimits(dataset, [{ nodeId: "indexer", limitA: 50 }])).toEqual(
      [],
    );

    const result = estimateSupplyCurrentLimits(dataset, {
      limits: [{ nodeId: "indexer", limitA: 50 }],
    });

    expect(result).not.toHaveProperty("timeline");
    expect(result.targets).toHaveLength(1);
    expect(result.targets[0]).toMatchObject({
      nodeId: "indexer",
      kind: "terminal",
      limitA: 50,
      energySavedWh: 1.25,
      clippedDurationSeconds: 2,
      ampSecondsRemoved: 80,
    });
    expect(result.targets[0].baseline.energyWh).toBe(6);
    expect(result.targets[0].estimated.energyWh).toBe(4.75);
    expect(result.targets[0].estimated.peakCurrentA).toBe(50);
    expect(result.targets[0].estimated.peakCurrentTimestampUs).toBe(1_000_000);
    expect(result.targets[0].estimated.peakCurrentA).toBeLessThanOrEqual(50);
    expect(result.targets[0].estimated.averagePowerW).toBeCloseTo(4_200);
  });

  it("applies several independent targets atomically and is invariant to input order", () => {
    const dataset = buildDataset();
    const forward = estimateSupplyCurrentLimits(dataset, {
      limits: [
        { nodeId: "indexer", limitA: 50 },
        { nodeId: "intake", limitA: 50 },
      ],
    });
    const reversed = estimateSupplyCurrentLimits(dataset, {
      limits: [
        { nodeId: "intake", limitA: 50 },
        { nodeId: "indexer", limitA: 50 },
      ],
    });

    expect(reversed).toEqual(forward);
    expect(forward.targets.map((target) => target.nodeId)).toEqual(["indexer", "intake"]);
    expect(forward.totals.activeTargetCount).toBe(2);
    expect(forward.totals.energySavedWh).toBeCloseTo(1.25 + 4 / 9);
    expect(forward.totals.estimated?.energyWh).toBeCloseTo(15 - 1.25 - 4 / 9);
    expect(forward.totals.estimated?.peakCurrentA).toBe(100);
    expect(forward.totals.estimated?.peakCurrentTimestampUs).toBe(2_000_000);
    expect(forward.totals.estimated?.peakPowerW).toBe(1_200);
    expect(forward.totals.estimated?.peakPowerTimestampUs).toBe(2_000_000);
    expect(forward.totals.clippedUnionDurationSeconds).toBe(3);
    expect(forward.totals.clippedDurationSumSeconds).toBe(3);
  });

  it("is unchanged above the observed peak and saves monotonically as the limit falls", () => {
    const dataset = buildDataset();
    const high = estimateSupplyCurrentLimits(dataset, {
      limits: [{ nodeId: "indexer", limitA: 200 }],
    });
    const medium = estimateSupplyCurrentLimits(dataset, {
      limits: [{ nodeId: "indexer", limitA: 50 }],
    });
    const zero = estimateSupplyCurrentLimits(dataset, {
      limits: [{ nodeId: "indexer", limitA: 0 }],
    });

    expect(high.targets[0].estimated).toEqual(high.targets[0].baseline);
    expect(high.targets[0].energySavedWh).toBe(0);
    expect(zero.targets[0].estimated.energyWh).toBe(0);
    expect(zero.targets[0].estimated.peakCurrentA).toBe(0);
    expect(high.totals.energySavedWh).toBeLessThan(medium.totals.energySavedWh);
    expect(medium.totals.energySavedWh).toBeLessThan(zero.totals.energySavedWh);
    expect(zero.totals.robotEstimateAvailable).toBe(true);
  });

  it("rejects unconfirmed aggregates, duplicate targets, and ancestor/descendant overlap", () => {
    const dataset = buildDataset();
    const issues = validateSupplyCurrentLimits(dataset, [
      { nodeId: "shooter", limitA: 20 },
      { nodeId: "shooter/flywheel", limitA: 10 },
      { nodeId: "shooter/flywheel", limitA: 5 },
    ]);

    expect(issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "AGGREGATE_CONFIRMATION_REQUIRED",
        "DUPLICATE_TARGET",
        "HIERARCHY_CONFLICT",
      ]),
    );
    expect(() =>
      estimateSupplyCurrentLimits(dataset, {
        limits: [
          { nodeId: "shooter", limitA: 20, aggregateConfirmed: true },
          { nodeId: "shooter/flywheel", limitA: 10 },
        ],
      }),
    ).toThrow(SupplyLimitValidationError);

    expect(
      validateSupplyCurrentLimits(dataset, [
        { nodeId: "shooter", limitA: 20, aggregateConfirmed: true },
      ]),
    ).toEqual([]);
  });

  it("uses held values at range boundaries and includes an end-boundary sample", () => {
    const result = estimateSupplyCurrentLimits(buildDataset(), {
      limits: [{ nodeId: "indexer", limitA: 50 }],
      range: { startUs: 1_500_000, endUs: 3_500_000 },
    });

    expect(result.targets[0].baseline.energyWh).toBe(4);
    expect(result.targets[0].estimated.energyWh).toBe(3.25);
    expect(result.targets[0].baseline.peakCurrentTimestampUs).toBe(1_500_000);
    expect(result.targets[0].estimated.peakCurrentTimestampUs).toBe(1_500_000);
    expect(result.targets[0].estimated.peakCurrentA).toBe(50);
    expect(result.targets[0].clippedDurationSeconds).toBe(1);
    expect(result.targets[0].ampSecondsRemoved).toBe(40);
  });

  it("rounds requested bounds to integer microseconds and includes an exact end sample", () => {
    const result = estimateSupplyCurrentLimits(buildDataset(), {
      limits: [{ nodeId: "indexer", limitA: 50 }],
      range: { startUs: 1_500_000.4, endUs: 3_000_000.4 },
    });

    expect(result.range).toMatchObject({ startUs: 1_500_000, endUs: 3_000_000 });
    expect(result.targets[0].baseline.energyWh).toBe(4);
    expect(result.targets[0].estimated.energyWh).toBe(3.25);
    expect(result.targets[0].estimated.peakCurrentA).toBe(50);
    expect(result.targets[0].estimated.peakCurrentTimestampUs).toBe(1_500_000);
    expect(result.targets[0].clippedDurationSeconds).toBe(0.5);
    expect(result.targets[0].ampSecondsRemoved).toBe(25);
  });

  it("returns an unchanged baseline when every configured target is disabled", () => {
    const result = estimateSupplyCurrentLimits(buildDataset(), {
      limits: [{ nodeId: "indexer", limitA: Number.NaN, enabled: false }],
    });

    expect(result.targets).toEqual([]);
    expect(result.totals.activeTargetCount).toBe(0);
    expect(result.totals.estimated).toEqual(result.totals.baseline);
    expect(result.warnings.some((item) => item.code === "NO_ACTIVE_LIMITS")).toBe(true);
  });

  it("reports zero estimated average power for an all-Disabled selection", () => {
    const dataset = buildDataset();
    dataset.series.enabled = booleanSeries("/DriverStation/Enabled", [0], [0]);
    dataset.segments.enabled = [];

    const result = estimateSupplyCurrentLimits(dataset, {
      limits: [{ nodeId: "indexer", limitA: 50 }],
    });

    expect(result.targets[0].baseline.averagePowerW).toBe(0);
    expect(result.targets[0].estimated.averagePowerW).toBe(0);
    expect(result.totals.baseline.averagePowerW).toBe(0);
    expect(result.totals.estimated?.averagePowerW).toBe(0);
  });

  it("segments cumulative energy resets and scales only positive increments", () => {
    const dataset = buildDataset();
    const indexer = dataset.subsystems.find((node) => node.id === "indexer")!;
    indexer.currentA = numericSeries("current/indexer", [100, 100, 100, 100], [0, 1e6, 2e6, 3e6], "A");
    indexer.powerW = numericSeries("power/indexer", [1_200, 1_200, 1_200, 1_200], [0, 1e6, 2e6, 3e6], "W");
    indexer.energyWh = numericSeries("energy/indexer", [0, 2, 0.5, 2.5], [0, 1e6, 2e6, 3e6], "Wh");
    dataset.bounds.energyEndUs = 3_000_000;

    const result = estimateSupplyCurrentLimits(dataset, {
      limits: [{ nodeId: "indexer", limitA: 50 }],
    });

    expect(result.targets[0].baseline.energyWh).toBe(4);
    expect(result.targets[0].estimated.energyWh).toBe(2);
    expect(result.targets[0].warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "SOURCE_ENERGY_RESET", details: { resetCount: 1 } }),
      ]),
    );
  });

  it("preserves positive power and energy when held current is not positive", () => {
    const dataset = buildDataset();
    const indexer = dataset.subsystems.find((node) => node.id === "indexer")!;
    indexer.currentA = numericSeries("current/indexer", [0, 0, 0, 0, 0], TIMESTAMPS, "A");
    indexer.powerW = numericSeries("power/indexer", [100, 100, 100, 100, 100], TIMESTAMPS, "W");
    indexer.energyWh = numericSeries("energy/indexer", [0, 1, 2, 3, 4], TIMESTAMPS, "Wh");

    const result = estimateSupplyCurrentLimits(dataset, {
      limits: [{ nodeId: "indexer", limitA: 0 }],
    });

    expect(result.targets[0].energySavedWh).toBe(0);
    expect(result.targets[0].estimated.energyWh).toBe(result.targets[0].baseline.energyWh);
    expect(result.targets[0].warnings.some((item) => item.code === "SOURCE_CURRENT_MISMATCH"))
      .toBe(true);
  });

  it("preserves negative power samples instead of increasing the robot estimate", () => {
    const dataset = buildDataset();
    const indexer = dataset.subsystems.find((node) => node.id === "indexer")!;
    indexer.currentA = numericSeries(
      "current/indexer",
      [100, 100, 100, 100, 100],
      TIMESTAMPS,
      "A",
    );
    indexer.powerW = numericSeries(
      "power/indexer",
      [-100, -100, -100, -100, -100],
      TIMESTAMPS,
      "W",
    );
    dataset.series.totalPowerW = numericSeries(
      "totalPower",
      [100, 100, 100, 100, 100],
      TIMESTAMPS,
      "W",
    );
    dataset.series.totalCurrentA = numericSeries(
      "totalCurrent",
      [200, 200, 200, 200, 200],
      TIMESTAMPS,
      "A",
    );

    const result = estimateSupplyCurrentLimits(dataset, {
      limits: [{ nodeId: "indexer", limitA: 50 }],
    });

    expect(result.targets[0].estimated.peakPowerW).toBe(-100);
    expect(result.totals.estimated?.peakPowerW).toBe(100);
    expect(result.totals.estimated?.peakPowerTimestampUs).toBe(0);
    expect(result.targets[0].warnings.some((item) => item.code === "SOURCE_NEGATIVE_VALUE"))
      .toBe(true);
  });

  it("marks the robot estimate unavailable instead of clamping a material mismatch", () => {
    const dataset = buildDataset();
    dataset.series.totalCurrentA = numericSeries("totalCurrent", [1, 1, 1, 1, 1], TIMESTAMPS, "A");
    dataset.series.totalPowerW = numericSeries("totalPower", [1, 1, 1, 1, 1], TIMESTAMPS, "W");

    const result = estimateSupplyCurrentLimits(dataset, {
      limits: [{ nodeId: "indexer", limitA: 0 }],
    });

    expect(result.totals.robotEstimateAvailable).toBe(false);
    expect(result.totals.estimated).toBeUndefined();
    expect(result.warnings.some((item) => item.code === "ROBOT_ESTIMATE_UNAVAILABLE"))
      .toBe(true);
  });

  it("maps source quality limitations to explicit estimator warnings", () => {
    const dataset = buildDataset([
      { severity: "warning", code: "NONFINITE_VALUE_DROPPED", message: "dropped" },
      { severity: "warning", code: "TIME_GAP", message: "gap" },
      { severity: "warning", code: "PARTIAL_SUBSERIES", message: "partial" },
    ]);

    const result = estimateSupplyCurrentLimits(dataset, {
      limits: [{ nodeId: "indexer", limitA: 200 }],
    });

    expect(result.warnings.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        "SOURCE_NONFINITE_DROPPED",
        "SOURCE_TIME_GAP",
        "SOURCE_PARTIAL_SUBSERIES",
        "LIMIT_NOT_TRIGGERED",
      ]),
    );
  });

  it("does not mutate source typed arrays", () => {
    const dataset = buildDataset();
    const before = copyNumericValues(dataset);

    estimateSupplyCurrentLimits(dataset, {
      limits: [
        { nodeId: "indexer", limitA: 50 },
        { nodeId: "intake", limitA: 50 },
      ],
    });

    expect(copyNumericValues(dataset)).toEqual(before);
  });
});
