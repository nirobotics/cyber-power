import { CheckCircle2, CircleAlert, FileCheck2, TriangleAlert } from "lucide-react";
import type { EnergyLogDataset } from "../log-analysis/core";
import { formatBytes, formatNumber } from "./format";

export function DataQualityDetails({ dataset }: { dataset: EnergyLogDataset }) {
  const warnings = dataset.quality.issues;
  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <section className="card overflow-hidden">
        <div className="border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">Validation report</h2>
          <p className="mt-1 text-xs text-ink-dim">Compatibility is determined only by the EnergyLogger data contract.</p>
        </div>
        {warnings.length === 0 ? (
          <div className="flex items-start gap-3 px-4 py-5">
            <CheckCircle2 className="mt-0.5 size-4 text-ok" aria-hidden />
            <div>
              <p className="text-sm font-semibold text-ink">No warnings</p>
              <p className="mt-1 text-xs text-ink-dim">Required totals and at least one complete dynamic series were validated.</p>
            </div>
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {warnings.map((warning, index) => (
              <li key={`${warning.code}-${index}`} className="flex items-start gap-3 px-4 py-3">
                {warning.severity === "warning" ? (
                  <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
                ) : (
                  <CircleAlert className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
                )}
                <div className="min-w-0">
                  <p className="font-mono text-[10px] font-semibold text-ink-faint">{warning.code}</p>
                  <p className="mt-1 text-xs leading-relaxed text-ink">{warning.message}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <aside className="card h-fit overflow-hidden">
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <FileCheck2 className="size-4 text-brand" aria-hidden />
          <h2 className="text-sm font-semibold text-ink">Trusted log range</h2>
        </div>
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-3 px-4 py-4 text-xs">
          <dt className="text-ink-dim">WPILOG version</dt>
          <dd className="font-mono text-ink">{dataset.header.majorVersion}.{dataset.header.minorVersion}</dd>
          <dt className="text-ink-dim">Extra header</dt>
          <dd className="max-w-40 truncate font-mono text-ink" title={dataset.header.extraHeader}>{dataset.header.extraHeader || "—"}</dd>
          <dt className="text-ink-dim">File size</dt>
          <dd className="font-mono text-ink">{formatBytes(dataset.file.sizeBytes)}</dd>
          <dt className="text-ink-dim">Complete records</dt>
          <dd className="font-mono text-ink">{formatNumber(dataset.file.recordCount, 0)}</dd>
          <dt className="text-ink-dim">Last trusted byte</dt>
          <dd className="font-mono text-ink">{formatNumber(dataset.file.lastGoodOffset, 0)}</dd>
          <dt className="text-ink-dim">Energy root</dt>
          <dd className="max-w-40 truncate font-mono text-ink" title={dataset.root}>{dataset.root}</dd>
        </dl>
      </aside>
    </div>
  );
}
