import { describe, expect, it } from "vitest";
import {
  appendEnergySample,
  appendEnergyV2FixtureSample,
  buildEnergyFixture,
  buildEnergyV2Fixture,
} from "../../../../tests/fixtures/wpilog-builder";
import {
  deriveEnergyLoggerV2MotorGroupElectricalSeries,
  estimateSupplyCurrentLimits,
  parseEnergyLog,
  SupplyLimitValidationError,
  validateSupplyCurrentLimits,
} from "./index";
import type { BooleanSeries, EnergyLogDataset, NumericSeries } from "./types";

interface SampleOptions {
  robotCurrentA?: number;
  robotVoltageV?: number;
  driveLeaderSupplyCurrentA?: number;
  driveFollowerSupplyCurrentA?: number;
  indexerSupplyCurrentA?: number;
}

async function buildV2Dataset(samples: readonly SampleOptions[] = Array.from({ length: 5 }, () => ({}))) {
  const fixture = buildEnergyV2Fixture();
  samples.forEach((options, index) => {
    appendEnergyV2FixtureSample(
      fixture,
      (index + 1) * 1_000_000,
      { drive: "DRIVE", indexer: "FEED" },
      0,
      options,
    );
  });
  return parseEnergyLog(fixture.builder.build());
}

function groupId(dataset: EnergyLogDataset, subsystemName: string): string {
  const group = deriveEnergyLoggerV2MotorGroupElectricalSeries(dataset)?.find(
    (candidate) => candidate.subsystemName === subsystemName,
  );
  if (!group) throw new Error(`Missing test motor group: ${subsystemName}`);
  return group.id;
}

function booleanSeries(values: number[], timestampsUs: number[]): BooleanSeries {
  return {
    entryName: "/DriverStation/Enabled",
    timestampsUs: Float64Array.from(timestampsUs),
    values: Uint8Array.from(values),
  };
}

function copiedValues(dataset: EnergyLogDataset): number[][] {
  return [
    ...Object.values(dataset.series)
      .filter((series): series is NumericSeries => series !== undefined && "unit" in series)
      .map((series) => Array.from(series.values)),
    ...dataset.v2!.subsystems.map((subsystem) => Array.from(subsystem.motorSamples.values)),
    Array.from(dataset.v2!.robotSupplyCurrentAmps.values),
    Array.from(dataset.v2!.robotBatteryVoltageVolts.values),
  ];
}

