import { LogAnalysisError, fatalIssue, warningIssue } from "./errors";
import { sourceChunks, sourceSize } from "./source";
import type {
  LogIssue,
  ParseOptions,
  TruncatedTail,
  WpiLogEntry,
  WpiLogFileInfo,
  WpiLogHeader,
  WpiLogListing,
  WpiLogSource,
} from "./types";

const MAGIC = new Uint8Array([0x57, 0x50, 0x49, 0x4c, 0x4f, 0x47]);
const VERSION_1_0 = 0x0100;
const DECODE_WINDOW_SIZE = 64 * 1024;
const EMPTY_BYTES = new Uint8Array(0);
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

export interface WpiLogDataRecord {
  entry: WpiLogEntry;
  timestampUs: number;
  payload: Uint8Array;
  offset: number;
  value?: WpiLogDataValue;
}

export type WpiLogDataValue =
  | { type: "boolean"; data: boolean }
  | { type: "int64"; data: bigint }
  | { type: "float"; data: number }
  | { type: "double"; data: number }
  | { type: "string"; data: string }
  | { type: "boolean[]"; data: boolean[] }
  | { type: "int64[]"; data: BigInt64Array }
  | { type: "float[]"; data: Float32Array }
  | { type: "double[]"; data: Float64Array }
  | { type: "string[]"; data: string[] };

export interface WpiLogDecoderHandlers {
  onHeader?: (header: WpiLogHeader) => void;
  onStart?: (entry: WpiLogEntry) => void;
  onFinish?: (entry: WpiLogEntry, timestampUs: number) => void;
  onMetadata?: (entry: WpiLogEntry, timestampUs: number) => void;
  onData?: (record: WpiLogDataRecord) => void;
}

interface RecordHeader {
  entryId: number;
  payloadLength: number;
  timestampUs: number;
  headerLength: number;
  entry?: WpiLogEntry;
}

function corruptDataRecord(
  entry: WpiLogEntry,
  offset: number,
  message: string,
  details?: Record<string, unknown>,
): LogAnalysisError {
  return new LogAnalysisError(
    fatalIssue("CORRUPT_RECORD_MIDDLE", message, {
      offset,
      entryName: entry.name,
      details,
    }),
  );
}

function decodeUtf8(
  bytes: Uint8Array,
  entry: WpiLogEntry,
  offset: number,
): string {
  try {
    return utf8Decoder.decode(bytes);
  } catch {
    throw corruptDataRecord(entry, offset, `${entry.type} entry ${entry.name} contains invalid UTF-8`);
  }
}

function decodeStringArray(
  payload: Uint8Array,
  entry: WpiLogEntry,
  offset: number,
  collect: boolean,
): string[] | undefined {
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  let cursor = 0;
  const requireBytes = (length: number, context: string): void => {
    if (length < 0 || cursor + length > payload.byteLength) {
      throw corruptDataRecord(entry, offset, `${entry.type} entry ${entry.name} has an invalid ${context}`, {
        payloadLength: payload.byteLength,
        cursor,
        requestedLength: length,
      });
    }
  };

  requireBytes(4, "array length");
  const count = view.getUint32(cursor, true);
  cursor += 4;
  if (count > Math.floor((payload.byteLength - cursor) / 4)) {
    throw corruptDataRecord(entry, offset, `${entry.type} entry ${entry.name} declares too many elements`, {
      count,
      payloadLength: payload.byteLength,
    });
  }

  const values = collect ? new Array<string>(count) : undefined;
  for (let index = 0; index < count; index += 1) {
    requireBytes(4, `length for element ${index}`);
    const length = view.getUint32(cursor, true);
    cursor += 4;
    requireBytes(length, `length for element ${index}`);
    if (values) {
      values[index] = decodeUtf8(payload.subarray(cursor, cursor + length), entry, offset);
    }
    cursor += length;
  }
  if (cursor !== payload.byteLength) {
    throw corruptDataRecord(entry, offset, `${entry.type} entry ${entry.name} has trailing bytes`, {
      payloadLength: payload.byteLength,
      consumedLength: cursor,
    });
  }
  return values;
}

