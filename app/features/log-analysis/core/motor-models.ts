import {
  ENERGY_LOGGER_V2_MOTOR_TYPES,
  type EnergyLoggerV2MotorType,
} from "./v2-contract";

const TWO_PI = Math.PI * 2;

/**
 * Empirical power weight that converts the voltage-headroom time penalty to joules.
 * This is a scoring preference, not a motor constant or predicted energy consumption.
 */
export const VOLTAGE_HEADROOM_PENALTY_W = 25;

export const MOTOR_TYPES = ENERGY_LOGGER_V2_MOTOR_TYPES;
export type MotorType = EnergyLoggerV2MotorType;

export interface MotorModel {
  readonly type: MotorType;
  readonly nominalVoltageV: number;
  readonly stallTorqueNm: number;
  readonly stallCurrentA: number;
  /** Fitted no-load loss current I0 used by the affine shaft-torque model. */
  readonly freeCurrentA: number;
  readonly freeSpeedRpm: number;
  readonly freeSpeedRadPerSec: number;
  readonly resistanceOhm: number;
  /** Shaft torque per load-producing ampere, where load current is max(Is - I0, 0). */
  readonly torqueConstantNmPerA: number;
  readonly velocityConstantRadPerSecPerVolt: number;
}

type MotorSpecification = readonly [number, number, number, number, number];

// The four Kraken curves are the exact 12 V CTRE dyno regression endpoints supplied with the
// project. Other entries retain the WPILib DCMotor one-motor factory specifications.
const SPECIFICATIONS: Readonly<Record<MotorType, MotorSpecification>> = {
  CIM: [12, 2.42, 133, 2.7, 5310],
  VEX_775_PRO: [12, 0.71, 134, 0.7, 18730],
  NEO: [12, 2.6, 105, 1.8, 5676],
  MINI_CIM: [12, 1.41, 89, 3, 5840],
  BAG: [12, 0.43, 53, 1.8, 13180],
  ANDYMARK_RS775_125: [12, 0.28, 18, 1.6, 5800],
  BANEBOTS_RS775: [12, 0.72, 97, 2.7, 13050],
  ANDYMARK_9015: [12, 0.36, 71, 3.7, 14270],
  BANEBOTS_RS550: [12, 0.38, 84, 0.4, 19000],
  NEO_550: [12, 0.97, 100, 1.4, 11000],
  FALCON_500: [12, 4.69, 257, 1.5, 6380],
  FALCON_500_FOC: [12, 5.84, 304, 1.5, 6080],
  ROMI_BUILT_IN: [4.5, 0.1765, 1.25, 0.13, 150],
  KRAKEN_X60: [
    12,
    7.157265551,
    374.3825832,
    2.8343270852023466,
    6065.328680453382,
  ],
  KRAKEN_X60_FOC: [
    12,
    9.361526464,
    476.0982479,
    3.4958424205207166,
    5784.648111182809,
  ],
  KRAKEN_X44: [
    12,
    4.113357107,
    279.0986925,
    3.156052589044805,
    7757.6047386285445,
  ],
  KRAKEN_X44_FOC: [
    12,
    5.011141122,
    329.1879392,
    3.2314624715135096,
    7367.553144197232,
  ],
  MINION: [12, 3.17, 211, 2, 7704],
  NEO_VORTEX: [12, 3.6, 211, 3.6, 6784],
};

function buildMotorModel(type: MotorType): Readonly<MotorModel> {
  const [nominalVoltageV, stallTorqueNm, stallCurrentA, freeCurrentA, freeSpeedRpm] =
    SPECIFICATIONS[type];
  const freeSpeedRadPerSec = (freeSpeedRpm / 60) * TWO_PI;
  const resistanceOhm = nominalVoltageV / stallCurrentA;
  const loadCurrentAtStallA = stallCurrentA - freeCurrentA;
  return Object.freeze({
    type,
    nominalVoltageV,
    stallTorqueNm,
    stallCurrentA,
    freeCurrentA,
    freeSpeedRpm,
    freeSpeedRadPerSec,
    resistanceOhm,
    torqueConstantNmPerA: stallTorqueNm / loadCurrentAtStallA,
    velocityConstantRadPerSecPerVolt:
      freeSpeedRadPerSec / (nominalVoltageV - resistanceOhm * freeCurrentA),
  });
}

