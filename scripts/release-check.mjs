import { timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ARTIFACT_RELATIVE_ROOT,
  ARTIFACT_ROOT,
  CHECKSUM_ALGORITHMS,
  DESCRIPTOR_FILE,
  IMMUTABLE_MANIFEST_FILE,
  METADATA_FILE,
  MIRROR_ROOT,
  PACKAGE_FILE,
  ROOT,
  VERSION_PATTERN,
  artifactJar,
  assert,
  assertRegularFile,
  compareVersions,
  fingerprintDirectory,
  hashFile,
  listFiles,
  metadataValue,
  metadataVersions,
  readJson,
  readVersion,
  runGradle,
} from "./release-common.mjs";

const argumentsWithoutSeparator = process.argv.slice(2).filter((argument) => argument !== "--");
const unknownArguments = argumentsWithoutSeparator.filter(
  (argument) => argument !== "--no-gradle" && !argument.startsWith("--tag="),
);
assert(unknownArguments.length === 0, `release:check 未知参数：${unknownArguments.join(", ")}`);
assert(
  argumentsWithoutSeparator.filter((argument) => argument.startsWith("--tag=")).length <= 1,
  "release:check 只能指定一个 --tag",
);
const noGradle = argumentsWithoutSeparator.includes("--no-gradle");
const explicitTag = argumentsWithoutSeparator
  .find((argument) => argument.startsWith("--tag="))
  ?.slice("--tag=".length);

function equalFiles(left, right, description) {
  assertRegularFile(left, description);
  assertRegularFile(right, description);
  const leftBytes = readFileSync(left);
  const rightBytes = readFileSync(right);
  assert(
    leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes),
    `${description} 不是逐字节一致`,
  );
}

function assertChecksumSet(path) {
  for (const algorithm of CHECKSUM_ALGORITHMS) {
    const sidecar = `${path}.${algorithm}`;
    assertRegularFile(sidecar, `${algorithm} 校验文件`);
    const expected = readFileSync(sidecar, "utf8").trim();
    const actual = hashFile(path, algorithm);
    assert(expected === actual, `${sidecar} 内容无效：${expected} != ${actual}`);
  }
}

function assertRecordedDirectory(root, records, description) {
  const actualFiles = listFiles(root);
  const recordedFiles = Object.keys(records).sort();
  assert(
    JSON.stringify(actualFiles) === JSON.stringify(recordedFiles),
    `${description} 的不可变清单与实际文件集合不一致`,
  );
  for (const relativePath of actualFiles) {
    const absolutePath = join(root, ...relativePath.split("/"));
    const actualHash = hashFile(absolutePath);
    assert(
      records[relativePath] === actualHash,
      `${description} 已被修改：${relativePath}`,
    );
  }
}