function dataView(payload: Uint8Array): DataView {
  return new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
}

function decodeDataValue(
  entry: WpiLogEntry,
  payload: Uint8Array,
  offset: number,
): WpiLogDataValue | undefined {
  switch (entry.type) {
    case "boolean":
      return { type: entry.type, data: payload[0] !== 0 };
    case "int64":
      return { type: entry.type, data: dataView(payload).getBigInt64(0, true) };
    case "float":
      return { type: entry.type, data: dataView(payload).getFloat32(0, true) };
    case "double":
      return { type: entry.type, data: dataView(payload).getFloat64(0, true) };
    case "string":
      return { type: entry.type, data: decodeUtf8(payload, entry, offset) };
    case "boolean[]":
      return { type: entry.type, data: Array.from(payload, (value) => value !== 0) };
    case "int64[]": {
      const view = dataView(payload);
      const values = new BigInt64Array(payload.byteLength / 8);
      for (let index = 0; index < values.length; index += 1) {
        values[index] = view.getBigInt64(index * 8, true);
      }
      return { type: entry.type, data: values };
    }
    case "float[]": {
      const view = dataView(payload);
      const values = new Float32Array(payload.byteLength / 4);
      for (let index = 0; index < values.length; index += 1) {
        values[index] = view.getFloat32(index * 4, true);
      }
      return { type: entry.type, data: values };
    }
    case "double[]": {
      const view = dataView(payload);
      const values = new Float64Array(payload.byteLength / 8);
      for (let index = 0; index < values.length; index += 1) {
        values[index] = view.getFloat64(index * 8, true);
      }
      return { type: entry.type, data: values };
    }
    case "string[]":
      return { type: entry.type, data: decodeStringArray(payload, entry, offset, true) ?? [] };
    default:
      return undefined;
  }
}

class LazyWpiLogDataRecord implements WpiLogDataRecord {
  constructor(
    readonly entry: WpiLogEntry,
    readonly timestampUs: number,
    readonly payload: Uint8Array,
    readonly offset: number,
  ) {}

  get value(): WpiLogDataValue | undefined {
    const value = decodeDataValue(this.entry, this.payload, this.offset);
    Object.defineProperty(this, "value", {
      value,
      enumerable: true,
      writable: false,
    });
    return value;
  }
}

class PayloadCursor {
  private offset = 0;

  constructor(private readonly payload: Uint8Array) {}

  get remaining(): number {
    return this.payload.byteLength - this.offset;
  }

  readU8(): number {
    this.require(1);
    return this.payload[this.offset++];
  }

  readU32(): number {
    this.require(4);
    const value = new DataView(
      this.payload.buffer,
      this.payload.byteOffset + this.offset,
      4,
    ).getUint32(0, true);
    this.offset += 4;
    return value;
  }

  readString(): string {
    const length = this.readU32();
    this.require(length);
    const bytes = this.payload.subarray(this.offset, this.offset + length);
    this.offset += length;
    try {
      return utf8Decoder.decode(bytes);
    } catch {
      throw new Error("Control record contains invalid UTF-8");
    }
  }

  assertFinished(): void {
    if (this.remaining !== 0) throw new Error("Control record has trailing bytes");
  }

  private require(length: number): void {
    if (length < 0 || this.offset + length > this.payload.byteLength) {
      throw new Error("Control record payload is incomplete");
    }
  }
}

class WpiLogStreamDecoder {
  private buffer: Uint8Array<ArrayBufferLike> = EMPTY_BYTES;
  private bufferOffset = 0;
  private header?: WpiLogHeader;
  private finished = false;
  private readonly entries: WpiLogEntry[] = [];
  private readonly activeEntries = new Map<number, WpiLogEntry>();
  private readonly generations = new Map<number, number>();
  private readonly issues: LogIssue[] = [];
  private recordCount = 0;
  private dataRecordCount = 0;
  private controlRecordCount = 0;
  private firstTimestampUs?: number;
  private lastTimestampUs?: number;
  private lastGoodOffset = 0;
  private truncatedTail?: TruncatedTail;

