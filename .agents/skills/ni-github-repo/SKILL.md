---
name: ni-github-repo
description: NI Robotics GitHub repository standard for internal and nirobotics organization repositories. Use for every NI internal repository and every repository uploaded to the GitHub organization nirobotics, especially when creating, reviewing, or updating README.md, repository metadata, badges, language defaults, required tools, usage instructions, and public-facing repository documentation.
---

# NI GitHub 仓库规范

## 概览

每一个 NI 内部仓库，以及每一个上传到 GitHub 组织 `nirobotics` 的仓库，都必须使用这个 skill。重点是保证 README、徽章、语言、标题、工具说明和使用方法在团队内一致。

## README 必须项

- 仓库命名必须使用全小写字母和下划线；不要使用大写字母、连字符、空格或其他符号。
- `README.md` 默认使用 `zh-CN`。
- `README.md` 顶部只能有一个一级标题，并且必须放在文件开头。
- 一级标题必须与仓库名保持一致，大小写按仓库名原样书写。
- 一级标题下面必须包含 `Next Innovation` badge。
- 一级标题下面必须包含语言 badge，默认写作 `Lang zh-CN`，注意大小写必须是 `zh-CN`。
- `README.md` 必须包含所需工具及使用方法。
- 所需工具和使用方法应区分“给人看的”和“给 AI 看的”；人类读者优先看到最少必要入口，AI 读者看到校验、维护和自动化命令。
- 如果仓库有安装、运行、测试、构建、部署或发布流程，必须写出可执行命令。
- 不要在 README 中写无法验证的状态、虚构链接、虚构命令或不存在的依赖。

## 推荐 README 结构

使用以下结构，除非仓库类型明确不适合：

```markdown
# repo-name

![Next Innovation](https://img.shields.io/badge/Next-Innovation-8A2BE2?labelColor=555555&style=flat)
![Lang zh-CN](https://img.shields.io/badge/Lang-zh--CN-2DBA4E?labelColor=555555&style=flat)

一句话说明仓库用途。

## 用途

说明这个仓库解决什么问题，服务谁，放什么内容。

## 目录

列出关键目录和文件，不要罗列无意义的内部细节。

## 给人看的工具

列出人类读者开始使用仓库需要的最少工具。

## 给人看的使用方法

给出人类读者的最短开始路径。

## 给 AI 看的工具

列出 AI agent 维护仓库需要调用的工具。

## 给 AI 看的使用方法

给出校验、构建、测试、部署或发布命令。

## 维护规则

写清楚贡献、命名、文档或发布约定。
```

## Badge 规则

- 使用 `Next Innovation` badge 表示团队归属。
- 使用 `Lang zh-CN` badge 表示 README 默认语言。
- badge 应放在一级标题正下方。
- 如果使用 shields.io，推荐：
  - `https://img.shields.io/badge/Next-Innovation-8A2BE2?labelColor=555555&style=flat`
  - `https://img.shields.io/badge/Lang-zh--CN-2DBA4E?labelColor=555555&style=flat`

## 验证

- 检查仓库名是否只包含小写字母和下划线。
- 检查 README 是否只有一个 `# ` 一级标题，且位于文件头部。
- 检查一级标题是否与仓库名一致。
- 检查是否包含 `Next Innovation` 和 `Lang zh-CN` badge。
- 检查是否区分“给人看的工具/使用方法”和“给 AI 看的工具/使用方法”。
- 检查 README 中的命令、路径、依赖和链接是否真实存在或明确标注为待配置。
