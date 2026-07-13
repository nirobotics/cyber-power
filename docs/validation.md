# 验证记录

## 私有真实日志

真实日志不进入 Git。当前金标：

```text
filename: akit_26-07-12_15-41-02.wpilog
sha256: 22D94E0CB7E34038F774AC4E13D50476A95FA41869427D1FEFA510FFDD034E0B
size: 62,513,152 bytes
```

命令：

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath "C:\path\akit_26-07-12_15-41-02.wpilog"
pnpm log:list -- "C:\path\akit_26-07-12_15-41-02.wpilog"
pnpm log:analyze -- "C:\path\akit_26-07-12_15-41-02.wpilog" --json
```

## 金标结果

| 指标 | 结果 |
|---|---:|
| WPILOG | 1.0 / AdvantageKit |
| 完整 records | 2,963,062 |
| 最后可信 byte | 62,513,066 |
| 可恢复尾截断 | 缺 33 bytes |
| 能量范围 | 37.375794–555.366124 s |
| 时长 | 517.990330 s |
| 总能量 | 85.15297648087035 Wh |
| 平均功率 | 591.807795584009 W |
| 峰值功率 | 4262.547700747947 W |
| 峰值电流 | 509.314775390625 A |
| 最低电压 | 5.68804833984375 V |
| Brownout | 41 次 / 4.486280 s |
| Enabled | 222.133652 s |
| 顶层对账差 | 约 1.84e-11 Wh |

顶层子系统：

| 路径 | Wh | 占比 |
|---|---:|---:|
| swerve | 39.4834232497748 | 46.3676372588729% |
| shooter | 23.1276987109062 | 27.1601765043490% |
| intake | 12.9111233424494 | 15.1622689846346% |
| indexer | 7.82752391220356 | 9.19230805039881% |
| controls | 1.80320726551802 | 2.1176092017447% |

预期 warnings：尾部截断已恢复、两个单位 metadata 缺失、Teleop 可选序列缺失。不得出现 fatal。

## 自动测试范围

- WPILOG header、control record、typed payload、尾截断和中段损坏；
- 通用 UnknownTeam EnergyLogger root，确保无队伍白名单；
- sample-and-hold、能量 reset、区间、Brownout、DS mode、动态层级和 reconciliation；
- 飞书 state、PKCE、returnTo、生产 callback、签名 Cookie、code exchange、tenant 校验与 Supabase 用户资料 upsert；
- Worker progress/result/error、typed-array transferable、取消与同 requestId 替换；
- 图表 min/max 包络抽样，确保功率和电流尖峰不会被等步长抽样丢失；
- React Router 生产 build、PWA manifest/service worker 与客户端 secret 扫描。
