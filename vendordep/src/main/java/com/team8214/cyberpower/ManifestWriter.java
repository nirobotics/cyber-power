package com.team8214.cyberpower;

/** Writes the immutable EnergyLogger v2.4 manifest once at configuration freeze. */
final class ManifestWriter {
  private final StringBuilder output = new StringBuilder(1024);

  private ManifestWriter() {}

  static String write(EnergyLogger logger) {
    ManifestWriter writer = new ManifestWriter();
    writer.output.append("{\"subsystems\":[");
    for (int subsystemIndex = 0;
        subsystemIndex < logger.subsystems().size();
        subsystemIndex++) {
      if (subsystemIndex > 0) {
        writer.output.append(',');
      }
      writer.writeSubsystem(logger.subsystems().get(subsystemIndex));
    }
    writer.output.append("]}");
    return writer.output.toString();
  }

  private void writeSubsystem(EnergySubsystem subsystem) {
    output.append("{\"name\":");
    string(subsystem.name());
    output.append(",\"motors\":[");
    for (int motorIndex = 0; motorIndex < subsystem.motors().size(); motorIndex++) {
      if (motorIndex > 0) {
        output.append(',');
      }
      writeMotor(subsystem.motors().get(motorIndex));
    }
    output.append("]}");
  }

  private void writeMotor(EnergySubsystem.MotorRegistration motor) {
    output.append("{\"name\":");
    string(motor.name);
    output.append(",\"type\":");
    if (motor.type == null) {
      output.append("null");
    } else {
      string(motor.type.name());
    }
    output.append(",\"analysisReduction\":");
    if (motor.analysisReduction == null) {
      output.append("null");
    } else {
      output.append(Double.toString(motor.analysisReduction));
    }
    output.append(",\"leader\":");
    if (motor.leaderName == null) {
      output.append("null");
    } else {
      string(motor.leaderName);
    }
    output.append('}');
  }

  private void string(String value) {
    output.append('"');
    JsonEscaper.appendEscaped(output, value);
    output.append('"');
  }
}
