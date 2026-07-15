import { analyzeEnergyRange } from "./energy-analysis";
import { rangeIntersections, upperBound } from "./time-series";
import {
  deriveEnergyLoggerV2MotorGroupElectricalSeries,
  type EnergyLoggerV2MotorGroupElectricalSeries,
} from "./v2-metrics";
import type {
  EnergyLogDataset,
  NumericSeries,
  SupplyCurrentLimitInput,
  SupplyLimitEstimate,
  SupplyLimitEstimateOptions,
  SupplyLimitMetricSnapshot,
  SupplyLimitMotorGroupMetrics,
  SupplyLimitTargetEstimate,
  SupplyLimitValidationIssue,
  SupplyLimitWarning,
  SupplyLimitWarningCode,
  TimeRange,
} from "./types";

const CURRENT_TOLERANCE_A = 1e-6;

interface HeldNumericCursor {
  series: NumericSeries;
  index: number;
  value: number;
}

interface ActiveTarget {
  input: SupplyCurrentLimitInput;
  group: EnergyLoggerV2MotorGroupElectricalSeries;
  baseline: SupplyLimitMetricSnapshot;
  warnings: SupplyLimitWarning[];
  removedCurrentA: number;
  estimatedPeakCurrentA: number;
  estimatedPeakCurrentTimestampUs: number;
  estimatedPeakPowerW: number;
  estimatedPeakPowerTimestampUs: number;
  clippedDurationSeconds: number;
  ampSecondsRemoved: number;
  triggered: boolean;
  sawNonfinite: boolean;
  estimatedEnergyWh: number;
  estimatedEnabledEnergyWh: number;
  currentCursor: HeldNumericCursor;
  powerCursor: HeldNumericCursor;
}

interface TimestampCursor {
  series: Float64Array;
  index: number;
  timestampUs: number;
}

export class SupplyLimitValidationError extends Error {
  readonly issues: SupplyLimitValidationIssue[];

  constructor(issues: SupplyLimitValidationIssue[]) {
    super(issues.map((issue) => issue.message).join("; "));
    this.name = "SupplyLimitValidationError";
    this.issues = issues;
  }
}

function isActive(input: SupplyCurrentLimitInput): boolean {
  return input.enabled !== false;
}

function groupLabel(group: EnergyLoggerV2MotorGroupElectricalSeries): string {
  return `${group.subsystemName}/${group.leaderName}`;
}

export function validateSupplyCurrentLimits(
  dataset: EnergyLogDataset,
  limits: readonly SupplyCurrentLimitInput[],
): SupplyLimitValidationIssue[] {
  const groups = deriveEnergyLoggerV2MotorGroupElectricalSeries(dataset);
  if (!groups) {
    return [{
      code: "V2_MOTOR_GROUPS_REQUIRED",
      message: "当前 V1 日志没有电机 Manifest，无法按 Leader 电机组进行限流模拟。",
    }];
  }

  const issues: SupplyLimitValidationIssue[] = [];
  const groupsById = new Map(groups.map((group) => [group.id, group]));
  const firstInputByGroup = new Map<string, number>();
  limits.forEach((input, inputIndex) => {
    if (!groupsById.has(input.motorGroupId)) {
      issues.push({
        code: "UNKNOWN_MOTOR_GROUP",
        message: `日志中不存在 Manifest Leader 电机组：${input.motorGroupId}`,
        inputIndex,
        motorGroupIds: [input.motorGroupId],
      });
    }

    const previousIndex = firstInputByGroup.get(input.motorGroupId);
    if (previousIndex !== undefined) {
      issues.push({
        code: "DUPLICATE_TARGET",
        message: `限流方案重复选择了同一个电机组：${input.motorGroupId}`,
        inputIndex,
        motorGroupIds: [input.motorGroupId],
      });
    } else {
      firstInputByGroup.set(input.motorGroupId, inputIndex);
    }

    if (isActive(input) && (!Number.isFinite(input.limitA) || input.limitA < 0)) {
      issues.push({
        code: "INVALID_LIMIT",
        message: `${input.motorGroupId} 的电机组合计 Supply Current 上限必须是大于或等于 0 的有限数字。`,
        inputIndex,
        motorGroupIds: [input.motorGroupId],
      });
    }
  });
  return issues;
}

