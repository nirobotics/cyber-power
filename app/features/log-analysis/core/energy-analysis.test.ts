import { describe, expect, it } from "vitest";

import {
  appendEnergySample,
  buildEnergyFixture,
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
      peakCurrentA: 20,
    });
    expect(
      result.dataset.quality.issues.filter((issue) => issue.code === "OPTIONAL_SERIES_MISSING"),
    ).toHaveLength(6);
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
    appendEnergySample(builder, entries, 3_000_000, { current: 30, power: 300, energy: 3 });
    const dataset = await parseEnergyLog(builder.build());

    const range = analyzeEnergyRange(dataset, { startUs: 1_500_000, endUs: 2_500_000 });

    expect(range.totals.peakPowerW).toBe(100);
    expect(range.totals.peakCurrentA).toBe(10);
    expect(range.totals.energyWh).toBe(0);
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
      .boolean(entries.teleop, 1_000_000, false)
      .boolean(entries.teleop, 1_600_000, true)
      .boolean(entries.teleop, 2_000_000, false);

    const result = await analyzeWpiLog(builder.build());

    expect(result.range.totals.minVoltageV).toBe(7);
    expect(result.range.totals.brownoutCount).toBe(1);
    expect(result.range.totals.brownoutDurationSeconds).toBeCloseTo(0.1);
    expect(result.range.totals.enabledDurationSeconds).toBeCloseTo(0.8);
    expect(result.dataset.segments.modes.map((segment) => segment.mode)).toEqual([
      "disabled",
      "autonomous",
      "teleop",
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
