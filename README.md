# cyber-power

![Next Innovation](https://img.shields.io/badge/Next-Innovation-8A2BE2?labelColor=555555&style=flat)
![Lang zh-CN](https://img.shields.io/badge/Lang-zh--CN-2DBA4E?labelColor=555555&style=flat)
![Node 22](https://img.shields.io/badge/Node-22-2DBA4E?labelColor=555555&style=flat)

Cyber Power 是面向任何正确使用 NI EnergyLogger 的 FRC 机器人 WPILOG 本地能量分析工具。

## 用途

用户通过飞书组织账号登录后，在浏览器本地解析 `.wpilog`，查看电压、电流、功率、累计能量、Brownout、Driver Station 模式和动态子系统占比。原始日志不上传服务器。

兼容性只取决于 WPILOG 1.0 与 NI EnergyLogger 数据契约，不限制队伍、赛季、ProjectName 或子系统命名。

独立的“模拟”页按子系统明细相同的可展开 EnergyLogger 层级表展示路径，并在每行右侧直接填写合计 Supply Current 上限、独立启用一个或多个互不重叠节点；总开关开启后基于当前共享时间范围实时生成耗电量与峰值变化报告。模拟不会修改整机或子系统原图表，也不控制机器人，不预测 Stator Current、电池电压、Brownout 或机构动作结果。

## 目录

- `app/`：React Router 应用、认证和分析界面。
- `.agents/skills/`：项目级 Cyber Apps、GitHub、Memory 和日志分析 skills。
- `.memory/`：项目长期约束与当前状态；`SCRUM.md` 仅保留本地。
- `supabase/`：仅飞书登录用户资料所需的数据库 migration。
- `docs/architecture.md`：解析、认证、离线和存储边界。
- `docs/validation.md`：真实日志金标与验收方法。

## 给人看的工具

- Node.js 22
- pnpm 11
- 现代 Chromium、Firefox 或 Safari

## 给人看的使用方法

```powershell
pnpm install
Copy-Item .env.example .env.local
pnpm dev
```

浏览器打开开发服务器地址，登录飞书后选择 `.wpilog` 文件。日志和分析结果默认只存在于本机。

必须配置 `.env.local` 中的 8 个服务端变量；含 secret 的值不能使用 `VITE_` 前缀。完整说明见 [架构文档](docs/architecture.md)。

## 给 AI 看的工具

- 仓库根目录 `AGENTS.md`
- `.agents/skills/cyber-apps/SKILL.md`
- `.agents/skills/ni-github-repo/SKILL.md`
- `.agents/skills/ni-memory/SKILL.md`
- `.agents/skills/cyber-power-log-analysis/SKILL.md`

## 给 AI 看的使用方法

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm bundle:check
```

```powershell
pnpm log:list -- "C:\path\robot.wpilog"
pnpm log:analyze -- "C:\path\robot.wpilog"
pnpm log:analyze -- "C:\path\robot.wpilog" --start 120 --end 135 --json
pnpm log:benchmark -- --warmup 1 --runs 5 "C:\path\robot.wpilog"
```

`log:list` 只检查容器并列出 entries；`log:analyze` 会校验 EnergyLogger 契约并计算指标；`log:benchmark` 记录解析、区间分析、可选限流模拟与进程内存。`bundle:report` 查看构建组成，`bundle:check` 执行不依赖私有日志的体积门禁。真实样例与性能基线见 [验证文档](docs/validation.md)。

## 维护规则

- 不按队号、ProjectName 或固定子系统名判断兼容性，只按 EnergyLogger 数据契约判断。
- Supabase 仅用于飞书登录用户资料，不保存日志、分析结果或业务历史。
- 不提交任何服务端 secret、`.env.local`、原始 WPILOG 或本地 SCRUM。
- 生产入口为 `https://power.team8214.com`。
- 已认证页面缓存最多 7 天，用于同一浏览器配置下的离线本地分析；缓存壳不含姓名、头像、飞书 ID 或 Supabase ID。
