import { analyzeEnergyRange, parseEnergyLog } from "../app/features/log-analysis/core";
import {
  formatNumber,
  openCliInput,
  printCliError,
  secondsOption,
} from "./cli-utils";

const args = process.argv.slice(2);
if (args[0] === "--") args.shift();

try {
  const input = await openCliInput(args[0]);
  const dataset = await parseEnergyLog(input.source);
  dataset.file.sizeBytes = input.sizeBytes;
  const startSeconds = secondsOption(args, "--start");
  const endSeconds = secondsOption(args, "--end");
  const range = analyzeEnergyRange(dataset, {
    startUs: startSeconds === undefined ? undefined : startSeconds * 1_000_000,
    endUs: endSeconds === undefined ? undefined : endSeconds * 1_000_000,
  });

  const summary = {
    file: input.absolutePath,
    sizeBytes: input.sizeBytes,
    header: dataset.header,
    recordCount: dataset.file.recordCount,
    lastGoodOffset: dataset.file.lastGoodOffset,
    truncatedTail: dataset.file.truncatedTail,
    root: dataset.root,
    bounds: dataset.bounds,
    range: range.range,
    totals: range.totals,
    reconciliation: range.quality.reconciliation,
    subsystems: range.subsystems
      .filter((subsystem) => subsystem.parentId === null)
      .sort((left, right) => right.energyWh - left.energyWh),
    issues: dataset.quality.issues,
  };

  if (args.includes("--json")) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(input.absolutePath);
    console.log(
      `WPILOG ${dataset.header.majorVersion}.${dataset.header.minorVersion} | root ${dataset.root}`,
    );
    console.log(
      `${formatNumber(input.sizeBytes / 1024 / 1024)} MiB | ${formatNumber(dataset.file.recordCount, 0)} complete records`,
    );
    console.log(
      `Range ${formatNumber(range.range.startUs / 1_000_000, 6)}s - ${formatNumber(range.range.endUs / 1_000_000, 6)}s (${formatNumber(range.range.durationSeconds, 6)}s)`,
    );
    console.log(
      `Energy ${formatNumber(range.totals.energyWh, 6)} Wh | average ${formatNumber(range.totals.averagePowerW, 6)} W`,
    );
    console.log(
      `Peak ${formatNumber(range.totals.peakPowerW, 6)} W | ${formatNumber(range.totals.peakCurrentA, 6)} A`,
    );
    if (range.totals.minVoltageV !== undefined) {
      console.log(`Minimum voltage ${formatNumber(range.totals.minVoltageV, 6)} V`);
    }
    console.log(
      `Brownouts ${range.totals.brownoutCount} (${formatNumber(range.totals.brownoutDurationSeconds, 6)}s) | enabled ${formatNumber(range.totals.enabledDurationSeconds, 6)}s`,
    );
    console.log(
      `Reconciliation difference ${formatNumber(range.quality.reconciliation.differenceWh, 9)} Wh`,
    );
    if (dataset.file.truncatedTail) {
      console.log(
        `Tail truncated at byte ${dataset.file.truncatedTail.offset}; missing ${dataset.file.truncatedTail.missingBytes ?? "unknown"} bytes`,
      );
    }
    console.log("Top-level subsystem energy:");
    for (const subsystem of summary.subsystems) {
      console.log(
        `  ${subsystem.rawPath.padEnd(24)} ${formatNumber(subsystem.energyWh, 6).padStart(12)} Wh  ${subsystem.share === null ? "n/a" : `${formatNumber(subsystem.share * 100, 3)}%`}`,
      );
    }
    const warnings = dataset.quality.issues.filter((issue) => issue.severity === "warning");
    console.log(`Warnings: ${warnings.length}`);
    for (const warning of warnings) console.log(`  ${warning.code}: ${warning.message}`);
  }
} catch (error) {
  printCliError(error);
}
