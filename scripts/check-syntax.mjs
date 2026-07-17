#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = [];
await collect(projectRoot, files);

for (const file of files.sort()) await check(file);
process.stdout.write(`Syntax OK: ${files.length} JavaScript files\n`);

async function collect(directory, output) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (["node_modules", ".git", ".runtime", "runtime", "artifacts", "snapshots", "transactions"].includes(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) await collect(fullPath, output);
    else if (entry.isFile() && /\.(?:js|mjs)$/i.test(entry.name)) output.push(fullPath);
  }
}

function check(filePath) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--check", filePath], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const stderr = [];
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${path.relative(projectRoot, filePath)} failed syntax check:\n${Buffer.concat(stderr).toString("utf8")}`));
    });
  });
}
