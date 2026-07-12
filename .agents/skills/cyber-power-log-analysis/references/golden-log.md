# Private golden log

The reference artifact is intentionally not committed. Match it by filename and SHA-256 before using these expectations.

```text
filename: akit_26-07-12_15-41-02.wpilog
sha256: 22D94E0CB7E34038F774AC4E13D50476A95FA41869427D1FEFA510FFDD034E0B
size: 62,513,152 bytes
```

Run:

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath "C:\path\akit_26-07-12_15-41-02.wpilog"
pnpm log:analyze -- "C:\path\akit_26-07-12_15-41-02.wpilog" --json
```

Expected full-range values:

| Metric | Expected |
|---|---:|
| Complete records | 2,963,062 |
| Last good byte | 62,513,066 |
| Truncated tail | 33 bytes missing |
| Energy range | 37.375794–555.366124 s |
| Duration | 517.990330 s |
| Total energy | 85.15297648087035 Wh |
| Average power | 591.807795584009 W |
| Peak power | 4262.547700747947 W |
| Peak current | 509.314775390625 A |
| Minimum EnergyLogger voltage | 5.68804833984375 V |
| Brownouts | 41 / 4.486280 s |
| Enabled | 222.133652 s |
| Reconciliation absolute difference | about 1.84e-11 Wh |

Top-level energy:

| Raw path | Wh | Share |
|---|---:|---:|
| swerve | 39.4834232497748 | 46.3676372588729% |
| shooter | 23.1276987109062 | 27.1601765043490% |
| intake | 12.9111233424494 | 15.1622689846346% |
| indexer | 7.82752391220356 | 9.19230805039881% |
| controls | 1.80320726551802 | 2.1176092017447% |

Recommended assertions:

- SHA, record count, byte offsets, and integer microseconds: exact.
- Energy: absolute error at most `1e-9 Wh`.
- Derived average power: absolute error at most `1e-6 W`.
- Power, current, and voltage: `max(1e-9, abs(expected) * 1e-12)`.
- Interval durations: at most `1e-6 s`.
- Percentages: at most `1e-8` percentage points.
- Reconciliation: `max(1e-8 Wh, total * 1e-9)`.
