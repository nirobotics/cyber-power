import { rangeIntersections, upperBound } from "./time-series";
import type {
  DriverStationMode,
  EnergyLogDataset,
  ModeInterval,
  NumericSeries,
  TimeRange,
} from "./types";

const MICROSECONDS_PER_SECOND = 1_000_000;
const JOULES_PER_WATT_HOUR = 3_600;
const AMP_SECONDS_PER_AMP_HOUR = 3_600;
const NO_MODE = 255;
const MODE_CODES: Readonly<Record<DriverStationMode, number>> = Object.freeze({
  disabled: 0,
  autonomous: 1,
  teleop: 2,
  test: 3,
  enabled: 4,
});
const MODES = Object.freeze(
  Object.keys(MODE_CODES) as DriverStationMode[],
);

const DEFAULT_LIMITATIONS = Object.freeze([
  "电流只覆盖 EnergyLogger V2 记录的整机电机，不包含未接入的负载。",
  "等效压降代理同时包含供电路径、动态电压恢复和未记录负载的影响。",
  "结果只描述所选日志范围内的观测关系，不预测配置变更后的电压或 Brownout。",
] as const);

export type BatteryLoadResponseUnavailableReason =
  | "V2_REQUIRED"
  | "BATTERY_VOLTAGE_UNAVAILABLE"
  | "INVALID_RANGE"
  | "NO_COMPLETE_INTERVALS";

export type BatteryLoadResponseComponentUnavailableReason =
  | "INSUFFICIENT_SAMPLES"
  | "WEAK_CURRENT_EXCITATION"
  | "NO_INVERSE_VOLTAGE_STEPS"
  | "NO_INVERSE_VOLTAGE_WINDOWS"
  | "BROWNOUT_VOLTAGE_UNAVAILABLE"
  | "BROWNOUT_SIGNAL_UNAVAILABLE";

export interface BatteryLoadResponseOptions {
  readonly stepCurrentThresholdA?: number;
  readonly stepWindowSamples?: number;
  readonly stepGapSamples?: number;
  readonly stepRefractorySeconds?: number;
  /**
   * Rejects step windows containing a larger adjacent registered-current gap or
   * a staler held voltage sample. Defaults to 0.1 seconds for a nominal 20 ms log.
   */
  readonly stepMaximumSampleGapSeconds?: number;
  readonly minimumIndependentSteps?: number;
  readonly localWindowDurationSeconds?: number;
  readonly localWindowMinimumCurrentSpanA?: number;
  readonly localWindowMinimumIntervals?: number;
  readonly localWindowMinimumCoverageFraction?: number;
}

export interface BatteryLoadResponseSummary {
  readonly coveredDurationSeconds: number;
  readonly averageVoltageV: number;
  readonly averageRegisteredCurrentA: number;
  readonly positiveRegisteredInputEnergyWh: number;
  readonly positiveRegisteredChargeAh: number;
  readonly registeredCurrentSquaredTimeA2Seconds: number;
  readonly minimumVoltageV: number;
  readonly maximumVoltageV: number;
  readonly minimumRegisteredCurrentA: number;
  readonly maximumRegisteredCurrentA: number;
  readonly maximumPositiveRegisteredCurrentA: number;
}

export interface BatteryLoadResponseQuality {
  readonly requestedDurationSeconds: number;
  readonly timelineIntervalCount: number;
  readonly completeIntervalCount: number;
  readonly droppedIntervalCount: number;
  readonly coveredDurationSeconds: number;
  readonly coverageFraction: number;
  readonly positiveCurrentDurationSeconds: number;
  readonly negativeCurrentDurationSeconds: number;
  readonly zeroCurrentDurationSeconds: number;
  readonly observedCurrentSpanA: number;
}

export interface NumericQuantiles {
  readonly p05: number;
  readonly p25: number;
  readonly median: number;
  readonly p75: number;
  readonly p95: number;
}

export type BatteryLoadStepResponse =
  | {
      readonly status: "unavailable";
      readonly reason: BatteryLoadResponseComponentUnavailableReason;
      readonly candidateCount: number;
      readonly discontinuousCandidateCount?: number;
      readonly independentCount: number;
      readonly inverseVoltageCount: number;
      readonly rejectedDirectionCount: number;
    }
  | {
      readonly status: "available";
      readonly candidateCount: number;
      readonly discontinuousCandidateCount?: number;
      readonly independentCount: number;
      readonly inverseVoltageCount: number;
      readonly rejectedDirectionCount: number;
      readonly risingStepCount: number;
      readonly fallingStepCount: number;
      readonly timestampsUs: Float64Array;
      readonly deltaRegisteredCurrentA: Float64Array;
      readonly deltaVoltageV: Float64Array;
      readonly voltageDropProxyOhm: Float64Array;
      readonly voltageDropProxyQuantilesOhm: NumericQuantiles;
      readonly absoluteResidualQuantilesV: NumericQuantiles;
    };

export type BatteryLoadLocalWindows =
  | {
      readonly status: "unavailable";
      readonly reason: BatteryLoadResponseComponentUnavailableReason;
      readonly evaluatedWindowCount: number;
      readonly weakExcitationWindowCount: number;
      readonly rejectedDirectionWindowCount: number;
    }
  | {
      readonly status: "available";
      readonly evaluatedWindowCount: number;
      readonly weakExcitationWindowCount: number;
      readonly rejectedDirectionWindowCount: number;
      readonly windowStartUs: Float64Array;
      readonly windowEndUs: Float64Array;
      readonly coveredDurationSeconds: Float64Array;
      readonly currentSpanA: Float64Array;
      readonly interceptVoltageV: Float64Array;
      readonly voltageDropProxyOhm: Float64Array;
      readonly residualRmsV: Float64Array;
      readonly residualMedianAbsoluteV: Float64Array;
      readonly residualP95AbsoluteV: Float64Array;
      readonly voltageDropProxyQuantilesOhm: NumericQuantiles;
    };

export interface BatteryLoadObservedCurve {
  readonly timestampsUs: Float64Array;
  readonly registeredCurrentA: Float64Array;
  readonly voltageV: Float64Array;
  readonly intervalDurationSeconds: Float64Array;
  readonly registeredCurrentRangeA: Readonly<{ minimum: number; maximum: number }>;
  readonly voltageRangeV: Readonly<{ minimum: number; maximum: number }>;
}

export interface BatteryLoadObservedDistributionBin {
  readonly currentMinimumA: number;
  readonly currentMaximumA: number;
  readonly currentCenterA: number;
  readonly voltageP25V: number;
  readonly voltageMedianV: number;
  readonly voltageP75V: number;
  readonly observedDurationSeconds: number;
  readonly observationSegmentCount: number;
}

export interface BatteryLoadObservedDistribution {
  readonly binWidthA: number;
  readonly axisMinimumA: number;
  readonly axisMaximumA: number;
  readonly totalObservedDurationSeconds: number;
  readonly validObservationSegmentCount: number;
  readonly bins: readonly BatteryLoadObservedDistributionBin[];
}

export interface BatteryLoadObservedDistributionOptions {
  readonly targetBinCount?: number;
  readonly currentBinWidthA?: number;
}

