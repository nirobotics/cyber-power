package com.nextinnovation.cyberpower;

import edu.wpi.first.wpilibj.RobotController;

/** Supplies monotonic timestamps in microseconds for every Cyber Power log record. */
@FunctionalInterface
public interface TimeSource {
  /** Returns the current timestamp in microseconds. */
  long nowMicros();

  /**
   * Returns the standard WPILib monotonic clock used by {@code DataLog}.
   *
   * @return a WPILib-backed time source
   */
  static TimeSource wpilib() {
    return RobotController::getTime;
  }
}
