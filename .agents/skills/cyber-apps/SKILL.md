---
name: cyber-apps
description: NI Robotics internal Cyber App creation, review, deployment, and evolution workflow for private NI Robotics and Team 8214 Cyber Unicorn production apps. Use when Codex builds or changes internal apps, dashboards, workflows, data tools, app architecture, Supabase schemas, Vercel deployment, Feishu organization login, permissions, stable cached assets, operational UI, or the shared Cyber App visual system. Cyber Apps use React 19, React Router 7 framework mode, Vite 8, TypeScript 5, Tailwind CSS 4, @supabase/supabase-js v2, Node.js 22+, NI Corporate Vercel and Supabase organizations, Feishu-only login, light/dark themes, and the bundled template.
---

# Cyber Apps

## 定义

Cyber App 是 NI Robotics 或 Team 8214 Cyber Unicorn 使用的内部生产 Web App。它不是官网、营销页、社交媒体物料、课程页、海报、长图或展陈物料。

Cyber App 必须：

- 服务真实内部业务流程，第一屏就是可工作的业务界面。
- 默认使用内部飞书组织身份登录；不做用户名密码、邮箱验证码、公开注册或公开邀请入口。
- 使用 Supabase 管理业务数据、权限数据、存储、实时能力和服务端集成。
- 部署在 `NI Corporate` Vercel 组织，域名默认使用 `xxx.team8214.com`。
- 复用统一 Cyber App shell、颜色、圆角、按钮、输入框、header、footer、light/dark、登录状态和密度。

## 默认技术栈

- 前端：React 19、React Router 7 framework mode、Vite 8、TypeScript 5。
- 样式：Tailwind CSS 4，使用 `@import "tailwindcss"`、`@theme`、`@custom-variant dark`、CSS variables 和少量 `@layer components`。
- 图标：`lucide-react 0.x`。
- 数据：Supabase，客户端 SDK 为 `@supabase/supabase-js v2`。
- 部署：Vercel，React Router 项目优先使用 `@vercel/react-router v1`。
- 运行时：Node.js 22+；最终以项目 `package.json engines` 和 Vercel 项目设置为准。
- 可选：shadcn/ui 可作为基础组件来源，但不是默认依赖，不得覆盖 Cyber App 统一视觉。
- React Router 7 framework mode 已支持 Vite 8；默认不要主动开启 React Router v8 future flags，除非当前项目已经完整验证。

## 模板优先

新建或大幅整理 Cyber App 时，优先复制本 skill 的 `template/`。不要先从零写一套 shell、主题、header、footer 或登录状态。

复制后先替换：

- 应用名、副标题、图标和 `document.title` 格式。
- 主题 localStorage key 和 theme event key。
- 业务路由、loader/action/API 权限 helper。
- public 目录中的 NI logo、favicon 和必要品牌资产。
- 版本号、版权文本和部署域名。

模板只提供 App shell、视觉 token、主题切换、登录状态和基础 UI 语法；不要把模板里的 auth placeholder 当成真实权限实现。

## 游客模式选择

在项目第一天决定是否兼容游客模式，并让 loader/action/API 与 UI 一致。

### 兼容游客模式

用于大屏、只读仪表盘或允许匿名查看的内部工具。

- 核心只读页面允许匿名访问，loader 使用 optional current user。
- header 未登录时显示登录按钮；登录后显示头像、飞书名称和登出按钮。
- 写操作、共享设置、敏感数据、管理操作必须在 action/API 中调用 required current user。
- 本机偏好可以放 localStorage；共享配置、权限和审计必须写 Supabase。
- 前端按钮禁用只是一层提示，不能替代服务端权限校验。

### 不兼容游客模式

用于所有业务数据都需要身份保护的系统。

- `_app` loader 必须调用 required current user。
- 未登录直接跳转 `/auth/login?returnTo=...`。
- 业务 route 默认都在登录保护下，不提供匿名业务入口。
- header 永远展示已登录用户状态和登出按钮。
- 不做匿名 local-only 业务状态。

## App Shell 规范

- 顶部 header 高度紧凑，底部 footer 稳定，不做营销式 hero。
- 左侧品牌区：方形 accent 图标、应用名、副标题。
- 中央标题：展示当前业务对象或工作区；桌面在视口横向居中，移动端放第二行居中。
- 右侧操作：主题切换、可选 demo/辅助入口、用户头像/飞书名称、登录或登出。
- `ThemeToggle` 是 36px 图标按钮，切换时同步 `data-theme` 和 `.dark`。
- main 区域按应用决定是否使用 `md:h-dvh md:overflow-hidden`；大屏 dashboard 可以固定高度，常规 CRUD 应允许页面滚动。
- footer 包含 NI logo、版权和版本号；移动端不得横向溢出。
- 路由跳转使用顶部细进度条，不使用全屏 loading 遮罩阻断已可读内容。

