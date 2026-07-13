import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";

import {
  analyzeEnergyRange,
  estimateSupplyCurrentLimits,
  parseEnergyLog,
  type EnergyLogDataset,
  type RangeAnalysis,
  type SupplyCurrentLimitInput,
  type SupplyLimitEstimate,
  type WpiLogSource,
} from "../app/features/log-analysis/core";
import { printCliError } from "./cli-utils";

interface BenchmarkOptions {
  files: string[];
  warmup: number;
  runs: number;
  json: boolean;
  startSeconds?: number;
  endSeconds?: number;
  limits: SupplyCurrentLimitInput[];
  aggregateNodeIds: Set<string>;
}

interface MemorySnapshot {
  rssBytes: number;
  heapTotalBytes: number;
  heapUsedBytes: number;
  externalBytes: number;
  arrayBuffersBytes: number;
}

interface TimingSummary {
  samples: number;
  minMs: number;
  medianMs: number;
  meanMs: number;
  p95Ms: number;
  maxMs: number;
  standardDeviationMs: number;
}

interface RunMeasurement {
  parseMs: number;
  rangeMs: number;
  simulationMs?: number;
  memoryBefore: MemorySnapshot;
  memoryAfterParse: MemorySnapshot;
  memoryAfterRange: MemorySnapshot;
  memoryAfterSimulation?: MemorySnapshot;
}

function printHelp(): void {
  console.log(`Usage: pnpm exec tsx scripts/log-benchmark.ts [options] <file...>

Options:
  --warmup <count>              Warm-up runs per file (default: 1)
  --runs <count>               Measured runs per file (default: 5)
  --start <seconds>            Analysis range start
  --end <seconds>              Analysis range end
  --limit <nodeId=amps>        Add an enabled Supply Current limit (repeatable)
  --confirm-aggregate <nodeId> Confirm an aggregate target (repeatable)
  --json                       Print machine-readable JSON
  --help                       Show this help

Use the EnergyLogger node id shown by the analysis output. A limit plan is
validated independently for every input log.`);
}

function optionValue(argv: string[], index: number, name: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

function nonnegativeInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return parsed;
}

