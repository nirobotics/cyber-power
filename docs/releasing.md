# Cyber Power 发布说明

## 版本与制品

仓库根目录 `VERSION` 是产品版本的唯一来源，格式为 `YYYY.M.P`。同一个版本必须同时出现在：

- Web 页脚；
- `public/vendordep/CyberPower.json` 顶层版本与 Java 依赖版本；
- Maven 路径、POM、Gradle module metadata 与 JAR manifest；
- EnergyLogger 的 `libraryVersion`；
- Git tag `v<VERSION>` 与同名 GitHub Release。

已经发布的版本不可覆盖。修改已有版本的 JAR、POM、module metadata、校验文件或 Release asset 都应当让校验失败；修复必须发布新版本。

`v2026.2.2` 是统一发布工具链建立时对既有不可变 runtime JAR 的一次历史补发。该 JAR 不重新构建或覆盖，以 Release 公布的 SHA-256 为准；从下一个版本开始，候选制品必须由对应 tag 中的工具链准备并通过完整一致性门禁。

## 准备新版本

1. 确认工作区只包含本次发布内容，并决定新的 `YYYY.M.P` 版本。
2. 可先运行 `pnpm release:prepare -- --dry-run <VERSION>` 做完整事务演练；演练会在校验后恢复当前版本。
3. 运行 `pnpm release:prepare -- <VERSION>`，生成新的 descriptor、Maven 目录和公开离线镜像。该命令必须拒绝覆盖已有版本。
   候选 JAR 先在 `vendordep/build/release-staging` 隔离构建，随后才进入短暂的 tracked-file promotion。命令使用 `.release-state/` 中的排他锁阻止并发 prepare，并用带长度与 SHA-256 校验的持久事务日志恢复半完成操作。该目录不会被 Gradle `clean` 删除且不会提交。
   异常退出留下锁时，普通 prepare 默认拒绝接管。先确认本机已没有 `release:prepare` 进程，再显式运行 `pnpm release:prepare -- --recover`。恢复命令会拒绝删除仍存活、状态未知或无法验证的锁，也会在任何覆盖或删除前完整验证日志快照、锁 token 与目标版本。事务日志若缺少配对的原始 prepare 锁，自动恢复也会安全拒绝。锁存在时不要手工修改版本、metadata 或制品目录。
4. 运行 `pnpm release:check`，核对 Web、Java、descriptor、Maven metadata、JAR manifest、镜像文件和不可变历史版本。
5. 运行完整项目门禁：

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm bundle:check
pnpm vendordep:contract
```

6. 提交并推送。生产部署完成且静态 descriptor、JAR 和应用版本都可验证后，GitHub Actions 才会创建 Release。

## GitHub Release 契约

Tag 和 Release 名称均为 `v<VERSION>`。除 GitHub 自动生成的源码归档外，每个 Release 只上传这两个自定义资产：

```text
CyberPower.json
cyberpower-java-<VERSION>.jar
```

Release 说明必须包含：

- 本版主要变更；
- EnergyLogger 数据契约版本；
- WPILib 版本；
- Maven 坐标 `com.nextinnovation.cyberpower:cyberpower-java:<VERSION>`；
- 在线安装 URL 和 Gradle 命令；
- 离线 JAR 安装步骤；
- 在线 vendordep 与离线 JAR 不得同时启用的警告；
- runtime JAR 的 SHA-256。

公开离线镜像与 Release asset 必须逐字节一致：

```text
https://power.team8214.com/vendordep/releases/<VERSION>/CyberPower.json
https://power.team8214.com/vendordep/releases/<VERSION>/cyberpower-java-<VERSION>.jar
```

## 自动发布与失败处理

`.github/workflows/release.yml` 在相关版本文件进入 `main` 后运行完整校验，等待 `power.team8214.com` 部署完成，再创建 tag 和 Release。发布使用已提交的 `public/` 制品，不会在 CI 中重新构建并覆盖已有 Maven 版本。

每个提交使用独立的 workflow concurrency key，连续推送不会替换等待中的中间版本。若后续版本的 Vercel 部署先于较早的 Release 检查完成，较早流程允许生产应用已经是更高版本，但仍会逐字节校验该版本保留的 Maven 路径和版本化公开镜像；因此后续部署不会导致中间版本漏发。

手动重跑是幂等的：若同名 Release 已存在，工作流只下载并校验现有资产，不会覆盖 tag、Release 或资产。若已存在内容与仓库、生产站点不一致，工作流失败；先查明原因，再通过新版本修复，禁止删除并重传旧版本。

自动流程失败时按顺序检查：

1. `pnpm release:check` 的版本或不可变制品错误；
2. Web、Java、跨语言契约与 bundle 门禁；
3. Vercel 生产环境是否已部署目标版本或更高版本；
4. 目标版本的 Maven JAR 与版本化公开镜像是否仍可访问并与仓库逐字节一致；
5. GitHub Actions 的 `contents: write` 权限和同名 Release 资产。
