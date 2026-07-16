import {
  analyzeMotorTelemetryDiagnostics,
  recommendGearRatio,
  type GearRatioRecommendation,
  type MotorCoverageTimeline,
  type MotorTelemetryAnalysis,
  type MotorTelemetrySeries,
} from "./motor-models";
import { upperBound } from "./time-series";
import type { EnergyLoggerV2MotorType } from "./v2-contract";
import type {
  EnergyLogDataset,
  EnergyLogV2Dataset,
  EnergyLogV2SubsystemDataset,
  NumericSeries,
  SubsystemNode,
  TimeRange,
} from "./types";

interface AlignedSubsystemSamples {
  timestampsUs: Float64Array;
  sourceRows: Int32Array;
  states: string[];
}

const subsystemAlignmentCache = new WeakMap<
  EnergyLogV2SubsystemDataset,
  AlignedSubsystemSamples
>();

function monotonicSampleRows(
  recordTimestampsUs: ArrayLike<number>,
  producerTimestampsUs: ArrayLike<number>,
): { timestampsUs: Float64Array; recordTimestampsUs: Float64Array } {
  const timestamps: number[] = [];
  const records: number[] = [];
  const length = Math.min(recordTimestampsUs.length, producerTimestampsUs.length);
  for (let index = 0; index < length; index += 1) {
    const producer = producerTimestampsUs[index];
    const record = recordTimestampsUs[index];
    if (!Number.isSafeInteger(producer) || producer < 0 || !Number.isFinite(record)) continue;
    const last = timestamps.at(-1);
    if (last !== undefined && producer < last) continue;
    if (last === producer) {
      records[records.length - 1] = record;
    } else {
      timestamps.push(producer);
      records.push(record);
    }
  }
  return {
    timestampsUs: Float64Array.from(timestamps),
    recordTimestampsUs: Float64Array.from(records),
  };
}

function heldNumericAtRecord(series: NumericSeries, recordTimestampUs: number): number {
  const index = upperBound(series.timestampsUs, recordTimestampUs) - 1;
  return index >= 0 ? series.values[index] : Number.NaN;
}

function heldStringAtRecord(
  timestampsUs: ArrayLike<number>,
  values: readonly string[],
  recordTimestampUs: number,
): string {
  const index = upperBound(timestampsUs, recordTimestampUs) - 1;
  return index >= 0 ? values[index] ?? "" : "";
}

function alignSubsystem(subsystem: EnergyLogV2SubsystemDataset): AlignedSubsystemSamples {
  const cached = subsystemAlignmentCache.get(subsystem);
  if (cached) return cached;
  const rows = monotonicSampleRows(
    subsystem.sampleTimestampUs.timestampsUs,
    subsystem.sampleTimestampUs.values,
  );
  const sourceRows = new Int32Array(rows.timestampsUs.length);
  const states: string[] = new Array(rows.timestampsUs.length);
  for (let index = 0; index < rows.timestampsUs.length; index += 1) {
    const recordTimestampUs = rows.recordTimestampsUs[index];
    sourceRows[index] = upperBound(subsystem.motorSamples.timestampsUs, recordTimestampUs) - 1;
    states[index] = heldStringAtRecord(
      subsystem.state.timestampsUs,
      subsystem.state.values,
      recordTimestampUs,
    );
  }
  const result = { timestampsUs: rows.timestampsUs, sourceRows, states };
  subsystemAlignmentCache.set(subsystem, result);
  return result;
}

function strictMotorSupplySum(
  subsystem: EnergyLogV2SubsystemDataset,
  sourceRow: number,
  motorIndices?: readonly number[],
): number {
  if (sourceRow < 0) return Number.NaN;
  const indices = motorIndices ?? subsystem.motors.map((_, index) => index);
  let sum = 0;
  for (const motorIndex of indices) {
    const value = subsystem.motorSamples.values[
      sourceRow * subsystem.motorSamples.width + motorIndex * 3
    ];
    if (!Number.isFinite(value)) return Number.NaN;
    sum += value;
  }
  return sum;
}

