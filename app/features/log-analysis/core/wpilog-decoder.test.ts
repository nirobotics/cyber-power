import { describe, expect, it } from "vitest";

import { WpiLogFixtureBuilder } from "../../../../tests/fixtures/wpilog-builder";
import { LogAnalysisError, listWpiLog } from "./index";

async function* oneByteChunks(bytes: Uint8Array): AsyncGenerator<Uint8Array> {
  for (const byte of bytes) yield Uint8Array.of(byte);
}

describe("WPILOG 1.0 decoder", () => {
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
});
