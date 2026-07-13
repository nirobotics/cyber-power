import type { ModeInterval, TimeRange } from "../log-analysis/core";

export type RangeEndpoint = "start" | "end";
type NormalizedMode = TimeRange & Pick<ModeInterval, "isPractice" | "mode">;

export function selectDefaultTimeRange(
  bounds: TimeRange,
  modes: readonly ModeInterval[],
): TimeRange {
  const normalizedBounds = normalizeBounds(bounds);
  const activeModes = modes
    .map<NormalizedMode | null>((segment) => {
      const interval = clampInterval(segment, normalizedBounds);
      return interval && isActiveMode(segment.mode)
        ? { ...interval, mode: segment.mode, isPractice: segment.isPractice === true }
        : null;
    })
    .filter((segment): segment is NormalizedMode => segment !== null)
    .sort((left, right) => left.startUs - right.startUs || left.endUs - right.endUs);
  const selectedStart = activeModes.find(
    (segment) => segment.mode === "autonomous" && segment.isPractice,
  ) ?? activeModes.find(
    (segment) => segment.mode === "autonomous" && !segment.isPractice,
  ) ?? activeModes.find((segment) => !segment.isPractice);

  const startUs = selectedStart?.startUs;
  const endUs = activeModes.reduce<number | undefined>(
    (latest, segment) => latest === undefined ? segment.endUs : Math.max(latest, segment.endUs),
    undefined,
  );
  if (startUs === undefined || endUs === undefined || endUs < startUs) return normalizedBounds;
  return { startUs, endUs };
}

export function modeBoundaryTimestamps(
  modes: readonly ModeInterval[],
  bounds: TimeRange,
): number[] {
  const normalizedBounds = normalizeBounds(bounds);
  const normalizedModes = modes
    .map((segment) => {
      const interval = clampInterval(segment, normalizedBounds);
      return interval ? { ...interval, mode: segment.mode } : null;
    })
    .filter((segment): segment is TimeRange & Pick<ModeInterval, "mode"> => segment !== null)
    .sort((left, right) => left.startUs - right.startUs || left.endUs - right.endUs);
  const mergedModes: Array<TimeRange & Pick<ModeInterval, "mode">> = [];
  for (const segment of normalizedModes) {
    const previous = mergedModes.at(-1);
    if (previous?.mode === segment.mode && segment.startUs <= previous.endUs) {
      previous.endUs = Math.max(previous.endUs, segment.endUs);
    } else {
      mergedModes.push({ ...segment });
    }
  }
  const boundaries = new Set<number>();
  for (const segment of mergedModes) {
    boundaries.add(segment.startUs);
    boundaries.add(segment.endUs);
  }
  return [...boundaries].sort((left, right) => left - right);
}

export function updateRangeEndpoint(
  current: TimeRange,
  endpoint: RangeEndpoint,
  rawUs: number,
  bounds: TimeRange,
  modeBoundariesUs: readonly number[],
  toleranceUs: number,
): TimeRange {
  const normalizedBounds = normalizeBounds(bounds);
  const normalizedCurrent = normalizeRange(current, normalizedBounds);
  if (!Number.isFinite(rawUs)) return normalizedCurrent;

  const minimumUs = endpoint === "start" ? normalizedBounds.startUs : normalizedCurrent.startUs;
  const maximumUs = endpoint === "start" ? normalizedCurrent.endUs : normalizedBounds.endUs;
  const roundedRawUs = Math.round(rawUs);
  const clampedUs = clamp(roundedRawUs, minimumUs, maximumUs);
  const endpointUs = roundedRawUs === clampedUs
    ? nearestBoundary(clampedUs, modeBoundariesUs, minimumUs, maximumUs, toleranceUs)
    : clampedUs;

  return endpoint === "start"
    ? { startUs: endpointUs, endUs: normalizedCurrent.endUs }
    : { startUs: normalizedCurrent.startUs, endUs: endpointUs };
}

export function visualSnapToleranceUs(
  minimumUs: number,
  maximumUs: number,
  trackWidthPx: number,
  radiusPx = 8,
): number {
  if (
    !Number.isFinite(minimumUs) ||
    !Number.isFinite(maximumUs) ||
    !Number.isFinite(trackWidthPx) ||
    !Number.isFinite(radiusPx) ||
    maximumUs <= minimumUs ||
    trackWidthPx <= 0 ||
    radiusPx <= 0
  ) {
    return 0;
  }
  return ((maximumUs - minimumUs) / trackWidthPx) * radiusPx;
}

function isActiveMode(mode: string) {
  return mode !== "disabled" && mode !== "test";
}

function clampInterval(interval: TimeRange, bounds: TimeRange): TimeRange | null {
  if (!Number.isFinite(interval.startUs) || !Number.isFinite(interval.endUs)) return null;
  const startUs = clamp(Math.round(interval.startUs), bounds.startUs, bounds.endUs);
  const endUs = clamp(Math.round(interval.endUs), bounds.startUs, bounds.endUs);
  return endUs > startUs ? { startUs, endUs } : null;
}

function normalizeBounds(bounds: TimeRange): TimeRange {
  const startUs = Number.isFinite(bounds.startUs) ? Math.round(bounds.startUs) : 0;
  const requestedEndUs = Number.isFinite(bounds.endUs) ? Math.round(bounds.endUs) : startUs;
  return { startUs, endUs: Math.max(startUs, requestedEndUs) };
}

function normalizeRange(range: TimeRange, bounds: TimeRange): TimeRange {
  const requestedStartUs = Number.isFinite(range.startUs) ? Math.round(range.startUs) : bounds.startUs;
  const startUs = clamp(requestedStartUs, bounds.startUs, bounds.endUs);
  const requestedEndUs = Number.isFinite(range.endUs) ? Math.round(range.endUs) : bounds.endUs;
  const endUs = clamp(requestedEndUs, startUs, bounds.endUs);
  return { startUs, endUs };
}

function nearestBoundary(
  valueUs: number,
  boundariesUs: readonly number[],
  minimumUs: number,
  maximumUs: number,
  toleranceUs: number,
) {
  const tolerance = Number.isFinite(toleranceUs) ? Math.max(0, toleranceUs) : 0;
  let nearestUs = valueUs;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const boundaryUs of boundariesUs) {
    if (!Number.isFinite(boundaryUs)) continue;
    const roundedBoundaryUs = Math.round(boundaryUs);
    if (roundedBoundaryUs < minimumUs || roundedBoundaryUs > maximumUs) continue;
    const distance = Math.abs(roundedBoundaryUs - valueUs);
    if (
      distance <= tolerance &&
      (distance < nearestDistance || (distance === nearestDistance && roundedBoundaryUs < nearestUs))
    ) {
      nearestUs = roundedBoundaryUs;
      nearestDistance = distance;
    }
  }
  return nearestUs;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}
