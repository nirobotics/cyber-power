export { LogAnalysisError } from "./errors";
export { analyzeEnergyRange, analyzeWpiLog, parseEnergyLog } from "./energy-analysis";
export { analyzeBatteryLoadResponse, binBatteryLoadObservedCurve } from "./battery-proxy";
export type {
  BatteryLoadLocalWindows,
  BatteryLoadObservedBrownoutEvents,
  BatteryLoadObservedCurve,
  BatteryLoadObservedDistribution,
  BatteryLoadObservedDistributionBin,
  BatteryLoadObservedDistributionOptions,
  BatteryLoadObservedLowVoltage,
  BatteryLoadResponseAnalysis,
  BatteryLoadResponseOptions,
  BatteryLoadResponseQuality,
  BatteryLoadResponseSummary,
  BatteryLoadStepResponse,
  BatteryLoadModeStats,
} from "./battery-proxy";
export {
  analyzeMotorTelemetry,
  analyzeMotorTelemetryDiagnostics,
  MOTOR_COVERAGE_STATUS,
  MOTOR_COVERAGE_STATUS_COUNT,
  MOTOR_MODELS,
  recommendGearRatio,
} from "./motor-models";
export type {
  MotorCoverageStatusCode,
  MotorCoverageTimeline,
  MotorTelemetryDiagnostics,
  MotorTelemetrySeries,
} from "./motor-models";
export {
  analyzeEnergyLoggerV2Range,
  deriveEnergyLoggerV2MotorGroupElectricalSeries,
} from "./v2-metrics";
export type {
  EnergyLoggerV2MotorGroupElectricalSeries,
  EnergyLoggerV2MotorGroupMetrics,
  EnergyLoggerV2RangeAnalysis,
  EnergyLoggerV2StateMetrics,
} from "./v2-metrics";
export type {
  EnergyLoggerV2Contract,
  EnergyLoggerV2Manifest,
  EnergyLoggerV2MotorDescriptor,
} from "./v2-contract";
export {
  analyzeSupplyLimitMotorGroups,
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
  EnergyLogV2SubsystemDataset,
  LogIssue,
  LogIssueCode,
  ModeInterval,
  NumericSeries,
  PackedNumericSeries,
  ParseOptions,
  RangeAnalysis,
  SubsystemNode,
  SubsystemRangeMetrics,
  SupplyCurrentLimitInput,
  SupplyLimitEstimate,
  SupplyLimitMotorGroupMetrics,
  SupplyLimitValidationIssue,
  TimeInterval,
  TimeRange,
  WpiLogListing,
  WpiLogSource,
} from "./types";
