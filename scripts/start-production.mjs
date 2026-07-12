import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import process from "node:process";

const serverRoot = resolve("build/server");
const candidates = (await readdir(serverRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory() && entry.name.startsWith("nodejs_"))
  .map((entry) => resolve(serverRoot, entry.name, "index.js"));

if (candidates.length !== 1) {
  throw new Error(`Expected one Vercel React Router server entry, found ${candidates.length}`);
}

const child = spawn(
  process.execPath,
  [resolve("node_modules/@react-router/serve/bin.js"), candidates[0]],
  { env: process.env, stdio: "inherit" },
);

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
