export type IssueSeverity = "fatal" | "warning";

export type LogIssueCode =
  | "INVALID_WPILOG"
  | "UNSUPPORTED_VERSION"
  | "CORRUPT_RECORD_MIDDLE"
  | "TRUNCATED_TAIL_RECOVERED"
  | "MISSING_ENERGY_TOTALS"
  | "MISSING_COMPLETE_DYNAMIC_SERIES"
  | "ENERGY_TYPE_MISMATCH"
  | "NO_FINITE_ENERGY_DATA"
  | "AMBIGUOUS_ENERGY_ROOT"
  | "PATH_NORMALIZATION_COLLISION"
  | "INVALID_DYNAMIC_PATH"
  | "UNIT_METADATA_MISSING"
  | "UNIT_METADATA_MISMATCH"
  | "OPTIONAL_SERIES_MISSING"
  | "OPTIONAL_TYPE_MISMATCH"
  | "ENERGY_RESET"
  | "TIME_GAP"
  | "ENERGY_RECONCILIATION_MISMATCH"
  | "NEGATIVE_VALUE"
  | "NONFINITE_VALUE_DROPPED"
  | "SIM_OR_REPLAY_LOG"
  | "PARTIAL_SUBSERIES";

export interface LogIssue {
  severity: IssueSeverity;
  code: LogIssueCode;
  message: string;
  offset?: number;
  entryName?: string;
  details?: Record<string, unknown>;
}

export interface WpiLogHeader {
  version: number;
  majorVersion: number;
  minorVersion: number;
  extraHeader: string;
  byteLength: number;
}

export interface WpiLogEntry {
  entryId: number;
  generation: number;
  name: string;
  type: string;
  metadata: string;
  startTimestampUs: number;
  finishTimestampUs?: number;
  recordCount: number;
  firstTimestampUs?: number;
  lastTimestampUs?: number;
}

export interface TruncatedTail {
  offset: number;
  headerBytesAvailable: number;
  entryId?: number;
  declaredPayloadLength?: number;
  availablePayloadLength?: number;
  missingBytes?: number;
}

export interface WpiLogFileInfo {
  sizeBytes?: number;
  recordCount: number;
  dataRecordCount: number;
  controlRecordCount: number;
  firstTimestampUs?: number;
  lastTimestampUs?: number;
  lastGoodOffset: number;
  truncatedTail?: TruncatedTail;
}

export interface WpiLogListing {
  header: WpiLogHeader;
  file: WpiLogFileInfo;
  entries: WpiLogEntry[];
  issues: LogIssue[];
}

export interface NumericSeries {
  timestampsUs: Float64Array;
  values: Float64Array;
  unit: string;
  entryName: string;
}

export interface BooleanSeries {
  timestampsUs: Float64Array;
  values: Uint8Array;
  entryName: string;
}

export interface TimeRange {
  startUs: number;
  endUs: number;
}

export interface TimeInterval extends TimeRange {
  durationSeconds: number;
}

export type DriverStationMode = "disabled" | "autonomous" | "teleop" | "enabled";

export interface ModeInterval extends TimeInterval {
  mode: DriverStationMode;
}

export interface SubsystemNode {
  id: string;
  rawPath: string;
  displayName: string;
  parentId: string | null;
  depth: number;
  childrenIds: string[];
  isAggregate: boolean;
  currentA: NumericSeries;
  powerW: NumericSeries;
  energyWh: NumericSeries;
}

export interface ReconciliationSummary {
  totalEnergyWh: number;
  topLevelEnergyWh: number;
  differenceWh: number;
  differencePercent: number | null;
  withinTolerance: boolean;
}

export interface DataQuality {
  issues: LogIssue[];
  reconciliation: ReconciliationSummary;
  droppedNonfiniteSamples: number;
  resetCount: number;
}

export interface EnergyLogDataset {
  header: WpiLogHeader;
  file: WpiLogFileInfo;
  root: string;
  bounds: {
    logStartUs: number;
    logEndUs: number;
    energyStartUs: number;
    energyEndUs: number;
  };
  series: {
    totalCurrentA: NumericSeries;
    totalPowerW: NumericSeries;
    totalEnergyWh: NumericSeries;
    batteryVoltageV?: NumericSeries;
    brownedOut?: BooleanSeries;
    brownoutVoltageV?: NumericSeries;
    enabled?: BooleanSeries;
    autonomous?: BooleanSeries;
    teleop?: BooleanSeries;
  };
  subsystems: SubsystemNode[];
  segments: {
    brownouts: TimeInterval[];
    enabled: TimeInterval[];
    modes: ModeInterval[];
  };
  quality: DataQuality;
}

export interface SubsystemRangeMetrics {
  id: string;
  rawPath: string;
  displayName: string;
  parentId: string | null;
  depth: number;
  childrenIds: string[];
  isAggregate: boolean;
  energyWh: number;
  averagePowerW: number;
  peakPowerW: number;
  peakPowerTimestampUs: number;
  peakCurrentA: number;
  peakCurrentTimestampUs: number;
  share: number | null;
}

export interface RangeAnalysis {
  range: TimeRange & { durationSeconds: number };
  totals: {
    energyWh: number;
    averagePowerW: number;
    peakPowerW: number;
    peakPowerTimestampUs: number;
    peakCurrentA: number;
    peakCurrentTimestampUs: number;
    minVoltageV?: number;
    brownoutCount: number;
    brownoutDurationSeconds: number;
    enabledDurationSeconds: number;
  };
  subsystems: SubsystemRangeMetrics[];
  quality: DataQuality;
}

export interface AnalysisResult {
  dataset: EnergyLogDataset;
  range: RangeAnalysis;
}

export type WpiLogSource =
  | Blob
  | ArrayBuffer
  | ArrayBufferView
  | AsyncIterable<Uint8Array>;

export interface ParseOptions {
  signal?: AbortSignal;
  chunkSize?: number;
  onProgress?: (processedBytes: number, totalBytes?: number) => void;
  timeGapWarningUs?: number;
  reconciliationAbsoluteToleranceWh?: number;
  reconciliationRelativeTolerance?: number;
}
