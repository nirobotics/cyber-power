import { describe, expect, it } from "vitest";
import {
  EnergyLoggerV2ContractError,
  parseEnergyLoggerV2Contract,
} from "./v2-contract";

function manifest() {
  return {
    subsystems: [
      {
        name: "drive",
        motors: [
          {
            name: "left",
            type: "KRAKEN_X60_FOC",
            analysisReduction: 6.75,
            leader: null,
          },
          {
            name: "right",
            type: "KRAKEN_X60_FOC",
            analysisReduction: 6.75,
            leader: "left",
          },
        ],
      },
    ],
  };
}

function errorCodes(error: unknown): string[] {
  return error instanceof EnergyLoggerV2ContractError
    ? error.issues.map((issue) => issue.code)
    : [];
}

describe("EnergyLogger V2 contracts", () => {
  it.each(["2.1", "2.2", "2.3"] as const)(
    "accepts %s with only the minimal fixed manifest and preserves analysisReduction",
    (contractVersion) => {
      const contract = parseEnergyLoggerV2Contract({
        contractVersion,
        libraryVersion:
          contractVersion === "2.1"
            ? "2026.2.0"
            : contractVersion === "2.2"
              ? "2026.2.1"
              : "2026.3.0",
        manifest: JSON.stringify(manifest()),
      });

      expect(contract.contractVersion).toBe(contractVersion);
      expect(contract.manifest.subsystems[0].motors[0].analysisReduction).toBe(6.75);
      expect(Object.keys(contract.manifest)).toEqual(["subsystems"]);
    },
  );

  it.each(["2.0", "2.4"])("rejects unsupported version %s", (contractVersion) => {
    expect(() => {
      parseEnergyLoggerV2Contract({
        contractVersion,
        libraryVersion: "2026.2.0",
        manifest: manifest(),
      });
    }).toThrowError(EnergyLoggerV2ContractError);
    try {
      parseEnergyLoggerV2Contract({
        contractVersion,
        libraryVersion: "2026.2.0",
        manifest: manifest(),
      });
    } catch (error) {
      expect(errorCodes(error)).toContain("V2_CONTRACT_VERSION_INVALID");
    }
  });

  it("rejects legacy reduction and every extra manifest field", () => {
    const invalid = manifest() as unknown as Record<string, unknown>;
    const subsystem = (invalid.subsystems as Array<Record<string, unknown>>)[0];
    const motor = (subsystem.motors as Array<Record<string, unknown>>)[0];
    motor.reduction = motor.analysisReduction;
    delete motor.analysisReduction;
    invalid.models = [];

    expect(() =>
      parseEnergyLoggerV2Contract({
        contractVersion: "2.2",
        libraryVersion: "2026.2.1",
        manifest: invalid,
      }),
    ).toThrowError(EnergyLoggerV2ContractError);
  });

  it("requires followers to reference a homogeneous leader by motor name", () => {
    const invalid = manifest();
    invalid.subsystems[0].motors[1].analysisReduction = 8;
    invalid.subsystems[0].motors[1].leader = "missing";
    try {
      parseEnergyLoggerV2Contract({
        contractVersion: "2.2",
        libraryVersion: "2026.2.1",
        manifest: invalid,
      });
      throw new Error("expected contract rejection");
    } catch (error) {
      expect(errorCodes(error)).toContain("V2_MANIFEST_INVALID_LEADER");
    }
  });
});
