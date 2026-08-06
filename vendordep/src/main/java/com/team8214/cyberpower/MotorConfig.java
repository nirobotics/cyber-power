package com.team8214.cyberpower;

import java.util.Objects;
import java.util.function.BooleanSupplier;
import java.util.function.DoubleSupplier;

/** Immutable telemetry configuration for a motor registered with Cyber Power. */
public final class MotorConfig {
  final String name;
  final MotorType type;
  final Double analysisReduction;
  final BooleanSupplier connected;
  final DoubleSupplier supplyCurrentAmps;
  final DoubleSupplier statorCurrentAmps;
  final DoubleSupplier rawRotorVelocityRadPerSec;

  /**
   * Creates a motor configuration with complete analysis telemetry.
   *
   * @param name unique motor name inside its subsystem
   * @param type known motor model
   * @param analysisReduction motor rotations per analyzed output rotation; values above one are
   *     reductions
   * @param connected whether this motor's telemetry is connected for the current sample
   * @param supplyCurrentAmps battery-side Supply Current in amperes, positive when drawing from the
   *     DC bus and negative when returning current to it; this sign must not depend on rotor direction
   * @param statorCurrentAmps Stator Current in amperes, positive for motoring and negative for
   *     regenerative braking; this sign must not depend on rotor direction
   * @param rawRotorVelocityRadPerSec signed raw rotor velocity in radians per second
   */
  public MotorConfig(
      String name,
      MotorType type,
      double analysisReduction,
      BooleanSupplier connected,
      DoubleSupplier supplyCurrentAmps,
      DoubleSupplier statorCurrentAmps,
      DoubleSupplier rawRotorVelocityRadPerSec) {
    this.name = EnergyLogger.requireName(name, "Motor name");
    this.type = Objects.requireNonNull(type, "type");
    this.analysisReduction = validateAnalysisReduction(analysisReduction);
    this.connected = Objects.requireNonNull(connected, "connected");
    this.supplyCurrentAmps = Objects.requireNonNull(supplyCurrentAmps, "supplyCurrentAmps");
    this.statorCurrentAmps = Objects.requireNonNull(statorCurrentAmps, "statorCurrentAmps");
    this.rawRotorVelocityRadPerSec =
        Objects.requireNonNull(rawRotorVelocityRadPerSec, "rawRotorVelocityRadPerSec");
  }

  /**
   * Creates a motor configuration for connection-aware Supply Current logging without model
   * analysis.
   *
   * @param name unique motor name inside its subsystem
   * @param connected whether this motor's telemetry is connected for the current sample
   * @param supplyCurrentAmps battery-side Supply Current in amperes, positive when drawing from the
   *     DC bus and negative when returning current to it; this sign must not depend on rotor direction
   */
  public MotorConfig(
      String name, BooleanSupplier connected, DoubleSupplier supplyCurrentAmps) {
    this.name = EnergyLogger.requireName(name, "Motor name");
    this.type = null;
    this.analysisReduction = null;
    this.connected = Objects.requireNonNull(connected, "connected");
    this.supplyCurrentAmps = Objects.requireNonNull(supplyCurrentAmps, "supplyCurrentAmps");
    this.statorCurrentAmps = null;
    this.rawRotorVelocityRadPerSec = null;
  }

  private static double validateAnalysisReduction(double value) {
    if (!Double.isFinite(value) || value <= 0.0) {
      throw new IllegalArgumentException(
          "Analysis reduction must be finite and greater than zero");
    }
    return value;
  }
}
