# Cyber Power Vendordep

Cyber Power 的 Java 17/WPILib 2026 机器人端 EnergyLogger V2 记录库。公开包路径为 `com.nextinnovation.cyberpower`；当前版本以仓库根目录 `VERSION`、网页页脚和 GitHub Release 为准。

机器人端只写 EnergyLogger `2.3`，不提供 V1 写入 API、兼容层或双写。网页端负责读取历史 V1、V2.1、V2.2 和当前 V2.3 日志。

## 在线安装

在 WPILib VS Code 命令面板打开 `Manage Vendor Libraries`，选择 `Install new libraries (online)`，并粘贴：

```text
https://power.team8214.com/vendordep/CyberPower.json
```

也可以在机器人项目根目录执行：

```powershell
.\gradlew.bat vendordep --url=https://power.team8214.com/vendordep/CyberPower.json
```

机器人项目必须保留 WPILib 模板中的：

```groovy
implementation wpi.java.vendor.java()
```

该地址会让 Gradle 从 Cyber Power 的 Maven 仓库解析 runtime JAR，因此只有 JSON 文件并不等于完全离线安装。

## 离线安装

1. 有仓库权限时可从对应版本的 [GitHub Release](https://github.com/nirobotics/cyber-power/releases) 下载；其他队伍从无需 GitHub 权限的公开镜像下载 `cyberpower-java-<VERSION>.jar`：

   ```text
   https://power.team8214.com/vendordep/releases/<VERSION>/cyberpower-java-<VERSION>.jar
   ```

2. 把 JAR 放入机器人项目的 `libs/` 目录。
3. 删除机器人项目中的 `vendordeps/CyberPower.json`，或以其他方式停用这一项 Cyber Power vendordep；不要同时加载在线 vendordep 和本地 JAR，否则会产生重复类。
4. 在机器人项目的 `build.gradle` 中加入：

   ```groovy
   dependencies {
       implementation files("libs/cyberpower-java-<VERSION>.jar")
   }
   ```

5. 在已经安装 WPILib、且所需 WPILib 依赖已存在于本机缓存的环境中验证：

   ```powershell
   .\gradlew.bat clean build --offline
   ```

WPILib 模板中的 `implementation wpi.java.vendor.java()` 仍要保留给其他 vendordep 使用，不要为了 Cyber Power 的离线 JAR 删除这条通用配置。Release 同时提供的 `CyberPower.json` 便于审计或在线安装，但它仍引用远程 Maven URL；若要使用 WPILib Dependency Manager 的完整离线 vendordep 流程，还需要在本地提供对应 Maven 仓库，而不能只复制 JSON。

每个 GitHub Release 固定附带 `CyberPower.json` 与 `cyberpower-java-<VERSION>.jar`，并公布 runtime JAR 的 SHA-256、WPILib 版本、EnergyLogger 契约和 Maven 坐标。当前版本以仓库根目录 `VERSION` 及页面页脚为准。

## 最小接入

机器人初始化时注册日志目标、全局电池电压和可选自定义时间源。默认时间源是 WPILib 微秒时钟；AdvantageKit 或其他日志框架可以实现 `LogSink` 并注入同一日志时钟。

```java
private final EnergyLogger energyLogger =
    EnergyLogger.getInstance()
        .registerLogSink(new WpilibDataLogSink(DataLogManager.getLog()))
        .registerBatteryVoltageSource(RobotController::getBatteryVoltage);
```

每个机器人子系统持有一个 `EnergySubsystem`。每台电机必须提供独立的连接状态。Leader 还要直接提供 Supply Current、Stator Current 和原生 Rotor Velocity；Follower 只提供自己的 Supply Current，并用已注册 Leader 的电机名字关联。

```java
private final EnergySubsystem energy = energyLogger.createSubsystem("shooter");

public Shooter() {
  energy.registerLeaderMotor(
      "pitch",
      MotorType.KRAKEN_X44_FOC,
      ShooterConfig.PITCH_ANALYSIS_REDUCTION,
      () -> inputs.pitchConnected,
      () -> inputs.pitchSupplyCurrentAmps,
      () -> inputs.pitchStatorCurrentAmps,
      () -> inputs.pitchRotorVelocityRadPerSec);

  energy.registerFollowerMotor(
      "pitchFollower",
      MotorType.KRAKEN_X44_FOC,
      ShooterConfig.PITCH_ANALYSIS_REDUCTION,
      "pitch",
      () -> inputs.pitchFollowerConnected,
      () -> inputs.pitchFollowerSupplyCurrentAmps);
}
```

`analysisReduction` 表示电机转数除以 Cyber Power 实际分析的输出转数；大于 `1` 为减速。它不是 TalonFX `SensorToMechanismRatio`。例如控制器可用完整传动比把位置换算为机构单位，而 Cyber Power 只传入需要比较和推荐的有效传动级。

Follower 必须与 Leader 位于同一 `EnergySubsystem`，并具有相同 `MotorType` 和 `analysisReduction`。Follower 不注册或记录 Stator Current 与 Rotor Velocity。采样时每台电机的连接状态只读取一次；断连电机不会读取其他数据源，三个槽全部写为 `NaN`。

在所属子系统刷新输入后写入当前状态。所有电机自动继承该状态。机器人调度结束后记录一次全局电压和已注册物理电机的 Supply Current 合计。

```java
energy.periodic(controlState);
energyLogger.periodicRobot();
```

## V2.3 日志键

```text
energyLogger/contractVersion
energyLogger/libraryVersion
energyLogger/manifest
energyLogger/robot/sampleTimestampUs
energyLogger/robot/supplyCurrentAmps
energyLogger/robot/batteryVoltageVolts
energyLogger/subsystems/sN/sampleTimestampUs
energyLogger/subsystems/sN/state
energyLogger/subsystems/sN/motors/samples
```

`motors/samples` 按 manifest 电机顺序交错保存：

```text
[signed Supply Current A, signed Stator Current A, signed raw Rotor Velocity rad/s]
```

连接正常的 Follower 只写有符号 Supply Current，后两项固定为 `NaN`。适配器必须把 Supply Current 规范为“从直流母线取电为正、向直流母线返回为负”，把 Stator Current 规范为“驱动为正、再生制动为负”；这两个符号都不得跟随转子旋转方向翻转。Rotor Velocity 保留机构定义的原生旋转方向。断连时不使用旧值。日志不包含 V1 `current/power/energy` 层级，不记录逐电机电压、Torque Current、Rotor Position、温度、连接状态或 signal age，也不在机器人端积分功率与能量。

## 构建与测试

需要 Java 17。在仓库根目录运行固定的 Gradle 8.11 Wrapper：

```powershell
.\vendordep\gradlew.bat -p vendordep clean test build validateVendordepJson
```

源码只依赖 Java、WPILib `wpilibj` 和 `wpiutil`；不依赖任何电机供应商库。

## 准备与校验发布目录

```powershell
pnpm release:prepare -- <VERSION>
pnpm release:check
```

`release:prepare` 只用于准备一个尚不存在的新版本，并拒绝覆盖已有 Maven 版本。`release:check` 只读校验已经提交的 descriptor、Maven 制品、公开离线镜像、版本一致性与历史 SHA-256，不会重新发布或改写旧版本。完整维护流程见 [发布说明](../docs/releasing.md)。