  constructor(private readonly handlers: WpiLogDecoderHandlers) {}

  push(chunk: Uint8Array): void {
    if (this.finished) throw new Error("Cannot push bytes after finishing the decoder");
    if (chunk.byteLength === 0) return;

    let chunkOffset = 0;
    while (chunkOffset < chunk.byteLength) {
      const remainingLength = chunk.byteLength - chunkOffset;
      const windowLength = this.buffer.byteLength >= DECODE_WINDOW_SIZE
        ? remainingLength
        : Math.min(DECODE_WINDOW_SIZE, remainingLength);
      const window = windowLength === chunk.byteLength
        ? chunk
        : chunk.subarray(chunkOffset, chunkOffset + windowLength);
      if (this.buffer.byteLength === 0) {
        this.buffer = window;
      } else {
        const joined = new Uint8Array(this.buffer.byteLength + window.byteLength);
        joined.set(this.buffer);
        joined.set(window, this.buffer.byteLength);
        this.buffer = joined;
      }
      chunkOffset += windowLength;
      this.processAvailable();
    }
  }

  finish(sizeBytes?: number): WpiLogListing {
    if (this.finished) throw new Error("WPILOG decoder was already finished");
    this.finished = true;

    if (!this.header) {
      throw new LogAnalysisError(
        fatalIssue("INVALID_WPILOG", "File ended before the WPILOG header was complete", {
          offset: this.bufferOffset,
        }),
      );
    }

    if (this.buffer.byteLength > 0) {
      this.truncatedTail = this.describeTruncatedTail();
      this.issues.push(
        warningIssue(
          "TRUNCATED_TAIL_RECOVERED",
          `Ignored an incomplete final record (${this.truncatedTail.missingBytes ?? "unknown"} missing bytes)`,
          { offset: this.truncatedTail.offset, details: { ...this.truncatedTail } },
        ),
      );
    }

    const file: WpiLogFileInfo = {
      sizeBytes,
      recordCount: this.recordCount,
      dataRecordCount: this.dataRecordCount,
      controlRecordCount: this.controlRecordCount,
      firstTimestampUs: this.firstTimestampUs,
      lastTimestampUs: this.lastTimestampUs,
      lastGoodOffset: this.lastGoodOffset,
      truncatedTail: this.truncatedTail,
    };

    return {
      header: this.header,
      file,
      entries: this.entries,
      issues: this.issues,
    };
  }