export type BatteryLoadObservedLowVoltage =
  | {
      readonly status: "unavailable";
      readonly reason: "BROWNOUT_VOLTAGE_UNAVAILABLE";
    }
  | {
      readonly status: "available";
      readonly coveredDurationSeconds: number;
      readonly eventCount: number;
      readonly durationSeconds: number;
      readonly averageThresholdV: number;
      readonly minimumMarginV: number;
    };

export type BatteryLoadObservedBrownoutEvents =
  | {
      readonly status: "unavailable";
      readonly reason: "BROWNOUT_SIGNAL_UNAVAILABLE";
    }
  | {
      readonly status: "available";
      readonly eventCount: number;
      readonly durationSeconds: number;
    };

export interface BatteryLoadModeStats {
  readonly summary: BatteryLoadResponseSummary;
  readonly lowVoltageDurationSeconds: number | null;
  /**
   * Brownout-event/mode-interval overlaps. An event spanning a mode boundary is
   * counted in every overlapped mode, so mode counts are not additive.
   */
  readonly brownoutEventCount: number | null;
  readonly brownoutDurationSeconds: number | null;
}

export type BatteryLoadResponseAnalysis =
  | {
      readonly status: "unavailable";
      readonly reason: BatteryLoadResponseUnavailableReason;
      readonly limitations: readonly string[];
    }
  | {
      readonly status: "available";
      readonly range: TimeRange & { readonly durationSeconds: number };
      readonly summary: BatteryLoadResponseSummary;
      readonly quality: BatteryLoadResponseQuality;
      readonly stepResponse: BatteryLoadStepResponse;
      readonly localWindows: BatteryLoadLocalWindows;
      readonly modeStats: Readonly<Partial<Record<DriverStationMode, BatteryLoadModeStats>>>;
      readonly observedCurve: BatteryLoadObservedCurve;
      readonly lowVoltage: BatteryLoadObservedLowVoltage;
      readonly brownoutEvents: BatteryLoadObservedBrownoutEvents;
      readonly limitations: readonly string[];
    };

interface ResolvedOptions {
  stepCurrentThresholdA: number;
  stepWindowSamples: number;
  stepGapSamples: number;
  stepRefractoryUs: number;
  stepMaximumSampleGapUs: number;
  minimumIndependentSteps: number;
  localWindowDurationUs: number;
  localWindowMinimumCurrentSpanA: number;
  localWindowMinimumIntervals: number;
  localWindowMinimumCoverageFraction: number;
}

interface AlignedTimeline {
  timestampsUs: Float64Array;
  registeredCurrentA: Float64Array;
  voltageV: Float64Array;
  brownoutThresholdV: Float64Array;
  modeCodes: Uint8Array;
}

interface SummaryAccumulator {
  coveredDurationSeconds: number;
  voltageTime: number;
  currentTime: number;
  positiveEnergyJ: number;
  positiveChargeAmpSeconds: number;
  currentSquaredTime: number;
  minimumVoltageV: number;
  maximumVoltageV: number;
  minimumCurrentA: number;
  maximumCurrentA: number;
  maximumPositiveCurrentA: number;
}

function unavailable(reason: BatteryLoadResponseUnavailableReason): BatteryLoadResponseAnalysis {
  return { status: "unavailable", reason, limitations: DEFAULT_LIMITATIONS };
}

function lowerBound(values: ArrayLike<number>, target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (values[middle] < target) low = middle + 1;
    else high = middle;
  }
  return low;
}

function positiveFinite(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved) || resolved <= 0) {
    throw new RangeError(`${name} must be finite and greater than zero`);
  }
  return resolved;
}

function positiveInteger(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < 1) {
    throw new RangeError(`${name} must be a positive integer`);
  }
  return resolved;
}

function resolveOptions(options: BatteryLoadResponseOptions): ResolvedOptions {
  const coverage = options.localWindowMinimumCoverageFraction ?? 0.5;
  if (!Number.isFinite(coverage) || coverage <= 0 || coverage > 1) {
    throw new RangeError("localWindowMinimumCoverageFraction must be in (0, 1]");
  }
  return {
    stepCurrentThresholdA: positiveFinite(
      options.stepCurrentThresholdA,
      30,
      "stepCurrentThresholdA",
    ),
    stepWindowSamples: positiveInteger(options.stepWindowSamples, 5, "stepWindowSamples"),
    stepGapSamples: positiveInteger(options.stepGapSamples, 2, "stepGapSamples"),
    stepRefractoryUs:
      positiveFinite(options.stepRefractorySeconds, 0.25, "stepRefractorySeconds") *
      MICROSECONDS_PER_SECOND,
    stepMaximumSampleGapUs:
      positiveFinite(
        options.stepMaximumSampleGapSeconds,
        0.1,
        "stepMaximumSampleGapSeconds",
      ) * MICROSECONDS_PER_SECOND,
    minimumIndependentSteps: positiveInteger(
      options.minimumIndependentSteps,
      3,
      "minimumIndependentSteps",
    ),
    localWindowDurationUs:
      positiveFinite(options.localWindowDurationSeconds, 5, "localWindowDurationSeconds") *
      MICROSECONDS_PER_SECOND,
    localWindowMinimumCurrentSpanA: positiveFinite(
      options.localWindowMinimumCurrentSpanA,
      30,
      "localWindowMinimumCurrentSpanA",
    ),
    localWindowMinimumIntervals: positiveInteger(
      options.localWindowMinimumIntervals,
      8,
      "localWindowMinimumIntervals",
    ),
    localWindowMinimumCoverageFraction: coverage,
  };
}

function resolveRange(
  dataset: EnergyLogDataset,
  requested: Partial<TimeRange>,
): (TimeRange & { durationSeconds: number }) | null {
  if (
    (requested.startUs !== undefined && !Number.isFinite(requested.startUs)) ||
    (requested.endUs !== undefined && !Number.isFinite(requested.endUs))
  ) {
    return null;
  }
  const startUs = Math.max(
    dataset.bounds.energyStartUs,
    requested.startUs ?? dataset.bounds.energyStartUs,
  );
  const endUs = Math.min(
    dataset.bounds.energyEndUs,
    requested.endUs ?? dataset.bounds.energyEndUs,
  );
  if (!Number.isFinite(startUs) || !Number.isFinite(endUs) || endUs <= startUs) return null;
  return {
    startUs,
    endUs,
    durationSeconds: (endUs - startUs) / MICROSECONDS_PER_SECOND,
  };
}

function modeBoundaries(modes: readonly ModeInterval[], range: TimeRange): Float64Array {
  const values: number[] = [];
  for (const mode of modes) {
    if (mode.endUs <= range.startUs || mode.startUs >= range.endUs) continue;
    values.push(Math.max(range.startUs, mode.startUs), Math.min(range.endUs, mode.endUs));
  }
  values.sort((left, right) => left - right);
  let write = 0;
  for (const value of values) {
    if (write === 0 || value !== values[write - 1]) values[write++] = value;
  }
  return Float64Array.from(values.slice(0, write));
}

function modeCodeAt(modes: readonly ModeInterval[], timestampUs: number, hint: number): number {
  let index = hint;
  while (index < modes.length && modes[index].endUs <= timestampUs) index += 1;
  const mode = modes[index];
  return mode && mode.startUs <= timestampUs && timestampUs < mode.endUs
    ? MODE_CODES[mode.mode]
    : NO_MODE;
}

