import { describe, expect, it } from "vitest";
import {
  appendEnergySample,
  appendEnergyV2FixtureSample,
  buildEnergyFixture,
  buildEnergyV2Fixture,
} from "../../../../tests/fixtures/wpilog-builder";
import { LogAnalysisError } from "./errors";
import { analyzeEnergyRange, parseEnergyLog } from "./energy-analysis";

function hasCode(error: unknown, code: string): boolean {
  return error instanceof LogAnalysisError && error.issues.some((issue) => issue.code === code);
}

describe("fixed EnergyLogger V2 parser", () => {
  it("parses a V2-only log and reconstructs canonical electrical series", async () => {
    const fixture = buildEnergyV2Fixture();
    appendEnergyV2FixtureSample(fixture, 1_000_000, { drive: "IDLE", indexer: "IDLE" }, 0);
    appendEnergyV2FixtureSample(fixture, 2_000_000, { drive: "DRIVE", indexer: "FEED" }, 1);

    const dataset = await parseEnergyLog(fixture.builder.build());

    expect(dataset.sourceContract).toBe("v2");
    expect(dataset.robotCurrentSource).toBe("registered-motors");
    expect(dataset.v2?.robotCurrentSource).toBe("registered-motors");
    expect(dataset.v2?.contract.contractVersion).toBe("2.2");
    expect(dataset.v2?.subsystems[0].motorSamples.width).toBe(6);
    expect(dataset.v2?.subsystems[0].motorSamples.values).toEqual(
      Float64Array.from([
        12,
        20,
        10 * Math.PI * 2,
        8,
        Number.NaN,
        Number.NaN,
        12,
        20,
        10 * Math.PI * 2,
        8,
        Number.NaN,
        Number.NaN,
      ]),
    );
    expect(dataset.series.totalCurrentA.values).toEqual(Float64Array.from([25, 25]));
    expect(dataset.series.totalPowerW.values).toEqual(Float64Array.from([300, 300]));
    expect(dataset.series.totalEnergyWh.values.at(-1)).toBeCloseTo(300 / 3600, 8);
    expect(dataset.subsystems.map((node) => node.id)).toEqual(["drive", "indexer"]);
  });

  it("uses the optional V2.4 whole-robot current for the canonical series", async () => {
    const fixture = buildEnergyV2Fixture(
      "/Team9999/TotalOutputs/energyLogger",
      "2.4",
      { includeTotalSupplyCurrent: true },
    );
    appendEnergyV2FixtureSample(
      fixture,
      1_000_000,
      { drive: "DRIVE", indexer: "IDLE" },
      0,
      { robotCurrentA: 25, robotTotalCurrentA: 40 },
    );
    appendEnergyV2FixtureSample(
      fixture,
      2_000_000,
      { drive: "DRIVE", indexer: "IDLE" },
      0,
      { robotCurrentA: 25, robotTotalCurrentA: Number.NaN },
    );

    const dataset = await parseEnergyLog(fixture.builder.build());
    expect(dataset.robotCurrentSource).toBe("robot-total");
    expect(dataset.v2?.robotCurrentSource).toBe("robot-total");
    expect(dataset.v2?.robotSupplyCurrentAmps.values).toEqual(Float64Array.from([25, 25]));
    expect(dataset.v2?.robotTotalSupplyCurrentAmps?.values).toEqual(
      Float64Array.from([40, Number.NaN]),
    );
    expect(dataset.series.totalCurrentA.values).toEqual(Float64Array.from([40, Number.NaN]));
  });

  it("keeps V2.4 supply-only motors in the fixed packed transport", async () => {
    const fixture = buildEnergyV2Fixture(
      "/Team9999/SupplyOnlyOutputs/energyLogger",
      "2.4",
      { supplyOnlyIndexer: true },
    );
    appendEnergyV2FixtureSample(fixture, 1_000_000, { drive: "DRIVE", indexer: "FEED" }, 0);
    appendEnergyV2FixtureSample(fixture, 2_000_000, { drive: "DRIVE", indexer: "FEED" }, 0);

    const dataset = await parseEnergyLog(fixture.builder.build());
    expect(dataset.v2?.subsystems[1].motors[0]).toMatchObject({
      type: null,
      analysisReduction: null,
    });
    expect(dataset.v2?.subsystems[1].motorSamples.values).toEqual(
      Float64Array.from([5, Number.NaN, Number.NaN, 5, Number.NaN, Number.NaN]),
    );
    expect(dataset.subsystems.find((node) => node.id === "indexer")?.currentA.values).toEqual(
      Float64Array.from([5, 5]),
    );
  });

  it("normalizes 2.1 RPS and keeps native 2.2/2.3 rad/s equivalent", async () => {
    const legacy = buildEnergyV2Fixture(
      "/Team9999/LegacyOutputs/energyLogger",
      "2.1",
    );
    const current = buildEnergyV2Fixture(
      "/Team9999/CurrentOutputs/energyLogger",
      "2.2",
    );
    const signed = buildEnergyV2Fixture(
      "/Team9999/SignedOutputs/energyLogger",
      "2.3",
    );
    for (const fixture of [legacy, current, signed]) {
      appendEnergyV2FixtureSample(fixture, 1_000_000, { drive: "DRIVE", indexer: "IDLE" }, 0);
      appendEnergyV2FixtureSample(fixture, 2_000_000, { drive: "DRIVE", indexer: "IDLE" }, 1);
    }

    const legacyDataset = await parseEnergyLog(legacy.builder.build());
    const currentDataset = await parseEnergyLog(current.builder.build());
    const signedDataset = await parseEnergyLog(signed.builder.build());
    expect(legacyDataset.v2?.contract.contractVersion).toBe("2.1");
    expect(currentDataset.v2?.contract.contractVersion).toBe("2.2");
    expect(signedDataset.v2?.contract.contractVersion).toBe("2.3");
    expect(legacyDataset.v2?.subsystems[0].motorSamples.values).toEqual(
      currentDataset.v2?.subsystems[0].motorSamples.values,
    );
    expect(signedDataset.v2?.subsystems[0].motorSamples.values).toEqual(
      currentDataset.v2?.subsystems[0].motorSamples.values,
    );
    expect(legacyDataset.v2?.subsystems[0].motorSamples.values[2]).toBeCloseTo(
      10 * Math.PI * 2,
      12,
    );
  });

  it("preserves negative V2.3 Stator Current in the canonical packed timeline", async () => {
    const fixture = buildEnergyV2Fixture(
      "/Team9999/SignedOutputs/energyLogger",
      "2.3",
    );
    appendEnergyV2FixtureSample(
      fixture,
      1_000_000,
      { drive: "BRAKING", indexer: "IDLE" },
      0,
      { driveStatorCurrentA: -20 },
    );
    appendEnergyV2FixtureSample(
      fixture,
      2_000_000,
      { drive: "DRIVE", indexer: "IDLE" },
      1,
      { driveStatorCurrentA: 20 },
    );

    const dataset = await parseEnergyLog(fixture.builder.build());
    const values = dataset.v2?.subsystems[0].motorSamples.values;
    expect(values?.[1]).toBe(-20);
    expect(values?.[7]).toBe(20);
  });

  it("rejects packed rows whose width differs from motorCount * 3", async () => {
    const fixture = buildEnergyV2Fixture();
    appendEnergyV2FixtureSample(fixture, 1_000_000, { drive: "DRIVE", indexer: "IDLE" }, 0);
    appendEnergyV2FixtureSample(fixture, 2_000_000, { drive: "DRIVE", indexer: "IDLE" }, 1);
    fixture.builder.doubleArray(fixture.entries["s0.samples"], 2_100_000, [1, 2, 3]);

    await expect(parseEnergyLog(fixture.builder.build())).rejects.toSatisfy((error: unknown) =>
      hasCode(error, "V2_PACKED_WIDTH_MISMATCH"),
    );
  });

  it("requires every manifest subsystem entry to contain data", async () => {
    const fixture = buildEnergyV2Fixture();
    const { builder, entries } = fixture;
    for (const timestampUs of [1_000_000, 2_000_000]) {
      builder
        .int64(entries.robotTimestamp, timestampUs, timestampUs)
        .double(entries.robotCurrent, timestampUs, 20)
        .double(entries.robotVoltage, timestampUs, 12)
        .int64(entries["s0.sampleTimestampUs"], timestampUs, timestampUs)
        .string(entries["s0.state"], timestampUs, "DRIVE")
        .doubleArray(entries["s0.samples"], timestampUs, [12, 20, 10, 8, Number.NaN, Number.NaN]);
    }

    await expect(parseEnergyLog(builder.build())).rejects.toSatisfy((error: unknown) =>
      hasCode(error, "V2_ENTRY_MISSING"),
    );
  });

  it("requires follower Stator and rotor slots to be exactly NaN", async () => {
    const fixture = buildEnergyV2Fixture();
    appendEnergyV2FixtureSample(fixture, 1_000_000, { drive: "DRIVE", indexer: "IDLE" }, 0);
    appendEnergyV2FixtureSample(fixture, 2_000_000, { drive: "DRIVE", indexer: "IDLE" }, 1);
    fixture.builder.doubleArray(
      fixture.entries["s0.samples"],
      1_500_000,
      [12, 20, 10, 8, Number.POSITIVE_INFINITY, Number.NaN],
    );

    await expect(parseEnergyLog(fixture.builder.build())).rejects.toSatisfy((error: unknown) =>
      hasCode(error, "V2_FOLLOWER_SLOT_INVALID"),
    );
  });

  it("keeps finite robot intervals around a temporary unavailable electrical interval", async () => {
    const fixture = buildEnergyV2Fixture();
    appendEnergyV2FixtureSample(fixture, 1_000_000, { drive: "DRIVE", indexer: "IDLE" }, 0);
    fixture.builder
      .double(fixture.entries.robotCurrent, 1_500_000, Number.NaN)
      .int64(fixture.entries.robotTimestamp, 1_500_000, 1_500_000);
    appendEnergyV2FixtureSample(
      fixture,
      2_000_000,
      { drive: "DRIVE", indexer: "IDLE" },
      1,
      { robotCurrentA: 30, robotVoltageV: 11 },
    );
    appendEnergyV2FixtureSample(
      fixture,
      2_500_000,
      { drive: "DRIVE", indexer: "IDLE" },
      2,
      { robotCurrentA: 30, robotVoltageV: 11 },
    );

    const dataset = await parseEnergyLog(fixture.builder.build());

    expect(dataset.series.totalCurrentA.values).toEqual(
      Float64Array.from([25, Number.NaN, 30, 30]),
    );
    expect(dataset.series.totalPowerW.values).toEqual(
      Float64Array.from([300, Number.NaN, 330, 330]),
    );
    expect(dataset.series.batteryVoltageV?.values).toEqual(
      Float64Array.from([12, 12, 11, 11]),
    );
    expect(dataset.series.totalEnergyWh.values).toEqual(
      Float64Array.from([
        0,
        300 / 3600 / 2,
        300 / 3600 / 2,
        300 / 3600 / 2 + 330 / 3600 / 2,
      ]),
    );
    expect(dataset.quality.issues).toContainEqual(
      expect.objectContaining({
        code: "NONFINITE_VALUE_DROPPED",
        severity: "warning",
        details: { droppedNonfiniteSamples: 1 },
      }),
    );
    expect(
      analyzeEnergyRange(dataset, { startUs: 1_500_000, endUs: 2_000_000 }).totals,
    ).toMatchObject({
      peakPowerW: 330,
      peakPowerTimestampUs: 2_000_000,
      peakCurrentA: 30,
      peakCurrentTimestampUs: 2_000_000,
      minVoltageV: 11,
    });
    expect(
      analyzeEnergyRange(dataset, { startUs: 1_600_000, endUs: 1_900_000 }).totals,
    ).toMatchObject({
      peakPowerW: Number.NaN,
      peakCurrentA: Number.NaN,
      minVoltageV: 12,
    });
  });

  it("rejects a robot timeline with no finite electrical interval", async () => {
    const fixture = buildEnergyV2Fixture();
    appendEnergyV2FixtureSample(
      fixture,
      1_000_000,
      { drive: "DRIVE", indexer: "IDLE" },
      0,
      { robotCurrentA: Number.NaN },
    );
    appendEnergyV2FixtureSample(
      fixture,
      2_000_000,
      { drive: "DRIVE", indexer: "IDLE" },
      1,
      { robotCurrentA: Number.NaN },
    );

    await expect(parseEnergyLog(fixture.builder.build())).rejects.toSatisfy((error: unknown) =>
      hasCode(error, "NO_FINITE_ENERGY_DATA"),
    );
  });

  it("keeps historical v1 logs on the unchanged parser path", async () => {
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
    expect(dataset.sourceContract).toBe("v1");
    expect(dataset.v2).toBeUndefined();
  });
});