function loadProducingCurrentA(model: Readonly<MotorModel>, statorCurrentA: number): number {
  return Math.max(statorCurrentA - model.freeCurrentA, 0);
}

export const MOTOR_MODELS: Readonly<Record<MotorType, Readonly<MotorModel>>> = Object.freeze(
  Object.fromEntries(MOTOR_TYPES.map((type) => [type, buildMotorModel(type)])) as Record<
    MotorType,
    Readonly<MotorModel>
  >,
);

export function isMotorType(value: string): value is MotorType {
  return Object.hasOwn(MOTOR_MODELS, value);
}

export function getMotorModel(type: string): Readonly<MotorModel> | undefined {
  return isMotorType(type) ? MOTOR_MODELS[type] : undefined;
}

export type MotorModelSource = string | Readonly<MotorModel>;

export function resolveMotorModel(source: MotorModelSource): Readonly<MotorModel> | undefined {
  if (typeof source === "string") return getMotorModel(source);
  return source && isMotorType(source.type) ? source : undefined;
}

export interface MotorTelemetrySeries {
  readonly timestampsUs: ArrayLike<number>;
  /** Sum of physical motor Supply Current for this homogeneous leader group. */
  readonly supplyCurrentA: ArrayLike<number>;
  readonly batteryVoltageV: ArrayLike<number>;
  /**
   * Leader Stator Current. V2.1/V2.2 provide a magnitude; V2.3 may be negative during
   * regenerative braking. Followers intentionally have no Stator signal.
   */
  readonly statorCurrentA: ArrayLike<number>;
  /** Leader raw rotor velocity, before any controller feedback-ratio conversion. */
  readonly rotorVelocityRadPerSec: ArrayLike<number>;
}

export const MOTOR_COVERAGE_STATUS = Object.freeze({
  VALID: 0,
  NONFINITE_SIGNAL: 1,
  INVALID_BATTERY_VOLTAGE: 2,
  NONPOSITIVE_SUPPLY_CURRENT: 3,
  ZERO_STATOR_CURRENT: 4,
  REGENERATIVE_STATOR_CURRENT: 5,
  PHYSICALLY_IMPOSSIBLE: 6,
} as const);

export type MotorCoverageStatusCode =
  (typeof MOTOR_COVERAGE_STATUS)[keyof typeof MOTOR_COVERAGE_STATUS];

export const MOTOR_COVERAGE_STATUS_COUNT = 7;

/**
 * Run-length encoded interval eligibility for estimated drive efficiency.
 * `boundariesUs.length === statusCodes.length + 1` whenever at least one interval exists.
 * `durationSecondsByStatus` is indexed by `MOTOR_COVERAGE_STATUS`.
 */
export interface MotorCoverageTimeline {
  readonly boundariesUs: Float64Array;
  readonly statusCodes: Uint8Array;
  readonly durationSecondsByStatus: Float64Array;
  readonly totalDurationSeconds: number;
  readonly validDurationSeconds: number;
  readonly coverageFraction: number;
}

export type MotorAnalysisUnavailableReason =
  | "UNKNOWN_MOTOR_TYPE"
  | "EMPTY_SERIES"
  | "LENGTH_MISMATCH"
  | "NO_VALID_INTERVALS";

export interface MotorAnalysisQuality {
  readonly intervalCount: number;
  readonly validIntervalCount: number;
  readonly droppedIntervalCount: number;
  readonly physicallyImpossibleIntervalCount: number;
  readonly coverageFraction: number;
}

export interface MotorWorkingPointMetrics {
  readonly durationSeconds: number;
  readonly batteryConsumedEnergyWh: number;
  readonly estimatedMechanicalEnergyWh: number;
  readonly estimatedCopperLossWh: number;
  readonly estimatedDriveEfficiency: number | null;
  readonly averageRotorSpeedRadPerSec: number;
  readonly peakRotorSpeedRadPerSec: number;
  readonly averageLeaderStatorCurrentA: number;
  readonly peakLeaderStatorCurrentA: number;
}

