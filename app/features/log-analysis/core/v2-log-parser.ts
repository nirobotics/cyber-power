import { warningIssue } from "./errors";
import {
  EnergyLoggerV2ContractError,
  parseEnergyLoggerV2Contract,
  type EnergyLoggerV2Contract,
  type EnergyLoggerV2ContractVersion,
} from "./v2-contract";
import type { WpiLogDataRecord } from "./wpilog-decoder";
import type {
  EnergyLogV2Dataset,
  EnergyLogV2SubsystemDataset,
  LogIssue,
  LogIssueCode,
  NumericSeries,
  PackedNumericSeries,
  SampleTimestampSeries,
  StringSeries,
  WpiLogEntry,
} from "./types";

type ExpectedType = "string" | "int64" | "double" | "double[]";

const RPS_TO_RADIANS_PER_SECOND = Math.PI * 2;

class Float64Builder {
  private values = new Float64Array(0);
  private size = 0;

  push(value: number): void {
    if (this.size === this.values.length) {
      const next = new Float64Array(Math.max(64, this.values.length * 2));
      next.set(this.values);
      this.values = next;
    }
    this.values[this.size] = value;
    this.size += 1;
  }

  append(values: ArrayLike<number>): void {
    const required = this.size + values.length;
    if (required > this.values.length) {
      let capacity = Math.max(64, this.values.length);
      while (capacity < required) capacity *= 2;
      const next = new Float64Array(capacity);
      next.set(this.values.subarray(0, this.size));
      this.values = next;
    }
    this.values.set(values, this.size);
    this.size = required;
  }

  view(): Float64Array {
    return this.values.subarray(0, this.size);
  }
}

interface RawEntry {
  name: string;
  expectedType: ExpectedType;
  types: Set<string>;
  timestampsUs: Float64Builder;
  numericValues: Float64Builder;
  strings: string[];
  widths: number[];
}

interface RootCollection {
  entries: Map<string, RawEntry>;
}

interface ParsedName {
  root: string;
  relative: string;
  expectedType: ExpectedType;
}

export interface V2LogCollectionResult {
  v2?: EnergyLogV2Dataset;
  issues: LogIssue[];
}

function parseEntryName(name: string): ParsedName | undefined {
  const lowerName = name.toLowerCase();
  const marker = lowerName.startsWith("energylogger/") ? "energylogger/" : "/energylogger/";
  const markerIndex = lowerName.startsWith("energylogger/") ? 0 : lowerName.lastIndexOf(marker);
  if (markerIndex < 0) return undefined;
  const rootEnd = markerIndex + marker.length - 1;
  const root = name.slice(0, rootEnd);
  const relative = name.slice(rootEnd + 1);
  const relativeLower = relative.toLowerCase();
  const fixed = new Map<string, { canonical: string; type: ExpectedType }>([
    ["contractversion", { canonical: "contractVersion", type: "string" }],
    ["libraryversion", { canonical: "libraryVersion", type: "string" }],
    ["manifest", { canonical: "manifest", type: "string" }],
    ["robot/sampletimestampus", { canonical: "robot/sampleTimestampUs", type: "int64" }],
    ["robot/supplycurrentamps", { canonical: "robot/supplyCurrentAmps", type: "double" }],
    ["robot/totalsupplycurrentamps", { canonical: "robot/totalSupplyCurrentAmps", type: "double" }],
    ["robot/batteryvoltagevolts", { canonical: "robot/batteryVoltageVolts", type: "double" }],
  ]);
  const fixedEntry = fixed.get(relativeLower);
  if (fixedEntry) {
    return { root, relative: fixedEntry.canonical, expectedType: fixedEntry.type };
  }
  const timestampMatch = /^subsystems\/(s\d+)\/sampletimestampus$/.exec(relativeLower);
  if (timestampMatch) {
    return { root, relative: `subsystems/${timestampMatch[1]}/sampleTimestampUs`, expectedType: "int64" };
  }
  const stateMatch = /^subsystems\/(s\d+)\/state$/.exec(relativeLower);
  if (stateMatch) {
    return { root, relative: `subsystems/${stateMatch[1]}/state`, expectedType: "string" };
  }
  const samplesMatch = /^subsystems\/(s\d+)\/motors\/samples$/.exec(relativeLower);
  if (samplesMatch) {
    return { root, relative: `subsystems/${samplesMatch[1]}/motors/samples`, expectedType: "double[]" };
  }
  return undefined;
}

