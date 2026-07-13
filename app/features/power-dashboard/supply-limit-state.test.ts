import { describe, expect, it } from "vitest";
import type { SupplyLimitDraft } from "./supply-limit-simulator";
import {
  normalizeAppliedSupplyLimitDrafts,
  supplyLimitDraftsMatchInputs,
  supplyLimitDraftsToInputs,
  supplyLimitInputsToDrafts,
  supplyLimitIssuesToDisplay,
} from "./supply-limit-state";

describe("supply limit dashboard state", () => {
  it("converts every enabled draft into one atomic multi-target input", () => {
    const drafts: SupplyLimitDraft[] = [
      { nodeId: "indexer", enabled: true, limitText: "120", aggregateConfirmed: false },
      { nodeId: "shooter/flywheel", enabled: true, limitText: "80.5", aggregateConfirmed: true },
      { nodeId: "intake", enabled: false, limitText: "40", aggregateConfirmed: false },
    ];

    expect(supplyLimitDraftsToInputs(drafts)).toEqual({
      inputs: [
        { nodeId: "indexer", limitA: 120, aggregateConfirmed: false, enabled: true },
        { nodeId: "shooter/flywheel", limitA: 80.5, aggregateConfirmed: true, enabled: true },
      ],
      errors: [],
    });
  });

  it("reports invalid rows before the caller attempts an atomic apply", () => {
    const result = supplyLimitDraftsToInputs([
      { nodeId: "indexer", enabled: true, limitText: "90", aggregateConfirmed: false },
      { nodeId: "shooter", enabled: true, limitText: "invalid", aggregateConfirmed: false },
    ]);

    expect(result.inputs).toHaveLength(1);
    expect(result.errors).toEqual([
      expect.objectContaining({ nodeId: "shooter" }),
    ]);
  });

  it("round-trips applied limits, ignores parked disabled rows, and detects changed active rows", () => {
    const inputs = [
      { nodeId: "indexer", limitA: 120, aggregateConfirmed: false, enabled: true },
      { nodeId: "shooter", limitA: 90, aggregateConfirmed: true, enabled: true },
    ];
    const drafts = supplyLimitInputsToDrafts(inputs);

    expect(supplyLimitDraftsMatchInputs(drafts, [...inputs].reverse())).toBe(true);
    expect(supplyLimitDraftsMatchInputs(
      drafts.map((draft, index) => index === 0 ? { ...draft, enabled: false } : draft),
      inputs,
    )).toBe(false);
    expect(supplyLimitDraftsMatchInputs(
      [...drafts, {
        nodeId: "intake",
        enabled: false,
        limitText: "",
        aggregateConfirmed: false,
      }],
      inputs,
    )).toBe(true);
    expect(supplyLimitDraftsMatchInputs(
      drafts.map((draft, index) => index === 0 ? { ...draft, limitText: "119" } : draft),
      inputs,
    )).toBe(false);
    expect(supplyLimitDraftsMatchInputs([], [])).toBe(true);
  });

  it("keeps disabled rows when an active scenario is normalized after apply", () => {
    const drafts: SupplyLimitDraft[] = [
      { nodeId: "indexer", enabled: true, limitText: "120.0", aggregateConfirmed: false },
      { nodeId: "intake", enabled: false, limitText: "40", aggregateConfirmed: true },
    ];

    expect(normalizeAppliedSupplyLimitDrafts(drafts, [
      { nodeId: "indexer", limitA: 120, enabled: true },
    ])).toEqual([
      { nodeId: "indexer", enabled: true, limitText: "120", aggregateConfirmed: false },
      { nodeId: "intake", enabled: false, limitText: "40", aggregateConfirmed: true },
    ]);
  });

  it("maps hierarchy validation issues to both involved rows", () => {
    expect(supplyLimitIssuesToDisplay([{
      code: "HIERARCHY_CONFLICT",
      message: "节点存在父子重复。",
      nodeIds: ["swerve", "swerve/drive"],
    }])).toEqual([{
      message: "节点存在父子重复。",
      nodeId: "swerve",
      relatedNodeId: "swerve/drive",
    }]);
  });
});