export type MotorTelemetryAnalysis =
  | { readonly available: false; readonly reason: MotorAnalysisUnavailableReason }
  | {
      readonly available: true;
      readonly model: Readonly<MotorModel>;
      readonly motorCount: number;
      readonly metrics: MotorWorkingPointMetrics;
      readonly quality: MotorAnalysisQuality;
    };

export interface MotorTelemetryDiagnostics {
  readonly efficiency: MotorTelemetryAnalysis;
  /** Null only when the model or signal shape prevents interval classification. */
  readonly coverage: MotorCoverageTimeline | null;
}

function sameLength(series: MotorTelemetrySeries): boolean {
  const length = series.timestampsUs.length;
  return (
    series.supplyCurrentA.length === length &&
    series.batteryVoltageV.length === length &&
    series.statorCurrentA.length === length &&
    series.rotorVelocityRadPerSec.length === length
  );
}

interface PositiveDrivePowers {
  readonly batteryPowerW: number;
  readonly mechanicalPowerW: number;
  readonly copperLossPowerW: number;
}

function positiveDrivePowers(
  model: Readonly<MotorModel>,
  motorCount: number,
  batteryV: number,
  supplyA: number,
  statorA: number,
  speedRadPerSec: number,
): PositiveDrivePowers {
  const loadCurrentA = loadProducingCurrentA(model, statorA);
  return {
    batteryPowerW: batteryV * supplyA,
    mechanicalPowerW:
      motorCount * model.torqueConstantNmPerA * loadCurrentA * Math.abs(speedRadPerSec),
    copperLossPowerW: motorCount * statorA * statorA * model.resistanceOhm,
  };
}

function isPlausiblePositiveDrive(powers: PositiveDrivePowers): boolean {
  const motorInputPowerW = powers.mechanicalPowerW + powers.copperLossPowerW;
  return (
    Number.isFinite(powers.batteryPowerW) &&
    Number.isFinite(motorInputPowerW) &&
    powers.batteryPowerW > 0 &&
    powers.mechanicalPowerW >= 0 &&
    powers.copperLossPowerW >= 0 &&
    powers.mechanicalPowerW <= powers.batteryPowerW &&
    powers.copperLossPowerW <= powers.batteryPowerW &&
    motorInputPowerW <= powers.batteryPowerW * 1.1 + 1
  );
}

interface ClassifiedMotorInterval {
  readonly statusCode: MotorCoverageStatusCode;
  readonly powers: PositiveDrivePowers | null;
}

function classifyMotorInterval(
  model: Readonly<MotorModel>,
  motorCount: number,
  batteryV: number,
  supplyA: number,
  statorA: number,
  speedRadPerSec: number,
): ClassifiedMotorInterval {
  if (
    !Number.isFinite(batteryV) ||
    !Number.isFinite(supplyA) ||
    !Number.isFinite(statorA) ||
    !Number.isFinite(speedRadPerSec)
  ) {
    return { statusCode: MOTOR_COVERAGE_STATUS.NONFINITE_SIGNAL, powers: null };
  }
  if (batteryV <= 0) {
    return { statusCode: MOTOR_COVERAGE_STATUS.INVALID_BATTERY_VOLTAGE, powers: null };
  }
  if (statorA < 0) {
    return { statusCode: MOTOR_COVERAGE_STATUS.REGENERATIVE_STATOR_CURRENT, powers: null };
  }
  if (statorA === 0) {
    return { statusCode: MOTOR_COVERAGE_STATUS.ZERO_STATOR_CURRENT, powers: null };
  }
  if (supplyA <= 0) {
    return { statusCode: MOTOR_COVERAGE_STATUS.NONPOSITIVE_SUPPLY_CURRENT, powers: null };
  }
  const powers = positiveDrivePowers(
    model,
    motorCount,
    batteryV,
    supplyA,
    statorA,
    speedRadPerSec,
  );
  if (!isPlausiblePositiveDrive(powers)) {
    return { statusCode: MOTOR_COVERAGE_STATUS.PHYSICALLY_IMPOSSIBLE, powers };
  }
  return { statusCode: MOTOR_COVERAGE_STATUS.VALID, powers };
}

