/// <reference lib="webworker" />

import { analyzeWpiLog, LogAnalysisError } from "../core";
import {
  toParseOptions,
  type LogAnalysisWorkerRequest,
  type LogAnalysisWorkerResponse,
} from "./protocol";

const controllers = new Map<string, AbortController>();

function post(response: LogAnalysisWorkerResponse, transfer: Transferable[] = []): void {
  self.postMessage(response, { transfer });
}

function collectTransferables(result: Awaited<ReturnType<typeof analyzeWpiLog>>): Transferable[] {
  const buffers = new Set<ArrayBuffer>();
  const addNumeric = (series: { timestampsUs: Float64Array; values: Float64Array } | undefined) => {
    if (!series) return;
    buffers.add(series.timestampsUs.buffer as ArrayBuffer);
    buffers.add(series.values.buffer as ArrayBuffer);
  };
  const addBoolean = (series: { timestampsUs: Float64Array; values: Uint8Array } | undefined) => {
    if (!series) return;
    buffers.add(series.timestampsUs.buffer as ArrayBuffer);
    buffers.add(series.values.buffer as ArrayBuffer);
  };
  const { dataset } = result;
  addNumeric(dataset.series.totalCurrentA);
  addNumeric(dataset.series.totalPowerW);
  addNumeric(dataset.series.totalEnergyWh);
  addNumeric(dataset.series.batteryVoltageV);
  addNumeric(dataset.series.brownoutVoltageV);
  addBoolean(dataset.series.brownedOut);
  addBoolean(dataset.series.enabled);
  addBoolean(dataset.series.autonomous);
  addBoolean(dataset.series.teleop);
  for (const subsystem of dataset.subsystems) {
    addNumeric(subsystem.currentA);
    addNumeric(subsystem.powerW);
    addNumeric(subsystem.energyWh);
  }
  return [...buffers];
}

async function analyze(request: Extract<LogAnalysisWorkerRequest, { type: "analyze" }>): Promise<void> {
  const controller = new AbortController();
  controllers.get(request.requestId)?.abort();
  controllers.set(request.requestId, controller);
  try {
    const result = await analyzeWpiLog(
      request.file,
      toParseOptions(request.options, controller.signal, (processedBytes, totalBytes) => {
        post({ type: "progress", requestId: request.requestId, processedBytes, totalBytes });
      }),
    );
    if (controllers.get(request.requestId) !== controller) return;
    post(
      { type: "result", requestId: request.requestId, result },
      collectTransferables(result),
    );
  } catch (error) {
    if (controllers.get(request.requestId) !== controller) return;
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
    if (controllers.get(request.requestId) === controller) controllers.delete(request.requestId);
  }
}

self.onmessage = (event: MessageEvent<LogAnalysisWorkerRequest>) => {
  if (event.data.type === "cancel") {
    controllers.get(event.data.requestId)?.abort();
    return;
  }
  void analyze(event.data);
};
