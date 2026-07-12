import { useEffect, useRef, useState } from "react";
import type { AnalysisResult, LogIssue } from "../log-analysis/core";
import { AnalysisDashboard } from "./analysis-dashboard";
import { FileDropZone } from "./file-drop-zone";

type WorkerResponse =
  | { type: "progress"; requestId: string; processedBytes: number; totalBytes?: number }
  | { type: "result"; requestId: string; result: AnalysisResult }
  | { type: "error"; requestId: string; error: { name: string; message: string; issues?: LogIssue[] } };

export function AnalysisWorkspace() {
  const workerRef = useRef<Worker | null>(null);
  const requestRef = useRef<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ ratio: 0, message: "Preparing parser…" });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => workerRef.current?.terminate(), []);

  const analyze = (nextFile: File) => {
    const validationError = validateFile(nextFile);
    if (validationError) {
      setError(validationError);
      return;
    }

    workerRef.current?.terminate();
    const worker = new Worker(
      new URL("../log-analysis/workers/log-analysis.worker.ts", import.meta.url),
      { type: "module", name: "cyber-power-log-analysis" },
    );
    const requestId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    workerRef.current = worker;
    requestRef.current = requestId;
    setFile(nextFile);
    setResult(null);
    setError(null);
    setBusy(true);
    setProgress({ ratio: 0, message: "Validating WPILOG header…" });

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (message.requestId !== requestRef.current) return;
      if (message.type === "progress") {
        const total = message.totalBytes ?? nextFile.size;
        const ratio = total > 0 ? message.processedBytes / total : 0;
        setProgress({
          ratio: Math.max(0, Math.min(1, ratio)),
          message: ratio < 0.12 ? "Reading entry catalog…" : ratio < 0.92 ? "Decoding EnergyLogger series…" : "Computing energy metrics…",
        });
        return;
      }
      setBusy(false);
      if (message.type === "result") {
        setProgress({ ratio: 1, message: "Analysis complete" });
        setResult(message.result);
        return;
      }
      if (message.error.name !== "AbortError") {
        const issue = message.error.issues?.find((candidate) => candidate.severity === "fatal");
        setError(issue ? `${issue.code}: ${issue.message}` : message.error.message);
      }
    };

    worker.onerror = (event) => {
      if (requestId !== requestRef.current) return;
      setBusy(false);
      setError(event.message || "The log analysis worker stopped unexpectedly.");
    };

    worker.postMessage({ type: "analyze", requestId, file: nextFile });
  };

  const replace = () => {
    const requestId = requestRef.current;
    if (requestId) workerRef.current?.postMessage({ type: "cancel", requestId });
    workerRef.current?.terminate();
    workerRef.current = null;
    requestRef.current = null;
    setBusy(false);
    setFile(null);
    setResult(null);
    setError(null);
    setProgress({ ratio: 0, message: "Preparing parser…" });
  };

  if (file && result) return <AnalysisDashboard file={file} result={result} onReplace={replace} />;
  return <FileDropZone busy={busy} progress={progress} error={error} onFile={analyze} />;
}

function validateFile(file: File) {
  if (!file.name.toLowerCase().endsWith(".wpilog")) return "INVALID_WPILOG: Select a file with the .wpilog extension.";
  if (file.size < 12) return "INVALID_WPILOG: The file is too small to contain a WPILOG header.";
  if (file.size > 1024 * 1024 * 1024) return "INVALID_WPILOG: Files larger than 1 GiB are not supported in the browser.";
  return null;
}
