package com.nextinnovation.cyberpower;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import edu.wpi.first.util.datalog.DataLogReader;
import edu.wpi.first.util.datalog.DataLogRecord;
import edu.wpi.first.util.datalog.DataLogWriter;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.parallel.ResourceLock;

@ResourceLock("energy-logger-singleton")
class WpilibDataLogSinkTest {
  @AfterEach
  void resetSingleton() {
    EnergyLogger.resetForTesting();
  }

  @Test
  void writesEverySupportedTypeWithMetadataAndExplicitTimestamps() throws Exception {
    Path path = Path.of("build", "test-datalog", "sink.wpilog").toAbsolutePath();
    Files.createDirectories(path.getParent());
    Files.deleteIfExists(path);
    try (DataLogWriter writer = new DataLogWriter(path.toString(), "CyberPowerTest")) {
      WpilibDataLogSink sink = new WpilibDataLogSink(writer);
      sink.recordDouble("sample/double", 12.5, "A\"\\\n", 1_001L);
      sink.recordLong("sample/long", 42L, 1_002L);
      sink.recordString("sample/string", "ready", 1_003L);
      sink.recordDoubleArray("sample/doubles", new double[] {1.0, Double.NaN}, "W", 1_004L);
      assertThrows(
          IllegalArgumentException.class,
          () -> sink.recordDouble("sample/double", 0.0, "V", 1_006L));
      assertThrows(
          IllegalArgumentException.class,
          () -> sink.recordDouble(" ", 0.0, "V", 1_006L));
      writer.flush();
    }

    DecodedLog log = readWhenRecordCount(path, "sample/double", 1);
    assertTrue(log.valid);
    assertEquals("CyberPowerTest", log.extraHeader);
    assertStart(log, "sample/double", "double", "{\"units\":\"A\\\"\\\\\\n\"}");
    assertStart(log, "sample/long", "int64", "");
    assertStart(log, "sample/string", "string", "");
    assertStart(log, "sample/doubles", "double[]", "{\"units\":\"W\"}");
    assertEquals(List.of(1_001L), timestamps(log, "sample/double"));
    assertEquals(12.5, (double) onlyValue(log, "sample/double"), 1.0e-9);
    assertEquals(42L, onlyValue(log, "sample/long"));
    assertEquals("ready", onlyValue(log, "sample/string"));
    assertArrayEquals(new double[] {1.0, Double.NaN}, (double[]) onlyValue(log, "sample/doubles"));
  }

  @Test
  void generatesStandaloneV23FixtureWithIndependentSubsystemClocks() throws Exception {
    Path fixture =
        Path.of("build", "generated-fixtures", "cyber-power-v2.wpilog").toAbsolutePath();
    Files.createDirectories(fixture.getParent());
    Files.deleteIfExists(fixture);

    AtomicLong clock = new AtomicLong(1_000_000L);
    double[] batteryVoltage = {12.0};
    double[] driveCurrent = {18.0};
    double[] followerCurrent = {16.0};
    double[] driveVelocity = {70.0};
    double[] shooterCurrent = {0.0};

    try (DataLogWriter writer = new DataLogWriter(fixture.toString(), "CyberPowerV23")) {
      WpilibDataLogSink sink = new WpilibDataLogSink(writer);
      EnergyLogger logger =
          EnergyLogger.getInstance()
              .registerLogSink(sink)
              .registerTimeSource(clock::get)
              .registerBatteryVoltageSource(() -> batteryVoltage[0]);
      EnergySubsystem drive = logger.createSubsystem("drive");
      drive.registerLeaderMotor(
          "leftLeader",
          MotorType.NEO,
          6.75,
          () -> true,
          () -> driveCurrent[0],
          () -> -48.0,
          () -> driveVelocity[0]);
      drive.registerFollowerMotor(
          "leftFollower",
          MotorType.NEO,
          6.75,
          "leftLeader",
          () -> true,
          () -> followerCurrent[0]);
      EnergySubsystem shooter = logger.createSubsystem("shooter");
      shooter.registerLeaderMotor(
          "flywheel",
          MotorType.KRAKEN_X60_FOC,
          1.25,
          () -> true,
          () -> shooterCurrent[0],
          () -> 30.0,
          () -> 95.0);

      drive.periodic("IDLE");
      clock.set(1_037_000L);
      shooter.periodic("STOPPED");
      clock.set(1_061_000L);
      logger.periodicRobot();

      driveCurrent[0] = 32.0;
      followerCurrent[0] = 29.0;
      driveVelocity[0] = 88.0;
      clock.set(1_173_000L);
      drive.periodic("DRIVING");
      batteryVoltage[0] = 11.4;
      clock.set(1_231_000L);
      logger.periodicRobot();

      shooterCurrent[0] = 24.0;
      clock.set(1_419_000L);
      shooter.periodic("SPINUP");
      clock.set(1_433_000L);
      logger.periodicRobot();

      driveCurrent[0] = -3.0;
      followerCurrent[0] = -2.0;
      driveVelocity[0] = 20.0;
      clock.set(1_877_000L);
      drive.periodic("BRAKING");
      shooterCurrent[0] = 9.0;
      clock.set(2_041_000L);
      shooter.periodic("HOLD");
      batteryVoltage[0] = 12.2;
      clock.set(2_117_000L);
      logger.periodicRobot();
      sink.recordLong("fixture/end", 1L, 2_117_001L);
      writer.flush();
      Thread.sleep(20L);
      writer.flush();
    }

    DecodedLog log = readWhenRecordCount(fixture, "fixture/end", 1);
    assertTrue(log.valid);
    assertEquals("CyberPowerV23", log.extraHeader);
    assertEquals("2.3", onlyValue(log, "energyLogger/contractVersion"));
    assertEquals("2026.2.2", onlyValue(log, "energyLogger/libraryVersion"));
    assertStart(log, "energyLogger/robot/batteryVoltageVolts", "double", "{\"units\":\"V\"}");
    assertStart(log, "energyLogger/robot/supplyCurrentAmps", "double", "{\"units\":\"A\"}");
    assertStart(log, "energyLogger/subsystems/s0/motors/samples", "double[]", "{\"units\":\"\"}");
    assertEquals(
        List.of(1_000_000L, 1_173_000L, 1_877_000L),
        timestamps(log, "energyLogger/subsystems/s0/sampleTimestampUs"));
    assertEquals(
        List.of(1_037_000L, 1_419_000L, 2_041_000L),
        timestamps(log, "energyLogger/subsystems/s1/sampleTimestampUs"));
    assertEquals(
        List.of(1_061_000L, 1_231_000L, 1_433_000L, 2_117_000L),
        timestamps(log, "energyLogger/robot/sampleTimestampUs"));
    assertArrayEquals(
        new double[] {-3.0, -48.0, 20.0, -2.0, Double.NaN, Double.NaN},
        (double[]) lastValue(log, "energyLogger/subsystems/s0/motors/samples"));
    assertEquals(4.0, (double) lastValue(log, "energyLogger/robot/supplyCurrentAmps"), 1.0e-9);
    assertEquals(
        12.2,
        (double) lastValue(log, "energyLogger/robot/batteryVoltageVolts"),
        1.0e-9,
        () -> log.values.get("energyLogger/robot/batteryVoltageVolts").toString());
    assertTrue(
        log.starts.keySet().stream()
            .noneMatch(
                name ->
                    name.contains("/current/")
                        || name.contains("/power/")
                        || name.contains("/energy/")
                        || name.endsWith("totalCurrent")
                        || name.endsWith("totalPower")
                        || name.endsWith("totalEnergy")));
  }

