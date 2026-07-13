import { LogAnalysisError, fatalIssue, warningIssue } from "./errors";
import { decodeWpiLog, type WpiLogDataRecord } from "./wpilog-decoder";
import type {
  AnalysisResult,
  BooleanSeries,
  DataQuality,
  DriverStationMode,
  EnergyLogDataset,
  IntegerSeries,
  LogIssue,
  ModeInterval,
  NumericSeries,
  ParseOptions,
  RangeAnalysis,
  ReconciliationSummary,
  SubsystemNode,
  SubsystemRangeMetrics,
  TimeInterval,
  TimeRange,
  WpiLogEntry,
  WpiLogSource,
} from "./types";

type EnergyFamily = "current" | "power" | "energy";

interface EnergyName {
  root: string;
  kind: "totalCurrent" | "totalPower" | "totalEnergy" | EnergyFamily;
  rawPath?: string;
}

interface MutableSeries {
  name: string;
  types: Set<string>;
  metadata: string;
  timestampsUs: number[];
  numericValues: number[];
  booleanValues: number[];
  integerValues: bigint[];
  monotonic: boolean;
  droppedNonfinite: number;
  negativeValues: number;
}

interface EntryBinding {
  series: MutableSeries;
  expectedType: OptionalValueType;
}

interface DynamicGroup {
  id: string;
  rawPath: string;
  current?: MutableSeries;
  power?: MutableSeries;
  energy?: MutableSeries;
}

type OptionalValueType = "double" | "boolean" | "int64";

const OPTIONAL_SUFFIXES = new Map<string, OptionalValueType>([
  ["/energyLogger/BatteryVoltageVolt", "double"],
  ["/SystemStats/BatteryVoltage", "double"],
  ["/SystemStats/BrownedOut", "boolean"],
  ["/SystemStats/BrownoutVoltage", "double"],
  ["/DriverStation/Enabled", "boolean"],
  ["/DriverStation/Autonomous", "boolean"],
  ["/DriverStation/Test", "boolean"],
  ["/DriverStation/MatchType", "int64"],
]);

const EXPECTED_UNITS: Record<string, { output: string; accepted: Set<string> }> = {
  totalCurrent: { output: "A", accepted: new Set(["a", "amp", "amps", "ampere", "amperes"]) },
  current: { output: "A", accepted: new Set(["a", "amp", "amps", "ampere", "amperes"]) },
  totalPower: { output: "W", accepted: new Set(["w", "watt", "watts"]) },
  power: { output: "W", accepted: new Set(["w", "watt", "watts"]) },
  totalEnergy: {
    output: "Wh",
    accepted: new Set(["wh", "watt hour", "watt hours", "watt-hour", "watt-hours"]),
  },
  energy: {
    output: "Wh",
    accepted: new Set(["wh", "watt hour", "watt hours", "watt-hour", "watt-hours"]),
  },
  voltage: { output: "V", accepted: new Set(["v", "volt", "volts"]) },
};

const DEFAULT_GAP_US = 1_000_000;
const DEFAULT_ABSOLUTE_TOLERANCE_WH = 0.01;
const DEFAULT_RELATIVE_TOLERANCE = 0.01;

function createMutableSeries(name: string): MutableSeries {
  return {
    name,
    types: new Set<string>(),
    metadata: "",
    timestampsUs: [],
    numericValues: [],
    booleanValues: [],
    integerValues: [],
    monotonic: true,
    droppedNonfinite: 0,
    negativeValues: 0,
  };
}

function parseEnergyName(name: string): EnergyName | undefined {
  let root: string;
  let tail: string;
  if (name.startsWith("energyLogger/")) {
    root = "energyLogger";
    tail = name.slice("energyLogger/".length);
  } else {
    const marker = "/energyLogger/";
    const markerIndex = name.lastIndexOf(marker);
    if (markerIndex < 0) return undefined;
    root = name.slice(0, markerIndex + "/energyLogger".length);
    tail = name.slice(markerIndex + marker.length);
  }

  if (tail === "totalCurrent" || tail === "totalPower" || tail === "totalEnergy") {
    return { root, kind: tail };
  }
  for (const family of ["current", "power", "energy"] as const) {
    const prefix = `${family}/`;
    if (tail.startsWith(prefix) && tail.length > prefix.length) {
      return { root, kind: family, rawPath: tail.slice(prefix.length) };
    }
  }
  return undefined;
}

function optionalExpectedType(name: string): OptionalValueType | undefined {
  for (const [suffix, type] of OPTIONAL_SUFFIXES) {
    if (name === suffix.slice(1) || name.endsWith(suffix)) return type;
  }
  return undefined;
}

function appendTimestamp(series: MutableSeries, timestampUs: number): void {
  const previous = series.timestampsUs.at(-1);
  if (previous !== undefined && timestampUs < previous) series.monotonic = false;
  series.timestampsUs.push(timestampUs);
}

