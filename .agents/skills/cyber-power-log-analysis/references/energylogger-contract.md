# NI EnergyLogger 数据契约

本文同时定义两条互不依赖的读取路径：

- v1：只用于兼容已有日志；
- v2.3：机器人端当前唯一写入契约；网页可在完全没有 v1 字段时独立解析 v2.1、v2.2 与 v2.3。

不得根据队号、项目名、赛季或固定子系统清单判断兼容性。

## WPILOG 容器

接受 WPILOG 1.0。解析器必须维护 Start、Finish、SetMetadata 的 entry generation，按小端序读取可变长度 record，并对所有 payload 做边界检查。

保留 `lastGoodOffset`。只有文件末尾最后一条不完整 record 可按 `TRUNCATED_TAIL_RECOVERED` 恢复；中段损坏、非法 control、保留位或长度必须 fatal。

AdvantageKit 可能省略与上一值相同的输出。所有字段都是彼此独立的 sample-and-hold 序列；没有新 record 不表示零、空数组或断开。

## v1 历史读取

v1 root 必须以 `energyLogger` 结尾，并包含：

```text
<root>/totalCurrent  double
<root>/totalPower    double
<root>/totalEnergy   double
```

至少一个动态路径必须同时包含：

```text
<root>/current/<raw-path>  double
<root>/power/<raw-path>    double
<root>/energy/<raw-path>   double
```

斜杠和连字符表达旧层级，规范父 ID 使用斜杠。历史日志允许单个末尾 `/` 表示聚合节点；其他空段仍非法。父节点可能已聚合后代，统计时不得把父节点再次加到子节点。

v1 电流和功率是瞬时 held 值，能量是累计 Wh。选区能量使用累计差值并处理 reset。存在 Driver Station Enabled 时，平均功率只使用 Enabled 交集内的累计能量和持续时间；否则使用完整选区。

## V2 独立写入契约

### Root 与版本

V2 root 可为 `energyLogger`，也可带 AdvantageKit 输出前缀，例如：

```text
energyLogger
/RealOutputs/energyLogger
/ReplayOutputs/energyLogger
```

路径结构识别对 AdvantageKit 产生的前缀和字段大小写做规范化，数据集仍保留日志中的原始 root。root 下三个 `string` 描述字段为：

```text
<root>/contractVersion
<root>/libraryVersion
<root>/manifest
```

`contractVersion` 必须精确等于网页明确支持的 `2.1`、`2.2` 或 `2.3`；不得把未知未来 minor 当作兼容版本。`libraryVersion` 必须为非空字符串。三个值在日志中不可改变；可重复写入同一值。

网页优先选择完整有效的 V2 root。若日志只有旧 v1，则继续走 v1。历史实验版 2.0 只有在同一日志自身包含完整 v1 时才按 v1 读取，不获得 V2 专属分析。v2.1 永久保留历史 RPS 语义；v2.2 把原生转速改为 `rad/s`；v2.3 是当前 writer，并增加逐电机连接门控及有符号 Stator Current。

### Manifest

Manifest 必须严格只有以下字段；未知字段、缺字段和未知电机型号均拒绝：

```json
{
  "subsystems": [
    {
      "name": "drive",
      "motors": [
        {
          "name": "left",
          "type": "KRAKEN_X60_FOC",
          "analysisReduction": 6.75,
          "leader": null
        },
        {
          "name": "right",
          "type": "KRAKEN_X60_FOC",
          "analysisReduction": 6.75,
          "leader": "left"
        }
      ]
    }
  ]
}
```

规则：

- subsystem `name` 全局唯一且非空；
- motor `name` 在所属 subsystem 内唯一且非空；
- `analysisReduction` 是 Cyber Power 分析使用的 `motor rotations / mechanism rotations`，必须为大于零的有限值；小于 `1` 的增速传动合法；
- `analysisReduction` 不得从 Talon 或其他控制器的 Feedback ratio 推断，两者即使当前数值相同也必须保持独立语义；
- Leader/独立电机使用 `leader: null`；Follower 直接写同一 subsystem 内 Leader 的电机名字；不得引用自己、另一个 Follower 或其他 subsystem；
- 同一 Leader 组内所有电机必须具有相同 `type` 与 `analysisReduction`；
- subsystem ID 按注册顺序派生为 `s0`、`s1`……，不写入 Manifest。

