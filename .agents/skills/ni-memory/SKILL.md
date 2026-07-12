---
name: ni-memory
description: Lightweight project memory and handoff workflow for Codex agents. Use when a repository needs concise durable memory, goal-mode stabilization, short-term task tracking, or a .memory directory with PROMISE.md, LESSON.md, CORNERSTONE.md, and local-only SCRUM.md for handoff continuity without excessive logs.
---

# NI Memory

## 目标

用项目根目录的 `.memory/` 保存最少但关键的记忆，让没有对话上下文的人或 agent 能快速接手。不要把它写成聊天记录、流水账、变更日志或长篇 handoff。

## 初始化

- 在项目根目录创建 `.memory/`。
- 确保存在 `.memory/PROMISE.md`、`.memory/LESSON.md`、`.memory/CORNERSTONE.md`、`.memory/SCRUM.md`。
- 确保 `.gitignore` 包含 `.memory/SCRUM.md`；`SCRUM.md` 永远只保留本地，不上传 GitHub。
- 其他三个文件可以随仓库提交，除非项目另有规则。
- 如需“每次任务开始前读取、最终回复前检查写入”的常驻效果，把 `AGENTS-MEMORY.md` 的内容合并进项目 `AGENTS.md` 或个人全局 `AGENTS.md`。
- 只安装或复制 skill 不会自动产生常驻 hook；`AGENTS.md` 常驻规则负责触发，`ni-memory` 负责具体写法。

## 写入原则

- 只记录会影响后续判断、实现、协作或交接的内容。
- 不记录普通命令输出、聊天过程、重复状态、临时猜测、已被代码或 README 明确表达的信息。
- 新内容先去重；已有同义内容时更新原句，不追加重复条目。
- 每条内容用最短的一句话或一小段话表达。
- 事实变化时更新或删除旧记忆，不保留冲突历史。

## PROMISE.md

- 用于长期保存用户偏好、团队约定和边界。
- 不写大标题。
- 使用无序列表。
- 新内容总是在最上方。
- 用户在对话中表达稳定偏好、约定、禁区、命名方式、部署边界或协作规则时，用一句话加入。
- 不记录一次性任务要求，除非用户明确说以后都这样做。

## LESSON.md

- 用于长期保存过程经验、踩坑和教训。
- 不写大标题。
- 使用无序列表。
- 新内容总是在最上方。
- 当多种思路、工具或路径中只有一种实际走通时，记录可复用教训。
- 当某个工具、命令、平台路径被验证不可用或容易误用时，记录限制和可行替代。
- 如果用户后续明确要求使用某种原本被记为不可行的方案，删除或改写不再匹配的教训。

## CORNERSTONE.md

- 用于保存项目当前状态，不是长期历史。
- 不写大标题。
- 总是只保留最新状态。
- 记录项目发展到什么阶段、正在使用哪些工具、已经实现哪些功能、当前关键入口和验证方式。
- 初始化项目、完成新功能、开始使用新工具或更换工具后更新。
- 不写历史时间线；旧状态被新状态覆盖。

## SCRUM.md

- 用于短期任务推进和 goal 模式稳定。
- 只使用两个二级标题：`## 待完成` 和 `## 已完成`。
- `## 待完成` 下使用无序列表，新 todo 总是在下方，优先完成旧 todo。
- `## 已完成` 下使用无序列表，新完成项总是在上方。
- 用户要求完成任务、计划或临时追加需求时，先总结成一条或少数几条 todo 加到 `## 待完成`。
- 完成一个 todo 后，把它从 `## 待完成` 移到 `## 已完成`。
- 如果 `## 待完成` 没有 todo，同时清空 `## 已完成` 中的 todo，只保留两个标题。
- goal 模式下，任务进度只以 SCRUM 的待完成和已完成为准；重复注入的旧需求先与 SCRUM 去重，不要误判为进度没有推进。

## 使用流程

- 开始仓库任务时，先读取 `.memory/` 四个文件；`SCRUM.md` 不存在时创建并加入 `.gitignore`。
- 如果项目已启用 `AGENTS-MEMORY.md` 内容，按其中的开始/结束规则执行，不需要用户每次显式提到本 skill。
- 执行过程中，随时把稳定偏好写入 `PROMISE.md`，把可复用踩坑写入 `LESSON.md`。
- 完成功能或改变项目状态后，重写 `CORNERSTONE.md` 为当前快照。
- 每次接到任务或计划，先维护 `SCRUM.md`；完成后按规则移动或清空 todo。
- 最终回复只汇报本次实际改动、验证结果和未完成事项，不复述 `.memory` 全文。
