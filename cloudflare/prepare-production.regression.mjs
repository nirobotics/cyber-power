import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { assertStaticConfig, headers, snapshot } from "./prepare-production.mjs";

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "power-assets-"));
  t.after(() => rmSync(dir, { recursive: true }));
  return { dir, put(name, data = "fixture") {
    const path = join(dir, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, data);
  } };
}

const maven = "vendordep/maven/com/team8214/cyberpower/cyberpower-java";

test("configuration is the exact asset-only target", () => {
  const config = JSON.parse(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
  assertStaticConfig(config);
  for (const extra of [{ main: "server.js" }, { routes: [] }, { triggers: { crons: ["* * * * *"] } }]) {
    assert.throws(() => assertStaticConfig({ ...config, ...extra }), /only the fixed Static Assets/);
  }
  assert.throws(() => assertStaticConfig({ ...config, assets: { ...config.assets, binding: "ASSETS" } }));
});

test("only the version resource, not React Router internals, can be staged", (t) => {
  const { dir, put } = fixture(t);
  put("api/version");
  put("api/version.data");
  put(".vite/manifest.json");
  put("__spa-fallback.html");
  assert.deepEqual(Object.keys(snapshot(dir, "build")), ["api/version"]);
  assert.throws(() => snapshot(dir, "stage"), /Unsafe asset path/);
  put(".vite/private.json");
  assert.throws(() => snapshot(dir, "build"), /Unsafe asset path|Unexpected build file/);
});

test("only public Maven JARs and metadata are allowed; new exact versions inherit immutable cache", (t) => {
  const { dir, put } = fixture(t);
  const artifact = `${maven}/2099.1.2/cyberpower-java-2099.1.2.jar`;
  put(artifact);
  put(`${maven}/maven-metadata.xml`);
  const rules = headers(Object.keys(snapshot(dir, "public")));
  assert(rules.includes(`/${maven}/2099.1.2/*\n  ! Cache-Control\n  Cache-Control: public, max-age=31536000, immutable\n`));
  assert(rules.includes("/api/version\n  ! Cache-Control\n  Cache-Control: no-store\n"));
  assert(!rules.includes(`/${maven}/*`));
  put("vendordep/src/main/EnergyLogger.java");
  assert.throws(() => snapshot(dir, "public"), /Unsafe asset path/);
});

test("telemetry, sourcemaps and symlinks are not public assets", (t) => {
  const { dir, put } = fixture(t);
  put("sw.js", 'fetch("/_vercel/insights/script.js")');
  assert.throws(() => snapshot(dir, "stage"), /Vercel telemetry/);
  put("sw.js", "//# sourceMappingURL=sw.js.map");
  assert.throws(() => snapshot(dir, "stage"), /Source map reference/);
  symlinkSync("sw.js", join(dir, "favicon.png"));
  assert.throws(() => snapshot(dir, "stage"), /symlink/);
});
