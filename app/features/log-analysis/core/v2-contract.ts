export const ENERGY_LOGGER_V2_SUPPORTED_MAJOR = 2;
export const ENERGY_LOGGER_V2_SUPPORTED_MINOR = 4;
export const ENERGY_LOGGER_V2_SUPPORTED_VERSIONS = ["2.1", "2.2", "2.3", "2.4"] as const;

export type EnergyLoggerV2ContractVersion =
  (typeof ENERGY_LOGGER_V2_SUPPORTED_VERSIONS)[number];

export const ENERGY_LOGGER_V2_MOTOR_TYPES = [
  "CIM",
  "VEX_775_PRO",
  "NEO",
  "MINI_CIM",
  "BAG",
  "ANDYMARK_RS775_125",
  "BANEBOTS_RS775",
  "ANDYMARK_9015",
  "BANEBOTS_RS550",
  "NEO_550",
  "FALCON_500",
  "FALCON_500_FOC",
  "ROMI_BUILT_IN",
  "KRAKEN_X60",
  "KRAKEN_X60_FOC",
  "KRAKEN_X44",
  "KRAKEN_X44_FOC",
  "MINION",
  "NEO_VORTEX",
] as const;

export type EnergyLoggerV2MotorType = (typeof ENERGY_LOGGER_V2_MOTOR_TYPES)[number];

export interface EnergyLoggerV2MotorDescriptor {
  name: string;
  /** Null together with analysisReduction for a supply-only motor. */
  type: EnergyLoggerV2MotorType | null;
  /** Motor rotations per mechanism rotation. This is never inferred from controller feedback ratios. */
  analysisReduction: number | null;
  /** Null for a leader/independent motor; otherwise the leader name in this subsystem. */
  leader: string | null;
}

export interface EnergyLoggerV2SubsystemManifest {
  name: string;
  motors: EnergyLoggerV2MotorDescriptor[];
}

export interface EnergyLoggerV2Manifest {
  subsystems: EnergyLoggerV2SubsystemManifest[];
}

export interface EnergyLoggerV2Contract {
  contractVersion: EnergyLoggerV2ContractVersion;
  libraryVersion: string;
  manifest: EnergyLoggerV2Manifest;
}

export interface EnergyLoggerV2ContractInput {
  contractVersion: unknown;
  libraryVersion: unknown;
  manifest: unknown;
}

export interface EnergyLoggerV2ContractIssue {
  code:
    | "V2_CONTRACT_VERSION_INVALID"
    | "V2_CONTRACT_MAJOR_UNSUPPORTED"
    | "V2_LIBRARY_VERSION_INVALID"
    | "V2_MANIFEST_INVALID_JSON"
    | "V2_MANIFEST_INVALID"
    | "V2_MANIFEST_DUPLICATE_NAME"
    | "V2_MANIFEST_INVALID_RATIO"
    | "V2_MANIFEST_UNKNOWN_MOTOR_TYPE"
    | "V2_MANIFEST_INVALID_LEADER";
  message: string;
  path?: string;
  details?: Record<string, unknown>;
}

export class EnergyLoggerV2ContractError extends Error {
  constructor(readonly issues: EnergyLoggerV2ContractIssue[]) {
    super(issues[0]?.message ?? "EnergyLogger V2 contract is invalid");
    this.name = "EnergyLoggerV2ContractError";
  }
}

const MOTOR_TYPES = new Set<string>(ENERGY_LOGGER_V2_MOTOR_TYPES);
const SUPPORTED_VERSIONS = new Set<string>(ENERGY_LOGGER_V2_SUPPORTED_VERSIONS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  path: string,
  issues: EnergyLoggerV2ContractIssue[],
): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length === wanted.length && actual.every((key, index) => key === wanted[index])) {
    return true;
  }
  issues.push({
    code: "V2_MANIFEST_INVALID",
    message: `${path} must contain exactly: ${wanted.join(", ")}`,
    path,
    details: { actualKeys: actual, expectedKeys: wanted },
  });
  return false;
}

function nonblank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseManifest(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new EnergyLoggerV2ContractError([
      {
        code: "V2_MANIFEST_INVALID_JSON",
        message: "EnergyLogger V2 manifest is not valid JSON",
        path: "manifest",
      },
    ]);
  }
}

