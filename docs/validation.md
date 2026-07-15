# 验证记录

## 历史 v1 金标

真实日志不进入 Git。当前 v1 金标：

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

| 指标 | 结果 |
|---|---:|
| WPILOG | 1.0 / AdvantageKit |
| 完整 records | 2,963,062 |
| 能量范围 | 37.375794–555.366124 s |
| 总能量 | 85.15297648087035 Wh |
| 平均功率（Enabled-only） | 1359.1164895298145 W |
| 峰值功率 / 电流 | 4262.547700747947 W / 509.314775390625 A |
| 最低电压 | 5.68804833984375 V |
| Brownout | 41 次 / 4.486280 s |
| Enabled | 222.133652 s |

预期只有尾截断恢复与单位 metadata 缺失 warning，不得 fatal。

## v1 尾随分隔符兼容

以下日志用 `swerve/` 表示旧聚合节点。解析器必须规范为 ID `swerve`，保留原始显示路径；`swerve//drive` 等中间空段仍 fatal。

| 文件 | SHA-256 | records | 总能量 | fatal |
|---|---|---:|---:|---:|
| `akit_26-05-02_14-23-15_hopper_e6.wpilog` | `2E066129EAFE018E59BDDBB425F53138A70397804C93D11234929AD00A0F56B0` | 1,789,890 | 60.260822 Wh | 0 |
| `akit_26-05-02_14-03-42_hopper_e4.wpilog` | `774E4DE470F5CA66E6C72244110C6D485143475D1A96F2B23E508A780EB99475` | 2,140,298 | 60.536190 Wh | 0 |

## Driver Station 状态

AdvantageKit 使用 `/DriverStation/Enabled`、`Autonomous`、`Test` 与 `MatchType`。没有独立 Teleop entry；Teleop 只在 Enabled=true 且 Autonomous/Test=false 时推导。三份 v1 回归日志默认范围：

| 文件 | 起点 | 终点 |
|---|---:|---:|
| 金标 | 187.593231 s | 420.606922 s |
| hopper e6 | 129.761164 s | 293.815472 s |
| hopper e4 | 210.291942 s | 374.910003 s |

## Supply Current 限流历史模拟

自动回归覆盖：多目标唯一且不形成祖先/后代重叠；电流和功率按 held 比例缩放；累计 Wh 只缩放正增量；存在 Enabled 时平均功率排除 Disabled；robot residual 不从 subsystem 重建；源 typed arrays 不修改。该报告不预测 Battery Voltage、Brownout、Stator Current、机构动作或完成时间。

## v2.3 跨语言契约

Java vendordep 测试生成：

```text
vendordep/build/generated-fixtures/cyber-power-v2.wpilog
WPILOG 1.0 / CyberPowerV23
13 entries / 47 complete records
2 subsystems / 3 motors / 1 Follower
```

验证命令：

```powershell
pnpm vendordep:contract
```

脚本直接调用网页公开 parser，并断言：

- V2-only 日志在没有 v1 totals/动态节点时选择 `sourceContract=v2`；
- `contractVersion` 精确为 `2.3`，packed 原生转速使用 `rad/s`，Stator Current 保留符号；
- Manifest 只有 subsystem `name/motors` 和 motor `name/type/analysisReduction/leader`；
- `samples.width === motors.length * 3`；
- Follower Stator Current 和原生 rotor velocity 槽精确为 `NaN`；
- robot canonical power 等于 held Battery Voltage × 已注册电机合计 Supply Current；
- 异步 subsystem 时间轴不会产生 robot 对 subsystem 的虚假对账 warning；
- 分状态统计与每个 Leader 的同构电机组可生成。

`tests/fixtures/wpilog-builder.ts` 另行生成固定 V2.1/V2.2/V2.3 合成日志，覆盖 V2.1 RPS 到 `rad/s` 的兼容归一化、三版物理指标兼容性、V2.3 signed Stator Current、大小写/namespace root 识别、稀疏 sample-and-hold、packed width、负 Supply Current、无有限 robot 电气区间、Follower 槽和 V1 独立回归。

## v2.3 真实日志回归

```text
filename: akit_26-07-15_07-29-59.wpilog
sha256: 413DB3393A350F217D16E884380FD3F6D3035F9BE1F6803E9F1CFF969C967158
size: 75,710,464 bytes
records: 2,901,736
contract: 2.3
library: 2026.2.2
```

