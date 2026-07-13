import { useCallback, useEffect, useRef, useState } from "react";
import type { AnalysisResult, LogIssue } from "../log-analysis/core";
import { AnalysisDashboard } from "./analysis-dashboard";
import { FileDropZone } from "./file-drop-zone";

type WorkerResponse =
  | { type: "progress"; requestId: string; processedBytes: number; totalBytes?: number }
  | { type: "result"; requestId: string; result: AnalysisResult }
  | { type: "error"; requestId: string; error: { name: string; message: string; issues?: LogIssue[] } };

export type AnalysisWorkspaceChrome = {
  fileName: string;
  onReplace: () => void;
};

export function analysisWorkspacePageTitle(hasAnalysis: boolean) {
  return hasAnalysis ? null : "cyber-power";
}

export function AnalysisWorkspace({
  onChromeChange,
}: {
  onChromeChange?: (chrome: AnalysisWorkspaceChrome | null) => void;
}) {
  const workerRef = useRef<Worker | null>(null);
  const requestRef = useRef<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ ratio: 0, message: "正在准备解析器…" });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => workerRef.current?.terminate(), []);

  useEffect(() => {
    const title = analysisWorkspacePageTitle(result !== null);
    if (title) document.title = title;
  }, [result]);

  const replace = useCallback(() => {
    const requestId = requestRef.current;
    if (requestId) workerRef.current?.postMessage({ type: "cancel", requestId });
    workerRef.current?.terminate();
    workerRef.current = null;
    requestRef.current = null;
    setBusy(false);
    setFile(null);
    setResult(null);
    setError(null);
    setProgress({ ratio: 0, message: "正在准备解析器…" });
  }, []);

  useEffect(() => {
    onChromeChange?.(file ? { fileName: file.name, onReplace: replace } : null);
  }, [file, onChromeChange, replace]);

  useEffect(() => () => onChromeChange?.(null), [onChromeChange]);

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
    setProgress({ ratio: 0, message: "正在验证 WPILOG 文件头…" });

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (message.requestId !== requestRef.current) return;
      if (message.type === "progress") {
        const total = message.totalBytes ?? nextFile.size;
        const ratio = total > 0 ? message.processedBytes / total : 0;
        setProgress({
          ratio: Math.max(0, Math.min(1, ratio)),
          message:
            ratio < 0.12
              ? "正在读取字段目录…"
              : ratio < 0.92
                ? "正在解码 EnergyLogger 序列…"
                : "正在计算能量指标…",
        });
        return;
      }
      setBusy(false);
      if (message.type === "result") {
        setProgress({ ratio: 1, message: "分析完成" });
        setResult(message.result);
        return;
      }
      if (message.error.name !== "AbortError") {
        setError("无法解析此日志，请确认文件完整且符合 NI EnergyLogger 数据契约。");
      }
    };

    worker.onerror = () => {
      if (requestId !== requestRef.current) return;
      setBusy(false);
      setError("日志分析线程意外停止，请重试。");
    };

    worker.postMessage({ type: "analyze", requestId, file: nextFile });
  };

  if (file && result) return <AnalysisDashboard result={result} />;
  return <FileDropZone busy={busy} progress={progress} error={error} onFile={analyze} />;
}

function validateFile(file: File) {
  if (!file.name.toLowerCase().endsWith(".wpilog")) {
    return "请选择扩展名为 .wpilog 的文件。";
  }
  if (file.size < 12) return "文件太小，无法包含有效的 WPILOG 文件头。";
  if (file.size > 1024 * 1024 * 1024) {
    return "浏览器暂不支持大于 1 GiB 的文件。";
  }
  return null;
}
