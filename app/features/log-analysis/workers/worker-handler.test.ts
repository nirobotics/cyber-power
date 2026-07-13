import { describe, expect, it, vi } from "vitest";

import {
  analyzeWpiLog,
  LogAnalysisError,
  type AnalysisResult,
  type ParseOptions,
} from "../core";
import {
  appendEnergySample,
  buildEnergyFixture,
} from "../../../../tests/fixtures/wpilog-builder";
import type { LogAnalysisWorkerResponse } from "./protocol";
import { createLogAnalysisWorkerHandler } from "./worker-handler";

interface PostedMessage {
  response: LogAnalysisWorkerResponse;
  transfer: Transferable[];
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

async function buildResult(): Promise<AnalysisResult> {
  const { builder, entries } = buildEnergyFixture({ includeOptionals: true });
  appendEnergySample(builder, entries, 1_000_000, { current: 10, power: 120, energy: 1 });
  builder
    .double(entries.voltage, 1_000_000, 12)
    .double(entries.brownoutVoltage, 1_000_000, 6.3)
    .boolean(entries.brownedOut, 1_000_000, false)
    .boolean(entries.enabled, 1_000_000, true)
    .boolean(entries.autonomous, 1_000_000, true)
    .boolean(entries.teleop, 1_000_000, false);
  appendEnergySample(builder, entries, 2_000_000, { current: 20, power: 240, energy: 3 });
  builder
    .double(entries.voltage, 2_000_000, 11)
    .double(entries.brownoutVoltage, 2_000_000, 6.3)
    .boolean(entries.brownedOut, 2_000_000, false)
    .boolean(entries.enabled, 2_000_000, false)
    .boolean(entries.autonomous, 2_000_000, false)
    .boolean(entries.teleop, 2_000_000, false);
  return analyzeWpiLog(builder.build());
}

function resultBuffers(result: AnalysisResult): ArrayBuffer[] {
  const { dataset } = result;
  const series = [
    dataset.series.totalCurrentA,
    dataset.series.totalPowerW,
    dataset.series.totalEnergyWh,
    dataset.series.batteryVoltageV,
    dataset.series.brownoutVoltageV,
    dataset.series.brownedOut,
    dataset.series.enabled,
    dataset.series.autonomous,
    dataset.series.teleop,
    ...dataset.subsystems.flatMap((subsystem) => [
      subsystem.currentA,
      subsystem.powerW,
      subsystem.energyWh,
    ]),
  ].filter((seriesItem) => seriesItem !== undefined);

  return series.flatMap((seriesItem) => [
    seriesItem.timestampsUs.buffer as ArrayBuffer,
    seriesItem.values.buffer as ArrayBuffer,
  ]);
}

function clonePostingChannel(): {
  messages: PostedMessage[];
  post: (response: LogAnalysisWorkerResponse, transfer?: Transferable[]) => void;
} {
  const messages: PostedMessage[] = [];
  return {
    messages,
    post: (response, transfer = []) => {
      messages.push({
        response: structuredClone(response, { transfer }),
        transfer,
      });
    },
  };
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("log analysis worker handler", () => {
  it("posts progress and a result with every typed-array buffer transferred", async () => {
    const result = await buildResult();
    const expectedBuffers = new Set(resultBuffers(result));
    const { messages, post } = clonePostingChannel();
    const analyze: typeof analyzeWpiLog = async (_source, options = {}) => {
      options.onProgress?.(50, 100);
      return result;
    };
    const handleMessage = createLogAnalysisWorkerHandler({ analyze, post });

    handleMessage({
      type: "analyze",
      requestId: "result-request",
      file: new Blob(["fixture"]),
    });

    await vi.waitFor(() => expect(messages).toHaveLength(2));
    expect(messages[0]).toEqual({
      response: {
        type: "progress",
        requestId: "result-request",
        processedBytes: 50,
        totalBytes: 100,
      },
      transfer: [],
    });
    expect(messages[1].response).toMatchObject({
      type: "result",
      requestId: "result-request",
      result: { range: { totals: { energyWh: 3 } } },
    });
    expect(messages[1].transfer).toHaveLength(expectedBuffers.size);
    for (const buffer of expectedBuffers) {
      expect(messages[1].transfer).toContain(buffer);
    }
    expect(result.dataset.series.totalCurrentA.values.byteLength).toBe(0);
    if (messages[1].response.type === "result") {
      expect(messages[1].response.result.dataset.series.totalCurrentA.values.byteLength).toBe(16);
    }
  });

  it("serializes analysis errors and their structured issues", async () => {
    const issue = {
      severity: "fatal" as const,
      code: "INVALID_WPILOG" as const,
      message: "The fixture is not a WPILOG file",
    };
    const analyze: typeof analyzeWpiLog = async () => {
      throw new LogAnalysisError(issue);
    };
    const { messages, post } = clonePostingChannel();
    const handleMessage = createLogAnalysisWorkerHandler({ analyze, post });

    handleMessage({
      type: "analyze",
      requestId: "error-request",
      file: new Blob(["invalid"]),
    });

    await vi.waitFor(() => expect(messages).toHaveLength(1));
    expect(messages[0]).toEqual({
      response: {
        type: "error",
        requestId: "error-request",
        error: {
          name: "LogAnalysisError",
          message: issue.message,
          issues: [issue],
        },
      },
      transfer: [],
    });
  });

  it("aborts a cancelled request and suppresses all later messages", async () => {
    const pending = deferred<AnalysisResult>();
    let parseOptions: ParseOptions | undefined;
    const analyze: typeof analyzeWpiLog = (_source, options = {}) => {
      parseOptions = options;
      options.signal?.addEventListener("abort", () => options.onProgress?.(2, 10));
      return pending.promise;
    };
    const { messages, post } = clonePostingChannel();
    const handleMessage = createLogAnalysisWorkerHandler({ analyze, post });

    handleMessage({ type: "analyze", requestId: "cancelled", file: new Blob() });
    parseOptions?.onProgress?.(1, 10);
    expect(messages).toHaveLength(1);

    handleMessage({ type: "cancel", requestId: "cancelled" });
    expect(parseOptions?.signal?.aborted).toBe(true);
    parseOptions?.onProgress?.(2, 10);
    pending.reject(new Error("late failure after cancellation"));
    await pending.promise.catch(() => undefined);
    await flushAsyncWork();

    expect(messages.map(({ response }) => response)).toEqual([
      {
        type: "progress",
        requestId: "cancelled",
        processedBytes: 1,
        totalBytes: 10,
      },
    ]);
  });

  it("supersedes an in-flight request that reuses the same requestId", async () => {
    const result = await buildResult();
    const calls: Array<{ options: ParseOptions; pending: Deferred<AnalysisResult> }> = [];
    const analyze: typeof analyzeWpiLog = (_source, options = {}) => {
      const pending = deferred<AnalysisResult>();
      calls.push({ options, pending });
      options.signal?.addEventListener("abort", () => options.onProgress?.(9, 10));
      return pending.promise;
    };
    const { messages, post } = clonePostingChannel();
    const handleMessage = createLogAnalysisWorkerHandler({ analyze, post });
    const request = { type: "analyze" as const, requestId: "reused", file: new Blob() };

    handleMessage(request);
    handleMessage(request);

    expect(calls).toHaveLength(2);
    expect(calls[0].options.signal?.aborted).toBe(true);
    expect(calls[1].options.signal?.aborted).toBe(false);
    calls[0].options.onProgress?.(1, 10);
    calls[0].pending.resolve(result);
    await calls[0].pending.promise;
    await flushAsyncWork();
    expect(messages).toHaveLength(0);

    calls[1].options.onProgress?.(7, 10);
    calls[1].pending.resolve(result);
    await vi.waitFor(() => expect(messages).toHaveLength(2));

    expect(messages.map(({ response }) => response.type)).toEqual(["progress", "result"]);
    expect(messages[0].response).toMatchObject({
      type: "progress",
      requestId: "reused",
      processedBytes: 7,
      totalBytes: 10,
    });
    expect(messages[1].response).toMatchObject({ type: "result", requestId: "reused" });
  });
});
