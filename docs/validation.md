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
| 平均功率（Enabled-only） | 1359.1164895298145 W |
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

## Supply Current 限流估算回归

自动化回归覆盖以下模型约束：

- 顶层终端节点可直接使用合计 Supply Current 上限；聚合节点必须由用户确认其代表同构电机组；
- 多个互不重叠目标作为一次实时模拟原子计算，输入顺序不影响结果；重复节点和祖先/后代组合必须拒绝；
- 模拟页路径表与子系统明细使用相同层级和同级排序，默认折叠；每个可见路径都可直接预填限流值并独立启用，不需要先添加或移除目标；
- 停用行与关闭总开关都保留限流值和聚合确认；折叠路径中的已启用目标必须有可见提示，隐藏路径错误必须在表格外继续可见；
- 电流和功率按 sample-and-hold 同比例缩放；高于已记录峰值的上限不改变结果，上限降低时估算节省量单调不减；
- 累计 Wh 只缩放正增量，reset 分段处理；电流不大于 0 但功率或能量为正的区段保持原样；
- 存在 `Enabled` 时平均功率排除 Disabled，全 Disabled 选区为 `0 W`；
- 整机结果保留未选中负载的残差；明显负的整机扣减结果不得强制钳制为 0，而应保留逐目标结果并将整机估算标记为不可用；
- 源数据的 reset、时间断层、非有限样本、负值、子序列缺失和对账差异会映射为显式估算提示；源 typed arrays 不得被修改。

2026-07-14 在 Node 22.23.1 / pnpm 11.5.0 下使用三份真实日志完成双目标回放；每份均有 26 个可选节点，目标峰值未超过输入上限，输入顺序反转后报告字段逐项一致，高于历史峰值的上限产生严格零变化。估算器只流式生成报告，不再分配或返回未消费的模拟时间轴：

| 日志 | 代表性双目标 | 节省能量 | 估算耗时 |
| --- | --- | ---: | ---: |
| `akit_26-07-12_15-41-02.wpilog` | `indexer=50A` + `swerve/drive/moduleBR=50A` | 4.401447 Wh | 12.237 ms |
| `akit_26-05-02_14-23-15_hopper_e6.wpilog` | `indexer=50A` + 已确认 `shooter/flywheel=50A` | 4.456180 Wh | 7.511 ms |
| `akit_26-05-02_14-03-42_hopper_e4.wpilog` | `indexer=50A` + 已确认 `shooter/flywheel=50A` | 4.908331 Wh | 10.233 ms |

三份日志的整机估算均可用；两份旧日志中的 `swerve/` 尾随斜杠均正确规范化。日志仅从原下载位置读取，未复制或提交到仓库。

这些回归只验证历史反事实模型，不把模拟报告当作真实限流后的硬件测量。电池电压、Brownout、机构动作和 Stator Current 均不在预测范围内。

## 性能与体积门禁

2026-07-14 的正式基线使用 Node 22.23.1 / pnpm 11.5.0。WPILOG decoder 在隔离临时 worktree 中交替执行优化前后版本，各 7 次测量；记录数、可信 byte、issues、区间、能量、峰值、Brownout 与 Enabled-only 平均功率均保持一致：

| 日志 | 优化前中位数 | 优化后中位数 | 改进 |
| --- | ---: | ---: | ---: |
| 金标 59.62 MiB | 746.777 ms | 521.891 ms | 30.1% |
| hopper e6 36.63 MiB | 480.690 ms | 329.760 ms | 31.4% |
| hopper e4 43.81 MiB | 544.869 ms | 372.657 ms | 31.6% |

绝对值受同进程加载两份模块影响，只用作严格 A/B；相对改进决定是否合入。纯 TypeScript 已超过门槛，本轮不引入 WASM。

生产 build 后运行 `pnpm bundle:check`，当前结果：

| 门禁 | 当前值 | 上限 |
| --- | ---: | ---: |
| Client assets raw | 1,050,594 B | 1,310,720 B |
| 上传页初始依赖 gzip | 117,364 B | 122,880 B |
| ECharts chunk gzip | 184,890 B | 204,800 B |
| Public resources raw | 63,322 B | 122,880 B |
| PWA precache Brotli | 353,050 B | 512,000 B |

预缓存重复 URL 与缺失 URL 均为 0。该门禁只依赖构建产物，可在 CI 中运行，不需要提交私有 WPILOG。

## 自动测试范围

- WPILOG header、control record、typed payload、尾截断和中段损坏；
- 通用 UnknownTeam EnergyLogger root，确保无队伍白名单；
- sample-and-hold、能量 reset、区间、Brownout、Enabled/Autonomous/Test/MatchType 状态机、动态层级和 reconciliation；
- 尾随 `/` 聚合路径兼容、中间空段拒绝和规范化冲突拒绝；
- 飞书 state、PKCE、returnTo、生产 callback、签名 Cookie、code exchange、tenant 校验与 Supabase 用户资料 upsert；
- Worker progress/result/error、typed-array transferable、取消与同 requestId 替换；
- 图表 min/max 包络抽样、阶梯采样保持、共享游标同步和三类子系统图，确保功率和电流尖峰不会被等步长抽样丢失；
- 多目标 Supply Current 实时模拟、sample-and-hold 缩放、累计能量 reset、Enabled-only 平均功率、整机残差保留，以及“模拟”页报告与总开关；
- 模拟功能不渲染专用图表且不接入整机/子系统图表，关闭总开关后配置保留、报告隐藏；
- React Router 生产 build、PWA manifest/service worker 与客户端 secret 扫描。
- bundle 初始依赖、ECharts、公共资源和 PWA 预缓存体积预算，以及重复/缺失预缓存 URL。
