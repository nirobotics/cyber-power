import type {
  EnergyLogDataset,
  RangeAnalysis,
  SupplyCurrentLimitInput,
  SupplyLimitValidationIssue,
} from "../log-analysis/core";
import {
  parseSupplyLimitDraftValue,
  type SupplyLimitDisplayError,
  type SupplyLimitDraft,
  type SupplyLimitTargetOption,
} from "./supply-limit-simulator";

export function buildSupplyLimitTargetOptions(
  dataset: EnergyLogDataset,
  analysis: RangeAnalysis,
): SupplyLimitTargetOption[] {
  const metricsById = new Map(analysis.subsystems.map((metric) => [metric.id, metric]));

  return dataset.subsystems.map((node) => {
    const metric = metricsById.get(node.id);
    const unavailableReason = missingSeriesReason(node);
    return {
      id: node.id,
      rawPath: node.rawPath,
      parentId: node.parentId,
      depth: node.depth,
      childrenIds: node.childrenIds,
      peakCurrentA: metric?.peakCurrentA ?? 0,
      energyWh: metric?.energyWh ?? 0,
      ...(unavailableReason ? { unavailableReason } : {}),
    };
  });
}

export function supplyLimitDraftsToInputs(drafts: readonly SupplyLimitDraft[]): {
  inputs: SupplyCurrentLimitInput[];
  errors: SupplyLimitDisplayError[];
} {
  const inputs: SupplyCurrentLimitInput[] = [];
  const errors: SupplyLimitDisplayError[] = [];

  for (const draft of drafts) {
    if (!draft.enabled) continue;
    const limitA = parseSupplyLimitDraftValue(draft.limitText);
    if (limitA === null) {
      errors.push({ nodeId: draft.nodeId, message: "请输入大于或等于 0 的有限电流值。" });
      continue;
    }
    inputs.push({
      nodeId: draft.nodeId,
      limitA,
      aggregateConfirmed: draft.aggregateConfirmed,
      enabled: true,
    });
  }

  if (inputs.length === 0 && errors.length === 0) {
    errors.push({ message: "请至少启用一个限流目标。" });
  }
  return { inputs, errors };
}

export function supplyLimitInputsToDrafts(
  inputs: readonly SupplyCurrentLimitInput[],
): SupplyLimitDraft[] {
  return inputs
    .filter((input) => input.enabled !== false)
    .map((input) => ({
      nodeId: input.nodeId,
      enabled: true,
      limitText: String(input.limitA),
      aggregateConfirmed: input.aggregateConfirmed === true,
    }));
}

export function supplyLimitDraftsMatchInputs(
  drafts: readonly SupplyLimitDraft[],
  inputs: readonly SupplyCurrentLimitInput[],
): boolean {
  const activeDrafts = drafts.filter((draft) => draft.enabled);
  const activeInputs = inputs.filter((input) => input.enabled !== false);
  if (activeDrafts.length === 0 && activeInputs.length === 0) return true;
  const normalizedDrafts = supplyLimitDraftsToInputs(drafts);
  if (normalizedDrafts.errors.length > 0) return false;

  const left = [...normalizedDrafts.inputs].sort(compareInputs);
  const right = [...activeInputs].sort(compareInputs);
  if (left.length !== right.length) return false;
  return left.every((input, index) => {
    const other = right[index];
    return input.nodeId === other.nodeId &&
      input.limitA === other.limitA &&
      input.aggregateConfirmed === (other.aggregateConfirmed === true);
  });
}

export function normalizeAppliedSupplyLimitDrafts(
  drafts: readonly SupplyLimitDraft[],
  inputs: readonly SupplyCurrentLimitInput[],
): SupplyLimitDraft[] {
  const normalizedById = new Map(
    supplyLimitInputsToDrafts(inputs).map((draft) => [draft.nodeId, draft]),
  );
  return drafts.map((draft) =>
    draft.enabled ? normalizedById.get(draft.nodeId) ?? draft : { ...draft });
}

export function supplyLimitIssuesToDisplay(
  issues: readonly SupplyLimitValidationIssue[],
): SupplyLimitDisplayError[] {
  return issues.map((issue) => ({
    message: issue.message,
    ...(issue.nodeIds?.[0] ? { nodeId: issue.nodeIds[0] } : {}),
    ...(issue.nodeIds?.[1] ? { relatedNodeId: issue.nodeIds[1] } : {}),
  }));
}

function missingSeriesReason(node: EnergyLogDataset["subsystems"][number]) {
  if (node.currentA.values.length === 0) return "该节点没有有效的 Supply 电流样本。";
  if (node.powerW.values.length === 0) return "该节点没有有效的功率样本。";
  if (node.energyWh.values.length === 0) return "该节点没有有效的累计能量样本。";
  return undefined;
}

function compareInputs(left: SupplyCurrentLimitInput, right: SupplyCurrentLimitInput) {
  return left.nodeId.localeCompare(right.nodeId);
}
