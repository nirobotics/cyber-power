# Cyber Power 架构

## 数据流

```text
用户本地 .wpilog
  -> 浏览器 File/Blob
  -> Web Worker 分块解析 WPILOG 1.0
  -> EnergyLogger v1 历史读取或独立 V2 契约校验
  -> canonical typed arrays + 区间分析
  -> 按需加载的 ECharts、指标卡和表格
```

原始日志、解析后的时序数据和区间选择都留在浏览器设备上。服务端不接收日志，Supabase 不存储日志或分析结果。

## WPILOG 与 EnergyLogger

核心代码位于 `app/features/log-analysis/core/`，不依赖 React。浏览器通过 `app/features/log-analysis/workers/log-analysis.worker.ts` 调用同一套 API；命令行通过 `scripts/log-list.ts` 和 `scripts/log-analyze.ts` 调用。

历史 v1 日志必须满足以下兼容性条件：

- WPILOG 1.0 容器结构有效；
- 存在同一 `energyLogger` root 下的 `totalCurrent`、`totalPower`、`totalEnergy` 三个 `double` 序列；
- 至少存在一个动态路径，具备完整的 `current`、`power`、`energy` 三个 `double` 序列。

root 可以是 `/RealOutputs/energyLogger`、`/ReplayOutputs/energyLogger` 或其他以 `/energyLogger` 结尾的命名空间。不读取队号、ProjectName 或固定子系统列表。

AdvantageKit 会省略未变化值，因此瞬时电流和功率按 sample-and-hold 解释；能量按累计 Wh 差值计算。仅文件尾部最后一条不完整记录可恢复，中段结构损坏必须报错。

详细契约由 `.agents/skills/cyber-power-log-analysis/references/energylogger-contract.md` 维护。

## EnergyLogger V2 独立读取

v2.3 是机器人端当前写入契约，不依赖任何 v1 totals 或动态节点。网页同时读取历史 v2.1、v2.2 与当前 v2.3：v2.1 packed 第三槽的 RPS 在 parser 边界原地乘 `2π`，v2.2/v2.3 的 `rad/s` 保持不变，后续模型只处理 `rad/s`。v2.1/v2.2 Stator Current 按历史幅值解释；v2.3 适配器必须把 Supply Current 规范为从直流母线取电为正、向母线返回为负，把 Stator Current 规范为驱动为正、再生制动为负，二者均与转子旋转方向无关。root 下精确版本描述与固定字段通过后，解析器直接从 Battery Voltage 和已注册电机 Supply Current 重建既有图表所需的电流、功率和累计耗电序列。历史 v1 parser 保留，不参与 V2 兼容判断。

Manifest 只包含有序 subsystem 及其电机的 `name`、`type`、`analysisReduction`、`leader`。`analysisReduction` 是 Cyber Power 的机械分析传动比，不从控制器 Feedback ratio 推断。subsystem ID 按顺序派生为 `sN`。每个 subsystem 只有 producer timestamp、state 与 `motors/samples`；每台电机固定三格 Supply Current、Stator Current、原生 rotor velocity。Follower 后两格必须是 `NaN`。

Robot `supplyCurrentAmps` 是已注册物理电机合计，不代表完整整机输入，因此界面显示“已注册电机合计电流”。robot 电流为权威来源，不从异步 subsystem 序列反算，也不对两者做同步能量对账。

### 单遍解析与时间语义

`EnergyLoggerV2Collector` 与 v1 collector 挂接在同一次 `decodeWpiLog` 遍历上，不二次读取一次性 `AsyncIterable`。固定字段使用可增长 typed buffer；Worker 将每个 timestamp、scalar 和 packed buffer 恰好 transfer 一次。

WPILOG record 时间用于对稀疏字段做 sample-and-hold，`sampleTimestampUs` 的值才是分析时间轴。AdvantageKit 省略不变值时，state、robot scalar 和 packed motor 样本不要求与每个 timestamp record 一一对应。类型、packed width、Follower 槽或 producer timestamp 违规直接拒绝该 V2 日志。

### Canonical 序列与高级分析

