import { describe, expect, it } from "vitest";

import { WpiLogFixtureBuilder } from "../../../../tests/fixtures/wpilog-builder";
import { LogAnalysisError, listWpiLog } from "./index";
import { decodeWpiLog, type WpiLogDataValue } from "./wpilog-decoder";

async function* oneByteChunks(bytes: Uint8Array): AsyncGenerator<Uint8Array> {
  for (const byte of bytes) yield Uint8Array.of(byte);
}

function alignedTailFixture<T>(
  tailPrefixLength: number,
  populate: (builder: WpiLogFixtureBuilder) => T,
): { builder: WpiLogFixtureBuilder; value: T } {
  const measured = new WpiLogFixtureBuilder("");
  populate(measured);
  const targetModulo = (4096 - tailPrefixLength) % 4096;
  const extraHeaderLength =
    (targetModulo - measured.build().byteLength % 4096 + 4096) % 4096;
  const builder = new WpiLogFixtureBuilder("x".repeat(extraHeaderLength));
  return { builder, value: populate(builder) };
}

describe("WPILOG 1.0 decoder", () => {
  it("decodes scalar and array values using the WPILOG little-endian encoding", async () => {
    const builder = new WpiLogFixtureBuilder("typed-values");
    const entries = {
      string: builder.start("/Example/String", "string"),
      strings: builder.start("/Example/Strings", "string[]"),
      doubles: builder.start("/Example/Doubles", "double[]"),
      booleans: builder.start("/Example/Booleans", "boolean[]"),
      integers: builder.start("/Example/Integers", "int64[]"),
      double: builder.start("/Example/Double", "double"),
      boolean: builder.start("/Example/Boolean", "boolean"),
      integer: builder.start("/Example/Integer", "int64"),
    };
    builder
      .string(entries.string, 1, "电机 A")
      .stringArray(entries.strings, 2, ["swerve", "电机 A", ""])
      .doubleArray(entries.doubles, 3, [1.25, -2.5, Number.NaN])
      .booleanArray(entries.booleans, 4, [true, false, true])
      .int64Array(entries.integers, 5, [0x0102030405060708n, -2n])
      .double(entries.double, 6, -123.5)
      .boolean(entries.boolean, 7, true)
      .int64(entries.integer, 8, -9n);

    const values = new Map<string, WpiLogDataValue | undefined>();
    await decodeWpiLog(oneByteChunks(builder.build()), {
      onData(record) {
        const value = record.value;
        expect(record.value).toBe(value);
        values.set(record.entry.name, value);
      },
    });

    expect(values.get("/Example/String")).toEqual({ type: "string", data: "电机 A" });
    expect(values.get("/Example/Strings")).toEqual({
      type: "string[]",
      data: ["swerve", "电机 A", ""],
    });
    expect(values.get("/Example/Doubles")).toEqual({
      type: "double[]",
      data: Float64Array.from([1.25, -2.5, Number.NaN]),
    });
    expect(values.get("/Example/Booleans")).toEqual({
      type: "boolean[]",
      data: [true, false, true],
    });
    expect(values.get("/Example/Integers")).toEqual({
      type: "int64[]",
      data: BigInt64Array.from([0x0102030405060708n, -2n]),
    });
    expect(values.get("/Example/Double")).toEqual({ type: "double", data: -123.5 });
    expect(values.get("/Example/Boolean")).toEqual({ type: "boolean", data: true });
    expect(values.get("/Example/Integer")).toEqual({ type: "int64", data: -9n });
  });

  it("decodes empty arrays", async () => {
    const builder = new WpiLogFixtureBuilder();
    const entries = {
      strings: builder.start("/Example/Strings", "string[]"),
      doubles: builder.start("/Example/Doubles", "double[]"),
      booleans: builder.start("/Example/Booleans", "boolean[]"),
      integers: builder.start("/Example/Integers", "int64[]"),
    };
    builder
      .stringArray(entries.strings, 1, [])
      .doubleArray(entries.doubles, 2, [])
      .booleanArray(entries.booleans, 3, [])
      .int64Array(entries.integers, 4, []);

    const values: WpiLogDataValue[] = [];
    await decodeWpiLog(builder.build(), {
      onData(record) {
        if (record.value) values.push(record.value);
      },
    });

    expect(values).toEqual([
      { type: "string[]", data: [] },
      { type: "double[]", data: new Float64Array() },
      { type: "boolean[]", data: [] },
      { type: "int64[]", data: new BigInt64Array() },
    ]);
  });

  it.each([
    ["double[]", Uint8Array.of(1, 2, 3)],
    ["int64[]", Uint8Array.of(1, 2, 3, 4, 5, 6, 7)],
    ["string[]", Uint8Array.of(0, 0, 0)],
    ["string[]", Uint8Array.of(1, 0, 0, 0, 4, 0, 0, 0, 0x61)],
    ["string[]", Uint8Array.of(0, 0, 0, 0, 0xff)],
  ])("rejects malformed %s payload lengths as middle corruption", async (type, payload) => {
    const builder = new WpiLogFixtureBuilder();
    const entry = builder.start("/Example/Value", type);
    builder.raw(entry, 1, payload);

    await expect(listWpiLog(builder.build())).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof LogAnalysisError &&
        error.issues[0]?.code === "CORRUPT_RECORD_MIDDLE" &&
        error.issues[0]?.entryName === "/Example/Value",
    );
  });

  it.each([
    ["string", Uint8Array.of(0xc3, 0x28)],
    ["string[]", Uint8Array.of(1, 0, 0, 0, 2, 0, 0, 0, 0xc3, 0x28)],
  ])("rejects invalid UTF-8 in %s payloads as middle corruption", async (type, payload) => {
    const builder = new WpiLogFixtureBuilder();
    const entry = builder.start("/Example/Value", type);
    builder.raw(entry, 1, payload);

    await expect(decodeWpiLog(builder.build(), {
      onData(record) {
        void record.value;
      },
    })).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof LogAnalysisError &&
        error.issues[0]?.code === "CORRUPT_RECORD_MIDDLE" &&
        error.issues[0]?.entryName === "/Example/Value",
    );
  });

  it("decodes control and data records across arbitrary chunk boundaries", async () => {
    const builder = new WpiLogFixtureBuilder("stream-test");
    const entry = builder.start("/Example/Value", "double", "{}");
    builder.double(entry, 1_000_000, 42.5).setMetadata(entry, '{"units":"volts"}', 1_100_000);
    builder.double(entry, 2_000_000, 40).finish(entry, 2_100_000);

    const listing = await listWpiLog(oneByteChunks(builder.build()));

    expect(listing.header).toMatchObject({ version: 0x0100, extraHeader: "stream-test" });
    expect(listing.file).toMatchObject({
      recordCount: 5,
      dataRecordCount: 2,
      controlRecordCount: 3,
      firstTimestampUs: 0,
      lastTimestampUs: 2_100_000,
    });
    expect(listing.entries).toHaveLength(1);
    expect(listing.entries[0]).toMatchObject({
      name: "/Example/Value",
      type: "double",
      metadata: '{"units":"volts"}',
      recordCount: 2,
      firstTimestampUs: 1_000_000,
      lastTimestampUs: 2_000_000,
    });
  });

  it("rejects reserved header bits as middle corruption", async () => {
    const builder = new WpiLogFixtureBuilder();
    const entry = builder.start("/Example/Raw", "raw");
    builder.raw(entry, 1, Uint8Array.of(1, 2, 3)).appendBytes(Uint8Array.of(0x80, 0, 0));

    await expect(listWpiLog(builder.build())).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof LogAnalysisError &&
        error.issues.some((issue) => issue.code === "CORRUPT_RECORD_MIDDLE"),
    );
  });

  it("rejects unsupported versions", async () => {
    const bytes = new WpiLogFixtureBuilder().build();
    bytes[6] = 1;
    bytes[7] = 2;
    await expect(listWpiLog(bytes)).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof LogAnalysisError &&
        error.issues[0]?.code === "UNSUPPORTED_VERSION",
    );
  });

  it("rejects timestamps above JavaScript's exact integer range with the exact value", async () => {
    const builder = new WpiLogFixtureBuilder();
    const entry = builder.start("/Example/Raw", "raw");
    builder.appendBytes(
      Uint8Array.of(
        0x70,
        entry,
        1,
        0,
        0,
        0,
        0,
        0,
        0,
        0x20,
        0,
        1,
      ),
    );

    await expect(listWpiLog(builder.build())).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof LogAnalysisError &&
        error.issues[0]?.code === "CORRUPT_RECORD_MIDDLE" &&
        error.issues[0]?.details?.timestamp === "9007199254740992",
    );
  });

  it("decodes a data record larger than the internal decode window", async () => {
    const builder = new WpiLogFixtureBuilder();
    const entry = builder.start("/Example/Raw", "raw");
    builder.raw(entry, 1, new Uint8Array(256 * 1024)).raw(entry, 2, Uint8Array.of(7));

    const listing = await listWpiLog(builder.build());

    expect(listing.file).toMatchObject({
      recordCount: 3,
      dataRecordCount: 2,
      controlRecordCount: 1,
      lastTimestampUs: 2,
    });
    expect(listing.entries[0]).toMatchObject({ recordCount: 2, lastTimestampUs: 2 });
  });

  it("recovers a partially written final record hidden by zero-filled padding", async () => {
    const { builder, value: entry } = alignedTailFixture(3, (fixture) => {
      const fixtureEntry = fixture.start("/Example/Raw", "raw");
      fixture.raw(fixtureEntry, 2_000_000, new Uint8Array(80).fill(7));
      return fixtureEntry;
    });
    const lastGoodOffset = builder.build().byteLength;
    builder
      .appendBytes(Uint8Array.of(0x30, entry, 80))
      .appendBytes(new Uint8Array(4096));
    const padded = builder.build();

    const listing = await listWpiLog(oneByteChunks(padded));

    expect(listing.file).toMatchObject({
      recordCount: 2,
      lastGoodOffset,
      truncatedTail: {
        offset: lastGoodOffset,
        headerBytesAvailable: 3,
      },
    });
    expect(listing.entries[0]).toMatchObject({ recordCount: 1, lastTimestampUs: 2_000_000 });
    expect(listing.issues).toContainEqual(
      expect.objectContaining({ code: "TRUNCATED_TAIL_RECOVERED", offset: lastGoodOffset }),
    );

    const nonTerminal = new Uint8Array(padded.byteLength + 1);
    nonTerminal.set(padded);
    nonTerminal[nonTerminal.length - 1] = 1;
    await expect(listWpiLog(oneByteChunks(nonTerminal))).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof LogAnalysisError &&
        error.issues[0]?.code === "CORRUPT_RECORD_MIDDLE",
    );
  });

  it("recovers when zero fill completes a fixed-width record header", async () => {
    const { builder, value: entry } = alignedTailFixture(2, (fixture) =>
      fixture.start("/Example/Double", "double")
    );
    const lastGoodOffset = builder.build().byteLength;
    builder
      .appendBytes(Uint8Array.of(0x30, entry))
      .appendBytes(new Uint8Array(4096));

    const listing = await listWpiLog(oneByteChunks(builder.build()));

    expect(listing.file).toMatchObject({
      recordCount: 1,
      dataRecordCount: 0,
      lastGoodOffset,
      truncatedTail: { offset: lastGoodOffset, headerBytesAvailable: 2 },
    });
    expect(listing.entries[0]).toMatchObject({ recordCount: 0 });
  });

  it("keeps a valid all-zero final record before a zero-filled block", async () => {
    const { builder } = alignedTailFixture(0, (fixture) => {
      const fixtureEntry = fixture.start("/Example/Raw", "raw");
      fixture
        .raw(fixtureEntry, 2_000_000, Uint8Array.of(7))
        .raw(fixtureEntry, 0, new Uint8Array(80));
      return fixtureEntry;
    });
    const lastGoodOffset = builder.build().byteLength;
    builder.appendBytes(new Uint8Array(4096));

    const listing = await listWpiLog(builder.build());

    expect(listing.file).toMatchObject({
      recordCount: 3,
      dataRecordCount: 2,
      lastGoodOffset,
      truncatedTail: { offset: lastGoodOffset, headerBytesAvailable: 0 },
    });
    expect(listing.entries[0]).toMatchObject({ recordCount: 2, lastTimestampUs: 2_000_000 });
  });

  it("keeps an aligned final record whose payload ends with a full zero block", async () => {
    const { builder } = alignedTailFixture(0, (fixture) => {
      const fixtureEntry = fixture.start("/Example/Raw", "raw");
      fixture.raw(fixtureEntry, 0, new Uint8Array(4096));
      return fixtureEntry;
    });
    const lastGoodOffset = builder.build().byteLength;

    const listing = await listWpiLog(builder.build());

    expect(listing.file).toMatchObject({
      recordCount: 2,
      dataRecordCount: 1,
      lastGoodOffset,
    });
    expect(listing.file.truncatedTail).toBeUndefined();
    expect(listing.entries[0]).toMatchObject({ recordCount: 1, lastTimestampUs: 0 });
  });
});