  private processAvailable(): void {
    let cursor = 0;

    if (!this.header) {
      if (this.buffer.byteLength < 12) return;
      for (let index = 0; index < MAGIC.byteLength; index += 1) {
        if (this.buffer[index] !== MAGIC[index]) {
          throw new LogAnalysisError(
            fatalIssue("INVALID_WPILOG", "File does not begin with the WPILOG magic header", {
              offset: this.bufferOffset,
            }),
          );
        }
      }

      const view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
      const version = view.getUint16(6, true);
      if (version !== VERSION_1_0) {
        throw new LogAnalysisError(
          fatalIssue(
            "UNSUPPORTED_VERSION",
            `WPILOG version ${version >>> 8}.${version & 0xff} is not supported`,
            { offset: this.bufferOffset + 6, details: { version } },
          ),
        );
      }

      const extraLength = view.getUint32(8, true);
      const headerLength = 12 + extraLength;
      if (this.buffer.byteLength < headerLength) return;

      let extraHeader: string;
      try {
        extraHeader = utf8Decoder.decode(this.buffer.subarray(12, headerLength));
      } catch {
        throw new LogAnalysisError(
          fatalIssue("INVALID_WPILOG", "WPILOG extra header is not valid UTF-8", {
            offset: this.bufferOffset + 12,
          }),
        );
      }

      this.header = {
        version,
        majorVersion: version >>> 8,
        minorVersion: version & 0xff,
        extraHeader,
        byteLength: headerLength,
      };
      this.lastGoodOffset = headerLength;
      this.handlers.onHeader?.(this.header);
      cursor = headerLength;
    }

    while (cursor < this.buffer.byteLength) {
      const recordOffset = this.bufferOffset + cursor;
      const header = this.tryReadRecordHeader(cursor, recordOffset);
      if (!header) break;
      const recordLength = header.headerLength + header.payloadLength;
      if (this.buffer.byteLength - cursor < recordLength) break;

      const payloadStart = cursor + header.headerLength;
      const payload = this.buffer.subarray(payloadStart, payloadStart + header.payloadLength);
      this.handleRecord(header, payload, recordOffset);
      cursor += recordLength;
      this.recordCount += 1;
      this.lastGoodOffset = this.bufferOffset + cursor;
      this.firstTimestampUs =
        this.firstTimestampUs === undefined
          ? header.timestampUs
          : Math.min(this.firstTimestampUs, header.timestampUs);
      this.lastTimestampUs =
        this.lastTimestampUs === undefined
          ? header.timestampUs
          : Math.max(this.lastTimestampUs, header.timestampUs);
    }

    if (cursor === 0) return;
    this.bufferOffset += cursor;
    this.buffer =
      cursor === this.buffer.byteLength ? EMPTY_BYTES : this.buffer.slice(cursor);
  }

  private tryReadRecordHeader(cursor: number, recordOffset: number): RecordHeader | undefined {
    if (this.buffer.byteLength - cursor < 1) return undefined;
    const bitfield = this.buffer[cursor];
    if ((bitfield & 0x80) !== 0) {
      throw new LogAnalysisError(
        fatalIssue("CORRUPT_RECORD_MIDDLE", "WPILOG record header uses the reserved high bit", {
          offset: recordOffset,
        }),
      );
    }

    const entryLength = (bitfield & 0x03) + 1;
    const payloadLengthBytes = ((bitfield >>> 2) & 0x03) + 1;
    const timestampLength = ((bitfield >>> 4) & 0x07) + 1;
    const headerLength = 1 + entryLength + payloadLengthBytes + timestampLength;
    if (this.buffer.byteLength - cursor < headerLength) return undefined;

    let fieldOffset = cursor + 1;
    const entryId = readUnsignedLittleEndianNumber(this.buffer, fieldOffset, entryLength);
    fieldOffset += entryLength;
    const payloadLength = readUnsignedLittleEndianNumber(
      this.buffer,
      fieldOffset,
      payloadLengthBytes,
    );
    fieldOffset += payloadLengthBytes;
    const timestampUs = readTimestamp(this.buffer, fieldOffset, timestampLength, recordOffset);
    const entry = this.validateDeclaredDataLength(entryId, payloadLength, recordOffset);
    const header = { entryId, payloadLength, timestampUs, headerLength, entry };
    return header;
  }