function readBoundValue(record: WpiLogDataRecord, binding: EntryBinding): void {
  const { series, expectedType } = binding;
  if (record.entry.type !== expectedType) return;

  if (expectedType === "double") {
    if (record.payload.byteLength !== 8) {
      throw new LogAnalysisError(
        fatalIssue(
          "CORRUPT_RECORD_MIDDLE",
          `Double entry ${record.entry.name} has a ${record.payload.byteLength}-byte payload`,
          { offset: record.offset, entryName: record.entry.name },
        ),
      );
    }
    const value = new DataView(
      record.payload.buffer,
      record.payload.byteOffset,
      record.payload.byteLength,
    ).getFloat64(0, true);
    if (!Number.isFinite(value)) {
      series.droppedNonfinite += 1;
      return;
    }
    appendTimestamp(series, record.timestampUs);
    series.numericValues.push(value);
    if (value < 0) series.negativeValues += 1;
    return;
  }

  if (expectedType === "int64") {
    if (record.payload.byteLength !== 8) {
      throw new LogAnalysisError(
        fatalIssue(
          "CORRUPT_RECORD_MIDDLE",
          `Int64 entry ${record.entry.name} has a ${record.payload.byteLength}-byte payload`,
          { offset: record.offset, entryName: record.entry.name },
        ),
      );
    }
    const value = new DataView(
      record.payload.buffer,
      record.payload.byteOffset,
      record.payload.byteLength,
    ).getBigInt64(0, true);
    appendTimestamp(series, record.timestampUs);
    series.integerValues.push(value);
    return;
  }

  if (record.payload.byteLength !== 1) {
    throw new LogAnalysisError(
      fatalIssue(
        "CORRUPT_RECORD_MIDDLE",
        `Boolean entry ${record.entry.name} has a ${record.payload.byteLength}-byte payload`,
        { offset: record.offset, entryName: record.entry.name },
      ),
    );
  }
  if (record.payload[0] !== 0 && record.payload[0] !== 1) {
    throw new LogAnalysisError(
      fatalIssue(
        "CORRUPT_RECORD_MIDDLE",
        `Boolean entry ${record.entry.name} contains value ${record.payload[0]}; expected 0 or 1`,
        { offset: record.offset, entryName: record.entry.name },
      ),
    );
  }
  appendTimestamp(series, record.timestampUs);
  series.booleanValues.push(record.payload[0] === 0 ? 0 : 1);
}

function finalizePairs(
  timestamps: number[],
  values: number[],
  monotonic: boolean,
): { timestamps: Float64Array; values: Float64Array } {
  if (timestamps.length !== values.length) throw new Error("Series arrays have different lengths");
  if (timestamps.length === 0) {
    return { timestamps: new Float64Array(), values: new Float64Array() };
  }

  let indices: number[] | undefined;
  if (!monotonic) {
    indices = Array.from({ length: timestamps.length }, (_, index) => index);
    indices.sort((left, right) => timestamps[left] - timestamps[right] || left - right);
  }
  const sourceIndex = (index: number) => indices?.[index] ?? index;
  let uniqueCount = 1;
  for (let index = 1; index < timestamps.length; index += 1) {
    if (timestamps[sourceIndex(index)] !== timestamps[sourceIndex(index - 1)]) uniqueCount += 1;
  }
  const sortedTimes = new Float64Array(uniqueCount);
  const sortedValues = new Float64Array(uniqueCount);
  let outputIndex = 0;
  for (let index = 0; index < timestamps.length; index += 1) {
    const inputIndex = sourceIndex(index);
    const timestamp = timestamps[inputIndex];
    if (outputIndex > 0 && timestamp === sortedTimes[outputIndex - 1]) {
      sortedValues[outputIndex - 1] = values[inputIndex];
      continue;
    }
    sortedTimes[outputIndex] = timestamp;
    sortedValues[outputIndex] = values[inputIndex];
    outputIndex += 1;
  }
  return {
    timestamps: sortedTimes,
    values: sortedValues,
  };
}

function finalizeNumeric(series: MutableSeries, unit: string): NumericSeries {
  const finalized = finalizePairs(series.timestampsUs, series.numericValues, series.monotonic);
  return {
    timestampsUs: finalized.timestamps,
    values: finalized.values,
    unit,
    entryName: series.name,
  };
}

function finalizeBoolean(series: MutableSeries): BooleanSeries {
  const finalized = finalizePairs(series.timestampsUs, series.booleanValues, series.monotonic);
  return {
    timestampsUs: finalized.timestamps,
    values: Uint8Array.from(finalized.values),
    entryName: series.name,
  };
}

function finalizeInteger(series: MutableSeries): IntegerSeries {
  let indices = Array.from({ length: series.timestampsUs.length }, (_, index) => index);
  if (!series.monotonic) {
    indices = indices.sort(
      (left, right) =>
        series.timestampsUs[left] - series.timestampsUs[right] || left - right,
    );
  }
  const timestampsUs: number[] = [];
  const values: bigint[] = [];
  for (const index of indices) {
    const timestampUs = series.timestampsUs[index];
    if (timestampsUs.at(-1) === timestampUs) {
      values[values.length - 1] = series.integerValues[index];
    } else {
      timestampsUs.push(timestampUs);
      values.push(series.integerValues[index]);
    }
  }
  return {
    timestampsUs: Float64Array.from(timestampsUs),
    values: BigInt64Array.from(values),
    entryName: series.name,
  };
}

function rootPriority(root: string): number {
  const namespace = root.slice(0, -"/energyLogger".length);
  const segments = namespace.split("/").filter(Boolean);
  const last = segments.at(-1);
  if (last === "RealOutputs") return 0;
  if (last === "ReplayOutputs") return 1;
  return 2;
}