function resolveRange(
  dataset: EnergyLogDataset,
  requested: Partial<TimeRange> | undefined,
): TimeRange & { durationSeconds: number } {
  const requestedStartUs = requested?.startUs ?? dataset.bounds.energyStartUs;
  const requestedEndUs = requested?.endUs ?? dataset.bounds.energyEndUs;
  if (
    !Number.isFinite(requestedStartUs) ||
    !Number.isFinite(requestedEndUs) ||
    requestedEndUs < requestedStartUs
  ) {
    throw new SupplyLimitValidationError([{
      code: "INVALID_RANGE",
      message: "限流模拟范围必须使用有限时间戳，并且终点不能早于起点。",
    }]);
  }
  const startUs = Math.max(dataset.bounds.energyStartUs, Math.round(requestedStartUs));
  const endUs = Math.min(dataset.bounds.energyEndUs, Math.round(requestedEndUs));
  if (endUs < startUs) {
    throw new SupplyLimitValidationError([{
      code: "INVALID_RANGE",
      message: "限流模拟范围不在日志的能量数据范围内。",
    }]);
  }
  return { startUs, endUs, durationSeconds: (endUs - startUs) / 1_000_000 };
}

function heldNumeric(series: NumericSeries, timestampUs: number, fallback = 0): number {
  const index = upperBound(series.timestampsUs, timestampUs) - 1;
  return index >= 0 ? series.values[index] : fallback;
}

function isEnabledAt(dataset: EnergyLogDataset, timestampUs: number): boolean {
  const series = dataset.series.enabled;
  if (!series) return true;
  const index = upperBound(series.timestampsUs, timestampUs) - 1;
  return index >= 0 && series.values[index] !== 0;
}

function createHeldNumericCursor(
  series: NumericSeries,
  startUs: number,
  fallback = 0,
): HeldNumericCursor {
  return {
    series,
    index: upperBound(series.timestampsUs, startUs),
    value: heldNumeric(series, startUs, fallback),
  };
}

function advanceHeldNumericCursor(cursor: HeldNumericCursor, timestampUs: number): number {
  while (
    cursor.index < cursor.series.timestampsUs.length &&
    cursor.series.timestampsUs[cursor.index] <= timestampUs
  ) {
    cursor.value = cursor.series.values[cursor.index];
    cursor.index += 1;
  }
  return cursor.value;
}

function currentScale(currentA: number, limitA: number): number {
  return Number.isFinite(currentA) && currentA > 0
    ? Math.min(1, limitA / currentA)
    : 1;
}

function positivePowerEnergyInRange(
  powerW: NumericSeries,
  range: TimeRange,
): number {
  if (range.endUs <= range.startUs) return 0;
  const cursor = createHeldNumericCursor(powerW, range.startUs, Number.NaN);
  let previousTimestampUs: number | undefined;
  let energyWh = 0;
  forEachMergedTimestamp([powerW], range.startUs, range.endUs, (timestampUs) => {
    if (previousTimestampUs !== undefined && Number.isFinite(cursor.value)) {
      const durationHours = (timestampUs - previousTimestampUs) / 3_600_000_000;
      energyWh += Math.max(0, cursor.value) * durationHours;
    }
    advanceHeldNumericCursor(cursor, timestampUs);
    previousTimestampUs = timestampUs;
  });
  return energyWh;
}

function limitedGroupEnergyInRange(
  group: EnergyLoggerV2MotorGroupElectricalSeries,
  limitA: number,
  range: TimeRange,
): { estimatedWh: number; sawNonfinite: boolean } {
  if (range.endUs <= range.startUs) return { estimatedWh: 0, sawNonfinite: false };
  const currentCursor = createHeldNumericCursor(group.currentA, range.startUs, Number.NaN);
  const powerCursor = createHeldNumericCursor(group.powerW, range.startUs, Number.NaN);
  let previousTimestampUs: number | undefined;
  let estimatedWh = 0;
  let sawNonfinite = false;
  forEachMergedTimestamp([group.currentA, group.powerW], range.startUs, range.endUs, (timestampUs) => {
    if (previousTimestampUs !== undefined) {
      if (Number.isFinite(currentCursor.value) && Number.isFinite(powerCursor.value)) {
        const scale = currentScale(currentCursor.value, limitA);
        const estimatedPowerW = powerCursor.value > 0 ? powerCursor.value * scale : powerCursor.value;
        const durationHours = (timestampUs - previousTimestampUs) / 3_600_000_000;
        estimatedWh += Math.max(0, estimatedPowerW) * durationHours;
      } else {
        sawNonfinite = true;
      }
    }
    advanceHeldNumericCursor(currentCursor, timestampUs);
    advanceHeldNumericCursor(powerCursor, timestampUs);
    previousTimestampUs = timestampUs;
  });
  return { estimatedWh, sawNonfinite };
}