function mergeTimelines(left: ArrayLike<number>, right: ArrayLike<number>): Float64Array {
  const merged = new Float64Array(left.length + right.length);
  let leftIndex = 0;
  let rightIndex = 0;
  let outputIndex = 0;
  let previous = Number.NaN;
  while (leftIndex < left.length || rightIndex < right.length) {
    const leftValue = leftIndex < left.length ? left[leftIndex] : Number.POSITIVE_INFINITY;
    const rightValue = rightIndex < right.length ? right[rightIndex] : Number.POSITIVE_INFINITY;
    const value = Math.min(leftValue, rightValue);
    if (leftValue === value) leftIndex += 1;
    if (rightValue === value) rightIndex += 1;
    if (outputIndex === 0 || value !== previous) {
      merged[outputIndex] = value;
      outputIndex += 1;
      previous = value;
    }
  }
  return merged.slice(0, outputIndex);
}

function electricalSeries(
  entryPrefix: string,
  timestampsUs: Float64Array,
  currentA: Float64Array,
  batteryVoltageV: Float64Array,
): { currentA: NumericSeries; powerW: NumericSeries; energyWh: NumericSeries } {
  const powerValues = new Float64Array(timestampsUs.length);
  const energyValues = new Float64Array(timestampsUs.length);
  for (let index = 0; index < timestampsUs.length; index += 1) {
    const current = currentA[index];
    const voltage = batteryVoltageV[index];
    powerValues[index] = Number.isFinite(current) && Number.isFinite(voltage)
      ? current * voltage
      : Number.NaN;
    if (index === 0) continue;
    const dtHours = (timestampsUs[index] - timestampsUs[index - 1]) / 3_600_000_000;
    const previousPower = powerValues[index - 1];
    energyValues[index] =
      energyValues[index - 1] +
      (dtHours > 0 && Number.isFinite(previousPower) ? Math.max(0, previousPower) * dtHours : 0);
  }
  return {
    currentA: { timestampsUs, values: currentA, unit: "A", entryName: `${entryPrefix}/current` },
    powerW: { timestampsUs, values: powerValues, unit: "W", entryName: `${entryPrefix}/power` },
    energyWh: { timestampsUs, values: energyValues, unit: "Wh", entryName: `${entryPrefix}/energy` },
  };
}

export interface DerivedEnergyLoggerV2Core {
  bounds: { energyStartUs: number; energyEndUs: number };
  droppedNonfiniteSamples: number;
  totalCurrentA: NumericSeries;
  totalPowerW: NumericSeries;
  totalEnergyWh: NumericSeries;
  batteryVoltageV: NumericSeries;
  subsystems: SubsystemNode[];
}

export interface EnergyLoggerV2MotorGroupElectricalSeries {
  readonly id: string;
  readonly subsystemId: string;
  readonly subsystemName: string;
  readonly leaderName: string;
  readonly motorNames: readonly string[];
  readonly motorType: EnergyLoggerV2MotorType;
  readonly motorCount: number;
  readonly currentA: NumericSeries;
  readonly powerW: NumericSeries;
  readonly energyWh: NumericSeries;
}

const motorGroupElectricalSeriesCache = new WeakMap<
  EnergyLogDataset,
  readonly EnergyLoggerV2MotorGroupElectricalSeries[]
>();