interface MotorTelemetryScan {
  readonly coverage: MotorCoverageTimeline;
  readonly intervalCount: number;
  readonly validIntervalCount: number;
  readonly physicallyImpossibleIntervalCount: number;
  readonly batteryEnergyJ: number;
  readonly mechanicalEnergyJ: number;
  readonly copperEnergyJ: number;
  readonly speedTime: number;
  readonly statorTime: number;
  readonly peakSpeed: number;
  readonly peakStator: number;
}

function emptyCoverage(boundaryUs?: number): MotorCoverageTimeline {
  return {
    boundariesUs: Number.isFinite(boundaryUs) ? Float64Array.of(boundaryUs!) : new Float64Array(),
    statusCodes: new Uint8Array(),
    durationSecondsByStatus: new Float64Array(MOTOR_COVERAGE_STATUS_COUNT),
    totalDurationSeconds: 0,
    validDurationSeconds: 0,
    coverageFraction: 0,
  };
}

function scanMotorTelemetry(
  model: Readonly<MotorModel>,
  series: MotorTelemetrySeries,
  motorCount: number,
): MotorTelemetryScan {
  const boundariesUs: number[] = [];
  const statusCodes: MotorCoverageStatusCode[] = [];
  const durationSecondsByStatus = new Float64Array(MOTOR_COVERAGE_STATUS_COUNT);
  let intervalCount = 0;
  let validIntervalCount = 0;
  let physicallyImpossibleIntervalCount = 0;
  let totalDurationSeconds = 0;
  let validDurationSeconds = 0;
  let batteryEnergyJ = 0;
  let mechanicalEnergyJ = 0;
  let copperEnergyJ = 0;
  let speedTime = 0;
  let statorTime = 0;
  let peakSpeed = 0;
  let peakStator = 0;
  let lastIntervalEndUs = Number.NaN;

  for (let index = 0; index + 1 < series.timestampsUs.length; index += 1) {
    const startUs = series.timestampsUs[index];
    const endUs = series.timestampsUs[index + 1];
    const dt = (endUs - startUs) / 1_000_000;
    if (!(dt > 0) || !Number.isFinite(dt)) continue;
    intervalCount += 1;
    totalDurationSeconds += dt;
    const batteryV = series.batteryVoltageV[index];
    const supplyA = series.supplyCurrentA[index];
    const statorA = series.statorCurrentA[index];
    const speedRadPerSec = series.rotorVelocityRadPerSec[index];
    const classified = classifyMotorInterval(
      model,
      motorCount,
      batteryV,
      supplyA,
      statorA,
      speedRadPerSec,
    );
    durationSecondsByStatus[classified.statusCode] += dt;
    const previousStatus = statusCodes.at(-1);
    if (
      previousStatus === undefined ||
      previousStatus !== classified.statusCode ||
      startUs !== lastIntervalEndUs
    ) {
      boundariesUs.push(startUs);
      statusCodes.push(classified.statusCode);
    }
    lastIntervalEndUs = endUs;

    if (classified.statusCode === MOTOR_COVERAGE_STATUS.PHYSICALLY_IMPOSSIBLE) {
      physicallyImpossibleIntervalCount += 1;
    }
    if (classified.statusCode !== MOTOR_COVERAGE_STATUS.VALID || !classified.powers) continue;

    validIntervalCount += 1;
    validDurationSeconds += dt;
    batteryEnergyJ += classified.powers.batteryPowerW * dt;
    mechanicalEnergyJ += classified.powers.mechanicalPowerW * dt;
    copperEnergyJ += classified.powers.copperLossPowerW * dt;
    const speed = Math.abs(speedRadPerSec);
    speedTime += speed * dt;
    statorTime += statorA * dt;
    peakSpeed = Math.max(peakSpeed, speed);
    peakStator = Math.max(peakStator, statorA);
  }

  const coverage = statusCodes.length > 0
    ? {
        boundariesUs: Float64Array.from([...boundariesUs, lastIntervalEndUs]),
        statusCodes: Uint8Array.from(statusCodes),
        durationSecondsByStatus,
        totalDurationSeconds,
        validDurationSeconds,
        coverageFraction:
          totalDurationSeconds > 0 ? validDurationSeconds / totalDurationSeconds : 0,
      }
    : emptyCoverage(series.timestampsUs.length > 0 ? series.timestampsUs[0] : undefined);
  return {
    coverage,
    intervalCount,
    validIntervalCount,
    physicallyImpossibleIntervalCount,
    batteryEnergyJ,
    mechanicalEnergyJ,
    copperEnergyJ,
    speedTime,
    statorTime,
    peakSpeed,
    peakStator,
  };
}