function peakInRange(series: NumericSeries, range: TimeRange): { value: number; timestampUs: number } {
  let value = heldNumeric(series, range.startUs, Number.NaN);
  let timestampUs = range.startUs;
  if (!Number.isFinite(value)) value = Number.NEGATIVE_INFINITY;
  let index = upperBound(series.timestampsUs, range.startUs);
  while (index < series.timestampsUs.length && series.timestampsUs[index] <= range.endUs) {
    const candidate = series.values[index];
    if (Number.isFinite(candidate) && candidate > value) {
      value = candidate;
      timestampUs = series.timestampsUs[index];
    }
    index += 1;
  }
  return {
    value: Number.isFinite(value) ? value : 0,
    timestampUs,
  };
}

function groupHasUsableData(
  group: EnergyLoggerV2MotorGroupElectricalSeries,
  range: TimeRange,
): boolean {
  if (range.endUs <= range.startUs) return false;
  const currentCursor = createHeldNumericCursor(group.currentA, range.startUs, Number.NaN);
  const powerCursor = createHeldNumericCursor(group.powerW, range.startUs, Number.NaN);
  let usable = false;
  forEachMergedTimestamp([group.currentA, group.powerW], range.startUs, range.endUs, (timestampUs) => {
    if (usable || timestampUs >= range.endUs) return;
    const currentA = advanceHeldNumericCursor(currentCursor, timestampUs);
    const powerW = advanceHeldNumericCursor(powerCursor, timestampUs);
    if (Number.isFinite(currentA) && Number.isFinite(powerW)) usable = true;
  });
  return usable;
}

function metricSnapshot(
  dataset: EnergyLogDataset,
  group: EnergyLoggerV2MotorGroupElectricalSeries,
  range: TimeRange & { durationSeconds: number },
): SupplyLimitMetricSnapshot {
  const energyWh = positivePowerEnergyInRange(group.powerW, range);
  const peakPower = peakInRange(group.powerW, range);
  const peakCurrent = peakInRange(group.currentA, range);
  const enabledIntervals = rangeIntersections(dataset.segments.enabled, range);
  const enabledDurationSeconds = enabledIntervals.reduce(
    (sum, interval) => sum + interval.durationSeconds,
    0,
  );
  const averagePowerW = dataset.series.enabled
    ? enabledDurationSeconds > 0
      ? enabledIntervals.reduce(
          (sum, interval) => sum + positivePowerEnergyInRange(group.powerW, interval),
          0,
        ) * 3600 / enabledDurationSeconds
      : 0
    : range.durationSeconds > 0
      ? energyWh * 3600 / range.durationSeconds
      : 0;
  return {
    energyWh,
    averagePowerW,
    peakPowerW: peakPower.value,
    peakPowerTimestampUs: peakPower.timestampUs,
    peakCurrentA: peakCurrent.value,
    peakCurrentTimestampUs: peakCurrent.timestampUs,
  };
}