function buildAlignedTimeline(
  current: NumericSeries,
  voltage: NumericSeries,
  threshold: NumericSeries | undefined,
  modes: readonly ModeInterval[],
  range: TimeRange,
): AlignedTimeline {
  const modeTimes = modeBoundaries(modes, range);
  const currentFirstEvent = upperBound(current.timestampsUs, range.startUs);
  const currentEventEnd = lowerBound(current.timestampsUs, range.endUs);
  const voltageFirstEvent = upperBound(voltage.timestampsUs, range.startUs);
  const voltageEventEnd = lowerBound(voltage.timestampsUs, range.endUs);
  const thresholdFirstEvent = threshold
    ? upperBound(threshold.timestampsUs, range.startUs)
    : 0;
  const thresholdEventEnd = threshold
    ? lowerBound(threshold.timestampsUs, range.endUs)
    : 0;
  const maximumPointCount =
    Math.max(0, currentEventEnd - currentFirstEvent) +
    Math.max(0, voltageEventEnd - voltageFirstEvent) +
    Math.max(0, thresholdEventEnd - thresholdFirstEvent) +
    modeTimes.length +
    2;
  const timestampsUs = new Float64Array(maximumPointCount);
  const registeredCurrentA = new Float64Array(maximumPointCount);
  const voltageV = new Float64Array(maximumPointCount);
  const brownoutThresholdV = new Float64Array(maximumPointCount);
  const modeCodes = new Uint8Array(maximumPointCount);

  let currentNext = currentFirstEvent;
  let currentIndex = currentNext - 1;
  let voltageNext = voltageFirstEvent;
  let voltageIndex = voltageNext - 1;
  let thresholdNext = thresholdFirstEvent;
  let thresholdIndex = thresholdNext - 1;
  let modeNext = upperBound(modeTimes, range.startUs);
  let modeHint = 0;
  while (modeHint < modes.length && modes[modeHint].endUs <= range.startUs) modeHint += 1;
  let count = 0;
  let timestampUs = range.startUs;

  while (timestampUs < range.endUs) {
    while (
      currentNext < currentEventEnd &&
      current.timestampsUs[currentNext] <= timestampUs
    ) {
      currentIndex = currentNext++;
    }
    while (
      voltageNext < voltageEventEnd &&
      voltage.timestampsUs[voltageNext] <= timestampUs
    ) {
      voltageIndex = voltageNext++;
    }
    while (
      threshold &&
      thresholdNext < thresholdEventEnd &&
      threshold.timestampsUs[thresholdNext] <= timestampUs
    ) {
      thresholdIndex = thresholdNext++;
    }
    while (modeNext < modeTimes.length && modeTimes[modeNext] <= timestampUs) modeNext += 1;
    while (modeHint < modes.length && modes[modeHint].endUs <= timestampUs) modeHint += 1;

    timestampsUs[count] = timestampUs;
    registeredCurrentA[count] = currentIndex >= 0
      ? current.values[currentIndex]
      : Number.NaN;
    voltageV[count] = voltageIndex >= 0 ? voltage.values[voltageIndex] : Number.NaN;
    brownoutThresholdV[count] = threshold && thresholdIndex >= 0
      ? threshold.values[thresholdIndex]
      : Number.NaN;
    modeCodes[count] = modeCodeAt(modes, timestampUs, modeHint);
    count += 1;

    const nextTimestampUs = Math.min(
      range.endUs,
      currentNext < currentEventEnd
        ? current.timestampsUs[currentNext]
        : Number.POSITIVE_INFINITY,
      voltageNext < voltageEventEnd
        ? voltage.timestampsUs[voltageNext]
        : Number.POSITIVE_INFINITY,
      threshold && thresholdNext < thresholdEventEnd
        ? threshold.timestampsUs[thresholdNext]
        : Number.POSITIVE_INFINITY,
      modeNext < modeTimes.length ? modeTimes[modeNext] : Number.POSITIVE_INFINITY,
    );
    if (!(nextTimestampUs > timestampUs)) break;
    timestampUs = nextTimestampUs;
  }

  timestampsUs[count] = range.endUs;
  registeredCurrentA[count] = registeredCurrentA[Math.max(0, count - 1)];
  voltageV[count] = voltageV[Math.max(0, count - 1)];
  brownoutThresholdV[count] = brownoutThresholdV[Math.max(0, count - 1)];
  modeCodes[count] = NO_MODE;
  count += 1;

  return {
    timestampsUs: timestampsUs.slice(0, count),
    registeredCurrentA: registeredCurrentA.slice(0, count),
    voltageV: voltageV.slice(0, count),
    brownoutThresholdV: brownoutThresholdV.slice(0, count),
    modeCodes: modeCodes.slice(0, count),
  };
}

function createAccumulator(): SummaryAccumulator {
  return {
    coveredDurationSeconds: 0,
    voltageTime: 0,
    currentTime: 0,
    positiveEnergyJ: 0,
    positiveChargeAmpSeconds: 0,
    currentSquaredTime: 0,
    minimumVoltageV: Number.POSITIVE_INFINITY,
    maximumVoltageV: Number.NEGATIVE_INFINITY,
    minimumCurrentA: Number.POSITIVE_INFINITY,
    maximumCurrentA: Number.NEGATIVE_INFINITY,
    maximumPositiveCurrentA: 0,
  };
}

function addSummarySample(
  accumulator: SummaryAccumulator,
  voltageV: number,
  registeredCurrentA: number,
  durationSeconds: number,
): void {
  accumulator.coveredDurationSeconds += durationSeconds;
  accumulator.voltageTime += voltageV * durationSeconds;
  accumulator.currentTime += registeredCurrentA * durationSeconds;
  accumulator.positiveEnergyJ +=
    Math.max(0, voltageV * registeredCurrentA) * durationSeconds;
  accumulator.positiveChargeAmpSeconds += Math.max(0, registeredCurrentA) * durationSeconds;
  accumulator.currentSquaredTime +=
    registeredCurrentA * registeredCurrentA * durationSeconds;
  accumulator.minimumVoltageV = Math.min(accumulator.minimumVoltageV, voltageV);
  accumulator.maximumVoltageV = Math.max(accumulator.maximumVoltageV, voltageV);
  accumulator.minimumCurrentA = Math.min(accumulator.minimumCurrentA, registeredCurrentA);
  accumulator.maximumCurrentA = Math.max(accumulator.maximumCurrentA, registeredCurrentA);
  accumulator.maximumPositiveCurrentA = Math.max(
    accumulator.maximumPositiveCurrentA,
    registeredCurrentA,
  );
}