- robot 功率为 held Battery Voltage × held registered-motor Supply Current；
- subsystem 电流为物理电机 Supply Current 合计，功率时间轴与 Battery Voltage 事件取并集；
- 功率保留符号，累计耗电只积分 `max(power, 0)`；
- 分状态统计只按 subsystem state 输出有效持续时间、耗电、平均/峰值功率和峰值电流；存在 Enabled 时排除 Disabled；
- 同构电机组以 Manifest 的 Leader 为主行，Follower 只贡献自己的 Supply Current；Leader 的 Stator Current 与原生转速代表组内相同工作点；
- 电机时间轴合并 subsystem 样本、异步 Battery Voltage 事件和选区精确端点，再按每个相邻区间的真实 `dt` 分类；覆盖率是有效区间时长除以完整选区时长，不按样本数计算；
- 有效驱动区间要求信号有限、电池电压和整组 Supply Current 为正、Leader Stator Current 为正，并满足 `Pmech + Pcu ≤ 1.1 × Pbat + 1 W`；零 Stator、再生制动、非有限或物理不可能区间保留在覆盖率与原因分布中，但不进入效率或推荐；负 Stator 只表示再生制动工况，不证明电池发生净回充；
- Kraken X44/X60 普通/FOC 模型使用 CTRE 12 V dyno 曲线的 `R/Kt/Kv/I0`。机械功率以 `Iload=max(Istator-I0,0)` 估算，绕组铜耗仍使用总 Stator Current 的 `n×Istator²×R`；
- 减速比在 `analysisReduction` 的 `0.5×–2×` 内按对数间隔比较 61 个候选。所有合格区间都按真实 `dt` 参与，不做定长抽样；候选保持历史机械侧速度与扭矩，以 `I′=I0+Iload/f` 保留空载损耗电流，淘汰超过堵转电流、105% 空载转速或 105% 电池电压的结果，并返回最低铜耗/电压余量评分对应的单一推荐减速比；
- 当前铜耗、推荐后铜耗、带符号铜耗差值和“差值 / 本组实测输入”严格使用同一批有效区间。该比例不是整机电池节能比例，推荐结果仍需相同机械任务的实机 A/B 验证。

“子系统”页保留能量占比、三张独立状态图和唯一“功耗明细”：顶层“全部”行保持原全选区指标，V2 状态作为默认折叠的子行，不用 Enabled-only 状态覆盖全选区总量。“电机”页单独显示 Leader 电机表；只有存在 Follower 时才在 Leader 名下完整列出其他电机名，每行按需展开有效时长、无效原因和该组推荐依据，页面底部统一解释公式、门禁和限制；不再绘制覆盖率曲线或显示推荐置信度。数据质量页只显示契约版本、记录库版本、subsystem/电机数量和电流口径。

### 电池电压响应代理

“电池”页只对 V2 数据开放。输入是 `robot/batteryVoltageVolts` 和 `robot/supplyCurrentAmps`；后者仅为已注册物理电机 Supply Current 合计，绝不当作 PDH/PDP 整机总电流。基础统计按异步 sample-and-hold 并集和真实 `dt` 计算时间加权电压、正向输入 Wh/Ah、`I²t`、最低电压、实际低压和 Brownout 事件，并按 Robot Mode 条件分组。

局部窗口使用稳健线性拟合 `V≈Vintercept-Req×Iregistered`，同时保留电流激励范围、残差和时变 `Req`；独立负载阶跃以 `-ΔV/ΔI` 给出第二种代理分布。弱激励、斜率方向不符或样本不足时分别降级为不可用。`Req` 只能称为“相对于已注册电机负载的局部等效压降系数”，因为它混合了电池、线束、连接器、动态恢复和未记录负载；页面不输出真实内阻、SOC、容量、整机总 Wh、净回充或修改减速比后的电压/Brownout 反事实。

## Supply Current 限流历史回放估算

估算器使用当前共享时间范围和已解析的 EnergyLogger typed arrays，不修改原始数据。输入上限表示一个节点记录的**合计 Supply Current**，不是单台电机上限。可选目标包括无子节点的终端节点（也包括 `indexer` 这类顶层终端电机组），以及由用户明确确认代表同构电机组的聚合节点。一个方案可同时启用多个目标，但目标不得重复，也不得同时包含祖先和后代节点，以免重复扣减。

对于目标节点记录的电流 `I`、功率 `P` 和上限 `L`，按 sample-and-hold 在每个时间点计算比例：

```text
s = I > 0 ? min(1, L / I) : 1
I' = I > 0 ? min(I, L) : I
P' = P * s
```

累计能量不由功率重新积分。估算器只缩放记录中累计 Wh 的正增量，并使用该能量样本时刻 sample-and-hold 的电流计算 `s`；累计值下降视为 reset，结束上一段并从新值继续。若电流不大于 0 但功率或能量仍为正，相关数据保持原样并给出置信度提示。

存在 Driver Station `Enabled` 序列时，平均功率只使用选区内 Enabled 交集的估算能量和总时长；全 Disabled 选区为 `0 W`。缺少 `Enabled` 时才回退到完整选区。

整机估算保留未选中部分的原始残差：电流和功率在每个时间点、能量在累计增量上，均使用“原整机值减去各目标的原值与估算值之差”，而不是把子系统重新求和。若扣减后出现超过容差的负整机值，逐目标结果仍保留，但整机估算标记为不可用。

该模型只回答“若记录到的工作过程不变，并按上述比例限制 Supply Current，报告中的能耗与峰值指标会怎样”。它不估计 Stator Current，也不重新预测电池电压、Brownout、机构动力学、动作完成情况或动作耗时。