function chooseRoot(seriesByName: Map<string, MutableSeries>): string {
  const rootKinds = new Map<string, Set<string>>();
  for (const name of seriesByName.keys()) {
    const parsed = parseEnergyName(name);
    if (!parsed) continue;
    const kinds = rootKinds.get(parsed.root) ?? new Set<string>();
    kinds.add(parsed.kind);
    rootKinds.set(parsed.root, kinds);
  }
  const candidates = [...rootKinds]
    .filter(([, kinds]) =>
      ["totalCurrent", "totalPower", "totalEnergy"].every((kind) => kinds.has(kind)),
    )
    .map(([root]) => root);
  if (candidates.length === 0) {
    throw new LogAnalysisError(
      fatalIssue(
        "MISSING_ENERGY_TOTALS",
        "No EnergyLogger root contains totalCurrent, totalPower, and totalEnergy",
        { details: { discoveredRoots: [...rootKinds.keys()] } },
      ),
    );
  }

  for (const priority of [0, 1, 2]) {
    const atPriority = candidates.filter((root) => rootPriority(root) === priority);
    if (atPriority.length === 1) return atPriority[0];
    if (atPriority.length > 1) {
      throw new LogAnalysisError(
        fatalIssue(
          "AMBIGUOUS_ENERGY_ROOT",
          `Multiple EnergyLogger roots have the same selection priority: ${atPriority.join(", ")}`,
          { details: { roots: atPriority, priority } },
        ),
      );
    }
  }
  throw new Error("Energy root selection reached an impossible state");
}

function requireDouble(series: MutableSeries, label: string): void {
  const invalidTypes = [...series.types].filter((type) => type !== "double");
  if (invalidTypes.length > 0 || !series.types.has("double")) {
    throw new LogAnalysisError(
      fatalIssue(
        "ENERGY_TYPE_MISMATCH",
        `${label} must be declared as double`,
        { entryName: series.name, details: { declaredTypes: [...series.types] } },
      ),
    );
  }
}

function requireFinite(series: MutableSeries, label: string): void {
  if (series.numericValues.length === 0) {
    throw new LogAnalysisError(
      fatalIssue("NO_FINITE_ENERGY_DATA", `${label} has no finite samples`, {
        entryName: series.name,
      }),
    );
  }
}

function normalizeDynamicPath(rawPath: string): string {
  // Older EnergyLogger versions used one trailing slash to mark an aggregate node.
  // It is not a hierarchy segment, but every other empty segment remains invalid.
  const hierarchyPath = rawPath.endsWith("/") ? rawPath.slice(0, -1) : rawPath;
  const parts = hierarchyPath.split(/[/-]/);
  if (parts.length === 0 || parts.some((part) => part.length === 0)) {
    throw new LogAnalysisError(
      fatalIssue("INVALID_DYNAMIC_PATH", `EnergyLogger path contains an empty segment: ${rawPath}`, {
        details: { rawPath },
      }),
    );
  }
  return parts.join("/");
}

function metadataUnit(metadata: string): string | undefined {
  if (!metadata.trim()) return undefined;
  try {
    const parsed = JSON.parse(metadata) as Record<string, unknown>;
    const value = parsed.units ?? parsed.unit;
    return typeof value === "string" ? value.trim() : undefined;
  } catch {
    return undefined;
  }
}

function checkUnit(
  series: MutableSeries,
  expectedKey: keyof typeof EXPECTED_UNITS,
  issues: LogIssue[],
): void {
  const actual = metadataUnit(series.metadata);
  const expected = EXPECTED_UNITS[expectedKey];
  if (!actual) {
    issues.push(
      warningIssue("UNIT_METADATA_MISSING", `Units metadata is absent for ${series.name}`, {
        entryName: series.name,
        details: { expected: expected.output },
      }),
    );
    return;
  }
  if (!expected.accepted.has(actual.toLowerCase())) {
    issues.push(
      warningIssue(
        "UNIT_METADATA_MISMATCH",
        `Units metadata for ${series.name} is ${actual}; expected ${expected.output}`,
        { entryName: series.name, details: { expected: expected.output, actual } },
      ),
    );
  }
}

function detectSeriesQuality(
  selected: MutableSeries[],
  totalEnergy: MutableSeries,
  issues: LogIssue[],
  gapThresholdUs: number,
): { droppedNonfiniteSamples: number; negativeValues: number } {
  const droppedNonfiniteSamples = selected.reduce(
    (sum, series) => sum + series.droppedNonfinite,
    0,
  );
  const negativeValues = selected.reduce((sum, series) => sum + series.negativeValues, 0);
  if (droppedNonfiniteSamples > 0) {
    issues.push(
      warningIssue(
        "NONFINITE_VALUE_DROPPED",
        `Dropped ${droppedNonfiniteSamples} non-finite EnergyLogger samples`,
        { details: { count: droppedNonfiniteSamples } },
      ),
    );
  }
  if (negativeValues > 0) {
    issues.push(
      warningIssue("NEGATIVE_VALUE", `Found ${negativeValues} negative EnergyLogger samples`, {
        details: { count: negativeValues },
      }),
    );
  }

  let gapCount = 0;
  let maxGapUs = 0;
  for (let index = 1; index < totalEnergy.timestampsUs.length; index += 1) {
    const gapUs = totalEnergy.timestampsUs[index] - totalEnergy.timestampsUs[index - 1];
    if (gapUs > gapThresholdUs) {
      gapCount += 1;
      maxGapUs = Math.max(maxGapUs, gapUs);
    }
  }
  if (gapCount > 0) {
    issues.push(
      warningIssue("TIME_GAP", `Energy data contains ${gapCount} gaps over ${gapThresholdUs} us`, {
        entryName: totalEnergy.name,
        details: { gapCount, maxGapUs, thresholdUs: gapThresholdUs },
      }),
    );
  }
  return { droppedNonfiniteSamples, negativeValues };
}

function findOptional(
  seriesByName: Map<string, MutableSeries>,
  namespace: string,
  relativeName: string,
): MutableSeries | undefined {
  const names = namespace
    ? [`${namespace}/${relativeName}`, `/${relativeName}`, relativeName]
    : [`/${relativeName}`, relativeName];
  for (const name of names) {
    const series = seriesByName.get(name);
    if (series) return series;
  }
  return undefined;
}

