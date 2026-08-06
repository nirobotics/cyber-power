# cyber-power

![Next Innovation](https://img.shields.io/badge/Next-Innovation-8A2BE2?labelColor=555555&style=flat)
![Lang zh-CN](https://img.shields.io/badge/Lang-zh--CN-2DBA4E?labelColor=555555&style=flat)

Cyber Power 是面向 FRC 的本地能量分析工具，用于读取机器人库生成的 `.wpilog`。它按整机、子系统和电机展示电流、功率、耗电与电池表现，并提供电机效率、减速比建议、限流模拟和数据质量检查。机器人端安装 vendordep、接入日志后端并注册电机，运行后把日志拖入网页即可分析。

[打开 Cyber Power](https://power.team8214.com)

## 安装机器人库

在 WPILib VS Code 中打开 `Manage Vendor Libraries`，选择 `Install new libraries (online)`，粘贴：

```text
https://power.team8214.com/vendordep/CyberPower.json
```

## 示例

### WPILib DataLog

```java
import com.team8214.cyberpower.EnergyLogger;
import com.team8214.cyberpower.WpilibDataLogSink;
import edu.wpi.first.wpilibj.DataLogManager;
import edu.wpi.first.wpilibj.RobotController;

EnergyLogger.getInstance()
    .registerLogSink(new WpilibDataLogSink(DataLogManager.getLog()))
    .registerBatteryVoltageSource(RobotController::getBatteryVoltage);
```

### AdvantageKit

先安装 AdvantageKit：

```text
https://github.com/Mechanical-Advantage/AdvantageKit/releases/latest/download/AdvantageKit.json
```

```java
import com.team8214.cyberpower.EnergyLogger;
import com.team8214.cyberpower.LogSink;
import edu.wpi.first.wpilibj.RobotController;
import org.littletonrobotics.junction.Logger;

EnergyLogger.getInstance()
    .registerLogSink(
        new LogSink() {
          @Override
          public void recordDouble(String path, double value, String unit, long ignored) {
            Logger.recordOutput(path, value, unit);
          }

          @Override
          public void recordLong(String path, long value, long ignored) {
            Logger.recordOutput(path, value);
          }

          @Override
          public void recordString(String path, String value, long ignored) {
            Logger.recordOutput(path, value);
          }

          @Override
          public void recordDoubleArray(String path, double[] values, String unit, long ignored) {
            Logger.recordOutput(path, values);
          }
        })
    .registerTimeSource(Logger::getTimestamp)
    .registerBatteryVoltageSource(RobotController::getBatteryVoltage);
```

### DogLog

先安装 DogLog：

```text
https://doglog.dev/vendordep.json
```

```java
import com.team8214.cyberpower.EnergyLogger;
import com.team8214.cyberpower.LogSink;
import dev.doglog.DogLog;
import edu.wpi.first.wpilibj.RobotController;

EnergyLogger.getInstance()
    .registerLogSink(
        new LogSink() {
          @Override
          public void recordDouble(String path, double value, String unit, long ignored) {
            DogLog.log(path, value, unit);
          }

          @Override
          public void recordLong(String path, long value, long ignored) {
            DogLog.log(path, value);
          }

          @Override
          public void recordString(String path, String value, long ignored) {
            DogLog.log(path, value);
          }

          @Override
          public void recordDoubleArray(String path, double[] values, String unit, long ignored) {
            DogLog.log(path, values, unit);
          }
        })
    .registerBatteryVoltageSource(RobotController::getBatteryVoltage);
```

### 注册电机

```java
import com.team8214.cyberpower.EnergyLogger;
import com.team8214.cyberpower.EnergySubsystem;
import com.team8214.cyberpower.FollowerMotorConfig;
import com.team8214.cyberpower.MotorConfig;
import com.team8214.cyberpower.MotorType;

private final EnergySubsystem energy =
    EnergyLogger.getInstance().createSubsystem("shooter");

public Shooter() {
  energy.registerMotor(
      new MotorConfig(
          "flywheel",
          MotorType.KRAKEN_X60_FOC,
          FLYWHEEL_REDUCTION,
          () -> inputs.connected,
          () -> inputs.supplyCurrentAmps,
          () -> inputs.statorCurrentAmps,
          () -> inputs.rotorVelocityRadPerSec),
      new FollowerMotorConfig(
          "flywheelFollower",
          () -> inputs.followerConnected,
          () -> inputs.followerSupplyCurrentAmps));
}

@Override
public void periodic() {
  io.updateInputs(inputs);
  energy.periodic(goal);
}
```

在 `CommandScheduler.run()` 之后记录整机样本：

```java
EnergyLogger.getInstance().periodicRobot();
```

可以继续传入多个 `FollowerMotorConfig`；Follower 自动继承第一台电机的型号和减速比。只有 Supply Current 的设备使用 `registerMotor(new MotorConfig(name, connected, supplyCurrent))`。
