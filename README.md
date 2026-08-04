# cyber-power

Cyber Power 在浏览器中分析 FRC 机器人的 `.wpilog` 能量数据。无需登录，日志不会上传服务器。

[打开 Cyber Power](https://power.team8214.com)

## 安装机器人库

在 WPILib VS Code 中打开 `Manage Vendor Libraries`，选择 `Install new libraries (online)`，粘贴：

```text
https://power.team8214.com/vendordep/CyberPower.json
```

## 示例

先从下面三种日志后端中选择一种。

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
import com.team8214.cyberpower.MotorType;

private final EnergySubsystem energy =
    EnergyLogger.getInstance().createSubsystem("shooter");

public Shooter() {
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

Follower 自动继承 Leader 的电机型号和减速比。只有 Supply Current 的设备使用 `registerMotor(name, connected, supplyCurrent)`。

## 本地开发

需要 Node.js 22 和 pnpm 11。

```powershell
pnpm install
pnpm dev
pnpm typecheck
pnpm test
pnpm build
```