function finishSummary(accumulator: SummaryAccumulator): BatteryLoadResponseSummary {
  const duration = accumulator.coveredDurationSeconds;
  return {
    coveredDurationSeconds: duration,
    averageVoltageV: accumulator.voltageTime / duration,
    averageRegisteredCurrentA: accumulator.currentTime / duration,
    positiveRegisteredInputEnergyWh: accumulator.positiveEnergyJ / JOULES_PER_WATT_HOUR,
    positiveRegisteredChargeAh:
      accumulator.positiveChargeAmpSeconds / AMP_SECONDS_PER_AMP_HOUR,
    registeredCurrentSquaredTimeA2Seconds: accumulator.currentSquaredTime,
    minimumVoltageV: accumulator.minimumVoltageV,
    maximumVoltageV: accumulator.maximumVoltageV,
    minimumRegisteredCurrentA: accumulator.minimumCurrentA,
    maximumRegisteredCurrentA: accumulator.maximumCurrentA,
    maximumPositiveRegisteredCurrentA: accumulator.maximumPositiveCurrentA,
  };
}

function quantile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function quantiles(values: readonly number[]): NumericQuantiles {
  return {
    p05: quantile(values, 0.05),
    p25: quantile(values, 0.25),
    median: quantile(values, 0.5),
    p75: quantile(values, 0.75),
    p95: quantile(values, 0.95),
  };
}

function weightedQuantile(
  values: readonly number[],
  weights: readonly number[],
  fraction: number,
): number {
  if (values.length === 0 || values.length !== weights.length) return Number.NaN;
  const indices = Array.from({ length: values.length }, (_, index) => index);
  indices.sort((left, right) => values[left] - values[right]);
  let totalWeight = 0;
  for (const weight of weights) totalWeight += weight;
  if (!(totalWeight > 0)) return Number.NaN;
  const target = totalWeight * fraction;
  let cumulative = 0;
  for (const index of indices) {
    cumulative += weights[index];
    if (cumulative >= target) return values[index];
  }
  return values[indices.at(-1)!];
}

const DEFAULT_OBSERVED_DISTRIBUTION_BIN_COUNT = 32;
const MINIMUM_OBSERVED_DISTRIBUTION_BIN_COUNT = 24;
const MAXIMUM_OBSERVED_DISTRIBUTION_BIN_COUNT = 40;
const NICE_BIN_MULTIPLIERS = [1, 2, 2.5, 5] as const;

interface ObservedDistributionSample {
  readonly currentA: number;
  readonly voltageV: number;
  readonly durationSeconds: number;
}

interface ObservedDistributionAccumulator {
  readonly samples: ObservedDistributionSample[];
  durationSeconds: number;
}

export function binBatteryLoadObservedCurve(
  curve: BatteryLoadObservedCurve,
  options: BatteryLoadObservedDistributionOptions = {},
): BatteryLoadObservedDistribution {
  const count = Math.min(
    curve.registeredCurrentA.length,
    curve.voltageV.length,
    curve.intervalDurationSeconds.length,
  );
  const samples: ObservedDistributionSample[] = [];
  let minimumCurrentA = Number.POSITIVE_INFINITY;
  let maximumCurrentA = Number.NEGATIVE_INFINITY;
  let totalObservedDurationSeconds = 0;
  for (let index = 0; index < count; index += 1) {
    const currentA = curve.registeredCurrentA[index];
    const voltageV = curve.voltageV[index];
    const durationSeconds = curve.intervalDurationSeconds[index];
    if (
      !Number.isFinite(currentA) ||
      !Number.isFinite(voltageV) ||
      !(voltageV > 0) ||
      !Number.isFinite(durationSeconds) ||
      !(durationSeconds > 0)
    ) {
      continue;
    }
    samples.push({ currentA, voltageV, durationSeconds });
    minimumCurrentA = Math.min(minimumCurrentA, currentA);
    maximumCurrentA = Math.max(maximumCurrentA, currentA);
    totalObservedDurationSeconds += durationSeconds;
  }
  if (samples.length === 0) {
    return {
      binWidthA: 0,
      axisMinimumA: 0,
      axisMaximumA: 0,
      totalObservedDurationSeconds: 0,
      validObservationSegmentCount: 0,
      bins: [],
    };
  }

  const requestedWidthA = options.currentBinWidthA;
  const targetBinCount = clampInteger(
    options.targetBinCount ?? DEFAULT_OBSERVED_DISTRIBUTION_BIN_COUNT,
    1,
    MAXIMUM_OBSERVED_DISTRIBUTION_BIN_COUNT,
  );
  const binWidthA = Number.isFinite(requestedWidthA) && requestedWidthA! > 0
    ? requestedWidthA!
    : chooseObservedDistributionBinWidth(minimumCurrentA, maximumCurrentA, targetBinCount);
  const firstBinIndex = Math.floor(minimumCurrentA / binWidthA);
  const lastBinIndex = Math.floor(maximumCurrentA / binWidthA);
  const binCount = lastBinIndex - firstBinIndex + 1;
  const axisMinimumA = normalizeFiniteZero(firstBinIndex * binWidthA);
  const axisMaximumA = normalizeFiniteZero((lastBinIndex + 1) * binWidthA);
  const accumulators: ObservedDistributionAccumulator[] = Array.from(
    { length: binCount },
    () => ({ samples: [], durationSeconds: 0 }),
  );
  for (const sample of samples) {
    const binIndex = Math.max(
      0,
      Math.min(binCount - 1, Math.floor(sample.currentA / binWidthA) - firstBinIndex),
    );
    const accumulator = accumulators[binIndex];
    accumulator.samples.push(sample);
    accumulator.durationSeconds += sample.durationSeconds;
  }

  const bins = accumulators.map<BatteryLoadObservedDistributionBin>((accumulator, index) => {
    const currentMinimumA = normalizeFiniteZero((firstBinIndex + index) * binWidthA);
    const currentMaximumA = normalizeFiniteZero(currentMinimumA + binWidthA);
    const sortedSamples = [...accumulator.samples].sort(
      (left, right) => left.voltageV - right.voltageV,
    );
    return {
      currentMinimumA,
      currentMaximumA,
      currentCenterA: normalizeFiniteZero(currentMinimumA + binWidthA / 2),
      voltageP25V: weightedObservedVoltageQuantile(sortedSamples, accumulator.durationSeconds, 0.25),
      voltageMedianV: weightedObservedVoltageQuantile(sortedSamples, accumulator.durationSeconds, 0.5),
      voltageP75V: weightedObservedVoltageQuantile(sortedSamples, accumulator.durationSeconds, 0.75),
      observedDurationSeconds: accumulator.durationSeconds,
      observationSegmentCount: accumulator.samples.length,
    };
  });

  return {
    binWidthA,
    axisMinimumA,
    axisMaximumA,
    totalObservedDurationSeconds,
    validObservationSegmentCount: samples.length,
    bins,
  };
}

