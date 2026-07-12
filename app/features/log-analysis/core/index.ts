export { LogAnalysisError } from "./errors";
export { analyzeEnergyRange, analyzeWpiLog, parseEnergyLog } from "./energy-analysis";
export { decodeWpiLog } from "./wpilog-decoder";
export type { WpiLogDataRecord, WpiLogDecoderHandlers } from "./wpilog-decoder";

import { decodeWpiLog } from "./wpilog-decoder";
import type { ParseOptions, WpiLogListing, WpiLogSource } from "./types";

export async function listWpiLog(
  source: WpiLogSource,
  options: ParseOptions = {},
): Promise<WpiLogListing> {
  return decodeWpiLog(source, {}, options);
}

export type {
  AnalysisResult,
  BooleanSeries,
  DataQuality,
  DriverStationMode,
  EnergyLogDataset,
  LogIssue,
  LogIssueCode,
  ModeInterval,
  NumericSeries,
  ParseOptions,
  RangeAnalysis,
  ReconciliationSummary,
  SubsystemNode,
  SubsystemRangeMetrics,
  TimeInterval,
  TimeRange,
  TruncatedTail,
  WpiLogEntry,
  WpiLogFileInfo,
  WpiLogHeader,
  WpiLogListing,
  WpiLogSource,
} from "./types";