function optionalNumeric(
  series: MutableSeries | undefined,
  label: string,
  issues: LogIssue[],
): NumericSeries | undefined {
  if (!series) {
    issues.push(warningIssue("OPTIONAL_SERIES_MISSING", `${label} is not present`));
    return undefined;
  }
  if (series.types.size !== 1 || !series.types.has("double")) {
    issues.push(
      warningIssue("OPTIONAL_TYPE_MISMATCH", `${label} is not a double series`, {
        entryName: series.name,
        details: { declaredTypes: [...series.types] },
      }),
    );
    return undefined;
  }
  if (series.numericValues.length === 0) return undefined;
  checkUnit(series, "voltage", issues);
  return finalizeNumeric(series, "V");
}

function optionalBoolean(
  series: MutableSeries | undefined,
  label: string,
  issues: LogIssue[],
): BooleanSeries | undefined {
  if (!series) {
    issues.push(warningIssue("OPTIONAL_SERIES_MISSING", `${label} is not present`));
    return undefined;
  }
  if (series.types.size !== 1 || !series.types.has("boolean")) {
    issues.push(
      warningIssue("OPTIONAL_TYPE_MISMATCH", `${label} is not a boolean series`, {
        entryName: series.name,
        details: { declaredTypes: [...series.types] },
      }),
    );
    return undefined;
  }
  if (series.booleanValues.length === 0) return undefined;
  return finalizeBoolean(series);
}

function optionalInteger(
  series: MutableSeries | undefined,
  label: string,
  issues: LogIssue[],
): IntegerSeries | undefined {
  if (!series) {
    issues.push(warningIssue("OPTIONAL_SERIES_MISSING", `${label} is not present`));
    return undefined;
  }
  if (series.types.size !== 1 || !series.types.has("int64")) {
    issues.push(
      warningIssue("OPTIONAL_TYPE_MISMATCH", `${label} is not an int64 series`, {
        entryName: series.name,
        details: { declaredTypes: [...series.types] },
      }),
    );
    return undefined;
  }
  if (series.integerValues.length === 0) return undefined;
  return finalizeInteger(series);
}

function upperBound(values: Float64Array, target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (values[middle] <= target) low = middle + 1;
    else high = middle;
  }
  return low;
}

function heldNumeric(series: NumericSeries, timestampUs: number, fallback = 0): number {
  const index = upperBound(series.timestampsUs, timestampUs) - 1;
  return index >= 0 ? series.values[index] : fallback;
}

function heldBoolean(series: BooleanSeries | undefined, timestampUs: number): boolean {
  if (!series) return false;
  const index = upperBound(series.timestampsUs, timestampUs) - 1;
  return index >= 0 && series.values[index] !== 0;
}

function heldBooleanState(
  series: BooleanSeries | undefined,
  timestampUs: number,
): boolean | undefined {
  if (!series) return undefined;
  const index = upperBound(series.timestampsUs, timestampUs) - 1;
  return index >= 0 ? series.values[index] !== 0 : undefined;
}

function heldInteger(series: IntegerSeries | undefined, timestampUs: number): bigint | undefined {
  if (!series) return undefined;
  const index = upperBound(series.timestampsUs, timestampUs) - 1;
  return index >= 0 ? series.values[index] : undefined;
}

function cumulativeDelta(
  series: NumericSeries,
  startUs: number,
  endUs: number,
): { energy: number; resets: number } {
  const firstIndexAfterStart = upperBound(series.timestampsUs, startUs);
  let previous: number;
  let index: number;
  if (series.timestampsUs.length > 0 && startUs <= series.timestampsUs[0]) {
    previous = 0;
    index = 0;
  } else {
    previous = heldNumeric(series, startUs, 0);
    index = firstIndexAfterStart;
  }
  let energy = 0;
  let resets = 0;
  for (; index < series.timestampsUs.length && series.timestampsUs[index] <= endUs; index += 1) {
    const value = series.values[index];
    if (value >= previous) energy += value - previous;
    else resets += 1;
    previous = value;
  }
  return { energy, resets };
}

function peakNumericSample(
  series: NumericSeries,
  startUs: number,
  endUs: number,
): { value: number; timestampUs: number } {
  let peak = { value: heldNumeric(series, startUs, 0), timestampUs: startUs };
  let index = upperBound(series.timestampsUs, startUs);
  while (index < series.timestampsUs.length && series.timestampsUs[index] <= endUs) {
    if (series.values[index] > peak.value) {
      peak = { value: series.values[index], timestampUs: series.timestampsUs[index] };
    }
    index += 1;
  }
  return peak;
}

function minNumeric(series: NumericSeries, startUs: number, endUs: number): number {
  let minimum = heldNumeric(series, startUs, Number.POSITIVE_INFINITY);
  let index = upperBound(series.timestampsUs, startUs);
  while (index < series.timestampsUs.length && series.timestampsUs[index] <= endUs) {
    minimum = Math.min(minimum, series.values[index]);
    index += 1;
  }
  return minimum;
}

