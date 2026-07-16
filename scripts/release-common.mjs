import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const VERSION_FILE = join(ROOT, "VERSION");
export const PACKAGE_FILE = join(ROOT, "package.json");
export const DESCRIPTOR_FILE = join(ROOT, "public", "vendordep", "CyberPower.json");
export const MAVEN_ROOT = join(ROOT, "public", "vendordep", "maven");
export const ARTIFACT_RELATIVE_ROOT =
  "com/nextinnovation/cyberpower/cyberpower-java";
export const ARTIFACT_ROOT = join(MAVEN_ROOT, ...ARTIFACT_RELATIVE_ROOT.split("/"));
export const METADATA_FILE = join(ARTIFACT_ROOT, "maven-metadata.xml");
export const MIRROR_ROOT = join(ROOT, "public", "vendordep", "releases");
export const IMMUTABLE_MANIFEST_FILE = join(
  ROOT,
  "vendordep",
  "immutable-artifacts.json",
);
export const RELEASE_STAGING_ROOT = join(ROOT, "vendordep", "build", "release-staging");

export const CHECKSUM_ALGORITHMS = ["md5", "sha1", "sha256", "sha512"];
export const VERSION_PATTERN = /^\d{4}\.\d+\.\d+$/;

export function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function readVersion() {
  const version = readFileSync(VERSION_FILE, "utf8").trim();
  assert(VERSION_PATTERN.test(version), `VERSION 格式无效：${version || "<empty>"}`);
  return version;
}

export function compareVersions(left, right) {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = leftParts[index] - rightParts[index];
    if (difference !== 0) return difference;
  }
  return 0;
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function hashFile(path, algorithm = "sha256") {
  return createHash(algorithm).update(readFileSync(path)).digest("hex");
}

export function listFiles(root) {
  if (!existsSync(root)) return [];
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory()) visit(absolutePath);
      else if (entry.isFile()) files.push(toPosix(relative(root, absolutePath)));
    }
  };
  visit(root);
  return files.sort();
}

export function toPosix(path) {
  return sep === "/" ? path : path.split(sep).join("/");
}

export function writeChecksumSidecars(path) {
  for (const algorithm of CHECKSUM_ALGORITHMS) {
    writeFileSync(`${path}.${algorithm}`, hashFile(path, algorithm), "utf8");
  }
}

export function fingerprintDirectory(root) {
  const hash = createHash("sha256");
  for (const relativePath of listFiles(root)) {
    hash.update(relativePath);
    hash.update("\0");
    hash.update(readFileSync(join(root, ...relativePath.split("/"))));
    hash.update("\0");
  }
  return hash.digest("hex");
}

export function assertRegularFile(path, description = path) {
  assert(existsSync(path) && statSync(path).isFile(), `缺少 ${description}：${path}`);
  assert(statSync(path).size > 0, `${description} 为空：${path}`);
}

export function runGradle(...tasks) {
  const wrapper = join(ROOT, "vendordep", process.platform === "win32" ? "gradlew.bat" : "gradlew");
  const wrapperArguments = ["-p", "vendordep", ...tasks, "--stacktrace"];
  assert(
    wrapperArguments.every((argument) => /^[-A-Za-z0-9_.:=]+$/.test(argument)),
    "Gradle 参数包含不受支持的字符",
  );
  const windows = process.platform === "win32";
  const command = windows ? process.env.ComSpec ?? "cmd.exe" : "sh";
  const commandArguments = windows
    ? ["/d", "/s", "/c", "call", wrapper, ...wrapperArguments]
    : [wrapper, ...wrapperArguments];
  const result = spawnSync(command, commandArguments, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  assert(result.status === 0, `Gradle 任务失败：${tasks.join(" ")}`);
}

export function metadataVersions(xml) {
  return [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map((match) => match[1]);
}

export function metadataValue(xml, element) {
  const match = xml.match(new RegExp(`<${element}>([^<]+)</${element}>`));
  assert(match, `Maven metadata 缺少 <${element}>`);
  return match[1];
}

export function artifactJar(version, root = MAVEN_ROOT) {
  return join(
    root,
    ...ARTIFACT_RELATIVE_ROOT.split("/"),
    version,
    `cyberpower-java-${version}.jar`,
  );
}
