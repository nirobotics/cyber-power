package com.team8214.cyberpower;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Arrays;
import java.util.List;
import java.util.Set;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class EnergyLoggerTest {
  private static final double EPSILON = 1e-9;

  private enum State {
    IDLE,
    RUNNING
  }

  private final AtomicLong clock = new AtomicLong(1_000_000L);
  private RecordingLogSink sink;
  private EnergyLogger logger;

  @BeforeEach
  void setUp() {
    EnergyLogger.resetForTesting();
    sink = new RecordingLogSink();
    logger =
        EnergyLogger.getInstance()
            .registerLogSink(sink)
            .registerTimeSource(clock::get)
            .registerBatteryVoltageSource(() -> 11.7);
  }

  @AfterEach
  void tearDown() {
    EnergyLogger.resetForTesting();
  }

  @Test
  void writesTheMinimalV24Contract() {
    double[] leaderCurrent = {10.0};
    double[] leaderStator = {-42.0};
    double[] leaderVelocity = {-75.0};
    double[] followerCurrent = {-2.0};
    double[] shooterCurrent = {3.0};

    EnergySubsystem drive = logger.createSubsystem("drive");
    drive.registerMotor(
        new MotorConfig(
            "frontLeft",
            MotorType.NEO,
            6.75,
            () -> true,
            () -> leaderCurrent[0],
            () -> leaderStator[0],
            () -> leaderVelocity[0]),
        new FollowerMotorConfig(
            "frontRight", () -> true, () -> followerCurrent[0]));

    EnergySubsystem shooter = logger.createSubsystem("shooter");
    shooter.registerMotor(
        new MotorConfig(
            "flywheel",
            MotorType.KRAKEN_X60_FOC,
            1.5,
            () -> true,
            () -> shooterCurrent[0],
            () -> 25.0,
            () -> 95.0));

    drive.periodic(State.IDLE);
    clock.set(1_100_000L);
    shooter.periodic("SPINUP");
    clock.set(1_200_000L);
    logger.periodicRobot();

    assertEquals("2.4", sink.last("energyLogger/contractVersion").value());
    assertEquals(
        System.getProperty("cyberPower.version"),
        sink.last("energyLogger/libraryVersion").value());
    assertEquals(
        "{\"subsystems\":[{\"name\":\"drive\",\"motors\":["
            + "{\"name\":\"frontLeft\",\"type\":\"NEO\","
            + "\"analysisReduction\":6.75,\"leader\":null},"
            + "{\"name\":\"frontRight\",\"type\":\"NEO\","
            + "\"analysisReduction\":6.75,\"leader\":\"frontLeft\"}]},"
            + "{\"name\":\"shooter\",\"motors\":["
            + "{\"name\":\"flywheel\",\"type\":\"KRAKEN_X60_FOC\","
            + "\"analysisReduction\":1.5,\"leader\":null}]}]}",
        sink.last("energyLogger/manifest").value());

    assertArrayEquals(
        new double[] {10.0, -42.0, -75.0, -2.0, Double.NaN, Double.NaN},
        samples("energyLogger/subsystems/s0/motors/samples"));
    assertArrayEquals(
        new double[] {3.0, 25.0, 95.0},
        samples("energyLogger/subsystems/s1/motors/samples"));
    assertEquals(State.IDLE.name(), sink.last("energyLogger/subsystems/s0/state").value());
    assertEquals("SPINUP", sink.last("energyLogger/subsystems/s1/state").value());
    assertEquals(1_000_000L, sink.last("energyLogger/subsystems/s0/sampleTimestampUs").value());
    assertEquals(1_100_000L, sink.last("energyLogger/subsystems/s1/sampleTimestampUs").value());
    assertEquals(11.0, (double) sink.last("energyLogger/robot/supplyCurrentAmps").value(), EPSILON);
    assertEquals(11.7, (double) sink.last("energyLogger/robot/batteryVoltageVolts").value(), EPSILON);
    assertEquals(1_200_000L, sink.last("energyLogger/robot/sampleTimestampUs").value());

    assertEquals(
        Set.of(
            "energyLogger/contractVersion",
            "energyLogger/libraryVersion",
            "energyLogger/manifest",
            "energyLogger/robot/sampleTimestampUs",
            "energyLogger/robot/supplyCurrentAmps",
            "energyLogger/robot/batteryVoltageVolts",
            "energyLogger/subsystems/s0/sampleTimestampUs",
            "energyLogger/subsystems/s0/state",
            "energyLogger/subsystems/s0/motors/samples",
            "energyLogger/subsystems/s1/sampleTimestampUs",
            "energyLogger/subsystems/s1/state",
            "energyLogger/subsystems/s1/motors/samples"),
        sink.paths());
    assertTrue(
        sink.paths().stream()
            .noneMatch(
                path ->
                    path.contains("/current/")
                        || path.contains("/power/")
                        || path.contains("/energy/")
                        || path.endsWith("totalCurrent")
                        || path.endsWith("totalPower")
                        || path.endsWith("totalEnergy")));
  }

  @Test
  void writesSupplyOnlyMotorGroupWithNullAnalysisMetadata() {
    EnergySubsystem subsystem = logger.createSubsystem("intake");
    subsystem.registerMotor(
        new MotorConfig("leader", () -> true, () -> 7.0),
        new FollowerMotorConfig("follower", () -> true, () -> -2.0));

    subsystem.periodic("RUNNING");
    logger.periodicRobot();

    assertEquals(
        "{\"subsystems\":[{\"name\":\"intake\",\"motors\":["
            + "{\"name\":\"leader\",\"type\":null,\"analysisReduction\":null,"
            + "\"leader\":null},"
            + "{\"name\":\"follower\",\"type\":null,\"analysisReduction\":null,"
            + "\"leader\":\"leader\"}]}]}",
        sink.last("energyLogger/manifest").value());
    assertArrayEquals(
        new double[] {7.0, Double.NaN, Double.NaN, -2.0, Double.NaN, Double.NaN},
        samples("energyLogger/subsystems/s0/motors/samples"));
    assertEquals(5.0, (double) sink.last("energyLogger/robot/supplyCurrentAmps").value(), EPSILON);
  }

  @Test
  void writesOptionalSignedRobotTotalCurrentAndNormalizesNonfiniteValues() {
    double[] totalCurrent = {-8.0};
    logger.registerRobotTotalCurrentSource(() -> totalCurrent[0]);
    EnergySubsystem subsystem = logger.createSubsystem("drive");
    subsystem.registerMotor(new MotorConfig("motor", () -> true, () -> 1.0));
    subsystem.periodic("READY");

    logger.periodicRobot();
    assertEquals(
        -8.0,
        (double) sink.last("energyLogger/robot/totalSupplyCurrentAmps").value(),
        EPSILON);

    totalCurrent[0] = Double.POSITIVE_INFINITY;
    clock.incrementAndGet();
    logger.periodicRobot();
    assertTrue(
        Double.isNaN(
            (double) sink.last("energyLogger/robot/totalSupplyCurrentAmps").value()));
  }

  @Test
  void samplesEachSupplierOnceAndPreservesPackedSlots() {
    AtomicInteger leaderConnectedCalls = new AtomicInteger();
    AtomicInteger followerConnectedCalls = new AtomicInteger();
    AtomicInteger supplyCalls = new AtomicInteger();
    AtomicInteger statorCalls = new AtomicInteger();
    AtomicInteger velocityCalls = new AtomicInteger();
    AtomicInteger followerCalls = new AtomicInteger();

    EnergySubsystem subsystem = logger.createSubsystem("arm");
    subsystem.registerMotor(
        new MotorConfig(
            "pivot",
            MotorType.KRAKEN_X44_FOC,
            5.0,
            () -> {
              leaderConnectedCalls.incrementAndGet();
              return true;
            },
            () -> {
              supplyCalls.incrementAndGet();
              return Double.NaN;
            },
            () -> {
              statorCalls.incrementAndGet();
              return -12.5;
            },
            () -> {
              velocityCalls.incrementAndGet();
              return Double.POSITIVE_INFINITY;
            }),
        new FollowerMotorConfig(
            "pivotFollower",
            () -> {
              followerConnectedCalls.incrementAndGet();
              return true;
            },
            () -> {
              followerCalls.incrementAndGet();
              return 4.0;
            }));

    subsystem.periodic("HOLD");
    logger.periodicRobot();

    assertEquals(1, leaderConnectedCalls.get());
    assertEquals(1, followerConnectedCalls.get());
    assertEquals(1, supplyCalls.get());
    assertEquals(1, statorCalls.get());
    assertEquals(1, velocityCalls.get());
    assertEquals(1, followerCalls.get());
    double[] values = samples("energyLogger/subsystems/s0/motors/samples");
    assertEquals(6, values.length);
    assertTrue(Double.isNaN(values[0]));
    assertEquals(-12.5, values[1], EPSILON);
    assertTrue(Double.isNaN(values[2]));
    assertEquals(4.0, values[3], EPSILON);
    assertTrue(Double.isNaN(values[4]));
    assertTrue(Double.isNaN(values[5]));
    assertTrue(Double.isNaN((double) sink.last("energyLogger/robot/supplyCurrentAmps").value()));
  }

  @Test
  void disconnectedMotorsWriteNaNWithoutSamplingNumericSuppliers() {
    AtomicInteger leaderConnectedCalls = new AtomicInteger();
    AtomicInteger followerConnectedCalls = new AtomicInteger();
    AtomicInteger numericCalls = new AtomicInteger();

    EnergySubsystem subsystem = logger.createSubsystem("arm");
    subsystem.registerMotor(
        new MotorConfig(
            "pivot",
            MotorType.KRAKEN_X44_FOC,
            5.0,
            () -> {
              leaderConnectedCalls.incrementAndGet();
              return false;
            },
            () -> numericCalls.incrementAndGet(),
            () -> numericCalls.incrementAndGet(),
            () -> numericCalls.incrementAndGet()),
        new FollowerMotorConfig(
            "pivotFollower",
            () -> {
              followerConnectedCalls.incrementAndGet();
              return false;
            },
            () -> numericCalls.incrementAndGet()));

    subsystem.periodic("HOLD");
    logger.periodicRobot();

    assertEquals(1, leaderConnectedCalls.get());
    assertEquals(1, followerConnectedCalls.get());
    assertEquals(0, numericCalls.get());
    assertArrayEquals(
        new double[] {
          Double.NaN, Double.NaN, Double.NaN, Double.NaN, Double.NaN, Double.NaN
        },
        samples("energyLogger/subsystems/s0/motors/samples"));
    assertTrue(Double.isNaN((double) sink.last("energyLogger/robot/supplyCurrentAmps").value()));
  }

  @Test
  void validatesConfigurationAndAtomicallyRegistersMotorGroups() {
    assertThrows(IllegalArgumentException.class, () -> logger.createSubsystem(" "));
    EnergySubsystem drive = logger.createSubsystem("drive");
    assertThrows(IllegalArgumentException.class, () -> logger.createSubsystem("drive"));
    assertThrows(
        IllegalArgumentException.class,
        () ->
            drive.registerMotor(
                new MotorConfig(
                    "invalid",
                    MotorType.NEO,
                    0.0,
                    () -> true,
                    () -> 1.0,
                    () -> 1.0,
                    () -> 1.0)));

    drive.registerMotor(
        new MotorConfig(
            "leader",
            MotorType.NEO,
            6.75,
            () -> true,
            () -> 1.0,
            () -> 2.0,
            () -> 3.0),
        new FollowerMotorConfig("follower", () -> true, () -> 1.0));
    assertThrows(
        IllegalArgumentException.class,
        () ->
            drive.registerMotor(
                new MotorConfig("atomic", () -> true, () -> 1.0),
                new FollowerMotorConfig("duplicate", () -> true, () -> 1.0),
                new FollowerMotorConfig("duplicate", () -> true, () -> 1.0)));
    drive.registerMotor(
        new MotorConfig("atomic", () -> true, () -> 1.0),
        new FollowerMotorConfig("first", () -> true, () -> 1.0),
        new FollowerMotorConfig("second", () -> true, () -> 1.0));
    assertEquals(
        List.of("leader", "follower", "atomic", "first", "second"),
        drive.motors().stream().map(motor -> motor.name).toList());
    assertThrows(
        IllegalArgumentException.class,
        () ->
            drive.registerMotor(
                new MotorConfig(
                    "leader",
                    MotorType.NEO,
                    6.75,
                    () -> true,
                    () -> 1.0,
                    () -> 1.0,
                    () -> 1.0)));

    drive.periodic("READY");
    assertThrows(
        IllegalStateException.class,
        () ->
            drive.registerMotor(
                new MotorConfig(
                    "late",
                    MotorType.NEO,
                    1.0,
                    () -> true,
                    () -> 1.0,
                    () -> 1.0,
                    () -> 1.0)));
    assertThrows(
        IllegalStateException.class,
        () -> logger.registerBatteryVoltageSource(() -> 12.0));
  }

  @Test
  void requiresSinkBatterySubsystemAndMotor() {
    EnergyLogger.resetForTesting();
    EnergyLogger noSink =
        EnergyLogger.getInstance()
            .registerTimeSource(clock::get)
            .registerBatteryVoltageSource(() -> 12.0);
    EnergySubsystem noSinkSubsystem = noSink.createSubsystem("drive");
    noSinkSubsystem.registerMotor(
        new MotorConfig(
            "motor", MotorType.NEO, 1.0, () -> true, () -> 1.0, () -> 1.0, () -> 1.0));
    assertThrows(IllegalStateException.class, noSink::periodicRobot);

    EnergyLogger.resetForTesting();
    EnergyLogger noBattery =
        EnergyLogger.getInstance().registerLogSink(sink).registerTimeSource(clock::get);
    EnergySubsystem noBatterySubsystem = noBattery.createSubsystem("drive");
    noBatterySubsystem.registerMotor(
        new MotorConfig(
            "motor", MotorType.NEO, 1.0, () -> true, () -> 1.0, () -> 1.0, () -> 1.0));
    assertThrows(IllegalStateException.class, noBattery::periodicRobot);

    EnergyLogger.resetForTesting();
    EnergyLogger noSubsystem =
        EnergyLogger.getInstance()
            .registerLogSink(sink)
            .registerTimeSource(clock::get)
            .registerBatteryVoltageSource(() -> 12.0);
    assertThrows(IllegalStateException.class, noSubsystem::periodicRobot);

    EnergyLogger.resetForTesting();
    EnergyLogger emptyLogger =
        EnergyLogger.getInstance()
            .registerLogSink(sink)
            .registerTimeSource(clock::get)
            .registerBatteryVoltageSource(() -> 12.0);
    EnergySubsystem empty = emptyLogger.createSubsystem("empty");
    assertThrows(IllegalStateException.class, () -> empty.periodic("IDLE"));
  }

  @Test
  void acceptsSafeEqualTimestampsAndRejectsRollback() {
    EnergySubsystem subsystem = logger.createSubsystem("drive");
    subsystem.registerMotor(
        new MotorConfig(
            "motor", MotorType.NEO, 1.0, () -> true, () -> 1.0, () -> 2.0, () -> 3.0));
    subsystem.periodic("ONE");
    subsystem.periodic("TWO");
    logger.periodicRobot();
    logger.periodicRobot();

    clock.set(999_999L);
    assertThrows(IllegalStateException.class, () -> subsystem.periodic("BACKWARDS"));
    assertThrows(IllegalStateException.class, logger::periodicRobot);

    EnergyLogger.resetForTesting();
    AtomicLong maximum = new AtomicLong(EnergyLogger.MAX_SAFE_TIMESTAMP_MICROS);
    EnergyLogger maxLogger =
        EnergyLogger.getInstance()
            .registerLogSink(new RecordingLogSink())
            .registerTimeSource(maximum::get)
            .registerBatteryVoltageSource(() -> 12.0);
    EnergySubsystem maxSubsystem = maxLogger.createSubsystem("drive");
    maxSubsystem.registerMotor(
        new MotorConfig(
            "motor", MotorType.NEO, 1.0, () -> true, () -> 1.0, () -> 2.0, () -> 3.0));
    maxSubsystem.periodic("READY");
    maxLogger.periodicRobot();
    maximum.incrementAndGet();
    assertThrows(IllegalStateException.class, maxLogger::periodicRobot);
  }

  @Test
  void motorTypesAreClosedAndKnown() {
    assertArrayEquals(
        new String[] {
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
          "NEO_VORTEX"
        },
        Arrays.stream(MotorType.values()).map(Enum::name).toArray(String[]::new));
    assertFalse(Arrays.stream(MotorType.values()).anyMatch(type -> type.name().contains("UNKNOWN")));
    assertFalse(Arrays.stream(MotorType.values()).anyMatch(type -> type.name().contains("CUSTOM")));
  }

  private double[] samples(String path) {
    return (double[]) sink.last(path).value();
  }
}