function chooseObservedDistributionBinWidth(
  minimumCurrentA: number,
  maximumCurrentA: number,
  targetBinCount: number,
): number {
  const spanA = maximumCurrentA - minimumCurrentA;
  if (!(spanA > 0)) {
    return nearestNicePositiveStep(Math.max(1, Math.abs(minimumCurrentA) / targetBinCount));
  }
  const rawWidthA = spanA / targetBinCount;
  const baseExponent = Math.floor(Math.log10(rawWidthA));
  let selectedWidthA = Number.NaN;
  let selectedScore = Number.POSITIVE_INFINITY;
  for (let exponentOffset = -2; exponentOffset <= 2; exponentOffset += 1) {
    const scale = 10 ** (baseExponent + exponentOffset);
    for (const multiplier of NICE_BIN_MULTIPLIERS) {
      const widthA = multiplier * scale;
      if (!(widthA > 0) || !Number.isFinite(widthA)) continue;
      const binCount = observedDistributionBinCount(minimumCurrentA, maximumCurrentA, widthA);
      if (binCount > MAXIMUM_OBSERVED_DISTRIBUTION_BIN_COUNT) continue;
      const outsidePreferredRange = binCount < MINIMUM_OBSERVED_DISTRIBUTION_BIN_COUNT;
      const score = Math.abs(binCount - targetBinCount) + (outsidePreferredRange ? 1_000 : 0);
      if (
        score < selectedScore ||
        (score === selectedScore && widthA < selectedWidthA)
      ) {
        selectedWidthA = widthA;
        selectedScore = score;
      }
    }
  }
  return Number.isFinite(selectedWidthA) && selectedWidthA > 0
    ? selectedWidthA
    : nearestNicePositiveStep(rawWidthA);
}

function observedDistributionBinCount(
  minimumCurrentA: number,
  maximumCurrentA: number,
  widthA: number,
): number {
  return Math.floor(maximumCurrentA / widthA) - Math.floor(minimumCurrentA / widthA) + 1;
}

function nearestNicePositiveStep(value: number): number {
  if (!(value > 0) || !Number.isFinite(value)) return 1;
  const exponent = Math.floor(Math.log10(value));
  const scale = 10 ** exponent;
  let selected = NICE_BIN_MULTIPLIERS[0] * scale;
  let distance = Math.abs(Math.log(selected / value));
  for (const multiplier of NICE_BIN_MULTIPLIERS.slice(1)) {
    const candidate = multiplier * scale;
    const candidateDistance = Math.abs(Math.log(candidate / value));
    if (candidateDistance < distance) {
      selected = candidate;
      distance = candidateDistance;
    }
  }
  const nextScaleCandidate = 10 * scale;
  return Math.abs(Math.log(nextScaleCandidate / value)) < distance ? nextScaleCandidate : selected;
}

function weightedObservedVoltageQuantile(
  sortedSamples: readonly ObservedDistributionSample[],
  totalDurationSeconds: number,
  fraction: number,
): number {
  if (sortedSamples.length === 0 || !(totalDurationSeconds > 0)) return Number.NaN;
  const targetDuration = totalDurationSeconds * fraction;
  let cumulativeDuration = 0;
  for (const sample of sortedSamples) {
    cumulativeDuration += sample.durationSeconds;
    if (cumulativeDuration >= targetDuration) return sample.voltageV;
  }
  return sortedSamples.at(-1)!.voltageV;
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.max(minimum, Math.min(maximum, Math.round(value)));
}

function normalizeFiniteZero(value: number): number {
  if (!Number.isFinite(value)) return value;
  const normalized = Number(value.toPrecision(12));
  return Object.is(normalized, -0) ? 0 : normalized;
}

function smallMedian(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  return quantile(values, 0.5);
}

function heldValue(series: NumericSeries, timestampUs: number): number {
  const index = upperBound(series.timestampsUs, timestampUs) - 1;
  return index >= 0 ? series.values[index] : Number.NaN;
}

interface PendingStep {
  timestampUs: number;
  deltaCurrentA: number;
  deltaVoltageV: number;
}

