# Cyber Power Vendordep

Cyber Power 的 Java 17/WPILib 2026 机器人端 EnergyLogger V2 记录库。公开包路径为 `com.nextinnovation.cyberpower`，当前版本为 `2026.2.2`。

机器人端只写 EnergyLogger `2.3`，不提供 V1 写入 API、兼容层或双写。网页端负责读取历史 V1、V2.1、V2.2 和当前 V2.3 日志。

## 安装

在 WPILib VS Code 的 Dependency Manager 中选择在线安装，并粘贴：

```text
https://power.team8214.com/vendordep/CyberPower.json
```

机器人项目必须保留 WPILib 模板中的：

```groovy
implementation wpi.java.vendor.java()
```

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

## 生成 Maven 发布目录

```powershell
.\vendordep\gradlew.bat -p vendordep verifyPublishedVendordep
```

该命令将不可变版本发布到 `public/vendordep/maven`。不得覆盖既有 Maven 版本。