  private static DecodedLog read(Path path) throws IOException {
    return read(Files.readAllBytes(path));
  }

  private static DecodedLog readWhenRecordCount(
      Path path, String entryName, int expectedCount) throws IOException, InterruptedException {
    DecodedLog latest = null;
    for (int attempt = 0; attempt < 250; attempt++) {
      if (Files.isRegularFile(path) && Files.size(path) >= 12L) {
        latest = read(path);
        if (latest.values.getOrDefault(entryName, List.of()).size() >= expectedCount) {
          return latest;
        }
      }
      Thread.sleep(2L);
    }
    assertNotNull(latest, "DataLogWriter did not produce a readable log");
    return latest;
  }

  private static DecodedLog read(byte[] bytes) {
    DataLogReader reader = new DataLogReader(ByteBuffer.wrap(bytes));
    Map<Integer, DataLogRecord.StartRecordData> startsByEntry = new HashMap<>();
    Map<String, DataLogRecord.StartRecordData> starts = new LinkedHashMap<>();
    Map<String, List<DecodedValue>> values = new LinkedHashMap<>();
    for (DataLogRecord record : reader) {
      if (record.isStart()) {
        DataLogRecord.StartRecordData start = record.getStartData();
        startsByEntry.put(start.entry, start);
        starts.put(start.name, start);
        continue;
      }
      if (record.isControl()) {
        continue;
      }
      DataLogRecord.StartRecordData start = startsByEntry.get(record.getEntry());
      assertNotNull(start, "Every data record must follow its Start record");
      Object value =
          switch (start.type) {
            case "double" -> record.getDouble();
            case "int64" -> record.getInteger();
            case "string", "json" -> record.getString();
            case "double[]" -> record.getDoubleArray();
            default -> record.getRaw();
          };
      values
          .computeIfAbsent(start.name, ignored -> new ArrayList<>())
          .add(new DecodedValue(record.getTimestamp(), value));
    }
    return new DecodedLog(reader.isValid(), reader.getExtraHeader(), starts, values);
  }

  private static void assertStart(DecodedLog log, String name, String type, String metadata) {
    DataLogRecord.StartRecordData start = log.starts.get(name);
    assertNotNull(start, "Missing Start record for " + name);
    assertEquals(type, start.type);
    assertEquals(metadata, start.metadata);
    assertFalse(log.values.getOrDefault(name, List.of()).isEmpty(), "Missing data for " + name);
  }

  private static List<Long> timestamps(DecodedLog log, String name) {
    return log.values.get(name).stream().map(value -> value.timestampMicros).toList();
  }

  private static Object onlyValue(DecodedLog log, String name) {
    assertEquals(1, log.values.get(name).size());
    return log.values.get(name).get(0).value;
  }

  private static Object lastValue(DecodedLog log, String name) {
    List<DecodedValue> values = log.values.get(name);
    return values.get(values.size() - 1).value;
  }

  private record DecodedValue(long timestampMicros, Object value) {}

  private record DecodedLog(
      boolean valid,
      String extraHeader,
      Map<String, DataLogRecord.StartRecordData> starts,
      Map<String, List<DecodedValue>> values) {}
}
