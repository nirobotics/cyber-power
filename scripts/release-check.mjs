import { timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ARTIFACT_ID,
  CHECKSUM_ALGORITHMS,
  DESCRIPTOR_FILE,
  IMMUTABLE_MANIFEST_FILE,
  LEGACY_GROUP_ID,
  MAVEN_ROOT,
  MIRROR_ROOT,
  PACKAGE_FILE,
  PUBLISHED_GROUP_IDS,
  ROOT,
  VERSION_PATTERN,
  artifactJar,
  artifactRelativeRoot,
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

const LEGACY_METADATA_HASHES = Object.fromEntries(
  [
    ["", "3da2e36f921fed40a3510e9b257bf336ca54be9510a80266bbe7edcfa4118936"],
    [".md5", "cfc9dcee9cc982505a94eacd85289c08dbd81b9e8b57279970dcdbd19655ab59"],
    [".sha1", "41cb30a8fd31f1f4be7747dcd591a69aa663872e70f7865d15fedee476f4f285"],
    [".sha256", "7628ab51eb211ce90c97765f851c51530a8ab089656a08dc7a46a7f034b4c3b9"],
    [".sha512", "f3095ec13dc73bbcd670abbd97dc664c9c5a1b90df04e999d0b4745a3ab88398"],
  ].map(([suffix, hash]) => [
    `${artifactRelativeRoot(LEGACY_GROUP_ID)}/maven-metadata.xml${suffix}`,
    hash,
  ]),
);

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
    assert(records[relativePath] === actualHash, `${description} 已被修改：${relativePath}`);
  }
}

function expectedVersionFiles(version) {
  const primaryFiles = [
    `${ARTIFACT_ID}-${version}.jar`,
    `${ARTIFACT_ID}-${version}-sources.jar`,
    `${ARTIFACT_ID}-${version}-javadoc.jar`,
    `${ARTIFACT_ID}-${version}.pom`,
    `${ARTIFACT_ID}-${version}.module`,
  ];
  return primaryFiles
    .flatMap((file) => [file, ...CHECKSUM_ALGORITHMS.map((algorithm) => `${file}.${algorithm}`)])
    .sort();
}

function validateMavenCoordinate(groupId, immutableManifest, descriptorGroupId, productVersion) {
  const relativeRoot = artifactRelativeRoot(groupId);
  const artifactRoot = join(MAVEN_ROOT, ...relativeRoot.split("/"));
  const recordedPaths = Object.keys(immutableManifest.artifacts).filter((path) =>
    path.startsWith(`${relativeRoot}/`),
  );
  const actualFiles = listFiles(artifactRoot);
  if (recordedPaths.length === 0 && actualFiles.length === 0) return false;

  const metadataFile = join(artifactRoot, "maven-metadata.xml");
  assertRegularFile(metadataFile, `${groupId} Maven metadata`);
  assertChecksumSet(metadataFile);
  const metadata = readFileSync(metadataFile, "utf8");
  assert(metadataValue(metadata, "groupId") === groupId, `${groupId} Maven metadata groupId 无效`);
  assert(
    metadataValue(metadata, "artifactId") === ARTIFACT_ID,
    `${groupId} Maven metadata artifactId 无效`,
  );

  const versions = metadataVersions(metadata);
  assert(versions.length > 0, `${groupId} Maven metadata 没有版本`);
  assert(new Set(versions).size === versions.length, `${groupId} Maven metadata 含重复版本`);
  assert(
    versions.every((item) => VERSION_PATTERN.test(item)),
    `${groupId} Maven metadata 含无效版本`,
  );
  const sortedVersions = [...versions].sort(compareVersions);
  assert(
    JSON.stringify(versions) === JSON.stringify(sortedVersions),
    `${groupId} Maven metadata 版本没有按升序排列`,
  );

  const actualVersions = [
    ...new Set(actualFiles.filter((path) => path.includes("/")).map((path) => path.split("/")[0])),
  ].sort(compareVersions);
  const recordedVersions = [
    ...new Set(
      recordedPaths.map((path) => {
        const versionAndFile = path.slice(`${relativeRoot}/`.length);
        const separator = versionAndFile.indexOf("/");
        assert(
          separator > 0 && separator === versionAndFile.lastIndexOf("/"),
          `不可变 Maven 路径无效：${path}`,
        );
        const recordedVersion = versionAndFile.slice(0, separator);
        assert(VERSION_PATTERN.test(recordedVersion), `不可变 Maven 版本无效：${path}`);
        return recordedVersion;
      }),
    ),
  ].sort(compareVersions);
  assert(
    JSON.stringify(sortedVersions) === JSON.stringify(actualVersions) &&
      JSON.stringify(sortedVersions) === JSON.stringify(recordedVersions),
    `${groupId} Maven metadata、目录与不可变清单的版本集合不一致`,
  );

  const highestVersion = sortedVersions.at(-1);
  assert(
    metadataValue(metadata, "latest") === highestVersion &&
      metadataValue(metadata, "release") === highestVersion,
    `${groupId} Maven latest/release 不是最高版本 ${highestVersion}`,
  );
  if (groupId === descriptorGroupId) {
    assert(
      highestVersion === productVersion,
      `CyberPower.json 指向 ${productVersion}，但 ${groupId} 最高版本是 ${highestVersion}`,
    );
  }

  for (const publishedVersion of sortedVersions) {
    const versionDirectory = join(artifactRoot, publishedVersion);
    assert(
      JSON.stringify(listFiles(versionDirectory)) ===
        JSON.stringify(expectedVersionFiles(publishedVersion)),
      `${groupId}:${ARTIFACT_ID}:${publishedVersion} Maven 文件集合无效`,
    );
    for (const relativePath of listFiles(versionDirectory)) {
      if (!CHECKSUM_ALGORITHMS.some((algorithm) => relativePath.endsWith(`.${algorithm}`))) {
        assertChecksumSet(join(versionDirectory, relativePath));
      }
    }
  }
  return true;
}

