import { Download, FileText, RotateCcw, Upload } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import type { AnalysisResult } from "../log-analysis/core";
import { analyzeEnergyRange } from "../log-analysis/core";
import { DataQualityDetails } from "./data-quality-details";
import { EnergyTimeline } from "./energy-timeline";
import { downloadText, formatBytes, formatDuration, formatNumber } from "./format";
import { MetricsRail } from "./metrics-rail";
import { QualityPanel } from "./quality-panel";
import { SubsystemShare } from "./subsystem-share";
import { SubsystemTable } from "./subsystem-table";

type DashboardTab = "summary" | "timeline" | "subsystems" | "quality";

const TABS = [
  ["summary", "Summary"],
  ["timeline", "Timeline"],
  ["subsystems", "Subsystems"],
  ["quality", "Data Quality"],
] as const;

export function AnalysisDashboard({
  file,
  result,
  onReplace,
}: {
  file: File;
  result: AnalysisResult;
  onReplace: () => void;
}) {
  const { dataset } = result;
  const [tab, setTab] = useState<DashboardTab>("summary");
  const [range, setRange] = useState(() => ({
    startUs: result.range.range.startUs,
    endUs: result.range.range.endUs,
  }));
  const analysis = useMemo(
    () => analyzeEnergyRange(dataset, range),
    [dataset, range],
  );
  const fullRange = dataset.bounds.energyEndUs - dataset.bounds.energyStartUs;
  const setSelectedRange = useCallback((startUs: number, endUs: number) => {
    setRange((current) => {
      if (Math.abs(current.startUs - startUs) < 1 && Math.abs(current.endUs - endUs) < 1) return current;
      return { startUs, endUs };
    });
  }, []);

  const resetRange = () => setRange({
    startUs: dataset.bounds.energyStartUs,
    endUs: dataset.bounds.energyEndUs,
  });

  const exportCsv = () => {
    const header = ["path", "energy_wh", "share_percent", "average_power_w", "peak_power_w", "peak_current_a"];
    const robotRow = [
      csv("Robot total"),
      analysis.totals.energyWh,
      100,
      analysis.totals.averagePowerW,
      analysis.totals.peakPowerW,
      analysis.totals.peakCurrentA,
    ].join(",");
    const rows = analysis.subsystems.map((metric) => {
      const node = dataset.subsystems.find((candidate) => candidate.id === metric.id);
      return [
        csv(node?.rawPath ?? metric.id),
        metric.energyWh,
        metric.share === null ? "" : metric.share * 100,
        metric.averagePowerW,
        metric.peakPowerW,
        metric.peakCurrentA,
      ].join(",");
    });
    const metadata = [
      `# source,${csv(file.name)}`,
      `# range_start_seconds,${analysis.range.startUs / 1_000_000}`,
      `# range_end_seconds,${analysis.range.endUs / 1_000_000}`,
      `# duration_seconds,${analysis.range.durationSeconds}`,
    ];
    downloadText(
      `${file.name.replace(/\.wpilog$/i, "")}-energy.csv`,
      [...metadata, header.join(","), robotRow, ...rows].join("\n"),
    );
  };

  return (
    <div className="mx-auto grid w-full max-w-[1680px] gap-2.5">
      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3">
          <FileText className="size-5 shrink-0 text-brand" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="truncate font-mono text-sm font-semibold text-ink" title={file.name}>{file.name}</p>
            <p className="mt-0.5 text-[11px] text-ink-dim">
              {formatBytes(file.size)} · Local analysis · file never uploaded
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn" onClick={onReplace}>
              <Upload className="size-3.5" aria-hidden /> Replace file
            </button>
            <button type="button" className="btn" onClick={resetRange} disabled={Math.abs(analysis.range.endUs - analysis.range.startUs - fullRange) < 1}>
              <RotateCcw className="size-3.5" aria-hidden /> Reset range
            </button>
            <button type="button" className="btn btn-primary" onClick={exportCsv}>
              <Download className="size-3.5" aria-hidden /> Export CSV
            </button>
          </div>
        </div>

        <nav className="flex gap-1 overflow-x-auto border-t border-line px-3" aria-label="Analysis views" role="tablist">
          {TABS.map(([value, label], index) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              onKeyDown={(event) => {
                if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                event.preventDefault();
                const direction = event.key === "ArrowRight" ? 1 : -1;
                const next = TABS[(index + direction + TABS.length) % TABS.length][0];
                setTab(next);
                globalThis.requestAnimationFrame(() => document.getElementById(`analysis-tab-${next}`)?.focus());
              }}
              id={`analysis-tab-${value}`}
              role="tab"
              aria-selected={tab === value}
              aria-controls={`analysis-panel-${value}`}
              tabIndex={tab === value ? 0 : -1}
              className={[
                "relative shrink-0 px-3 py-3 text-xs font-medium transition",
                tab === value ? "text-brand after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:bg-brand" : "text-ink-dim hover:text-ink",
              ].join(" ")}
            >
              {label}
            </button>
          ))}
        </nav>

        <MetricsRail analysis={analysis} />
      </section>

      {tab === "subsystems" ? (
        <div id="analysis-panel-subsystems" role="tabpanel" aria-labelledby="analysis-tab-subsystems">
          <SubsystemTable dataset={dataset} analysis={analysis} />
        </div>
      ) : null}
      {tab === "quality" ? (
        <div id="analysis-panel-quality" role="tabpanel" aria-labelledby="analysis-tab-quality">
          <DataQualityDetails dataset={dataset} />
        </div>
      ) : null}
      {tab === "summary" || tab === "timeline" ? (
        <div
          id={`analysis-panel-${tab}`}
          role="tabpanel"
          aria-labelledby={`analysis-tab-${tab}`}
          className={tab === "timeline" ? "grid gap-2.5" : "grid gap-2.5 xl:grid-cols-[minmax(0,1fr)_24rem]"}
        >
          <section className="card min-w-0 overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold text-ink">Time Series</h2>
                <p className="mt-0.5 font-mono text-[10px] text-ink-faint">
                  {formatDuration((analysis.range.endUs - analysis.range.startUs) / 1_000_000)} selected · cursor and range share log time
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-[10px] text-ink-dim">
                <span className="inline-flex items-center gap-1.5"><span className="size-2 bg-brand/40" />Auto</span>
                <span className="inline-flex items-center gap-1.5"><span className="size-2 bg-ok/30" />{dataset.series.teleop ? "Teleop" : "Enabled"}</span>
                <span className="inline-flex items-center gap-1.5"><span className="size-2 border border-danger bg-danger/25" />Brownout</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-2 w-4 border border-dashed border-ink-faint" />Drag cursor / range handles</span>
              </div>
            </div>
            <EnergyTimeline dataset={dataset} analysis={analysis} onRangeChange={setSelectedRange} />
          </section>

          {tab === "summary" ? (
            <aside className="grid content-start gap-2.5">
              <SubsystemShare dataset={dataset} analysis={analysis} onOpenTable={() => setTab("subsystems")} />
              <QualityPanel dataset={dataset} onOpen={() => setTab("quality")} />
              <section className="card px-4 py-3 text-xs text-ink-dim">
                <p className="font-semibold text-ink">Selection</p>
                <RangeEditor
                  key={`${analysis.range.startUs}-${analysis.range.endUs}`}
                  startUs={analysis.range.startUs}
                  endUs={analysis.range.endUs}
                  minimumUs={dataset.bounds.energyStartUs}
                  maximumUs={dataset.bounds.energyEndUs}
                  onChange={setSelectedRange}
                />
                <p className="mt-1">Brownout time {formatNumber(analysis.totals.brownoutDurationSeconds, 3)}s · Enabled {formatNumber(analysis.totals.enabledDurationSeconds, 3)}s</p>
              </section>
            </aside>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function csv(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function RangeEditor({
  startUs,
  endUs,
  minimumUs,
  maximumUs,
  onChange,
}: {
  startUs: number;
  endUs: number;
  minimumUs: number;
  maximumUs: number;
  onChange: (startUs: number, endUs: number) => void;
}) {
  const [start, setStart] = useState(() => (startUs / 1_000_000).toFixed(3));
  const [end, setEnd] = useState(() => (endUs / 1_000_000).toFixed(3));

  const commit = () => {
    const nextStartUs = Math.max(minimumUs, Math.min(maximumUs, Number(start) * 1_000_000));
    const nextEndUs = Math.max(minimumUs, Math.min(maximumUs, Number(end) * 1_000_000));
    if (Number.isFinite(nextStartUs) && Number.isFinite(nextEndUs) && nextEndUs >= nextStartUs) {
      onChange(nextStartUs, nextEndUs);
      return;
    }
    setStart((startUs / 1_000_000).toFixed(3));
    setEnd((endUs / 1_000_000).toFixed(3));
  };

  return (
    <div className="mt-2 grid grid-cols-2 gap-2">
      <label className="grid gap-1 text-[10px] text-ink-faint">
        Start (s)
        <input
          className="w-full rounded border border-line bg-surface-2 px-2 py-1.5 font-mono text-xs text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
          inputMode="decimal"
          value={start}
          onChange={(event) => setStart(event.currentTarget.value)}
          onBlur={commit}
          onKeyDown={(event) => { if (event.key === "Enter") commit(); }}
        />
      </label>
      <label className="grid gap-1 text-[10px] text-ink-faint">
        End (s)
        <input
          className="w-full rounded border border-line bg-surface-2 px-2 py-1.5 font-mono text-xs text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
          inputMode="decimal"
          value={end}
          onChange={(event) => setEnd(event.currentTarget.value)}
          onBlur={commit}
          onKeyDown={(event) => { if (event.key === "Enter") commit(); }}
        />
      </label>
    </div>
  );
}
