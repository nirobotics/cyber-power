package com.nextinnovation.cyberpower;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.function.DoubleSupplier;

/** Singleton entry point for robot-side Cyber Power v2 telemetry. */
public final class EnergyLogger {
  static final String ROOT = "energyLogger/";
  static final String CONTRACT_VERSION = "2.4";
  static final long MAX_SAFE_TIMESTAMP_MICROS = 9_007_199_254_740_991L;
  private static final String VERSION_RESOURCE = "/META-INF/cyber-power-version.txt";

  private static EnergyLogger instance = new EnergyLogger();

  private final List<EnergySubsystem> subsystems = new ArrayList<>();
  private TimeSource timeSource = TimeSource.wpilib();
  private LogSink sink;
  private DoubleSupplier batteryVoltageSource;
  private DoubleSupplier robotTotalCurrentSource;
  private boolean frozen;
  private boolean descriptorsPublished;
  private String manifest;
  private long previousRobotTimestampMicros;
  private boolean hasPreviousRobotTimestamp;

  private EnergyLogger() {}

  /** Returns the process-wide EnergyLogger instance. */
  public static EnergyLogger getInstance() {
    return instance;
  }

  /** Registers the destination used for every EnergyLogger record. */
  public EnergyLogger registerLogSink(LogSink sink) {
    requireConfigurable();
    this.sink = Objects.requireNonNull(sink, "sink");
    return this;
  }

  /** Registers a monotonic microsecond clock, such as an AdvantageKit clock. */
  public EnergyLogger registerTimeSource(TimeSource timeSource) {
    requireConfigurable();
    this.timeSource = Objects.requireNonNull(timeSource, "timeSource");
    return this;
  }

  /** Registers the robot battery-voltage source in volts. */
  public EnergyLogger registerBatteryVoltageSource(DoubleSupplier batteryVoltageVolts) {
    requireConfigurable();
    batteryVoltageSource = Objects.requireNonNull(batteryVoltageVolts, "batteryVoltageVolts");
    return this;
  }

  /** Registers an optional measured total robot Supply Current source in amperes. */
  public EnergyLogger registerRobotTotalCurrentSource(DoubleSupplier totalSupplyCurrentAmps) {
    requireConfigurable();
    robotTotalCurrentSource =
        Objects.requireNonNull(totalSupplyCurrentAmps, "totalSupplyCurrentAmps");
    return this;
  }

  /** Creates one independently sampled subsystem. */
  public EnergySubsystem createSubsystem(String name) {
    requireConfigurable();
    String validatedName = requireName(name, "Subsystem name");
    if (subsystems.stream().anyMatch(subsystem -> subsystem.name().equals(validatedName))) {
      throw new IllegalArgumentException("Duplicate subsystem name " + validatedName);
    }
    EnergySubsystem subsystem = new EnergySubsystem(this, validatedName, subsystems.size());
    subsystems.add(subsystem);
    return subsystem;
  }

  /** Records battery voltage and the registered physical motors' Supply Current sum. */
  public void periodicRobot() {
    long timestampMicros = nowMicros();
    freezeAndPublishDescriptors(timestampMicros);
    if (hasPreviousRobotTimestamp && timestampMicros < previousRobotTimestampMicros) {
      throw new IllegalStateException(
          "Robot time moved backwards: "
              + previousRobotTimestampMicros
              + " -> "
              + timestampMicros);
    }

    double totalSupplyCurrentAmps = 0.0;
    for (EnergySubsystem subsystem : subsystems) {
      totalSupplyCurrentAmps = addOrNaN(totalSupplyCurrentAmps, subsystem.totalSupplyCurrentAmps());
    }
    double batteryVoltageVolts = finiteNonnegativeOrNaN(batteryVoltageSource.getAsDouble());
    double robotTotalSupplyCurrentAmps =
        robotTotalCurrentSource == null
            ? Double.NaN
            : finiteOrNaN(robotTotalCurrentSource.getAsDouble());

    previousRobotTimestampMicros = timestampMicros;
    hasPreviousRobotTimestamp = true;
    sink.recordLong(ROOT + "robot/sampleTimestampUs", timestampMicros, timestampMicros);
    sink.recordDouble(
        ROOT + "robot/supplyCurrentAmps", totalSupplyCurrentAmps, "A", timestampMicros);
    if (robotTotalCurrentSource != null) {
      sink.recordDouble(
          ROOT + "robot/totalSupplyCurrentAmps",
          robotTotalSupplyCurrentAmps,
          "A",
          timestampMicros);
    }
    sink.recordDouble(
        ROOT + "robot/batteryVoltageVolts", batteryVoltageVolts, "V", timestampMicros);
  }

