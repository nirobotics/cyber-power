import { FileUp, LockKeyhole, TriangleAlert } from "lucide-react";
import { useRef, useState, type DragEvent } from "react";
import { formatBytes } from "./format";

export function FileDropZone({
  busy = false,
  progress,
  error,
  onFile,
}: {
  busy?: boolean;
  progress?: { ratio: number; message: string };
  error?: string | null;
  onFile: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const accept = (file?: File) => {
    if (!file || busy) return;
    onFile(file);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    accept(event.dataTransfer.files.item(0) ?? undefined);
  };

  return (
    <section className="mx-auto flex min-h-[calc(100dvh-12rem)] max-w-5xl items-center justify-center px-3 py-8">
      <div className="w-full max-w-3xl">
        <div className="mb-7">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Analyze robot energy</h1>
          <p className="mt-1.5 text-sm text-ink-dim">
            Select a WPILOG recorded by a robot using NI EnergyLogger.
          </p>
        </div>

        <div
          role="button"
          tabIndex={0}
          aria-busy={busy}
          aria-label="Choose a WPILOG file"
          onClick={() => !busy && inputRef.current?.click()}
          onKeyDown={(event) => {
            if (!busy && (event.key === "Enter" || event.key === " ")) inputRef.current?.click();
          }}
          onDragEnter={(event) => {
            event.preventDefault();
            if (!busy) setDragging(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          className={[
            "card grid min-h-72 place-items-center border-dashed p-8 text-center outline-none transition",
            busy ? "cursor-wait" : "cursor-pointer hover:border-brand focus-visible:ring-2 focus-visible:ring-brand/40",
            dragging ? "border-brand bg-brand/5" : "",
          ].join(" ")}
        >
          <input
            ref={inputRef}
            className="sr-only"
            type="file"
            accept=".wpilog,application/octet-stream"
            disabled={busy}
            onChange={(event) => accept(event.currentTarget.files?.item(0) ?? undefined)}
          />
          <div className="grid w-full max-w-md gap-4">
            <span className="mx-auto grid size-14 place-items-center rounded-md border border-line bg-surface-2 text-brand">
              <FileUp className="size-6" aria-hidden />
            </span>
            <div aria-live="polite">
              <p className="text-base font-semibold text-ink">
                {busy ? progress?.message ?? "Reading WPILOG…" : "Drop a .wpilog file here"}
              </p>
              <p className="mt-1 text-sm text-ink-dim">
                {busy ? `${formatNumberSafe((progress?.ratio ?? 0) * 100)}%` : "or click to browse"}
              </p>
            </div>
            {busy ? (
              <div
                className="h-1.5 overflow-hidden rounded-full bg-surface-2"
                role="progressbar"
                aria-label={progress?.message ?? "Analyzing WPILOG"}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round((progress?.ratio ?? 0) * 100)}
              >
                <div
                  className="h-full rounded-full bg-brand transition-[width] duration-200"
                  style={{ width: `${Math.max(2, Math.min(100, (progress?.ratio ?? 0) * 100))}%` }}
                />
              </div>
            ) : null}
            <p className="mx-auto inline-flex items-center gap-2 text-xs text-ink-faint">
              <LockKeyhole className="size-3.5" aria-hidden />
              Local analysis · file never uploaded
            </p>
          </div>
        </div>

        {error ? (
          <div className="mt-4 flex items-start gap-3 rounded-md border border-danger/40 bg-danger/5 px-4 py-3 text-sm text-danger" role="alert">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{error}</span>
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap justify-between gap-2 text-xs text-ink-faint">
          <span>WPILOG 1.0 · EnergyLogger contract required</span>
          <span>Recommended maximum: {formatBytes(512 * 1024 * 1024)}</span>
        </div>
      </div>
    </section>
  );
}

function formatNumberSafe(value: number) {
  return Number.isFinite(value) ? value.toFixed(0) : "0";
}