封闭 `MotorType` 集合：

```text
CIM, VEX_775_PRO, NEO, MINI_CIM, BAG, ANDYMARK_RS775_125,
BANEBOTS_RS775, ANDYMARK_9015, BANEBOTS_RS550, NEO_550,
FALCON_500, FALCON_500_FOC, ROMI_BUILT_IN, KRAKEN_X60,
KRAKEN_X60_FOC, KRAKEN_X44, KRAKEN_X44_FOC, MINION, NEO_VORTEX
```

网页按 `MotorType` 使用内建电机参数表。日志不写自定义或未知型号，也不写参数快照。

### 固定数据字段

Robot：

```text
<root>/robot/sampleTimestampUs      int64
<root>/robot/supplyCurrentAmps      double
<root>/robot/batteryVoltageVolts    double
```

每个按顺序派生的 subsystem：

```text
<root>/subsystems/sN/sampleTimestampUs  int64
<root>/subsystems/sN/state              string
<root>/subsystems/sN/motors/samples     double[]
```

不存在可配置字段路径。`samples` 每行宽度必须精确等于 `motors.length * 3`，每台电机依次占三格；第三格名称和传输单位由契约版本决定：

```text
v2.1: [supplyCurrentAmps, statorCurrentAmps, rotorVelocityRps]
v2.2: [supplyCurrentAmps, statorCurrentAmps, rotorVelocityRadPerSec]
v2.3: [supplyCurrentAmps, statorCurrentAmps, rotorVelocityRadPerSec]
```

- Supply Current 保留电池侧符号：正值从直流母线取电，负值向直流母线返回电流；单台控制器的负值不代表整机电池发生净回充；
- v2.3 writer 在每次 subsystem 采样中只读取每台电机的连接状态一次；断连时三个槽全部写 `NaN`，且不读取该电机的数值源；
- 连接正常的 Leader/独立电机写 Supply Current、Stator Current 与 Rotor Velocity；数值源非有限时对应槽写 `NaN`；
- 连接正常的 Follower 只写自己的有符号 Supply Current，后两格必须精确为 `NaN`，包括禁止 `+Infinity` 和 `-Infinity`；
- `rotorVelocityRps` / `rotorVelocityRadPerSec` 必须是未经过控制器 Feedback ratio 转换的原生电机转子速度；网页在 parser 边界把 v2.1 第三槽原地乘 `2π`，此后所有内部模型只处理 `rad/s`；
- v2.1/v2.2 的 `statorCurrentAmps` 是历史无符号幅值；v2.3 要求适配器把 Supply Current 规范为“从直流母线取电为正、向直流母线返回为负”，把 Stator Current 规范为“motoring 为正、regenerative braking 为负”，两者都不得跟随转子旋转方向翻转；
- robot `supplyCurrentAmps` 仅为 writer 中已注册物理电机的 Supply Current 合计，不代表含 roboRIO、无线电、传感器等用电的完整整机电流；网页必须标为“已注册电机合计电流”。

所有 producer timestamp 使用同一注册时钟域，单位为整数微秒。各 subsystem 在自己的 periodic 中独立采样，因此彼此 record timestamp 不要求对齐。时间回退非法；同一 producer timestamp 重复时最后一条记录生效。

### 基础能量重建

网页将 v2.1/v2.2/v2.3 重建为既有图表可消费的 canonical 序列：

