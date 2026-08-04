# cyber-power

![Next Innovation](https://img.shields.io/badge/Next-Innovation-8A2BE2?labelColor=555555&style=flat)
![Lang zh-CN](https://img.shields.io/badge/Lang-zh--CN-2DBA4E?labelColor=555555&style=flat)
![Node 22](https://img.shields.io/badge/Node-22-2DBA4E?labelColor=555555&style=flat)

Cyber Power 是面向任何正确使用 NI EnergyLogger 的 FRC 机器人 WPILOG 本地能量分析工具。

## 用途

用户通过飞书组织账号登录后，在浏览器本地解析 `.wpilog`，查看电压、电流、功率、累计能量、Brownout、Driver Station 模式和动态子系统占比。原始日志不上传服务器。

兼容性只取决于 WPILOG 1.0 与 NI EnergyLogger 数据契约，不限制队伍、赛季、ProjectName 或子系统命名。

EnergyLogger v2.4 是当前独立的机器人端写入契约，不需要同时写 v1。网页同时读取历史 v2.1、v2.2、v2.3 与当前 v2.4，并在解析边界统一转速单位和符号语义。v2.4 支持仅记录 Supply Current 的电机，以及可选的 PDH/PDP 整机总电流；未注册整机总电流时继续使用已注册物理电机合计。网页用对应电流口径与 Battery Voltage 重建基础能量图；只有提供已知 `MotorType`、Stator Current 和原生 Rotor Velocity 的电机组才提供估算驱动效率、有效覆盖率与减速比建议。未知或自定义电机型号始终拒绝解析。历史 v1 日志继续使用整机、子系统和数据质量功能；因没有 Manifest，不能按电机组进行限流模拟。

独立的“模拟”页按 V2 Manifest 展示每台 Leader 与其 Followers 组成的电机组，并在每行右侧直接填写该组的合计 Supply Current 上限、独立启用一个或多个天然互不重叠的电机组；总开关开启后基于当前共享时间范围实时生成耗电量与峰值变化报告。该上限不是单个电机控制器的配置值。模拟不会修改整机或子系统原图表，也不控制机器人，不预测 Stator Current、电池电压、Brownout 或机构动作结果。

## 目录

- `app/`：React Router 应用、认证和分析界面。
- `vendordep/`：包路径为 `com.nextinnovation.cyberpower` 的 Java 17/WPILib 机器人端记录库。
- `public/vendordep/`：生产 vendordep JSON 与静态 Maven 发布目录。
- `.agents/skills/`：项目级 Cyber Apps、GitHub、Memory 和日志分析 skills。
- `.memory/`：项目长期约束与当前状态；`SCRUM.md` 仅保留本地。
- `supabase/`：仅飞书登录用户资料所需的数据库 migration。
- `docs/architecture.md`：解析、认证、离线和存储边界。
- `docs/validation.md`：真实日志金标与验收方法。
- `.agents/skills/cyber-power-log-analysis/references/energylogger-contract.md`：EnergyLogger v1/v2 数据契约。

## 给人看的工具

- Node.js 22
- pnpm 11
- 现代 Chromium、Firefox 或 Safari

## 机器人端 EnergyLogger

机器人端库通过 WPILib vendordep 安装，网页端继续独立部署。在线安装地址、完全离线使用 JAR 的方式和版本兼容说明见 [Vendordep 使用说明](vendordep/README.md)。从零接入的最小示例：先通过 WPILib `Manage Vendor Libraries` 安装 `https://power.team8214.com/vendordep/CyberPower.json`，再配置全局 Logger，并在子系统注册电机。

```java
// Robot.robotInit()
DataLogManager.start();
EnergyLogger.getInstance()
    .registerLogSink(new WpilibDataLogSink(DataLogManager.getLog()))
    .registerBatteryVoltageSource(RobotController::getBatteryVoltage);

// Subsystem constructor
EnergySubsystem energy = EnergyLogger.getInstance().createSubsystem("shooter");
energy.registerMotor(
    "flywheel",
    MotorType.KRAKEN_X60_FOC,
    FLYWHEEL_REDUCTION,
    () -> inputs.connected,
    () -> inputs.supplyCurrentAmps,
    () -> inputs.statorCurrentAmps,
    () -> inputs.rotorVelocityRadPerSec);
energy.registerFollowerMotor(
    "flywheelFollower",
    "flywheel",
    () -> inputs.followerConnected,
    () -> inputs.followerSupplyCurrentAmps);

// Subsystem.periodic() after refreshing inputs
energy.periodic(goal);

// Robot.robotPeriodic() after CommandScheduler.run()
EnergyLogger.getInstance().periodicRobot();
```

Follower 自动继承 Leader 的型号与分析减速比。只具备 Supply Current 的设备使用三参数 `registerMotor(name, connected, supplyCurrent)`。完整可复制示例以及 AdvantageKit 使用处匿名 `LogSink` 见 [Vendordep 使用说明](vendordep/README.md#从零接入机器人代码)。

每个产品版本使用仓库根目录 `VERSION` 作为唯一版本号，并发布同名 Git tag 与 GitHub Release。Release 固定附带 `CyberPower.json` 和 `cyberpower-java-<VERSION>.jar`；维护者的完整发版与验收流程见 [发布说明](docs/releasing.md)。

## 给人看的使用方法

```powershell
pnpm install
Copy-Item .env.example .env.local
pnpm dev
```

浏览器打开开发服务器地址，登录飞书后选择 `.wpilog` 文件。日志和分析结果默认只存在于本机。

若日志包含完整有效的 EnergyLogger v2.1、v2.2、v2.3 或 v2.4，“子系统”页的“明细”可展开查看各状态指标；“电机”页按 Leader 电机展示整组 Follower，具有完整已知模型的组还会展示估算驱动效率、有效覆盖率、当前/推荐减速比、同一有效工况下的铜耗 Wh 和推荐依据；“电池”页按日志声明的整机总电流或已注册电机合计展示电池电压、局部窗口拟合、电压－电流分布以及实际低压与 Brownout。数据不足时对应结果明确显示“不可用”，不会从 Follower 或 v1 聚合节点猜测数据，也不会把局部压降代理表述成电池真实内阻、SOC 或容量。

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
pnpm vendordep:contract
```

```powershell
pnpm log:list -- "C:\path\robot.wpilog"
pnpm log:analyze -- "C:\path\robot.wpilog"
pnpm log:analyze -- "C:\path\robot.wpilog" --start 120 --end 135 --json
pnpm log:benchmark -- --warmup 1 --runs 5 "C:\path\robot.wpilog"
```

`log:list` 只检查容器并列出 entries；`log:analyze` 会校验 EnergyLogger 契约并计算指标；`log:benchmark` 记录解析、区间分析、可选限流模拟与进程内存。`vendordep:contract` 直接解析 Java vendordep 生成的 V2.4 WPILOG，执行跨语言契约验证。`bundle:report` 查看构建组成，`bundle:check` 执行不依赖私有日志的体积门禁。真实样例与性能基线见 [验证文档](docs/validation.md)。

## 维护规则

- 不按队号、ProjectName 或固定子系统名判断兼容性，只按 EnergyLogger 数据契约判断。
- Supabase 仅用于飞书登录用户资料，不保存日志、分析结果或业务历史。
- 不提交任何服务端 secret、`.env.local`、原始 WPILOG 或本地 SCRUM。
- 生产入口为 `https://power.team8214.com`。
- 已认证页面缓存最多 7 天，用于同一浏览器配置下的离线本地分析；缓存壳不含姓名、头像、飞书 ID 或 Supabase ID。