export function analyzeSupplyLimitMotorGroups(
  dataset: EnergyLogDataset,
  requested: Partial<TimeRange> = {},
): SupplyLimitMotorGroupMetrics[] | undefined {
  const groups = deriveEnergyLoggerV2MotorGroupElectricalSeries(dataset);
  if (!groups) return undefined;
  const range = resolveRange(dataset, requested);
  const robotEnergyWh = analyzeEnergyRange(dataset, range).totals.energyWh;
  return groups
    .map((group) => ({
      motorGroupId: group.id,
      subsystemId: group.subsystemId,
      subsystemName: group.subsystemName,
      leaderName: group.leaderName,
      motorNames: group.motorNames,
      motorType: group.motorType,
      motorCount: group.motorCount,
      baseline: metricSnapshot(dataset, group, range),
      robotPositiveInputRatio: robotEnergyWh > 0
        ? positivePowerEnergyInRange(group.powerW, range) / robotEnergyWh
        : null,
      ...(!groupHasUsableData(group, range)
        ? { unavailableReason: "该电机组在当前范围内没有完整的 Supply Current 与功率区间。" }
        : {}),
    }))
    .sort((left, right) =>
      right.baseline.energyWh - left.baseline.energyWh ||
      left.motorGroupId.localeCompare(right.motorGroupId),
    );
}

function heapPush(heap: TimestampCursor[], cursor: TimestampCursor): void {
  heap.push(cursor);
  let index = heap.length - 1;
  while (index > 0) {
    const parent = (index - 1) >>> 1;
    if (heap[parent].timestampUs <= cursor.timestampUs) break;
    heap[index] = heap[parent];
    index = parent;
  }
  heap[index] = cursor;
}

function heapPop(heap: TimestampCursor[]): TimestampCursor | undefined {
  if (heap.length === 0) return undefined;
  const first = heap[0];
  const last = heap.pop()!;
  if (heap.length === 0) return first;
  let index = 0;
  while (true) {
    const left = index * 2 + 1;
    if (left >= heap.length) break;
    const right = left + 1;
    const child = right < heap.length && heap[right].timestampUs < heap[left].timestampUs
      ? right
      : left;
    if (heap[child].timestampUs >= last.timestampUs) break;
    heap[index] = heap[child];
    index = child;
  }
  heap[index] = last;
  return first;
}

function forEachMergedTimestamp(
  series: readonly Pick<NumericSeries, "timestampsUs">[],
  startUs: number,
  endUs: number,
  visit: (timestampUs: number) => void,
): void {
  visit(startUs);
  if (startUs === endUs) return;
  const heap: TimestampCursor[] = [];
  for (const item of series) {
    const index = upperBound(item.timestampsUs, startUs);
    if (index < item.timestampsUs.length && item.timestampsUs[index] < endUs) {
      heapPush(heap, { series: item.timestampsUs, index, timestampUs: item.timestampsUs[index] });
    }
  }
  let previousTimestampUs = startUs;
  while (heap.length > 0) {
    const cursor = heapPop(heap)!;
    if (cursor.timestampUs !== previousTimestampUs) {
      previousTimestampUs = cursor.timestampUs;
      visit(cursor.timestampUs);
    }
    cursor.index += 1;
    if (cursor.index < cursor.series.length && cursor.series[cursor.index] < endUs) {
      cursor.timestampUs = cursor.series[cursor.index];
      heapPush(heap, cursor);
    }
  }
  visit(endUs);
}

function hasNegativeValue(series: NumericSeries, range: TimeRange): boolean {
  if (heldNumeric(series, range.startUs, 0) < 0) return true;
  let index = upperBound(series.timestampsUs, range.startUs);
  while (index < series.timestampsUs.length && series.timestampsUs[index] <= range.endUs) {
    if (series.values[index] < 0) return true;
    index += 1;
  }
  return false;
}

function warning(
  code: SupplyLimitWarningCode,
  message: string,
  motorGroupId?: string,
  details?: Record<string, unknown>,
): SupplyLimitWarning {
  return { code, message, motorGroupId, details };
}

function sourceQualityWarnings(dataset: EnergyLogDataset): SupplyLimitWarning[] {
  const mappings: Partial<Record<string, [SupplyLimitWarningCode, string]>> = {
    NONFINITE_VALUE_DROPPED: [
      "SOURCE_NONFINITE_DROPPED",
      "源日志包含非有限样本；对应区间不会凭空补值。",
    ],
    TIME_GAP: ["SOURCE_TIME_GAP", "源日志包含时间断层，结果仅覆盖实际记录区间。"],
    PARTIAL_SUBSERIES: [
      "SOURCE_PARTIAL_SUBSERIES",
      "源日志包含不完整的 EnergyLogger 子序列；对应区间不会参与扣减。",
    ],
  };
  const counts = new Map<string, number>();
  for (const issue of dataset.quality.issues) {
    if (mappings[issue.code]) counts.set(issue.code, (counts.get(issue.code) ?? 0) + 1);
  }
  return [...counts].map(([sourceCode, count]) => {
    const [code, message] = mappings[sourceCode]!;
    return warning(code, message, undefined, { sourceCode, count });
  });
}