/**
 * Estimates drive efficiency from positive battery-power and positive Stator Current intervals.
 * V2.3 regenerative intervals retain their negative Stator Current in the canonical timeline but
 * are excluded here. A leader sample represents each homogeneous motor in its group; the physical
 * group Supply Current remains the battery-side truth.
 */
export function analyzeMotorTelemetry(
  motorSource: MotorModelSource,
  series: MotorTelemetrySeries,
  motorCount = 1,
): MotorTelemetryAnalysis {
  return analyzeMotorTelemetryDiagnostics(motorSource, series, motorCount).efficiency;
}

export function analyzeMotorTelemetryDiagnostics(
  motorSource: MotorModelSource,
  series: MotorTelemetrySeries,
  motorCount = 1,
): MotorTelemetryDiagnostics {
  const model = resolveMotorModel(motorSource);
  if (!model) {
    return {
      efficiency: { available: false, reason: "UNKNOWN_MOTOR_TYPE" },
      coverage: null,
    };
  }
  if (series.timestampsUs.length === 0) {
    return {
      efficiency: { available: false, reason: "EMPTY_SERIES" },
      coverage: emptyCoverage(),
    };
  }
  if (!sameLength(series) || !Number.isInteger(motorCount) || motorCount < 1) {
    return {
      efficiency: { available: false, reason: "LENGTH_MISMATCH" },
      coverage: null,
    };
  }
  const scan = scanMotorTelemetry(model, series, motorCount);
  if (scan.validIntervalCount === 0 || !(scan.coverage.validDurationSeconds > 0)) {
    return {
      efficiency: { available: false, reason: "NO_VALID_INTERVALS" },
      coverage: scan.coverage,
    };
  }
  return {
    efficiency: {
      available: true,
      model,
      motorCount,
      metrics: {
        durationSeconds: scan.coverage.validDurationSeconds,
        batteryConsumedEnergyWh: scan.batteryEnergyJ / 3600,
        estimatedMechanicalEnergyWh: scan.mechanicalEnergyJ / 3600,
        estimatedCopperLossWh: scan.copperEnergyJ / 3600,
        estimatedDriveEfficiency:
          scan.batteryEnergyJ > 0 ? scan.mechanicalEnergyJ / scan.batteryEnergyJ : null,
        averageRotorSpeedRadPerSec:
          scan.speedTime / scan.coverage.validDurationSeconds,
        peakRotorSpeedRadPerSec: scan.peakSpeed,
        averageLeaderStatorCurrentA:
          scan.statorTime / scan.coverage.validDurationSeconds,
        peakLeaderStatorCurrentA: scan.peakStator,
      },
      quality: {
        intervalCount: scan.intervalCount,
        validIntervalCount: scan.validIntervalCount,
        droppedIntervalCount: scan.intervalCount - scan.validIntervalCount,
        physicallyImpossibleIntervalCount: scan.physicallyImpossibleIntervalCount,
        coverageFraction: scan.coverage.coverageFraction,
      },
    },
    coverage: scan.coverage,
  };
}

export type GearRatioUnavailableReason =
  | MotorAnalysisUnavailableReason
  | "INVALID_CURRENT_RATIO"
  | "MISSING_STATE_DISTRIBUTION"
  | "INSUFFICIENT_ACTIVE_DATA"
  | "NO_FEASIBLE_CANDIDATE";

export interface GearRatioRecommendationInput {
  readonly motorType: string;
  /** Cyber Power analysis reduction, never a Talon feedback ratio. */
  readonly currentRatio: number;
  readonly motorCount?: number;
  readonly telemetry: MotorTelemetrySeries;
  readonly stateIds: ArrayLike<number>;
}

