import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  closeSync,
  copyFileSync,
  cpSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import {
  ARTIFACT_RELATIVE_ROOT,
  ARTIFACT_ROOT,
  CHECKSUM_ALGORITHMS,
  DESCRIPTOR_FILE,
  IMMUTABLE_MANIFEST_FILE,
  METADATA_FILE,
  MIRROR_ROOT,
  PACKAGE_FILE,
  RELEASE_STAGING_ROOT,
  ROOT,
  VERSION_FILE,
  VERSION_PATTERN,
  artifactJar,
  assert,
  compareVersions,
  hashFile,
  listFiles,
  metadataVersions,
  readJson,
  readVersion,
  runGradle,
  toPosix,
  writeChecksumSidecars,
  writeJson,
} from "./release-common.mjs";

const STATE_DIRECTORY = join(ROOT, ".release-state");
const LOCK_FILE = join(STATE_DIRECTORY, "release-prepare.lock");
const RECOVERY_LOCK_FILE = join(STATE_DIRECTORY, "release-recovery.lock");
const JOURNAL_FILE = join(STATE_DIRECTORY, "release-prepare-transaction.json");
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const argumentsWithoutSeparator = process.argv.slice(2).filter((argument) => argument !== "--");
const unknownOptions = argumentsWithoutSeparator.filter(
  (argument) =>
    argument.startsWith("--") && argument !== "--dry-run" && argument !== "--recover",
);
assert(unknownOptions.length === 0, `release:prepare 未知参数：${unknownOptions.join(", ")}`);
assert(
  argumentsWithoutSeparator.filter((argument) => argument === "--dry-run").length <= 1,
  "release:prepare 只能指定一次 --dry-run",
);
assert(
  argumentsWithoutSeparator.filter((argument) => argument === "--recover").length <= 1,
  "release:prepare 只能指定一次 --recover",
);
const dryRun = argumentsWithoutSeparator.includes("--dry-run");
const recoverOnly = argumentsWithoutSeparator.includes("--recover");
assert(!(dryRun && recoverOnly), "release:prepare 不能同时使用 --dry-run 与 --recover");
const positional = argumentsWithoutSeparator.filter((argument) => !argument.startsWith("--"));
assert(
  recoverOnly ? positional.length === 0 : positional.length === 1,
  "用法：pnpm release:prepare -- [--dry-run] <YYYY.M.P> | pnpm release:prepare -- --recover",
);
const targetVersion = recoverOnly ? undefined : positional[0];
if (!recoverOnly) {
  assert(VERSION_PATTERN.test(targetVersion), `目标版本格式无效：${targetVersion}`);
}

const transactionToken = randomUUID();
let ownsLock = false;
let ownsRecoveryLock = false;
let ownsJournal = false;
let preservePrepareLock = false;
let signalInProgress = false;

function processIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return undefined;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ESRCH") return false;
    if (error && typeof error === "object" && error.code === "EPERM") return true;
    return undefined;
  }
}

function syncStateDirectory() {
  if (process.platform === "win32") return;
  const descriptor = openSync(STATE_DIRECTORY, "r");
  try {
    try {
      fsyncSync(descriptor);
    } catch (error) {
      if (
        !error ||
        typeof error !== "object" ||
        !["EINVAL", "ENOSYS", "ENOTSUP"].includes(error.code)
      ) {
        throw error;
      }
    }
  } finally {
    closeSync(descriptor);
  }
}

