package com.team8214.cyberpower;

/**
 * Writes Cyber Power values into the robot's logging framework.
 *
 * <p>Paths are relative log names such as {@code energyLogger/robot/supplyCurrentAmps}; the logging
 * framework may place them below its own output namespace. Frameworks that support explicit
 * timestamps should use the supplied timestamp; others may record at call time. Array
 * implementations must consume or copy the value synchronously because the logger reuses its
 * packed buffers.
 */
public interface LogSink {
  /** Records a scalar {@code double}. */
  void recordDouble(String path, double value, String unit, long timestampMicros);

  /** Records an {@code int64}. */
  void recordLong(String path, long value, long timestampMicros);

  /** Records a string. */
  void recordString(String path, String value, long timestampMicros);

  /** Records a packed {@code double[]}. */
  void recordDoubleArray(String path, double[] values, String unit, long timestampMicros);
}