function analyzeStepResponse(
  current: NumericSeries,
  voltage: NumericSeries,
  range: TimeRange,
  options: ResolvedOptions,
): BatteryLoadStepResponse {
  const sampleCount = options.stepWindowSamples;
  const gap = options.stepGapSamples;
  const rangeSampleStart = lowerBound(current.timestampsUs, range.startUs);
  const rangeSampleEnd = lowerBound(current.timestampsUs, range.endUs);
  const rangeSampleCount = rangeSampleEnd - rangeSampleStart;
  const firstCenter = rangeSampleStart + sampleCount + gap;
  const lastCenter = rangeSampleEnd - sampleCount - gap;
  if (lastCenter < firstCenter) {
    return {
      status: "unavailable",
      reason: "INSUFFICIENT_SAMPLES",
      candidateCount: 0,
      discontinuousCandidateCount: 0,
      independentCount: 0,
      inverseVoltageCount: 0,
      rejectedDirectionCount: 0,
    };
  }

  const currentGapPrefix = new Uint32Array(rangeSampleCount + 1);
  const staleVoltagePrefix = new Uint32Array(rangeSampleCount + 1);
  let voltageIndex = upperBound(
    voltage.timestampsUs,
    current.timestampsUs[rangeSampleStart],
  ) - 1;
  for (let relativeIndex = 0; relativeIndex < rangeSampleCount; relativeIndex += 1) {
    const currentIndex = rangeSampleStart + relativeIndex;
    const timestampUs = current.timestampsUs[currentIndex];
    while (
      voltageIndex + 1 < voltage.timestampsUs.length &&
      voltage.timestampsUs[voltageIndex + 1] <= timestampUs
    ) {
      voltageIndex += 1;
    }
    const currentGap = relativeIndex > 0
      ? timestampUs - current.timestampsUs[currentIndex - 1]
      : 0;
    const voltageAge = voltageIndex >= 0
      ? timestampUs - voltage.timestampsUs[voltageIndex]
      : Number.POSITIVE_INFINITY;
    currentGapPrefix[relativeIndex + 1] =
      currentGapPrefix[relativeIndex] +
      (currentGap > options.stepMaximumSampleGapUs ? 1 : 0);
    staleVoltagePrefix[relativeIndex + 1] =
      staleVoltagePrefix[relativeIndex] +
      (voltageAge > options.stepMaximumSampleGapUs ? 1 : 0);
  }

  const timestamps: number[] = [];
  const deltaCurrent: number[] = [];
  const deltaVoltage: number[] = [];
  const proxies: number[] = [];
  let candidateCount = 0;
  let discontinuousCandidateCount = 0;
  let independentCount = 0;
  let rejectedDirectionCount = 0;
  let pending: PendingStep | null = null;

  const commit = (): void => {
    if (!pending) return;
    independentCount += 1;
    const proxyOhm = -pending.deltaVoltageV / pending.deltaCurrentA;
    if (!(proxyOhm > 0) || !Number.isFinite(proxyOhm)) {
      rejectedDirectionCount += 1;
    } else {
      timestamps.push(pending.timestampUs);
      deltaCurrent.push(pending.deltaCurrentA);
      deltaVoltage.push(pending.deltaVoltageV);
      proxies.push(proxyOhm);
    }
    pending = null;
  };

  for (let center = firstCenter; center <= lastCenter; center += 1) {
    const timestampUs = current.timestampsUs[center];
    const beforeCurrent: number[] = [];
    const beforeVoltage: number[] = [];
    const afterCurrent: number[] = [];
    const afterVoltage: number[] = [];
    for (let offset = sampleCount + gap; offset > gap; offset -= 1) {
      const index = center - offset;
      const sampleTimestampUs = current.timestampsUs[index];
      const currentValue = current.values[index];
      const voltageValue = heldValue(voltage, sampleTimestampUs);
      if (Number.isFinite(currentValue) && Number.isFinite(voltageValue) && voltageValue > 0) {
        beforeCurrent.push(currentValue);
        beforeVoltage.push(voltageValue);
      }
    }
    for (let offset = gap; offset < gap + sampleCount; offset += 1) {
      const index = center + offset;
      const sampleTimestampUs = current.timestampsUs[index];
      const currentValue = current.values[index];
      const voltageValue = heldValue(voltage, sampleTimestampUs);
      if (Number.isFinite(currentValue) && Number.isFinite(voltageValue) && voltageValue > 0) {
        afterCurrent.push(currentValue);
        afterVoltage.push(voltageValue);
      }
    }
    if (
      beforeCurrent.length !== sampleCount ||
      beforeVoltage.length !== sampleCount ||
      afterCurrent.length !== sampleCount ||
      afterVoltage.length !== sampleCount
    ) {
      continue;
    }
    const deltaCurrentA = smallMedian(afterCurrent) - smallMedian(beforeCurrent);
    const deltaVoltageV = smallMedian(afterVoltage) - smallMedian(beforeVoltage);
    if (
      !Number.isFinite(deltaCurrentA) ||
      !Number.isFinite(deltaVoltageV) ||
      Math.abs(deltaCurrentA) < options.stepCurrentThresholdA
    ) {
      continue;
    }
    candidateCount += 1;
    const firstWindowRelativeIndex =
      center - sampleCount - gap - rangeSampleStart;
    const lastWindowRelativeIndex =
      center + gap + sampleCount - 1 - rangeSampleStart;
    const currentGapCount =
      currentGapPrefix[lastWindowRelativeIndex + 1] -
      currentGapPrefix[firstWindowRelativeIndex + 1];
    const staleVoltageCount =
      staleVoltagePrefix[lastWindowRelativeIndex + 1] -
      staleVoltagePrefix[firstWindowRelativeIndex];
    if (currentGapCount > 0 || staleVoltageCount > 0) {
      discontinuousCandidateCount += 1;
      continue;
    }
    const next: PendingStep = { timestampUs, deltaCurrentA, deltaVoltageV };
    if (!pending) {
      pending = next;
    } else if (timestampUs - pending.timestampUs <= options.stepRefractoryUs) {
      if (Math.abs(deltaCurrentA) > Math.abs(pending.deltaCurrentA)) pending = next;
    } else {
      commit();
      pending = next;
    }
  }
  commit();

  const inverseVoltageCount = proxies.length;
  if (candidateCount === 0) {
    return {
      status: "unavailable",
      reason: "WEAK_CURRENT_EXCITATION",
      candidateCount,
      discontinuousCandidateCount,
      independentCount,
      inverseVoltageCount,
      rejectedDirectionCount,
    };
  }
  if (discontinuousCandidateCount === candidateCount) {
    return {
      status: "unavailable",
      reason: "INSUFFICIENT_SAMPLES",
      candidateCount,
      discontinuousCandidateCount,
      independentCount,
      inverseVoltageCount,
      rejectedDirectionCount,
    };
  }
  if (inverseVoltageCount < options.minimumIndependentSteps) {
    return {
      status: "unavailable",
      reason: "NO_INVERSE_VOLTAGE_STEPS",
      candidateCount,
      discontinuousCandidateCount,
      independentCount,
      inverseVoltageCount,
      rejectedDirectionCount,
    };
  }

  const medianProxy = quantile(proxies, 0.5);
  const residuals = deltaCurrent.map((value, index) =>
    Math.abs(deltaVoltage[index] + medianProxy * value),
  );
  return {
    status: "available",
    candidateCount,
    discontinuousCandidateCount,
    independentCount,
    inverseVoltageCount,
    rejectedDirectionCount,
    risingStepCount: deltaCurrent.filter((value) => value > 0).length,
    fallingStepCount: deltaCurrent.filter((value) => value < 0).length,
    timestampsUs: Float64Array.from(timestamps),
    deltaRegisteredCurrentA: Float64Array.from(deltaCurrent),
    deltaVoltageV: Float64Array.from(deltaVoltage),
    voltageDropProxyOhm: Float64Array.from(proxies),
    voltageDropProxyQuantilesOhm: quantiles(proxies),
    absoluteResidualQuantilesV: quantiles(residuals),
  };
}

interface LinearFit {
  intercept: number;
  slope: number;
}

function weightedLinearFit(
  x: readonly number[],
  y: readonly number[],
  baseWeights: readonly number[],
  robustWeights?: readonly number[],
): LinearFit | null {
  let sumWeight = 0;
  let sumX = 0;
  let sumY = 0;
  let sumXX = 0;
  let sumXY = 0;
  for (let index = 0; index < x.length; index += 1) {
    const weight = baseWeights[index] * (robustWeights?.[index] ?? 1);
    sumWeight += weight;
    sumX += weight * x[index];
    sumY += weight * y[index];
    sumXX += weight * x[index] * x[index];
    sumXY += weight * x[index] * y[index];
  }
  const denominator = sumWeight * sumXX - sumX * sumX;
  if (!(sumWeight > 0) || Math.abs(denominator) < 1e-12) return null;
  const slope = (sumWeight * sumXY - sumX * sumY) / denominator;
  return { slope, intercept: (sumY - slope * sumX) / sumWeight };
}

interface RobustFit extends LinearFit {
  residualRmsV: number;
  residualMedianAbsoluteV: number;
  residualP95AbsoluteV: number;
}

function robustLinearFit(
  x: readonly number[],
  y: readonly number[],
  weights: readonly number[],
): RobustFit | null {
  let fit = weightedLinearFit(x, y, weights);
  if (!fit) return null;
  for (let iteration = 0; iteration < 10; iteration += 1) {
    const residuals = y.map((value, index) => value - (fit!.intercept + fit!.slope * x[index]));
    const center = weightedQuantile(residuals, weights, 0.5);
    const absoluteCentered = residuals.map((value) => Math.abs(value - center));
    const scale = 1.4826 * weightedQuantile(absoluteCentered, weights, 0.5);
    if (!(scale > 1e-9)) break;
    const cutoff = 1.345 * scale;
    const robustWeights = absoluteCentered.map((value) =>
      value <= cutoff ? 1 : cutoff / value,
    );
    const next = weightedLinearFit(x, y, weights, robustWeights);
    if (!next) break;
    const converged = Math.abs(next.slope - fit.slope) < 1e-10;
    fit = next;
    if (converged) break;
  }
  const residuals = y.map((value, index) => value - (fit.intercept + fit.slope * x[index]));
  const absoluteResiduals = residuals.map(Math.abs);
  let weightedSquared = 0;
  let totalWeight = 0;
  for (let index = 0; index < residuals.length; index += 1) {
    weightedSquared += residuals[index] * residuals[index] * weights[index];
    totalWeight += weights[index];
  }
  return {
    ...fit,
    residualRmsV: Math.sqrt(weightedSquared / totalWeight),
    residualMedianAbsoluteV: weightedQuantile(absoluteResiduals, weights, 0.5),
    residualP95AbsoluteV: weightedQuantile(absoluteResiduals, weights, 0.95),
  };
}

