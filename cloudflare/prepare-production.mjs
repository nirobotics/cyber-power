// Prerender the product and version endpoint; publish only its client/PWA and public Maven artifacts.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

const root = fileURLToPath(new URL("../", import.meta.url));
const sidecar = join(root, "cloudflare");
const stage = join(sidecar, ".production-assets");
const proof = join(sidecar, ".production-manifest.json");
const build = join(root, "build");
const client = join(build, "client");
const worker = "cyber-power";
const publicFiles = new Set(["favicon.png", "ni-logo-purple-word-transparent.png", "pwa-icon-192.png", "pwa-icon-512.png", "pwa-maskable-512.png", "vendordep/CyberPower.json"]);
const excluded = new Set([".vite/manifest.json", "__spa-fallback.html", "api/version.data"]);
const generated = new Set(["index.html", "api/version", "manifest.webmanifest", "sw.js"]);
const mavenDir = /^vendordep\/maven\/com\/(?:nextinnovation|team8214)\/cyberpower\/cyberpower-java\/(\d{4}\.\d+\.\d+)\//;
const artifact = /^vendordep\/maven\/com\/(?:nextinnovation|team8214)\/cyberpower\/cyberpower-java\/(?:maven-metadata\.xml|(\d{4}\.\d+\.\d+)\/cyberpower-java-\1(?:-(?:javadoc|sources)\.jar|\.(?:jar|module|pom)))(?:\.(?:md5|sha1|sha256|sha512))?$/;
const release = /^vendordep\/releases\/(\d{4}\.\d+\.\d+)\/(?:CyberPower\.json|cyberpower-java-\1\.jar)$/;
const privatePart = /^(?:node_modules|archive|validation|cloudflare|docs|tests?|private|src|secrets?|configs?|server)(?:\.|$)/i;
const segment = /^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/;
const sha = (buffer) => createHash("sha256").update(buffer).digest("hex");
const robots = "User-agent: *\nAllow: /\n";

export function assertStaticConfig(config) {
  assert(isDeepStrictEqual(config, {
    name: worker, account_id: "2ca8df5c9754fb7e3f37d08c597535e0", compatibility_date: "2026-11-14",
    workers_dev: false, preview_urls: false, observability: { enabled: false },
    assets: { directory: "./cloudflare/.production-assets", html_handling: "drop-trailing-slash", not_found_handling: "none" },
  }), "Unexpected production Wrangler config; only the fixed Static Assets target is allowed");
}

export function headers(names) {
  const versions = [...new Set(names.map((name) => name.match(mavenDir)?.[0]).filter(Boolean))].sort();
  const immutable = ["  ! Cache-Control", "  Cache-Control: public, max-age=31536000, immutable"];
  return [
    "/*", "  X-Content-Type-Options: nosniff", "  X-Frame-Options: DENY", "  Referrer-Policy: strict-origin-when-cross-origin",
    "  Cache-Control: public, max-age=0, must-revalidate",
    "/assets/*", ...immutable,
    "/api/version", "  ! Cache-Control", "  Cache-Control: no-store", "  Content-Type: application/json; charset=utf-8",
    "/sw.js", "  ! Cache-Control", "  Cache-Control: no-store", "  Service-Worker-Allowed: /",
    "/vendordep/releases/*", ...immutable,
    ...versions.flatMap((directory) => [`/${directory}*`, ...immutable]),
    "/*.jar", "  Content-Type: application/java-archive", "",
  ].join("\n");
}

function allowedFile(name, kind) {
  if (kind === "stage" && (name === "_headers" || name === "robots.txt")) return true;
  if (publicFiles.has(name) || artifact.test(name) || release.test(name)) return true;
  return kind !== "public" && (generated.has(name) || /^workbox-[a-f0-9]{8}\.js$/.test(name)
    || /^assets\/[A-Za-z0-9_.-]+-[A-Za-z0-9_-]{8}\.(?:css|js)$/.test(name));
}