export type GearRatioRecommendation =
  | {
      readonly available: false;
      readonly reason: GearRatioUnavailableReason;
      readonly limitations: readonly string[];
    }
  | {
      readonly available: true;
      readonly model: Readonly<MotorModel>;
      readonly currentRatio: number;
      readonly recommendedRatio: number;
      readonly activeSampleCount: number;
      readonly activeDurationSeconds: number;
      readonly observedStateCount: number;
      readonly currentCopperLossWh: number;
      readonly recommendedCopperLossWh: number;
      readonly estimatedCopperReductionWh: number;
      readonly measuredGroupInputEnergyWh: number;
      readonly reductionShareOfMeasuredInput: number;
      readonly reasons: readonly string[];
      readonly limitations: readonly string[];
    };

function unavailable(
  reason: GearRatioUnavailableReason,
  limitation: string,
): GearRatioRecommendation {
  return { available: false, reason, limitations: [limitation] };
}

interface RatioPoint {
  loadCurrentA: number;
  speedRadPerSec: number;
  batteryV: number;
  dt: number;
}

/**
 * Holds observed mechanism torque and speed constant while testing alternative analysis reductions.
 * The voltage-headroom term uses `VOLTAGE_HEADROOM_PENALTY_W` as an empirical power weight.
 * It is a historical model recommendation, not a closed-loop or total-energy guarantee.
 */
