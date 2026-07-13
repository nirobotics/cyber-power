import { CheckCircle2, ChevronRight, Info, TriangleAlert } from "lucide-react";
import type { EnergyLogDataset } from "../log-analysis/core";
import { localizeLogIssue } from "./issue-localization";

export function QualityPanel({
  dataset,
  onOpen,
}: {
  dataset: EnergyLogDataset;
  onOpen: () => void;
}) {
  const issues = dataset.quality.issues;
  const primary = issues[0];
  const recovered = dataset.file.truncatedTail;
  const primaryDescription = primary ? localizeLogIssue(primary).description : undefined;

  return (
    <section className="card overflow-hidden" aria-labelledby="quality-title">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 id="quality-title" className="text-sm font-semibold text-ink">
          数据质量
        </h2>
        <button
          type="button"
          className="text-ink-dim hover:text-brand"
          onClick={onOpen}
          aria-label="打开数据质量详情"
        >
          <ChevronRight className="size-4" aria-hidden />
        </button>
      </div>
      <button type="button" onClick={onOpen} className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-surface-2">
        {issues.length > 0 || recovered ? (
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
        ) : (
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden />
        )}
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-semibold text-ink">
            {recovered
              ? `已恢复被截断的文件尾部 · 缺少 ${recovered.missingBytes ?? "未知"} 字节`
              : primaryDescription ?? "未发现数据质量警告"}
          </span>
          <span className="mt-1 block text-[11px] leading-relaxed text-ink-dim">
            {recovered
              ? `已保留最后一条完整记录之前的数据；当前共有 ${issues.length} 条数据质量提示。`
              : issues.length > 1
                ? `当前有 ${issues.length} 条数据质量提示需要检查。`
                : primary
                  ? "打开查看完整说明。"
                  : "核心能量字段已通过验证。"}
          </span>
        </span>
        <Info className="mt-0.5 size-3.5 shrink-0 text-ink-faint" aria-hidden />
      </button>
    </section>
  );
}