  private validateDeclaredDataLength(
    entryId: number,
    payloadLength: number,
    offset: number,
  ): WpiLogEntry | undefined {
    if (entryId === 0) return undefined;
    const entry = this.activeEntries.get(entryId);
    if (!entry) {
      throw new LogAnalysisError(
        fatalIssue(
          "CORRUPT_RECORD_MIDDLE",
          `Data record references inactive entry ID ${entryId}`,
          { offset, details: { entryId } },
        ),
      );
    }
    let expected: number | undefined;
    switch (entry.type) {
      case "boolean":
        expected = 1;
        break;
      case "float":
        expected = 4;
        break;
      case "int64":
      case "double":
        expected = 8;
        break;
    }
    if (expected !== undefined && payloadLength !== expected) {
      throw new LogAnalysisError(
        fatalIssue(
          "CORRUPT_RECORD_MIDDLE",
          `${entry.type} entry ${entry.name} declares a ${payloadLength}-byte payload; expected ${expected}`,
          { offset, entryName: entry.name, details: { expected, actual: payloadLength } },
        ),
      );
    }
    let elementLength: number | undefined;
    switch (entry.type) {
      case "float[]":
        elementLength = 4;
        break;
      case "int64[]":
      case "double[]":
        elementLength = 8;
        break;
    }
    if (elementLength !== undefined && payloadLength % elementLength !== 0) {
      throw new LogAnalysisError(
        fatalIssue(
          "CORRUPT_RECORD_MIDDLE",
          `${entry.type} entry ${entry.name} payload is not aligned to ${elementLength}-byte elements`,
          { offset, entryName: entry.name, details: { payloadLength } },
        ),
      );
    }
    if (entry.type === "string[]" && payloadLength < 4) {
      throw corruptDataRecord(
        entry,
        offset,
        `${entry.type} entry ${entry.name} payload is too short to contain an array length`,
        { payloadLength },
      );
    }
    return entry;
  }

  private handleRecord(header: RecordHeader, payload: Uint8Array, offset: number): void {
    if (header.entryId === 0) {
      this.controlRecordCount += 1;
      this.handleControlRecord(payload, header.timestampUs, offset);
      return;
    }

    const entry = header.entry;
    if (!entry) {
      throw new LogAnalysisError(
        fatalIssue(
          "CORRUPT_RECORD_MIDDLE",
          `Data record references inactive entry ID ${header.entryId}`,
          { offset, details: { entryId: header.entryId } },
        ),
      );
    }

    if (entry.type === "string[]") decodeStringArray(payload, entry, offset, false);

    this.dataRecordCount += 1;
    entry.recordCount += 1;
    entry.firstTimestampUs =
      entry.firstTimestampUs === undefined
        ? header.timestampUs
        : Math.min(entry.firstTimestampUs, header.timestampUs);
    entry.lastTimestampUs =
      entry.lastTimestampUs === undefined
        ? header.timestampUs
        : Math.max(entry.lastTimestampUs, header.timestampUs);
    if (this.handlers.onData) {
      this.handlers.onData(new LazyWpiLogDataRecord(entry, header.timestampUs, payload, offset));
    }
  }

  private handleControlRecord(payload: Uint8Array, timestampUs: number, offset: number): void {
    try {
      const cursor = new PayloadCursor(payload);
      const controlType = cursor.readU8();

      if (controlType === 0) {
        const entryId = cursor.readU32();
        const name = cursor.readString();
        const type = cursor.readString();
        const metadata = cursor.readString();
        cursor.assertFinished();
        if (entryId === 0) throw new Error("Start control record cannot assign entry ID zero");
        if (this.activeEntries.has(entryId)) {
          throw new Error(`Entry ID ${entryId} was started twice without a Finish record`);
        }
        const generation = (this.generations.get(entryId) ?? 0) + 1;
        this.generations.set(entryId, generation);
        const entry: WpiLogEntry = {
          entryId,
          generation,
          name,
          type,
          metadata,
          startTimestampUs: timestampUs,
          recordCount: 0,
        };
        this.entries.push(entry);
        this.activeEntries.set(entryId, entry);
        this.handlers.onStart?.(entry);
        return;
      }

      if (controlType === 1) {
        const entryId = cursor.readU32();
        cursor.assertFinished();
        const entry = this.activeEntries.get(entryId);
        if (!entry) throw new Error(`Finish control record references inactive entry ID ${entryId}`);
        entry.finishTimestampUs = timestampUs;
        this.activeEntries.delete(entryId);
        this.handlers.onFinish?.(entry, timestampUs);
        return;
      }

      if (controlType === 2) {
        const entryId = cursor.readU32();
        const metadata = cursor.readString();
        cursor.assertFinished();
        const entry = this.activeEntries.get(entryId);
        if (!entry) {
          throw new Error(`Set Metadata control record references inactive entry ID ${entryId}`);
        }
        entry.metadata = metadata;
        this.handlers.onMetadata?.(entry, timestampUs);
        return;
      }

      throw new Error(`Unknown control record type ${controlType}`);
    } catch (error) {
      if (error instanceof LogAnalysisError) throw error;
      throw new LogAnalysisError(
        fatalIssue(
          "CORRUPT_RECORD_MIDDLE",
          error instanceof Error ? error.message : "Malformed WPILOG control record",
          { offset },
        ),
      );
    }
  }