function finiteSeconds(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be a finite number`);
  return parsed;
}

function parseLimit(value: string): SupplyCurrentLimitInput {
  const separator = value.lastIndexOf("=");
  if (separator <= 0 || separator === value.length - 1) {
    throw new Error(`Invalid --limit value: ${value}; expected nodeId=amps`);
  }
  const nodeId = value.slice(0, separator);
  const limitA = Number(value.slice(separator + 1));
  if (!Number.isFinite(limitA) || limitA < 0) {
    throw new Error(`Invalid Supply Current limit: ${value}`);
  }
  return { nodeId, limitA, enabled: true };
}

function parseArguments(argv: string[]): BenchmarkOptions | undefined {
  const options: BenchmarkOptions = {
    files: [],
    warmup: 1,
    runs: 5,
    json: false,
    limits: [],
    aggregateNodeIds: new Set<string>(),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") continue;
    if (argument === "--help") {
      printHelp();
      return undefined;
    }
    if (argument === "--json") {
      options.json = true;
      continue;
    }
    if (
      argument === "--warmup" ||
      argument === "--runs" ||
      argument === "--start" ||
      argument === "--end" ||
      argument === "--limit" ||
      argument === "--confirm-aggregate"
    ) {
      const value = optionValue(argv, index, argument);
      index += 1;
      if (argument === "--warmup") options.warmup = nonnegativeInteger(value, argument);
      if (argument === "--runs") options.runs = nonnegativeInteger(value, argument);
      if (argument === "--start") options.startSeconds = finiteSeconds(value, argument);
      if (argument === "--end") options.endSeconds = finiteSeconds(value, argument);
      if (argument === "--limit") options.limits.push(parseLimit(value));
      if (argument === "--confirm-aggregate") options.aggregateNodeIds.add(value);
      continue;
    }
    if (argument.startsWith("--")) throw new Error(`Unknown option: ${argument}`);
    options.files.push(argument);
  }
  if (options.files.length === 0) throw new Error("At least one .wpilog file path is required");
  if (options.runs < 1) throw new Error("--runs must be at least 1");
  if (
    options.startSeconds !== undefined &&
    options.endSeconds !== undefined &&
    options.startSeconds > options.endSeconds
  ) {
    throw new Error("--start cannot be greater than --end");
  }
  const duplicateLimits = options.limits.filter(
    (limit, index) => options.limits.findIndex((candidate) => candidate.nodeId === limit.nodeId) !== index,
  );
  if (duplicateLimits.length > 0) {
    throw new Error(`Duplicate --limit target: ${duplicateLimits[0].nodeId}`);
  }
  options.limits = options.limits.map((limit) => ({
    ...limit,
    ...(options.aggregateNodeIds.has(limit.nodeId) ? { aggregateConfirmed: true } : {}),
  }));
  for (const nodeId of options.aggregateNodeIds) {
    if (!options.limits.some((limit) => limit.nodeId === nodeId)) {
      throw new Error(`--confirm-aggregate has no matching --limit: ${nodeId}`);
    }
  }
  return options;
}

function memorySnapshot(): MemorySnapshot {
  const value = process.memoryUsage();
  return {
    rssBytes: value.rss,
    heapTotalBytes: value.heapTotal,
    heapUsedBytes: value.heapUsed,
    externalBytes: value.external,
    arrayBuffersBytes: value.arrayBuffers,
  };
}

function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function percentile(sorted: readonly number[], fraction: number): number {
  const rank = Math.max(1, Math.ceil(sorted.length * fraction));
  return sorted[Math.min(rank - 1, sorted.length - 1)];
}

function summarizeTimings(values: readonly number[]): TimingSummary {
  const sorted = [...values].sort((left, right) => left - right);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
  return {
    samples: values.length,
    minMs: round(sorted[0]),
    medianMs: round(median),
    meanMs: round(mean),
    p95Ms: round(percentile(sorted, 0.95)),
    maxMs: round(sorted[sorted.length - 1]),
    standardDeviationMs: round(Math.sqrt(variance)),
  };
}

function maxMemory(snapshots: readonly MemorySnapshot[]): MemorySnapshot {
  const fields: (keyof MemorySnapshot)[] = [
    "rssBytes",
    "heapTotalBytes",
    "heapUsedBytes",
    "externalBytes",
    "arrayBuffersBytes",
  ];
  return Object.fromEntries(
    fields.map((field) => [field, Math.max(...snapshots.map((snapshot) => snapshot[field]))]),
  ) as unknown as MemorySnapshot;
}

function maxMemoryIncrease(runs: readonly RunMeasurement[]): MemorySnapshot {
  const fields: (keyof MemorySnapshot)[] = [
    "rssBytes",
    "heapTotalBytes",
    "heapUsedBytes",
    "externalBytes",
    "arrayBuffersBytes",
  ];
  return Object.fromEntries(fields.map((field) => {
    const increases = runs.map((run) => {
      const stages = [run.memoryAfterParse, run.memoryAfterRange, run.memoryAfterSimulation]
        .filter((snapshot) => snapshot !== undefined);
      return Math.max(...stages.map((snapshot) => snapshot[field] - run.memoryBefore[field]), 0);
    });
    return [field, Math.max(...increases)];
  })) as unknown as MemorySnapshot;
}

function runGarbageCollection(): void {
  global.gc?.();
}

function inputSource(absolutePath: string): WpiLogSource {
  return createReadStream(absolutePath) as AsyncIterable<Uint8Array>;
}

function resultFingerprint(
  dataset: EnergyLogDataset,
  range: RangeAnalysis,
  simulation: SupplyLimitEstimate | undefined,
): string {
  return JSON.stringify({
    root: dataset.root,
    records: dataset.file.recordCount,
    subsystems: dataset.subsystems.length,
    range: range.range,
    totals: range.totals,
    simulation: simulation
      ? {
          targets: simulation.targets.map((target) => ({
            nodeId: target.nodeId,
            limitA: target.limitA,
            estimated: target.estimated,
          })),
          totals: simulation.totals,
        }
      : undefined,
  });
}

async function measureRun(
  absolutePath: string,
  sizeBytes: number,
  options: BenchmarkOptions,
): Promise<{
  measurement: RunMeasurement;
  dataset: EnergyLogDataset;
  range: RangeAnalysis;
  simulation?: SupplyLimitEstimate;
}> {
  runGarbageCollection();
  const memoryBefore = memorySnapshot();
  const parseStart = performance.now();
  const dataset = await parseEnergyLog(inputSource(absolutePath));
  const parseMs = performance.now() - parseStart;
  dataset.file.sizeBytes = sizeBytes;
  const memoryAfterParse = memorySnapshot();

  const rangeStart = performance.now();
  const range = analyzeEnergyRange(dataset, {
    startUs: options.startSeconds === undefined ? undefined : options.startSeconds * 1_000_000,
    endUs: options.endSeconds === undefined ? undefined : options.endSeconds * 1_000_000,
  });
  const rangeMs = performance.now() - rangeStart;
  const memoryAfterRange = memorySnapshot();

  let simulation: SupplyLimitEstimate | undefined;
  let simulationMs: number | undefined;
  let memoryAfterSimulation: MemorySnapshot | undefined;
  if (options.limits.length > 0) {
    const simulationStart = performance.now();
    simulation = estimateSupplyCurrentLimits(dataset, {
      limits: options.limits,
      range: { startUs: range.range.startUs, endUs: range.range.endUs },
    });
    simulationMs = performance.now() - simulationStart;
    memoryAfterSimulation = memorySnapshot();
  }
  return {
    measurement: {
      parseMs,
      rangeMs,
      ...(simulationMs === undefined ? {} : { simulationMs }),
      memoryBefore,
      memoryAfterParse,
      memoryAfterRange,
      ...(memoryAfterSimulation === undefined ? {} : { memoryAfterSimulation }),
    },
    dataset,
    range,
    ...(simulation === undefined ? {} : { simulation }),
  };
}

async function benchmarkFile(file: string, options: BenchmarkOptions) {
  const absolutePath = path.resolve(file);
  if (path.extname(absolutePath).toLowerCase() !== ".wpilog") {
    throw new Error(`Not a .wpilog file: ${absolutePath}`);
  }
  const fileInfo = await stat(absolutePath);
  if (!fileInfo.isFile()) throw new Error(`Not a file: ${absolutePath}`);

  for (let index = 0; index < options.warmup; index += 1) {
    await measureRun(absolutePath, fileInfo.size, options);
  }

  const runs: RunMeasurement[] = [];
  let expectedFingerprint: string | undefined;
  let lastResult: Awaited<ReturnType<typeof measureRun>> | undefined;
  for (let index = 0; index < options.runs; index += 1) {
    const result = await measureRun(absolutePath, fileInfo.size, options);
    const fingerprint = resultFingerprint(result.dataset, result.range, result.simulation);
    if (expectedFingerprint !== undefined && fingerprint !== expectedFingerprint) {
      throw new Error(`Benchmark result changed between runs: ${absolutePath}`);
    }
    expectedFingerprint = fingerprint;
    runs.push(result.measurement);
    lastResult = result;
  }
  if (!lastResult) throw new Error("No benchmark run completed");

  const memorySnapshots = runs.flatMap((run) => [
    run.memoryBefore,
    run.memoryAfterParse,
    run.memoryAfterRange,
    ...(run.memoryAfterSimulation ? [run.memoryAfterSimulation] : []),
  ]);
  return {
    file: absolutePath,
    sizeBytes: fileInfo.size,
    dataset: {
      root: lastResult.dataset.root,
      recordCount: lastResult.dataset.file.recordCount,
      subsystemCount: lastResult.dataset.subsystems.length,
      bounds: lastResult.dataset.bounds,
      issueCodes: lastResult.dataset.quality.issues.map((issue) => issue.code),
    },
    range: {
      range: lastResult.range.range,
      totals: lastResult.range.totals,
    },
    simulation: lastResult.simulation
      ? {
          limits: options.limits,
          activeTargetCount: lastResult.simulation.totals.activeTargetCount,
          totals: lastResult.simulation.totals,
          warningCodes: lastResult.simulation.warnings.map((warning) => warning.code),
        }
      : null,
    timings: {
      parse: summarizeTimings(runs.map((run) => run.parseMs)),
      range: summarizeTimings(runs.map((run) => run.rangeMs)),
      simulation: options.limits.length > 0
        ? summarizeTimings(runs.map((run) => run.simulationMs!))
        : null,
    },
    memory: {
      peak: maxMemory(memorySnapshots),
      maxIncreaseFromRunStart: maxMemoryIncrease(runs),
    },
  };
}

function formatMilliseconds(summary: TimingSummary): string {
  return `${summary.meanMs.toFixed(3)} ms mean · ${summary.p95Ms.toFixed(3)} ms p95`;
}

function formatMebibytes(bytes: number): string {
  return `${(bytes / 1_024 / 1_024).toFixed(2)} MiB`;
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  if (!options) return;
  const files = [];
  for (const file of options.files) files.push(await benchmarkFile(file, options));
  const report = {
    schemaVersion: 1,
    runtime: {
      nodeVersion: process.versions.node,
      platform: process.platform,
      architecture: process.arch,
      gcAvailable: typeof global.gc === "function",
    },
    configuration: {
      warmup: options.warmup,
      runs: options.runs,
      range: {
        startSeconds: options.startSeconds ?? null,
        endSeconds: options.endSeconds ?? null,
      },
      limits: options.limits,
    },
    files,
  };
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(
    `Node ${report.runtime.nodeVersion} · warmup ${options.warmup} · measured runs ${options.runs}`,
  );
  for (const file of files) {
    console.log(`\n${file.file}`);
    console.log(`  ${(file.sizeBytes / 1_024 / 1_024).toFixed(2)} MiB · ${file.dataset.recordCount} records`);
    console.log(`  parse       ${formatMilliseconds(file.timings.parse)}`);
    console.log(`  range       ${formatMilliseconds(file.timings.range)}`);
    if (file.timings.simulation) {
      console.log(`  simulation  ${formatMilliseconds(file.timings.simulation)}`);
    }
    console.log(`  peak RSS    ${formatMebibytes(file.memory.peak.rssBytes)}`);
    console.log(
      `  RSS growth  ${formatMebibytes(file.memory.maxIncreaseFromRunStart.rssBytes)} max/run`,
    );
  }
}

main().catch(printCliError);