export function parseEnergyLoggerV2Contract(
  input: EnergyLoggerV2ContractInput,
): EnergyLoggerV2Contract {
  const issues: EnergyLoggerV2ContractIssue[] = [];
  if (typeof input.contractVersion !== "string" || !/^\d+\.\d+$/.test(input.contractVersion)) {
    issues.push({
      code: "V2_CONTRACT_VERSION_INVALID",
      message: `EnergyLogger contractVersion must be one of: ${ENERGY_LOGGER_V2_SUPPORTED_VERSIONS.join(", ")}`,
      path: "contractVersion",
    });
  } else if (Number(input.contractVersion.split(".")[0]) !== ENERGY_LOGGER_V2_SUPPORTED_MAJOR) {
    issues.push({
      code: "V2_CONTRACT_MAJOR_UNSUPPORTED",
      message: `Unsupported EnergyLogger contract major: ${input.contractVersion}`,
      path: "contractVersion",
    });
  } else if (!SUPPORTED_VERSIONS.has(input.contractVersion)) {
    issues.push({
      code: "V2_CONTRACT_VERSION_INVALID",
      message: `Unsupported EnergyLogger contract version: ${input.contractVersion}; expected one of ${ENERGY_LOGGER_V2_SUPPORTED_VERSIONS.join(", ")}`,
      path: "contractVersion",
    });
  }

  if (!nonblank(input.libraryVersion)) {
    issues.push({
      code: "V2_LIBRARY_VERSION_INVALID",
      message: "EnergyLogger libraryVersion must be a non-empty string",
      path: "libraryVersion",
    });
  }

  let manifest: unknown;
  try {
    manifest = parseManifest(input.manifest);
  } catch (error) {
    if (error instanceof EnergyLoggerV2ContractError) issues.push(...error.issues);
    else throw error;
  }

  const normalizedSubsystems: EnergyLoggerV2SubsystemManifest[] = [];
  if (!isRecord(manifest)) {
    issues.push({
      code: "V2_MANIFEST_INVALID",
      message: "EnergyLogger V2 manifest must be an object",
      path: "manifest",
    });
  } else {
    exactKeys(manifest, ["subsystems"], "manifest", issues);
    if (!Array.isArray(manifest.subsystems) || manifest.subsystems.length === 0) {
      issues.push({
        code: "V2_MANIFEST_INVALID",
        message: "manifest.subsystems must be a non-empty array",
        path: "manifest.subsystems",
      });
    } else {
      const subsystemNames = new Set<string>();
      manifest.subsystems.forEach((rawSubsystem, subsystemIndex) => {
        const path = `manifest.subsystems[${subsystemIndex}]`;
        if (!isRecord(rawSubsystem)) {
          issues.push({ code: "V2_MANIFEST_INVALID", message: `${path} must be an object`, path });
          return;
        }
        exactKeys(rawSubsystem, ["name", "motors"], path, issues);
        if (!nonblank(rawSubsystem.name)) {
          issues.push({
            code: "V2_MANIFEST_INVALID",
            message: `${path}.name must be non-empty`,
            path: `${path}.name`,
          });
          return;
        }
        const subsystemName = rawSubsystem.name.trim();
        if (subsystemNames.has(subsystemName)) {
          issues.push({
            code: "V2_MANIFEST_DUPLICATE_NAME",
            message: `Duplicate subsystem name: ${subsystemName}`,
            path: `${path}.name`,
          });
        }
        subsystemNames.add(subsystemName);

        const motors: EnergyLoggerV2MotorDescriptor[] = [];
        if (!Array.isArray(rawSubsystem.motors) || rawSubsystem.motors.length === 0) {
          issues.push({
            code: "V2_MANIFEST_INVALID",
            message: `${path}.motors must be a non-empty array`,
            path: `${path}.motors`,
          });
        } else {
          const motorNames = new Set<string>();
          rawSubsystem.motors.forEach((rawMotor, motorIndex) => {
            const motorPath = `${path}.motors[${motorIndex}]`;
            if (!isRecord(rawMotor)) {
              issues.push({
                code: "V2_MANIFEST_INVALID",
                message: `${motorPath} must be an object`,
                path: motorPath,
              });
              return;
            }
            exactKeys(rawMotor, ["name", "type", "analysisReduction", "leader"], motorPath, issues);
            if (!nonblank(rawMotor.name)) {
              issues.push({
                code: "V2_MANIFEST_INVALID",
                message: `${motorPath}.name must be non-empty`,
                path: `${motorPath}.name`,
              });
              return;
            }
            const name = rawMotor.name.trim();
            if (motorNames.has(name)) {
              issues.push({
                code: "V2_MANIFEST_DUPLICATE_NAME",
                message: `Duplicate motor name in ${subsystemName}: ${name}`,
                path: `${motorPath}.name`,
              });
            }
            motorNames.add(name);
            const supplyOnly = rawMotor.type === null && rawMotor.analysisReduction === null;
            if (supplyOnly && input.contractVersion !== "2.4") {
              issues.push({
                code: "V2_MANIFEST_INVALID",
                message: `${motorPath} may use null type and analysisReduction only in contract 2.4`,
                path: motorPath,
              });
              return;
            }
            if ((rawMotor.type === null) !== (rawMotor.analysisReduction === null)) {
              issues.push({
                code: "V2_MANIFEST_INVALID",
                message: `${motorPath}.type and analysisReduction must either both be null or both be set`,
                path: motorPath,
              });
              return;
            }
            if (!supplyOnly) {
              if (!nonblank(rawMotor.type) || !MOTOR_TYPES.has(rawMotor.type)) {
                issues.push({
                  code: "V2_MANIFEST_UNKNOWN_MOTOR_TYPE",
                  message: `Unknown motor type: ${String(rawMotor.type)}`,
                  path: `${motorPath}.type`,
                });
                return;
              }
              if (
                typeof rawMotor.analysisReduction !== "number" ||
                !Number.isFinite(rawMotor.analysisReduction) ||
                rawMotor.analysisReduction <= 0
              ) {
                issues.push({
                  code: "V2_MANIFEST_INVALID_RATIO",
                  message: `${motorPath}.analysisReduction must be finite and greater than zero`,
                  path: `${motorPath}.analysisReduction`,
                });
                return;
              }
            }
            if (rawMotor.leader !== null && !nonblank(rawMotor.leader)) {
              issues.push({
                code: "V2_MANIFEST_INVALID_LEADER",
                message: `${motorPath}.leader must be null or a non-empty motor name`,
                path: `${motorPath}.leader`,
              });
              return;
            }
            motors.push({
              name,
              type: supplyOnly ? null : rawMotor.type as EnergyLoggerV2MotorType,
              analysisReduction: supplyOnly ? null : rawMotor.analysisReduction as number,
              leader: rawMotor.leader === null ? null : rawMotor.leader.trim(),
            });
          });
        }

        const byName = new Map(motors.map((motor) => [motor.name, motor]));
        for (const motor of motors) {
          if (motor.leader === null) continue;
          const leader = byName.get(motor.leader);
          if (!leader || leader.name === motor.name || leader.leader !== null) {
            issues.push({
              code: "V2_MANIFEST_INVALID_LEADER",
              message: `${subsystemName}/${motor.name} must reference a leader in the same subsystem`,
              path: `${path}.motors`,
              details: { motor: motor.name, leader: motor.leader },
            });
            continue;
          }
          if (
            leader.type !== motor.type ||
            leader.analysisReduction !== motor.analysisReduction
          ) {
            issues.push({
              code: "V2_MANIFEST_INVALID_LEADER",
              message: `${subsystemName}/${motor.name} must match its leader motor type and analysisReduction`,
              path: `${path}.motors`,
              details: { motor: motor.name, leader: motor.leader },
            });
          }
        }
        normalizedSubsystems.push({ name: subsystemName, motors });
      });
    }
  }

  if (issues.length > 0) throw new EnergyLoggerV2ContractError(issues);
  return {
    contractVersion: input.contractVersion as EnergyLoggerV2ContractVersion,
    libraryVersion: (input.libraryVersion as string).trim(),
    manifest: { subsystems: normalizedSubsystems },
  };
}