/** Converts a supported fixed V2 transport into the same canonical electrical series used by v1 UI. */
export function deriveEnergyLoggerV2Core(v2: EnergyLogV2Dataset): DerivedEnergyLoggerV2Core {
  const robotRows = monotonicSampleRows(
    v2.robotSampleTimestampUs.timestampsUs,
    v2.robotSampleTimestampUs.values,
  );
  if (robotRows.timestampsUs.length < 2) {
    throw new Error("EnergyLogger V2 robot timeline requires at least two samples");
  }
  const robotCurrent = new Float64Array(robotRows.timestampsUs.length);
  const robotVoltage = new Float64Array(robotRows.timestampsUs.length);
  for (let index = 0; index < robotRows.timestampsUs.length; index += 1) {
    const recordTimestampUs = robotRows.recordTimestampsUs[index];
    robotCurrent[index] = heldNumericAtRecord(v2.robotSupplyCurrentAmps, recordTimestampUs);
    const voltage = heldNumericAtRecord(v2.robotBatteryVoltageVolts, recordTimestampUs);
    robotVoltage[index] = Number.isFinite(voltage) && voltage >= 0 ? voltage : Number.NaN;
  }
  let hasFiniteElectricalInterval = false;
  let droppedNonfiniteSamples = 0;
  for (let index = 0; index < robotRows.timestampsUs.length; index += 1) {
    if (!Number.isFinite(robotCurrent[index])) droppedNonfiniteSamples += 1;
    if (!Number.isFinite(robotVoltage[index])) {
      droppedNonfiniteSamples += 1;
    }
    if (index + 1 < robotRows.timestampsUs.length && robotRows.timestampsUs[index + 1] > robotRows.timestampsUs[index]) {
      if (Number.isFinite(robotCurrent[index]) && Number.isFinite(robotVoltage[index])) {
        hasFiniteElectricalInterval = true;
      }
    }
  }
  if (!hasFiniteElectricalInterval) {
    throw new Error("EnergyLogger V2 robot timeline has no finite electrical interval");
  }
  const total = electricalSeries(
    `${v2.robotSampleTimestampUs.entryName}/derived`,
    robotRows.timestampsUs,
    robotCurrent,
    robotVoltage,
  );
  const batteryVoltageV: NumericSeries = {
    timestampsUs: robotRows.timestampsUs,
    values: robotVoltage,
    unit: "V",
    entryName: v2.robotBatteryVoltageVolts.entryName,
  };

  const subsystems: SubsystemNode[] = v2.subsystems.map((subsystem) => {
    const aligned = alignSubsystem(subsystem);
    const rawCurrent = new Float64Array(aligned.timestampsUs.length);
    for (let index = 0; index < aligned.timestampsUs.length; index += 1) {
      rawCurrent[index] = strictMotorSupplySum(subsystem, aligned.sourceRows[index]);
      const sourceRow = aligned.sourceRows[index];
      if (sourceRow < 0) {
        droppedNonfiniteSamples += subsystem.motors.length;
        droppedNonfiniteSamples +=
          subsystem.motors.filter((motor) => motor.leader === null).length * 2;
        continue;
      }
      for (let motorIndex = 0; motorIndex < subsystem.motors.length; motorIndex += 1) {
        const motor = subsystem.motors[motorIndex];
        const offset = sourceRow * subsystem.motorSamples.width + motorIndex * 3;
        if (!Number.isFinite(subsystem.motorSamples.values[offset])) droppedNonfiniteSamples += 1;
        if (motor.leader === null) {
          if (!Number.isFinite(subsystem.motorSamples.values[offset + 1])) {
            droppedNonfiniteSamples += 1;
          }
          if (!Number.isFinite(subsystem.motorSamples.values[offset + 2])) {
            droppedNonfiniteSamples += 1;
          }
        }
      }
    }
    const timeline = mergeTimelines(aligned.timestampsUs, robotRows.timestampsUs);
    const heldCurrent = new Float64Array(timeline.length);
    const heldVoltage = new Float64Array(timeline.length);
    let currentIndex = -1;
    let voltageIndex = -1;
    for (let index = 0; index < timeline.length; index += 1) {
      const timestampUs = timeline[index];
      while (
        currentIndex + 1 < aligned.timestampsUs.length &&
        aligned.timestampsUs[currentIndex + 1] <= timestampUs
      ) currentIndex += 1;
      while (
        voltageIndex + 1 < robotRows.timestampsUs.length &&
        robotRows.timestampsUs[voltageIndex + 1] <= timestampUs
      ) voltageIndex += 1;
      heldCurrent[index] = currentIndex >= 0 ? rawCurrent[currentIndex] : Number.NaN;
      heldVoltage[index] = voltageIndex >= 0 ? robotVoltage[voltageIndex] : Number.NaN;
    }
    const derived = electricalSeries(
      `${subsystem.sampleTimestampUs.entryName}/derived`,
      timeline,
      heldCurrent,
      heldVoltage,
    );
    return {
      id: subsystem.name,
      rawPath: subsystem.name,
      displayName: subsystem.name,
      parentId: null,
      depth: 0,
      childrenIds: [],
      isAggregate: false,
      currentA: derived.currentA,
      powerW: derived.powerW,
      energyWh: derived.energyWh,
    };
  });
  subsystems.sort((left, right) => left.id.localeCompare(right.id));
  return {
    droppedNonfiniteSamples,
    bounds: {
      energyStartUs: robotRows.timestampsUs[0],
      energyEndUs: robotRows.timestampsUs.at(-1)!,
    },
    totalCurrentA: total.currentA,
    totalPowerW: total.powerW,
    totalEnergyWh: total.energyWh,
    batteryVoltageV,
    subsystems,
  };
}

