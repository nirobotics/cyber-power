package com.nextinnovation.cyberpower;

import edu.wpi.first.util.datalog.DataLog;
import edu.wpi.first.util.datalog.DoubleArrayLogEntry;
import edu.wpi.first.util.datalog.DoubleLogEntry;
import edu.wpi.first.util.datalog.IntegerLogEntry;
import edu.wpi.first.util.datalog.StringLogEntry;
import java.util.HashMap;
import java.util.Map;
import java.util.Objects;

/** Official {@link DataLog} adapter for Cyber Power. */
public final class WpilibDataLogSink implements LogSink {
  private final DataLog log;
  private final Map<String, DoubleLogEntry> doubles = new HashMap<>();
  private final Map<String, IntegerLogEntry> longs = new HashMap<>();
  private final Map<String, StringLogEntry> strings = new HashMap<>();
  private final Map<String, DoubleArrayLogEntry> doubleArrays = new HashMap<>();
  private final Map<String, String> doubleUnits = new HashMap<>();
  private final Map<String, String> doubleArrayUnits = new HashMap<>();

  /** Creates a sink that appends to {@code log}. */
  public WpilibDataLogSink(DataLog log) {
    this.log = Objects.requireNonNull(log, "log");
  }

  @Override
  public void recordDouble(String path, double value, String unit, long timestampMicros) {
    validateUnit(doubleUnits, path, unit);
    DoubleLogEntry entry =
        doubles.computeIfAbsent(
            path, key -> new DoubleLogEntry(log, key, metadata(unit), timestampMicros));
    entry.append(value, timestampMicros);
  }

  @Override
  public void recordLong(String path, long value, long timestampMicros) {
    validatePath(path);
    IntegerLogEntry entry =
        longs.computeIfAbsent(path, key -> new IntegerLogEntry(log, key, timestampMicros));
    entry.append(value, timestampMicros);
  }

  @Override
  public void recordString(String path, String value, long timestampMicros) {
    validatePath(path);
    Objects.requireNonNull(value, "value");
    StringLogEntry entry =
        strings.computeIfAbsent(path, key -> new StringLogEntry(log, key, timestampMicros));
    entry.append(value, timestampMicros);
  }

  @Override
  public void recordDoubleArray(
      String path, double[] values, String unit, long timestampMicros) {
    validateUnit(doubleArrayUnits, path, unit);
    Objects.requireNonNull(values, "values");
    DoubleArrayLogEntry entry =
        doubleArrays.computeIfAbsent(
            path, key -> new DoubleArrayLogEntry(log, key, metadata(unit), timestampMicros));
    entry.append(values, timestampMicros);
  }

  private static void validateUnit(Map<String, String> units, String path, String unit) {
    validatePath(path);
    Objects.requireNonNull(unit, "unit");
    String previous = units.putIfAbsent(path, unit);
    if (previous != null && !previous.equals(unit)) {
      throw new IllegalArgumentException(
          "Unit for " + path + " changed from " + previous + " to " + unit);
    }
  }

  private static void validatePath(String path) {
    if (path == null || path.isBlank()) {
      throw new IllegalArgumentException("Log path must not be blank");
    }
  }

  private static String metadata(String unit) {
    StringBuilder result = new StringBuilder(unit.length() + 12);
    result.append("{\"units\":\"");
    JsonEscaper.appendEscaped(result, unit);
    result.append("\"}");
    return result.toString();
  }
}
