import type { TimeInterval, TimeRange } from "./types";

export function upperBound(values: ArrayLike<number>, target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (values[middle] <= target) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function rangeIntersections(
  intervals: readonly TimeInterval[],
  range: TimeRange,
): TimeInterval[] {
  const result: TimeInterval[] = [];
  for (const interval of intervals) {
    const startUs = Math.max(interval.startUs, range.startUs);
    const endUs = Math.min(interval.endUs, range.endUs);
    if (endUs <= startUs) continue;
    result.push({ startUs, endUs, durationSeconds: (endUs - startUs) / 1_000_000 });
  }
  return result;
}