function booleanIntervals(
  series: BooleanSeries | undefined,
  startUs: number,
  endUs: number,
): TimeInterval[] {
  if (!series || endUs <= startUs) return [];
  const intervals: TimeInterval[] = [];
  let active = heldBoolean(series, startUs);
  let intervalStart = active ? startUs : 0;
  let index = upperBound(series.timestampsUs, startUs);
  while (index < series.timestampsUs.length && series.timestampsUs[index] <= endUs) {
    const timestampUs = series.timestampsUs[index];
    const next = series.values[index] !== 0;
    if (!active && next) intervalStart = timestampUs;
    if (active && !next && timestampUs > intervalStart) {
      intervals.push({
        startUs: intervalStart,
        endUs: timestampUs,
        durationSeconds: (timestampUs - intervalStart) / 1_000_000,
      });
    }
    active = next;
    index += 1;
  }
  if (active && endUs > intervalStart) {
    intervals.push({
      startUs: intervalStart,
      endUs,
      durationSeconds: (endUs - intervalStart) / 1_000_000,
    });
  }
  return intervals;
}

function modeAt(
  enabled: BooleanSeries | undefined,
  autonomous: BooleanSeries | undefined,
  test: BooleanSeries | undefined,
  timestampUs: number,
): DriverStationMode | undefined {
  const enabledState = heldBooleanState(enabled, timestampUs);
  if (enabledState === undefined) return undefined;
  if (!enabledState) return "disabled";
  const autonomousState = heldBooleanState(autonomous, timestampUs);
  const testState = heldBooleanState(test, timestampUs);
  if (testState === true) return "test";
  if (autonomousState === true) return "autonomous";
  if (autonomousState === false && testState === false) return "teleop";
  return "enabled";
}

function modeIntervals(
  enabled: BooleanSeries | undefined,
  autonomous: BooleanSeries | undefined,
  test: BooleanSeries | undefined,
  matchType: IntegerSeries | undefined,
  startUs: number,
  endUs: number,
): ModeInterval[] {
  if (!enabled || endUs <= startUs) return [];
  const transitions = new Set<number>([startUs, endUs]);
  for (const series of [enabled, autonomous, test]) {
    if (!series) continue;
    for (const timestampUs of series.timestampsUs) {
      if (timestampUs > startUs && timestampUs < endUs) transitions.add(timestampUs);
    }
  }
  const matchTypeBoundaries = new Set<number>();
  if (matchType) {
    let previousValue = heldInteger(matchType, startUs);
    let index = upperBound(matchType.timestampsUs, startUs);
    while (index < matchType.timestampsUs.length && matchType.timestampsUs[index] < endUs) {
      const timestampUs = matchType.timestampsUs[index];
      const nextValue = matchType.values[index];
      if (nextValue !== previousValue) {
        transitions.add(timestampUs);
        matchTypeBoundaries.add(timestampUs);
      }
      previousValue = nextValue;
      index += 1;
    }
  }
  const sorted = [...transitions].sort((left, right) => left - right);
  const intervals: ModeInterval[] = [];
  for (let index = 0; index < sorted.length - 1; index += 1) {
    const segmentStart = sorted[index];
    const segmentEnd = sorted[index + 1];
    const mode = modeAt(enabled, autonomous, test, segmentStart);
    if (!mode) continue;
    const isPractice = heldInteger(matchType, segmentStart) === 1n;
    const previous = intervals.at(-1);
    if (
      previous?.mode === mode &&
      previous.isPractice === isPractice &&
      previous.endUs === segmentStart &&
      !matchTypeBoundaries.has(segmentStart)
    ) {
      previous.endUs = segmentEnd;
      previous.durationSeconds = (previous.endUs - previous.startUs) / 1_000_000;
    } else {
      intervals.push({
        mode,
        isPractice,
        startUs: segmentStart,
        endUs: segmentEnd,
        durationSeconds: (segmentEnd - segmentStart) / 1_000_000,
      });
    }
  }
  return intervals;
}

function reconciliation(
  totalEnergyWh: number,
  topLevelEnergyWh: number,
  absoluteToleranceWh: number,
  relativeTolerance: number,
): ReconciliationSummary {
  const differenceWh = totalEnergyWh - topLevelEnergyWh;
  const differencePercent =
    totalEnergyWh === 0 ? null : (Math.abs(differenceWh) / Math.abs(totalEnergyWh)) * 100;
  return {
    totalEnergyWh,
    topLevelEnergyWh,
    differenceWh,
    differencePercent,
    withinTolerance:
      Math.abs(differenceWh) <= absoluteToleranceWh ||
      (totalEnergyWh !== 0 && Math.abs(differenceWh / totalEnergyWh) <= relativeTolerance),
  };
}

function countResets(series: NumericSeries): number {
  let resets = 0;
  for (let index = 1; index < series.values.length; index += 1) {
    if (series.values[index] < series.values[index - 1]) resets += 1;
  }
  return resets;
}

