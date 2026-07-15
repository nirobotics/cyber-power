package com.nextinnovation.cyberpower;

/** Shared JSON string escaping for manifests and WPILib metadata. */
final class JsonEscaper {
  private JsonEscaper() {}

  static void appendEscaped(StringBuilder output, String value) {
    for (int index = 0; index < value.length(); index++) {
      char character = value.charAt(index);
      switch (character) {
        case '"' -> output.append("\\\"");
        case '\\' -> output.append("\\\\");
        case '\b' -> output.append("\\b");
        case '\f' -> output.append("\\f");
        case '\n' -> output.append("\\n");
        case '\r' -> output.append("\\r");
        case '\t' -> output.append("\\t");
        default -> {
          if (character < 0x20) {
            output.append("\\u");
            String hex = Integer.toHexString(character);
            output.append("0".repeat(4 - hex.length())).append(hex);
          } else {
            output.append(character);
          }
        }
      }
    }
  }
}