function validate() {
  const version = readVersion();
  const packageJson = readJson(PACKAGE_FILE);
  assert(packageJson.version === version, `package.json 版本不是 ${version}`);

  const descriptor = readJson(DESCRIPTOR_FILE);
  assert(descriptor.version === version, `CyberPower.json 顶层版本不是 ${version}`);
  const descriptorDependency = descriptor.javaDependencies?.[0];
  assert(
    descriptor.javaDependencies?.length === 1 &&
      PUBLISHED_GROUP_IDS.includes(descriptorDependency.groupId) &&
      descriptorDependency.artifactId === ARTIFACT_ID &&
      descriptorDependency.version === version,
    "CyberPower.json Java 坐标与 VERSION 不一致",
  );

  const immutableManifest = readJson(IMMUTABLE_MANIFEST_FILE);
  assert(immutableManifest.schemaVersion === 1, "不可变清单 schemaVersion 必须为 1");
  assert(
    immutableManifest.artifacts && typeof immutableManifest.artifacts === "object",
    "不可变清单缺少 artifacts",
  );
  assert(
    Object.keys(immutableManifest.artifacts).every((path) =>
      PUBLISHED_GROUP_IDS.some((groupId) =>
        path.startsWith(`${artifactRelativeRoot(groupId)}/`),
      ),
    ),
    "不可变 Maven 清单含未知坐标",
  );
  const presentGroups = PUBLISHED_GROUP_IDS.filter((groupId) =>
    validateMavenCoordinate(groupId, immutableManifest, descriptorDependency.groupId, version),
  );
  assert(
    presentGroups.includes(descriptorDependency.groupId),
    "CyberPower.json 指向的 Maven 坐标不存在",
  );

  const expectedMavenRecords = {
    ...immutableManifest.artifacts,
    ...LEGACY_METADATA_HASHES,
  };
  for (const groupId of presentGroups) {
    if (groupId === LEGACY_GROUP_ID) continue;
    const relativeMetadata = `${artifactRelativeRoot(groupId)}/maven-metadata.xml`;
    for (const suffix of ["", ...CHECKSUM_ALGORITHMS.map((algorithm) => `.${algorithm}`)]) {
      const relativePath = `${relativeMetadata}${suffix}`;
      expectedMavenRecords[relativePath] = hashFile(join(MAVEN_ROOT, ...relativePath.split("/")));
    }
  }
  assertRecordedDirectory(MAVEN_ROOT, expectedMavenRecords, "Maven 仓库");

  const releaseMirrors = immutableManifest.releaseMirrors;
  assert(releaseMirrors && typeof releaseMirrors === "object", "不可变清单缺少 releaseMirrors");
  assertRecordedDirectory(MIRROR_ROOT, releaseMirrors, "公开离线镜像");

  for (const mirrorVersion of listFiles(MIRROR_ROOT)
    .map((path) => path.split("/")[0])
    .filter((item, index, array) => array.indexOf(item) === index)) {
    assert(VERSION_PATTERN.test(mirrorVersion), `离线镜像版本无效：${mirrorVersion}`);
    const directory = join(MIRROR_ROOT, mirrorVersion);
    const expectedFiles = ["CyberPower.json", `${ARTIFACT_ID}-${mirrorVersion}.jar`];
    assert(
      JSON.stringify(listFiles(directory)) === JSON.stringify(expectedFiles),
      `离线镜像 ${mirrorVersion} 必须且只能包含 descriptor 与 runtime JAR`,
    );
    const mirrorDescriptor = readJson(join(directory, "CyberPower.json"));
    const mirrorDependency = mirrorDescriptor.javaDependencies?.[0];
    assert(
      mirrorDescriptor.version === mirrorVersion &&
        mirrorDescriptor.javaDependencies?.length === 1 &&
        PUBLISHED_GROUP_IDS.includes(mirrorDependency.groupId) &&
        mirrorDependency.artifactId === ARTIFACT_ID &&
        mirrorDependency.version === mirrorVersion,
      `离线镜像 ${mirrorVersion} descriptor 版本无效`,
    );
    equalFiles(
      artifactJar(mirrorVersion, mirrorDependency.groupId),
      join(directory, `${ARTIFACT_ID}-${mirrorVersion}.jar`),
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
    artifactJar(version, descriptorDependency.groupId),
    join(currentMirror, `${ARTIFACT_ID}-${version}.jar`),
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
