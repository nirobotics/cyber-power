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

预期 warnings：尾部截断已恢复、两个单位 metadata 缺失。不得出现 fatal。标准 AdvantageKit 不记录独立 Teleop 序列，Teleop 由 Enabled、Autonomous 与 Test 推导，因此不应产生缺失提示。

## 旧版尾随分隔符兼容回归

以下两份私有日志使用 `swerve/` 表示聚合节点。解析器必须将单个尾随 `/` 规范为节点 ID `swerve`，同时保留原始显示路径；中间空段（如 `swerve//drive`）和规范化冲突仍必须 fatal。

| 文件 | SHA-256 | 大小 | records | 总能量 | 峰值功率 / 电流 | fatal |
|---|---|---:|---:|---:|---:|---:|
| `akit_26-05-02_14-23-15_hopper_e6.wpilog` | `2E066129EAFE018E59BDDBB425F53138A70397804C93D11234929AD00A0F56B0` | 38,404,096 bytes | 1,789,890 | 60.260822 Wh | 3,802.852630 W / 516.941201 A | 0 |
| `akit_26-05-02_14-03-42_hopper_e4.wpilog` | `774E4DE470F5CA66E6C72244110C6D485143475D1A96F2B23E508A780EB99475` | 45,940,736 bytes | 2,140,298 | 60.536190 Wh | 3,453.081811 W / 501.044414 A | 0 |

两份日志均只有 3 项可恢复提示：尾截断 1 项、单位 metadata 缺失 2 项。

## Driver Station 状态契约回归

真实 AdvantageKit 日志使用 `boolean` 的 `/DriverStation/Enabled`、`/DriverStation/Autonomous`、`/DriverStation/Test` 与 `int64` 的 `/DriverStation/MatchType`。日志没有独立 `/DriverStation/Teleop`；仅当 Enabled 为 true 且 Autonomous、Test 均已知为 false 时推导 Teleop。MatchType 映射为 `0=None`、`1=Practice`、`2=Qualification`、`3=Elimination`，其变化必须切分模式区间。

按组合后的机器人模式边界，三份回归日志的默认比赛范围应为：

| 文件 | 起点 | 终点 |
|---|---:|---:|
| `akit_26-07-12_15-41-02.wpilog` | 187.593231 s | 420.606922 s |
| `akit_26-05-02_14-23-15_hopper_e6.wpilog` | 129.761164 s | 293.815472 s |
| `akit_26-05-02_14-03-42_hopper_e4.wpilog` | 210.291942 s | 374.910003 s |

## 自动测试范围

- WPILOG header、control record、typed payload、尾截断和中段损坏；
- 通用 UnknownTeam EnergyLogger root，确保无队伍白名单；
- sample-and-hold、能量 reset、区间、Brownout、Enabled/Autonomous/Test/MatchType 状态机、动态层级和 reconciliation；
- 尾随 `/` 聚合路径兼容、中间空段拒绝和规范化冲突拒绝；
- 飞书 state、PKCE、returnTo、生产 callback、签名 Cookie、code exchange、tenant 校验与 Supabase 用户资料 upsert；
- Worker progress/result/error、typed-array transferable、取消与同 requestId 替换；
- 图表 min/max 包络抽样、阶梯采样保持、共享游标同步和三类子系统图，确保功率和电流尖峰不会被等步长抽样丢失；
- React Router 生产 build、PWA manifest/service worker 与客户端 secret 扫描。
