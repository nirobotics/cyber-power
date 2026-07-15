import { describe, expect, it } from "vitest";
import {
  appendEnergySample,
  appendEnergyV2FixtureSample,
  buildEnergyFixture,
  buildEnergyV2Fixture,
} from "../../../../tests/fixtures/wpilog-builder";
import { parseEnergyLog } from "./energy-analysis";
import { MOTOR_COVERAGE_STATUS } from "./motor-models";
import { analyzeEnergyLoggerV2Range, deriveEnergyLoggerV2Core } from "./v2-metrics";

describe("minimal EnergyLogger V2 metrics", () => {
  it("aggregates subsystem energy by subsystem state", async () => {
    const fixture = buildEnergyV2Fixture();
    appendEnergyV2FixtureSample(fixture, 1_000_000, { drive: "IDLE", indexer: "IDLE" }, 0);
    appendEnergyV2FixtureSample(fixture, 2_000_000, { drive: "DRIVE", indexer: "IDLE" }, 1);
    appendEnergyV2FixtureSample(fixture, 3_000_000, { drive: "DRIVE", indexer: "FEED" }, 2);
    const dataset = await parseEnergyLog(fixture.builder.build());

    const analysis = analyzeEnergyLoggerV2Range(dataset);
    const drive = analysis?.subsystems.find((subsystem) => subsystem.name === "drive");
    expect(drive?.states.map((state) => state.state).sort()).toEqual(["DRIVE", "IDLE"]);
    expect(drive?.states.find((state) => state.state === "IDLE")?.durationSeconds).toBe(1);
    expect(drive?.states.find((state) => state.state === "IDLE")?.energyWh).toBeCloseTo(
      240 / 3600,
      8,
    );
  });

  it("analyzes one homogeneous group per leader and never invents follower rotor data", async () => {
    const fixture = buildEnergyV2Fixture();
    for (let index = 0; index <= 100; index += 1) {
      appendEnergyV2FixtureSample(
        fixture,
        1_000_000 + index * 20_000,
        { drive: index < 50 ? "AUTO" : "TELEOP", indexer: "IDLE" },
        index,
      );
    }
    const dataset = await parseEnergyLog(fixture.builder.build());
    const analysis = analyzeEnergyLoggerV2Range(dataset);
    const group = analysis?.subsystems.find((subsystem) => subsystem.name === "drive")
      ?.motorGroups[0];

    expect(group).toMatchObject({
      leaderName: "frontLeft",
      motorNames: ["frontLeft", "frontRight"],
      motorCount: 2,
      analysisReduction: 6.75,
    });
    expect(group?.efficiency.available).toBe(true);
    expect(group?.gearRatio.available).toBe(true);
  });

  it("produces equivalent motor analysis for 2.1 RPS and 2.2 rad/s logs", async () => {
    const fixtures = [
      buildEnergyV2Fixture("/Team9999/LegacyOutputs/energyLogger", "2.1"),
      buildEnergyV2Fixture("/Team9999/CurrentOutputs/energyLogger", "2.2"),
    ];
    for (const fixture of fixtures) {
      for (let index = 0; index <= 100; index += 1) {
        appendEnergyV2FixtureSample(
          fixture,
          1_000_000 + index * 20_000,
          { drive: index < 50 ? "AUTO" : "TELEOP", indexer: "IDLE" },
          index,
        );
      }
    }

    const [legacyDataset, currentDataset] = await Promise.all(
      fixtures.map(async (fixture) => parseEnergyLog(fixture.builder.build())),
    );
    const legacyGroup = analyzeEnergyLoggerV2Range(legacyDataset)?.subsystems.find(
      (subsystem) => subsystem.name === "drive",
    )?.motorGroups[0];
    const currentGroup = analyzeEnergyLoggerV2Range(currentDataset)?.subsystems.find(
      (subsystem) => subsystem.name === "drive",
    )?.motorGroups[0];

    expect(legacyGroup).toEqual(currentGroup);
  });

  it("keeps V2.3 regenerative Stator samples but excludes them from drive analysis", async () => {
    const fixture = buildEnergyV2Fixture(
      "/Team9999/SignedOutputs/energyLogger",
      "2.3",
    );
    for (let index = 0; index <= 100; index += 1) {
      appendEnergyV2FixtureSample(
        fixture,
        1_000_000 + index * 20_000,
        { drive: index < 50 ? "BRAKING" : "DRIVE", indexer: "IDLE" },
        index,
        { driveStatorCurrentA: index < 50 ? -20 : 20 },
      );
    }

    const dataset = await parseEnergyLog(fixture.builder.build());
    expect(dataset.v2?.subsystems[0].motorSamples.values[1]).toBe(-20);
    const group = analyzeEnergyLoggerV2Range(dataset)?.subsystems.find(
      (subsystem) => subsystem.name === "drive",
    )?.motorGroups[0];
    expect(group?.efficiency.available).toBe(true);
    if (group?.efficiency.available) {
      expect(group.efficiency.quality.validIntervalCount).toBe(50);
      expect(group.efficiency.quality.coverageFraction).toBeCloseTo(0.5, 12);
    }
    expect(group?.coverage.coverageFraction).toBeCloseTo(0.5, 12);
    expect(group?.coverage.durationSecondsByStatus[
      MOTOR_COVERAGE_STATUS.REGENERATIVE_STATOR_CURRENT
    ]).toBeCloseTo(1, 12);
    expect(group?.gearRatio.available).toBe(true);
    if (group?.gearRatio.available) {
      expect(group.gearRatio.activeSampleCount).toBe(50);
      expect(group.gearRatio.activeDurationSeconds).toBeCloseTo(1, 12);
    }
  });

  it("splits motor coverage at asynchronous Battery Voltage events and exact range edges", async () => {
    const fixture = buildEnergyV2Fixture();
    const { builder, entries } = fixture;
    const driveSamples = [12, 20, 10 * Math.PI * 2, 8, Number.NaN, Number.NaN];
    const indexerSamples = [5, 8, 5 * Math.PI * 2];
    builder
      .int64(entries.robotTimestamp, 1_000_000, 1_000_000)
      .double(entries.robotCurrent, 1_000_000, 25)
      .double(entries.robotVoltage, 1_000_000, 12)
      .int64(entries["s0.sampleTimestampUs"], 1_000_000, 1_000_000)
      .string(entries["s0.state"], 1_000_000, "DRIVE")
      .doubleArray(entries["s0.samples"], 1_000_000, driveSamples)
      .int64(entries["s1.sampleTimestampUs"], 1_000_000, 1_000_000)
      .string(entries["s1.state"], 1_000_000, "IDLE")
      .doubleArray(entries["s1.samples"], 1_000_000, indexerSamples)
      .int64(entries.robotTimestamp, 2_000_000, 2_000_000)
      .double(entries.robotCurrent, 2_000_000, 25)
      .double(entries.robotVoltage, 2_000_000, 1)
      .int64(entries.robotTimestamp, 3_000_000, 3_000_000)
      .double(entries.robotCurrent, 3_000_000, 25)
      .double(entries.robotVoltage, 3_000_000, 12)
      .int64(entries["s0.sampleTimestampUs"], 3_000_000, 3_000_000)
      .string(entries["s0.state"], 3_000_000, "DRIVE")
      .doubleArray(entries["s0.samples"], 3_000_000, driveSamples)
      .int64(entries["s1.sampleTimestampUs"], 3_000_000, 3_000_000)
      .string(entries["s1.state"], 3_000_000, "IDLE")
      .doubleArray(entries["s1.samples"], 3_000_000, indexerSamples);

    const dataset = await parseEnergyLog(builder.build());
    const group = analyzeEnergyLoggerV2Range(dataset, {
      startUs: 1_250_000,
      endUs: 2_750_000,
    })?.subsystems.find((subsystem) => subsystem.name === "drive")?.motorGroups[0];

    expect(group).toBeDefined();
    expect(Array.from(group!.coverage.boundariesUs)).toEqual([
      1_250_000,
      2_000_000,
      2_750_000,
    ]);
    expect(Array.from(group!.coverage.statusCodes)).toEqual([
      MOTOR_COVERAGE_STATUS.VALID,
      MOTOR_COVERAGE_STATUS.PHYSICALLY_IMPOSSIBLE,
    ]);
    expect(group!.coverage.totalDurationSeconds).toBeCloseTo(1.5, 12);
    expect(group!.coverage.validDurationSeconds).toBeCloseTo(0.75, 12);
    expect(group!.coverage.coverageFraction).toBeCloseTo(0.5, 12);
  });

  it("does not count expected follower Stator and rotor slots as missing", async () => {
    const fixture = buildEnergyV2Fixture();
    const { builder, entries } = fixture;
    builder
      .int64(entries.robotTimestamp, 1_000_000, 1_000_000)
      .double(entries.robotCurrent, 1_000_000, 25)
      .double(entries.robotVoltage, 1_000_000, 12)
      .int64(entries["s0.sampleTimestampUs"], 1_000_000, 1_000_000)
      .string(entries["s0.state"], 1_000_000, "IDLE")
      .int64(entries["s1.sampleTimestampUs"], 1_000_000, 1_000_000)
      .string(entries["s1.state"], 1_000_000, "IDLE")
      .doubleArray(entries["s1.samples"], 1_000_000, [5, 8, 5])
      .int64(entries.robotTimestamp, 2_000_000, 2_000_000)
      .double(entries.robotCurrent, 2_000_000, 25)
      .double(entries.robotVoltage, 2_000_000, 12)
      .int64(entries["s0.sampleTimestampUs"], 2_000_000, 2_000_000)
      .string(entries["s0.state"], 2_000_000, "DRIVE")
      .doubleArray(entries["s0.samples"], 2_000_000, [12, 20, 10, 8, Number.NaN, Number.NaN])
      .int64(entries["s1.sampleTimestampUs"], 2_000_000, 2_000_000)
      .doubleArray(entries["s1.samples"], 2_000_000, [5, 8, 5]);

    const dataset = await parseEnergyLog(builder.build());
    expect(dataset.v2).toBeDefined();
    expect(deriveEnergyLoggerV2Core(dataset.v2!).droppedNonfiniteSamples).toBe(4);
  });

  it("marks the whole leader group nonfinite when a follower Supply Current is NaN", async () => {
    const fixture = buildEnergyV2Fixture(
      "/Team9999/DisconnectedOutputs/energyLogger",
      "2.3",
    );
    const { builder, entries } = fixture;
    for (const timestampUs of [1_000_000, 2_000_000]) {
      builder
        .int64(entries.robotTimestamp, timestampUs, timestampUs)
        .double(entries.robotCurrent, timestampUs, 12)
        .double(entries.robotVoltage, timestampUs, 12)
        .int64(entries["s0.sampleTimestampUs"], timestampUs, timestampUs)
        .string(entries["s0.state"], timestampUs, "DRIVE")
        .doubleArray(entries["s0.samples"], timestampUs, [
          12,
          20,
          10 * Math.PI * 2,
          Number.NaN,
          Number.NaN,
          Number.NaN,
        ])
        .int64(entries["s1.sampleTimestampUs"], timestampUs, timestampUs)
        .string(entries["s1.state"], timestampUs, "IDLE")
        .doubleArray(entries["s1.samples"], timestampUs, [5, 8, 5 * Math.PI * 2]);
    }

    const dataset = await parseEnergyLog(builder.build());
    const group = analyzeEnergyLoggerV2Range(dataset)?.subsystems.find(
      (subsystem) => subsystem.name === "drive",
    )?.motorGroups[0];

    expect(group?.efficiency).toEqual({ available: false, reason: "NO_VALID_INTERVALS" });
    expect(group?.coverage.coverageFraction).toBe(0);
    expect(Array.from(group?.coverage.statusCodes ?? [])).toEqual([
      MOTOR_COVERAGE_STATUS.NONFINITE_SIGNAL,
    ]);
    expect(group?.coverage.durationSecondsByStatus[
      MOTOR_COVERAGE_STATUS.NONFINITE_SIGNAL
    ]).toBe(1);
  });

  it("does not expose advanced metrics for historical v1 logs", async () => {
    const fixture = buildEnergyFixture();
    appendEnergySample(fixture.builder, fixture.entries, 1_000_000, {
      current: 10,
      power: 120,
      energy: 0,
    });
    appendEnergySample(fixture.builder, fixture.entries, 2_000_000, {
      current: 10,
      power: 120,
      energy: 1,
    });
    const dataset = await parseEnergyLog(fixture.builder.build());
    expect(analyzeEnergyLoggerV2Range(dataset)).toBeUndefined();
  });
});
