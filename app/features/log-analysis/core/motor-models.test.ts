import { describe, expect, it } from "vitest";
import {
  MOTOR_COVERAGE_STATUS,
  MOTOR_MODELS,
  VOLTAGE_HEADROOM_PENALTY_W,
  analyzeMotorTelemetry,
  analyzeMotorTelemetryDiagnostics,
  recommendGearRatio,
  type MotorTelemetrySeries,
} from "./motor-models";

const RPS_TO_RADIANS_PER_SECOND = Math.PI * 2;

function telemetry(length = 101): MotorTelemetrySeries {
  return {
    timestampsUs: Float64Array.from({ length }, (_, index) => index * 20_000),
    supplyCurrentA: Float64Array.from({ length }, () => 30),
    batteryVoltageV: Float64Array.from({ length }, () => 12),
    statorCurrentA: Float64Array.from({ length }, () => 20),
    rotorVelocityRadPerSec: Float64Array.from(
      { length },
      () => 10 * RPS_TO_RADIANS_PER_SECOND,
    ),
  };
}

describe("minimal motor analysis", () => {
  it("matches the supplied CTRE Kraken curve endpoints and affine motor constants", () => {
    const expected = {
      KRAKEN_X44: {
        stallTorqueNm: 4.113357107,
        stallCurrentA: 279.0986925,
        freeCurrentA: 3.156052589044805,
        freeSpeedRpm: 7757.6047386285445,
        resistanceOhm: 0.0429955435925,
        torqueConstantNmPerA: 0.014906565757,
        velocityConstantRadPerSecPerVolt: 68.4721566483,
      },
      KRAKEN_X44_FOC: {
        stallTorqueNm: 5.011141122,
        stallCurrentA: 329.1879392,
        freeCurrentA: 3.2314624715135096,
        freeSpeedRpm: 7367.553144197232,
        resistanceOhm: 0.0364533403902,
        torqueConstantNmPerA: 0.0153736510233,
        velocityConstantRadPerSecPerVolt: 64.9314272903,
      },
      KRAKEN_X60: {
        stallTorqueNm: 7.157265551,
        stallCurrentA: 374.3825832,
        freeCurrentA: 2.8343270852023466,
        freeSpeedRpm: 6065.328680453382,
        resistanceOhm: 0.0320527731216,
        torqueConstantNmPerA: 0.0192633539068,
        velocityConstantRadPerSecPerVolt: 53.3337500799,
      },
      KRAKEN_X60_FOC: {
        stallTorqueNm: 9.361526464,
        stallCurrentA: 476.0982479,
        freeCurrentA: 3.4958424205207166,
        freeSpeedRpm: 5784.648111182809,
        resistanceOhm: 0.0252048816666,
        torqueConstantNmPerA: 0.0198084613101,
        velocityConstantRadPerSecPerVolt: 50.853982898,
      },
    } as const;

    for (const [type, values] of Object.entries(expected)) {
      const model = MOTOR_MODELS[type as keyof typeof expected];
      expect(model.stallTorqueNm).toBe(values.stallTorqueNm);
      expect(model.stallCurrentA).toBe(values.stallCurrentA);
      expect(model.freeCurrentA).toBe(values.freeCurrentA);
      expect(model.freeSpeedRpm).toBe(values.freeSpeedRpm);
      expect(model.resistanceOhm).toBeCloseTo(values.resistanceOhm, 12);
      expect(model.torqueConstantNmPerA).toBeCloseTo(
        values.torqueConstantNmPerA,
        12,
      );
      expect(model.velocityConstantRadPerSecPerVolt).toBeCloseTo(
        values.velocityConstantRadPerSecPerVolt,
        10,
      );
      expect(
        model.torqueConstantNmPerA * (model.stallCurrentA - model.freeCurrentA),
      ).toBeCloseTo(model.stallTorqueNm, 12);
      expect(
        model.resistanceOhm * model.freeCurrentA +
          model.freeSpeedRadPerSec / model.velocityConstantRadPerSecPerVolt,
      ).toBeCloseTo(model.nominalVoltageV, 12);
    }
  });

  it("provides built-in models only for known MotorType values", () => {
    expect(MOTOR_MODELS.KRAKEN_X60_FOC.stallCurrentA).toBeGreaterThan(0);
    expect(analyzeMotorTelemetry("unknown", telemetry())).toEqual({
      available: false,
      reason: "UNKNOWN_MOTOR_TYPE",
    });
  });

  it("estimates positive-drive efficiency from group Supply and leader Stator/rotor", () => {
    const result = analyzeMotorTelemetry("NEO", telemetry(), 2);
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.motorCount).toBe(2);
    expect(result.metrics.batteryConsumedEnergyWh).toBeCloseTo(0.2, 6);
    expect(result.metrics.estimatedDriveEfficiency).toBeGreaterThan(0);
    expect(result.metrics.estimatedDriveEfficiency).toBeLessThan(1);
    expect(result.quality.coverageFraction).toBe(1);
  });

  it("uses rotor velocity as radians per second exactly once in mechanical power", () => {
    const model = MOTOR_MODELS.NEO;
    const rotorVelocityRadPerSec = 20;
    const statorCurrentA = 10;
    const result = analyzeMotorTelemetry("NEO", {
      timestampsUs: Float64Array.from([0, 1_000_000]),
      supplyCurrentA: Float64Array.from([30, 30]),
      batteryVoltageV: Float64Array.from([12, 12]),
      statorCurrentA: Float64Array.from([statorCurrentA, statorCurrentA]),
      rotorVelocityRadPerSec: Float64Array.from([
        rotorVelocityRadPerSec,
        rotorVelocityRadPerSec,
      ]),
    });

    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.metrics.estimatedMechanicalEnergyWh).toBeCloseTo(
      (
        model.torqueConstantNmPerA *
        (statorCurrentA - model.freeCurrentA) *
        rotorVelocityRadPerSec
      ) / 3600,
      12,
    );
  });

  it("produces zero shaft power at the fitted no-load current and free-speed endpoint", () => {
    const model = MOTOR_MODELS.KRAKEN_X60;
    const result = analyzeMotorTelemetry("KRAKEN_X60", {
      timestampsUs: Float64Array.from([0, 1_000_000]),
      supplyCurrentA: Float64Array.from([model.freeCurrentA, model.freeCurrentA]),
      batteryVoltageV: Float64Array.from([12, 12]),
      statorCurrentA: Float64Array.from([model.freeCurrentA, model.freeCurrentA]),
      rotorVelocityRadPerSec: Float64Array.from([
        model.freeSpeedRadPerSec,
        model.freeSpeedRadPerSec,
      ]),
    });

    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.metrics.estimatedMechanicalEnergyWh).toBe(0);
    expect(result.metrics.estimatedDriveEfficiency).toBe(0);
    expect(result.metrics.estimatedCopperLossWh).toBeGreaterThan(0);
  });

  it("reproduces the supplied CTRE curve peak-efficiency working points", () => {
    const workingPoints = [
      ["KRAKEN_X44", 7000, 30.104506220000047, 81.51271398012919],
      ["KRAKEN_X44_FOC", 6700, 32.765456546999985, 81.02240921433084],
      ["KRAKEN_X60", 5600, 31.33930494399999, 85.62461864358849],
      ["KRAKEN_X60_FOC", 5300, 43.091312836999975, 84.18404012430128],
    ] as const;

    for (const [type, rpm, currentA, efficiencyPercent] of workingPoints) {
      const speedRadPerSec = (rpm / 60) * RPS_TO_RADIANS_PER_SECOND;
      const result = analyzeMotorTelemetry(type, {
        timestampsUs: Float64Array.from([0, 1_000_000]),
        supplyCurrentA: Float64Array.from([currentA, currentA]),
        batteryVoltageV: Float64Array.from([12, 12]),
        statorCurrentA: Float64Array.from([currentA, currentA]),
        rotorVelocityRadPerSec: Float64Array.from([speedRadPerSec, speedRadPerSec]),
      });

      expect(result.available).toBe(true);
      if (!result.available) continue;
      expect(result.metrics.estimatedDriveEfficiency).toBeCloseTo(
        efficiencyPercent / 100,
        12,
      );
    }
  });

  it("does not claim an efficiency when the logged working point is physically impossible", () => {
    const source = telemetry(3);
    const impossible = {
      ...source,
      supplyCurrentA: Float64Array.from([1, 1, 1]),
      statorCurrentA: Float64Array.from([100, 100, 100]),
      rotorVelocityRadPerSec: Float64Array.from(
        [80, 80, 80],
        (value) => value * RPS_TO_RADIANS_PER_SECOND,
      ),
    };
    expect(analyzeMotorTelemetry("NEO", impossible, 2)).toEqual({
      available: false,
      reason: "NO_VALID_INTERVALS",
    });
  });

  it("accepts exact component-power boundaries without clamping efficiency", () => {
    const boundaryModel = {
      ...MOTOR_MODELS.NEO,
      freeCurrentA: 0,
      resistanceOhm: 1,
      torqueConstantNmPerA: 1,
    };
    const mechanicalBoundary = analyzeMotorTelemetry(boundaryModel, {
      timestampsUs: Float64Array.of(0, 1_000_000),
      supplyCurrentA: Float64Array.of(1, 1),
      batteryVoltageV: Float64Array.of(10, 10),
      statorCurrentA: Float64Array.of(1, 1),
      rotorVelocityRadPerSec: Float64Array.of(10, 10),
    });
    const copperBoundary = analyzeMotorTelemetry(boundaryModel, {
      timestampsUs: Float64Array.of(0, 1_000_000),
      supplyCurrentA: Float64Array.of(1, 1),
      batteryVoltageV: Float64Array.of(1, 1),
      statorCurrentA: Float64Array.of(1, 1),
      rotorVelocityRadPerSec: Float64Array.of(0, 0),
    });

    expect(mechanicalBoundary.available).toBe(true);
    if (mechanicalBoundary.available) {
      expect(mechanicalBoundary.metrics.estimatedDriveEfficiency).toBe(1);
    }
    expect(copperBoundary.available).toBe(true);
    if (copperBoundary.available) {
      expect(copperBoundary.metrics.estimatedCopperLossWh).toBe(
        copperBoundary.metrics.batteryConsumedEnergyWh,
      );
    }
  });

  it("rejects either mechanical power or copper loss above battery input inside the tolerance band", () => {
    const boundaryModel = {
      ...MOTOR_MODELS.NEO,
      freeCurrentA: 0,
      resistanceOhm: 1,
      torqueConstantNmPerA: 1,
    };
    const cases = [
      {
        supplyCurrentA: Float64Array.of(1, 1),
        batteryVoltageV: Float64Array.of(10, 10),
        statorCurrentA: Float64Array.of(1, 1),
        rotorVelocityRadPerSec: Float64Array.of(10.001, 10.001),
      },
      {
        supplyCurrentA: Float64Array.of(1, 1),
        batteryVoltageV: Float64Array.of(1, 1),
        statorCurrentA: Float64Array.of(1.001, 1.001),
        rotorVelocityRadPerSec: Float64Array.of(0, 0),
      },
    ];

    for (const signals of cases) {
      const result = analyzeMotorTelemetryDiagnostics(boundaryModel, {
        timestampsUs: Float64Array.of(0, 1_000_000),
        ...signals,
      });
      expect(result.efficiency).toEqual({
        available: false,
        reason: "NO_VALID_INTERVALS",
      });
      expect(Array.from(result.coverage?.statusCodes ?? [])).toEqual([
        MOTOR_COVERAGE_STATUS.PHYSICALLY_IMPOSSIBLE,
      ]);
    }
  });

  it("computes coverage from interval duration and run-length encodes status changes", () => {
    const source: MotorTelemetrySeries = {
      timestampsUs: Float64Array.from([0, 1_000_000, 10_000_000]),
      supplyCurrentA: Float64Array.from([30, 30, 30]),
      batteryVoltageV: Float64Array.from([12, 12, 12]),
      statorCurrentA: Float64Array.from([20, 0, 20]),
      rotorVelocityRadPerSec: Float64Array.from([20, 20, 20]),
    };

    const result = analyzeMotorTelemetryDiagnostics("NEO", source);
    expect(result.efficiency.available).toBe(true);
    expect(result.coverage).not.toBeNull();
    expect(Array.from(result.coverage!.boundariesUs)).toEqual([0, 1_000_000, 10_000_000]);
    expect(Array.from(result.coverage!.statusCodes)).toEqual([
      MOTOR_COVERAGE_STATUS.VALID,
      MOTOR_COVERAGE_STATUS.ZERO_STATOR_CURRENT,
    ]);
    expect(result.coverage!.totalDurationSeconds).toBe(10);
    expect(result.coverage!.validDurationSeconds).toBe(1);
    expect(result.coverage!.coverageFraction).toBeCloseTo(0.1, 12);
    expect(
      result.coverage!.durationSecondsByStatus[MOTOR_COVERAGE_STATUS.ZERO_STATOR_CURRENT],
    ).toBe(9);
    if (result.efficiency.available) {
      expect(result.efficiency.quality.coverageFraction).toBe(
        result.coverage!.coverageFraction,
      );
      expect(result.efficiency.metrics.durationSeconds).toBe(
        result.coverage!.validDurationSeconds,
      );
    }
  });

  it("classifies missing, invalid, regenerative, zero, negative-supply, and impossible intervals", () => {
    const seconds = Array.from({ length: 8 }, (_, index) => index * 1_000_000);
    const result = analyzeMotorTelemetryDiagnostics("NEO", {
      timestampsUs: Float64Array.from(seconds),
      supplyCurrentA: Float64Array.from([30, 30, 30, 30, -5, 1, 30, 30]),
      batteryVoltageV: Float64Array.from([12, 0, 12, 12, 12, 12, 12, 12]),
      statorCurrentA: Float64Array.from([20, 20, -20, 0, 20, 100, 20, 20]),
      rotorVelocityRadPerSec: Float64Array.from([
        Number.NaN,
        20,
        20,
        20,
        20,
        500,
        20,
        20,
      ]),
    });

    expect(Array.from(result.coverage!.statusCodes)).toEqual([
      MOTOR_COVERAGE_STATUS.NONFINITE_SIGNAL,
      MOTOR_COVERAGE_STATUS.INVALID_BATTERY_VOLTAGE,
      MOTOR_COVERAGE_STATUS.REGENERATIVE_STATOR_CURRENT,
      MOTOR_COVERAGE_STATUS.ZERO_STATOR_CURRENT,
      MOTOR_COVERAGE_STATUS.NONPOSITIVE_SUPPLY_CURRENT,
      MOTOR_COVERAGE_STATUS.PHYSICALLY_IMPOSSIBLE,
      MOTOR_COVERAGE_STATUS.VALID,
    ]);
    expect(result.coverage!.coverageFraction).toBeCloseTo(1 / 7, 12);
    expect(
      result.coverage!.durationSecondsByStatus[
        MOTOR_COVERAGE_STATUS.REGENERATIVE_STATOR_CURRENT
      ],
    ).toBe(1);
    expect(
      result.coverage!.durationSecondsByStatus[MOTOR_COVERAGE_STATUS.PHYSICALLY_IMPOSSIBLE],
    ).toBe(1);
  });

  it("keeps a usable zero-percent coverage timeline when efficiency is unavailable", () => {
    const result = analyzeMotorTelemetryDiagnostics("NEO", {
      ...telemetry(3),
      statorCurrentA: Float64Array.from([0, 0, 0]),
    });

    expect(result.efficiency).toEqual({ available: false, reason: "NO_VALID_INTERVALS" });
    expect(result.coverage).not.toBeNull();
    expect(result.coverage!.coverageFraction).toBe(0);
    expect(result.coverage!.totalDurationSeconds).toBeCloseTo(0.04, 12);
    expect(Array.from(result.coverage!.statusCodes)).toEqual([
      MOTOR_COVERAGE_STATUS.ZERO_STATOR_CURRENT,
    ]);
    expect(Array.from(result.coverage!.boundariesUs)).toEqual([0, 40_000]);
  });

  it("rejects working points whose mechanical power plus copper loss exceeds battery input", () => {
    const source = telemetry(3);
    const impossible = {
      ...source,
      supplyCurrentA: Float64Array.from([30, 30, 30]),
      statorCurrentA: Float64Array.from([90, 90, 90]),
      rotorVelocityRadPerSec: Float64Array.from(
        [13, 13, 13],
        (value) => value * RPS_TO_RADIANS_PER_SECOND,
      ),
    };
    expect(analyzeMotorTelemetry("NEO", impossible, 2)).toEqual({
      available: false,
      reason: "NO_VALID_INTERVALS",
    });

    expect(
      recommendGearRatio({
        motorType: "NEO",
        currentRatio: 6.75,
        motorCount: 2,
        telemetry: impossible,
        stateIds: Int32Array.from([0, 0, 1]),
      }),
    ).toMatchObject({ available: false });
  });

  it("recommends one explicit ratio using state-labelled active samples", () => {
    const result = recommendGearRatio({
      motorType: "NEO",
      currentRatio: 6.75,
      motorCount: 2,
      telemetry: telemetry(),
      stateIds: Int32Array.from({ length: 101 }, (_, index) => (index < 50 ? 0 : 1)),
    });
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.recommendedRatio).toBeGreaterThanOrEqual(6.75 * 0.5);
    expect(result.recommendedRatio).toBeLessThanOrEqual(6.75 * 2);
    expect(result.observedStateCount).toBe(2);
    expect(VOLTAGE_HEADROOM_PENALTY_W).toBe(25);
    expect(result.limitations).toContain(
      "电压余量评分使用 25 W 经验权重；它不是电机物理常数，也不代表额外能耗。",
    );
    expect(result.limitations).toContain(
      "空载电流 I0 按常量近似；未建模随转速变化的铁耗、风阻等电机损耗，因此不保证总输入能耗下降。",
    );
  });

  it("keeps the exact identity candidate in the 61-point ratio grid", () => {
    const length = 10;
    const result = recommendGearRatio({
      motorType: "NEO",
      currentRatio: 6.75,
      telemetry: {
        timestampsUs: Float64Array.from({ length }, (_, index) => index * 1_000_000),
        supplyCurrentA: Float64Array.from({ length }, () => 2),
        batteryVoltageV: Float64Array.from({ length }, () => 12),
        statorCurrentA: Float64Array.from({ length }, () => 2.25),
        rotorVelocityRadPerSec: Float64Array.from({ length }, () => 122),
      },
      stateIds: Int32Array.from({ length }, () => 0),
    });

    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.recommendedRatio).toBe(6.75);
    expect(result.currentCopperLossWh).toBeCloseTo(result.recommendedCopperLossWh, 12);
    expect(result.estimatedCopperReductionWh).toBeCloseTo(0, 12);
  });

  it("can select both ratio endpoints and never scales total current below I0", () => {
    const length = 10;
    const ratio = 6.75;
    const stateIds = Int32Array.from({ length }, () => 0);
    const highLoad = recommendGearRatio({
      motorType: "NEO",
      currentRatio: ratio,
      telemetry: {
        timestampsUs: Float64Array.from({ length }, (_, index) => index * 1_000_000),
        supplyCurrentA: Float64Array.from({ length }, () => 30),
        batteryVoltageV: Float64Array.from({ length }, () => 12),
        statorCurrentA: Float64Array.from({ length }, () => 20),
        rotorVelocityRadPerSec: Float64Array.from({ length }, () => 10),
      },
      stateIds,
    });
    const highSpeed = recommendGearRatio({
      motorType: "NEO",
      currentRatio: ratio,
      telemetry: {
        timestampsUs: Float64Array.from({ length }, (_, index) => index * 1_000_000),
        supplyCurrentA: Float64Array.from({ length }, () => 30),
        batteryVoltageV: Float64Array.from({ length }, () => 12),
        statorCurrentA: Float64Array.from({ length }, () => 2),
        rotorVelocityRadPerSec: Float64Array.from({ length }, () => 300),
      },
      stateIds,
    });

    expect(highLoad.available).toBe(true);
    expect(highSpeed.available).toBe(true);
    if (!highLoad.available || !highSpeed.available) return;
    expect(highLoad.recommendedRatio).toBeCloseTo(ratio * 2, 12);
    expect(highSpeed.recommendedRatio).toBeCloseTo(ratio * 0.5, 12);

    const model = MOTOR_MODELS.NEO;
    const candidateCurrentA = model.freeCurrentA + (20 - model.freeCurrentA) / 2;
    const expectedCopperLossWh =
      (candidateCurrentA * candidateCurrentA * model.resistanceOhm * 9) / 3600;
    const noLoadCopperFloorWh =
      (model.freeCurrentA * model.freeCurrentA * model.resistanceOhm * 9) / 3600;
    expect(highLoad.recommendedCopperLossWh).toBeCloseTo(expectedCopperLossWh, 12);
    expect(highLoad.recommendedCopperLossWh).toBeGreaterThan(noLoadCopperFloorWh);

    expect(highSpeed.recommendedCopperLossWh).toBeGreaterThan(
      highSpeed.currentCopperLossWh,
    );
    expect(highSpeed.estimatedCopperReductionWh).toBeLessThan(0);
    expect(highSpeed.reductionShareOfMeasuredInput).toBeLessThan(0);
  });

  it("uses exactly the same eligible intervals for all recommendation Wh metrics", () => {
    const length = 11;
    const model = MOTOR_MODELS.NEO;
    const statorCurrentA = Float64Array.from({ length }, () => 20);
    statorCurrentA[9] = model.freeCurrentA;
    const stateIds = Int32Array.from({ length }, () => 0);
    stateIds[8] = -1;
    const result = recommendGearRatio({
      motorType: "NEO",
      currentRatio: 6.75,
      motorCount: 2,
      telemetry: {
        timestampsUs: Float64Array.from({ length }, (_, index) => index * 1_000_000),
        supplyCurrentA: Float64Array.from({ length }, () => 30),
        batteryVoltageV: Float64Array.from({ length }, () => 12),
        statorCurrentA,
        rotorVelocityRadPerSec: Float64Array.from({ length }, () => 20),
      },
      stateIds,
    });

    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.activeSampleCount).toBe(8);
    expect(result.activeDurationSeconds).toBe(8);
    expect(result.measuredGroupInputEnergyWh).toBeCloseTo((12 * 30 * 8) / 3600, 12);
    expect(result.currentCopperLossWh).toBeCloseTo(
      (2 * 20 * 20 * model.resistanceOhm * 8) / 3600,
      12,
    );
    expect(result.currentCopperLossWh - result.recommendedCopperLossWh).toBeCloseTo(
      result.estimatedCopperReductionWh,
      12,
    );
    expect(
      result.estimatedCopperReductionWh / result.measuredGroupInputEnergyWh,
    ).toBeCloseTo(result.reductionShareOfMeasuredInput, 12);
  });

  it("uses every eligible interval beyond 4096 samples without stride-phase aliasing", () => {
    const length = 8_193;
    const source = telemetry(length);
    const activeIntervalCount = 2_731;
    const result = recommendGearRatio({
      motorType: "NEO",
      currentRatio: 6.75,
      telemetry: {
        ...source,
        statorCurrentA: Float64Array.from(
          { length },
          (_, index) => index % 3 === 1 ? 20 : 0,
        ),
      },
      stateIds: Int32Array.from({ length }, (_, index) => index < 4_096 ? 0 : 1),
    });

    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.activeSampleCount).toBe(activeIntervalCount);
    expect(result.activeDurationSeconds).toBeCloseTo(activeIntervalCount * 0.02, 10);
    expect(result.observedStateCount).toBe(2);
  });

  it("weights nonuniform working points by their actual interval duration", () => {
    const buildWeightedTelemetry = (
      highTorqueDurationUs: number,
      highSpeedDurationUs: number,
    ): MotorTelemetrySeries => {
      const length = 9;
      const timestampsUs = new Float64Array(length);
      const statorCurrentA = new Float64Array(length);
      const rotorVelocityRadPerSec = new Float64Array(length);
      for (let index = 0; index < length; index += 1) {
        const highTorque = index % 2 === 0;
        statorCurrentA[index] = highTorque ? 40 : 5;
        rotorVelocityRadPerSec[index] = highTorque ? 20 : 500;
        if (index + 1 < length) {
          timestampsUs[index + 1] = timestampsUs[index] +
            (highTorque ? highTorqueDurationUs : highSpeedDurationUs);
        }
      }
      return {
        timestampsUs,
        supplyCurrentA: Float64Array.from({ length }, () => 30),
        batteryVoltageV: Float64Array.from({ length }, () => 12),
        statorCurrentA,
        rotorVelocityRadPerSec,
      };
    };
    const stateIds = Int32Array.from({ length: 9 }, () => 0);
    const highTorqueWeighted = recommendGearRatio({
      motorType: "NEO",
      currentRatio: 6.75,
      telemetry: buildWeightedTelemetry(1_000_000, 20_000),
      stateIds,
    });
    const highSpeedWeighted = recommendGearRatio({
      motorType: "NEO",
      currentRatio: 6.75,
      telemetry: buildWeightedTelemetry(20_000, 1_000_000),
      stateIds,
    });

    expect(highTorqueWeighted.available).toBe(true);
    expect(highSpeedWeighted.available).toBe(true);
    if (!highTorqueWeighted.available || !highSpeedWeighted.available) return;
    expect(highTorqueWeighted.activeDurationSeconds).toBeCloseTo(4.08, 12);
    expect(highSpeedWeighted.activeDurationSeconds).toBeCloseTo(4.08, 12);
    expect(highTorqueWeighted.recommendedRatio).toBeGreaterThan(
      highSpeedWeighted.recommendedRatio,
    );
  });

  it("compares estimated copper loss with the observed current ratio even when it is infeasible", () => {
    const length = 10;
    const result = recommendGearRatio({
      motorType: "NEO",
      currentRatio: 6.75,
      telemetry: {
        timestampsUs: Float64Array.from({ length }, (_, index) => index * 1_000_000),
        supplyCurrentA: Float64Array.from({ length }, () => 130),
        batteryVoltageV: Float64Array.from({ length }, () => 12),
        statorCurrentA: Float64Array.from({ length }, () => 110),
        rotorVelocityRadPerSec: Float64Array.from({ length }, () => 10),
      },
      stateIds: Int32Array.from({ length }, () => 0),
    });

    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.recommendedRatio).toBeCloseTo(6.75 * 2, 12);
    expect(result.currentCopperLossWh).toBeGreaterThan(result.recommendedCopperLossWh);
    expect(result.estimatedCopperReductionWh).toBeCloseTo(
      result.currentCopperLossWh - result.recommendedCopperLossWh,
      12,
    );
    expect(result.reductionShareOfMeasuredInput).toBeCloseTo(
      result.estimatedCopperReductionWh / result.measuredGroupInputEnergyWh,
      12,
    );
  });

  it("requires Stator Current to be strictly above the motor free-current threshold", () => {
    const length = 16;
    const stateIds = Int32Array.from({ length }, () => 0);
    const exactThreshold = recommendGearRatio({
      motorType: "NEO",
      currentRatio: 6.75,
      telemetry: {
        ...telemetry(length),
        statorCurrentA: Float64Array.from(
          { length },
          () => MOTOR_MODELS.NEO.freeCurrentA,
        ),
      },
      stateIds,
    });
    const aboveThreshold = recommendGearRatio({
      motorType: "NEO",
      currentRatio: 6.75,
      telemetry: {
        ...telemetry(length),
        statorCurrentA: Float64Array.from(
          { length },
          () => MOTOR_MODELS.NEO.freeCurrentA + 0.01,
        ),
      },
      stateIds,
    });

    expect(exactThreshold).toMatchObject({
      available: false,
      reason: "INSUFFICIENT_ACTIVE_DATA",
    });
    expect(aboveThreshold.available).toBe(true);
  });

  it("treats equal forward and reverse positive-drive speeds symmetrically", () => {
    const forwardTelemetry = telemetry();
    const reverseTelemetry = {
      ...forwardTelemetry,
      rotorVelocityRadPerSec: Float64Array.from(
        forwardTelemetry.rotorVelocityRadPerSec,
        (value) => -value,
      ),
    };
    const stateIds = Int32Array.from({ length: 101 }, (_, index) => (index < 50 ? 0 : 1));
    const forward = recommendGearRatio({
      motorType: "NEO",
      currentRatio: 6.75,
      motorCount: 2,
      telemetry: forwardTelemetry,
      stateIds,
    });
    const reverse = recommendGearRatio({
      motorType: "NEO",
      currentRatio: 6.75,
      motorCount: 2,
      telemetry: reverseTelemetry,
      stateIds,
    });

    expect(forward.available).toBe(true);
    expect(reverse.available).toBe(true);
    expect(reverse).toEqual(forward);
  });

  it("requires state-labelled active data for ratio recommendations", () => {
    const result = recommendGearRatio({
      motorType: "NEO",
      currentRatio: 6.75,
      telemetry: telemetry(),
      stateIds: Int32Array.from({ length: 101 }, () => -1),
    });
    expect(result).toMatchObject({ available: false, reason: "MISSING_STATE_DISTRIBUTION" });
  });

  it("does not build a recommendation from regenerative Stator Current", () => {
    const length = 16;
    const result = recommendGearRatio({
      motorType: "NEO",
      currentRatio: 6.75,
      telemetry: {
        ...telemetry(length),
        statorCurrentA: Float64Array.from({ length }, () => -20),
      },
      stateIds: Int32Array.from({ length }, () => 0),
    });

    expect(result).toMatchObject({
      available: false,
      reason: "INSUFFICIENT_ACTIVE_DATA",
    });
  });
});