export function recommendGearRatio(
  input: GearRatioRecommendationInput,
): GearRatioRecommendation {
  const model = getMotorModel(input.motorType);
  if (!model) return unavailable("UNKNOWN_MOTOR_TYPE", "未知电机型号，无法推荐减速比。");
  if (!Number.isFinite(input.currentRatio) || input.currentRatio <= 0) {
    return unavailable("INVALID_CURRENT_RATIO", "分析减速比必须是大于零的有限值。");
  }
  const telemetry = input.telemetry;
  if (telemetry.timestampsUs.length === 0) {
    return unavailable("EMPTY_SERIES", "没有可用于推荐的电机样本。");
  }
  if (!sameLength(telemetry) || input.stateIds.length !== telemetry.timestampsUs.length) {
    return unavailable("LENGTH_MISMATCH", "电机信号、时间戳与状态序列长度不一致。");
  }

  const motorCount = Math.max(1, Math.trunc(input.motorCount ?? 1));
  const points: RatioPoint[] = [];
  const states = new Set<number>();
  let hasValidState = false;
  let activeDurationSeconds = 0;
  let currentCopperJ = 0;
  let measuredGroupInputEnergyJ = 0;
  for (let index = 0; index + 1 < telemetry.timestampsUs.length; index += 1) {
    const dt = (telemetry.timestampsUs[index + 1] - telemetry.timestampsUs[index]) / 1_000_000;
    if (!(dt > 0) || !Number.isFinite(dt)) continue;
    const stateId = input.stateIds[index];
    const statorA = telemetry.statorCurrentA[index];
    const speedRadPerSec = telemetry.rotorVelocityRadPerSec[index];
    const batteryV = telemetry.batteryVoltageV[index];
    const supplyA = telemetry.supplyCurrentA[index];
    const stateIsValid = Number.isInteger(stateId) && stateId >= 0;
    if (stateIsValid) hasValidState = true;
    if (
      !stateIsValid ||
      !Number.isFinite(statorA) ||
      !Number.isFinite(speedRadPerSec) ||
      !Number.isFinite(batteryV) ||
      !Number.isFinite(supplyA) ||
      statorA <= model.freeCurrentA ||
      supplyA <= 0 ||
      batteryV <= 0
    ) {
      continue;
    }
    if (
      !isPlausiblePositiveDrive(
        positiveDrivePowers(model, motorCount, batteryV, supplyA, statorA, speedRadPerSec),
      )
    ) {
      continue;
    }
    activeDurationSeconds += dt;
    states.add(stateId);
    currentCopperJ += motorCount * statorA * statorA * model.resistanceOhm * dt;
    measuredGroupInputEnergyJ += batteryV * supplyA * dt;
    points.push({
      loadCurrentA: loadProducingCurrentA(model, statorA),
      speedRadPerSec,
      batteryV,
      dt,
    });
  }
  if (!hasValidState) {
    return unavailable("MISSING_STATE_DISTRIBUTION", "没有同时带有效子系统状态的工作样本。");
  }
  if (points.length < 8 || activeDurationSeconds < 0.25) {
    return unavailable("INSUFFICIENT_ACTIVE_DATA", "有效工作样本不足，无法稳定推荐减速比。");
  }

  const candidates: Array<{ ratio: number; score: number; copperJ: number }> = [];
  for (let candidateIndex = 0; candidateIndex <= 60; candidateIndex += 1) {
    const factor = candidateIndex === 30
      ? 1
      : Math.exp(Math.log(0.5) + (candidateIndex / 60) * Math.log(4));
    const ratio = input.currentRatio * factor;
    let copperJ = 0;
    let voltageHeadroomPenaltySeconds = 0;
    let feasible = true;
    for (const point of points) {
      const candidateCurrentA = model.freeCurrentA + point.loadCurrentA / factor;
      const candidateSpeedRadPerSec = point.speedRadPerSec * factor;
      const requiredVoltageV =
        candidateCurrentA * model.resistanceOhm +
        Math.abs(candidateSpeedRadPerSec) / model.velocityConstantRadPerSecPerVolt;
      if (
        candidateCurrentA > model.stallCurrentA ||
        Math.abs(candidateSpeedRadPerSec) > model.freeSpeedRadPerSec * 1.05 ||
        requiredVoltageV > point.batteryV * 1.05
      ) {
        feasible = false;
        break;
      }
      copperJ +=
        motorCount * candidateCurrentA * candidateCurrentA * model.resistanceOhm * point.dt;
      voltageHeadroomPenaltySeconds +=
        Math.pow(requiredVoltageV / point.batteryV, 4) * point.dt;
    }
    if (feasible) {
      candidates.push({
        ratio,
        copperJ,
        score: copperJ + voltageHeadroomPenaltySeconds * VOLTAGE_HEADROOM_PENALTY_W,
      });
    }
  }
  if (candidates.length === 0) {
    return unavailable("NO_FEASIBLE_CANDIDATE", "观测工况下没有通过电流、转速和电压约束的候选减速比。");
  }
  const best = candidates.reduce((left, right) => (right.score < left.score ? right : left));
  const currentCopperLossWh = currentCopperJ / 3600;
  const recommendedCopperLossWh = best.copperJ / 3600;
  const estimatedCopperReductionWh = currentCopperLossWh - recommendedCopperLossWh;
  const measuredGroupInputEnergyWh = measuredGroupInputEnergyJ / 3600;
  return {
    available: true,
    model,
    currentRatio: input.currentRatio,
    recommendedRatio: best.ratio,
    activeSampleCount: points.length,
    activeDurationSeconds,
    observedStateCount: states.size,
    currentCopperLossWh,
    recommendedCopperLossWh,
    estimatedCopperReductionWh,
    measuredGroupInputEnergyWh,
    reductionShareOfMeasuredInput:
      measuredGroupInputEnergyWh > 0
        ? estimatedCopperReductionWh / measuredGroupInputEnergyWh
        : 0,
    reasons: [
      "保持历史机械侧转速与扭矩不变，比较候选减速比的铜耗和电压余量。",
      "同构 Follower 假设与 Leader 工作点一致，只将物理电机数量计入模型。",
      "候选电流保留空载损耗电流，仅按减速比缩放负载电流。",
    ],
    limitations: [
      "结果仅适用于日志覆盖的工况，不包含机构摩擦、控制器限流变化和瞬态响应预测。",
      "电压余量评分使用 25 W 经验权重；它不是电机物理常数，也不代表额外能耗。",
      "空载电流 I0 按常量近似；未建模随转速变化的铁耗、风阻等电机损耗，因此不保证总输入能耗下降。",
      "电压余量惩罚可能选择模型铜耗高于当前比的候选，因此估算铜耗降低量可能为负。",
    ],
  };
}
