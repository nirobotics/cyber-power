import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  analyzeEnergyRange,
  analyzeEnergyLoggerV2Range,
  deriveEnergyLoggerV2MotorGroupElectricalSeries,
  estimateSupplyCurrentLimits,
  parseEnergyLog,
} from "../app/features/log-analysis/core/index";

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const fixturePath = resolve(
  process.argv[2] ?? "vendordep/build/generated-fixtures/cyber-power-v2.wpilog",
);
const bytes = await readFile(fixturePath);
const dataset = await parseEnergyLog(bytes);

invariant(dataset.sourceContract === "v2", "fixture did not select the EnergyLogger 2.4 parser");
invariant(dataset.v2, "fixture has no validated EnergyLogger 2.4 dataset");
invariant(dataset.v2.contract.contractVersion === "2.4", "contractVersion is not exactly 2.4");
invariant(dataset.robotCurrentSource === "robot-total", "fixture did not select robot total current");
invariant(dataset.v2.robotTotalSupplyCurrentAmps, "fixture has no robot total current series");
invariant(Object.keys(dataset.v2.contract.manifest).join(",") === "subsystems", "manifest has extra top-level fields");
invariant(dataset.v2.subsystems.length > 0, "manifest contains no subsystems");

for (const [subsystemIndex, subsystem] of dataset.v2.subsystems.entries()) {
  const manifestSubsystem = dataset.v2.contract.manifest.subsystems[subsystemIndex];
  invariant(
    Object.keys(manifestSubsystem).sort().join(",") === "motors,name",
    `${subsystem.id} manifest has extra fields`,
  );
  invariant(
    subsystem.motorSamples.width === subsystem.motors.length * 3,
    `${subsystem.id} packed width does not equal motorCount * 3`,
  );
  for (const [motorIndex, motor] of subsystem.motors.entries()) {
    invariant(
      Object.keys(motor).sort().join(",") === "analysisReduction,leader,name,type",
      `${subsystem.id}/${motor.name} descriptor has extra fields`,
    );
    const supplyOnly = motor.type === null;
    invariant(
      supplyOnly === (motor.analysisReduction === null),
      `${subsystem.id}/${motor.name} type and analysisReduction nullability differ`,
    );
    if (!supplyOnly) {
      invariant(
        Number.isFinite(motor.analysisReduction) && motor.analysisReduction! > 0,
        `${subsystem.id}/${motor.name} analysisReduction is invalid`,
      );
    }
    if (motor.leader === null && !supplyOnly) continue;
    for (let row = 0; row < subsystem.motorSamples.timestampsUs.length; row += 1) {
      const offset = row * subsystem.motorSamples.width + motorIndex * 3;
      invariant(
        Number.isNaN(subsystem.motorSamples.values[offset + 1]) &&
          Number.isNaN(subsystem.motorSamples.values[offset + 2]),
        `${subsystem.id}/${motor.name} follower or supply-only motor must contain NaN Stator/rotor slots`,
      );
    }
  }
}

const batteryVoltageV = dataset.series.batteryVoltageV;
invariant(batteryVoltageV, "derived dataset has no battery voltage series");
for (let index = 0; index < dataset.series.totalPowerW.values.length; index += 1) {
  const expected =
    dataset.series.totalCurrentA.values[index] * batteryVoltageV.values[index];
  invariant(
    Math.abs(dataset.series.totalPowerW.values[index] - expected) < 1e-9,
    `derived robot power mismatch at row ${index}`,
  );
}

const advanced = analyzeEnergyLoggerV2Range(dataset);
invariant(advanced, "fixture did not produce EnergyLogger 2.4 advanced analysis");
invariant(
  advanced.subsystems.every((subsystem) => subsystem.states.length > 0),
  "fixture did not produce per-state power statistics",
);
invariant(
  advanced.subsystems.every((subsystem) => subsystem.motorGroups.length > 0),
  "fixture did not produce leader groups",
);
const supplyOnlyGroup = advanced.subsystems
  .flatMap((subsystem) => subsystem.motorGroups)
  .find((group) => !group.analysisAvailable);
invariant(
  supplyOnlyGroup?.unavailableReason === "SUPPLY_ONLY",
  "fixture supply-only group did not disable advanced analysis",
);
const supplyOnlyElectrical = deriveEnergyLoggerV2MotorGroupElectricalSeries(dataset)?.find(
  (group) => group.id === supplyOnlyGroup.id,
);
invariant(supplyOnlyElectrical, "fixture supply-only group has no electrical series");
const limitEstimate = estimateSupplyCurrentLimits(dataset, {
  limits: [{ motorGroupId: supplyOnlyGroup.id, limitA: 5 }],
});
invariant(
  limitEstimate.targets[0]?.motorType === null,
  "fixture supply-only group was not accepted by limit replay",
);
invariant(
  analyzeEnergyRange(dataset).quality.reconciliation.withinTolerance,
  "independently clocked V2 subsystem series produced a false reconciliation warning",
);

console.log(
  `verified ${fixturePath}: ${dataset.v2.subsystems.length} subsystems, ` +
    `${dataset.v2.subsystems.reduce((sum, subsystem) => sum + subsystem.motors.length, 0)} motors`,
);
