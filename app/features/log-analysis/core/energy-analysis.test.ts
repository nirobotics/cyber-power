import { describe, expect, it } from "vitest";

import {
  appendEnergySample,
  appendEnergyV2FixtureSample,
  buildEnergyFixture,
  buildEnergyV2Fixture,
  WpiLogFixtureBuilder,
} from "../../../../tests/fixtures/wpilog-builder";
import {
  analyzeEnergyRange,
  analyzeWpiLog,
  LogAnalysisError,
  parseEnergyLog,
} from "./index";

function errorHasCode(error: unknown, code: string): boolean {
  return error instanceof LogAnalysisError && error.issues.some((issue) => issue.code === code);
}

describe("generic EnergyLogger analysis", () => {
  it("accepts an unknown team and arbitrary mixed-separator subsystem path", async () => {
    const { builder, entries } = buildEnergyFixture({
      root: "/Team9999/RealOutputs/energyLogger",
      rawPath: "climber-left/winchA",
    });
    const projectName = builder.start("/Metadata/ProjectName", "string");
    builder.raw(projectName, 500_000, new TextEncoder().encode("Unrecognized Robot 9999"));
    appendEnergySample(builder, entries, 1_000_000, { current: 10, power: 120, energy: 1 });
    appendEnergySample(builder, entries, 2_000_000, { current: 20, power: 240, energy: 3 });

    const result = await analyzeWpiLog(builder.build());

    expect(result.dataset.root).toBe("/Team9999/RealOutputs/energyLogger");
    expect(result.dataset.subsystems).toHaveLength(1);
    expect(result.dataset.subsystems[0]).toMatchObject({
      id: "climber/left/winchA",
      rawPath: "climber-left/winchA",
    });
    expect(result.range.totals).toMatchObject({
      energyWh: 3,
      averagePowerW: 10_800,
      peakPowerW: 240,
      peakPowerTimestampUs: 2_000_000,
      peakCurrentA: 20,
      peakCurrentTimestampUs: 2_000_000,
    });
    expect(
      result.dataset.quality.issues.filter((issue) => issue.code === "OPTIONAL_SERIES_MISSING"),
    ).toHaveLength(7);
  });

  it("accepts a legacy aggregate path with one trailing slash", async () => {
    const { builder, entries } = buildEnergyFixture({ rawPath: "swerve/" });
    appendEnergySample(builder, entries, 1_000_000, { current: 10, power: 120, energy: 1 });
    appendEnergySample(builder, entries, 2_000_000, { current: 20, power: 240, energy: 3 });

    const result = await analyzeWpiLog(builder.build());

    expect(result.dataset.subsystems).toHaveLength(1);
    expect(result.dataset.subsystems[0]).toMatchObject({
      id: "swerve",
      rawPath: "swerve/",
      parentId: null,
      depth: 0,
    });
    expect(result.range.subsystems[0].energyWh).toBe(3);
  });

  it("still rejects empty hierarchy segments outside the legacy trailing slash", async () => {
    const { builder, entries } = buildEnergyFixture({ rawPath: "swerve//drive" });
    appendEnergySample(builder, entries, 1_000_000, { current: 1, power: 1, energy: 1 });

    await expect(parseEnergyLog(builder.build())).rejects.toSatisfy((error: unknown) =>
      errorHasCode(error, "INVALID_DYNAMIC_PATH"),
    );
  });

  it("does not change metrics when every subsystem label is renamed", async () => {
    const buildNamed = async (rawPath: string) => {
      const { builder, entries } = buildEnergyFixture({ rawPath });
      appendEnergySample(builder, entries, 1_000_000, { current: 4, power: 48, energy: 0.5 });
      appendEnergySample(builder, entries, 2_000_000, { current: 8, power: 96, energy: 1.5 });
      return analyzeWpiLog(builder.build());
    };

    const original = await buildNamed("intake-left/roller");
    const renamed = await buildNamed("mystery-axis/actuatorZ");

    expect(renamed.range.totals).toEqual(original.range.totals);
    expect(renamed.range.subsystems[0].energyWh).toBe(original.range.subsystems[0].energyWh);
    expect(renamed.range.subsystems[0].peakPowerW).toBe(
      original.range.subsystems[0].peakPowerW,
    );
    expect(renamed.dataset.subsystems[0].id).not.toBe(original.dataset.subsystems[0].id);
  });

  it("uses sample-and-hold for instantaneous values in a selected range", async () => {
    const { builder, entries } = buildEnergyFixture();
    appendEnergySample(builder, entries, 1_000_000, { current: 10, power: 100, energy: 1 });
    appendEnergySample(builder, entries, 2_000_000, { current: 10, power: 100, energy: 1 });
    appendEnergySample(builder, entries, 3_000_000, { current: 30, power: 300, energy: 3 });
    const dataset = await parseEnergyLog(builder.build());

    const range = analyzeEnergyRange(dataset, { startUs: 1_500_000, endUs: 2_500_000 });

    expect(range.totals.peakPowerW).toBe(100);
    expect(range.totals.peakPowerTimestampUs).toBe(1_500_000);
    expect(range.totals.peakCurrentA).toBe(10);
    expect(range.totals.peakCurrentTimestampUs).toBe(1_500_000);
    expect(range.subsystems[0]).toMatchObject({
      peakPowerTimestampUs: 1_500_000,
      peakCurrentTimestampUs: 1_500_000,
    });
    expect(range.totals.energyWh).toBe(0);
  });

  it("reports the exact selection-start timestamp for a peak sampled at the boundary", async () => {
    const { builder, entries } = buildEnergyFixture();
    appendEnergySample(builder, entries, 1_000_000, { current: 10, power: 100, energy: 1 });
    appendEnergySample(builder, entries, 2_000_000, { current: 30, power: 300, energy: 2 });
    appendEnergySample(builder, entries, 3_000_000, { current: 20, power: 200, energy: 3 });
    const dataset = await parseEnergyLog(builder.build());

    const range = analyzeEnergyRange(dataset, { startUs: 2_000_000, endUs: 2_500_000 });

    expect(range.totals).toMatchObject({
      peakPowerW: 300,
      peakPowerTimestampUs: 2_000_000,
      peakCurrentA: 30,
      peakCurrentTimestampUs: 2_000_000,
    });
  });

  it("keeps the earliest timestamp when equal peak samples repeat", async () => {
    const { builder, entries } = buildEnergyFixture();
    appendEnergySample(builder, entries, 1_000_000, { current: 10, power: 100, energy: 1 });
    appendEnergySample(builder, entries, 2_000_000, { current: 30, power: 300, energy: 2 });
    appendEnergySample(builder, entries, 2_500_000, { current: 30, power: 300, energy: 2.5 });
    appendEnergySample(builder, entries, 3_000_000, { current: 20, power: 200, energy: 3 });
    const dataset = await parseEnergyLog(builder.build());

    const range = analyzeEnergyRange(dataset, { startUs: 1_500_000, endUs: 3_000_000 });

    expect(range.totals).toMatchObject({
      peakPowerW: 300,
      peakPowerTimestampUs: 2_000_000,
      peakCurrentA: 30,
      peakCurrentTimestampUs: 2_000_000,
    });
    expect(range.subsystems[0]).toMatchObject({
      peakPowerTimestampUs: 2_000_000,
      peakCurrentTimestampUs: 2_000_000,
    });
  });

  it("includes a peak sample exactly at the selection end", async () => {
    const { builder, entries } = buildEnergyFixture();
    appendEnergySample(builder, entries, 1_000_000, { current: 10, power: 100, energy: 1 });
    appendEnergySample(builder, entries, 2_000_000, { current: 20, power: 200, energy: 2 });
    appendEnergySample(builder, entries, 3_000_000, { current: 40, power: 400, energy: 3 });
    const dataset = await parseEnergyLog(builder.build());

    const range = analyzeEnergyRange(dataset, { startUs: 1_500_000, endUs: 3_000_000 });

    expect(range.totals).toMatchObject({
      peakPowerW: 400,
      peakPowerTimestampUs: 3_000_000,
      peakCurrentA: 40,
      peakCurrentTimestampUs: 3_000_000,
    });
  });

  it("segments cumulative resets and sums positive epoch deltas", async () => {
    const { builder, entries } = buildEnergyFixture();
    appendEnergySample(builder, entries, 1_000_000, { current: 10, power: 100, energy: 5 });
    appendEnergySample(builder, entries, 2_000_000, { current: 10, power: 100, energy: 1 });
    appendEnergySample(builder, entries, 3_000_000, { current: 10, power: 100, energy: 3 });

    const result = await analyzeWpiLog(builder.build());

    expect(result.range.totals.energyWh).toBe(7);
    expect(result.dataset.quality.resetCount).toBe(2);
    expect(result.dataset.quality.issues.some((issue) => issue.code === "ENERGY_RESET")).toBe(
      true,
    );
  });

  it("warns when an aggregate does not reconcile with its direct children", async () => {
    const { builder, entries } = buildEnergyFixture({ rawPath: "arm" });
    appendEnergySample(builder, entries, 1_000_000, { current: 3, power: 30, energy: 3 });
    const root = "/UnknownTeam/RealOutputs/energyLogger";
    const childEntries = {
      current: builder.start(`${root}/current/arm/motor`, "double"),
      power: builder.start(`${root}/power/arm/motor`, "double"),
      energy: builder.start(`${root}/energy/arm/motor`, "double"),
    };
    builder
      .double(childEntries.current, 1_000_000, 2)
      .double(childEntries.power, 1_000_000, 20)
      .double(childEntries.energy, 1_000_000, 2);

    const dataset = await parseEnergyLog(builder.build());

    expect(dataset.quality.reconciliation.withinTolerance).toBe(true);
    expect(
      dataset.quality.issues.some(
        (issue) =>
          issue.code === "ENERGY_RECONCILIATION_MISMATCH" && issue.details?.scope === "aggregate",
      ),
    ).toBe(true);
  });

  it("derives voltage, brownout, enabled, and mode intervals when available", async () => {
    const { builder, entries } = buildEnergyFixture({ includeOptionals: true });
    appendEnergySample(builder, entries, 1_000_000, { current: 10, power: 120, energy: 1 });
    appendEnergySample(builder, entries, 2_000_000, { current: 10, power: 120, energy: 2 });
    builder
      .double(entries.voltage, 1_000_000, 12)
      .double(entries.voltage, 1_400_000, 7)
      .double(entries.brownoutVoltage, 1_000_000, 6.3)
      .boolean(entries.brownedOut, 1_000_000, false)
      .boolean(entries.brownedOut, 1_400_000, true)
      .boolean(entries.brownedOut, 1_500_000, false)
      .boolean(entries.enabled, 1_000_000, false)
      .boolean(entries.enabled, 1_200_000, true)
      .boolean(entries.enabled, 2_000_000, false)
      .boolean(entries.autonomous, 1_000_000, false)
      .boolean(entries.autonomous, 1_200_000, true)
      .boolean(entries.autonomous, 1_600_000, false)
      .boolean(entries.test, 1_000_000, false)
      .int64(entries.matchType, 1_000_000, 1);

    const result = await analyzeWpiLog(builder.build());

    expect(result.range.totals.minVoltageV).toBe(7);
    expect(result.range.totals.brownoutCount).toBe(1);
    expect(result.range.totals.brownoutDurationSeconds).toBeCloseTo(0.1);
    expect(result.range.totals.enabledDurationSeconds).toBeCloseTo(0.8);
    expect(result.range.totals.effectiveDurationSeconds).toBeCloseTo(0.8);
    expect(result.dataset.segments.modes.map((segment) => segment.mode)).toEqual([
      "disabled",
      "autonomous",
      "teleop",
    ]);
    expect(result.dataset.segments.modes.every((segment) => segment.isPractice)).toBe(true);
    expect(Array.from(result.dataset.series.matchType?.values ?? [])).toEqual([1n]);
  });

  it("excludes disabled intervals from total and subsystem average power", async () => {
    const { builder, entries } = buildEnergyFixture({ includeOptionals: true });
    appendEnergySample(builder, entries, 1_000_000, { current: 10, power: 100, energy: 0 });
    appendEnergySample(builder, entries, 2_000_000, { current: 10, power: 100, energy: 2 });
    appendEnergySample(builder, entries, 3_000_000, { current: 10, power: 100, energy: 3 });
    appendEnergySample(builder, entries, 4_000_000, { current: 10, power: 100, energy: 1 });
    appendEnergySample(builder, entries, 5_000_000, { current: 10, power: 100, energy: 5 });
    appendEnergySample(builder, entries, 6_000_000, { current: 10, power: 100, energy: 9 });
    appendEnergySample(builder, entries, 7_000_000, { current: 10, power: 100, energy: 10 });
    builder
      .boolean(entries.enabled, 1_000_000, true)
      .boolean(entries.enabled, 3_000_000, false)
      .boolean(entries.enabled, 5_000_000, true)
      .boolean(entries.enabled, 7_000_000, false);

    const result = await analyzeWpiLog(builder.build());

    expect(result.range.totals).toMatchObject({
      energyWh: 12,
      averagePowerW: 7_200,
      enabledDurationSeconds: 4,
      effectiveDurationSeconds: 4,
    });
    expect(result.range.subsystems[0]).toMatchObject({
      energyWh: 12,
      averagePowerW: 7_200,
    });

    const clipped = analyzeEnergyRange(result.dataset, {
      startUs: 1_500_000,
      endUs: 6_500_000,
    });
    expect(clipped.totals).toMatchObject({
      energyWh: 11,
      averagePowerW: 8_400,
      enabledDurationSeconds: 3,
      effectiveDurationSeconds: 3,
    });
    expect(clipped.subsystems[0]).toMatchObject({
      energyWh: 11,
      averagePowerW: 8_400,
    });
  });

  it("reports zero average power when Enabled exists but the selection is all disabled", async () => {
    const { builder, entries } = buildEnergyFixture({ includeOptionals: true });
    appendEnergySample(builder, entries, 1_000_000, { current: 10, power: 100, energy: 0 });
    appendEnergySample(builder, entries, 3_000_000, { current: 10, power: 100, energy: 8 });
    builder.boolean(entries.enabled, 1_000_000, false);

    const result = await analyzeWpiLog(builder.build());

    expect(result.range.totals).toMatchObject({
      energyWh: 8,
      averagePowerW: 0,
      enabledDurationSeconds: 0,
      effectiveDurationSeconds: 0,
    });
    expect(result.range.subsystems[0]).toMatchObject({
      energyWh: 8,
      averagePowerW: 0,
    });
  });

  it("falls back to the complete selection when Enabled is unavailable", async () => {
    const { builder, entries } = buildEnergyFixture();
    appendEnergySample(builder, entries, 1_000_000, { current: 10, power: 100, energy: 0 });
    appendEnergySample(builder, entries, 3_000_000, { current: 10, power: 100, energy: 8 });

    const result = await analyzeWpiLog(builder.build());

    expect(result.range.totals).toMatchObject({
      energyWh: 8,
      averagePowerW: 14_400,
      enabledDurationSeconds: 0,
      effectiveDurationSeconds: 2,
    });
    expect(result.range.subsystems[0]).toMatchObject({
      energyWh: 8,
      averagePowerW: 14_400,
    });
  });

  it("derives test mode and preserves MatchType boundaries", async () => {
    const { builder, entries } = buildEnergyFixture({ includeOptionals: true });
    appendEnergySample(builder, entries, 1_000_000, { current: 10, power: 120, energy: 1 });
    appendEnergySample(builder, entries, 4_000_000, { current: 10, power: 120, energy: 4 });
    builder
      .boolean(entries.enabled, 1_000_000, true)
      .boolean(entries.autonomous, 1_000_000, false)
      .boolean(entries.test, 1_000_000, false)
      .int64(entries.matchType, 1_000_000, 0)
      .int64(entries.matchType, 1_250_000, 0)
      .int64(entries.matchType, 1_500_000, 3)
      .boolean(entries.test, 2_000_000, true)
      .boolean(entries.test, 2_500_000, false)
      .int64(entries.matchType, 3_000_000, 1);

    const dataset = await parseEnergyLog(builder.build());

    expect(Array.from(dataset.series.matchType?.values ?? [])).toEqual([0n, 0n, 3n, 1n]);
    expect(
      dataset.segments.modes.map(({ mode, isPractice, startUs, endUs }) => ({
        mode,
        isPractice,
        startUs,
        endUs,
      })),
    ).toEqual([
      { mode: "teleop", isPractice: false, startUs: 1_000_000, endUs: 1_500_000 },
      { mode: "teleop", isPractice: false, startUs: 1_500_000, endUs: 2_000_000 },
      { mode: "test", isPractice: false, startUs: 2_000_000, endUs: 2_500_000 },
      { mode: "teleop", isPractice: false, startUs: 2_500_000, endUs: 3_000_000 },
      { mode: "teleop", isPractice: true, startUs: 3_000_000, endUs: 4_000_000 },
    ]);
  });

  it("does not fabricate mode intervals when Enabled is missing", async () => {
    const { builder, entries } = buildEnergyFixture();
    appendEnergySample(builder, entries, 1_000_000, { current: 10, power: 120, energy: 1 });
    appendEnergySample(builder, entries, 2_000_000, { current: 10, power: 120, energy: 2 });
    const namespace = "/UnknownTeam/RealOutputs/DriverStation";
    const autonomous = builder.start(`${namespace}/Autonomous`, "boolean");
    const test = builder.start(`${namespace}/Test`, "boolean");
    builder.boolean(autonomous, 1_000_000, true).boolean(test, 1_000_000, false);

    const dataset = await parseEnergyLog(builder.build());

    expect(dataset.series.enabled).toBeUndefined();
    expect(dataset.segments.modes).toEqual([]);
  });

  it("keeps enabled mode generic when Autonomous or Test is unknown", async () => {
    const { builder, entries } = buildEnergyFixture();
    appendEnergySample(builder, entries, 1_000_000, { current: 10, power: 120, energy: 1 });
    appendEnergySample(builder, entries, 2_000_000, { current: 10, power: 120, energy: 2 });
    const namespace = "/UnknownTeam/RealOutputs/DriverStation";
    const enabled = builder.start(`${namespace}/Enabled`, "boolean");
    const autonomous = builder.start(`${namespace}/Autonomous`, "boolean");
    builder.boolean(enabled, 1_000_000, true).boolean(autonomous, 1_000_000, false);

    const dataset = await parseEnergyLog(builder.build());

    expect(dataset.segments.modes).toEqual([
      {
        mode: "enabled",
        isPractice: false,
        startUs: 1_000_000,
        endUs: 2_000_000,
        durationSeconds: 1,
      },
    ]);
  });

  it("recovers an incomplete final record only after a valid contract", async () => {
    const { builder, entries } = buildEnergyFixture();
    appendEnergySample(builder, entries, 1_000_000, { current: 10, power: 100, energy: 1 });
    appendEnergySample(builder, entries, 2_000_000, { current: 20, power: 200, energy: 2 });
    const unrelated = builder.start("/Unrelated/Pose", "raw");
    builder.raw(unrelated, 2_100_000, new Uint8Array(20).fill(7));
    const complete = builder.build();
    const truncated = complete.slice(0, -3);

    const dataset = await parseEnergyLog(truncated);

    expect(dataset.file.truncatedTail).toMatchObject({
      entryId: unrelated,
      declaredPayloadLength: 20,
      availablePayloadLength: 17,
      missingBytes: 3,
    });
    expect(
      dataset.quality.issues.some((issue) => issue.code === "TRUNCATED_TAIL_RECOVERED"),
    ).toBe(true);
  });

  it("rejects two same-priority EnergyLogger roots", async () => {
    const { builder, entries } = buildEnergyFixture({
      root: "/A/RealOutputs/energyLogger",
    });
    appendEnergySample(builder, entries, 1_000_000, { current: 1, power: 1, energy: 1 });
    const secondRoot = "/B/RealOutputs/energyLogger";
    for (const total of ["totalCurrent", "totalPower", "totalEnergy"]) {
      const entry = builder.start(`${secondRoot}/${total}`, "double");
      builder.double(entry, 1_000_000, 1);
    }

    await expect(parseEnergyLog(builder.build())).rejects.toSatisfy((error: unknown) =>
      errorHasCode(error, "AMBIGUOUS_ENERGY_ROOT"),
    );
  });

  it("preserves RealOutputs priority when a legacy real root coexists with a valid v2 replay root", async () => {
    const fixture = buildEnergyV2Fixture("/Team9999/ReplayOutputs/energyLogger");
    appendEnergyV2FixtureSample(fixture, 1_000_000, { drive: "AUTO", indexer: "IDLE" }, 1);
    appendEnergyV2FixtureSample(fixture, 2_000_000, { drive: "AUTO", indexer: "SCORE" }, 2);

    const realRoot = "/Team9999/RealOutputs/energyLogger";
    const realEntries = {
      totalCurrent: fixture.builder.start(`${realRoot}/totalCurrent`, "double"),
      totalPower: fixture.builder.start(`${realRoot}/totalPower`, "double"),
      totalEnergy: fixture.builder.start(`${realRoot}/totalEnergy`, "double"),
      current: fixture.builder.start(`${realRoot}/current/legacy`, "double"),
      power: fixture.builder.start(`${realRoot}/power/legacy`, "double"),
      energy: fixture.builder.start(`${realRoot}/energy/legacy`, "double"),
    };
    appendEnergySample(fixture.builder, realEntries, 1_000_000, {
      current: 1,
      power: 12,
      energy: 0,
    });
    appendEnergySample(fixture.builder, realEntries, 2_000_000, {
      current: 1,
      power: 12,
      energy: 1,
    });

    const dataset = await parseEnergyLog(fixture.builder.build());

    expect(dataset.root).toBe("/Team9999/RealOutputs/energyLogger");
    expect(dataset.sourceContract).toBe("v1");
    expect(dataset.v2).toBeUndefined();
    expect(dataset.quality.issues.some((issue) => issue.code === "SIM_OR_REPLAY_LOG")).toBe(false);
  });

  it("rejects normalized path collisions", async () => {
    const { builder, entries } = buildEnergyFixture({ rawPath: "arm-left" });
    appendEnergySample(builder, entries, 1_000_000, { current: 1, power: 1, energy: 1 });
    const root = "/UnknownTeam/RealOutputs/energyLogger";
    for (const family of ["current", "power", "energy"] as const) {
      const entry = builder.start(`${root}/${family}/arm/left`, "double");
      builder.double(entry, 1_000_000, 1);
    }

    await expect(parseEnergyLog(builder.build())).rejects.toSatisfy((error: unknown) =>
      errorHasCode(error, "PATH_NORMALIZATION_COLLISION"),
    );
  });

  it("rejects a trailing-slash path that collides with its canonical path", async () => {
    const { builder, entries } = buildEnergyFixture({ rawPath: "swerve/" });
    appendEnergySample(builder, entries, 1_000_000, { current: 1, power: 1, energy: 1 });
    const root = "/UnknownTeam/RealOutputs/energyLogger";
    for (const family of ["current", "power", "energy"] as const) {
      const entry = builder.start(`${root}/${family}/swerve`, "double");
      builder.double(entry, 1_000_000, 1);
    }

    await expect(parseEnergyLog(builder.build())).rejects.toSatisfy((error: unknown) =>
      errorHasCode(error, "PATH_NORMALIZATION_COLLISION"),
    );
  });

  it("rejects logs without all three EnergyLogger totals", async () => {
    const builder = new WpiLogFixtureBuilder();
    const root = "/Mystery/RealOutputs/energyLogger";
    const current = builder.start(`${root}/totalCurrent`, "double");
    const power = builder.start(`${root}/totalPower`, "double");
    builder.double(current, 1, 1).double(power, 1, 10);

    await expect(parseEnergyLog(builder.build())).rejects.toSatisfy((error: unknown) =>
      errorHasCode(error, "MISSING_ENERGY_TOTALS"),
    );
  });

  it("rejects a required EnergyLogger entry declared with the wrong type", async () => {
    const builder = new WpiLogFixtureBuilder();
    const root = "/Mystery/RealOutputs/energyLogger";
    const totalCurrent = builder.start(`${root}/totalCurrent`, "float");
    const totalPower = builder.start(`${root}/totalPower`, "double");
    const totalEnergy = builder.start(`${root}/totalEnergy`, "double");
    const current = builder.start(`${root}/current/unknown`, "double");
    const power = builder.start(`${root}/power/unknown`, "double");
    const energy = builder.start(`${root}/energy/unknown`, "double");
    builder
      .raw(totalCurrent, 1, new Uint8Array(4))
      .double(totalPower, 1, 1)
      .double(totalEnergy, 1, 1)
      .double(current, 1, 1)
      .double(power, 1, 1)
      .double(energy, 1, 1);

    await expect(parseEnergyLog(builder.build())).rejects.toSatisfy((error: unknown) =>
      errorHasCode(error, "ENERGY_TYPE_MISMATCH"),
    );
  });
});
