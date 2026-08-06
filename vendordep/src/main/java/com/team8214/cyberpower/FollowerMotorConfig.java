package com.team8214.cyberpower;

import java.util.Objects;
import java.util.function.BooleanSupplier;
import java.util.function.DoubleSupplier;

/** Immutable Supply Current telemetry configuration for a motor-group follower. */
public final class FollowerMotorConfig {
  final String name;
  final BooleanSupplier connected;
  final DoubleSupplier supplyCurrentAmps;

  /**
   * Creates a follower configuration. Analysis metadata, Stator Current, and rotor velocity are
   * inherited from the motor passed first to {@link EnergySubsystem#registerMotor}.
   *
   * @param name unique motor name inside its subsystem
   * @param connected whether this motor's telemetry is connected for the current sample
   * @param supplyCurrentAmps battery-side Supply Current in amperes, positive when drawing from the
   *     DC bus and negative when returning current to it; this sign must not depend on rotor direction
   */
  public FollowerMotorConfig(
      String name, BooleanSupplier connected, DoubleSupplier supplyCurrentAmps) {
    this.name = EnergyLogger.requireName(name, "Motor name");
    this.connected = Objects.requireNonNull(connected, "connected");
    this.supplyCurrentAmps = Objects.requireNonNull(supplyCurrentAmps, "supplyCurrentAmps");
  }
}
