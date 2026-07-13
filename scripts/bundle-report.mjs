import console from "node:console";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";

const FIRST_ROUND_BUDGET = Object.freeze({
  clientAssetsRawBytes: 1_280 * 1_024,
  echartsGzipBytes: 200 * 1_024,
  uploadInitialGzipBytes: 120 * 1_024,
  publicResourcesRawBytes: 120 * 1_024,
  pwaPrecacheBrotliBytes: 500 * 1_024,
});

function printHelp() {
  console.log(`Usage: node scripts/bundle-report.mjs [options]

Options:
  --client <path>    Client build directory (default: build/client)
  --public <path>    Public source directory (default: public)
  --budget <value>   "first-round" or a JSON budget file
  --check            Apply the built-in first-round budget
  --help             Show this help

Budget JSON fields (all optional):
  clientAssetsRawBytes, echartsGzipBytes, uploadInitialGzipBytes,
  publicResourcesRawBytes, pwaPrecacheBrotliBytes`);
}

function parseArguments(argv) {
  const result = {
    clientRoot: "build/client",
    publicRoot: "public",
    budget: undefined,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") continue;
    if (argument === "--help") {
      printHelp();
      return undefined;
    }
    if (argument === "--check") {
      result.budget = "first-round";
      continue;
    }
    if (argument === "--client" || argument === "--public" || argument === "--budget") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
      index += 1;
      if (argument === "--client") result.clientRoot = value;
      if (argument === "--public") result.publicRoot = value;
      if (argument === "--budget") result.budget = value;
      continue;
    }
    throw new Error(`Unknown option: ${argument}`);
  }
  return result;
}

function portablePath(value) {
  return value.split(path.sep).join("/");
}

function displayPath(absolutePath) {
  const relative = path.relative(process.cwd(), absolutePath);
  return portablePath(relative && !relative.startsWith("..") ? relative : absolutePath);
}

async function assertDirectory(directory) {
  const info = await stat(directory).catch(() => undefined);
  if (!info?.isDirectory()) throw new Error(`Directory does not exist: ${directory}`);
}

async function listRelativeFiles(root) {
  const files = [];
  async function visit(directory, prefix) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute, relative);
      else if (entry.isFile()) files.push(relative);
    }
  }
  await visit(root, "");
  return files;
}

function compressedSizes(content) {
  return {
    rawBytes: content.byteLength,
    gzipBytes: gzipSync(content, { level: 9 }).byteLength,
    brotliBytes: brotliCompressSync(content, {
      params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
    }).byteLength,
  };
}

function addSizes(records) {
  return records.reduce(
    (total, record) => ({
      rawBytes: total.rawBytes + record.rawBytes,
      gzipBytes: total.gzipBytes + record.gzipBytes,
      brotliBytes: total.brotliBytes + record.brotliBytes,
    }),
    { rawBytes: 0, gzipBytes: 0, brotliBytes: 0 },
  );
}

function isGeneratedPwaResource(relativePath) {
  const name = path.posix.basename(relativePath);
  return name === "sw.js" ||
    name === "manifest.webmanifest" ||
    name === "registerSW.js" ||
    /^workbox-[\w-]+\.js$/.test(name);
}

async function buildAssetRecords(clientRoot, publicRoot) {
  const publicFiles = new Set(await listRelativeFiles(publicRoot));
  const records = [];
  for (const relativePath of await listRelativeFiles(clientRoot)) {
    const content = await readFile(path.join(clientRoot, relativePath));
    const category = publicFiles.has(relativePath)
      ? "public"
      : isGeneratedPwaResource(relativePath)
        ? "pwa"
        : "client";
    records.push({ path: relativePath, category, ...compressedSizes(content) });
  }
  return records;
}

async function readReactRouterManifest(clientRoot, recordsByPath) {
  const candidates = [...recordsByPath.keys()]
    .filter((relativePath) => /^assets\/manifest-[^/]+\.js$/.test(relativePath))
    .sort();
  for (const relativePath of candidates) {
    const source = await readFile(path.join(clientRoot, relativePath), "utf8");
    const prefix = "window.__reactRouterManifest=";
    const start = source.indexOf(prefix);
    if (start < 0) continue;
    const end = source.lastIndexOf(";");
    if (end <= start) continue;
    return JSON.parse(source.slice(start + prefix.length, end));
  }
  return undefined;
}

