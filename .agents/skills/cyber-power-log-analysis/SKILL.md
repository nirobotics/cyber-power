---
name: cyber-power-log-analysis
description: Inspect, validate, and troubleshoot WPILOG files produced by robots using NI EnergyLogger, and maintain Cyber Power's parser, CLI, Worker, metrics, and golden tests. Use for .wpilog compatibility questions, EnergyLogger key discovery, power or energy calculations, Brownout and Driver Station interval analysis, parser errors, range analysis, and changes under app/features/log-analysis or scripts/log-*.ts.
---

# Cyber Power Log Analysis

Analyze the EnergyLogger contract rather than a team number, project name, robot season, or fixed subsystem list. Keep raw logs local unless the user explicitly authorizes another destination.

## Workflow

1. Read `.memory/PROMISE.md`, `.memory/LESSON.md`, `.memory/CORNERSTONE.md`, and `.memory/SCRUM.md` before repository changes.
2. Confirm the input exists and is not being added to Git. Never commit a real robot log.
3. List the container and entries before diagnosing compatibility:

   ```powershell
   pnpm log:list -- "C:\path\robot.wpilog"
   ```

4. Analyze the full file or an inclusive time selection:

   ```powershell
   pnpm log:analyze -- "C:\path\robot.wpilog"
   pnpm log:analyze -- "C:\path\robot.wpilog" --start 120 --end 135 --json
   ```

5. Interpret fatal errors separately from recoverable warnings. Read [references/energylogger-contract.md](references/energylogger-contract.md) before changing discovery, normalization, sample-and-hold, cumulative-delta, or reconciliation behavior.
6. For the private reference log, compare against [references/golden-log.md](references/golden-log.md). Do not weaken tolerances to make a mismatch pass.
7. After code changes run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, and one real-log CLI analysis when the file is available.

## Invariants

- Discover EnergyLogger roots by their data contract and `/energyLogger` suffix, not `8214`, `9635`, `RealOutputs`, or a known subsystem name.
- Require WPILOG 1.0, the three total `double` series, and at least one dynamic path with complete current, power, and energy series.
- Treat AdvantageKit numeric series as sample-and-hold state. Use cumulative energy deltas for energy and time-weighted definitions for derived metrics.
- Recover only a truncated final record. Reject structural corruption before the trusted tail.
- Report missing optional voltage, Brownout, Enabled, Autonomous, Test, or MatchType series as limitations rather than fabricating values.
- Preserve typed arrays and streaming or chunked reads. Do not duplicate the entire input in browser memory.
- Keep parser and metric code independent of React. The UI and Web Worker consume the same core API.

## Core APIs

- `parseEnergyLog(source, options)` returns the validated dataset.
- `analyzeEnergyRange(dataset, { startUs, endUs })` computes selection metrics.
- `analyzeWpiLog(source, options)` performs both steps.
- `listWpiLog(source, options)` lists the container without requiring EnergyLogger.

Use `app/features/log-analysis/workers/log-analysis.worker.ts` for browser execution. Transfer typed-array buffers back to the main thread; do not parse a competition log on the UI thread.