`pnpm log:analyze` 识别 `/RealOutputs/energyLogger`，范围为 `39.797989–703.055780 s`，得到 `76.985659 Wh`、`998.081896 W` 平均功率、`3761.656929 W / 473.18 A` 峰值、`5.656636 V` 最低电压和 0 次 Brownout。文件尾缺 78 bytes 可恢复；除缺少 Brownout Voltage 单位元数据外没有契约错误。

Manifest 包含 `swerve / intake / indexer / shooter` 4 个子系统、20 台物理电机和 13 个 Leader。实际 Leader/Follower 回归至少覆盖：`intake/rollerLeft → rollerRight`、`indexer/frontLeft → frontRight/backRight/backLeft`、`shooter/flywheelUpLeft → flywheelDownLeft/flywheelDownRight/flywheelUpRight`；独立 Leader 不显示自己的重复小字。每个 Leader 都生成与效率门禁同源的 `dt` 加权覆盖率和无效原因；减速比推荐使用完整合格区间而非最多 4096 点抽样，并输出单一推荐减速比、同区间当前/推荐铜耗 Wh、带符号差值和该差值占本组实测正向输入的比例；无可行候选时明确显示不可用。

同一日志按默认比赛范围 `337.600690–644.034707 s` 验证电池代理：正向已注册电机输入 `75.3656 Wh`、正向电量 `8.8377 Ah`、平均电压 `9.4244 V`、最低电压 `5.6566 V`；17 个跨日志空洞的阶跃候选被拒绝，剩余 482 个独立负载阶跃中 472 个方向有效，等效压降代理中位数为 `16.371 mΩ`，62 个局部窗口中 55 个有效，中位数为 `17.003 mΩ`。两种独立方法量级一致，但结果仍只表示已注册电机负载下包含电池、线束、连接器、动态恢复和未记录负载的局部代理。该区间没有日志记录的 Brownout，也没有低于 `5.5 V` 阈值的区间。

三次测量的 72.20 MiB V2.3 日志解析均值为 `571.291 ms`、P95 为 `584.809 ms`，区间分析均值为 `2.410 ms`，峰值 RSS 为 `231.68 MiB`；同一已解析数据上预热后五次电池代理分析均值为 `69.633 ms`、P95 为 `72.319 ms`。该性能结果来自本地 Node 24，生产部署仍固定 Node 22。

## 自动测试

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm bundle:check
pnpm vendordep:contract
```

核心范围：

- WPILOG header/control/typed payload、尾截断和中段损坏；
- 任意命名空间 EnergyLogger root，无队伍白名单；
- v1 sample-and-hold、reset、区间、Brownout、模式、动态层级和历史对账；
- V2.1/V2.2/V2.3 精确 Manifest、固定 entry、独立 producer timestamp、稀疏 held 值、packed 槽与 Worker transferable；
- V2.1 RPS 与 V2.2/V2.3 `rad/s` 归一化后的 canonical 电流/功率/耗电、合并功耗明细、估算驱动效率和减速比推荐；
- CTRE Kraken X44/X60 曲线常数、空载损耗电流、同区间铜耗积分、电机覆盖率分类、异步电池电压事件、精确选区端点、长于 4096 区间的全量 `dt` 评分、Leader/Follower 名称和独立“电机”页；
- V2 电池页的异步 sample-and-hold、非均匀 `dt`、正向 Wh/Ah、`I²t`、局部稳健拟合、独立负载阶跃、弱激励降级、Robot Mode 条件统计、低压与 Brownout 实测事件；
- V1-only 不显示 V2 Card；V2 电流、功率和能量指标明确标为已注册电机口径；
- 飞书登录、session、tenant、Supabase server-only 数据边界与离线缓存；
- 图表共享游标、尖峰保留、子系统显隐、电池局部代理时间序列和模拟页报告。

## 性能与体积门禁

2026-07-14 的隔离 A/B 基线中，纯 TypeScript WPILOG decoder 在三份 v1 真实日志上提升约 30%–32%；本轮不引入 WASM。后续只有在新基准证明 CPU 瓶颈足以覆盖跨边界复制和构建成本时再评估。

生产 build 后运行 `pnpm bundle:check`：

| 门禁 | 上限 |
|---|---:|
| Client assets raw | 1,310,720 B |
| 上传页初始依赖 gzip | 122,880 B |
| ECharts chunk gzip | 204,800 B |
| App public resources raw | 122,880 B |
| PWA precache Brotli | 512,000 B |

预缓存重复 URL 与缺失 URL 必须为 0。
