import {
  analyzeWpiLog,
  LogAnalysisError,
  type AnalysisResult,
} from "../core";
import {
  type LogAnalysisWorkerRequest,
  type LogAnalysisWorkerResponse,
} from "./protocol";

type AnalyzeWpiLog = typeof analyzeWpiLog;

export interface LogAnalysisWorkerHandlerOptions {
  analyze?: AnalyzeWpiLog;
  post: (response: LogAnalysisWorkerResponse, transfer?: Transferable[]) => void;
}

function collectTransferables(result: AnalysisResult): Transferable[] {
  const buffers = new Set<ArrayBuffer>();
  const addSeries = (
    series: { timestampsUs: Float64Array; values: ArrayBufferView } | undefined,
  ) => {
    if (!series) return;
    buffers.add(series.timestampsUs.buffer as ArrayBuffer);
    buffers.add(series.values.buffer as ArrayBuffer);
  };
  const { dataset } = result;
  addSeries(dataset.series.totalCurrentA);
  addSeries(dataset.series.totalPowerW);
  addSeries(dataset.series.totalEnergyWh);
  addSeries(dataset.series.batteryVoltageV);
  addSeries(dataset.series.brownoutVoltageV);
  addSeries(dataset.series.brownedOut);
  addSeries(dataset.series.enabled);
  addSeries(dataset.series.autonomous);
  addSeries(dataset.series.test);
  addSeries(dataset.series.matchType);
  for (const subsystem of dataset.subsystems) {
    addSeries(subsystem.currentA);
    addSeries(subsystem.powerW);
    addSeries(subsystem.energyWh);
  }
  return [...buffers];
}

export function createLogAnalysisWorkerHandler({
  analyze = analyzeWpiLog,
  post,
}: LogAnalysisWorkerHandlerOptions): (request: LogAnalysisWorkerRequest) => void {
  const controllers = new Map<string, AbortController>();

  const run = async (
    request: Extract<LogAnalysisWorkerRequest, { type: "analyze" }>,
  ): Promise<void> => {
    const controller = new AbortController();
    const previousController = controllers.get(request.requestId);
    controllers.set(request.requestId, controller);
    previousController?.abort();
    const isCurrent = () => controllers.get(request.requestId) === controller;

    try {
      const result = await analyze(
        request.file,
        {
          ...request.options,
          signal: controller.signal,
          onProgress: (processedBytes, totalBytes) => {
            if (!isCurrent()) return;
            post({ type: "progress", requestId: request.requestId, processedBytes, totalBytes });
          },
        },
      );
      if (!isCurrent()) return;
      post({ type: "result", requestId: request.requestId, result }, collectTransferables(result));
    } catch (error) {
      if (!isCurrent()) return;
      post({
        type: "error",
        requestId: request.requestId,
        error: {
          name: error instanceof Error ? error.name : "Error",
          message: error instanceof Error ? error.message : String(error),
          issues: error instanceof LogAnalysisError ? error.issues : undefined,
        },
      });
    } finally {
      if (isCurrent()) controllers.delete(request.requestId);
    }
  };

  return (request) => {
    if (request.type === "cancel") {
      const controller = controllers.get(request.requestId);
      if (!controller) return;
      controllers.delete(request.requestId);
      controller.abort();
      return;
    }
    void run(request);
  };
}
