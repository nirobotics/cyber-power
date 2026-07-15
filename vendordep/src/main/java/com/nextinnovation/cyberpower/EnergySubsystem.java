package com.nextinnovation.cyberpower;

import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.function.BooleanSupplier;
import java.util.function.DoubleSupplier;

/** An independently timestamped EnergyLogger subsystem. */
public final class EnergySubsystem {
  private static final int VALUES_PER_MOTOR = 3;

  private final EnergyLogger logger;
  private final int index;
  private final String name;
  private final List<MotorRegistration> motors = new ArrayList<>();

  private String sampleTimestampPath;
  private String statePath;
  private String motorSamplesPath;
  private double[] packedSamples = new double[0];
  private long previousTimestampMicros;
  private boolean hasPreviousTimestamp;
  private double totalSupplyCurrentAmps = Double.NaN;

  EnergySubsystem(EnergyLogger logger, String name, int index) {
    this.logger = logger;
    this.name = name;
    this.index = index;
  }

  /**
   * Registers an independently controlled motor or a homogeneous motor-group leader.
   *
   * @param name unique motor name inside this subsystem
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
  public void registerLeaderMotor(
      String name,
      MotorType type,
      double analysisReduction,
      BooleanSupplier connected,
      DoubleSupplier supplyCurrentAmps,
      DoubleSupplier statorCurrentAmps,
      DoubleSupplier rawRotorVelocityRadPerSec) {
    requireConfigurable();
    String validatedName = validateNewMotor(name);
    motors.add(
        MotorRegistration.leader(
            validatedName,
            Objects.requireNonNull(type, "type"),
            validateAnalysisReduction(analysisReduction),
            Objects.requireNonNull(connected, "connected"),
            Objects.requireNonNull(supplyCurrentAmps, "supplyCurrentAmps"),
            Objects.requireNonNull(statorCurrentAmps, "statorCurrentAmps"),
            Objects.requireNonNull(rawRotorVelocityRadPerSec, "rawRotorVelocityRadPerSec")));
  }

  /**
   * Registers a homogeneous follower. Its Stator Current and rotor velocity are inherited from
   * the named leader for analysis and are not sampled from the robot.
   *
   * @param name unique motor name inside this subsystem
   * @param type known motor model; must match the leader
   * @param analysisReduction motor rotations per analyzed output rotation; must match the leader
   * @param leaderName previously registered leader motor name
   * @param connected whether this motor's telemetry is connected for the current sample
   * @param supplyCurrentAmps battery-side Supply Current in amperes, positive when drawing from the
   *     DC bus and negative when returning current to it; this sign must not depend on rotor direction
   */
  public void registerFollowerMotor(
      String name,
      MotorType type,
      double analysisReduction,
      String leaderName,
      BooleanSupplier connected,
      DoubleSupplier supplyCurrentAmps) {
    requireConfigurable();
    String validatedName = validateNewMotor(name);
    String validatedLeaderName = EnergyLogger.requireName(leaderName, "Leader motor name");
    MotorRegistration leader = findMotor(validatedLeaderName);
    if (leader == null) {
      throw new IllegalArgumentException(
          "Follower " + validatedName + " references an unregistered leader " + validatedLeaderName);
    }
    if (!leader.isLeader()) {
      throw new IllegalArgumentException(
          "Follower " + validatedName + " cannot follow follower " + validatedLeaderName);
    }
    MotorType validatedType = Objects.requireNonNull(type, "type");
    double validatedReduction = validateAnalysisReduction(analysisReduction);
    if (validatedType != leader.type) {
      throw new IllegalArgumentException(
          "Follower " + validatedName + " must use the same motor type as " + validatedLeaderName);
    }
    if (Double.compare(validatedReduction, leader.analysisReduction) != 0) {
      throw new IllegalArgumentException(
          "Follower "
              + validatedName
              + " must use the same analysis reduction as "
              + validatedLeaderName);
    }
    motors.add(
        MotorRegistration.follower(
            validatedName,
            validatedType,
            validatedReduction,
            validatedLeaderName,
            Objects.requireNonNull(connected, "connected"),
            Objects.requireNonNull(supplyCurrentAmps, "supplyCurrentAmps")));
  }

  /** Records one independently timestamped sample using an enum state name. */
  public void periodic(Enum<?> state) {
    Objects.requireNonNull(state, "state");
    periodic(state.name());
  }

  /** Records one independently timestamped sample using a nonblank state string. */
  public void periodic(String state) {
    String recordedState = EnergyLogger.requireName(state, "Subsystem state");
    long timestampMicros = logger.nowMicros();
    logger.freezeAndPublishDescriptors(timestampMicros);
    if (hasPreviousTimestamp && timestampMicros < previousTimestampMicros) {
      throw new IllegalStateException(
          "Time moved backwards for subsystem "
              + name
              + ": "
              + previousTimestampMicros
              + " -> "
              + timestampMicros);
    }

    sampleMotors();
    previousTimestampMicros = timestampMicros;
    hasPreviousTimestamp = true;

    LogSink sink = logger.sink();
    sink.recordLong(sampleTimestampPath, timestampMicros, timestampMicros);
    sink.recordString(statePath, recordedState, timestampMicros);
    sink.recordDoubleArray(motorSamplesPath, packedSamples, "", timestampMicros);
  }

