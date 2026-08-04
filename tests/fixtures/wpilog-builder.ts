const encoder = new TextEncoder();

function concat(parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function unsignedLe(value: number | bigint, length: number): Uint8Array {
  let remaining = BigInt(value);
  const bytes = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) {
    bytes[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return bytes;
}

function minimalBytes(value: number | bigint, maximum: number): number {
  let remaining = BigInt(value);
  let length = 1;
  while (remaining > 0xffn && length < maximum) {
    remaining >>= 8n;
    length += 1;
  }
  return length;
}

function lengthPrefixed(text: string): Uint8Array {
  const bytes = encoder.encode(text);
  return concat([unsignedLe(bytes.byteLength, 4), bytes]);
}

function encodeRecord(
  entryId: number,
  timestampUs: number,
  payload: Uint8Array,
): Uint8Array {
  const entryLength = minimalBytes(entryId, 4);
  const payloadLength = minimalBytes(payload.byteLength, 4);
  const timestampLength = minimalBytes(timestampUs, 8);
  const bitfield =
    (entryLength - 1) | ((payloadLength - 1) << 2) | ((timestampLength - 1) << 4);
  return concat([
    Uint8Array.of(bitfield),
    unsignedLe(entryId, entryLength),
    unsignedLe(payload.byteLength, payloadLength),
    unsignedLe(timestampUs, timestampLength),
    payload,
  ]);
}

export class WpiLogFixtureBuilder {
  private readonly records: Uint8Array[] = [];
  private nextEntryId = 1;

  constructor(private readonly extraHeader = "AdvantageKit") {}

  start(name: string, type: string, metadata = "", timestampUs = 0): number {
    const entryId = this.nextEntryId++;
    const payload = concat([
      Uint8Array.of(0),
      unsignedLe(entryId, 4),
      lengthPrefixed(name),
      lengthPrefixed(type),
      lengthPrefixed(metadata),
    ]);
    this.records.push(encodeRecord(0, timestampUs, payload));
    return entryId;
  }

  finish(entryId: number, timestampUs: number): this {
    this.records.push(
      encodeRecord(0, timestampUs, concat([Uint8Array.of(1), unsignedLe(entryId, 4)])),
    );
    return this;
  }

  setMetadata(entryId: number, metadata: string, timestampUs: number): this {
    this.records.push(
      encodeRecord(
        0,
        timestampUs,
        concat([Uint8Array.of(2), unsignedLe(entryId, 4), lengthPrefixed(metadata)]),
      ),
    );
    return this;
  }

  double(entryId: number, timestampUs: number, value: number): this {
    const payload = new Uint8Array(8);
    new DataView(payload.buffer).setFloat64(0, value, true);
    this.records.push(encodeRecord(entryId, timestampUs, payload));
    return this;
  }

  doubleArray(entryId: number, timestampUs: number, values: readonly number[]): this {
    const payload = new Uint8Array(values.length * 8);
    const view = new DataView(payload.buffer);
    values.forEach((value, index) => view.setFloat64(index * 8, value, true));
    this.records.push(encodeRecord(entryId, timestampUs, payload));
    return this;
  }

  int64(entryId: number, timestampUs: number, value: number | bigint): this {
    const payload = new Uint8Array(8);
    new DataView(payload.buffer).setBigInt64(0, BigInt(value), true);
    this.records.push(encodeRecord(entryId, timestampUs, payload));
    return this;
  }

  int64Array(
    entryId: number,
    timestampUs: number,
    values: readonly (number | bigint)[],
  ): this {
    const payload = new Uint8Array(values.length * 8);
    const view = new DataView(payload.buffer);
    values.forEach((value, index) => view.setBigInt64(index * 8, BigInt(value), true));
    this.records.push(encodeRecord(entryId, timestampUs, payload));
    return this;
  }

  boolean(entryId: number, timestampUs: number, value: boolean): this {
    this.records.push(encodeRecord(entryId, timestampUs, Uint8Array.of(value ? 1 : 0)));
    return this;
  }

  booleanArray(entryId: number, timestampUs: number, values: readonly boolean[]): this {
    this.records.push(
      encodeRecord(entryId, timestampUs, Uint8Array.from(values, (value) => value ? 1 : 0)),
    );
    return this;
  }

  string(entryId: number, timestampUs: number, value: string): this {
    this.records.push(encodeRecord(entryId, timestampUs, encoder.encode(value)));
    return this;
  }

  stringArray(entryId: number, timestampUs: number, values: readonly string[]): this {
    const payload = concat([
      unsignedLe(values.length, 4),
      ...values.map((value) => lengthPrefixed(value)),
    ]);
    this.records.push(encodeRecord(entryId, timestampUs, payload));
    return this;
  }

  raw(entryId: number, timestampUs: number, payload: Uint8Array): this {
    this.records.push(encodeRecord(entryId, timestampUs, payload));
    return this;
  }

  appendBytes(bytes: Uint8Array): this {
    this.records.push(bytes);
    return this;
  }

  build(): Uint8Array {
    const extra = encoder.encode(this.extraHeader);
    return concat([
      encoder.encode("WPILOG"),
      unsignedLe(0x0100, 2),
      unsignedLe(extra.byteLength, 4),
      extra,
      ...this.records,
    ]);
  }
}

export interface EnergyFixtureOptions {
  root?: string;
  rawPath?: string;
  includeOptionals?: boolean;
}

export function buildEnergyFixture(options: EnergyFixtureOptions = {}): {
  builder: WpiLogFixtureBuilder;
  entries: Record<string, number>;
} {
  const root = options.root ?? "/UnknownTeam/RealOutputs/energyLogger";
  const rawPath = options.rawPath ?? "climber-left/winchA";
  const builder = new WpiLogFixtureBuilder();
  const units = (value: string) => JSON.stringify({ source: "test", units: value });
  const entries: Record<string, number> = {
    totalCurrent: builder.start(`${root}/totalCurrent`, "double", units("amps")),
    totalPower: builder.start(`${root}/totalPower`, "double", units("watts")),
    totalEnergy: builder.start(`${root}/totalEnergy`, "double", units("watt hours")),
    current: builder.start(`${root}/current/${rawPath}`, "double", units("amps")),
    power: builder.start(`${root}/power/${rawPath}`, "double", units("watts")),
    energy: builder.start(`${root}/energy/${rawPath}`, "double", units("watt hours")),
  };
  if (options.includeOptionals) {
    const namespace = root.slice(0, -"/energyLogger".length);
    entries.voltage = builder.start(
      `${namespace}/SystemStats/BatteryVoltage`,
      "double",
      units("volts"),
    );
    entries.brownedOut = builder.start(`${namespace}/SystemStats/BrownedOut`, "boolean");
    entries.brownoutVoltage = builder.start(
      `${namespace}/SystemStats/BrownoutVoltage`,
      "double",
      units("volts"),
    );
    entries.enabled = builder.start(`${namespace}/DriverStation/Enabled`, "boolean");
    entries.autonomous = builder.start(`${namespace}/DriverStation/Autonomous`, "boolean");
    entries.test = builder.start(`${namespace}/DriverStation/Test`, "boolean");
    entries.matchType = builder.start(`${namespace}/DriverStation/MatchType`, "int64");
  }
  return { builder, entries };
}

export function appendEnergySample(
  builder: WpiLogFixtureBuilder,
  entries: Record<string, number>,
  timestampUs: number,
  values: { current: number; power: number; energy: number },
): void {
  builder
    .double(entries.totalCurrent, timestampUs, values.current)
    .double(entries.totalPower, timestampUs, values.power)
    .double(entries.totalEnergy, timestampUs, values.energy)
    .double(entries.current, timestampUs, values.current)
    .double(entries.power, timestampUs, values.power)
    .double(entries.energy, timestampUs, values.energy);
}

export interface EnergyV2Fixture {
  builder: WpiLogFixtureBuilder;
  root: string;
  contractVersion: "2.1" | "2.2" | "2.3" | "2.4";
  manifest: {
    subsystems: Array<{
      name: string;
      motors: Array<{
        name: string;
        type: "NEO" | null;
        analysisReduction: number | null;
        leader: string | null;
      }>;
    }>;
  };
  entries: Record<string, number>;
}

/** A valid fixed-contract V2 fixture with no v1 dynamic energy tree. */
export function buildEnergyV2Fixture(
  root = "/Team9999/RealOutputs/energyLogger",
  contractVersion: "2.1" | "2.2" | "2.3" | "2.4" = "2.2",
  options: { includeTotalSupplyCurrent?: boolean; supplyOnlyIndexer?: boolean } = {},
): EnergyV2Fixture {
  const builder = new WpiLogFixtureBuilder();
  const manifest: EnergyV2Fixture["manifest"] = {
    subsystems: [
      {
        name: "drive",
        motors: [
          {
            name: "frontLeft",
            type: "NEO",
            analysisReduction: 6.75,
            leader: null,
          },
          {
            name: "frontRight",
            type: "NEO",
            analysisReduction: 6.75,
            leader: "frontLeft",
          },
        ],
      },
      {
        name: "indexer",
        motors: [
          {
            name: "belt",
            type: options.supplyOnlyIndexer ? null : "NEO",
            analysisReduction: options.supplyOnlyIndexer ? null : 1,
            leader: null,
          },
        ],
      },
    ],
  };

  const entries: Record<string, number> = {};
  const start = (key: string, relative: string, type: string) => {
    entries[key] = builder.start(`${root}/${relative}`, type);
  };
  start("contractVersion", "contractVersion", "string");
  start("libraryVersion", "libraryVersion", "string");
  start("manifest", "manifest", "string");
  start("robotTimestamp", "robot/sampleTimestampUs", "int64");
  start("robotCurrent", "robot/supplyCurrentAmps", "double");
  if (options.includeTotalSupplyCurrent) {
    start("robotTotalCurrent", "robot/totalSupplyCurrentAmps", "double");
  }
  start("robotVoltage", "robot/batteryVoltageVolts", "double");
  for (const id of ["s0", "s1"]) {
    start(`${id}.sampleTimestampUs`, `subsystems/${id}/sampleTimestampUs`, "int64");
    start(`${id}.state`, `subsystems/${id}/state`, "string");
    start(`${id}.samples`, `subsystems/${id}/motors/samples`, "double[]");
  }
  builder
    .string(entries.contractVersion, 100_000, contractVersion)
    .string(entries.libraryVersion, 100_000, "2026.0.0-test")
    .string(entries.manifest, 100_000, JSON.stringify(manifest));
  return { builder, root, contractVersion, manifest, entries };
}

export function appendEnergyV2FixtureSample(
  fixture: EnergyV2Fixture,
  timestampUs: number,
  state: { drive: string; indexer: string },
  energyWh: number,
  options: {
    driveStatorCurrentA?: number;
    indexerStatorCurrentA?: number;
    robotCurrentA?: number;
    robotTotalCurrentA?: number;
    robotVoltageV?: number;
    driveLeaderSupplyCurrentA?: number;
    driveFollowerSupplyCurrentA?: number;
    indexerSupplyCurrentA?: number;
  } = {},
): void {
  const { builder, entries } = fixture;
  const driveRotorVelocity = fixture.contractVersion === "2.1" ? 10 : 10 * Math.PI * 2;
  const indexerRotorVelocity = fixture.contractVersion === "2.1" ? 5 : 5 * Math.PI * 2;
  builder
    .int64(entries.robotTimestamp, timestampUs, timestampUs)
    .double(entries.robotCurrent, timestampUs, options.robotCurrentA ?? 25)
    .double(entries.robotVoltage, timestampUs, options.robotVoltageV ?? 12)
    .int64(entries["s0.sampleTimestampUs"], timestampUs, timestampUs)
    .string(entries["s0.state"], timestampUs, state.drive)
    .doubleArray(entries["s0.samples"], timestampUs, [
      options.driveLeaderSupplyCurrentA ?? 12,
      options.driveStatorCurrentA ?? 20,
      driveRotorVelocity,
      options.driveFollowerSupplyCurrentA ?? 8,
      Number.NaN,
      Number.NaN,
    ])
    .int64(entries["s1.sampleTimestampUs"], timestampUs, timestampUs)
    .string(entries["s1.state"], timestampUs, state.indexer)
    .doubleArray(entries["s1.samples"], timestampUs, [
      options.indexerSupplyCurrentA ?? 5,
      fixture.manifest.subsystems[1].motors[0].type === null
        ? Number.NaN
        : options.indexerStatorCurrentA ?? 8,
      fixture.manifest.subsystems[1].motors[0].type === null
        ? Number.NaN
        : indexerRotorVelocity,
    ]);
  if (entries.robotTotalCurrent !== undefined) {
    builder.double(
      entries.robotTotalCurrent,
      timestampUs,
      options.robotTotalCurrentA ?? options.robotCurrentA ?? 25,
    );
  }
  void energyWh;
}