- robot 电流取 `robot/supplyCurrentAmps`，不得由 subsystem 相加重建；
- subsystem 电流取该 subsystem 所有物理电机 Supply Current 的 held 合计；
- 瞬时功率为 held Battery Voltage × held Supply Current，保留正负号；
- 累计耗电量只积分 `max(power, 0)`，单位 Wh，保持单调；
- subsystem 与 robot 使用各自 producer timestamp；计算 subsystem 功率时与 Battery Voltage 事件时间轴取并集；
- 独立时钟会在选区边缘形成不同覆盖范围，不把 subsystem 合计当作与 robot 同步的会计恒等式。

至少需要一个时间递增、Battery Voltage 有限且非负、Supply Current 有限的 robot 区间。否则以 `NO_FINITE_ENERGY_DATA` 拒绝，而不是返回全零能量。

### 分状态功耗

subsystem `state` 是字符串并自动作用于该 subsystem 下所有电机。网页按 held state 对 subsystem canonical 功率积分，显示有效持续时间、耗电量、平均功率、峰值功率和峰值电流。存在 Driver Station Enabled 时排除 Disabled 时间；没有 Enabled 时使用完整选区。

不生成 Robot Mode × subsystem state 交叉矩阵。

### 估算驱动效率

只在同构 Leader 组上分析：Leader 加所有直接 Follower。组的电池输入使用每台物理电机 Supply Current 合计；转速与 Stator Current 只使用 Leader 原生信号。Follower 不产生或伪造转速、Stator Current。

历史 v2.1/v2.2 Stator Current 没有方向；v2.3 保留 Stator Current 与 Rotor Velocity 的符号。估算驱动效率和减速比推荐只使用正 Supply Current、正 Stator Current 的 motoring 区间；负 Stator Current 只表示再生制动工况，不证明电池发生净回充，仍保留在 canonical 时序，但不参与这两项分析。展示名称必须是“估算驱动效率”。估算机械功率按同构电机数量放大；机械功率明显超过电池输入的区间按不可信样本剔除。不得把历史无符号日志解释为再生效率，也不显示再生效率。

效率有效覆盖率按时间而不是样本数量计算。分母是所选范围内全部正时长区间，分子是通过以下唯一分类门禁的区间时长：Battery Voltage、组 Supply Current、Leader Stator Current 与 Leader Rotor Velocity 均有限，Battery Voltage、Supply Current、Stator Current 均严格大于零，并且 `估算机械功率 + 估算铜耗 <= 1.1 × 电池输入功率 + 1 W`。零 Stator Current 必须无效；负 Stator Current 单独标记为再生制动工况（不代表电池净回充）；任一 Follower Supply Current 非有限时，严格组电流合计为非有限且整个组区间无效。

网页核心层为每个 Leader 组输出游程压缩的 typed-array 覆盖率数据：边界数组、状态码数组、各状态累计时长、总时长、有效时长与覆盖率。效率积分与覆盖率数据必须来自同一次分类扫描，禁止 UI 重新实现门禁。界面只显示覆盖率、有效时长和无效原因分布，不再绘制独立覆盖率曲线。即使覆盖率为 `0%`，只要信号形状和电机模型可分类，仍必须说明全部无效原因。

### 减速比推荐

推荐在当前 `analysisReduction` 的 `0.5×–2×` 范围内按对数间隔评估 61 个候选。只有带有效 subsystem state、通过效率功率可信度门禁且 Leader Stator Current 严格大于该型号空载损耗电流 `I0` 的正时长区间参与推荐；所有合格区间都按实际 `dt` 加权，不按样本数量加权或抽样。电机模型用 `Iload = max(Istator - I0, 0)` 估算负载电流，以 `Pmech = n × Kt × Iload × |ω|` 估算轴机械功率，绕组铜耗仍使用总 Stator Current 的 `Pcu = n × Istator² × R`。

模型保持历史机械侧速度、负载扭矩与动作时长不变。候选因子 `f = N′/N` 使用 `ω′ = fω`、`I′ = I0 + Iload/f` 与 `Vreq = I′R + |ω′|/Kv`，不得把空载损耗电流一起除以 `f`；超过电机 stall current、105% free speed 或当时 105% Battery Voltage 的候选淘汰。候选按 `Score = Σ(nI′²RΔt) + 25Σ((Vreq/Vbat)^4Δt)` 评分并返回最低可行评分对应的单一推荐减速比。至少需要 8 个合格区间和 `0.25 s` 合格时长。

