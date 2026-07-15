import { describe, expect, it } from "vitest";
import {
  appendEnergyV2FixtureSample,
  buildEnergyV2Fixture,
} from "../../../tests/fixtures/wpilog-builder";
import { parseEnergyLog } from "../log-analysis/core";
import type { SupplyLimitDraft } from "./supply-limit-simulator";
import {
  buildSupplyLimitTargetOptions,
  supplyLimitDraftsToInputs,
  supplyLimitIssuesToDisplay,
  upsertSupplyLimitDraft,
} from "./supply-limit-state";

describe("supply limit dashboard state", () => {
  it("creates and updates a sparse motor-group draft without losing parked values", () => {
    const created = upsertSupplyLimitDraft([], "s1/belt", { limitText: "80" });
    expect(created).toEqual([{
      motorGroupId: "s1/belt",
      enabled: false,
      limitText: "80",
    }]);
    const enabled = upsertSupplyLimitDraft(created, "s1/belt", { enabled: true });
    expect(enabled).toEqual([{
      motorGroupId: "s1/belt",
      enabled: true,
      limitText: "80",
    }]);
    expect(upsertSupplyLimitDraft(enabled, "s1/belt", { enabled: false }))
      .toEqual([{ motorGroupId: "s1/belt", enabled: false, limitText: "80" }]);
  });

  it("converts every enabled draft into one atomic multi-group input", () => {
    const drafts: SupplyLimitDraft[] = [
      { motorGroupId: "s1/belt", enabled: true, limitText: "120" },
      { motorGroupId: "s0/frontLeft", enabled: true, limitText: "80.5" },
      { motorGroupId: "parked", enabled: false, limitText: "invalid" },
    ];
    expect(supplyLimitDraftsToInputs(drafts)).toEqual({
      inputs: [
        { motorGroupId: "s1/belt", limitA: 120, enabled: true },
        { motorGroupId: "s0/frontLeft", limitA: 80.5, enabled: true },
      ],
      errors: [],
    });
  });

  it("reports invalid values only after their group is enabled", () => {
    expect(supplyLimitDraftsToInputs([
      { motorGroupId: "active", enabled: true, limitText: "90" },
      { motorGroupId: "parked", enabled: false, limitText: "invalid" },
    ])).toEqual({
      inputs: [{ motorGroupId: "active", limitA: 90, enabled: true }],
      errors: [],
    });
    expect(supplyLimitDraftsToInputs([
      { motorGroupId: "parked", enabled: true, limitText: "invalid" },
    ]).errors).toEqual([
      expect.objectContaining({ motorGroupId: "parked" }),
    ]);
  });

  it("maps core validation to the affected motor group", () => {
    expect(supplyLimitIssuesToDisplay([{
      code: "UNKNOWN_MOTOR_GROUP",
      message: "电机组不存在。",
      motorGroupIds: ["s0/missing"],
    }])).toEqual([{
      message: "电机组不存在。",
      motorGroupId: "s0/missing",
    }]);
  });

  it("builds exactly one option per Manifest Leader group", async () => {
    const fixture = buildEnergyV2Fixture();
    appendEnergyV2FixtureSample(fixture, 1_000_000, { drive: "DRIVE", indexer: "IDLE" }, 0);
    appendEnergyV2FixtureSample(fixture, 2_000_000, { drive: "DRIVE", indexer: "IDLE" }, 0);
    const dataset = await parseEnergyLog(fixture.builder.build());
    const options = buildSupplyLimitTargetOptions(dataset, {
      startUs: dataset.bounds.energyStartUs,
      endUs: dataset.bounds.energyEndUs,
    });

    expect(options).toHaveLength(2);
    expect(options.find((option) => option.subsystemName === "drive")).toMatchObject({
      leaderName: "frontLeft",
      motorNames: ["frontLeft", "frontRight"],
      motorCount: 2,
      peakCurrentA: 20,
      peakPowerW: 240,
      robotPositiveInputRatio: 0.8,
    });
    expect(options.some((option) => option.leaderName === "frontRight")).toBe(false);
  });
});