function analyzeLocalWindows(
  timeline: AlignedTimeline,
  range: TimeRange,
  options: ResolvedOptions,
): BatteryLoadLocalWindows {
  const starts: number[] = [];
  const ends: number[] = [];
  const durations: number[] = [];
  const spans: number[] = [];
  const intercepts: number[] = [];
  const proxies: number[] = [];
  const residualRms: number[] = [];
  const residualMedian: number[] = [];
  const residualP95: number[] = [];
  let evaluatedWindowCount = 0;
  let weakExcitationWindowCount = 0;
  let rejectedDirectionWindowCount = 0;
  let intervalIndex = 0;

  for (
    let windowStartUs = range.startUs;
    windowStartUs < range.endUs;
    windowStartUs += options.localWindowDurationUs
  ) {
    const windowEndUs = Math.min(
      range.endUs,
      windowStartUs + options.localWindowDurationUs,
    );
    const x: number[] = [];
    const y: number[] = [];
    const weights: number[] = [];
    while (
      intervalIndex + 1 < timeline.timestampsUs.length &&
      timeline.timestampsUs[intervalIndex + 1] <= windowStartUs
    ) {
      intervalIndex += 1;
    }
    let scan = intervalIndex;
    while (scan + 1 < timeline.timestampsUs.length && timeline.timestampsUs[scan] < windowEndUs) {
      const overlapStartUs = Math.max(windowStartUs, timeline.timestampsUs[scan]);
      const overlapEndUs = Math.min(windowEndUs, timeline.timestampsUs[scan + 1]);
      const durationSeconds = (overlapEndUs - overlapStartUs) / MICROSECONDS_PER_SECOND;
      const currentA = timeline.registeredCurrentA[scan];
      const voltageV = timeline.voltageV[scan];
      if (
        durationSeconds > 0 &&
        Number.isFinite(currentA) &&
        Number.isFinite(voltageV) &&
        voltageV > 0
      ) {
        x.push(currentA);
        y.push(voltageV);
        weights.push(durationSeconds);
      }
      scan += 1;
    }
    evaluatedWindowCount += 1;
    let coveredDuration = 0;
    for (const weight of weights) coveredDuration += weight;
    const windowDuration = (windowEndUs - windowStartUs) / MICROSECONDS_PER_SECOND;
    const currentSpan =
      weightedQuantile(x, weights, 0.95) - weightedQuantile(x, weights, 0.05);
    if (
      x.length < options.localWindowMinimumIntervals ||
      coveredDuration < windowDuration * options.localWindowMinimumCoverageFraction ||
      !(currentSpan >= options.localWindowMinimumCurrentSpanA)
    ) {
      weakExcitationWindowCount += 1;
      continue;
    }
    const fit = robustLinearFit(x, y, weights);
    const proxyOhm = fit ? -fit.slope : Number.NaN;
    if (!fit || !(proxyOhm > 0)) {
      rejectedDirectionWindowCount += 1;
      continue;
    }
    starts.push(windowStartUs);
    ends.push(windowEndUs);
    durations.push(coveredDuration);
    spans.push(currentSpan);
    intercepts.push(fit.intercept);
    proxies.push(proxyOhm);
    residualRms.push(fit.residualRmsV);
    residualMedian.push(fit.residualMedianAbsoluteV);
    residualP95.push(fit.residualP95AbsoluteV);
  }

  if (proxies.length === 0) {
    return {
      status: "unavailable",
      reason:
        weakExcitationWindowCount === evaluatedWindowCount
          ? "WEAK_CURRENT_EXCITATION"
          : "NO_INVERSE_VOLTAGE_WINDOWS",
      evaluatedWindowCount,
      weakExcitationWindowCount,
      rejectedDirectionWindowCount,
    };
  }
  return {
    status: "available",
    evaluatedWindowCount,
    weakExcitationWindowCount,
    rejectedDirectionWindowCount,
    windowStartUs: Float64Array.from(starts),
    windowEndUs: Float64Array.from(ends),
    coveredDurationSeconds: Float64Array.from(durations),
    currentSpanA: Float64Array.from(spans),
    interceptVoltageV: Float64Array.from(intercepts),
    voltageDropProxyOhm: Float64Array.from(proxies),
    residualRmsV: Float64Array.from(residualRms),
    residualMedianAbsoluteV: Float64Array.from(residualMedian),
    residualP95AbsoluteV: Float64Array.from(residualP95),
    voltageDropProxyQuantilesOhm: quantiles(proxies),
  };
}

function observedBrownouts(
  dataset: EnergyLogDataset,
  range: TimeRange,
): BatteryLoadObservedBrownoutEvents {
  if (!dataset.series.brownedOut) {
    return { status: "unavailable", reason: "BROWNOUT_SIGNAL_UNAVAILABLE" };
  }
  const intervals = rangeIntersections(dataset.segments.brownouts, range);
  return {
    status: "available",
    eventCount: intervals.length,
    durationSeconds: intervals.reduce((sum, interval) => sum + interval.durationSeconds, 0),
  };
}

function brownoutModeStats(
  modes: readonly ModeInterval[],
  brownouts: readonly { startUs: number; endUs: number }[],
  range: TimeRange,
): Readonly<Partial<Record<DriverStationMode, { count: number; durationSeconds: number }>>> {
  const result: Partial<Record<DriverStationMode, { count: number; durationSeconds: number }>> = {};
  let modeIndex = 0;
  let brownoutIndex = 0;
  while (modeIndex < modes.length && brownoutIndex < brownouts.length) {
    const mode = modes[modeIndex];
    const brownout = brownouts[brownoutIndex];
    const startUs = Math.max(range.startUs, mode.startUs, brownout.startUs);
    const endUs = Math.min(range.endUs, mode.endUs, brownout.endUs);
    if (endUs > startUs) {
      const current = result[mode.mode] ?? { count: 0, durationSeconds: 0 };
      current.count += 1;
      current.durationSeconds += (endUs - startUs) / MICROSECONDS_PER_SECOND;
      result[mode.mode] = current;
    }
    if (mode.endUs <= brownout.endUs) modeIndex += 1;
    if (brownout.endUs <= mode.endUs) brownoutIndex += 1;
  }
  return result;
}

/**
 * Describes observed voltage response to the registered EnergyLogger V2 motor load.
 * The result intentionally contains no configuration-change voltage or Brownout prediction.
 */