/**
 * Derives one electrical series per Manifest leader group. Followers contribute
 * their Supply Current to their leader and never become independent targets.
 */
export function deriveEnergyLoggerV2MotorGroupElectricalSeries(
  dataset: EnergyLogDataset,
): readonly EnergyLoggerV2MotorGroupElectricalSeries[] | undefined {
  if (!dataset.v2) return undefined;
  const cached = motorGroupElectricalSeriesCache.get(dataset);
  if (cached) return cached;

  const range = {
    startUs: dataset.bounds.energyStartUs,
    endUs: dataset.bounds.energyEndUs,
  };
  const groups: EnergyLoggerV2MotorGroupElectricalSeries[] = [];
  for (const subsystem of dataset.v2.subsystems) {
    const aligned = alignSubsystem(subsystem);
    subsystem.motors.forEach((leader, leaderIndex) => {
      if (leader.leader !== null) return;
      const motorIndices = subsystem.motors.flatMap((motor, motorIndex) =>
        motorIndex === leaderIndex || motor.leader === leader.name ? [motorIndex] : [],
      );
      const extracted = groupTelemetry(
        dataset,
        subsystem,
        aligned,
        motorIndices,
        leaderIndex,
        range,
      );
      const derived = electricalSeries(
        `${subsystem.sampleTimestampUs.entryName}/groups/${leader.name}`,
        extracted.telemetry.timestampsUs,
        extracted.telemetry.supplyCurrentA,
        extracted.telemetry.batteryVoltageV,
      );
      groups.push({
        id: `${subsystem.id}/${leader.name}`,
        subsystemId: subsystem.id,
        subsystemName: subsystem.name,
        leaderName: leader.name,
        motorNames: motorIndices.map((index) => subsystem.motors[index].name),
        motorType: leader.type,
        motorCount: motorIndices.length,
        currentA: derived.currentA,
        powerW: derived.powerW,
        energyWh: derived.energyWh,
      });
    });
  }
  groups.sort((left, right) => left.id.localeCompare(right.id));
  motorGroupElectricalSeriesCache.set(dataset, groups);
  return groups;
}

export interface EnergyLoggerV2MetricSnapshot {
  readonly energyWh: number;
  readonly averagePowerW: number;
  readonly peakPowerW: number;
  readonly peakPowerTimestampUs: number;
  readonly peakCurrentA: number;
  readonly peakCurrentTimestampUs: number;
}

export interface EnergyLoggerV2StateMetrics extends EnergyLoggerV2MetricSnapshot {
  readonly state: string;
  readonly durationSeconds: number;
}

export interface EnergyLoggerV2MotorGroupMetrics {
  readonly id: string;
  readonly leaderName: string;
  readonly motorNames: readonly string[];
  readonly motorType: EnergyLoggerV2MotorType;
  readonly motorCount: number;
  readonly analysisReduction: number;
  readonly coverage: MotorCoverageTimeline;
  readonly efficiency: MotorTelemetryAnalysis;
  readonly gearRatio: GearRatioRecommendation;
}

export interface EnergyLoggerV2SubsystemMetrics {
  readonly id: string;
  readonly name: string;
  readonly states: readonly EnergyLoggerV2StateMetrics[];
  readonly motorGroups: readonly EnergyLoggerV2MotorGroupMetrics[];
}

export interface EnergyLoggerV2RangeAnalysis {
  readonly range: TimeRange;
  readonly subsystems: readonly EnergyLoggerV2SubsystemMetrics[];
}

function heldNumeric(series: NumericSeries, timestampUs: number): number {
  const index = upperBound(series.timestampsUs, timestampUs) - 1;
  return index >= 0 ? series.values[index] : Number.NaN;
}

function isEnabled(dataset: EnergyLogDataset, timestampUs: number): boolean {
  if (!dataset.series.enabled) return true;
  const index = upperBound(dataset.series.enabled.timestampsUs, timestampUs) - 1;
  return index >= 0 && dataset.series.enabled.values[index] !== 0;
}

