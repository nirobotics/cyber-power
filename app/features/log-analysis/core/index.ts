export { LogAnalysisError } from "./errors";
export { analyzeEnergyRange, analyzeWpiLog, parseEnergyLog } from "./energy-analysis";
export {
  estimateSupplyCurrentLimits,
  SupplyLimitValidationError,
  validateSupplyCurrentLimits,
} from "./supply-limit-estimator";
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
  IntegerSeries,
  LogIssue,
  LogIssueCode,
  ModeInterval,
  NumericSeries,
  ParseOptions,
  RangeAnalysis,
  ReconciliationSummary,
  SubsystemNode,
  SubsystemRangeMetrics,
  SupplyCurrentLimitInput,
  SupplyLimitEstimate,
  SupplyLimitEstimateOptions,
  SupplyLimitMetricSnapshot,
  SupplyLimitNodeKind,
  SupplyLimitTargetEstimate,
  SupplyLimitTargetTimeline,
  SupplyLimitTimeline,
  SupplyLimitTotals,
  SupplyLimitValidationCode,
  SupplyLimitValidationIssue,
  SupplyLimitWarning,
  SupplyLimitWarningCode,
  TimeInterval,
  TimeRange,
  TruncatedTail,
  WpiLogEntry,
  WpiLogFileInfo,
  WpiLogHeader,
  WpiLogListing,
  WpiLogSource,
} from "./types";