function writeDurableFile(path, contents, flags = "w") {
  const descriptor = openSync(path, flags);
  try {
    writeFileSync(descriptor, contents);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function createLockFile(path, payload) {
  let descriptor;
  let created = false;
  try {
    descriptor = openSync(path, "wx");
    created = true;
    writeFileSync(descriptor, `${JSON.stringify(payload)}\n`, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    syncStateDirectory();
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    if (created) {
      rmSync(path, { force: true });
      syncStateDirectory();
    }
    throw error;
  }
}

function readValidatedPrepareLock() {
  const lock = JSON.parse(readFileSync(LOCK_FILE, "utf8"));
  assert(lock.schemaVersion === 1, "release:prepare 锁版本无效");
  assert(UUID_PATTERN.test(lock.token), "release:prepare 锁 token 无效");
  assert(Number.isSafeInteger(lock.pid) && lock.pid > 0, "release:prepare 锁 pid 无效");
  assert(VERSION_PATTERN.test(lock.targetVersion), "release:prepare 锁目标版本无效");
  return lock;
}

function acquireLock() {
  mkdirSync(STATE_DIRECTORY, { recursive: true });
  if (existsSync(RECOVERY_LOCK_FILE)) {
    throw new Error(`release:prepare 恢复正在运行：${RECOVERY_LOCK_FILE}`);
  }
  try {
    createLockFile(LOCK_FILE, {
      schemaVersion: 1,
      token: transactionToken,
      pid: process.pid,
      targetVersion,
      startedAt: new Date().toISOString(),
    });
  } catch (error) {
    if (!error || typeof error !== "object" || error.code !== "EEXIST") throw error;
    throw new Error(
      `release:prepare 锁已存在，默认不会接管或删除：${LOCK_FILE}\n`
        + "确认没有 release:prepare 进程后，显式运行 pnpm release:prepare -- --recover。",
    );
  }
  ownsLock = true;
  if (existsSync(RECOVERY_LOCK_FILE)) {
    releaseLock();
    throw new Error("release:prepare 恢复在取锁期间启动；已安全放弃本次准备");
  }
  if (existsSync(JOURNAL_FILE)) {
    throw new Error(
      `release:prepare 事务日志已存在，默认不会自动恢复：${JOURNAL_FILE}\n`
        + "确认没有 release:prepare 进程后，显式运行 pnpm release:prepare -- --recover。",
    );
  }
}

function releaseLock() {
  if (!ownsLock) return;
  try {
    if (existsSync(LOCK_FILE)) {
      const lock = JSON.parse(readFileSync(LOCK_FILE, "utf8"));
      if (lock.token === transactionToken) {
        rmSync(LOCK_FILE, { force: true });
        syncStateDirectory();
      }
    }
  } finally {
    ownsLock = false;
  }
}

function acquireRecoveryLock() {
  mkdirSync(STATE_DIRECTORY, { recursive: true });
  try {
    createLockFile(RECOVERY_LOCK_FILE, {
      schemaVersion: 1,
      token: transactionToken,
      pid: process.pid,
      startedAt: new Date().toISOString(),
    });
  } catch (error) {
    if (!error || typeof error !== "object" || error.code !== "EEXIST") throw error;
    throw new Error(
      `release:prepare 恢复锁已存在，默认不会删除：${RECOVERY_LOCK_FILE}\n`
        + "请人工确认没有 --recover 进程，再检查并删除该恢复锁。",
    );
  }
  ownsRecoveryLock = true;
}

function releaseRecoveryLock() {
  if (!ownsRecoveryLock) return;
  try {
    if (existsSync(RECOVERY_LOCK_FILE)) {
      const lock = JSON.parse(readFileSync(RECOVERY_LOCK_FILE, "utf8"));
      if (lock.token === transactionToken) {
        rmSync(RECOVERY_LOCK_FILE, { force: true });
        syncStateDirectory();
      }
    }
  } finally {
    ownsRecoveryLock = false;
  }
}

function snapshotPaths() {
  return [
    VERSION_FILE,
    PACKAGE_FILE,
    DESCRIPTOR_FILE,
    IMMUTABLE_MANIFEST_FILE,
    METADATA_FILE,
    ...CHECKSUM_ALGORITHMS.map((algorithm) => `${METADATA_FILE}.${algorithm}`),
  ];
}

function artifactDirectory(version) {
  return join(ARTIFACT_ROOT, version);
}

function mirrorDirectory(version) {
  return join(MIRROR_ROOT, version);
}

function temporaryArtifactDirectory(version, token) {
  return join(ARTIFACT_ROOT, `.${version}.promoting-${token}`);
}

function temporaryMirrorDirectory(version, token) {
  return join(MIRROR_ROOT, `.${version}.promoting-${token}`);
}

function hashBytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function writeJournal(snapshots) {
  const journal = {
    schemaVersion: 2,
    token: transactionToken,
    targetVersion,
    snapshots: Object.fromEntries(
      [...snapshots].map(([path, bytes]) => [
        toPosix(relative(ROOT, path)),
        {
          base64: bytes.toString("base64"),
          byteLength: bytes.length,
          sha256: hashBytes(bytes),
        },
      ]),
    ),
  };
  const temporaryJournal = `${JOURNAL_FILE}.${transactionToken}.tmp`;
  try {
    writeDurableFile(temporaryJournal, `${JSON.stringify(journal)}\n`, "wx");
    renameSync(temporaryJournal, JOURNAL_FILE);
    syncStateDirectory();
  } catch (error) {
    rmSync(temporaryJournal, { force: true });
    throw error;
  }
}

function readValidatedJournal(expectedToken, expectedTargetVersion) {
  const journal = JSON.parse(readFileSync(JOURNAL_FILE, "utf8"));
  assert(journal.schemaVersion === 2, "release:prepare 恢复日志版本无效");
  assert(VERSION_PATTERN.test(journal.targetVersion), "release:prepare 恢复日志目标版本无效");
  assert(UUID_PATTERN.test(journal.token), "release:prepare 恢复日志 token 无效");
  if (expectedToken !== undefined) {
    assert(journal.token === expectedToken, "release:prepare 恢复日志与锁 token 不一致");
  }
  if (expectedTargetVersion !== undefined) {
    assert(
      journal.targetVersion === expectedTargetVersion,
      "release:prepare 恢复日志与锁或当前事务的目标版本不一致",
    );
  }
  const expectedPaths = snapshotPaths();
  const expectedKeys = expectedPaths.map((path) => toPosix(relative(ROOT, path))).sort();
  const actualKeys = Object.keys(journal.snapshots ?? {}).sort();
  assert(
    JSON.stringify(actualKeys) === JSON.stringify(expectedKeys),
    "release:prepare 恢复日志文件集合无效；拒绝自动覆盖",
  );

  const decodedSnapshots = new Map();
  for (const path of expectedPaths) {
    const key = toPosix(relative(ROOT, path));
    const record = journal.snapshots[key];
    assert(record && typeof record === "object" && !Array.isArray(record), `恢复快照无效：${key}`);
    assert(
      JSON.stringify(Object.keys(record).sort()) ===
        JSON.stringify(["base64", "byteLength", "sha256"]),
      `恢复快照字段无效：${key}`,
    );
    assert(typeof record.base64 === "string", `恢复快照 base64 无效：${key}`);
    assert(
      Number.isSafeInteger(record.byteLength) && record.byteLength >= 0,
      `恢复快照长度无效：${key}`,
    );
    assert(/^[0-9a-f]{64}$/.test(record.sha256), `恢复快照 SHA-256 无效：${key}`);
    const bytes = Buffer.from(record.base64, "base64");
    assert(bytes.toString("base64") === record.base64, `恢复快照不是规范 base64：${key}`);
    assert(bytes.length === record.byteLength, `恢复快照长度不匹配：${key}`);
    assert(hashBytes(bytes) === record.sha256, `恢复快照 SHA-256 不匹配：${key}`);
    decodedSnapshots.set(path, bytes);
  }
  return { journal, decodedSnapshots };
}

function recoverJournal(reason = "未完成", expectedToken, expectedTargetVersion) {
  if (!existsSync(JOURNAL_FILE)) return false;
  const { journal, decodedSnapshots } = readValidatedJournal(
    expectedToken,
    expectedTargetVersion,
  );

  rmSync(temporaryArtifactDirectory(journal.targetVersion, journal.token), {
    recursive: true,
    force: true,
  });
  rmSync(temporaryMirrorDirectory(journal.targetVersion, journal.token), {
    recursive: true,
    force: true,
  });
  rmSync(artifactDirectory(journal.targetVersion), { recursive: true, force: true });
  rmSync(mirrorDirectory(journal.targetVersion), { recursive: true, force: true });
  for (const [path, bytes] of decodedSnapshots) {
    writeDurableFile(path, bytes);
  }
  rmSync(JOURNAL_FILE, { force: true });
  syncStateDirectory();
  ownsJournal = false;
  console.warn(`已从持久事务日志回滚${reason}的 Cyber Power ${journal.targetVersion} 发版。`);
  return true;
}

function runCurrentReleaseCheck() {
  const result = spawnSync(process.execPath, [join(ROOT, "scripts", "release-check.mjs")], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  assert(result.status === 0, "release:check 失败");
}

function renderMetadata(versions) {
  const now = new Date();
  const lastUpdated = [
    now.getUTCFullYear().toString().padStart(4, "0"),
    (now.getUTCMonth() + 1).toString().padStart(2, "0"),
    now.getUTCDate().toString().padStart(2, "0"),
    now.getUTCHours().toString().padStart(2, "0"),
    now.getUTCMinutes().toString().padStart(2, "0"),
    now.getUTCSeconds().toString().padStart(2, "0"),
  ].join("");
  const versionLines = versions.map((version) => `      <version>${version}</version>`).join("\n");
  const latest = versions.at(-1);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<metadata>\n  <groupId>com.nextinnovation.cyberpower</groupId>\n  <artifactId>cyberpower-java</artifactId>\n  <versioning>\n    <latest>${latest}</latest>\n    <release>${latest}</release>\n    <versions>\n${versionLines}\n    </versions>\n    <lastUpdated>${lastUpdated}</lastUpdated>\n  </versioning>\n</metadata>\n`;
}

function recoverExplicitly() {
  acquireRecoveryLock();

  let stalePrepareLock;
  if (existsSync(LOCK_FILE)) {
    try {
      stalePrepareLock = readValidatedPrepareLock();
    } catch (error) {
      throw new Error(
        `release:prepare 锁无法验证，拒绝删除：${LOCK_FILE}\n`
          + "请人工确认没有 release:prepare 进程并检查锁内容。",
        { cause: error },
      );
    }
    const alive = processIsAlive(stalePrepareLock.pid);
    if (alive !== false) {
      throw new Error(
        alive === true
          ? `release:prepare 进程仍可能存活 (pid ${stalePrepareLock.pid})；拒绝恢复`
          : `无法确认 release:prepare pid ${stalePrepareLock.pid} 是否存活；拒绝恢复`,
      );
    }
  }

  const hasJournal = existsSync(JOURNAL_FILE);
  if (hasJournal) {
    assert(
      stalePrepareLock,
      "release:prepare 事务日志缺少原始 prepare 锁；拒绝自动删除任何版本目录",
    );
    readValidatedJournal(stalePrepareLock.token, stalePrepareLock.targetVersion);
  }
  if (!hasJournal && !stalePrepareLock) {
    console.log("release:prepare 没有需要恢复的锁或事务日志。");
    return;
  }

  if (hasJournal) {
    recoverJournal("显式恢复", stalePrepareLock.token, stalePrepareLock.targetVersion);
  }
  if (stalePrepareLock) {
    const currentLock = readValidatedPrepareLock();
    assert(currentLock.token === stalePrepareLock.token, "release:prepare 锁在恢复期间发生变化；拒绝删除");
    rmSync(LOCK_FILE, { force: true });
    syncStateDirectory();
  }
  console.log("release:prepare 显式恢复完成。");
}

function handleSignal(signal) {
  if (signalInProgress) return;
  signalInProgress = true;
  try {
    if (!recoverOnly && ownsJournal) {
      recoverJournal("被中断", transactionToken, targetVersion);
    }
  } catch (error) {
    preservePrepareLock = true;
    console.error("自动回滚失败；请保留事务日志并人工检查：", error);
  } finally {
    if (!preservePrepareLock) releaseLock();
    releaseRecoveryLock();
    process.exit(signal === "SIGINT" ? 130 : 143);
  }
}

process.once("SIGINT", () => handleSignal("SIGINT"));
process.once("SIGTERM", () => handleSignal("SIGTERM"));

function prepare() {
  acquireLock();

  const currentVersion = readVersion();
  assert(
    compareVersions(targetVersion, currentVersion) > 0,
    `目标版本 ${targetVersion} 必须高于当前版本 ${currentVersion}`,
  );
  assert(
    !existsSync(artifactDirectory(targetVersion)),
    `Maven 版本已存在且不可覆盖：${targetVersion}`,
  );
  assert(
    !existsSync(mirrorDirectory(targetVersion)),
    `离线镜像版本已存在且不可覆盖：${targetVersion}`,
  );
  runCurrentReleaseCheck();

  const metadata = readFileSync(METADATA_FILE, "utf8");
  const existingVersions = metadataVersions(metadata).sort(compareVersions);
  assert(
    compareVersions(targetVersion, existingVersions.at(-1)) > 0,
    `目标版本 ${targetVersion} 必须高于 Maven 最高版本`,
  );

  runGradle(
    `-PcyberPowerReleaseVersion=${targetVersion}`,
    "prepareVendordepRelease",
  );
  const stagedArtifactDirectory = join(
    RELEASE_STAGING_ROOT,
    "maven",
    ...ARTIFACT_RELATIVE_ROOT.split("/"),
    targetVersion,
  );
  const stagedDescriptor = join(RELEASE_STAGING_ROOT, "CyberPower.json");
  assert(
    listFiles(stagedArtifactDirectory).length === 25,
    `候选版本 ${targetVersion} 必须包含完整 25 个 Maven 文件`,
  );
  const stagedDescriptorJson = readJson(stagedDescriptor);
  assert(
    stagedDescriptorJson.version === targetVersion &&
      stagedDescriptorJson.javaDependencies?.[0]?.version === targetVersion,
    `候选 descriptor 不是 ${targetVersion}`,
  );
  assert(
    !existsSync(artifactDirectory(targetVersion)) && !existsSync(mirrorDirectory(targetVersion)),
    `候选构建期间 ${targetVersion} 已被其他操作创建；拒绝继续`,
  );

  const snapshots = new Map(snapshotPaths().map((path) => [path, readFileSync(path)]));
  writeJournal(snapshots);
  ownsJournal = true;

  writeFileSync(VERSION_FILE, `${targetVersion}\n`, "utf8");
  const packageJson = readJson(PACKAGE_FILE);
  packageJson.version = targetVersion;
  writeJson(PACKAGE_FILE, packageJson);
  copyFileSync(stagedDescriptor, DESCRIPTOR_FILE);

  const artifactTemporary = temporaryArtifactDirectory(targetVersion, transactionToken);
  cpSync(stagedArtifactDirectory, artifactTemporary, { recursive: true, errorOnExist: true });
  renameSync(artifactTemporary, artifactDirectory(targetVersion));

  writeFileSync(
    METADATA_FILE,
    renderMetadata([...existingVersions, targetVersion].sort(compareVersions)),
    "utf8",
  );
  writeChecksumSidecars(METADATA_FILE);

  mkdirSync(MIRROR_ROOT, { recursive: true });
  const mirrorTemporary = temporaryMirrorDirectory(targetVersion, transactionToken);
  mkdirSync(mirrorTemporary, { recursive: false });
  copyFileSync(DESCRIPTOR_FILE, join(mirrorTemporary, "CyberPower.json"));
  copyFileSync(
    artifactJar(targetVersion),
    join(mirrorTemporary, `cyberpower-java-${targetVersion}.jar`),
  );
  renameSync(mirrorTemporary, mirrorDirectory(targetVersion));

  const immutableManifest = readJson(IMMUTABLE_MANIFEST_FILE);
  for (const relativePath of listFiles(artifactDirectory(targetVersion))) {
    const manifestPath = `${ARTIFACT_RELATIVE_ROOT}/${targetVersion}/${relativePath}`;
    assert(!immutableManifest.artifacts[manifestPath], `不可变清单已存在：${manifestPath}`);
    immutableManifest.artifacts[manifestPath] = hashFile(
      join(artifactDirectory(targetVersion), relativePath),
    );
  }
  immutableManifest.releaseMirrors ??= {};
  for (const relativePath of listFiles(mirrorDirectory(targetVersion))) {
    const manifestPath = `${targetVersion}/${relativePath}`;
    assert(!immutableManifest.releaseMirrors[manifestPath], `镜像清单已存在：${manifestPath}`);
    immutableManifest.releaseMirrors[manifestPath] = hashFile(
      join(mirrorDirectory(targetVersion), relativePath),
    );
  }
  immutableManifest.artifacts = Object.fromEntries(
    Object.entries(immutableManifest.artifacts).sort(([left], [right]) => left.localeCompare(right)),
  );
  immutableManifest.releaseMirrors = Object.fromEntries(
    Object.entries(immutableManifest.releaseMirrors).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  );
  writeJson(IMMUTABLE_MANIFEST_FILE, immutableManifest);

  runCurrentReleaseCheck();
  if (dryRun) {
    recoverJournal("演练", transactionToken, targetVersion);
    runCurrentReleaseCheck();
    console.log(`Cyber Power ${targetVersion} 事务式发版演练通过，工作区已恢复 ${currentVersion}。`);
  } else {
    rmSync(JOURNAL_FILE, { force: true });
    syncStateDirectory();
    ownsJournal = false;
    console.log(
      `Cyber Power ${targetVersion} 制品已准备完成；请检查 diff、提交、部署并等待自动 Release。`,
    );
  }
}

function reportFailure(error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}

if (recoverOnly) {
  try {
    recoverExplicitly();
  } catch (error) {
    reportFailure(error);
  } finally {
    releaseRecoveryLock();
  }
} else {
  try {
    prepare();
  } catch (error) {
    if (ownsJournal) {
      try {
        recoverJournal("失败", transactionToken, targetVersion);
      } catch (rollbackError) {
        preservePrepareLock = true;
        console.error("自动回滚失败；请保留事务日志并人工检查：", rollbackError);
      }
    }
    reportFailure(error);
  } finally {
    if (!preservePrepareLock) releaseLock();
  }
}
