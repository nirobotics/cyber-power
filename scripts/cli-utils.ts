import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";

import { LogAnalysisError, type WpiLogSource } from "../app/features/log-analysis/core";

export interface CliInput {
  absolutePath: string;
  sizeBytes: number;
  source: WpiLogSource;
}

export async function openCliInput(fileArgument: string | undefined): Promise<CliInput> {
  if (!fileArgument || fileArgument.startsWith("--")) {
    throw new Error("A .wpilog file path is required");
  }
  const absolutePath = path.resolve(fileArgument);
  const file = await stat(absolutePath);
  if (!file.isFile()) throw new Error(`${absolutePath} is not a file`);
  return {
    absolutePath,
    sizeBytes: file.size,
    source: createReadStream(absolutePath) as AsyncIterable<Uint8Array>,
  };
}

export function optionValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

export function secondsOption(args: string[], name: string): number | undefined {
  const raw = optionValue(args, name);
  if (raw === undefined) return undefined;
  const seconds = Number(raw);
  if (!Number.isFinite(seconds)) throw new Error(`${name} must be a finite number of seconds`);
  return seconds;
}

export function printCliError(error: unknown): void {
  if (error instanceof LogAnalysisError) {
    console.error(error.message);
    for (const issue of error.issues) {
      console.error(
        `${issue.severity.toUpperCase()} ${issue.code}${issue.entryName ? ` [${issue.entryName}]` : ""}: ${issue.message}`,
      );
    }
  } else {
    console.error(error instanceof Error ? error.message : String(error));
  }
  process.exitCode = 1;
}

export function formatNumber(value: number, digits = 3): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: digits });
}
