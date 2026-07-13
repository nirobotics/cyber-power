import type { LogIssue, LogIssueCode } from "../log-analysis/core";

const ISSUE_DESCRIPTIONS: Record<LogIssueCode, string> = {
  INVALID_WPILOG: "文件不是有效的 WPILOG，或文件头不完整。",
  UNSUPPORTED_VERSION: "WPILOG 版本不受支持。",
  CORRUPT_RECORD_MIDDLE: "文件中部存在损坏记录，无法保证后续数据可信。",
  TRUNCATED_TAIL_RECOVERED:
    "文件尾部记录不完整，已保留最后一条完整记录之前的可信数据。",
  MISSING_ENERGY_TOTALS: "缺少必需的总电流、总功率或总能量字段。",
  MISSING_COMPLETE_DYNAMIC_SERIES:
    "未找到同时包含电流、功率和能量的完整子系统字段组。",
  ENERGY_TYPE_MISMATCH: "必需的能量字段类型不是 double。",
  NO_FINITE_ENERGY_DATA: "能量字段中没有可用于分析的有限数值样本。",
  AMBIGUOUS_ENERGY_ROOT: "检测到多个可用的能量根路径，无法唯一确定分析来源。",
  PATH_NORMALIZATION_COLLISION: "多个原始子系统路径规范化后发生冲突。",
  INVALID_DYNAMIC_PATH: "子系统路径包含空段，无法建立层级。",
  UNIT_METADATA_MISSING: "字段缺少单位元数据，已按数据契约继续分析。",
  UNIT_METADATA_MISMATCH: "字段声明的单位与数据契约不一致。",
  OPTIONAL_SERIES_MISSING: "缺少可选字段，相关指标或机器人状态图层不可用。",
  OPTIONAL_TYPE_MISMATCH: "可选字段类型不符合预期，相关指标或机器人状态图层不可用。",
  ENERGY_RESET: "检测到累计能量归零或回退，区间能量已按重置规则累计。",
  TIME_GAP: "能量数据存在较长采样间隔，间隔内趋势精度可能降低。",
  ENERGY_RECONCILIATION_MISMATCH: "总能量与对应子系统能量之和超出允许误差。",
  NEGATIVE_VALUE: "检测到负数值样本，请核对记录来源。",
  NONFINITE_VALUE_DROPPED: "已丢弃非有限数值样本。",
  SIM_OR_REPLAY_LOG: "当前日志来自仿真或回放根路径，仍按相同数据契约分析。",
  PARTIAL_SUBSERIES: "子系统缺少电流、功率或能量字段，未纳入子系统分析。",
};

function detailText(value: unknown): string | undefined {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(String).join(", ");
  return undefined;
}

export function localizeLogIssue(issue: LogIssue): {
  description: string;
  context: string[];
} {
  const context: string[] = [];
  if (issue.entryName) context.push(`字段：${issue.entryName}`);

  const rawPath = detailText(issue.details?.rawPath);
  const root = detailText(issue.details?.root);
  const missing = detailText(issue.details?.missing);
  const expected = detailText(issue.details?.expected);
  const actual = detailText(issue.details?.actual);
  const count = detailText(
    issue.details?.count ?? issue.details?.resetCount ?? issue.details?.gapCount,
  );

  if (rawPath) context.push(`路径：${rawPath}`);
  if (root) context.push(`根路径：${root}`);
  if (missing) context.push(`缺失字段：${missing}`);
  if (expected) context.push(`期望单位：${expected}`);
  if (actual) context.push(`实际单位：${actual}`);
  if (count) context.push(`数量：${count}`);

  return { description: ISSUE_DESCRIPTIONS[issue.code], context };
}
