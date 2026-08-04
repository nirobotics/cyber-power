# Cyber Power Vendordep

Cyber Power 的 Java 17/WPILib 2026 机器人端 EnergyLogger V2 记录库。公开包路径为 `com.nextinnovation.cyberpower`；当前版本以仓库根目录 `VERSION`、网页页脚和 GitHub Release 为准。

机器人端只写 EnergyLogger `2.4`，不提供 V1 写入 API、兼容层或双写。网页端负责读取历史 V1、V2.1、V2.2、V2.3 和当前 V2.4 日志。

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

## 从零接入机器人代码

### 1. 配置全局 Logger

先完成上面的在线或离线安装。标准 WPILib 项目在创建机器人子系统之前配置日志目标和电池电压；默认时间源已经是 WPILib 微秒时钟。

```java
import com.nextinnovation.cyberpower.EnergyLogger;
import com.nextinnovation.cyberpower.WpilibDataLogSink;
import edu.wpi.first.wpilibj.DataLogManager;
import edu.wpi.first.wpilibj.RobotController;
import edu.wpi.first.wpilibj.TimedRobot;
import edu.wpi.first.wpilibj2.command.CommandScheduler;

public final class Robot extends TimedRobot {
  private final EnergyLogger energyLogger = EnergyLogger.getInstance();
  private RobotContainer robotContainer;

  @Override
  public void robotInit() {
    DataLogManager.start();
    energyLogger
        .registerLogSink(new WpilibDataLogSink(DataLogManager.getLog()))
        .registerBatteryVoltageSource(RobotController::getBatteryVoltage);

    robotContainer = new RobotContainer();
  }

  @Override
  public void robotPeriodic() {
    CommandScheduler.getInstance().run();
    energyLogger.periodicRobot();
  }
}
```

如果机器人已有同步且可信的 PDH/PDP 整机电流，可以在首次采样前额外注册；没有该数据就完全省略这一行，Cyber Power 会继续使用已注册电机合计：

```java
energyLogger.registerRobotTotalCurrentSource(powerDistribution::getTotalCurrent);
```

### 2. 在子系统注册电机

每个机器人子系统持有一个 `EnergySubsystem`。完整分析电机提供已知型号、分析减速比、连接状态、Supply Current、Stator Current 和未经过反馈比例换算的原生 Rotor Velocity：

```java
import com.nextinnovation.cyberpower.EnergyLogger;
import com.nextinnovation.cyberpower.EnergySubsystem;
import com.nextinnovation.cyberpower.MotorType;

private final EnergySubsystem energy =
    EnergyLogger.getInstance().createSubsystem("shooter");

public Shooter() {
  energy.registerMotor(
      "flywheelLeft",
      MotorType.KRAKEN_X60_FOC,
      ShooterConfig.FLYWHEEL_ANALYSIS_REDUCTION,
      () -> inputs.flywheelConnected,
      () -> inputs.flywheelSupplyCurrentAmps,
      () -> inputs.flywheelStatorCurrentAmps,
      () -> inputs.flywheelRotorVelocityRadPerSec);

  energy.registerFollowerMotor(
      "flywheelRight",
      "flywheelLeft",
      () -> inputs.flywheelFollowerConnected,
      () -> inputs.flywheelFollowerSupplyCurrentAmps);

  energy.registerMotor(
      "feeder",
      () -> inputs.feederConnected,
      () -> inputs.feederSupplyCurrentAmps);
}
```

第三个 `feeder` 是 supply-only 注册：它仍参加电流、功率、能量、分状态统计和限流回放，但不生成效率、覆盖率或减速比建议。Cyber Power 只接受 `MotorType` 中的封闭已知型号；不支持 `UNKNOWN`、`CUSTOM` 或任意字符串型号。

Cyber Power Follower 表示同型号、同有效减速比并共享机械工作点的分析组成员，不等于任意控制器 follower。它从已注册 Leader 继承型号与减速比，只注册自己的连接状态和 Supply Current。异构电机或不同传动比必须独立注册。

`analysisReduction` 表示电机转数除以 Cyber Power 实际分析的输出转数；大于 `1` 为减速。它不是 TalonFX `SensorToMechanismRatio`，不得从控制器 feedback ratio 自动推断。

### 3. 在输入刷新后采样

每个子系统在刷新输入之后记录当前状态；Robot 在调度结束后记录一次全局样本：

```java
@Override
public void periodic() {
  io.updateInputs(inputs);
  energy.periodic(goal); // 接受 Enum<?> 或稳定非空字符串
}

// Robot.robotPeriodic() 的 CommandScheduler.run() 之后：
energyLogger.periodicRobot();
```

采样时每台电机的连接状态只读取一次。断连电机不会读取其他数据源，三个槽全部写为 `NaN`。Follower 和 supply-only 电机连接正常时只写 Supply Current，后两槽固定为 `NaN`。

### AdvantageKit：在使用处临时实现 LogSink

核心 JAR 不依赖 AdvantageKit。直接在配置 Cyber Power 的位置临时实现 `LogSink`，无需在 `util` 中保存单独的适配器文件：

```java
import com.nextinnovation.cyberpower.EnergyLogger;
import com.nextinnovation.cyberpower.LogSink;
import edu.wpi.first.wpilibj.RobotController;
import org.littletonrobotics.junction.Logger;

private void configureCyberPower() {
  EnergyLogger.getInstance()
      .registerLogSink(
          new LogSink() {
            @Override
            public void recordDouble(
                String path, double value, String unit, long ignoredTimestampMicros) {
              Logger.recordOutput(path, value, unit);
            }

            @Override
            public void recordLong(
                String path, long value, long ignoredTimestampMicros) {
              Logger.recordOutput(path, value);
            }

            @Override
            public void recordString(
                String path, String value, long ignoredTimestampMicros) {
              Logger.recordOutput(path, value);
            }

            @Override
            public void recordDoubleArray(
                String path, double[] values, String unit, long ignoredTimestampMicros) {
              Logger.recordOutput(path, values);
            }
          })
      .registerTimeSource(Logger::getTimestamp)
      .registerBatteryVoltageSource(RobotController::getBatteryVoltage);
}
```

其他日志框架也只需实现同一个四方法接口，并注册与该日志一致的微秒时钟。

## V2.4 日志键

```text
energyLogger/contractVersion
energyLogger/libraryVersion
energyLogger/manifest
energyLogger/robot/sampleTimestampUs
energyLogger/robot/supplyCurrentAmps
energyLogger/robot/batteryVoltageVolts
energyLogger/robot/totalSupplyCurrentAmps  # optional
energyLogger/subsystems/sN/sampleTimestampUs
energyLogger/subsystems/sN/state
energyLogger/subsystems/sN/motors/samples
```

`motors/samples` 按 manifest 电机顺序交错保存：

```text
[signed Supply Current A, signed Stator Current A, signed raw Rotor Velocity rad/s]
```

连接正常的 Follower 和 supply-only 电机只写有符号 Supply Current，后两项固定为 `NaN`。适配器必须把 Supply Current 规范为“从直流母线取电为正、向直流母线返回为负”，把 Stator Current 规范为“驱动为正、再生制动为负”；这两个符号都不得跟随转子旋转方向翻转。Rotor Velocity 保留机构定义的原生旋转方向。断连时不使用旧值。`robot/supplyCurrentAmps` 永远保留已注册电机合计语义；只有显式注册总电流源时才额外写可选的 `robot/totalSupplyCurrentAmps`。日志不包含 V1 `current/power/energy` 层级，不记录逐电机电压、Torque Current、Rotor Position、温度、连接状态或 signal age，也不在机器人端积分功率与能量。

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
