# Cyber Power 架构

## 数据流

```text
用户本地 .wpilog
  -> 浏览器 File/Blob
  -> Web Worker 分块解析 WPILOG 1.0
  -> EnergyLogger 契约发现与校验
  -> typed arrays + 区间分析
  -> ECharts、指标卡和表格
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
2. `pnpm typecheck && pnpm lint && pnpm test && pnpm build`。
3. Vercel Git Integration 指向私有仓库 `nirobotics/cyber-power` 的 `main`。
4. 配置上述生产环境变量并部署 Node.js 22。
5. 将 `power.team8214.com` alias 到生产 deployment。
6. 验证飞书登录、Cookie、真实日志、错误文件、区间拖动、主题切换、移动端和离线刷新。
