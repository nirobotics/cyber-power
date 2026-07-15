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
  V2_CONTRACT_INCOMPLETE: "EnergyLogger v2 契约字段不完整。",
  V2_CONTRACT_CHANGED: "EnergyLogger v2 契约描述在日志记录期间发生变化。",
  V2_CONTRACT_VERSION_INVALID: "EnergyLogger v2 契约版本格式无效。",
  V2_CONTRACT_MAJOR_UNSUPPORTED: "EnergyLogger v2 主版本不受支持。",
  V2_LIBRARY_VERSION_INVALID: "EnergyLogger v2 记录器版本无效。",
  V2_MANIFEST_INVALID_JSON: "EnergyLogger v2 清单不是有效 JSON。",
  V2_MANIFEST_INVALID: "EnergyLogger v2 清单结构无效。",
  V2_MANIFEST_DUPLICATE_NAME: "EnergyLogger v2 清单包含重复名称或路径。",
  V2_MANIFEST_INVALID_RATIO: "EnergyLogger v2 减速比无效。",
  V2_MANIFEST_UNKNOWN_MOTOR_TYPE: "EnergyLogger v2 使用了不受支持的电机型号。",
  V2_MANIFEST_INVALID_LEADER: "EnergyLogger v2 Leader/Follower 关系无效。",
  V2_ENTRY_MISSING: "EnergyLogger v2 缺少必需字段或样本。",
  V2_ENTRY_TYPE_MISMATCH: "EnergyLogger v2 字段类型不符合契约。",
  V2_PACKED_WIDTH_MISMATCH: "EnergyLogger v2 数组宽度与设备清单不一致。",
  V2_SAMPLE_TIMESTAMP_INVALID: "EnergyLogger v2 样本时间戳无效。",
  V2_SAMPLE_TIMESTAMP_ROLLBACK: "EnergyLogger v2 样本时间发生回退。",
  V2_FOLLOWER_SLOT_INVALID: "EnergyLogger V2 Follower 的 Stator Current 或原生转速槽不是 NaN。",
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
  const v1EnergyWh = detailText(issue.details?.v1EnergyWh);
  const v2DeviceEnergyWh = detailText(issue.details?.v2DeviceEnergyWh);
  const differenceWh = detailText(issue.details?.differenceWh);

  if (rawPath) context.push(`路径：${rawPath}`);
  if (root) context.push(`根路径：${root}`);
  if (missing) context.push(`缺失字段：${missing}`);
  if (expected) context.push(`期望单位：${expected}`);
  if (actual) context.push(`实际单位：${actual}`);
  if (count) context.push(`数量：${count}`);
  if (v1EnergyWh) context.push(`v1 能量：${v1EnergyWh} Wh`);
  if (v2DeviceEnergyWh) context.push(`v2 设备归因：${v2DeviceEnergyWh} Wh`);
  if (differenceWh) context.push(`差值：${differenceWh} Wh`);

  return { description: ISSUE_DESCRIPTIONS[issue.code], context };
}
