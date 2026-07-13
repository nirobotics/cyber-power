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

Legacy EnergyLogger logs may use one trailing `/` to mark an aggregate node, for example `swerve/`. Ignore that marker when deriving the canonical ID while preserving it in the raw path. Continue to reject leading separators, repeated separators, trailing hyphens, and all other empty hierarchy segments.

Parent series may already aggregate children. Never add an aggregate to its descendants when computing totals. Compare the total against top-level nodes and each aggregate against its direct children; emit reconciliation warnings outside tolerance.

Current and power are instantaneous sample-and-hold state. Energy is cumulative Wh. AdvantageKit may omit unchanged values, so absence of a record is not zero.

## Metric definitions

- Selection energy: cumulative delta `E(end) - E(start)`, with reset handling.
- Average power: when Driver Station Enabled is available, sum cumulative energy deltas only
  across the selected range's Enabled interval intersections and divide by their total duration;
  an all-Disabled selection is `0 W`. When Enabled is unavailable, fall back to
  `energyWh * 3600 / durationSeconds` over the complete selection.
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
DriverStation/Test
DriverStation/MatchType
```

AdvantageKit records `Enabled`, `Autonomous`, and `Test` as sample-and-hold boolean
control-word state. It does not record a separate Teleop series; derive Teleop only when
Enabled is true and both Autonomous and Test are known false. `MatchType` is an `int64`
enum (`0=None`, `1=Practice`, `2=Qualification`, `3=Elimination`). Match-type changes
split mode intervals, and an interval is Practice only when the held value is `1`.

Do not invent a specific mode when state is missing. Without Enabled, mode intervals are
unavailable. With Enabled but an unknown Autonomous or Test value, retain a generic enabled
mode unless a true Autonomous or Test value identifies the state.

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
