package com.nextinnovation.cyberpower;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

final class RecordingLogSink implements LogSink {
  record Record(Object value, String unit, long timestampMicros) {}

  private final Map<String, List<Record>> records = new LinkedHashMap<>();

  @Override
  public void recordDouble(String path, double value, String unit, long timestampMicros) {
    add(path, value, unit, timestampMicros);
  }

  @Override
  public void recordLong(String path, long value, long timestampMicros) {
    add(path, value, null, timestampMicros);
  }

  @Override
  public void recordString(String path, String value, long timestampMicros) {
    add(path, value, null, timestampMicros);
  }

  @Override
  public void recordDoubleArray(
      String path, double[] values, String unit, long timestampMicros) {
    add(path, values.clone(), unit, timestampMicros);
  }

  Record last(String path) {
    List<Record> values = records(path);
    return values.get(values.size() - 1);
  }

  List<Record> records(String path) {
    return records.getOrDefault(path, List.of());
  }

  int count(String path) {
    return records(path).size();
  }

  boolean contains(String path) {
    return records.containsKey(path);
  }

  Set<String> paths() {
    return records.keySet();
  }

  private void add(String path, Object value, String unit, long timestampMicros) {
    records
        .computeIfAbsent(path, ignored -> new ArrayList<>())
        .add(new Record(value, unit, timestampMicros));
  }
}
