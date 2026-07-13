import { Bot, Network, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AnalysisResult, TimeRange } from "../log-analysis/core";
import { analyzeEnergyRange } from "../log-analysis/core";
import { DataQualityDetails } from "./data-quality-details";
import { RobotTimeline, SubsystemTimelines, type TimelineFocus } from "./energy-timeline";
import { FloatingTimeRange } from "./floating-time-range";
import { MetricsRail } from "./metrics-rail";
import { SubsystemShare } from "./subsystem-share";
import { SubsystemTable } from "./subsystem-table";
import { selectDefaultTimeRange } from "./time-range";

type DashboardTab = "robot" | "subsystems" | "quality";

const TABS = [
  { value: "robot", label: "整机", Icon: Bot },
  { value: "subsystems", label: "子系统", Icon: Network },
  { value: "quality", label: "数据质量", Icon: ShieldCheck },
] as const;

export function dashboardPageTitle(tab: DashboardTab) {
  return `${TABS.find(({ value }) => value === tab)?.label ?? "整机"} | cyber-power`;
}

export function AnalysisDashboard({ result }: { result: AnalysisResult }) {
  const { dataset } = result;
  const initialRange = selectDefaultTimeRange(
    {
      startUs: Math.round(result.range.range.startUs),
      endUs: Math.round(result.range.range.endUs),
    },
    dataset.segments.modes,
  );
  const [tab, setTab] = useState<DashboardTab>("robot");
  const [committedRange, setCommittedRange] = useState<TimeRange>(() => ({
    startUs: initialRange.startUs,
    endUs: initialRange.endUs,
  }));
  const [previewRange, setPreviewRange] = useState<TimeRange>(() => ({
    startUs: initialRange.startUs,
    endUs: initialRange.endUs,
  }));
  const [cursorUs, setCursorUs] = useState(() => Math.round((initialRange.startUs + initialRange.endUs) / 2));
  const [transientCursorUs, setTransientCursorUs] = useState<number | null>(null);
  const [focus, setFocus] = useState<TimelineFocus>(null);
  const [hiddenSubsystemIds, setHiddenSubsystemIds] = useState<Set<string>>(() => new Set());
  const previewRangeRef = useRef(previewRange);
  const cursorUsRef = useRef(cursorUs);
  const cursorFrameRef = useRef<number | null>(null);
  const pendingCursorUsRef = useRef<number | null>(null);
  const transientCursorUsRef = useRef<number | null>(null);
  const transientCursorFrameRef = useRef<number | null>(null);
  const pendingTransientCursorUsRef = useRef<number | null>(null);
  const analysis = useMemo(
    () => analyzeEnergyRange(dataset, committedRange),
    [committedRange, dataset],
  );

  useEffect(() => {
    document.title = dashboardPageTitle(tab);
  }, [tab]);

  const clampRange = useCallback((range: TimeRange) => {
    const startUs = Math.max(
      dataset.bounds.energyStartUs,
      Math.min(dataset.bounds.energyEndUs, Math.round(range.startUs)),
    );
    const endUs = Math.max(
      startUs,
      Math.min(dataset.bounds.energyEndUs, Math.round(range.endUs)),
    );
    return { startUs, endUs };
  }, [dataset.bounds.energyEndUs, dataset.bounds.energyStartUs]);

  const cancelPendingCursorPreview = useCallback(() => {
    if (transientCursorFrameRef.current !== null) cancelFrame(transientCursorFrameRef.current);
    transientCursorFrameRef.current = null;
    pendingTransientCursorUsRef.current = null;
  }, []);

  const clearCursorPreview = useCallback(() => {
    cancelPendingCursorPreview();
    if (transientCursorUsRef.current === null) return;
    transientCursorUsRef.current = null;
    setTransientCursorUs(null);
  }, [cancelPendingCursorPreview]);

  const preview = useCallback((range: TimeRange) => {
    clearCursorPreview();
    const next = clampRange(range);
    previewRangeRef.current = next;
    if (pendingCursorUsRef.current !== null) {
      pendingCursorUsRef.current = clampTimestampUs(pendingCursorUsRef.current, next);
    }
    const nextCursorUs = clampTimestampUs(cursorUsRef.current, next);
    if (nextCursorUs !== cursorUsRef.current) {
      cursorUsRef.current = nextCursorUs;
      setCursorUs(nextCursorUs);
      setFocus(null);
    }
    setPreviewRange(next);
  }, [clampRange, clearCursorPreview]);

  const cancelPendingCursor = useCallback(() => {
    if (cursorFrameRef.current !== null) cancelFrame(cursorFrameRef.current);
    cursorFrameRef.current = null;
    pendingCursorUsRef.current = null;
  }, []);

  useEffect(() => () => {
    cancelPendingCursor();
    cancelPendingCursorPreview();
  }, [cancelPendingCursor, cancelPendingCursorPreview]);

  const commit = useCallback((range: TimeRange) => {
    cancelPendingCursor();
    clearCursorPreview();
    const next = clampRange(range);
    const nextCursorUs = clampTimestampUs(cursorUsRef.current, next);
    previewRangeRef.current = next;
    cursorUsRef.current = nextCursorUs;
    setPreviewRange(next);
    setCommittedRange(next);
    setCursorUs(nextCursorUs);
    setFocus(null);
  }, [cancelPendingCursor, clampRange, clearCursorPreview]);

  const previewCursor = useCallback((nextUs: number | null) => {
    if (nextUs === null) {
      clearCursorPreview();
      return;
    }
    if (!Number.isFinite(nextUs)) return;
    pendingTransientCursorUsRef.current = clampTimestampUs(nextUs, previewRangeRef.current);
    if (transientCursorFrameRef.current !== null) return;

    transientCursorFrameRef.current = requestFrame(() => {
      transientCursorFrameRef.current = null;
      const pendingCursorUs = pendingTransientCursorUsRef.current;
      pendingTransientCursorUsRef.current = null;
      if (pendingCursorUs === null) return;
      const clampedCursorUs = clampTimestampUs(pendingCursorUs, previewRangeRef.current);
      setFocus(null);
      if (clampedCursorUs === transientCursorUsRef.current) return;
      transientCursorUsRef.current = clampedCursorUs;
      setTransientCursorUs(clampedCursorUs);
    });
  }, [clearCursorPreview]);

  const commitCursorNow = useCallback((nextUs: number) => {
    if (!Number.isFinite(nextUs)) return;
    cancelPendingCursor();
    clearCursorPreview();
    const nextCursorUs = clampTimestampUs(nextUs, previewRangeRef.current);
    cursorUsRef.current = nextCursorUs;
    setFocus(null);
    setCursorUs(nextCursorUs);
  }, [cancelPendingCursor, clearCursorPreview]);

  const moveCursor = useCallback((nextUs: number) => {
    if (!Number.isFinite(nextUs)) return;
    clearCursorPreview();
    const nextCursorUs = clampTimestampUs(nextUs, previewRangeRef.current);
    if (nextCursorUs === cursorUsRef.current && pendingCursorUsRef.current === null) return;
    pendingCursorUsRef.current = nextCursorUs;
    if (cursorFrameRef.current !== null) return;

    cursorFrameRef.current = requestFrame(() => {
      cursorFrameRef.current = null;
      const pendingCursorUs = pendingCursorUsRef.current;
      pendingCursorUsRef.current = null;
      if (pendingCursorUs === null) return;

      const clampedCursorUs = clampTimestampUs(pendingCursorUs, previewRangeRef.current);
      if (clampedCursorUs === cursorUsRef.current) return;
      cursorUsRef.current = clampedCursorUs;
      setFocus(null);
      setCursorUs(clampedCursorUs);
    });
  }, [clearCursorPreview]);

  const locatePeak = useCallback((kind: Exclude<TimelineFocus, null>) => {
    cancelPendingCursor();
    clearCursorPreview();
    const peakTimestampUs = kind === "power"
      ? analysis.totals.peakPowerTimestampUs
      : analysis.totals.peakCurrentTimestampUs;
    const timestampUs = clampTimestampUs(peakTimestampUs, previewRangeRef.current);
    cursorUsRef.current = timestampUs;
    setCursorUs(timestampUs);
    setFocus(kind);
  }, [analysis.totals.peakCurrentTimestampUs, analysis.totals.peakPowerTimestampUs, cancelPendingCursor, clearCursorPreview]);

  const displayedCursorUs = transientCursorUs ?? cursorUs;

  const toggleSubsystem = useCallback((id: string) => {
    setHiddenSubsystemIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  return (
    <div className="-mx-2.5 -mt-2.5">
      <header className="border-b border-line bg-surface">
        <nav className="mx-auto flex w-full max-w-[1680px] gap-1 overflow-x-auto px-3 py-2" aria-label="分析导航" role="tablist">
          {TABS.map(({ value, label, Icon }, index) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              onKeyDown={(event) => {
                if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                event.preventDefault();
                const direction = event.key === "ArrowRight" ? 1 : -1;
                const next = TABS[(index + direction + TABS.length) % TABS.length].value;
                setTab(next);
                globalThis.requestAnimationFrame(() => document.getElementById(`analysis-tab-${next}`)?.focus());
              }}
              id={`analysis-tab-${value}`}
              role="tab"
              aria-selected={tab === value}
              aria-controls={`analysis-panel-${value}`}
              tabIndex={tab === value ? 0 : -1}
              className={[
                "inline-flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition",
                tab === value
                  ? "bg-brand text-brand-fg"
                  : "text-ink-dim hover:bg-bg hover:text-ink",
              ].join(" ")}
            >
              <Icon className="size-4" aria-hidden />
              {label}
            </button>
          ))}
        </nav>
      </header>

      <div className="mx-auto grid w-full max-w-[1680px] gap-2.5 px-2.5 py-2.5">
        <section className="card overflow-hidden">
          <MetricsRail
            analysis={analysis}
            onLocatePeakPower={() => locatePeak("power")}
            onLocatePeakCurrent={() => locatePeak("current")}
          />
        </section>

        {tab === "robot" ? (
          <div id="analysis-panel-robot" role="tabpanel" aria-labelledby="analysis-tab-robot">
            <RobotTimeline
              dataset={dataset}
              range={previewRange}
              cursorUs={displayedCursorUs}
              cursorPreviewActive={transientCursorUs !== null}
              focus={focus}
              onCursorPreview={previewCursor}
              onCursorCommit={commitCursorNow}
            />
          </div>
        ) : null}

        {tab === "subsystems" ? (
          <div
            id="analysis-panel-subsystems"
            role="tabpanel"
            aria-labelledby="analysis-tab-subsystems"
            className="grid gap-2.5"
          >
            <SubsystemShare dataset={dataset} analysis={analysis} />
            <SubsystemTimelines
              dataset={dataset}
              range={previewRange}
              cursorUs={displayedCursorUs}
              cursorPreviewActive={transientCursorUs !== null}
              hiddenSubsystemIds={hiddenSubsystemIds}
              onCursorPreview={previewCursor}
              onCursorCommit={commitCursorNow}
              onToggleSubsystem={toggleSubsystem}
            />
            <SubsystemTable dataset={dataset} analysis={analysis} />
          </div>
        ) : null}

        {tab === "quality" ? (
          <div id="analysis-panel-quality" role="tabpanel" aria-labelledby="analysis-tab-quality">
            <DataQualityDetails dataset={dataset} />
          </div>
        ) : null}

        {tab === "robot" || tab === "subsystems" ? (
          <FloatingTimeRange
            dataset={dataset}
            range={previewRange}
            cursorUs={cursorUs}
            onPreviewRange={preview}
            onCommitRange={commit}
            onCursorChange={moveCursor}
          />
        ) : null}
      </div>
    </div>
  );
}

function clampTimestampUs(timestampUs: number, range: TimeRange) {
  return Math.max(range.startUs, Math.min(range.endUs, Math.round(timestampUs)));
}

function requestFrame(callback: FrameRequestCallback) {
  if (typeof globalThis.requestAnimationFrame === "function") {
    return globalThis.requestAnimationFrame(callback);
  }
  return globalThis.setTimeout(() => callback(Date.now()), 16) as unknown as number;
}

function cancelFrame(frame: number) {
  if (typeof globalThis.cancelAnimationFrame === "function") {
    globalThis.cancelAnimationFrame(frame);
    return;
  }
  globalThis.clearTimeout(frame);
}
