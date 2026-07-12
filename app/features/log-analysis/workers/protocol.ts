import type { AnalysisResult, LogIssue, ParseOptions } from "../core";

export interface AnalyzeWorkerOptions {
  chunkSize?: number;
  timeGapWarningUs?: number;
  reconciliationAbsoluteToleranceWh?: number;
  reconciliationRelativeTolerance?: number;
}

export type LogAnalysisWorkerRequest =
  | {
      type: "analyze";
      requestId: string;
      file: Blob;
      options?: AnalyzeWorkerOptions;
    }
  | { type: "cancel"; requestId: string };

export type LogAnalysisWorkerResponse =
  | {
      type: "progress";
      requestId: string;
      processedBytes: number;
      totalBytes?: number;
    }
  | { type: "result"; requestId: string; result: AnalysisResult }
  | {
      type: "error";
      requestId: string;
      error: { name: string; message: string; issues?: LogIssue[] };
    };

export function toParseOptions(
  options: AnalyzeWorkerOptions | undefined,
  signal: AbortSignal,
  onProgress: NonNullable<ParseOptions["onProgress"]>,
): ParseOptions {
  return { ...options, signal, onProgress };
}
