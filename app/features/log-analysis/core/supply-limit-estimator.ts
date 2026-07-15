import { analyzeEnergyRange } from "./energy-analysis";
import { rangeIntersections, upperBound } from "./time-series";
import type {
  EnergyLogDataset,
  NumericSeries,
  SubsystemNode,
  SupplyCurrentLimitInput,
  SupplyLimitEstimate,
  SupplyLimitEstimateOptions,
  SupplyLimitMetricSnapshot,
  SupplyLimitTargetEstimate,
  SupplyLimitValidationIssue,
  SupplyLimitWarning,
  SupplyLimitWarningCode,
  TimeRange,
} from "./types";

const CURRENT_TOLERANCE_A = 1e-6;
const POWER_TOLERANCE_W = 1e-6;
const ENERGY_TOLERANCE_WH = 1e-9;

interface EnergyCursor {
  series: NumericSeries;
  currentA?: NumericSeries;
  limitA?: number;
  index: number;
  previous: number;
  baselineWh: number;
  estimatedWh: number;
  resetCount: number;
  unmatchedEnergyWh: number;
  currentIndex: number;
  currentValueA: number;
}

interface HeldNumericCursor {
  series: NumericSeries;
  index: number;
  value: number;
}

interface ActiveTarget {
  input: SupplyCurrentLimitInput;
  node: SubsystemNode;
  warnings: SupplyLimitWarning[];
  removedCurrentA: number;
  estimatedPeakCurrentA: number;
  estimatedPeakCurrentTimestampUs: number;
  estimatedPeakPowerW: number;
  estimatedPeakPowerTimestampUs: number;
  clippedDurationSeconds: number;
  ampSecondsRemoved: number;
  triggered: boolean;
  positivePowerWithoutCurrent: boolean;
  energyCursor: EnergyCursor;
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

function heldNumeric(series: NumericSeries, timestampUs: number, fallback = 0): number {
  const index = upperBound(series.timestampsUs, timestampUs) - 1;
  return index >= 0 ? series.values[index] : fallback;
}

function createHeldNumericCursor(series: NumericSeries, startUs: number): HeldNumericCursor {
  return {
    series,
    index: upperBound(series.timestampsUs, startUs),
    value: heldNumeric(series, startUs, 0),
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
  return currentA > 0 ? Math.min(1, limitA / currentA) : 1;
}

function isActive(input: SupplyCurrentLimitInput): boolean {
  return input.enabled !== false;
}

export function validateSupplyCurrentLimits(
  dataset: EnergyLogDataset,
  limits: readonly SupplyCurrentLimitInput[],
): SupplyLimitValidationIssue[] {
  const issues: SupplyLimitValidationIssue[] = [];
  const nodesById = new Map(dataset.subsystems.map((node) => [node.id, node]));
  const firstInputByNode = new Map<string, number>();

  limits.forEach((input, inputIndex) => {
    const node = nodesById.get(input.nodeId);
    if (!node) {
      issues.push({
        code: "UNKNOWN_NODE",
        message: `日志中不存在 EnergyLogger 节点：${input.nodeId}`,
        inputIndex,
        nodeIds: [input.nodeId],
      });
    }

    const previousIndex = firstInputByNode.get(input.nodeId);
    if (previousIndex !== undefined) {
      issues.push({
        code: "DUPLICATE_TARGET",
        message: `限流方案重复选择了节点：${input.nodeId}`,
        inputIndex,
        nodeIds: [input.nodeId],
      });
    } else {
      firstInputByNode.set(input.nodeId, inputIndex);
    }

    if (!isActive(input)) return;
    if (!Number.isFinite(input.limitA) || input.limitA < 0) {
      issues.push({
        code: "INVALID_LIMIT",
        message: `${input.nodeId} 的 Supply 电流上限必须是大于或等于 0 的有限数字。`,
        inputIndex,
        nodeIds: [input.nodeId],
      });
    }
    if (node && node.childrenIds.length > 0 && input.aggregateConfirmed !== true) {
      issues.push({
        code: "AGGREGATE_CONFIRMATION_REQUIRED",
        message: `${node.rawPath} 是聚合节点，必须确认它代表同构电机组后才能估算。`,
        inputIndex,
        nodeIds: [node.id],
      });
    }
  });

  const activeIds = new Set(
    limits
      .filter((input) => isActive(input) && nodesById.has(input.nodeId))
      .map((input) => input.nodeId),
  );
  const conflicts = new Set<string>();
  for (const nodeId of activeIds) {
    let parentId = nodesById.get(nodeId)?.parentId ?? null;
    while (parentId) {
      if (activeIds.has(parentId)) {
        const key = `${parentId}\0${nodeId}`;
        if (!conflicts.has(key)) {
          conflicts.add(key);
          issues.push({
            code: "HIERARCHY_CONFLICT",
            message: `不能同时限制聚合节点 ${parentId} 和它的后代 ${nodeId}，否则会重复扣减。`,
            nodeIds: [parentId, nodeId],
          });
        }
      }
      parentId = nodesById.get(parentId)?.parentId ?? null;
    }
  }

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
    throw new SupplyLimitValidationError([
      {
        code: "INVALID_RANGE",
        message: "限流估算范围必须使用有限时间戳，并且终点不能早于起点。",
      },
    ]);
  }

  const startUs = Math.max(dataset.bounds.energyStartUs, Math.round(requestedStartUs));
  const endUs = Math.min(dataset.bounds.energyEndUs, Math.round(requestedEndUs));
  if (endUs < startUs) {
    throw new SupplyLimitValidationError([
      { code: "INVALID_RANGE", message: "限流估算范围不在日志的能量数据范围内。" },
    ]);
  }
  return { startUs, endUs, durationSeconds: (endUs - startUs) / 1_000_000 };
}

function createEnergyCursor(
  series: NumericSeries,
  startUs: number,
  currentA?: NumericSeries,
  limitA?: number,
): EnergyCursor {
  if (series.timestampsUs.length > 0 && startUs <= series.timestampsUs[0]) {
    return {
      series,
      currentA,
      limitA,
      index: 0,
      previous: 0,
      baselineWh: 0,
      estimatedWh: 0,
      resetCount: 0,
      unmatchedEnergyWh: 0,
      currentIndex: currentA ? upperBound(currentA.timestampsUs, startUs) : 0,
      currentValueA: currentA ? heldNumeric(currentA, startUs, 0) : 0,
    };
  }
  return {
    series,
    currentA,
    limitA,
    index: upperBound(series.timestampsUs, startUs),
    previous: heldNumeric(series, startUs, 0),
    baselineWh: 0,
    estimatedWh: 0,
    resetCount: 0,
    unmatchedEnergyWh: 0,
    currentIndex: currentA ? upperBound(currentA.timestampsUs, startUs) : 0,
    currentValueA: currentA ? heldNumeric(currentA, startUs, 0) : 0,
  };
}

function advanceEnergyCursor(cursor: EnergyCursor, timestampUs: number): void {
  while (
    cursor.index < cursor.series.timestampsUs.length &&
    cursor.series.timestampsUs[cursor.index] <= timestampUs
  ) {
    const sampleTimestampUs = cursor.series.timestampsUs[cursor.index];
    const value = cursor.series.values[cursor.index];
    if (value >= cursor.previous) {
      const deltaWh = value - cursor.previous;
      cursor.baselineWh += deltaWh;
      if (cursor.currentA && cursor.limitA !== undefined) {
        while (
          cursor.currentIndex < cursor.currentA.timestampsUs.length &&
          cursor.currentA.timestampsUs[cursor.currentIndex] <= sampleTimestampUs
        ) {
          cursor.currentValueA = cursor.currentA.values[cursor.currentIndex];
          cursor.currentIndex += 1;
        }
        const currentA = cursor.currentValueA;
        if (deltaWh > 0 && currentA <= 0) cursor.unmatchedEnergyWh += deltaWh;
        cursor.estimatedWh += deltaWh * currentScale(currentA, cursor.limitA);
      } else {
        cursor.estimatedWh += deltaWh;
      }
    } else {
      cursor.resetCount += 1;
    }
    cursor.previous = value;
    cursor.index += 1;
  }
}

function scaledEnergyInRange(
  energyWh: NumericSeries,
  currentA: NumericSeries,
  limitA: number,
  range: TimeRange,
): EnergyCursor {
  const cursor = createEnergyCursor(energyWh, range.startUs, currentA, limitA);
  advanceEnergyCursor(cursor, range.endUs);
  return cursor;
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
  series: readonly NumericSeries[],
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
      heapPush(heap, {
        series: item.timestampsUs,
        index,
        timestampUs: item.timestampsUs[index],
      });
    }
  }

  let previousTimestampUs = startUs;
  while (heap.length > 0) {
    const cursor = heapPop(heap)!;
    if (previousTimestampUs !== cursor.timestampUs) {
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
  nodeId?: string,
  details?: Record<string, unknown>,
): SupplyLimitWarning {
  return { code, message, nodeId, details };
}

function sourceQualityWarnings(dataset: EnergyLogDataset): SupplyLimitWarning[] {
  const mappings: Partial<Record<string, [SupplyLimitWarningCode, string]>> = {
    NONFINITE_VALUE_DROPPED: [
      "SOURCE_NONFINITE_DROPPED",
      "源日志包含已丢弃的非有限样本，限流估算置信度降低。",
    ],
    TIME_GAP: ["SOURCE_TIME_GAP", "源日志包含时间断层，限流估算置信度降低。"],
    PARTIAL_SUBSERIES: [
      "SOURCE_PARTIAL_SUBSERIES",
      "源日志包含不完整的 EnergyLogger 子序列；这些路径不会参与估算。",
    ],
  };
  const counts = new Map<string, number>();
  for (const issue of dataset.quality.issues) {
    if (mappings[issue.code]) counts.set(issue.code, (counts.get(issue.code) ?? 0) + 1);
  }
  const result: SupplyLimitWarning[] = [];
  for (const [sourceCode, count] of counts) {
    const [code, message] = mappings[sourceCode]!;
    result.push(warning(code, message, undefined, { sourceCode, count }));
  }
  return result;
}

function normalizedNonnegative(value: number, tolerance: number): number | undefined {
  if (value >= 0) return value;
  if (value >= -tolerance) return 0;
  return undefined;
}

export function estimateSupplyCurrentLimits(
  dataset: EnergyLogDataset,
  options: SupplyLimitEstimateOptions,
): SupplyLimitEstimate {
  const validationIssues = validateSupplyCurrentLimits(dataset, options.limits);
  if (validationIssues.length > 0) throw new SupplyLimitValidationError(validationIssues);

  const range = resolveRange(dataset, options.range);
  const baselineRange = analyzeEnergyRange(dataset, range);
  const baselineByNode = new Map(baselineRange.subsystems.map((metrics) => [metrics.id, metrics]));
  const nodesById = new Map(dataset.subsystems.map((node) => [node.id, node]));
  const limits = options.limits
    .map((input) => ({ ...input }))
    .sort((left, right) => left.nodeId.localeCompare(right.nodeId));
  const activeInputs = limits.filter(isActive);
  const timestampSeries: NumericSeries[] = [
    dataset.series.totalCurrentA,
    dataset.series.totalPowerW,
    dataset.series.totalEnergyWh,
  ];
  for (const input of activeInputs) {
    const node = nodesById.get(input.nodeId)!;
    timestampSeries.push(node.currentA, node.powerW, node.energyWh);
  }
  const targets: ActiveTarget[] = activeInputs.map((input) => {
    const node = nodesById.get(input.nodeId)!;
    const targetWarnings: SupplyLimitWarning[] = [];
    if (input.limitA === 0) {
      targetWarnings.push(
        warning(
          "THEORETICAL_SHUTDOWN",
          `${node.rawPath} 使用 0 A 上限，仅代表理论关闭场景。`,
          node.id,
        ),
      );
    }
    if (node.childrenIds.length > 0) {
      targetWarnings.push(
        warning(
          "CONFIRMED_AGGREGATE",
          `${node.rawPath} 按用户确认的同构电机组聚合电流估算。`,
          node.id,
        ),
      );
    }
    if (
      hasNegativeValue(node.currentA, range) ||
      hasNegativeValue(node.powerW, range) ||
      hasNegativeValue(node.energyWh, range)
    ) {
      targetWarnings.push(
        warning(
          "SOURCE_NEGATIVE_VALUE",
          `${node.rawPath} 包含负值；负电流与负功率样本保持原样，累计能量仍只处理正增量，并降低估算置信度。`,
          node.id,
        ),
      );
    }
    return {
      input,
      node,
      warnings: targetWarnings,
      removedCurrentA: 0,
      estimatedPeakCurrentA: Number.NEGATIVE_INFINITY,
      estimatedPeakCurrentTimestampUs: range.startUs,
      estimatedPeakPowerW: Number.NEGATIVE_INFINITY,
      estimatedPeakPowerTimestampUs: range.startUs,
      clippedDurationSeconds: 0,
      ampSecondsRemoved: 0,
      triggered: false,
      positivePowerWithoutCurrent: false,
      energyCursor: createEnergyCursor(node.energyWh, range.startUs, node.currentA, input.limitA),
      estimatedEnabledEnergyWh: 0,
      currentCursor: createHeldNumericCursor(node.currentA, range.startUs),
      powerCursor: createHeldNumericCursor(node.powerW, range.startUs),
    };
  });

  const totalEnergyCursor = createEnergyCursor(dataset.series.totalEnergyWh, range.startUs);
  const totalCurrentCursor = createHeldNumericCursor(dataset.series.totalCurrentA, range.startUs);
  const totalPowerCursor = createHeldNumericCursor(dataset.series.totalPowerW, range.startUs);
  let robotEstimateAvailable = true;
  const unavailableReasons = new Set<string>();
  let estimatedPeakCurrentA = Number.NEGATIVE_INFINITY;
  let estimatedPeakCurrentTimestampUs = range.startUs;
  let estimatedPeakPowerW = Number.NEGATIVE_INFINITY;
  let estimatedPeakPowerTimestampUs = range.startUs;
  let clippedUnionDurationSeconds = 0;
  let previousTimestampUs: number | undefined;

  forEachMergedTimestamp(
    timestampSeries,
    range.startUs,
    range.endUs,
    (timestampUs) => {
      if (previousTimestampUs !== undefined) {
        const durationSeconds = (timestampUs - previousTimestampUs) / 1_000_000;
        let anyTargetClipped = false;
        for (const target of targets) {
          if (target.removedCurrentA <= CURRENT_TOLERANCE_A) continue;
          anyTargetClipped = true;
          target.clippedDurationSeconds += durationSeconds;
          target.ampSecondsRemoved += target.removedCurrentA * durationSeconds;
        }
        if (anyTargetClipped) clippedUnionDurationSeconds += durationSeconds;
      }

      const totalCurrentA = advanceHeldNumericCursor(totalCurrentCursor, timestampUs);
      const totalPowerW = advanceHeldNumericCursor(totalPowerCursor, timestampUs);

      let removedCurrentA = 0;
      let removedPowerW = 0;
      for (const target of targets) {
        const currentA = advanceHeldNumericCursor(target.currentCursor, timestampUs);
        const powerW = advanceHeldNumericCursor(target.powerCursor, timestampUs);
        const scale = currentScale(currentA, target.input.limitA);
        const estimatedCurrentA = currentA > 0
          ? Math.min(currentA, target.input.limitA)
          : currentA;
        const estimatedPowerW = powerW < 0 ? powerW : powerW * scale;
        target.removedCurrentA = currentA - estimatedCurrentA;
        removedCurrentA += target.removedCurrentA;
        removedPowerW += powerW - estimatedPowerW;
        if (target.removedCurrentA > CURRENT_TOLERANCE_A) target.triggered = true;
        if (currentA <= 0 && powerW > 0) target.positivePowerWithoutCurrent = true;
        if (estimatedCurrentA > target.estimatedPeakCurrentA) {
          target.estimatedPeakCurrentA = estimatedCurrentA;
          target.estimatedPeakCurrentTimestampUs = timestampUs;
        }
        if (estimatedPowerW > target.estimatedPeakPowerW) {
          target.estimatedPeakPowerW = estimatedPowerW;
          target.estimatedPeakPowerTimestampUs = timestampUs;
        }
        advanceEnergyCursor(target.energyCursor, timestampUs);
      }
      advanceEnergyCursor(totalEnergyCursor, timestampUs);

      const rawEstimatedCurrentA = totalCurrentA - removedCurrentA;
      const rawEstimatedPowerW = totalPowerW - removedPowerW;
      const currentTolerance = Math.max(
        CURRENT_TOLERANCE_A,
        Math.abs(totalCurrentA) * 1e-9,
      );
      const powerTolerance = Math.max(POWER_TOLERANCE_W, Math.abs(totalPowerW) * 1e-9);
      const normalizedCurrentA = normalizedNonnegative(rawEstimatedCurrentA, currentTolerance);
      const normalizedPowerW = normalizedNonnegative(rawEstimatedPowerW, powerTolerance);
      if (normalizedCurrentA === undefined) {
        robotEstimateAvailable = false;
        unavailableReasons.add("current");
      }
      if (normalizedPowerW === undefined) {
        robotEstimateAvailable = false;
        unavailableReasons.add("power");
      }
      const estimatedTotalCurrentA = normalizedCurrentA ?? rawEstimatedCurrentA;
      const estimatedTotalPowerW = normalizedPowerW ?? rawEstimatedPowerW;
      if (estimatedTotalCurrentA > estimatedPeakCurrentA) {
        estimatedPeakCurrentA = estimatedTotalCurrentA;
        estimatedPeakCurrentTimestampUs = timestampUs;
      }
      if (estimatedTotalPowerW > estimatedPeakPowerW) {
        estimatedPeakPowerW = estimatedTotalPowerW;
        estimatedPeakPowerTimestampUs = timestampUs;
      }

      const savedEnergyWh = targets.reduce(
        (sum, target) =>
          sum + target.energyCursor.baselineWh - target.energyCursor.estimatedWh,
        0,
      );
      const rawEstimatedEnergyWh = totalEnergyCursor.baselineWh - savedEnergyWh;
      const energyTolerance = Math.max(
        ENERGY_TOLERANCE_WH,
        Math.abs(totalEnergyCursor.baselineWh) * 1e-9,
      );
      const normalizedEnergyWh = normalizedNonnegative(rawEstimatedEnergyWh, energyTolerance);
      if (normalizedEnergyWh === undefined) {
        robotEstimateAvailable = false;
        unavailableReasons.add("energy");
      }
      previousTimestampUs = timestampUs;
    },
  );

  const enabledIntervals = rangeIntersections(dataset.segments.enabled, range);
  const enabledDurationSeconds = enabledIntervals.reduce(
    (sum, interval) => sum + interval.durationSeconds,
    0,
  );
  let estimatedTotalEnabledEnergyWh = 0;
  if (dataset.series.enabled && enabledDurationSeconds > 0) {
    const baselineTotalEnabledEnergyWh = enabledIntervals.reduce((sum, interval) => {
      const cursor = createEnergyCursor(dataset.series.totalEnergyWh, interval.startUs);
      advanceEnergyCursor(cursor, interval.endUs);
      return sum + cursor.baselineWh;
    }, 0);
    let enabledEnergyRemovedWh = 0;
    for (const target of targets) {
      let targetBaselineEnabledWh = 0;
      let targetEstimatedEnabledWh = 0;
      for (const interval of enabledIntervals) {
        const cursor = scaledEnergyInRange(
          target.node.energyWh,
          target.node.currentA,
          target.input.limitA,
          interval,
        );
        targetBaselineEnabledWh += cursor.baselineWh;
        targetEstimatedEnabledWh += cursor.estimatedWh;
      }
      target.estimatedEnabledEnergyWh = targetEstimatedEnabledWh;
      enabledEnergyRemovedWh += targetBaselineEnabledWh - targetEstimatedEnabledWh;
    }
    const rawEstimatedEnabledEnergyWh = baselineTotalEnabledEnergyWh - enabledEnergyRemovedWh;
    const normalized = normalizedNonnegative(
      rawEstimatedEnabledEnergyWh,
      Math.max(ENERGY_TOLERANCE_WH, Math.abs(baselineTotalEnabledEnergyWh) * 1e-9),
    );
    if (normalized === undefined) {
      robotEstimateAvailable = false;
      unavailableReasons.add("enabled-energy");
    }
    estimatedTotalEnabledEnergyWh = normalized ?? rawEstimatedEnabledEnergyWh;
  }

  const targetEstimates: SupplyLimitTargetEstimate[] = targets.map((target) => {
    const baseline = baselineByNode.get(target.node.id)!;
    const energySavedWh = Math.max(
      0,
      target.energyCursor.baselineWh - target.energyCursor.estimatedWh,
    );
    const estimatedEnergyWh = target.energyCursor.estimatedWh;
    if (!target.triggered) {
      target.warnings.push(
        warning(
          "LIMIT_NOT_TRIGGERED",
          `${target.node.rawPath} 在当前范围内没有超过 ${target.input.limitA} A。`,
          target.node.id,
        ),
      );
    }
    if (target.energyCursor.resetCount > 0) {
      target.warnings.push(
        warning(
          "SOURCE_ENERGY_RESET",
          `${target.node.rawPath} 在当前范围内发生累计能量重置，已按分段正增量估算。`,
          target.node.id,
          { resetCount: target.energyCursor.resetCount },
        ),
      );
    }
    if (
      target.positivePowerWithoutCurrent ||
      target.energyCursor.unmatchedEnergyWh > ENERGY_TOLERANCE_WH
    ) {
      target.warnings.push(
        warning(
          "SOURCE_CURRENT_MISMATCH",
          `${target.node.rawPath} 存在电流不大于 0 但功率或能量仍增加的区段；这些区段保持原样，不计节省。`,
          target.node.id,
          { unmatchedEnergyWh: target.energyCursor.unmatchedEnergyWh },
        ),
      );
    }
    const estimatedAveragePowerW = dataset.series.enabled
      ? enabledDurationSeconds > 0
        ? (target.estimatedEnabledEnergyWh * 3600) / enabledDurationSeconds
        : 0
      : range.durationSeconds > 0
        ? (estimatedEnergyWh * 3600) / range.durationSeconds
        : 0;
    const baselineSnapshot: SupplyLimitMetricSnapshot = {
      energyWh: baseline.energyWh,
      averagePowerW: baseline.averagePowerW,
      peakPowerW: baseline.peakPowerW,
      peakPowerTimestampUs: baseline.peakPowerTimestampUs,
      peakCurrentA: baseline.peakCurrentA,
      peakCurrentTimestampUs: baseline.peakCurrentTimestampUs,
    };
    const estimatedSnapshot: SupplyLimitMetricSnapshot = {
      energyWh: estimatedEnergyWh,
      averagePowerW: estimatedAveragePowerW,
      peakPowerW: target.estimatedPeakPowerW,
      peakPowerTimestampUs: target.estimatedPeakPowerTimestampUs,
      peakCurrentA: target.estimatedPeakCurrentA,
      peakCurrentTimestampUs: target.estimatedPeakCurrentTimestampUs,
    };
    return {
      nodeId: target.node.id,
      rawPath: target.node.rawPath,
      displayName: target.node.displayName,
      kind: target.node.childrenIds.length > 0 ? "confirmed-aggregate" : "terminal",
      limitA: target.input.limitA,
      baseline: baselineSnapshot,
      estimated: estimatedSnapshot,
      energySavedWh,
      energySavedPercent: baseline.energyWh > 0 ? (energySavedWh / baseline.energyWh) * 100 : null,
      clippedDurationSeconds: target.clippedDurationSeconds,
      clippedRangeFraction:
        range.durationSeconds > 0
          ? target.clippedDurationSeconds / range.durationSeconds
          : 0,
      ampSecondsRemoved: target.ampSecondsRemoved,
      warnings: target.warnings,
    };
  });

  const totalEnergySavedWh = targetEstimates.reduce(
    (sum, target) => sum + target.energySavedWh,
    0,
  );
  const rawEstimatedTotalEnergyWh = baselineRange.totals.energyWh - totalEnergySavedWh;
  const estimatedTotalEnergyWh = normalizedNonnegative(
    rawEstimatedTotalEnergyWh,
    Math.max(ENERGY_TOLERANCE_WH, Math.abs(baselineRange.totals.energyWh) * 1e-9),
  );
  if (estimatedTotalEnergyWh === undefined) {
    robotEstimateAvailable = false;
    unavailableReasons.add("energy-total");
  }

  const globalWarnings = sourceQualityWarnings(dataset);
  if (targets.length === 0) {
    globalWarnings.push(
      warning("NO_ACTIVE_LIMITS", "当前方案没有启用的 Supply 电流限流目标。"),
    );
  }
  if (!baselineRange.quality.reconciliation.withinTolerance) {
    globalWarnings.push(
      warning(
        "SOURCE_RECONCILIATION_MISMATCH",
        "当前范围内整机能量与顶层子系统能量不调和，整机估算置信度降低。",
        undefined,
        { ...baselineRange.quality.reconciliation },
      ),
    );
  }
  if (!robotEstimateAvailable) {
    globalWarnings.push(
      warning(
        "ROBOT_ESTIMATE_UNAVAILABLE",
        "目标节点扣减后出现明显负的整机电流、功率或能量；保留逐目标结果，但整机估算不可用。",
        undefined,
        { reasons: [...unavailableReasons].sort() },
      ),
    );
  }
  for (const target of targets) globalWarnings.push(...target.warnings);

  const baselineTotals: SupplyLimitMetricSnapshot = {
    energyWh: baselineRange.totals.energyWh,
    averagePowerW: baselineRange.totals.averagePowerW,
    peakPowerW: baselineRange.totals.peakPowerW,
    peakPowerTimestampUs: baselineRange.totals.peakPowerTimestampUs,
    peakCurrentA: baselineRange.totals.peakCurrentA,
    peakCurrentTimestampUs: baselineRange.totals.peakCurrentTimestampUs,
  };
  const estimatedAveragePowerW = dataset.series.enabled
    ? enabledDurationSeconds > 0
      ? (estimatedTotalEnabledEnergyWh * 3600) / enabledDurationSeconds
      : 0
    : range.durationSeconds > 0 && estimatedTotalEnergyWh !== undefined
      ? (estimatedTotalEnergyWh * 3600) / range.durationSeconds
      : 0;
  const estimatedTotals: SupplyLimitMetricSnapshot | undefined = robotEstimateAvailable &&
      estimatedTotalEnergyWh !== undefined
    ? {
        energyWh: estimatedTotalEnergyWh,
        averagePowerW: estimatedAveragePowerW,
        peakPowerW: estimatedPeakPowerW,
        peakPowerTimestampUs: estimatedPeakPowerTimestampUs,
        peakCurrentA: estimatedPeakCurrentA,
        peakCurrentTimestampUs: estimatedPeakCurrentTimestampUs,
      }
    : undefined;

  return {
    range,
    limits,
    targets: targetEstimates,
    totals: {
      activeTargetCount: targets.length,
      baseline: baselineTotals,
      estimated: estimatedTotals,
      energySavedWh: totalEnergySavedWh,
      energySavedPercent:
        robotEstimateAvailable && baselineRange.totals.energyWh > 0
          ? (totalEnergySavedWh / baselineRange.totals.energyWh) * 100
          : null,
      clippedUnionDurationSeconds,
      clippedDurationSumSeconds: targetEstimates.reduce(
        (sum, target) => sum + target.clippedDurationSeconds,
        0,
      ),
      robotEstimateAvailable,
    },
    warnings: globalWarnings,
  };
}