function stateMetrics(
  dataset: EnergyLogDataset,
  node: SubsystemNode,
  aligned: AlignedSubsystemSamples,
  range: TimeRange,
): EnergyLoggerV2StateMetrics[] {
  const events: number[] = [range.startUs, range.endUs];
  for (const timestampUs of node.powerW.timestampsUs) {
    if (timestampUs > range.startUs && timestampUs < range.endUs) events.push(timestampUs);
  }
  if (dataset.series.enabled) {
    for (const timestampUs of dataset.series.enabled.timestampsUs) {
      if (timestampUs > range.startUs && timestampUs < range.endUs) events.push(timestampUs);
    }
  }
  events.sort((left, right) => left - right);
  const totals = new Map<
    string,
    {
      durationSeconds: number;
      energyWh: number;
      peakPowerW: number;
      peakPowerTimestampUs: number;
      peakCurrentA: number;
      peakCurrentTimestampUs: number;
    }
  >();
  let previous = Number.NaN;
  for (const timestampUs of events) {
    if (timestampUs === previous) continue;
    const nextIndex = upperBound(events, timestampUs);
    const endUs = nextIndex < events.length ? events[nextIndex] : timestampUs;
    previous = timestampUs;
    if (!(endUs > timestampUs) || !isEnabled(dataset, timestampUs)) continue;
    const stateIndex = upperBound(aligned.timestampsUs, timestampUs) - 1;
    if (stateIndex < 0) continue;
    const state = aligned.states[stateIndex]?.trim() || "未记录";
    const powerW = heldNumeric(node.powerW, timestampUs);
    const currentA = heldNumeric(node.currentA, timestampUs);
    if (!Number.isFinite(powerW) || !Number.isFinite(currentA)) continue;
    const durationSeconds = (endUs - timestampUs) / 1_000_000;
    const item = totals.get(state) ?? {
      durationSeconds: 0,
      energyWh: 0,
      peakPowerW: Number.NEGATIVE_INFINITY,
      peakPowerTimestampUs: timestampUs,
      peakCurrentA: Number.NEGATIVE_INFINITY,
      peakCurrentTimestampUs: timestampUs,
    };
    item.durationSeconds += durationSeconds;
    item.energyWh += Math.max(0, powerW) * durationSeconds / 3600;
    if (powerW > item.peakPowerW) {
      item.peakPowerW = powerW;
      item.peakPowerTimestampUs = timestampUs;
    }
    if (currentA > item.peakCurrentA) {
      item.peakCurrentA = currentA;
      item.peakCurrentTimestampUs = timestampUs;
    }
    totals.set(state, item);
  }
  return [...totals]
    .map(([state, item]) => ({
      state,
      durationSeconds: item.durationSeconds,
      energyWh: item.energyWh,
      averagePowerW:
        item.durationSeconds > 0 ? item.energyWh * 3600 / item.durationSeconds : 0,
      peakPowerW: Number.isFinite(item.peakPowerW) ? item.peakPowerW : 0,
      peakPowerTimestampUs: item.peakPowerTimestampUs,
      peakCurrentA: Number.isFinite(item.peakCurrentA) ? item.peakCurrentA : 0,
      peakCurrentTimestampUs: item.peakCurrentTimestampUs,
    }))
    .sort((left, right) => right.energyWh - left.energyWh || left.state.localeCompare(right.state));
}

