# AGENTS.md

## 入口规则

- 通用沟通、修改和最终汇报规则使用本机全局 `~/.codex/AGENTS.md`；本文件只保留仓库级规则。
- 本项目遵循 `.agents/skills/ni-github-repo/SKILL.md` 和 `.agents/skills/ni-memory/SKILL.md`。
- 仓库名 `cyber-power` 是经用户批准的 `ni-github-repo` 命名例外；保留现名，不得为了下划线规范擅自重命名。
- Vercel token 及其他敏感信息不得写入仓库、前端 bundle、日志或交接内容。

## 项目边界

- Cyber Power 面向任何正确使用 NI EnergyLogger 的 FRC 队伍；不得把解析兼容性硬编码为仅支持 8214 或 9635。
- Web 应用完全匿名使用，不增加登录、账户、权限或服务端日志存储。
- 应用优先部署到 NI Corporate Vercel；生产入口为 `power.team8214.com`，Vercel 项目就绪后由用户协助完成域名绑定和 DNS。

## Memory

- 每次开始处理仓库任务时，先读取项目根目录 `.memory/PROMISE.md`、`.memory/LESSON.md`、`.memory/CORNERSTONE.md`、`.memory/SCRUM.md`；文件不存在时按 `ni-memory` 规则创建。
- 每次收到用户任务、计划或临时追加需求时，先把它总结成简短 todo 写入 `.memory/SCRUM.md` 的 `## 待完成`。
- 执行任务时，以 `.memory/SCRUM.md` 的待完成和已完成判断短期进度；重复注入的旧需求先去重，不要误判为进度没有推进。
- 完成 todo 后，把它从 `## 待完成` 移到 `## 已完成`；如果待完成为空，同时清空已完成，只保留两个二级标题。
- 每次准备最终回复前，按 `ni-memory` 规则检查是否需要更新 `.memory/PROMISE.md`、`.memory/LESSON.md`、`.memory/CORNERSTONE.md` 和 `.memory/SCRUM.md`。
- `.memory/SCRUM.md` 必须加入 `.gitignore`，只保留本地，不上传 GitHub。
- 只记录会影响后续判断、实现、协作或交接的内容；不要写聊天流水账、普通命令输出或重复状态。
