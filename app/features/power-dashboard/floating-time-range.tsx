import { useEffect, useMemo, useRef } from "react";
import type { EnergyLogDataset, TimeInterval, TimeRange } from "../log-analysis/core";
import { formatNumber } from "./format";
import {
  modeBoundaryTimestamps,
  type RangeEndpoint,
  updateRangeEndpoint,
  visualSnapToleranceUs,
} from "./time-range";

const MODE_COLORS = {
  disabled: "rgba(126, 139, 157, .18)",
  autonomous: "rgba(155, 124, 255, .38)",
  teleop: "rgba(73, 195, 223, .28)",
  enabled: "rgba(73, 195, 223, .28)",
  test: "rgba(251, 146, 60, .28)",
} as const;

const MODE_LABELS = {
  disabled: "禁用",
  autonomous: "AUTO",
  teleop: "TELEOP",
  enabled: "ENABLED",
  test: "TEST",
} as const;

const BROWNOUT_COLOR = "rgba(248, 113, 113, .88)";
const SNAP_RADIUS_PX = 8;

export function FloatingTimeRange({
  dataset,
  range,
  cursorUs,
  onPreviewRange,
  onCommitRange,
  onCursorChange,
}: {
  dataset: EnergyLogDataset;
  range: TimeRange;
  cursorUs: number;
  onPreviewRange: (range: TimeRange) => void;
  onCommitRange: (range: TimeRange) => void;
  onCursorChange: (cursorUs: number) => void;
}) {
  const minimumUs = roundMicroseconds(dataset.bounds.energyStartUs);
  const maximumUs = Math.max(minimumUs, roundMicroseconds(dataset.bounds.energyEndUs));
  const startUs = clampMicroseconds(range.startUs, minimumUs, maximumUs);
  const endUs = Math.max(startUs, clampMicroseconds(range.endUs, minimumUs, maximumUs));
  const normalizedCursorUs = clampMicroseconds(cursorUs, startUs, endUs);
  const minimumSeconds = minimumUs / 1_000_000;
  const maximumSeconds = maximumUs / 1_000_000;
  const cursorSeconds = normalizedCursorUs / 1_000_000;
  const startPercent = rangePercent(startUs, minimumUs, maximumUs);
  const endPercent = rangePercent(endUs, minimumUs, maximumUs);
  const cursorPercent = rangePercent(normalizedCursorUs, minimumUs, maximumUs);
  const pendingRangeRef = useRef<TimeRange>({ startUs, endUs });
  const committedRangeRef = useRef<TimeRange>({ startUs, endUs });
  const activeEndpointRef = useRef<RangeEndpoint | null>(null);
  const modeBoundariesUs = useMemo(
    () => modeBoundaryTimestamps(dataset.segments.modes, { startUs: minimumUs, endUs: maximumUs }),
    [dataset.segments.modes, maximumUs, minimumUs],
  );
  const brownoutMarkers = useMemo(
    () => buildBrownoutMarkers(dataset.segments.brownouts, minimumUs, maximumUs),
    [dataset.segments.brownouts, maximumUs, minimumUs],
  );
  const legendItems = [
    { label: "AUTO", color: MODE_COLORS.autonomous },
    { label: "TELEOP", color: MODE_COLORS.teleop },
    ...(dataset.segments.modes.some((segment) => segment.mode === "enabled")
      ? [{ label: "ENABLED", color: MODE_COLORS.enabled }]
      : []),
    { label: "BROWNOUT", color: BROWNOUT_COLOR },
  ];

  useEffect(() => {
    pendingRangeRef.current = { startUs, endUs };
  }, [endUs, startUs]);

  const previewEndpoint = (endpoint: RangeEndpoint, value: number, trackWidthPx: number) => {
    const toleranceUs = activeEndpointRef.current === endpoint
      ? visualSnapToleranceUs(minimumUs, maximumUs, trackWidthPx, SNAP_RADIUS_PX)
      : 0;
    const next = updateRangeEndpoint(
      pendingRangeRef.current,
      endpoint,
      value,
      { startUs: minimumUs, endUs: maximumUs },
      modeBoundariesUs,
      toleranceUs,
    );
    if (rangesEqual(next, pendingRangeRef.current)) return;
    pendingRangeRef.current = next;
    onPreviewRange(next);
  };
  const beginPointerDrag = (endpoint: RangeEndpoint) => {
    activeEndpointRef.current = endpoint;
    pendingRangeRef.current = { startUs, endUs };
  };
  const commit = () => {
    const next = pendingRangeRef.current;
    if (rangesEqual(next, committedRangeRef.current)) return;
    committedRangeRef.current = next;
    onCommitRange(next);
  };
  const finishPointerDrag = (endpoint: RangeEndpoint) => {
    if (activeEndpointRef.current === endpoint) activeEndpointRef.current = null;
    commit();
  };

  return (
    <>
      <div className="floating-time-range-spacer" aria-hidden="true" />
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 px-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] sm:px-4">
        <section
          className="pointer-events-auto mx-auto w-full max-w-[1680px] overflow-x-clip rounded-lg border border-line bg-surface/95 px-2.5 py-2 shadow-[0_14px_40px_rgba(0,0,0,.28)] backdrop-blur sm:px-3"
          aria-label="时间范围与游标"
        >
          <div
            className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[9px] font-semibold text-ink-dim"
            role="group"
            aria-label="机器人状态图例"
          >
            {legendItems.map((item) => (
              <span key={item.label} className="inline-flex items-center gap-1">
                <span
                  className="size-2 rounded-sm border border-line/70"
                  style={{ background: item.color }}
                  aria-hidden="true"
                />
                {item.label}
              </span>
            ))}
          </div>

          <div className="relative mt-1 h-14 min-w-0 select-none" role="group" aria-label="完整日志时间轴">
            <div className="absolute inset-x-0 top-6 h-2.5 overflow-hidden rounded-full border border-line bg-surface-2">
              {dataset.segments.modes.map((segment, index) => (
                <span
                  key={`${segment.mode}-${segment.startUs}-${index}`}
                  className="absolute inset-y-0 border-r border-surface/40"
                  style={intervalStyle(segment.startUs, segment.endUs, minimumUs, maximumUs, MODE_COLORS[segment.mode])}
                  title={`${MODE_LABELS[segment.mode]} ${formatNumber(segment.startUs / 1_000_000, 3)}–${formatNumber(segment.endUs / 1_000_000, 3)}s`}
                />
              ))}
              {dataset.segments.brownouts.map((segment, index) => (
                <span
                  key={`brownout-${segment.startUs}-${index}`}
                  className="absolute inset-y-0 z-10 min-w-px bg-danger/85"
                  style={intervalStyle(segment.startUs, segment.endUs, minimumUs, maximumUs, BROWNOUT_COLOR)}
                  title={`BROWNOUT ${formatNumber(segment.startUs / 1_000_000, 3)}–${formatNumber(segment.endUs / 1_000_000, 3)}s`}
                />
              ))}
            </div>

            <div
              className="pointer-events-none absolute top-5 h-4 rounded border border-brand/70 bg-brand/10"
              style={{ left: `${startPercent}%`, width: `${Math.max(0, endPercent - startPercent)}%` }}
            />
            {brownoutMarkers.length > 0 ? (
              <div
                className="pointer-events-none absolute inset-x-0 top-5 z-20 h-4"
                role="img"
                aria-label={`Brownout 发生位置，共 ${brownoutMarkers.length} 处；红色叉号中心对应完整日志时间轴上的发生时刻。`}
                data-brownout-marker-count={brownoutMarkers.length}
              >
                {brownoutMarkers.map((marker) => (
                  <span
                    key={marker.startUs}
                    className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 text-[14px] font-black leading-none text-danger"
                    style={{ left: `${marker.positionPercent}%`, textShadow: "0 0 2px rgb(var(--surface))" }}
                    aria-hidden="true"
                  >
                    ×
                  </span>
                ))}
              </div>
            ) : null}
            <div
              className="pointer-events-none absolute top-0 z-20 -translate-x-1/2 rounded bg-brand px-1.5 py-0.5 font-mono text-[10px] font-semibold text-brand-fg shadow"
              style={{ left: `${Math.max(5, Math.min(95, cursorPercent))}%` }}
            >
              {formatNumber(cursorSeconds, 3)}s
            </div>
            <div
              className="pointer-events-none absolute top-4 z-20 h-6 w-px bg-brand"
              style={{ left: `${cursorPercent}%` }}
            />

            <input
              type="range"
              className="time-range-input time-range-boundary absolute inset-x-0 top-3 z-30 h-9 w-full"
              min={minimumUs}
              max={maximumUs}
              step={1}
              value={startUs}
              onChange={(event) => previewEndpoint(
                "start",
                Number(event.currentTarget.value),
                event.currentTarget.getBoundingClientRect().width,
              )}
              onPointerDown={() => beginPointerDrag("start")}
              onPointerUp={() => finishPointerDrag("start")}
              onPointerCancel={() => finishPointerDrag("start")}
              onKeyUp={commit}
              onBlur={() => finishPointerDrag("start")}
              aria-label="时间范围开始位置"
              aria-valuetext={`${formatNumber(startUs / 1_000_000, 3)} 秒`}
            />
            <input
              type="range"
              className="time-range-input time-range-boundary absolute inset-x-0 top-3 z-30 h-9 w-full"
              min={minimumUs}
              max={maximumUs}
              step={1}
              value={endUs}
              onChange={(event) => previewEndpoint(
                "end",
                Number(event.currentTarget.value),
                event.currentTarget.getBoundingClientRect().width,
              )}
              onPointerDown={() => beginPointerDrag("end")}
              onPointerUp={() => finishPointerDrag("end")}
              onPointerCancel={() => finishPointerDrag("end")}
              onKeyUp={commit}
              onBlur={() => finishPointerDrag("end")}
              aria-label="时间范围结束位置"
              aria-valuetext={`${formatNumber(endUs / 1_000_000, 3)} 秒`}
            />
            <input
              type="range"
              className="time-range-input time-range-cursor absolute inset-x-0 top-1 z-40 h-10 w-full"
              min={minimumUs}
              max={maximumUs}
              step={1}
              value={normalizedCursorUs}
              onChange={(event) => {
                onCursorChange(clampMicroseconds(Number(event.currentTarget.value), startUs, endUs));
              }}
              aria-label="共享时间游标"
              aria-valuemin={startUs}
              aria-valuemax={endUs}
              aria-valuetext={`${formatNumber(cursorSeconds, 3)} 秒`}
            />

            <span className="pointer-events-none absolute bottom-0 left-0 font-mono text-[9px] text-ink-faint">
              {formatNumber(minimumSeconds, 3)}s
            </span>
            <span className="pointer-events-none absolute bottom-0 right-0 font-mono text-[9px] text-ink-faint">
              {formatNumber(maximumSeconds, 3)}s
            </span>
          </div>
        </section>
      </div>
    </>
  );
}

