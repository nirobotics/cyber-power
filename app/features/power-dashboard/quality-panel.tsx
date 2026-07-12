import { CheckCircle2, ChevronRight, Info, TriangleAlert } from "lucide-react";
import type { EnergyLogDataset } from "../log-analysis/core";

export function QualityPanel({
  dataset,
  onOpen,
}: {
  dataset: EnergyLogDataset;
  onOpen: () => void;
}) {
  const warnings = dataset.quality.issues;
  const primary = warnings[0];
  const recovered = dataset.file.truncatedTail;

  return (
    <section className="card overflow-hidden" aria-labelledby="quality-title">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 id="quality-title" className="text-sm font-semibold text-ink">Data Quality</h2>
        <button type="button" className="text-ink-dim hover:text-brand" onClick={onOpen} aria-label="Open data quality details">
          <ChevronRight className="size-4" aria-hidden />
        </button>
      </div>
      <button type="button" onClick={onOpen} className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-surface-2">
        {warnings.length > 0 || recovered ? (
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
        ) : (
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden />
        )}
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-semibold text-ink">
            {recovered
              ? `Recovered truncated tail · ${recovered.missingBytes ?? "unknown"} bytes`
              : primary?.message ?? "No data quality warnings"}
          </span>
          <span className="mt-1 block text-[11px] leading-relaxed text-ink-dim">
            {recovered
              ? "The log ended unexpectedly after the last complete record. Trusted data was preserved."
              : warnings.length > 1
                ? `${warnings.length} warnings require review.`
                : "Core EnergyLogger series passed validation."}
          </span>
        </span>
        <Info className="mt-0.5 size-3.5 shrink-0 text-ink-faint" aria-hidden />
      </button>
    </section>
  );
}