export function snapshot(directory, kind) {
  assert(lstatSync(directory).isDirectory(), "Expected an ordinary asset directory");
  const files = [];
  function walk(prefix) {
    for (const entry of readdirSync(join(directory, prefix))) {
      const name = prefix + entry;
      const path = join(directory, name);
      const stat = lstatSync(path);
      assert(stat.isFile() || stat.isDirectory(), `Non-regular asset or symlink: ${name}`);
      if (kind === "build" && stat.isFile() && excluded.has(name)) continue;
      if (kind === "build" && stat.isDirectory() && name === ".vite") { walk(".vite/"); continue; }
      assert(segment.test(entry) && !privatePart.test(entry), `Unsafe asset path: ${name}`);
      if (stat.isDirectory()) {
        assert(/^vendordep(?:\/|$)/.test(name) || (kind !== "public" && /^(?:assets|api)$/.test(name)), `Unexpected asset directory: ${name}`);
        walk(name + "/");
      } else {
        assert(allowedFile(name, kind), `Unexpected ${kind} file: ${name}`);
        assert(stat.size <= 25 * 1024 * 1024, `Asset exceeds 25 MiB: ${name}`);
        const bytes = readFileSync(path);
        if (/\.(?:css|js)$/.test(name)) assert(!/sourceMappingURL\s*=/.test(bytes.toString()), `Source map reference in ${name}`);
        if (/\.(?:html|js)$/.test(name)) assert(!/\/_vercel\/insights|vitals\.vercel-insights\.com|va\.vercel-scripts\.com/i.test(bytes.toString()), `Vercel telemetry in ${name}`);
        files.push([name, { bytes: bytes.length, sha256: sha(bytes) }]);
      }
    }
  }
  walk("");
  return Object.fromEntries(files.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
}

function readJson(path) {
  assert(lstatSync(path).isFile(), "Expected an ordinary JSON file");
  return JSON.parse(readFileSync(path, "utf8"));
}

function clearDirectory(path) {
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (!stat) return;
  assert(stat.isDirectory(), `Refusing to clear a non-directory or symlink: ${path}`);
  rmSync(path, { recursive: true });
}

function manifest(assets, directory) {
  for (const name of generated) assert(assets[name]?.bytes > 0, `Missing ${name}`);
  assert.equal(assets._headers?.sha256, sha(headers(Object.keys(assets))), "Invalid _headers");
  assert.equal(assets["robots.txt"]?.sha256, sha(robots), "Invalid robots.txt");
  const version = readFileSync(join(root, "VERSION"), "utf8").trim();
  assert.equal(assets["api/version"].sha256, sha(JSON.stringify({ version })), "Incorrect prerendered version response");
  const html = readFileSync(join(directory, "index.html"), "utf8");
  assert(html.includes('"ssr":false') && html.includes('"mode":"initial"'), "Expected static React Router index");
  const sw = readFileSync(join(directory, "sw.js"), "utf8");
  assert(sw.includes("NetworkOnly") && sw.includes("NetworkFirst") && !sw.includes("__spa-fallback"), "Unexpected PWA navigation/API caching");
  const entries = Object.values(assets);
  assert(entries.length <= 20_000, "Too many Static Assets");
  return { schema: "static-production-assets-v1", worker, assetCount: entries.length,
    bytes: entries.reduce((sum, file) => sum + file.bytes, 0), assetTreeSha256: sha(JSON.stringify(assets)), assets };
}

function prepare() {
  clearDirectory(stage);
  rmSync(proof, { force: true });
  clearDirectory(build);
  clearDirectory(join(root, ".react-router"));
  assert(!readdirSync(root).some((name) => name === ".env" || (name.startsWith(".env.") && name !== ".env.example")), "Production build does not take dotenv files");
  const publicFiles = snapshot(join(root, "public"), "public");
  const env = {
    PATH: [dirname(process.execPath), process.env.PATH].filter(Boolean).join(delimiter),
    HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, CI: "1", TZ: "UTC", LC_ALL: "C.UTF-8", CYBER_POWER_STATIC: "1",
  };
  const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, env, stdio: "inherit" });
  run(process.execPath, ["scripts/release-check.mjs", "--no-gradle"]);
  run(join(root, "node_modules/.bin/react-router"), ["build", ".", "--config", "cloudflare/vite-production.config.ts"]);
  assert(lstatSync(build).isDirectory() && !lstatSync(join(build, "server"), { throwIfNoEntry: false }), "Unexpected server output");
  const assets = snapshot(client, "build");
  for (const [name, file] of Object.entries(publicFiles)) assert.deepEqual(assets[name], file, `React Router changed a public asset: ${name}`);
  const tmp = mkdtempSync(join(sidecar, ".production-assets-"));
  try {
    for (const name of Object.keys(assets)) {
      mkdirSync(dirname(join(tmp, name)), { recursive: true });
      copyFileSync(join(client, name), join(tmp, name));
    }
    writeFileSync(join(tmp, "_headers"), headers(Object.keys(assets)), { flag: "wx" });
    writeFileSync(join(tmp, "robots.txt"), robots, { flag: "wx" });
    const staged = snapshot(tmp, "stage");
    for (const [name, file] of Object.entries(assets)) assert.deepEqual(staged[name], file, `Copy changed ${name}`);
    const result = manifest(staged, tmp);
    renameSync(tmp, stage);
    writeFileSync(proof, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
    return result;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  assert.equal(process.version, "v22.23.4", "Use Node 22.23.4");
  assert(lstatSync(sidecar).isDirectory(), "Cloudflare staging parent must not be a symlink");
  assertStaticConfig(readJson(join(root, "wrangler.jsonc")));
  const [action, ...extra] = process.argv.slice(2);
  assert(!extra.length && (action === undefined || action === "--check"), "Usage: node cloudflare/prepare-production.mjs [--check]");
  const result = action === "--check" ? manifest(snapshot(stage, "stage"), stage) : prepare();
  if (action === "--check") assert.deepEqual(result, readJson(proof), "Staged Static Assets changed after preparation");
  const { schema, assetCount, bytes, assetTreeSha256 } = result;
  console.log(JSON.stringify({ schema, worker, assetCount, bytes, assetTreeSha256, proof: "cloudflare/.production-manifest.json" }));
}
