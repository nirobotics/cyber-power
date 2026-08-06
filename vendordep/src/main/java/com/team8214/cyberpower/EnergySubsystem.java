package com.team8214.cyberpower;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Objects;
import java.util.Set;
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
   * Atomically registers an independently controlled motor and any homogeneous followers.
   * Followers inherit the motor's analysis metadata and are stored in argument order.
   *
   * @param motor independently controlled motor or motor-group leader
   * @param followers zero or more followers in the same homogeneous motor group
   */
  public void registerMotor(MotorConfig motor, FollowerMotorConfig... followers) {
    requireConfigurable();
    MotorConfig validatedMotor = Objects.requireNonNull(motor, "motor");
    FollowerMotorConfig[] validatedFollowers = Objects.requireNonNull(followers, "followers");

    Set<String> names = new HashSet<>();
    for (MotorRegistration registeredMotor : motors) {
      names.add(registeredMotor.name);
    }
    validateUniqueName(validatedMotor.name, names);
    for (int index = 0; index < validatedFollowers.length; index++) {
      FollowerMotorConfig follower =
          Objects.requireNonNull(validatedFollowers[index], "followers[" + index + "]");
      validateUniqueName(follower.name, names);
    }

    List<MotorRegistration> registrations = new ArrayList<>(validatedFollowers.length + 1);
    registrations.add(
        MotorRegistration.leader(
            validatedMotor.name,
            validatedMotor.type,
            validatedMotor.analysisReduction,
            validatedMotor.connected,
            validatedMotor.supplyCurrentAmps,
            validatedMotor.statorCurrentAmps,
            validatedMotor.rawRotorVelocityRadPerSec));
    for (FollowerMotorConfig follower : validatedFollowers) {
      registrations.add(
        MotorRegistration.follower(
              follower.name,
              validatedMotor.type,
              validatedMotor.analysisReduction,
              validatedMotor.name,
              follower.connected,
              follower.supplyCurrentAmps));
    }
    motors.addAll(registrations);
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
      if (motor.isLeader() && motor.hasAnalysis()) {
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

  private void validateUniqueName(String motorName, Set<String> names) {
    if (!names.add(motorName)) {
      throw new IllegalArgumentException(
          "Duplicate motor name " + motorName + " in subsystem " + name);
    }
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
    final Double analysisReduction;
    final String leaderName;
    final BooleanSupplier connected;
    final DoubleSupplier supplyCurrentAmps;
    final DoubleSupplier statorCurrentAmps;
    final DoubleSupplier rawRotorVelocityRadPerSec;

    private MotorRegistration(
        String name,
        MotorType type,
        Double analysisReduction,
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
        Double analysisReduction,
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
        Double analysisReduction,
        String leaderName,
        BooleanSupplier connected,
        DoubleSupplier supplyCurrentAmps) {
      return new MotorRegistration(
          name, type, analysisReduction, leaderName, connected, supplyCurrentAmps, null, null);
    }

    boolean isLeader() {
      return leaderName == null;
    }

    boolean hasAnalysis() {
      return type != null;
    }
  }
}