export function analyzeBatteryLoadResponse(
  dataset: EnergyLogDataset,
  requestedRange: Partial<TimeRange> = {},
  requestedOptions: BatteryLoadResponseOptions = {},
): BatteryLoadResponseAnalysis {
  if (dataset.sourceContract !== "v2" || !dataset.v2) return unavailable("V2_REQUIRED");
  const voltage = dataset.series.batteryVoltageV;
  if (!voltage) return unavailable("BATTERY_VOLTAGE_UNAVAILABLE");
  const range = resolveRange(dataset, requestedRange);
  if (!range) return unavailable("INVALID_RANGE");
  const options = resolveOptions(requestedOptions);
  const current = dataset.series.totalCurrentA;
  const timeline = buildAlignedTimeline(
    current,
    voltage,
    dataset.series.brownoutVoltageV,
    dataset.segments.modes,
    range,
  );

  const summaryAccumulator = createAccumulator();
  const modeAccumulators = MODES.map(() => createAccumulator());
  const modeLowVoltageDuration = new Float64Array(MODES.length);
  const observedTimestamps = new Float64Array(Math.max(0, timeline.timestampsUs.length - 1));
  const observedCurrent = new Float64Array(observedTimestamps.length);
  const observedVoltage = new Float64Array(observedTimestamps.length);
  const observedDuration = new Float64Array(observedTimestamps.length);
  const completeCurrents: number[] = [];
  const completeCurrentDurations: number[] = [];
  let observedCount = 0;
  let completeIntervalCount = 0;
  let droppedIntervalCount = 0;
  let positiveCurrentDurationSeconds = 0;
  let negativeCurrentDurationSeconds = 0;
  let zeroCurrentDurationSeconds = 0;
  let thresholdCoveredDurationSeconds = 0;
  let thresholdVoltageTime = 0;
  let lowVoltageEventCount = 0;
  let lowVoltageDurationSeconds = 0;
  let minimumVoltageMarginV = Number.POSITIVE_INFINITY;
  let wasBelowThreshold = false;

  for (let index = 0; index + 1 < timeline.timestampsUs.length; index += 1) {
    const durationSeconds =
      (timeline.timestampsUs[index + 1] - timeline.timestampsUs[index]) /
      MICROSECONDS_PER_SECOND;
    if (!(durationSeconds > 0)) continue;
    const currentA = timeline.registeredCurrentA[index];
    const voltageV = timeline.voltageV[index];
    const thresholdV = timeline.brownoutThresholdV[index];
    const modeCode = timeline.modeCodes[index];
    const complete = Number.isFinite(currentA) && Number.isFinite(voltageV) && voltageV > 0;
    if (complete) {
      completeIntervalCount += 1;
      addSummarySample(summaryAccumulator, voltageV, currentA, durationSeconds);
      if (modeCode !== NO_MODE) {
        addSummarySample(modeAccumulators[modeCode], voltageV, currentA, durationSeconds);
      }
      if (currentA > 0) positiveCurrentDurationSeconds += durationSeconds;
      else if (currentA < 0) negativeCurrentDurationSeconds += durationSeconds;
      else zeroCurrentDurationSeconds += durationSeconds;
      completeCurrents.push(currentA);
      completeCurrentDurations.push(durationSeconds);

      const previous = observedCount - 1;
      if (
        previous >= 0 &&
        observedCurrent[previous] === currentA &&
        observedVoltage[previous] === voltageV
      ) {
        observedDuration[previous] += durationSeconds;
      } else {
        observedTimestamps[observedCount] = timeline.timestampsUs[index];
        observedCurrent[observedCount] = currentA;
        observedVoltage[observedCount] = voltageV;
        observedDuration[observedCount] = durationSeconds;
        observedCount += 1;
      }
    } else {
      droppedIntervalCount += 1;
    }

    if (Number.isFinite(voltageV) && voltageV > 0 && Number.isFinite(thresholdV) && thresholdV > 0) {
      thresholdCoveredDurationSeconds += durationSeconds;
      thresholdVoltageTime += thresholdV * durationSeconds;
      const marginV = voltageV - thresholdV;
      minimumVoltageMarginV = Math.min(minimumVoltageMarginV, marginV);
      const below = marginV < 0;
      if (below && !wasBelowThreshold) lowVoltageEventCount += 1;
      if (below) {
        lowVoltageDurationSeconds += durationSeconds;
        if (modeCode !== NO_MODE) modeLowVoltageDuration[modeCode] += durationSeconds;
      }
      wasBelowThreshold = below;
    } else {
      wasBelowThreshold = false;
    }
  }

  if (!(summaryAccumulator.coveredDurationSeconds > 0)) {
    return unavailable("NO_COMPLETE_INTERVALS");
  }

  const summary = finishSummary(summaryAccumulator);
  const currentSpanA =
    weightedQuantile(completeCurrents, completeCurrentDurations, 0.95) -
    weightedQuantile(completeCurrents, completeCurrentDurations, 0.05);
  const lowVoltage: BatteryLoadObservedLowVoltage = thresholdCoveredDurationSeconds > 0
    ? {
        status: "available",
        coveredDurationSeconds: thresholdCoveredDurationSeconds,
        eventCount: lowVoltageEventCount,
        durationSeconds: lowVoltageDurationSeconds,
        averageThresholdV: thresholdVoltageTime / thresholdCoveredDurationSeconds,
        minimumMarginV: minimumVoltageMarginV,
      }
    : { status: "unavailable", reason: "BROWNOUT_VOLTAGE_UNAVAILABLE" };
  const brownoutEvents = observedBrownouts(dataset, range);
  const brownoutByMode = dataset.series.brownedOut
    ? brownoutModeStats(dataset.segments.modes, dataset.segments.brownouts, range)
    : {};
  const modeStats: Partial<Record<DriverStationMode, BatteryLoadModeStats>> = {};
  for (const mode of MODES) {
    const code = MODE_CODES[mode];
    const accumulator = modeAccumulators[code];
    if (!(accumulator.coveredDurationSeconds > 0)) continue;
    modeStats[mode] = {
      summary: finishSummary(accumulator),
      lowVoltageDurationSeconds:
        lowVoltage.status === "available" ? modeLowVoltageDuration[code] : null,
      brownoutEventCount:
        brownoutEvents.status === "available" ? (brownoutByMode[mode]?.count ?? 0) : null,
      brownoutDurationSeconds:
        brownoutEvents.status === "available"
          ? (brownoutByMode[mode]?.durationSeconds ?? 0)
          : null,
    };
  }

  const limitations: string[] = [...DEFAULT_LIMITATIONS];
  if (dataset.segments.modes.length === 0) limitations.push("日志没有可用 Robot Mode 区间。");
  if (lowVoltage.status === "unavailable") limitations.push("日志没有可用 Brownout 电压序列。");
  if (brownoutEvents.status === "unavailable") limitations.push("日志没有可用 Brownout 状态序列。");

  return {
    status: "available",
    range,
    summary,
    quality: {
      requestedDurationSeconds: range.durationSeconds,
      timelineIntervalCount: timeline.timestampsUs.length - 1,
      completeIntervalCount,
      droppedIntervalCount,
      coveredDurationSeconds: summary.coveredDurationSeconds,
      coverageFraction: summary.coveredDurationSeconds / range.durationSeconds,
      positiveCurrentDurationSeconds,
      negativeCurrentDurationSeconds,
      zeroCurrentDurationSeconds,
      observedCurrentSpanA: currentSpanA,
    },
    stepResponse: analyzeStepResponse(current, voltage, range, options),
    localWindows: analyzeLocalWindows(timeline, range, options),
    modeStats,
    observedCurve: {
      timestampsUs: observedTimestamps.slice(0, observedCount),
      registeredCurrentA: observedCurrent.slice(0, observedCount),
      voltageV: observedVoltage.slice(0, observedCount),
      intervalDurationSeconds: observedDuration.slice(0, observedCount),
      registeredCurrentRangeA: {
        minimum: summary.minimumRegisteredCurrentA,
        maximum: summary.maximumRegisteredCurrentA,
      },
      voltageRangeV: { minimum: summary.minimumVoltageV, maximum: summary.maximumVoltageV },
    },
    lowVoltage,
    brownoutEvents,
    limitations,
  };
}
