import {
  analyzeSupplyLimitMotorGroups,
  type EnergyLogDataset,
  type SupplyCurrentLimitInput,
  type SupplyLimitValidationIssue,
  type TimeRange,
} from "../log-analysis/core";
import {
  parseSupplyLimitDraftValue,
  type SupplyLimitDisplayError,
  type SupplyLimitDraft,
  type SupplyLimitDraftPatch,
  type SupplyLimitTargetOption,
} from "./supply-limit-simulator";

export function buildSupplyLimitTargetOptions(
  dataset: EnergyLogDataset,
  range: TimeRange,
): SupplyLimitTargetOption[] {
  return (analyzeSupplyLimitMotorGroups(dataset, range) ?? []).map((group) => ({
    id: group.motorGroupId,
    subsystemId: group.subsystemId,
    subsystemName: group.subsystemName,
    leaderName: group.leaderName,
    motorNames: group.motorNames,
    motorType: group.motorType,
    motorCount: group.motorCount,
    peakCurrentA: group.baseline.peakCurrentA,
    peakPowerW: group.baseline.peakPowerW,
    averagePowerW: group.baseline.averagePowerW,
    energyWh: group.baseline.energyWh,
    robotPositiveInputRatio: group.robotPositiveInputRatio,
    ...(group.unavailableReason ? { unavailableReason: group.unavailableReason } : {}),
  }));
}

export function upsertSupplyLimitDraft(
  drafts: readonly SupplyLimitDraft[],
  motorGroupId: string,
  patch: SupplyLimitDraftPatch,
): SupplyLimitDraft[] {
  const existingIndex = drafts.findIndex((draft) => draft.motorGroupId === motorGroupId);
  if (existingIndex === -1) {
    return [...drafts, { motorGroupId, enabled: false, limitText: "", ...patch }];
  }
  return drafts.map((draft, index) =>
    index === existingIndex ? { ...draft, ...patch } : draft,
  );
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
      errors.push({
        motorGroupId: draft.motorGroupId,
        message: "请输入大于或等于 0 的有限电流值。",
      });
      continue;
    }
    inputs.push({ motorGroupId: draft.motorGroupId, limitA, enabled: true });
  }
  return { inputs, errors };
}

export function supplyLimitIssuesToDisplay(
  issues: readonly SupplyLimitValidationIssue[],
): SupplyLimitDisplayError[] {
  return issues.map((issue) => ({
    message: issue.message,
    ...(issue.motorGroupIds?.[0]
      ? { motorGroupId: issue.motorGroupIds[0] }
      : {}),
  }));
}