function validate() {
  const version = readVersion();
  const packageJson = readJson(PACKAGE_FILE);
  assert(packageJson.version === version, `package.json 版本不是 ${version}`);

  const descriptor = readJson(DESCRIPTOR_FILE);
  assert(descriptor.version === version, `CyberPower.json 顶层版本不是 ${version}`);
  assert(
    descriptor.javaDependencies?.length === 1 &&
      descriptor.javaDependencies[0].groupId === "com.nextinnovation.cyberpower" &&
      descriptor.javaDependencies[0].artifactId === "cyberpower-java" &&
      descriptor.javaDependencies[0].version === version,
    "CyberPower.json Java 坐标与 VERSION 不一致",
  );

  assertRegularFile(METADATA_FILE, "Maven metadata");
  assertChecksumSet(METADATA_FILE);
  const metadata = readFileSync(METADATA_FILE, "utf8");
  assert(
    metadataValue(metadata, "groupId") === "com.nextinnovation.cyberpower",
    "Maven metadata groupId 无效",
  );
  assert(metadataValue(metadata, "artifactId") === "cyberpower-java", "Maven metadata artifactId 无效");
  const versions = metadataVersions(metadata);
  assert(versions.length > 0, "Maven metadata 没有版本");
  assert(new Set(versions).size === versions.length, "Maven metadata 含重复版本");
  assert(versions.every((item) => VERSION_PATTERN.test(item)), "Maven metadata 含无效版本");
  const sortedVersions = [...versions].sort(compareVersions);
  assert(
    JSON.stringify(versions) === JSON.stringify(sortedVersions),
    "Maven metadata 版本没有按升序排列",
  );
  const highestVersion = sortedVersions.at(-1);
  assert(highestVersion === version, `VERSION ${version} 不是 Maven 最高版本 ${highestVersion}`);
  assert(metadataValue(metadata, "latest") === version, "Maven latest 与 VERSION 不一致");
  assert(metadataValue(metadata, "release") === version, "Maven release 与 VERSION 不一致");

  for (const publishedVersion of sortedVersions) {
    const versionDirectory = join(ARTIFACT_ROOT, publishedVersion);
    for (const relativePath of listFiles(versionDirectory)) {
      if (!CHECKSUM_ALGORITHMS.some((algorithm) => relativePath.endsWith(`.${algorithm}`))) {
        assertChecksumSet(join(versionDirectory, relativePath));
      }
    }
  }

  const versionDirectories = Object.keys(readJson(IMMUTABLE_MANIFEST_FILE).artifacts ?? {})
    .map((path) => path.slice(`${ARTIFACT_RELATIVE_ROOT}/`.length).split("/")[0])
    .filter(Boolean);
  assert(
    JSON.stringify([...new Set(versionDirectories)].sort(compareVersions)) ===
      JSON.stringify(sortedVersions),
    "不可变 Maven 清单中的版本集合与 metadata 不一致",
  );

  const immutableManifest = readJson(IMMUTABLE_MANIFEST_FILE);
  assert(immutableManifest.schemaVersion === 1, "不可变清单 schemaVersion 必须为 1");
  assert(
    immutableManifest.artifacts && typeof immutableManifest.artifacts === "object",
    "不可变清单缺少 artifacts",
  );
  const mavenVersionFiles = listFiles(ARTIFACT_ROOT).filter(
    (path) => !path.startsWith("maven-metadata.xml"),
  );
  const expectedMavenRecords = Object.fromEntries(
    mavenVersionFiles.map((path) => [
      `${ARTIFACT_RELATIVE_ROOT}/${path}`,
      immutableManifest.artifacts[`${ARTIFACT_RELATIVE_ROOT}/${path}`],
    ]),
  );
  assert(
    Object.values(expectedMavenRecords).every(Boolean) &&
      Object.keys(immutableManifest.artifacts).length === mavenVersionFiles.length,
    "不可变 Maven 清单存在漏项或多余项",
  );
  assertRecordedDirectory(
    ARTIFACT_ROOT,
    Object.fromEntries([
      ...Object.entries(expectedMavenRecords).map(([path, hash]) => [
        path.slice(`${ARTIFACT_RELATIVE_ROOT}/`.length),
        hash,
      ]),
      ...listFiles(ARTIFACT_ROOT)
        .filter((path) => path.startsWith("maven-metadata.xml"))
        .map((path) => [path, hashFile(join(ARTIFACT_ROOT, path))]),
    ]),
    "Maven 仓库",
  );

  const releaseMirrors = immutableManifest.releaseMirrors;
  assert(releaseMirrors && typeof releaseMirrors === "object", "不可变清单缺少 releaseMirrors");
  assertRecordedDirectory(MIRROR_ROOT, releaseMirrors, "公开离线镜像");

  for (const mirrorVersion of listFiles(MIRROR_ROOT)
    .map((path) => path.split("/")[0])
    .filter((item, index, array) => array.indexOf(item) === index)) {
    assert(VERSION_PATTERN.test(mirrorVersion), `离线镜像版本无效：${mirrorVersion}`);
    const directory = join(MIRROR_ROOT, mirrorVersion);
    const expectedFiles = [
      "CyberPower.json",
      `cyberpower-java-${mirrorVersion}.jar`,
    ];
    assert(
      JSON.stringify(listFiles(directory)) === JSON.stringify(expectedFiles),
      `离线镜像 ${mirrorVersion} 必须且只能包含 descriptor 与 runtime JAR`,
    );
    const mirrorDescriptor = readJson(join(directory, "CyberPower.json"));
    assert(
      mirrorDescriptor.version === mirrorVersion &&
        mirrorDescriptor.javaDependencies?.[0]?.version === mirrorVersion,
      `离线镜像 ${mirrorVersion} descriptor 版本无效`,
    );
    equalFiles(
      artifactJar(mirrorVersion),
      join(directory, `cyberpower-java-${mirrorVersion}.jar`),
      `离线镜像 ${mirrorVersion} runtime JAR`,
    );
  }

  const currentMirror = join(MIRROR_ROOT, version);
  equalFiles(
    DESCRIPTOR_FILE,
    join(currentMirror, "CyberPower.json"),
    `当前 ${version} descriptor 镜像`,
  );
  equalFiles(
    artifactJar(version),
    join(currentMirror, `cyberpower-java-${version}.jar`),
    `当前 ${version} runtime JAR 镜像`,
  );

  const expectedTag = explicitTag ??
    (process.env.GITHUB_REF_TYPE === "tag" ? process.env.GITHUB_REF_NAME : undefined);
  if (expectedTag) {
    assert(expectedTag === `v${version}`, `Git tag ${expectedTag} 与 VERSION ${version} 不一致`);
  }

  if (!noGradle) {
    const before = fingerprintDirectory(join(ROOT, "public", "vendordep"));
    runGradle("verifyPublishedVendordep");
    const after = fingerprintDirectory(join(ROOT, "public", "vendordep"));
    assert(before === after, "release:check 修改了 public/vendordep；只读门禁失效");
  }

  return version;
}

try {
  const version = validate();
  console.log(`Cyber Power ${version} 发布一致性与不可变制品校验通过。`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