function groupTelemetry(
  dataset: EnergyLogDataset,
  subsystem: EnergyLogV2SubsystemDataset,
  aligned: AlignedSubsystemSamples,
  motorIndices: readonly number[],
  leaderIndex: number,
  range: TimeRange,
): {
  telemetry: MotorTelemetrySeries & {
    timestampsUs: Float64Array;
    supplyCurrentA: Float64Array;
    batteryVoltageV: Float64Array;
    statorCurrentA: Float64Array;
    rotorVelocityRadPerSec: Float64Array;
  };
  stateIds: Int32Array;
} {
  const subsystemTimestamps: number[] = [range.startUs];
  for (const timestampUs of aligned.timestampsUs) {
    if (timestampUs > range.startUs && timestampUs < range.endUs) {
      subsystemTimestamps.push(timestampUs);
    }
  }
  if (range.endUs > range.startUs) subsystemTimestamps.push(range.endUs);
  const batteryVoltage = dataset.series.batteryVoltageV!;
  const batteryTimestamps: number[] = [];
  for (const timestampUs of batteryVoltage.timestampsUs) {
    if (timestampUs > range.startUs && timestampUs < range.endUs) {
      batteryTimestamps.push(timestampUs);
    }
  }
  const timestamps = mergeTimelines(subsystemTimestamps, batteryTimestamps);
  const supply = new Float64Array(timestamps.length);
  const battery = new Float64Array(timestamps.length);
  const stator = new Float64Array(timestamps.length);
  const rotor = new Float64Array(timestamps.length);
  const stateIds = new Int32Array(timestamps.length);
  stateIds.fill(-1);
  const stateMap = new Map<string, number>();
  for (let index = 0; index < timestamps.length; index += 1) {
    const timestampUs = timestamps[index];
    const alignedIndex = upperBound(aligned.timestampsUs, timestampUs) - 1;
    const sourceRow = alignedIndex >= 0 ? aligned.sourceRows[alignedIndex] : -1;
    supply[index] = strictMotorSupplySum(subsystem, sourceRow, motorIndices);
    battery[index] = heldNumeric(batteryVoltage, timestampUs);
    if (sourceRow < 0) {
      stator[index] = Number.NaN;
      rotor[index] = Number.NaN;
      continue;
    }
    const offset = sourceRow * subsystem.motorSamples.width + leaderIndex * 3;
    stator[index] = subsystem.motorSamples.values[offset + 1];
    rotor[index] = subsystem.motorSamples.values[offset + 2];
    const state = aligned.states[alignedIndex]?.trim();
    if (state) {
      let stateId = stateMap.get(state);
      if (stateId === undefined) {
        stateId = stateMap.size;
        stateMap.set(state, stateId);
      }
      stateIds[index] = stateId;
    }
  }
  return {
    telemetry: {
      timestampsUs: timestamps,
      supplyCurrentA: supply,
      batteryVoltageV: battery,
      statorCurrentA: stator,
      rotorVelocityRadPerSec: rotor,
    },
    stateIds,
  };
}

export function analyzeEnergyLoggerV2Range(
  dataset: EnergyLogDataset,
  requested: Partial<TimeRange> = {},
): EnergyLoggerV2RangeAnalysis | undefined {
  if (!dataset.v2) return undefined;
  const range = {
    startUs: Math.max(dataset.bounds.energyStartUs, requested.startUs ?? dataset.bounds.energyStartUs),
    endUs: Math.min(dataset.bounds.energyEndUs, requested.endUs ?? dataset.bounds.energyEndUs),
  };
  if (!Number.isFinite(range.startUs) || !Number.isFinite(range.endUs) || range.endUs < range.startUs) {
    throw new RangeError("EnergyLogger V2 analysis range is invalid");
  }
  const nodeById = new Map(dataset.subsystems.map((node) => [node.id, node]));
  const subsystems = dataset.v2.subsystems.map((subsystem) => {
    const aligned = alignSubsystem(subsystem);
    const node = nodeById.get(subsystem.name);
    if (!node) throw new Error(`Missing derived subsystem ${subsystem.name}`);
    const motorGroups: EnergyLoggerV2MotorGroupMetrics[] = [];
    subsystem.motors.forEach((leader, leaderIndex) => {
      if (leader.leader !== null) return;
      const motorIndices = subsystem.motors.flatMap((motor, motorIndex) =>
        motorIndex === leaderIndex || motor.leader === leader.name ? [motorIndex] : [],
      );
      const extracted = groupTelemetry(
        dataset,
        subsystem,
        aligned,
        motorIndices,
        leaderIndex,
        range,
      );
      const diagnostics = analyzeMotorTelemetryDiagnostics(
        leader.type,
        extracted.telemetry,
        motorIndices.length,
      );
      if (!diagnostics.coverage) {
        throw new Error(`Unable to classify EnergyLogger V2 motor group ${subsystem.name}/${leader.name}`);
      }
      motorGroups.push({
        id: `${subsystem.id}/${leader.name}`,
        leaderName: leader.name,
        motorNames: motorIndices.map((index) => subsystem.motors[index].name),
        motorType: leader.type,
        motorCount: motorIndices.length,
        analysisReduction: leader.analysisReduction,
        coverage: diagnostics.coverage,
        efficiency: diagnostics.efficiency,
        gearRatio: recommendGearRatio({
          motorType: leader.type,
          currentRatio: leader.analysisReduction,
          motorCount: motorIndices.length,
          telemetry: extracted.telemetry,
          stateIds: extracted.stateIds,
        }),
      });
    });
    return {
      id: subsystem.id,
      name: subsystem.name,
      states: stateMetrics(dataset, node, aligned, range),
      motorGroups,
    };
  });
  return { range, subsystems };
}
