import { CheckCircle2, CircleAlert, FileCheck2, TriangleAlert } from "lucide-react";
import type { EnergyLogDataset } from "../log-analysis/core";
import { formatBytes, formatNumber } from "./format";
import { localizeLogIssue } from "./issue-localization";

export function DataQualityDetails({ dataset }: { dataset: EnergyLogDataset }) {
  const issues = dataset.quality.issues;
  const v2 = dataset.v2;
  const v2MotorCount = v2?.subsystems.reduce(
    (count, subsystem) => count + subsystem.motors.length,
    0,
  );

  return (
    <div className="grid gap-3 lg:grid-cols-[20rem_minmax(0,1fr)]">
      <aside className="card h-fit overflow-hidden">
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <FileCheck2 className="size-4 text-brand" aria-hidden />
          <h2 className="text-sm font-semibold text-ink">可信日志范围</h2>
        </div>
        <dl className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-3 px-4 py-4 text-xs">
          <dt className="text-ink-dim">WPILOG 版本</dt>
          <dd className="min-w-0 text-left font-mono text-ink">
            {dataset.header.majorVersion}.{dataset.header.minorVersion}
          </dd>
          <dt className="text-ink-dim">额外头信息</dt>
          <dd
            className="min-w-0 truncate text-left font-mono text-ink"
            title={dataset.header.extraHeader}
          >
            {dataset.header.extraHeader || "—"}
          </dd>
          <dt className="text-ink-dim">文件大小</dt>
          <dd className="min-w-0 truncate text-left font-mono text-ink">
            {formatBytes(dataset.file.sizeBytes)}
          </dd>
          <dt className="text-ink-dim">完整记录数</dt>
          <dd className="min-w-0 truncate text-left font-mono text-ink">
            {formatNumber(dataset.file.recordCount, 0)}
          </dd>
          <dt className="text-ink-dim">最后可信字节</dt>
          <dd className="min-w-0 truncate text-left font-mono text-ink">
            {formatNumber(dataset.file.lastGoodOffset, 0)}
          </dd>
          <dt className="text-ink-dim">能量根路径</dt>
          <dd className="min-w-0 truncate text-left font-mono text-ink" title={dataset.root}>
            {dataset.root}
          </dd>
          <dt className="text-ink-dim">解析位置</dt>
          <dd className="min-w-0 text-left text-ink">本地浏览器</dd>
          {v2 ? (
            <>
              <dt className="text-ink-dim">EnergyLogger 契约</dt>
              <dd className="min-w-0 text-left font-mono text-ink">
                {v2.contract.contractVersion}
              </dd>
              <dt className="text-ink-dim">记录库版本</dt>
              <dd className="min-w-0 truncate text-left font-mono text-ink">
                {v2.contract.libraryVersion}
              </dd>
              <dt className="text-ink-dim">子系统数量</dt>
              <dd className="min-w-0 text-left font-mono text-ink">
                {formatNumber(v2.subsystems.length, 0)}
              </dd>
              <dt className="text-ink-dim">电机数量</dt>
              <dd className="min-w-0 text-left font-mono text-ink">
                {formatNumber(v2MotorCount, 0)}
              </dd>
              <dt className="text-ink-dim">整机指标口径</dt>
              <dd className="min-w-0 text-left text-ink">
                已注册电机合计电流 × 电池电压
              </dd>
              <dt className="text-ink-dim">Stator Current 语义</dt>
              <dd className="min-w-0 text-left text-ink">
                {v2.contract.contractVersion === "2.3"
                  ? "带符号（驱动 / 再生制动；后者不代表电池净回充）"
                  : "无符号幅值"}
              </dd>
            </>
          ) : null}
        </dl>
      </aside>

      <section className="card overflow-hidden">
        {issues.length === 0 ? (
          <div className="flex items-start gap-3 px-4 py-5">
            <CheckCircle2 className="mt-0.5 size-4 text-ok" aria-hidden />
            <div>
              <p className="text-sm font-semibold text-ink">未发现警告</p>
              <p className="mt-1 text-xs text-ink-dim">
                {v2
                  ? `已验证 EnergyLogger ${v2.contract.contractVersion} 固定字段、Manifest 与电机样本。`
                  : "已验证必需的总量字段和至少一组完整的动态子系统字段。"}
              </p>
            </div>
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {issues.map((issue, index) => {
              const localized = localizeLogIssue(issue);
              return (
                <li
                  key={`${issue.code}-${index}`}
                  className="flex items-start gap-3 px-4 py-3"
                >
                  {issue.severity === "warning" ? (
                    <TriangleAlert
                      className="mt-0.5 size-4 shrink-0 text-warn"
                      aria-hidden
                    />
                  ) : (
                    <CircleAlert
                      className="mt-0.5 size-4 shrink-0 text-danger"
                      aria-hidden
                    />
                  )}
                  <div className="min-w-0">
                    <p className="text-xs leading-relaxed text-ink">
                      {localized.description}
                    </p>
                    {localized.context.length > 0 ? (
                      <p className="mt-1 break-all font-mono text-[10px] leading-relaxed text-ink-dim">
                        {localized.context.join(" · ")}
                      </p>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