function issue(
  code: LogIssueCode,
  message: string,
  entryName?: string,
  details?: Record<string, unknown>,
): LogIssue {
  return warningIssue(code, message, { entryName, details });
}

function stableString(entry: RawEntry | undefined): { value?: string; changed: boolean } {
  if (!entry || entry.strings.length === 0) return { changed: false };
  const value = entry.strings[0];
  return { value, changed: entry.strings.some((candidate) => candidate !== value) };
}

function contractFor(root: RootCollection): EnergyLoggerV2Contract | undefined {
  const version = stableString(root.entries.get("contractVersion"));
  const library = stableString(root.entries.get("libraryVersion"));
  const manifest = stableString(root.entries.get("manifest"));
  if (!version.value || !library.value || !manifest.value) return undefined;
  if (version.changed || library.changed || manifest.changed) return undefined;
  try {
    return parseEnergyLoggerV2Contract({
      contractVersion: version.value,
      libraryVersion: library.value,
      manifest: manifest.value,
    });
  } catch {
    return undefined;
  }
}

function validType(entry: RawEntry | undefined): boolean {
  return Boolean(
    entry && entry.types.size === 1 && entry.types.has(entry.expectedType),
  );
}

function sampleTimestampSeries(entry: RawEntry): SampleTimestampSeries {
  return {
    timestampsUs: entry.timestampsUs.view(),
    values: entry.numericValues.view(),
    entryName: entry.name,
  };
}

function numericSeries(entry: RawEntry, unit: string): NumericSeries {
  return {
    timestampsUs: entry.timestampsUs.view(),
    values: entry.numericValues.view(),
    entryName: entry.name,
    unit,
  };
}

function stringSeries(entry: RawEntry): StringSeries {
  return {
    timestampsUs: entry.timestampsUs.view(),
    values: entry.strings,
    entryName: entry.name,
  };
}

function packedSeries(
  entry: RawEntry,
  width: number,
  contractVersion: EnergyLoggerV2ContractVersion,
): PackedNumericSeries {
  const values = entry.numericValues.view();
  if (contractVersion === "2.1") {
    // V2.1 transported raw rotor velocity in rotations per second. Normalize the owned typed
    // array in place so all downstream analysis uses rad/s without duplicating large logs.
    for (let offset = 2; offset < values.length; offset += 3) {
      values[offset] *= RPS_TO_RADIANS_PER_SECOND;
    }
  }
  return {
    timestampsUs: entry.timestampsUs.view(),
    values,
    entryName: entry.name,
    unit: "mixed",
    width,
  };
}

function validateTimestampSeries(entry: RawEntry, issues: LogIssue[]): void {
  const values = entry.numericValues.view();
  let previous = -Infinity;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!Number.isSafeInteger(value) || value < 0) {
      issues.push(
        issue(
          "V2_SAMPLE_TIMESTAMP_INVALID",
          `${entry.name} contains an invalid producer timestamp`,
          entry.name,
          { index, value },
        ),
      );
      return;
    }
    if (value < previous) {
      issues.push(
        issue(
          "V2_SAMPLE_TIMESTAMP_ROLLBACK",
          `${entry.name} producer timestamp moved backwards`,
          entry.name,
          { index, previous, value },
        ),
      );
      return;
    }
    previous = value;
  }
}

export class EnergyLoggerV2Collector {
  private readonly roots = new Map<string, RootCollection>();
  private readonly bindings = new WeakMap<WpiLogEntry, RawEntry>();

  onStart(entry: WpiLogEntry): void {
    const parsed = parseEntryName(entry.name);
    if (!parsed) return;
    const root = this.roots.get(parsed.root) ?? { entries: new Map<string, RawEntry>() };
    this.roots.set(parsed.root, root);
    let raw = root.entries.get(parsed.relative);
    if (!raw) {
      raw = {
        name: entry.name,
        expectedType: parsed.expectedType,
        types: new Set<string>(),
        timestampsUs: new Float64Builder(),
        numericValues: new Float64Builder(),
        strings: [],
        widths: [],
      };
      root.entries.set(parsed.relative, raw);
    }
    raw.types.add(entry.type);
    this.bindings.set(entry, raw);
  }