## 视觉规范

- 颜色：以 NI purple/accent 作为主操作色，中性背景、清晰边框、语义状态色。
- 圆角：常规卡片、按钮、输入框默认 `8px` 或更小。
- 字体：内部工具使用紧凑、可扫描的标题和正文；不要在卡片、表格、侧栏里使用 hero 级大字。
- 组件：优先复用 `.card`、`.btn`、`.btn-primary`、`.input`、`.badge`、`.section-label`。
- 交互：hover、active、disabled、focus-visible、loading、selected 的行为一致。
- light/dark：所有卡片、表格、弹窗、页脚、上传区、图表和 canvas/3D 区域都必须双主题可读。
- 禁止：装饰性大渐变、无业务价值大插画、单一色相铺满、强阴影、大圆角漂浮卡片、卡片套卡片、营销页式首屏。

## 认证与权限

- 飞书登录只负责确认登录者属于内部飞书组织；登录成功后生成应用 session。
- 非内部飞书组织成员默认不可访问受保护业务。
- 服务端 loader/action/API 必须读取 session 和权限数据后再放行。
- 前端展示权限不能替代服务端校验。
- 涉及选择用户、负责人、审批人或授权成员时，候选来源应是飞书组织全员，并把最终业务关系写入 Supabase。
- service role key、Feishu secret、Vercel token、第三方 API key 等敏感信息只能服务端使用，不得进入 README、handoff、前端 bundle 或提交历史。

## 数据与缓存

- 明确每个数据对象的 source of truth：外部系统、Supabase 业务表、Supabase Storage、Vercel runtime cache、客户端缓存不能混用职责。
- 昂贵资源必须可持久缓存，例如图片、导出文件、解析结果、历史快照和外部 API 聚合结果。
- 面向用户的持久资产必须通过稳定应用路由访问，不要把临时 signed URL 当成长期资源。
- 固定版本、固定源数据、固定配置产生的资产应尽量只生成一次。
- 发布前清理无用表、列、migration、seed、RLS policy、环境变量、包和导出。

## 实现边界

- 页面/流程放在 React Router 路由模块。
- 共享 UI 放在 `app/components`。
- Supabase、Feishu、外部 API、缓存 helper 集中放在 `app/lib`。
- 不为单个页面复制业务逻辑；可复用状态徽标、表格、列表、弹窗、上传控件、空状态和错误状态应抽到共享层。
- 新增依赖前先检查是否已有等价能力。
- 有成熟领域库时优先使用成熟库；如果库太重或影响部署，应选择更轻架构或服务端预处理。

## 模板文件

`template/` 是可复制起点：

- `app/app.css`：Tailwind CSS 4 token、light/dark variables、基础组件类。
- `app/root.tsx`：React Router root、主题 bootstrap、错误边界。
- `app/components/app-shell.tsx`：header/main/footer 和路由进度条组合。
- `app/components/app-header.tsx`：品牌区、居中标题、主题切换、登录状态。
- `app/components/app-footer.tsx`：NI logo、版权和版本号。
- `app/components/theme-toggle.tsx`：主题切换按钮。
- `app/components/user-status.tsx`：用户头像、名称、登录、登出。
- `app/components/ui.tsx`：基础 button/input/card/badge/class helper。
- `app/hooks/useAuth.ts`：客户端读取 session 示例。
- `app/lib/auth-types.ts`、`app/lib/feishu.ts`、`app/lib/theme.ts`：模板级类型与占位 helper。
- `app/routes/_app.tsx`：游客兼容和登录强制两种 loader 接入点。
- `app/routes/auth.login.tsx`、`app/routes/auth.logout.tsx`：登录/登出页面骨架。
- `package.template.json`、`vite.config.ts`、`tsconfig.json`：推荐大版本配置。
- `TEMPLATE_NOTES.md`：复制模板后的替换清单和游客模式说明。

## 工具与验证

- 修改 UI 后必须用真实浏览器验证桌面、移动端、light/dark、登录/未登录。
- 修改认证、权限、Supabase、Vercel 配置时，说明实际验证到的组织、项目、环境和剩余风险。
- 常规验证优先运行：`typecheck`、`lint`、`test`、`build`。
- 对图片、3D、canvas、文件预览和动态图形，检查是否非空、居中、可交互且无渲染错误。
- 发布前确认生产 Vercel Ready、目标域名 alias 正确、error logs 无异常。
- handoff 必须记录当前状态、刚完成变更、验证结果、未完成事项和关键风险。