describe("Manifest motor-group Supply current limit estimator", () => {
  it("limits one Leader group using Leader plus Follower Supply Current", async () => {
    const dataset = await buildV2Dataset();
    const driveId = groupId(dataset, "drive");
    expect(validateSupplyCurrentLimits(dataset, [{ motorGroupId: driveId, limitA: 10 }]))
      .toEqual([]);

    const result = estimateSupplyCurrentLimits(dataset, {
      limits: [{ motorGroupId: driveId, limitA: 10 }],
    });

    expect(result.targets).toHaveLength(1);
    expect(result.targets[0]).toMatchObject({
      motorGroupId: driveId,
      subsystemName: "drive",
      leaderName: "frontLeft",
      motorNames: ["frontLeft", "frontRight"],
      motorCount: 2,
      limitA: 10,
      clippedDurationSeconds: 4,
      ampSecondsRemoved: 40,
    });
    expect(result.targets[0].baseline.peakCurrentA).toBe(20);
    expect(result.targets[0].estimated.peakCurrentA).toBe(10);
    expect(result.targets[0].baseline.energyWh).toBeCloseTo(240 * 4 / 3600, 10);
    expect(result.targets[0].estimated.energyWh).toBeCloseTo(120 * 4 / 3600, 10);
    expect(result.targets[0].baseline.averagePowerW).toBeCloseTo(240, 10);
    expect(result.targets[0].estimated.averagePowerW).toBeCloseTo(120, 10);
  });

  it("applies independent Leader groups atomically and is invariant to input order", async () => {
    const dataset = await buildV2Dataset();
    const driveId = groupId(dataset, "drive");
    const indexerId = groupId(dataset, "indexer");
    const forward = estimateSupplyCurrentLimits(dataset, {
      limits: [
        { motorGroupId: driveId, limitA: 10 },
        { motorGroupId: indexerId, limitA: 2.5 },
      ],
    });
    const reversed = estimateSupplyCurrentLimits(dataset, {
      limits: [
        { motorGroupId: indexerId, limitA: 2.5 },
        { motorGroupId: driveId, limitA: 10 },
      ],
    });

    expect(reversed).toEqual(forward);
    expect(forward.targets.map((target) => target.motorGroupId)).toEqual(
      [driveId, indexerId].sort(),
    );
    expect(forward.totals.estimated?.peakCurrentA).toBeCloseTo(12.5, 10);
    expect(forward.totals.estimated?.peakPowerW).toBeCloseTo(150, 10);
    expect(forward.totals.estimated?.energyWh).toBeCloseTo(150 * 4 / 3600, 10);
    expect(forward.totals.clippedUnionDurationSeconds).toBe(4);
    expect(forward.totals.clippedDurationSumSeconds).toBe(8);
  });

  it("is unchanged above the observed group peak and becomes stricter monotonically", async () => {
    const dataset = await buildV2Dataset();
    const driveId = groupId(dataset, "drive");
    const high = estimateSupplyCurrentLimits(dataset, {
      limits: [{ motorGroupId: driveId, limitA: 30 }],
    });
    const medium = estimateSupplyCurrentLimits(dataset, {
      limits: [{ motorGroupId: driveId, limitA: 10 }],
    });
    const zero = estimateSupplyCurrentLimits(dataset, {
      limits: [{ motorGroupId: driveId, limitA: 0 }],
    });

    expect(high.targets[0].estimated).toEqual(high.targets[0].baseline);
    expect(high.targets[0].energySavedWh).toBe(0);
    expect(zero.targets[0].estimated.energyWh).toBe(0);
    expect(zero.targets[0].estimated.peakCurrentA).toBe(0);
    expect(high.totals.energySavedWh).toBeLessThan(medium.totals.energySavedWh);
    expect(medium.totals.energySavedWh).toBeLessThan(zero.totals.energySavedWh);
  });

  it("rejects a Follower as a target, duplicate groups, invalid limits, and V1 logs", async () => {
    const dataset = await buildV2Dataset();
    const driveId = groupId(dataset, "drive");
    const issues = validateSupplyCurrentLimits(dataset, [
      { motorGroupId: `${dataset.v2!.subsystems[0].id}/frontRight`, limitA: 10 },
      { motorGroupId: driveId, limitA: 10 },
      { motorGroupId: driveId, limitA: -1 },
    ]);
    expect(issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "UNKNOWN_MOTOR_GROUP",
      "DUPLICATE_TARGET",
      "INVALID_LIMIT",
    ]));

    const fixture = buildEnergyFixture();
    appendEnergySample(fixture.builder, fixture.entries, 1_000_000, {
      current: 10, power: 120, energy: 0,
    });
    appendEnergySample(fixture.builder, fixture.entries, 2_000_000, {
      current: 10, power: 120, energy: 1,
    });
    const v1 = await parseEnergyLog(fixture.builder.build());
    expect(validateSupplyCurrentLimits(v1, [])).toEqual([
      expect.objectContaining({ code: "V2_MOTOR_GROUPS_REQUIRED" }),
    ]);
    expect(() => estimateSupplyCurrentLimits(v1, { limits: [] }))
      .toThrow(SupplyLimitValidationError);
  });

  it("uses held values at partial range boundaries", async () => {
    const dataset = await buildV2Dataset([
      {},
      { robotCurrentA: 45, driveLeaderSupplyCurrentA: 24, driveFollowerSupplyCurrentA: 16 },
      { robotCurrentA: 45, driveLeaderSupplyCurrentA: 24, driveFollowerSupplyCurrentA: 16 },
      { robotCurrentA: 45, driveLeaderSupplyCurrentA: 24, driveFollowerSupplyCurrentA: 16 },
      { robotCurrentA: 45, driveLeaderSupplyCurrentA: 24, driveFollowerSupplyCurrentA: 16 },
    ]);
    const driveId = groupId(dataset, "drive");
    const result = estimateSupplyCurrentLimits(dataset, {
      limits: [{ motorGroupId: driveId, limitA: 10 }],
      range: { startUs: 1_500_000.4, endUs: 4_500_000.4 },
    });

    expect(result.range).toMatchObject({ startUs: 1_500_000, endUs: 4_500_000 });
    expect(result.targets[0].baseline.energyWh).toBeCloseTo(
      (240 * 0.5 + 480 * 2.5) / 3600,
      10,
    );
    expect(result.targets[0].estimated.energyWh).toBeCloseTo(120 * 3 / 3600, 10);
    expect(result.targets[0].energySavedWh).toBeCloseTo(
      (240 * 0.5 + 480 * 2.5 - 120 * 3) / 3600,
      10,
    );
    expect(result.targets[0].clippedDurationSeconds).toBe(3);
  });

  it("returns the baseline when every configured group is disabled", async () => {
    const dataset = await buildV2Dataset();
    const result = estimateSupplyCurrentLimits(dataset, {
      limits: [{ motorGroupId: groupId(dataset, "drive"), limitA: Number.NaN, enabled: false }],
    });
    expect(result.targets).toEqual([]);
    expect(result.totals.estimated).toEqual(result.totals.baseline);
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: "NO_ACTIVE_LIMITS" }));
  });

  it("excludes Disabled time from average power", async () => {
    const dataset = await buildV2Dataset([
      {}, {},
      { robotCurrentA: 50, driveLeaderSupplyCurrentA: 24, driveFollowerSupplyCurrentA: 16, indexerSupplyCurrentA: 10 },
      { robotCurrentA: 50, driveLeaderSupplyCurrentA: 24, driveFollowerSupplyCurrentA: 16, indexerSupplyCurrentA: 10 },
      {},
    ]);
    dataset.series.enabled = booleanSeries([1, 0, 1], [1_000_000, 3_000_000, 5_000_000]);
    dataset.segments.enabled = [
      { startUs: 1_000_000, endUs: 3_000_000, durationSeconds: 2 },
    ];
    const driveId = groupId(dataset, "drive");
    const result = estimateSupplyCurrentLimits(dataset, {
      limits: [{ motorGroupId: driveId, limitA: 10 }],
    });
    expect(result.targets[0].baseline.averagePowerW).toBeCloseTo(240, 10);
    expect(result.targets[0].estimated.averagePowerW).toBeCloseTo(120, 10);
  });

  it("preserves negative Supply Current instead of clipping it", async () => {
    const dataset = await buildV2Dataset([
      {},
      { driveLeaderSupplyCurrentA: -6, driveFollowerSupplyCurrentA: -4 },
      {}, {}, {},
    ]);
    const driveId = groupId(dataset, "drive");
    const result = estimateSupplyCurrentLimits(dataset, {
      limits: [{ motorGroupId: driveId, limitA: 10 }],
    });
    expect(result.targets[0].warnings).toContainEqual(
      expect.objectContaining({ code: "SOURCE_NEGATIVE_VALUE" }),
    );
    expect(result.targets[0].energySavedWh).toBeGreaterThan(0);
    expect(result.targets[0].energySavedWh).toBeLessThan(120 * 4 / 3600);
  });

  it("allows a negative signed robot residual when other loads are regenerating", async () => {
    const dataset = await buildV2Dataset(Array.from({ length: 5 }, () => ({ robotCurrentA: 1 })));
    const result = estimateSupplyCurrentLimits(dataset, {
      limits: [{ motorGroupId: groupId(dataset, "drive"), limitA: 0 }],
    });
    expect(result.totals.robotEstimateAvailable).toBe(true);
    expect(result.totals.estimated?.peakCurrentA).toBe(-19);
    expect(result.totals.estimated?.energyWh).toBe(0);
    expect(result.totals.energySavedWh).toBeCloseTo(12 * 4 / 3600, 10);
    expect(result.warnings).not.toContainEqual(
      expect.objectContaining({ code: "ROBOT_ESTIMATE_UNAVAILABLE" }),
    );
  });

  it("marks the robot estimate unavailable when its electrical timeline is nonfinite", async () => {
    const dataset = await buildV2Dataset();
    dataset.series.totalCurrentA.values[2] = Number.NaN;
    const result = estimateSupplyCurrentLimits(dataset, {
      limits: [{ motorGroupId: groupId(dataset, "drive"), limitA: 10 }],
    });
    expect(result.totals.robotEstimateAvailable).toBe(false);
    expect(result.totals.estimated).toBeUndefined();
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: "ROBOT_ESTIMATE_UNAVAILABLE" }),
    );
  });

  it("keeps nonfinite Follower intervals out of residual subtraction", async () => {
    const dataset = await buildV2Dataset([
      {},
      { driveFollowerSupplyCurrentA: Number.NaN },
      {}, {}, {},
    ]);
    const result = estimateSupplyCurrentLimits(dataset, {
      limits: [{ motorGroupId: groupId(dataset, "drive"), limitA: 10 }],
    });
    expect(result.targets[0].warnings).toContainEqual(
      expect.objectContaining({ code: "SOURCE_NONFINITE_DROPPED" }),
    );
    expect(Number.isFinite(result.targets[0].estimated.energyWh)).toBe(true);
    expect(Number.isFinite(result.totals.energySavedWh)).toBe(true);
  });

  it("does not mutate canonical or packed source arrays", async () => {
    const dataset = await buildV2Dataset();
    const before = copiedValues(dataset);
    estimateSupplyCurrentLimits(dataset, {
      limits: [
        { motorGroupId: groupId(dataset, "drive"), limitA: 10 },
        { motorGroupId: groupId(dataset, "indexer"), limitA: 2.5 },
      ],
    });
    expect(copiedValues(dataset)).toEqual(before);
  });
});