  onData(record: WpiLogDataRecord): void {
    const entry = this.bindings.get(record.entry);
    if (!entry || !record.value) return;
    entry.timestampsUs.push(record.timestampUs);
    switch (record.value.type) {
      case "string":
        entry.strings.push(record.value.data);
        break;
      case "int64": {
        const value = record.value.data;
        entry.numericValues.push(
          value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : Number.NaN,
        );
        break;
      }
      case "double":
        entry.numericValues.push(record.value.data);
        break;
      case "double[]":
        entry.widths.push(record.value.data.length);
        entry.numericValues.append(record.value.data);
        break;
      default:
        break;
    }
  }

  candidateRoots(): ReadonlySet<string> {
    return new Set(this.roots.keys());
  }

  validContractRoots(): ReadonlySet<string> {
    return new Set(
      [...this.roots].flatMap(([name, root]) => (contractFor(root) ? [name] : [])),
    );
  }

  finalize(rootName: string): V2LogCollectionResult {
    const root = this.roots.get(rootName);
    if (!root) return { issues: [] };
    const issues: LogIssue[] = [];
    const version = stableString(root.entries.get("contractVersion"));
    const library = stableString(root.entries.get("libraryVersion"));
    const manifest = stableString(root.entries.get("manifest"));
    for (const [key, value] of [
      ["contractVersion", version],
      ["libraryVersion", library],
      ["manifest", manifest],
    ] as const) {
      const raw = root.entries.get(key);
      if (!raw || !value.value) {
        issues.push(issue("V2_CONTRACT_INCOMPLETE", `Missing EnergyLogger V2 ${key}`, raw?.name));
      } else if (!validType(raw)) {
        issues.push(
          issue("V2_ENTRY_TYPE_MISMATCH", `${raw.name} must be string`, raw.name, {
            declaredTypes: [...raw.types],
          }),
        );
      } else if (value.changed) {
        issues.push(issue("V2_CONTRACT_CHANGED", `${raw.name} changed within the log`, raw.name));
      }
    }

    let contract: EnergyLoggerV2Contract | undefined;
    if (issues.length === 0) {
      try {
        contract = parseEnergyLoggerV2Contract({
          contractVersion: version.value,
          libraryVersion: library.value,
          manifest: manifest.value,
        });
      } catch (error) {
        if (error instanceof EnergyLoggerV2ContractError) {
          issues.push(
            ...error.issues.map((contractIssue) =>
              issue(
                contractIssue.code,
                contractIssue.message,
                root.entries.get("manifest")?.name,
                { path: contractIssue.path, ...contractIssue.details },
              ),
            ),
          );
        } else throw error;
      }
    }
    if (!contract) return { issues };

    const required = (
      relative: string,
      expectedType: ExpectedType,
    ): RawEntry | undefined => {
      const entry = root.entries.get(relative);
      if (!entry) {
        issues.push(
          issue(
            "V2_ENTRY_MISSING",
            `Missing EnergyLogger ${contract.contractVersion} entry ${relative}`,
          ),
        );
        return undefined;
      }
      if (entry.expectedType !== expectedType || !validType(entry)) {
        issues.push(
          issue("V2_ENTRY_TYPE_MISMATCH", `${entry.name} must be ${expectedType}`, entry.name, {
            declaredTypes: [...entry.types],
          }),
        );
        return undefined;
      }
      const dataCount = expectedType === "string"
        ? entry.strings.length
        : expectedType === "double[]"
          ? entry.widths.length
          : entry.numericValues.view().length;
      if (dataCount === 0) {
        issues.push(issue("V2_ENTRY_MISSING", `${entry.name} contains no data records`, entry.name));
        return undefined;
      }
      return entry;
    };

    const robotTimestamp = required("robot/sampleTimestampUs", "int64");
    const robotCurrent = required("robot/supplyCurrentAmps", "double");
    const robotVoltage = required("robot/batteryVoltageVolts", "double");
    let robotTotalCurrent: RawEntry | undefined;
    if (contract.contractVersion === "2.4") {
      const entry = root.entries.get("robot/totalSupplyCurrentAmps");
      if (entry) {
        if (!validType(entry)) {
          issues.push(
            issue("V2_ENTRY_TYPE_MISMATCH", `${entry.name} must be double`, entry.name, {
              declaredTypes: [...entry.types],
            }),
          );
        } else if (entry.numericValues.view().length === 0) {
          issues.push(issue("V2_ENTRY_MISSING", `${entry.name} contains no data records`, entry.name));
        } else {
          robotTotalCurrent = entry;
        }
      }
    }
    const subsystemRows: Array<{
      id: string;
      timestamp?: RawEntry;
      state?: RawEntry;
      samples?: RawEntry;
      width: number;
    }> = [];
    contract.manifest.subsystems.forEach((subsystem, index) => {
      const id = `s${index}`;
      const timestamp = required(`subsystems/${id}/sampleTimestampUs`, "int64");
      const state = required(`subsystems/${id}/state`, "string");
      const samples = required(`subsystems/${id}/motors/samples`, "double[]");
      const width = subsystem.motors.length * 3;
      if (samples && samples.widths.some((actual) => actual !== width)) {
        issues.push(
          issue(
            "V2_PACKED_WIDTH_MISMATCH",
            `${samples.name} must contain ${width} values per row`,
            samples.name,
            { expectedWidth: width, actualWidths: [...new Set(samples.widths)] },
          ),
        );
      }
      if (samples && samples.widths.every((actual) => actual === width)) {
        const values = samples.numericValues.view();
        for (let rowIndex = 0; rowIndex < samples.widths.length; rowIndex += 1) {
          for (let motorIndex = 0; motorIndex < subsystem.motors.length; motorIndex += 1) {
            const motor = subsystem.motors[motorIndex];
            if (motor.leader === null && motor.type !== null) continue;
            const offset = rowIndex * width + motorIndex * 3;
            if (!Number.isNaN(values[offset + 1]) || !Number.isNaN(values[offset + 2])) {
              const supplyOnly = motor.type === null;
              issues.push(
                issue(
                  supplyOnly ? "V2_SUPPLY_ONLY_SLOT_INVALID" : "V2_FOLLOWER_SLOT_INVALID",
                  `${samples.name} ${supplyOnly ? "supply-only motor" : "follower"} ${motor.name} must use NaN Stator Current and rotor velocity slots`,
                  samples.name,
                  { rowIndex, motor: motor.name },
                ),
              );
              rowIndex = samples.widths.length;
              break;
            }
          }
        }
      }
      subsystemRows.push({ id, timestamp, state, samples, width });
    });

    if (robotTimestamp) validateTimestampSeries(robotTimestamp, issues);
    for (const row of subsystemRows) if (row.timestamp) validateTimestampSeries(row.timestamp, issues);
    if (issues.length > 0 || !robotTimestamp || !robotCurrent || !robotVoltage) {
      return { issues };
    }

    const subsystems: EnergyLogV2SubsystemDataset[] = [];
    for (let index = 0; index < subsystemRows.length; index += 1) {
      const row = subsystemRows[index];
      if (!row.timestamp || !row.state || !row.samples) return { issues };
      const descriptor = contract.manifest.subsystems[index];
      subsystems.push({
        id: row.id,
        name: descriptor.name,
        motors: descriptor.motors,
        sampleTimestampUs: sampleTimestampSeries(row.timestamp),
        state: stringSeries(row.state),
        motorSamples: packedSeries(row.samples, row.width, contract.contractVersion),
      });
    }

    return {
      issues,
      v2: {
        contract,
        robotSampleTimestampUs: sampleTimestampSeries(robotTimestamp),
        robotSupplyCurrentAmps: numericSeries(robotCurrent, "A"),
        ...(robotTotalCurrent
          ? { robotTotalSupplyCurrentAmps: numericSeries(robotTotalCurrent, "A") }
          : {}),
        robotCurrentSource: robotTotalCurrent ? "robot-total" : "registered-motors",
        robotBatteryVoltageVolts: numericSeries(robotVoltage, "V"),
        subsystems,
      },
    };
  }
}