function intervalStyle(startUs: number, endUs: number, minimumUs: number, maximumUs: number, background: string) {
  const left = rangePercent(startUs, minimumUs, maximumUs);
  const right = rangePercent(endUs, minimumUs, maximumUs);
  return { left: `${left}%`, width: `${Math.max(0, right - left)}%`, background };
}

export function buildBrownoutMarkers(
  intervals: readonly Pick<TimeInterval, "startUs">[],
  minimumUs: number,
  maximumUs: number,
) {
  const startsUs = [...new Set(intervals
    .map((interval) => interval.startUs)
    .filter(Number.isFinite))];
  return startsUs.map((startUs) => ({
    startUs,
    positionPercent: rangePercent(startUs, minimumUs, maximumUs),
  }));
}

function rangePercent(value: number, minimum: number, maximum: number) {
  if (maximum <= minimum) return 0;
  return ((clamp(value, minimum, maximum) - minimum) / (maximum - minimum)) * 100;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function rangesEqual(left: TimeRange, right: TimeRange) {
  return left.startUs === right.startUs && left.endUs === right.endUs;
}

export function roundMicroseconds(value: number) {
  return Number.isFinite(value) ? Math.round(value) : 0;
}

function clampMicroseconds(value: number, minimum: number, maximum: number) {
  return clamp(roundMicroseconds(value), minimum, maximum);
}