function normalizeManifestPath(value) {
  return typeof value === "string" ? value.replace(/^\//, "") : undefined;
}

function recordsForPaths(paths, recordsByPath) {
  return [...new Set(paths)]
    .sort()
    .map((relativePath) => recordsByPath.get(relativePath))
    .filter((record) => record !== undefined);
}

function manifestFiles(entry) {
  return [entry?.module, ...(entry?.imports ?? []), ...(entry?.css ?? [])]
    .map(normalizeManifestPath)
    .filter((value) => value !== undefined);
}

function buildRouteReport(manifest, recordsByPath) {
  if (!manifest) return { routes: [], uploadInitial: { files: [], ...addSizes([]) } };
  const routes = Object.values(manifest.routes ?? {})
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((route) => {
      const records = recordsForPaths(manifestFiles(route), recordsByPath);
      return {
        id: route.id,
        ...(route.path === undefined ? {} : { routePath: route.path }),
        ...(route.index === undefined ? {} : { index: route.index }),
        module: normalizeManifestPath(route.module),
        files: records.map((record) => record.path),
        ...addSizes(records),
      };
    });

  const routeById = new Map(Object.values(manifest.routes ?? {}).map((route) => [route.id, route]));
  const powerRoute = routeById.get("routes/power-analyzer") ??
    Object.values(manifest.routes ?? {}).find(
      (route) => route.parentId === "routes/_app" && route.index === true,
    );
  const activeRouteIds = ["root", "routes/_app", powerRoute?.id].filter(Boolean);
  const initialPaths = manifestFiles(manifest.entry);
  for (const routeId of activeRouteIds) initialPaths.push(...manifestFiles(routeById.get(routeId)));
  const initialRecords = recordsForPaths(initialPaths, recordsByPath);
  return {
    routes,
    uploadInitial: {
      files: initialRecords.map((record) => record.path),
      ...addSizes(initialRecords),
    },
  };
}

async function buildPrecacheReport(clientRoot, recordsByPath) {
  const serviceWorker = recordsByPath.get("sw.js");
  if (!serviceWorker) return { urls: [], duplicateUrls: [], missingUrls: [], ...addSizes([]) };
  const source = await readFile(path.join(clientRoot, "sw.js"), "utf8");
  const urls = [...source.matchAll(/\burl:"((?:\\.|[^"])*)"/g)].map((match) =>
    JSON.parse(`"${match[1]}"`).replace(/^\//, "")
  );
  const counts = new Map();
  for (const url of urls) counts.set(url, (counts.get(url) ?? 0) + 1);
  const uniqueUrls = [...counts.keys()].sort();
  const records = recordsForPaths(uniqueUrls, recordsByPath);
  return {
    urls: uniqueUrls,
    duplicateUrls: uniqueUrls.filter((url) => counts.get(url) > 1),
    missingUrls: uniqueUrls.filter((url) => !recordsByPath.has(url)),
    ...addSizes(records),
  };
}

function keyChunkGroup(records, matcher) {
  const matches = records.filter((record) => matcher(record.path));
  return { files: matches.map((record) => record.path), ...addSizes(matches) };
}

async function loadBudget(value) {
  if (!value) return undefined;
  if (value === "first-round") {
    return { source: "first-round", limits: { ...FIRST_ROUND_BUDGET } };
  }
  const absolutePath = path.resolve(value);
  const parsed = JSON.parse(await readFile(absolutePath, "utf8"));
  const limits = parsed?.limits ?? parsed;
  if (!limits || typeof limits !== "object" || Array.isArray(limits)) {
    throw new Error("Budget JSON must be an object or contain a limits object");
  }
  const allowed = new Set(Object.keys(FIRST_ROUND_BUDGET));
  for (const [name, limit] of Object.entries(limits)) {
    if (!allowed.has(name)) throw new Error(`Unknown budget field: ${name}`);
    if (!Number.isInteger(limit) || limit < 0) {
      throw new Error(`Budget field ${name} must be a non-negative integer byte count`);
    }
  }
  return { source: displayPath(absolutePath), limits };
}

function evaluateBudget(budget, actual) {
  if (!budget) return null;
  const checks = Object.keys(budget.limits).sort().map((name) => ({
    name,
    actualBytes: actual[name],
    limitBytes: budget.limits[name],
    passed: actual[name] <= budget.limits[name],
  }));
  return {
    source: budget.source,
    limits: budget.limits,
    checks,
    passed: checks.every((check) => check.passed),
  };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (!options) return;
  const clientRoot = path.resolve(options.clientRoot);
  const publicRoot = path.resolve(options.publicRoot);
  await assertDirectory(clientRoot);
  await assertDirectory(publicRoot);

  const assets = await buildAssetRecords(clientRoot, publicRoot);
  const recordsByPath = new Map(assets.map((record) => [record.path, record]));
  const clientAssets = assets.filter((record) => record.category === "client");
  const publicResources = assets.filter((record) => record.category === "public");
  const pwaResources = assets.filter((record) => record.category === "pwa");
  const manifest = await readReactRouterManifest(clientRoot, recordsByPath);
  const routeReport = buildRouteReport(manifest, recordsByPath);
  const pwaPrecache = await buildPrecacheReport(clientRoot, recordsByPath);
  const echarts = keyChunkGroup(assets, (relativePath) =>
    /^assets\/echarts(?:[.-]|$)/i.test(relativePath)
  );
  const worker = keyChunkGroup(assets, (relativePath) => /worker[^/]*\.js$/i.test(relativePath));

  const actualBudgetValues = {
    clientAssetsRawBytes: addSizes(clientAssets).rawBytes,
    echartsGzipBytes: echarts.gzipBytes,
    uploadInitialGzipBytes: routeReport.uploadInitial.gzipBytes,
    publicResourcesRawBytes: addSizes(publicResources).rawBytes,
    pwaPrecacheBrotliBytes: pwaPrecache.brotliBytes,
  };
  const budget = evaluateBudget(await loadBudget(options.budget), actualBudgetValues);
  const report = {
    schemaVersion: 1,
    nodeVersion: process.versions.node,
    roots: {
      client: displayPath(clientRoot),
      public: displayPath(publicRoot),
    },
    assets,
    groups: {
      clientAssets,
      publicResources,
      pwaResources,
    },
    totals: {
      all: addSizes(assets),
      clientAssets: addSizes(clientAssets),
      publicResources: addSizes(publicResources),
      pwaResources: addSizes(pwaResources),
    },
    keyChunks: {
      echarts,
      worker,
      uploadInitial: routeReport.uploadInitial,
      routes: routeReport.routes,
    },
    pwaPrecache,
    budget,
  };
  console.log(JSON.stringify(report, null, 2));
  if (budget && !budget.passed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