  long nowMicros() {
    long timestampMicros = timeSource.nowMicros();
    if (timestampMicros < 0L || timestampMicros > MAX_SAFE_TIMESTAMP_MICROS) {
      throw new IllegalStateException(
          "EnergyLogger timestamp must be a nonnegative JavaScript-safe integer");
    }
    return timestampMicros;
  }

  LogSink sink() {
    return sink;
  }

  void requireConfigurable() {
    if (frozen) {
      throw new IllegalStateException("EnergyLogger configuration is frozen");
    }
  }

  void freezeAndPublishDescriptors(long timestampMicros) {
    if (!frozen) {
      freeze();
    }
    if (!descriptorsPublished) {
      sink.recordString(ROOT + "contractVersion", CONTRACT_VERSION, timestampMicros);
      sink.recordString(ROOT + "libraryVersion", libraryVersion(), timestampMicros);
      sink.recordString(ROOT + "manifest", manifest, timestampMicros);
      descriptorsPublished = true;
    }
  }

  List<EnergySubsystem> subsystems() {
    return subsystems;
  }

  static String requireName(String value, String description) {
    if (value == null || value.isBlank() || !value.equals(value.strip())) {
      throw new IllegalArgumentException(description + " must be nonblank and have no outer spaces");
    }
    return value;
  }

  static void resetForTesting() {
    instance = new EnergyLogger();
  }

  String manifestForTesting() {
    return manifest;
  }

  private void freeze() {
    if (sink == null) {
      throw new IllegalStateException("EnergyLogger requires a LogSink before periodic is called");
    }
    if (batteryVoltageSource == null) {
      throw new IllegalStateException(
          "EnergyLogger requires a battery-voltage source before periodic is called");
    }
    if (subsystems.isEmpty()) {
      throw new IllegalStateException("EnergyLogger requires at least one subsystem");
    }
    for (EnergySubsystem subsystem : subsystems) {
      subsystem.freeze();
    }
    manifest = ManifestWriter.write(this);
    frozen = true;
  }

  private static String libraryVersion() {
    try (InputStream stream = EnergyLogger.class.getResourceAsStream(VERSION_RESOURCE)) {
      if (stream != null) {
        String resourceVersion = new String(stream.readAllBytes(), StandardCharsets.UTF_8).strip();
        if (resourceVersion.isEmpty()) {
          throw new IllegalStateException("Generated Cyber Power version resource is empty");
        }
        return resourceVersion;
      }
    } catch (IOException error) {
      throw new IllegalStateException("Unable to read generated Cyber Power version", error);
    }
    String implementationVersion = EnergyLogger.class.getPackage().getImplementationVersion();
    if (implementationVersion != null && !implementationVersion.isBlank()) {
      return implementationVersion.strip();
    }
    throw new IllegalStateException("Missing generated Cyber Power version resource");
  }

  private static double addOrNaN(double sum, double value) {
    return Double.isFinite(sum) && Double.isFinite(value) ? sum + value : Double.NaN;
  }

  private static double finiteNonnegativeOrNaN(double value) {
    return Double.isFinite(value) && value >= 0.0 ? value : Double.NaN;
  }

  private static double finiteOrNaN(double value) {
    return Double.isFinite(value) ? value : Double.NaN;
  }
}