export async function parseEnergyLog(
  source: WpiLogSource,
  options: ParseOptions = {},
): Promise<EnergyLogDataset> {
  const seriesByName = new Map<string, MutableSeries>();
  const bindings = new WeakMap<WpiLogEntry, EntryBinding>();
  const getSeries = (name: string): MutableSeries => {
    let series = seriesByName.get(name);
    if (!series) {
      series = createMutableSeries(name);
      seriesByName.set(name, series);
    }
    return series;
  };

  const listing = await decodeWpiLog(
    source,
    {
      onStart(entry) {
        const energyName = parseEnergyName(entry.name);
        const optionalType = optionalExpectedType(entry.name);
        if (!energyName && !optionalType) return;
        const series = getSeries(entry.name);
        series.types.add(entry.type);
        series.metadata = entry.metadata;
        bindings.set(entry, { series, expectedType: energyName ? "double" : optionalType! });
      },
      onMetadata(entry) {
        const binding = bindings.get(entry);
        if (binding) binding.series.metadata = entry.metadata;
      },
      onData(record) {
        const binding = bindings.get(record.entry);
        if (binding) readBoundValue(record, binding);
      },
    },
    options,
  );

  const issues = [...listing.issues];
  const root = chooseRoot(seriesByName);
  if (rootPriority(root) === 1) {
    issues.push(
      warningIssue("SIM_OR_REPLAY_LOG", `Using replay EnergyLogger root ${root}`, {
        details: { root },
      }),
    );
  }

  const totalCurrentBuilder = seriesByName.get(`${root}/totalCurrent`)!;
  const totalPowerBuilder = seriesByName.get(`${root}/totalPower`)!;
  const totalEnergyBuilder = seriesByName.get(`${root}/totalEnergy`)!;
  for (const [series, label] of [
    [totalCurrentBuilder, "totalCurrent"],
    [totalPowerBuilder, "totalPower"],
    [totalEnergyBuilder, "totalEnergy"],
  ] as const) {
    requireDouble(series, label);
    requireFinite(series, label);
  }

  const dynamicGroups = new Map<string, DynamicGroup>();
  const normalizedRawPaths = new Map<string, Set<string>>();
  const selectedMutable: MutableSeries[] = [
    totalCurrentBuilder,
    totalPowerBuilder,
    totalEnergyBuilder,
  ];
  for (const [name, series] of seriesByName) {
    const parsed = parseEnergyName(name);
    if (!parsed || parsed.root !== root || !parsed.rawPath) continue;
    requireDouble(series, name);
    const id = normalizeDynamicPath(parsed.rawPath);
    const rawPaths = normalizedRawPaths.get(id) ?? new Set<string>();
    rawPaths.add(parsed.rawPath);
    normalizedRawPaths.set(id, rawPaths);
    const group = dynamicGroups.get(id) ?? { id, rawPath: parsed.rawPath };
    const existing = group[parsed.kind as EnergyFamily];
    if (existing && existing.name !== series.name) rawPaths.add(existing.name);
    group[parsed.kind as EnergyFamily] = series;
    dynamicGroups.set(id, group);
    selectedMutable.push(series);
  }

  for (const [id, rawPaths] of normalizedRawPaths) {
    if (rawPaths.size > 1) {
      throw new LogAnalysisError(
        fatalIssue(
          "PATH_NORMALIZATION_COLLISION",
          `Multiple raw EnergyLogger paths normalize to ${id}`,
          { details: { id, rawPaths: [...rawPaths] } },
        ),
      );
    }
  }

  const completeGroups: DynamicGroup[] = [];
  for (const group of dynamicGroups.values()) {
    const missing = (["current", "power", "energy"] as const).filter((family) => !group[family]);
    if (missing.length > 0) {
      issues.push(
        warningIssue(
          "PARTIAL_SUBSERIES",
          `EnergyLogger path ${group.rawPath} is missing ${missing.join(", ")}`,
          { details: { id: group.id, rawPath: group.rawPath, missing } },
        ),
      );
      continue;
    }
    if (
      group.current!.numericValues.length === 0 ||
      group.power!.numericValues.length === 0 ||
      group.energy!.numericValues.length === 0
    ) {
      issues.push(
        warningIssue(
          "PARTIAL_SUBSERIES",
          `EnergyLogger path ${group.rawPath} has an empty current, power, or energy series`,
          { details: { id: group.id, rawPath: group.rawPath } },
        ),
      );
      continue;
    }
    completeGroups.push(group);
  }
  if (completeGroups.length === 0) {
    throw new LogAnalysisError(
      fatalIssue(
        "MISSING_COMPLETE_DYNAMIC_SERIES",
        "No dynamic EnergyLogger path has complete current, power, and energy series",
      ),
    );
  }

  checkUnit(totalCurrentBuilder, "totalCurrent", issues);
  checkUnit(totalPowerBuilder, "totalPower", issues);
  checkUnit(totalEnergyBuilder, "totalEnergy", issues);
  const dynamicByFamily = new Map<EnergyFamily, MutableSeries[]>();
  for (const family of ["current", "power", "energy"] as const) {
    dynamicByFamily.set(
      family,
      completeGroups.map((group) => group[family]!),
    );
  }
  for (const [family, builders] of dynamicByFamily) {
    const representative = builders.find((builder) => metadataUnit(builder.metadata));
    if (representative) checkUnit(representative, family, issues);
    else {
      issues.push(
        warningIssue(
          "UNIT_METADATA_MISSING",
          `Units metadata is absent for dynamic ${family} series`,
          { details: { family, count: builders.length } },
        ),
      );
    }
  }

  const totalCurrentA = finalizeNumeric(totalCurrentBuilder, "A");
  const totalPowerW = finalizeNumeric(totalPowerBuilder, "W");
  const totalEnergyWh = finalizeNumeric(totalEnergyBuilder, "Wh");
  const energyStartUs = totalEnergyWh.timestampsUs[0];
  const energyEndUs = totalEnergyWh.timestampsUs.at(-1)!;
  if (energyEndUs < energyStartUs) {
    throw new LogAnalysisError(
      fatalIssue("NO_FINITE_ENERGY_DATA", "EnergyLogger timestamps do not form a valid range"),
    );
  }

  const completeIds = new Set(completeGroups.map((group) => group.id));
  const subsystems: SubsystemNode[] = completeGroups.map((group) => {
    const segments = group.id.split("/");
    const directParent = segments.slice(0, -1).join("/");
    let parentId: string | null = directParent || null;
    while (parentId && !completeIds.has(parentId)) {
      const parentSegments = parentId.split("/");
      parentId = parentSegments.length > 1 ? parentSegments.slice(0, -1).join("/") : null;
    }
    return {
      id: group.id,
      rawPath: group.rawPath,
      displayName: segments.at(-1)!,
      parentId,
      depth: segments.length - 1,
      childrenIds: [],
      isAggregate: false,
      currentA: finalizeNumeric(group.current!, "A"),
      powerW: finalizeNumeric(group.power!, "W"),
      energyWh: finalizeNumeric(group.energy!, "Wh"),
    };
  });
  const nodesById = new Map(subsystems.map((node) => [node.id, node]));
  for (const node of subsystems) {
    if (!node.parentId) continue;
    const parent = nodesById.get(node.parentId);
    if (parent) parent.childrenIds.push(node.id);
  }
  for (const node of subsystems) {
    node.childrenIds.sort();
    node.isAggregate = node.childrenIds.length > 0;
  }
  subsystems.sort((left, right) => left.id.localeCompare(right.id));

  const namespace = root === "energyLogger" ? "" : root.slice(0, -"/energyLogger".length);
  const batteryVoltageV = optionalNumeric(
    findOptional(seriesByName, namespace, "energyLogger/BatteryVoltageVolt") ??
      findOptional(seriesByName, namespace, "SystemStats/BatteryVoltage"),
    "Battery voltage",
    issues,
  );
  const brownedOut = optionalBoolean(
    findOptional(seriesByName, namespace, "SystemStats/BrownedOut"),
    "Browned-out state",
    issues,
  );
  const brownoutVoltageV = optionalNumeric(
    findOptional(seriesByName, namespace, "SystemStats/BrownoutVoltage"),
    "Brownout voltage",
    issues,
  );
  const enabled = optionalBoolean(
    findOptional(seriesByName, namespace, "DriverStation/Enabled"),
    "Driver Station enabled state",
    issues,
  );
  const autonomous = optionalBoolean(
    findOptional(seriesByName, namespace, "DriverStation/Autonomous"),
    "Driver Station autonomous state",
    issues,
  );
  const test = optionalBoolean(
    findOptional(seriesByName, namespace, "DriverStation/Test"),
    "Driver Station test state",
    issues,
  );
  const matchType = optionalInteger(
    findOptional(seriesByName, namespace, "DriverStation/MatchType"),
    "Driver Station match type",
    issues,
  );

  const { droppedNonfiniteSamples } = detectSeriesQuality(
    selectedMutable,
    totalEnergyBuilder,
    issues,
    options.timeGapWarningUs ?? DEFAULT_GAP_US,
  );
  const resetCount = [totalEnergyWh, ...subsystems.map((node) => node.energyWh)].reduce(
    (sum, series) => sum + countResets(series),
    0,
  );
  if (resetCount > 0) {
    issues.push(
      warningIssue("ENERGY_RESET", `Detected ${resetCount} cumulative energy resets`, {
        details: { resetCount },
      }),
    );
  }

  const fullTotalEnergy = cumulativeDelta(totalEnergyWh, energyStartUs, energyEndUs).energy;
  const fullTopLevelEnergy = subsystems
    .filter((node) => node.parentId === null)
    .reduce(
      (sum, node) => sum + cumulativeDelta(node.energyWh, energyStartUs, energyEndUs).energy,
      0,
    );
  const absoluteToleranceWh =
    options.reconciliationAbsoluteToleranceWh ?? DEFAULT_ABSOLUTE_TOLERANCE_WH;
  const relativeTolerance =
    options.reconciliationRelativeTolerance ?? DEFAULT_RELATIVE_TOLERANCE;
  const fullReconciliation = reconciliation(
    fullTotalEnergy,
    fullTopLevelEnergy,
    absoluteToleranceWh,
    relativeTolerance,
  );
  if (!fullReconciliation.withinTolerance) {
    issues.push(
      warningIssue(
        "ENERGY_RECONCILIATION_MISMATCH",
        "Top-level subsystem energy does not reconcile with totalEnergy",
        { details: { ...fullReconciliation } },
      ),
    );
  }
  for (const parent of subsystems.filter((node) => node.childrenIds.length > 0)) {
    const parentEnergyWh = cumulativeDelta(parent.energyWh, energyStartUs, energyEndUs).energy;
    const childEnergyWh = parent.childrenIds.reduce((sum, childId) => {
      const child = nodesById.get(childId)!;
      return sum + cumulativeDelta(child.energyWh, energyStartUs, energyEndUs).energy;
    }, 0);
    const childReconciliation = reconciliation(
      parentEnergyWh,
      childEnergyWh,
      absoluteToleranceWh,
      relativeTolerance,
    );
    if (!childReconciliation.withinTolerance) {
      issues.push(
        warningIssue(
          "ENERGY_RECONCILIATION_MISMATCH",
          `Aggregate ${parent.rawPath} does not reconcile with its direct children`,
          {
            entryName: parent.energyWh.entryName,
            details: { scope: "aggregate", parentId: parent.id, ...childReconciliation },
          },
        ),
      );
    }
  }

  const quality: DataQuality = {
    issues,
    reconciliation: fullReconciliation,
    droppedNonfiniteSamples,
    resetCount,
  };
  return {
    header: listing.header,
    file: listing.file,
    root,
    bounds: {
      logStartUs: listing.file.firstTimestampUs ?? energyStartUs,
      logEndUs: listing.file.lastTimestampUs ?? energyEndUs,
      energyStartUs,
      energyEndUs,
    },
    series: {
      totalCurrentA,
      totalPowerW,
      totalEnergyWh,
      batteryVoltageV,
      brownedOut,
      brownoutVoltageV,
      enabled,
      autonomous,
      test,
      matchType,
    },
    subsystems,
    segments: {
      brownouts: booleanIntervals(brownedOut, energyStartUs, energyEndUs),
      enabled: booleanIntervals(enabled, energyStartUs, energyEndUs),
      modes: modeIntervals(
        enabled,
        autonomous,
        test,
        matchType,
        energyStartUs,
        energyEndUs,
      ),
    },
    quality,
  };
}

