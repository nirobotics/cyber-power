# NI EnergyLogger data contract

## Contents

- Required WPILOG container behavior
- Root and entry discovery
- Dynamic hierarchy
- Metric definitions
- Optional robot state
- Error policy

## Required WPILOG container behavior

Accept WPILOG 1.0 with little-endian variable-width record fields. Maintain entry generations across Start, Finish, and SetMetadata control records. Decode only supported types, but bounds-check and skip every unknown payload correctly.

Keep `lastGoodOffset`. A record cut off at end-of-file is `TRUNCATED_TAIL_RECOVERED`; malformed lengths, reserved bits, invalid controls, or corruption before a later record are fatal.

## Root and entry discovery

Find candidate roots from these required `double` entries:

```text
<root>/totalCurrent
<root>/totalPower
<root>/totalEnergy
```

`<root>` must end in `energyLogger` and may be namespaced, for example `/RealOutputs/energyLogger` or `/ReplayOutputs/energyLogger`. Select a single complete root using deterministic priority; reject unresolved ambiguity.

At least one dynamic raw path must provide all three `double` entries:

```text
<root>/current/<raw-path>
<root>/power/<raw-path>
<root>/energy/<raw-path>
```

Do not use team number, `ProjectName`, season, or subsystem allowlists.

## Dynamic hierarchy

EnergyLogger callers choose `<raw-path>`. Slash and hyphen separators express hierarchy; canonical parent IDs use slash. Preserve each raw path for display and reject two distinct raw paths that normalize to the same canonical ID.

Parent series may already aggregate children. Never add an aggregate to its descendants when computing totals. Compare the total against top-level nodes and each aggregate against its direct children; emit reconciliation warnings outside tolerance.

Current and power are instantaneous sample-and-hold state. Energy is cumulative Wh. AdvantageKit may omit unchanged values, so absence of a record is not zero.

## Metric definitions

- Selection energy: cumulative delta `E(end) - E(start)`, with reset handling.
- Average power: `energyWh * 3600 / durationSeconds`.
- Peak power and current: extrema inside the selected inclusive time range.
- Minimum voltage: minimum optional battery series inside the range.
- Brownout count and duration: intersections of true intervals with the range.
- Enabled duration: intersection of Driver Station Enabled intervals with the range.
- Share: a node's energy divided by the energy of its siblings for the same parent.

Use integer microseconds internally for bounds and seconds only for display or CLI options.

## Optional robot state

Prefer namespaced entries matching the selected EnergyLogger root:

```text
energyLogger/BatteryVoltageVolt
SystemStats/BatteryVoltage
SystemStats/BrownedOut
SystemStats/BrownoutVoltage
DriverStation/Enabled
DriverStation/Autonomous
DriverStation/Teleop
```

Missing optional entries reduce the available UI but do not make an otherwise valid EnergyLogger log incompatible. Render absent values as unavailable.

## Error policy

Fatal examples:

- invalid magic or unsupported WPILOG version;
- structural middle corruption;
- missing or wrong-typed totals;
- no finite total energy samples;
- no complete dynamic current/power/energy path;
- ambiguous root or normalized path collision.

Warning examples:

- recovered truncated tail;
- missing or mismatched unit metadata;
- missing optional voltage or DS state;
- cumulative energy reset, time gap, negative value, or dropped non-finite sample;
- total-to-subsystem reconciliation mismatch;
- replay/simulation root or partial dynamic subseries.
