export { LogAnalysisError } from "./errors";
export { analyzeEnergyRange, analyzeWpiLog, parseEnergyLog } from "./energy-analysis";
export {
  estimateSupplyCurrentLimits,
  SupplyLimitValidationError,
  validateSupplyCurrentLimits,
} from "./supply-limit-estimator";
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
  EnergyLogDataset,
  LogIssue,
  LogIssueCode,
  ModeInterval,
  NumericSeries,
  ParseOptions,
  RangeAnalysis,
  SubsystemNode,
  SubsystemRangeMetrics,
  SupplyCurrentLimitInput,
  SupplyLimitEstimate,
  SupplyLimitValidationIssue,
  TimeInterval,
  TimeRange,
  WpiLogListing,
  WpiLogSource,
} from "./types";