界面将该能力隔离在“模拟”导航页。编辑器与子系统明细共用稳定 `parentId` 层级规则：默认只显示顶层路径，可逐级展开；每行在能量、同级占比、平均功率、峰值功率和峰值电流之后直接提供 Supply 限流值与启用开关，不再维护“可添加目标”或独立已选列表。配置只有一份稀疏实时状态：未启用时仍可预填并保留限流值和聚合确认，行级开关决定哪些目标参与计算；总开关关闭时保留全部输入但不运行估算，开启后任何有效输入变化都会原子重算整份报告，无效配置不会继续显示旧报告。折叠路径若含已启用目标会显示数量，隐藏路径的配置错误也会提升到表格底部。估算器用最小堆合并多目标样本并单次流式累计报告，不生成或保留未被界面消费的模拟时间轴。模拟页只显示配置、报告和共享时间范围，不绘制限流专用图表，也不改变整机或子系统原图表。

## 加载与性能边界

- 上传页只加载文件选择、认证壳和 Worker 协议；分析完成后才按需加载 Dashboard 与 ECharts。
- ECharts 只注册折线、网格、提示、缩放、状态背景与 Canvas 渲染所需模块，不引用全量入口。
- Worker 在返回结果或错误后立即终止；解析结果需要的 typed arrays 通过 transferable 移交，不复制大块时序数据。
- WPILOG decoder 对大 Blob/File 使用内部窗口并保留跨窗口残片；常规时间戳走精确 `number` 热路径，只有超出安全整数时回退 BigInt。
- PWA manifest 图标与 Workbox 预缓存只登记一次。`pnpm bundle:check` 检查上传初始依赖图、ECharts、静态资源、预缓存 Brotli 体积以及重复或缺失 URL。
- `pnpm vendordep:contract` 直接解析 Java vendordep 生成的 v2.3 WPILOG，检查跨语言 Manifest、packed 槽、signed Stator Current、`rad/s` 原生转速、基础重建和三项高级分析。

当前纯 TypeScript decoder 已在三份真实日志上达到约 30%–32% 的解析改进，超过本轮性能门槛；因此没有引入 WASM。只有后续基准证明剩余 CPU 瓶颈足以覆盖跨边界复制、构建链和兼容性成本时，才单独评估 WASM。

## 飞书认证

认证路由：

- `POST /auth/login`：生成 state、PKCE S256 verifier/challenge，跳转飞书 OAuth v2；
- `GET /auth/feishu/callback`：先校验 state，再换取用户信息并校验 tenant key；
- `POST /auth/logout`：同源退出，清 Cookie 和私有导航缓存；
- `GET /api/auth/me`：只返回 `displayName` 与 `avatarUrl`。

服务端 session Cookie 在生产使用 `__Host-cyber_power_session`，属性为 Secure、HttpOnly、SameSite=Lax、Path=/，有效期 14 天。飞书 token 不持久化。

Supabase 只保存 `public.user_profiles` 身份映射。RLS 与 FORCE RLS 开启；`anon` 和 `authenticated` 无表权限、无 policy；`service_role` 只有 SELECT、INSERT、UPDATE。浏览器 bundle 中没有 Supabase client 或 secret。

## 离线边界

Service Worker 对 `/auth/**` 和 `/api/**` 使用 NetworkOnly，不缓存认证响应。静态资源预缓存；已认证的普通导航壳使用 NetworkFirst，离线保存最多 7 天。

SSR loader 在线时仍要求有效 session，但返回给浏览器和缓存的 hydration data 不含用户身份。离线授权的实际边界是“同一浏览器配置中存在未过期的私有导航缓存”。退出按钮会先删除该缓存，再向服务端 POST 清除 Cookie。

限制：

- 组织成员被移除或 session 被撤销时，已缓存设备在断网期间无法即时获知；
- 离线退出可以立即删除本地壳，但若网络 POST 未成功，服务端 Cookie 会在重新联网后仍保持到过期或下一次成功退出；
- 不在公共或共享浏览器配置中启用离线使用。

## 环境变量

全部变量只配置在服务端/Vercel，不写入仓库：

| 变量 | 作用 |
|---|---|
| `APP_ORIGIN` | 生产必须是 `https://power.team8214.com` |
| `FEISHU_APP_ID` | 飞书应用 ID |
| `FEISHU_APP_SECRET` | 飞书应用 secret |
| `FEISHU_REDIRECT_URI` | 生产固定 callback URL |
| `FEISHU_ALLOWED_TENANT_KEY` | 允许的 NI Robotics tenant |
| `SESSION_SECRET` | 至少 32 字符的随机 Cookie 签名 secret |
| `SUPABASE_URL` | Supabase 项目 URL |
| `SUPABASE_SECRET_KEY` | server-only Supabase secret key |

`FEISHU_AUTH_SCOPES` 可选。任何 secret 都不得使用 `VITE_` 前缀。

## 部署验收

1. `pnpm install --frozen-lockfile`。
2. `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm bundle:check && pnpm vendordep:contract`。
3. Vercel Git Integration 指向私有仓库 `nirobotics/cyber-power` 的 `main`。
4. 配置上述生产环境变量并部署 Node.js 22。
5. 将 `power.team8214.com` alias 到生产 deployment。
6. 验证飞书登录、Cookie、真实日志、错误文件、区间拖动、主题切换、移动端和离线刷新。