输出有效区间数、有效时长、覆盖状态数、当前铜耗 Wh、推荐后铜耗 Wh、两者带符号差值，以及该差值占同一批区间内本组实测正向输入 `Σ(Vbattery × Isupply,group × Δt)` 的比例。分子与分母必须严格使用同一批合格区间；不得把该比例表述成整机电池节能比例。界面不显示估算置信度。缺少状态、Leader 原生速度、Leader Stator Current、有效工作区间或可行候选时明确显示不可用。推荐只覆盖日志中的历史工况，不预测机构摩擦、瞬态、控制器限流改变或闭环稳定性。

## 电池电压响应代理

PDP 2.0 等没有通信能力的配电设备不会提供整机总电流。缺少同步 PDH/PDP Total Current 时，电池页只能使用 V2 `robot/batteryVoltageVolts` 和 `robot/supplyCurrentAmps`，后者仅为已注册物理电机 Supply Current 合计。页面必须使用“已注册电机负载下的电压响应”“局部等效压降代理”等名称，不得称为电池真实内阻、SOC、容量、剩余时间、整机总电流或整机总 Wh。

基础统计按 Battery Voltage 与已注册电机 Supply Current 的 sample-and-hold 并集和实际 `dt` 计算，包括时间加权电压、正向输入 `Σ(max(VI,0)Δt)`、正向电量 `Σ(max(I,0)Δt)`、`I²t`、最低电压、峰值已注册电流、实际低压持续时间和日志已记录的 Brownout 事件。负 Supply Current 可保留为母线返回区间，但不能据此宣称电池净回充。

局部模型只在所选范围和实际观测负载范围内拟合 `V ≈ Vintercept - Req × Iregistered`。应同时输出固定窗口稳健回归的时变 `Req`、电流激励范围与残差，以及彼此分离的负载阶跃 `ΔV/ΔI` 分布；弱激励、非正斜率、非有限数据或样本不足必须明确显示不可用。`Req` 只能称为相对于已注册电机负载的局部等效压降系数。按 Robot Mode 的条件统计只是相关性分组，不推断因果。禁止用该模型预测修改减速比后的最低电压、Brownout 或节能量。

## Optional robot state

按所选 root 的 namespace 查找：

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

V2 Battery Voltage 使用固定 robot 字段，上述电池字段只服务 v1。Teleop 由 Enabled=true、Autonomous=false、Test=false 推导。`MatchType` 的 `1` 表示 Practice。缺失 optional 字段只降低对应 UI，不使基础日志无效。

## Supply Current 限流历史模拟

模拟作用于 canonical EnergyLogger 节点，输入值是节点合计 Supply Current 上限，不是单个电机控制器配置。多个目标必须唯一且不得形成祖先/后代重叠。电流和功率按 `min(1, limit / positiveCurrent)` 比例缩放；累计 Wh 只缩放正增量并分段处理 reset。保留未选节点的 robot residual；不预测 Battery Voltage、Brownout、Stator Current、机构动作或动作耗时，也不修改原图表。

## 错误策略

Fatal 示例：

- WPILOG magic/version 无效或中段损坏；
- root 同优先级歧义；
- v1 缺少 totals 或完整动态节点；
- V2 描述字段缺失、改变、类型错误，或版本不在精确支持集 `2.1/2.2/2.3` 中；
- Manifest JSON/字段/名字/电机型号/Leader 关系/`analysisReduction` 非法；
- 固定 entry 缺失、类型错误、packed width 改变、Follower 后两格不是精确 `NaN`；
- producer timestamp 非法或回退；
- robot 没有可用有限电气区间。

Warning 示例：

- 文件尾截断恢复；
- optional robot state 缺失；
- 时间断层或必需信号出现 `NaN`；
- replay/simulation root。