  private describeTruncatedTail(): TruncatedTail {
    const offset = this.bufferOffset;
    if (this.buffer.byteLength < 1) return { offset, headerBytesAvailable: 0 };

    const bitfield = this.buffer[0];
    if ((bitfield & 0x80) !== 0) {
      throw new LogAnalysisError(
        fatalIssue("CORRUPT_RECORD_MIDDLE", "WPILOG record header uses the reserved high bit", {
          offset,
        }),
      );
    }
    const entryLength = (bitfield & 0x03) + 1;
    const payloadLengthBytes = ((bitfield >>> 2) & 0x03) + 1;
    const timestampLength = ((bitfield >>> 4) & 0x07) + 1;
    const headerLength = 1 + entryLength + payloadLengthBytes + timestampLength;
    if (this.buffer.byteLength < headerLength) {
      return { offset, headerBytesAvailable: this.buffer.byteLength };
    }

    let cursor = 1;
    const entryId = readUnsignedLittleEndianNumber(this.buffer, cursor, entryLength);
    cursor += entryLength;
    const declaredPayloadLength = readUnsignedLittleEndianNumber(
      this.buffer,
      cursor,
      payloadLengthBytes,
    );
    const availablePayloadLength = this.buffer.byteLength - headerLength;
    return {
      offset,
      headerBytesAvailable: headerLength,
      entryId,
      declaredPayloadLength,
      availablePayloadLength,
      missingBytes: Math.max(0, declaredPayloadLength - availablePayloadLength),
    };
  }
}

function readUnsignedLittleEndianNumber(
  bytes: Uint8Array,
  offset: number,
  length: number,
): number {
  switch (length) {
    case 1:
      return bytes[offset];
    case 2:
      return bytes[offset] + bytes[offset + 1] * 0x100;
    case 3:
      return bytes[offset] + bytes[offset + 1] * 0x100 + bytes[offset + 2] * 0x10000;
    case 4:
      return bytes[offset]
        + bytes[offset + 1] * 0x100
        + bytes[offset + 2] * 0x10000
        + bytes[offset + 3] * 0x1000000;
    default:
      throw new RangeError(`Unsupported unsigned integer length ${length}`);
  }
}

function readTimestamp(
  bytes: Uint8Array,
  offset: number,
  length: number,
  recordOffset: number,
): number {
  if (length <= 4) return readUnsignedLittleEndianNumber(bytes, offset, length);

  let value = 0;
  for (let index = length - 1; index >= 0; index -= 1) {
    value = value * 256 + bytes[offset + index];
  }
  if (Number.isSafeInteger(value)) return value;

  let exactValue = 0n;
  for (let index = length - 1; index >= 0; index -= 1) {
    exactValue = exactValue * 256n + BigInt(bytes[offset + index]);
  }
  throw new LogAnalysisError(
    fatalIssue(
      "CORRUPT_RECORD_MIDDLE",
      "WPILOG timestamp exceeds JavaScript's exact integer range",
      { offset: recordOffset, details: { timestamp: exactValue.toString() } },
    ),
  );
}

export async function decodeWpiLog(
  source: WpiLogSource,
  handlers: WpiLogDecoderHandlers = {},
  options: ParseOptions = {},
): Promise<WpiLogListing> {
  const decoder = new WpiLogStreamDecoder(handlers);
  for await (const chunk of sourceChunks(source, options)) decoder.push(chunk);
  return decoder.finish(sourceSize(source));
}
