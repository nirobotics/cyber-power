# Cyber Power 架构

## 数据流

```text
用户本地 .wpilog
  -> 浏览器 File/Blob
  -> Web Worker 分块解析 WPILOG 1.0
  -> EnergyLogger 契约发现与校验
  -> typed arrays + 区间分析
  -> 按需加载的 ECharts、指标卡和表格
```

原始日志、解析后的时序数据和区间选择都留在浏览器设备上。服务端不接收日志，Supabase 不存储日志或分析结果。

## WPILOG 与 EnergyLogger

核心代码位于 `app/features/log-analysis/core/`，不依赖 React。浏览器通过 `app/features/log-analysis/workers/log-analysis.worker.ts` 调用同一套 API；命令行通过 `scripts/log-list.ts` 和 `scripts/log-analyze.ts` 调用。

兼容性条件：

- WPILOG 1.0 容器结构有效；
- 存在同一 `energyLogger` root 下的 `totalCurrent`、`totalPower`、`totalEnergy` 三个 `double` 序列；
- 至少存在一个动态路径，具备完整的 `current`、`power`、`energy` 三个 `double` 序列。

root 可以是 `/RealOutputs/energyLogger`、`/ReplayOutputs/energyLogger` 或其他以 `/energyLogger` 结尾的命名空间。不读取队号、ProjectName 或固定子系统列表。

AdvantageKit 会省略未变化值，因此瞬时电流和功率按 sample-and-hold 解释；能量按累计 Wh 差值计算。仅文件尾部最后一条不完整记录可恢复，中段结构损坏必须报错。

详细契约由 `.agents/skills/cyber-power-log-analysis/references/energylogger-contract.md` 维护。

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
2. `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm bundle:check`。
3. Vercel Git Integration 指向私有仓库 `nirobotics/cyber-power` 的 `main`。
4. 配置上述生产环境变量并部署 Node.js 22。
5. 将 `power.team8214.com` alias 到生产 deployment。
6. 验证飞书登录、Cookie、真实日志、错误文件、区间拖动、主题切换、移动端和离线刷新。
