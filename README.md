# cyber-power

![Next Innovation](https://img.shields.io/badge/Next-Innovation-8A2BE2?labelColor=555555&style=flat)
![Lang zh-CN](https://img.shields.io/badge/Lang-zh--CN-2DBA4E?labelColor=555555&style=flat)

Cyber Power 是面向任何正确使用 NI EnergyLogger 的 FRC 机器人 WPILOG 本地能量分析工具。

## 用途

用户通过飞书组织账号登录后，在浏览器本地解析 `.wpilog`，查看电压、电流、功率、能量、Brownout、Driver Station 模式和动态子系统占比。原始日志不上传服务器。

## 目录

- `app/`：React Router 应用、认证和分析界面。
- `.agents/skills/`：项目级 Cyber Apps、GitHub、Memory 和日志分析 skills。
- `.memory/`：项目长期约束与当前状态；`SCRUM.md` 仅保留本地。
- `supabase/`：仅飞书登录用户资料所需的数据库 migration。
- `docs/design/`：已确认的产品界面设计依据。

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

## 给 AI 看的工具

- 仓库根目录 `AGENTS.md`
- `.agents/skills/cyber-apps/SKILL.md`
- `.agents/skills/ni-github-repo/SKILL.md`
- `.agents/skills/ni-memory/SKILL.md`

## 给 AI 看的使用方法

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

使用 `pnpm log:analyze -- <path-to-wpilog>` 执行日志金标验证；该命令将在解析器实现阶段加入。

## 维护规则

- 不按队号、ProjectName 或固定子系统名判断兼容性，只按 EnergyLogger 数据契约判断。
- Supabase 仅用于飞书登录用户资料，不保存日志、分析结果或业务历史。
- 不提交任何服务端 secret、`.env.local`、原始 WPILOG 或本地 SCRUM。
- 生产入口为 `https://power.team8214.com`。