function updateTargetAtTimestamp(target: ActiveTarget, timestampUs: number): void {
  const currentA = advanceHeldNumericCursor(target.currentCursor, timestampUs);
  const powerW = advanceHeldNumericCursor(target.powerCursor, timestampUs);
  if (!Number.isFinite(currentA) || !Number.isFinite(powerW)) {
    target.removedCurrentA = 0;
    target.sawNonfinite = true;
    return;
  }
  const scale = currentScale(currentA, target.input.limitA);
  const estimatedCurrentA = currentA > 0 ? Math.min(currentA, target.input.limitA) : currentA;
  const estimatedPowerW = powerW > 0 ? powerW * scale : powerW;
  target.removedCurrentA = currentA - estimatedCurrentA;
  if (target.removedCurrentA > CURRENT_TOLERANCE_A) target.triggered = true;
  if (estimatedCurrentA > target.estimatedPeakCurrentA) {
    target.estimatedPeakCurrentA = estimatedCurrentA;
    target.estimatedPeakCurrentTimestampUs = timestampUs;
  }
  if (estimatedPowerW > target.estimatedPeakPowerW) {
    target.estimatedPeakPowerW = estimatedPowerW;
    target.estimatedPeakPowerTimestampUs = timestampUs;
  }
}

export function estimateSupplyCurrentLimits(
  dataset: EnergyLogDataset,
  options: SupplyLimitEstimateOptions,
): SupplyLimitEstimate {
  const validationIssues = validateSupplyCurrentLimits(dataset, options.limits);
  if (validationIssues.length > 0) throw new SupplyLimitValidationError(validationIssues);
  const groups = deriveEnergyLoggerV2MotorGroupElectricalSeries(dataset)!;
  const groupsById = new Map(groups.map((group) => [group.id, group]));
  const range = resolveRange(dataset, options.range);
  const limits = options.limits
    .map((input) => ({ ...input }))
    .sort((left, right) => left.motorGroupId.localeCompare(right.motorGroupId));
  const activeInputs = limits.filter(isActive);
  const unavailableIssues = activeInputs.flatMap((input, inputIndex) => {
    const group = groupsById.get(input.motorGroupId)!;
    return groupHasUsableData(group, range)
      ? []
      : [{
          code: "MOTOR_GROUP_DATA_UNAVAILABLE" as const,
          message: `${groupLabel(group)} 在当前范围内没有完整的 Supply Current 与功率区间。`,
          inputIndex,
          motorGroupIds: [group.id],
        }];
  });
  if (unavailableIssues.length > 0) throw new SupplyLimitValidationError(unavailableIssues);

  const baselineRange = analyzeEnergyRange(dataset, range);
  const enabledIntervals = rangeIntersections(dataset.segments.enabled, range);
  const enabledDurationSeconds = enabledIntervals.reduce(
    (sum, interval) => sum + interval.durationSeconds,
    0,
  );
  const targets: ActiveTarget[] = activeInputs.map((input) => {
    const group = groupsById.get(input.motorGroupId)!;
    const targetWarnings: SupplyLimitWarning[] = [];
    if (input.limitA === 0) {
      targetWarnings.push(warning(
        "THEORETICAL_SHUTDOWN",
        `${groupLabel(group)} 使用 0 A 电机组上限，仅代表理论关闭场景。`,
        group.id,
      ));
    }
    if (hasNegativeValue(group.currentA, range) || hasNegativeValue(group.powerW, range)) {
      targetWarnings.push(warning(
        "SOURCE_NEGATIVE_VALUE",
        `${groupLabel(group)} 包含负 Supply Current 或负功率；这些样本保持原样，不参与正向限流扣减。`,
        group.id,
      ));
    }
    const limitedEnergy = limitedGroupEnergyInRange(group, input.limitA, range);
    const estimatedEnabledEnergyWh = dataset.series.enabled && enabledDurationSeconds > 0
      ? enabledIntervals.reduce(
          (sum, interval) =>
            sum + limitedGroupEnergyInRange(group, input.limitA, interval).estimatedWh,
          0,
        )
      : limitedEnergy.estimatedWh;
    return {
      input,
      group,
      baseline: metricSnapshot(dataset, group, range),
      warnings: targetWarnings,
      removedCurrentA: 0,
      estimatedPeakCurrentA: Number.NEGATIVE_INFINITY,
      estimatedPeakCurrentTimestampUs: range.startUs,
      estimatedPeakPowerW: Number.NEGATIVE_INFINITY,
      estimatedPeakPowerTimestampUs: range.startUs,
      clippedDurationSeconds: 0,
      ampSecondsRemoved: 0,
      triggered: false,
      sawNonfinite: limitedEnergy.sawNonfinite,
      estimatedEnergyWh: limitedEnergy.estimatedWh,
      estimatedEnabledEnergyWh,
      currentCursor: createHeldNumericCursor(group.currentA, range.startUs, Number.NaN),
      powerCursor: createHeldNumericCursor(group.powerW, range.startUs, Number.NaN),
    };
  });

  for (const target of targets) {
    let previousTimestampUs: number | undefined;
    forEachMergedTimestamp(
      [target.group.currentA, target.group.powerW],
      range.startUs,
      range.endUs,
      (timestampUs) => {
        if (previousTimestampUs !== undefined && target.removedCurrentA > CURRENT_TOLERANCE_A) {
          const durationSeconds = (timestampUs - previousTimestampUs) / 1_000_000;
          target.clippedDurationSeconds += durationSeconds;
          target.ampSecondsRemoved += target.removedCurrentA * durationSeconds;
        }
        updateTargetAtTimestamp(target, timestampUs);
        previousTimestampUs = timestampUs;
      },
    );
  }

  let robotEstimateAvailable = true;
  const unavailableReasons = new Set<string>();
  let estimatedPeakCurrentA = Number.NEGATIVE_INFINITY;
  let estimatedPeakCurrentTimestampUs = range.startUs;
  let estimatedPeakPowerW = Number.NEGATIVE_INFINITY;
  let estimatedPeakPowerTimestampUs = range.startUs;
  let estimatedTotalEnergyWh = 0;
  let estimatedTotalEnabledEnergyWh = 0;
  let previousRobotTimestampUs: number | undefined;
  let previousEstimatedPowerW = 0;
  const totalCurrentCursor = createHeldNumericCursor(dataset.series.totalCurrentA, range.startUs);
  const totalPowerCursor = createHeldNumericCursor(dataset.series.totalPowerW, range.startUs);
  const robotGroupCursors = targets.map((target) => ({
    target,
    current: createHeldNumericCursor(target.group.currentA, range.startUs, Number.NaN),
    power: createHeldNumericCursor(target.group.powerW, range.startUs, Number.NaN),
  }));
  forEachMergedTimestamp(
    [
      dataset.series.totalCurrentA,
      dataset.series.totalPowerW,
      ...(dataset.series.enabled
        ? [{ timestampsUs: dataset.series.enabled.timestampsUs }]
        : []),
    ],
    range.startUs,
    range.endUs,
    (timestampUs) => {
      if (previousRobotTimestampUs !== undefined) {
        const durationHours = (timestampUs - previousRobotTimestampUs) / 3_600_000_000;
        const positiveEnergyWh = Math.max(0, previousEstimatedPowerW) * durationHours;
        estimatedTotalEnergyWh += positiveEnergyWh;
        if (isEnabledAt(dataset, previousRobotTimestampUs)) {
          estimatedTotalEnabledEnergyWh += positiveEnergyWh;
        }
      }
      const totalCurrentA = advanceHeldNumericCursor(totalCurrentCursor, timestampUs);
      const totalPowerW = advanceHeldNumericCursor(totalPowerCursor, timestampUs);
      if (!Number.isFinite(totalCurrentA) || !Number.isFinite(totalPowerW)) {
        if (timestampUs < range.endUs) {
          robotEstimateAvailable = false;
          unavailableReasons.add("robot-nonfinite");
        }
        previousRobotTimestampUs = timestampUs;
        previousEstimatedPowerW = 0;
        return;
      }
      let removedCurrentA = 0;
      let removedPowerW = 0;
      for (const item of robotGroupCursors) {
        const currentA = advanceHeldNumericCursor(item.current, timestampUs);
        const powerW = advanceHeldNumericCursor(item.power, timestampUs);
        if (!Number.isFinite(currentA) || !Number.isFinite(powerW)) continue;
        const scale = currentScale(currentA, item.target.input.limitA);
        if (currentA > 0) removedCurrentA += currentA - Math.min(currentA, item.target.input.limitA);
        if (powerW > 0) removedPowerW += powerW - powerW * scale;
      }
      const rawEstimatedCurrentA = totalCurrentA - removedCurrentA;
      const rawEstimatedPowerW = totalPowerW - removedPowerW;
      if (rawEstimatedCurrentA > estimatedPeakCurrentA) {
        estimatedPeakCurrentA = rawEstimatedCurrentA;
        estimatedPeakCurrentTimestampUs = timestampUs;
      }
      if (rawEstimatedPowerW > estimatedPeakPowerW) {
        estimatedPeakPowerW = rawEstimatedPowerW;
        estimatedPeakPowerTimestampUs = timestampUs;
      }
      previousRobotTimestampUs = timestampUs;
      previousEstimatedPowerW = rawEstimatedPowerW;
    },
  );

  const targetEstimates: SupplyLimitTargetEstimate[] = targets.map((target) => {
    const estimatedEnergyWh = target.estimatedEnergyWh;
    const energySavedWh = Math.max(0, target.baseline.energyWh - estimatedEnergyWh);
    if (!target.triggered) {
      target.warnings.push(warning(
        "LIMIT_NOT_TRIGGERED",
        `${groupLabel(target.group)} 在当前范围内没有超过 ${target.input.limitA} A。`,
        target.group.id,
      ));
    }
    if (target.sawNonfinite) {
      target.warnings.push(warning(
        "SOURCE_NONFINITE_DROPPED",
        `${groupLabel(target.group)} 存在不完整样本；对应区间保持原整机值，不参与扣减。`,
        target.group.id,
      ));
    }
    const estimatedAveragePowerW = dataset.series.enabled
      ? enabledDurationSeconds > 0
        ? target.estimatedEnabledEnergyWh * 3600 / enabledDurationSeconds
        : 0
      : range.durationSeconds > 0
        ? estimatedEnergyWh * 3600 / range.durationSeconds
        : 0;
    return {
      motorGroupId: target.group.id,
      subsystemId: target.group.subsystemId,
      subsystemName: target.group.subsystemName,
      leaderName: target.group.leaderName,
      motorNames: target.group.motorNames,
      motorType: target.group.motorType,
      motorCount: target.group.motorCount,
      limitA: target.input.limitA,
      baseline: target.baseline,
      estimated: {
        energyWh: estimatedEnergyWh,
        averagePowerW: estimatedAveragePowerW,
        peakPowerW: Number.isFinite(target.estimatedPeakPowerW)
          ? target.estimatedPeakPowerW
          : target.baseline.peakPowerW,
        peakPowerTimestampUs: target.estimatedPeakPowerTimestampUs,
        peakCurrentA: Number.isFinite(target.estimatedPeakCurrentA)
          ? target.estimatedPeakCurrentA
          : target.baseline.peakCurrentA,
        peakCurrentTimestampUs: target.estimatedPeakCurrentTimestampUs,
      },
      energySavedWh,
      energySavedPercent: target.baseline.energyWh > 0
        ? energySavedWh / target.baseline.energyWh * 100
        : null,
      clippedDurationSeconds: target.clippedDurationSeconds,
      clippedRangeFraction: range.durationSeconds > 0
        ? target.clippedDurationSeconds / range.durationSeconds
        : 0,
      ampSecondsRemoved: target.ampSecondsRemoved,
      warnings: target.warnings,
    };
  });

  const targetEnergySavedWh = targetEstimates.reduce(
    (sum, target) => sum + target.energySavedWh,
    0,
  );
  const robotEnergySavedWh = Math.max(0, baselineRange.totals.energyWh - estimatedTotalEnergyWh);

  const globalWarnings = sourceQualityWarnings(dataset);
  if (targets.length === 0) {
    globalWarnings.push(warning(
      "NO_ACTIVE_LIMITS",
      "当前方案没有启用的 Leader 电机组 Supply Current 限流目标。",
    ));
  }
  if (!baselineRange.quality.reconciliation.withinTolerance) {
    globalWarnings.push(warning(
      "SOURCE_RECONCILIATION_MISMATCH",
      "当前范围内整机能量数据不调和，整机估算不可用。",
      undefined,
      { ...baselineRange.quality.reconciliation },
    ));
    robotEstimateAvailable = false;
    unavailableReasons.add("reconciliation");
  }
  if (!robotEstimateAvailable) {
    globalWarnings.push(warning(
      "ROBOT_ESTIMATE_UNAVAILABLE",
      "电机组扣减后无法与整机数据可靠调和；保留逐电机组结果，但整机估算不可用。",
      undefined,
      { reasons: [...unavailableReasons].sort() },
    ));
  }
  for (const target of targets) globalWarnings.push(...target.warnings);

  const estimatedAveragePowerW = dataset.series.enabled
    ? enabledDurationSeconds > 0
      ? estimatedTotalEnabledEnergyWh * 3600 / enabledDurationSeconds
      : 0
    : range.durationSeconds > 0 && estimatedTotalEnergyWh !== undefined
      ? estimatedTotalEnergyWh * 3600 / range.durationSeconds
      : 0;
  const estimatedTotals = robotEstimateAvailable
    ? {
        energyWh: estimatedTotalEnergyWh,
        averagePowerW: estimatedAveragePowerW,
        peakPowerW: Number.isFinite(estimatedPeakPowerW) ? estimatedPeakPowerW : 0,
        peakPowerTimestampUs: estimatedPeakPowerTimestampUs,
        peakCurrentA: Number.isFinite(estimatedPeakCurrentA) ? estimatedPeakCurrentA : 0,
        peakCurrentTimestampUs: estimatedPeakCurrentTimestampUs,
      }
    : undefined;

  return {
    range,
    limits,
    targets: targetEstimates,
    totals: {
      activeTargetCount: targets.length,
      baseline: {
        energyWh: baselineRange.totals.energyWh,
        averagePowerW: baselineRange.totals.averagePowerW,
        peakPowerW: baselineRange.totals.peakPowerW,
        peakPowerTimestampUs: baselineRange.totals.peakPowerTimestampUs,
        peakCurrentA: baselineRange.totals.peakCurrentA,
        peakCurrentTimestampUs: baselineRange.totals.peakCurrentTimestampUs,
      },
      estimated: estimatedTotals,
      energySavedWh: robotEstimateAvailable ? robotEnergySavedWh : targetEnergySavedWh,
      energySavedPercent: robotEstimateAvailable && baselineRange.totals.energyWh > 0
        ? robotEnergySavedWh / baselineRange.totals.energyWh * 100
        : null,
      clippedUnionDurationSeconds: unionClippedDuration(targets, range),
      clippedDurationSumSeconds: targetEstimates.reduce(
        (sum, target) => sum + target.clippedDurationSeconds,
        0,
      ),
      robotEstimateAvailable,
    },
    warnings: globalWarnings,
  };
}

function unionClippedDuration(
  targets: readonly ActiveTarget[],
  range: TimeRange,
): number {
  if (targets.length === 0 || range.endUs <= range.startUs) return 0;
  const cursors = targets.map((target) => ({
    target,
    current: createHeldNumericCursor(target.group.currentA, range.startUs, Number.NaN),
  }));
  let previousTimestampUs: number | undefined;
  let anyClipped = false;
  let durationSeconds = 0;
  forEachMergedTimestamp(
    targets.map((target) => target.group.currentA),
    range.startUs,
    range.endUs,
    (timestampUs) => {
      if (previousTimestampUs !== undefined && anyClipped) {
        durationSeconds += (timestampUs - previousTimestampUs) / 1_000_000;
      }
      anyClipped = cursors.some(({ target, current }) => {
        const value = advanceHeldNumericCursor(current, timestampUs);
        return Number.isFinite(value) && value > target.input.limitA + CURRENT_TOLERANCE_A;
      });
      previousTimestampUs = timestampUs;
    },
  );
  return durationSeconds;
}
