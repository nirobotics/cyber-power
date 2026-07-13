import { describe, expect, it } from "vitest";
import type { SupplyLimitDraft } from "./supply-limit-simulator";
import {
  supplyLimitDraftsToInputs,
  supplyLimitIssuesToDisplay,
  upsertSupplyLimitDraft,
} from "./supply-limit-state";

describe("supply limit dashboard state", () => {
  it("creates and updates a sparse row draft without losing parked values", () => {
    const created = upsertSupplyLimitDraft([], "indexer", { limitText: "80" });
    expect(created).toEqual([{
      nodeId: "indexer",
      enabled: false,
      limitText: "80",
      aggregateConfirmed: false,
    }]);

    const enabled = upsertSupplyLimitDraft(created, "indexer", {
      enabled: true,
      aggregateConfirmed: true,
    });
    expect(enabled).toEqual([{
      nodeId: "indexer",
      enabled: true,
      limitText: "80",
      aggregateConfirmed: true,
    }]);

    expect(upsertSupplyLimitDraft(enabled, "indexer", { enabled: false })).toEqual([{
      nodeId: "indexer",
      enabled: false,
      limitText: "80",
      aggregateConfirmed: true,
    }]);
  });

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

  it("keeps disabled invalid values parked without rejecting the active simulation", () => {
    expect(supplyLimitDraftsToInputs([
      { nodeId: "indexer", enabled: true, limitText: "90", aggregateConfirmed: false },
      { nodeId: "shooter", enabled: false, limitText: "invalid", aggregateConfirmed: false },
    ])).toEqual({
      inputs: [{ nodeId: "indexer", limitA: 90, aggregateConfirmed: false, enabled: true }],
      errors: [],
    });
  });

  it("reports an invalid row as soon as that parked target is enabled", () => {
    const result = supplyLimitDraftsToInputs([
      { nodeId: "indexer", enabled: true, limitText: "90", aggregateConfirmed: false },
      { nodeId: "shooter", enabled: true, limitText: "invalid", aggregateConfirmed: false },
    ]);

    expect(result.inputs).toHaveLength(1);
    expect(result.errors).toEqual([
      expect.objectContaining({ nodeId: "shooter" }),
    ]);
  });

  it("treats an empty or fully disabled configuration as an idle simulation", () => {
    expect(supplyLimitDraftsToInputs([])).toEqual({ inputs: [], errors: [] });
    expect(supplyLimitDraftsToInputs([
      { nodeId: "indexer", enabled: false, limitText: "40", aggregateConfirmed: false },
    ])).toEqual({ inputs: [], errors: [] });
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
