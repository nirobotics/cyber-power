# Cyber Power v{{VERSION}}

## 本版内容

{{CHANGES}}

- Web、vendordep descriptor、Maven/JAR、EnergyLogger `libraryVersion` 与 Git tag 统一为 `{{VERSION}}`。
- 发布经过 Web、Java、跨语言契约、bundle 和不可变制品校验。
- EnergyLogger 数据契约：`{{CONTRACT_VERSION}}`
- WPILib：`{{WPILIB_VERSION}}`
- Maven：`com.nextinnovation.cyberpower:cyberpower-java:{{VERSION}}`

{{BOOTSTRAP_NOTE}}

## 在线安装

在 WPILib VS Code 命令面板打开 `Manage Vendor Libraries`，选择 `Install new libraries (online)` 并输入：

```text
https://power.team8214.com/vendordep/CyberPower.json
```

或在机器人项目根目录运行：

```powershell
.\gradlew.bat vendordep --url=https://power.team8214.com/vendordep/CyberPower.json
```

## 离线 JAR

1. 下载本 Release 的 `cyberpower-java-{{VERSION}}.jar`（公开镜像：`https://power.team8214.com/vendordep/releases/{{VERSION}}/cyberpower-java-{{VERSION}}.jar`），放入机器人项目 `libs/`。
2. 删除或停用该项目的 `vendordeps/CyberPower.json`，避免在线 vendordep 与本地 JAR 产生重复类。
3. 在 `build.gradle` 的 `dependencies` 中加入：

   ```groovy
   implementation files("libs/cyberpower-java-{{VERSION}}.jar")
   ```

4. 在 WPILib 及其依赖已安装到本机后运行：

   ```powershell
   .\gradlew.bat clean build --offline
   ```

`CyberPower.json` 本身仍引用远程 Maven 仓库，不等于完整离线安装。WPILib 模板中的 `implementation wpi.java.vendor.java()` 应保留给其他 vendordep 使用。

## 校验

```text
cyberpower-java-{{VERSION}}.jar
SHA-256: {{JAR_SHA256}}
```
