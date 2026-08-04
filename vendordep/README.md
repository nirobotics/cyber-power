# Cyber Power Vendordep

Cyber Power 的 Java 17/WPILib 机器人端日志库，包名为 `com.team8214.cyberpower`。

## 安装

在 WPILib VS Code 中打开 `Manage Vendor Libraries`，选择 `Install new libraries (online)`，粘贴：

```text
https://power.team8214.com/vendordep/CyberPower.json
```

机器人项目需要保留：

```groovy
implementation wpi.java.vendor.java()
```

完整的 WPILib DataLog、AdvantageKit、DogLog 和电机注册代码见[根目录示例](../README.md#示例)。

## API

```java
EnergyLogger logger = EnergyLogger.getInstance();
EnergySubsystem subsystem = logger.createSubsystem("shooter");

subsystem.registerMotor(name, type, reduction, connected, supply, stator, rotorVelocity);
subsystem.registerFollowerMotor(name, leaderName, connected, supply);
subsystem.registerMotor(name, connected, supply); // Supply Current only

subsystem.periodic(state);
logger.periodicRobot();
```

`analysisReduction` 是电机转数除以被分析输出的转数。Follower 必须与 Leader 使用相同电机型号和减速比。

Supply Current 取电为正、回流为负；Stator Current 驱动为正、再生制动为负。Rotor Velocity 使用原生 `rad/s`。

## 构建

```powershell
.\vendordep\gradlew.bat -p vendordep clean test build validateVendordepJson
```
