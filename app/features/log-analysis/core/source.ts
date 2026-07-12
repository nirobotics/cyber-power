import type { ParseOptions, WpiLogSource } from "./types";

const DEFAULT_CHUNK_SIZE = 4 * 1024 * 1024;

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error("WPILOG parsing was aborted");
  error.name = "AbortError";
  throw error;
}

function isBlob(source: WpiLogSource): source is Blob {
  return typeof Blob !== "undefined" && source instanceof Blob;
}

function isAsyncIterable(source: WpiLogSource): source is AsyncIterable<Uint8Array> {
  return typeof (source as AsyncIterable<Uint8Array>)[Symbol.asyncIterator] === "function";
}

export function sourceSize(source: WpiLogSource): number | undefined {
  if (isBlob(source)) return source.size;
  if (source instanceof ArrayBuffer) return source.byteLength;
  if (ArrayBuffer.isView(source)) return source.byteLength;
  return undefined;
}

export async function* sourceChunks(
  source: WpiLogSource,
  options: ParseOptions = {},
): AsyncGenerator<Uint8Array> {
  const chunkSize = Math.max(64 * 1024, options.chunkSize ?? DEFAULT_CHUNK_SIZE);
  const totalBytes = sourceSize(source);
  let processedBytes = 0;

  const publish = (chunk: Uint8Array): Uint8Array => {
    throwIfAborted(options.signal);
    processedBytes += chunk.byteLength;
    options.onProgress?.(processedBytes, totalBytes);
    return chunk;
  };

  if (isBlob(source)) {
    for (let offset = 0; offset < source.size; offset += chunkSize) {
      const buffer = await source.slice(offset, Math.min(source.size, offset + chunkSize)).arrayBuffer();
      yield publish(new Uint8Array(buffer));
    }
    return;
  }

  if (source instanceof ArrayBuffer) {
    for (let offset = 0; offset < source.byteLength; offset += chunkSize) {
      yield publish(new Uint8Array(source, offset, Math.min(chunkSize, source.byteLength - offset)));
    }
    return;
  }

  if (ArrayBuffer.isView(source)) {
    const bytes = new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
    for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
      yield publish(bytes.subarray(offset, Math.min(bytes.byteLength, offset + chunkSize)));
    }
    return;
  }

  if (isAsyncIterable(source)) {
    for await (const chunk of source) {
      if (!(chunk instanceof Uint8Array)) {
        throw new TypeError("WPILOG chunk sources must yield Uint8Array values");
      }
      if (chunk.byteLength > 0) yield publish(chunk);
    }
    return;
  }

  throw new TypeError("Unsupported WPILOG source");
}