function rangeIntersections(intervals: TimeInterval[], range: TimeRange): TimeInterval[] {
  const result: TimeInterval[] = [];
  for (const interval of intervals) {
    const startUs = Math.max(interval.startUs, range.startUs);
    const endUs = Math.min(interval.endUs, range.endUs);
    if (endUs <= startUs) continue;
    result.push({ startUs, endUs, durationSeconds: (endUs - startUs) / 1_000_000 });
  }
  return result;
}

export function analyzeEnergyRange(
  dataset: EnergyLogDataset,
  requested: Partial<TimeRange> = {},
): RangeAnalysis {
  const startUs = requested.startUs ?? dataset.bounds.energyStartUs;
  const endUs = requested.endUs ?? dataset.bounds.energyEndUs;
  if (!Number.isFinite(startUs) || !Number.isFinite(endUs) || endUs < startUs) {
    throw new RangeError("Energy analysis range must contain finite timestamps with end >= start");
  }
  const range = {
    startUs: Math.max(dataset.bounds.energyStartUs, startUs),
    endUs: Math.min(dataset.bounds.energyEndUs, endUs),
  };
  if (range.endUs < range.startUs) throw new RangeError("Energy analysis range is outside the log");
  const durationSeconds = (range.endUs - range.startUs) / 1_000_000;
  const totalEnergy = cumulativeDelta(
    dataset.series.totalEnergyWh,
    range.startUs,
    range.endUs,
  ).energy;

  const subsystemMetrics: SubsystemRangeMetrics[] = dataset.subsystems.map((node) => {
    const energyWh = cumulativeDelta(node.energyWh, range.startUs, range.endUs).energy;
    const peakPower = peakNumericSample(node.powerW, range.startUs, range.endUs);
    const peakCurrent = peakNumericSample(node.currentA, range.startUs, range.endUs);
    return {
      id: node.id,
      rawPath: node.rawPath,
      displayName: node.displayName,
      parentId: node.parentId,
      depth: node.depth,
      childrenIds: node.childrenIds,
      isAggregate: node.isAggregate,
      energyWh,
      averagePowerW: durationSeconds > 0 ? (energyWh * 3600) / durationSeconds : 0,
      peakPowerW: peakPower.value,
      peakPowerTimestampUs: peakPower.timestampUs,
      peakCurrentA: peakCurrent.value,
      peakCurrentTimestampUs: peakCurrent.timestampUs,
      share: null,
    };
  });
  const siblingTotals = new Map<string, number>();
  for (const metrics of subsystemMetrics) {
    const parentKey = metrics.parentId ?? "";
    siblingTotals.set(parentKey, (siblingTotals.get(parentKey) ?? 0) + metrics.energyWh);
  }
  for (const metrics of subsystemMetrics) {
    const siblingTotal = siblingTotals.get(metrics.parentId ?? "") ?? 0;
    metrics.share = siblingTotal > 0 ? metrics.energyWh / siblingTotal : null;
  }

  const brownoutIntervals = rangeIntersections(dataset.segments.brownouts, range);
  const enabledIntervals = rangeIntersections(dataset.segments.enabled, range);
  const topLevelEnergyWh = subsystemMetrics
    .filter((metrics) => metrics.parentId === null)
    .reduce((sum, metrics) => sum + metrics.energyWh, 0);
  const baseTolerance = dataset.quality.reconciliation;
  const absoluteTolerance = Math.max(
    DEFAULT_ABSOLUTE_TOLERANCE_WH,
    Math.abs(baseTolerance.differenceWh),
  );
  const rangeReconciliation = reconciliation(
    totalEnergy,
    topLevelEnergyWh,
    absoluteTolerance,
    DEFAULT_RELATIVE_TOLERANCE,
  );
  const peakPower = peakNumericSample(
    dataset.series.totalPowerW,
    range.startUs,
    range.endUs,
  );
  const peakCurrent = peakNumericSample(
    dataset.series.totalCurrentA,
    range.startUs,
    range.endUs,
  );
  return {
    range: { ...range, durationSeconds },
    totals: {
      energyWh: totalEnergy,
      averagePowerW: durationSeconds > 0 ? (totalEnergy * 3600) / durationSeconds : 0,
      peakPowerW: peakPower.value,
      peakPowerTimestampUs: peakPower.timestampUs,
      peakCurrentA: peakCurrent.value,
      peakCurrentTimestampUs: peakCurrent.timestampUs,
      minVoltageV: dataset.series.batteryVoltageV
        ? minNumeric(dataset.series.batteryVoltageV, range.startUs, range.endUs)
        : undefined,
      brownoutCount: brownoutIntervals.length,
      brownoutDurationSeconds: brownoutIntervals.reduce(
        (sum, interval) => sum + interval.durationSeconds,
        0,
      ),
      enabledDurationSeconds: enabledIntervals.reduce(
        (sum, interval) => sum + interval.durationSeconds,
        0,
      ),
    },
    subsystems: subsystemMetrics,
    quality: { ...dataset.quality, reconciliation: rangeReconciliation },
  };
}

export async function analyzeWpiLog(
  source: WpiLogSource,
  options: ParseOptions = {},
): Promise<AnalysisResult> {
  const dataset = await parseEnergyLog(source, options);
  return { dataset, range: analyzeEnergyRange(dataset) };
}
