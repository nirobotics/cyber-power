import { FileUp, LockKeyhole, Zap } from "lucide-react";

export const meta = () => [{ title: "Cyber Power · Upload WPILOG" }];

export default function PowerAnalyzerRoute() {
  return (
    <section className="mx-auto flex min-h-[calc(100dvh-12rem)] max-w-5xl items-center justify-center px-3 py-8">
      <div className="w-full max-w-3xl">
        <div className="mb-7 flex items-center gap-3">
          <div className="grid size-11 place-items-center rounded-md bg-brand text-brand-fg">
            <Zap className="size-5" aria-hidden />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Analyze robot energy</h1>
            <p className="mt-1 text-sm text-ink-dim">
              Select a WPILOG recorded with NI EnergyLogger.
            </p>
          </div>
        </div>

        <label className="card group grid min-h-72 cursor-pointer place-items-center border-dashed p-8 text-center transition hover:border-brand focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/30">
          <input className="sr-only" type="file" accept=".wpilog" />
          <span className="grid gap-4">
            <span className="mx-auto grid size-14 place-items-center rounded-md border border-line bg-surface-2 text-brand">
              <FileUp className="size-6" aria-hidden />
            </span>
            <span>
              <span className="block text-base font-semibold text-ink">Drop a .wpilog file here</span>
              <span className="mt-1 block text-sm text-ink-dim">or click to browse</span>
            </span>
            <span className="mx-auto inline-flex items-center gap-2 text-xs text-ink-faint">
              <LockKeyhole className="size-3.5" aria-hidden />
              Local analysis · file never uploaded
            </span>
          </span>
        </label>
      </div>
    </section>
  );
}