  String name() {
    return name;
  }

  List<MotorRegistration> motors() {
    return motors;
  }

  double totalSupplyCurrentAmps() {
    return totalSupplyCurrentAmps;
  }

  void freeze() {
    if (motors.isEmpty()) {
      throw new IllegalStateException("Subsystem " + name + " must register at least one motor");
    }
    String prefix = EnergyLogger.ROOT + "subsystems/s" + index + "/";
    sampleTimestampPath = prefix + "sampleTimestampUs";
    statePath = prefix + "state";
    motorSamplesPath = prefix + "motors/samples";
    packedSamples = new double[motors.size() * VALUES_PER_MOTOR];
  }

  private void sampleMotors() {
    double sum = 0.0;
    for (int index = 0; index < motors.size(); index++) {
      MotorRegistration motor = motors.get(index);
      int offset = index * VALUES_PER_MOTOR;
      if (!motor.connected.getAsBoolean()) {
        packedSamples[offset] = Double.NaN;
        packedSamples[offset + 1] = Double.NaN;
        packedSamples[offset + 2] = Double.NaN;
        sum = Double.NaN;
        continue;
      }
      double supplyCurrent = finiteOrNaN(motor.supplyCurrentAmps.getAsDouble());
      packedSamples[offset] = supplyCurrent;
      sum = addOrNaN(sum, supplyCurrent);
      if (motor.isLeader()) {
        packedSamples[offset + 1] = finiteOrNaN(motor.statorCurrentAmps.getAsDouble());
        packedSamples[offset + 2] = finiteOrNaN(motor.rawRotorVelocityRadPerSec.getAsDouble());
      } else {
        packedSamples[offset + 1] = Double.NaN;
        packedSamples[offset + 2] = Double.NaN;
      }
    }
    totalSupplyCurrentAmps = sum;
  }

  private void requireConfigurable() {
    logger.requireConfigurable();
  }

  private String validateNewMotor(String value) {
    String validatedName = EnergyLogger.requireName(value, "Motor name");
    if (findMotor(validatedName) != null) {
      throw new IllegalArgumentException(
          "Duplicate motor name " + validatedName + " in subsystem " + name);
    }
    return validatedName;
  }

  private MotorRegistration findMotor(String motorName) {
    for (MotorRegistration motor : motors) {
      if (motor.name.equals(motorName)) {
        return motor;
      }
    }
    return null;
  }

  private static double validateAnalysisReduction(double value) {
    if (!Double.isFinite(value) || value <= 0.0) {
      throw new IllegalArgumentException(
          "Analysis reduction must be finite and greater than zero");
    }
    return value;
  }

  private static double finiteOrNaN(double value) {
    return Double.isFinite(value) ? value : Double.NaN;
  }

  private static double addOrNaN(double sum, double value) {
    return Double.isFinite(sum) && Double.isFinite(value) ? sum + value : Double.NaN;
  }

  static final class MotorRegistration {
    final String name;
    final MotorType type;
    final double analysisReduction;
    final String leaderName;
    final BooleanSupplier connected;
    final DoubleSupplier supplyCurrentAmps;
    final DoubleSupplier statorCurrentAmps;
    final DoubleSupplier rawRotorVelocityRadPerSec;

    private MotorRegistration(
        String name,
        MotorType type,
        double analysisReduction,
        String leaderName,
        BooleanSupplier connected,
        DoubleSupplier supplyCurrentAmps,
        DoubleSupplier statorCurrentAmps,
        DoubleSupplier rawRotorVelocityRadPerSec) {
      this.name = name;
      this.type = type;
      this.analysisReduction = analysisReduction;
      this.leaderName = leaderName;
      this.connected = connected;
      this.supplyCurrentAmps = supplyCurrentAmps;
      this.statorCurrentAmps = statorCurrentAmps;
      this.rawRotorVelocityRadPerSec = rawRotorVelocityRadPerSec;
    }

    static MotorRegistration leader(
        String name,
        MotorType type,
        double analysisReduction,
        BooleanSupplier connected,
        DoubleSupplier supplyCurrentAmps,
        DoubleSupplier statorCurrentAmps,
        DoubleSupplier rawRotorVelocityRadPerSec) {
      return new MotorRegistration(
          name,
          type,
          analysisReduction,
          null,
          connected,
          supplyCurrentAmps,
          statorCurrentAmps,
          rawRotorVelocityRadPerSec);
    }

    static MotorRegistration follower(
        String name,
        MotorType type,
        double analysisReduction,
        String leaderName,
        BooleanSupplier connected,
        DoubleSupplier supplyCurrentAmps) {
      return new MotorRegistration(
          name, type, analysisReduction, leaderName, connected, supplyCurrentAmps, null, null);
    }

    boolean isLeader() {
      return leaderName == null;
    }
  }
}
