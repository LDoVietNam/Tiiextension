#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createZipBuffer } from "./zip-writer.mjs";

const VERSION = "1.3.0";
const ROOT_NAME = "Tiiextension";
const RELEASE_DIRECTORIES = new Set(["cloudflare", "docs", "extension", "mcp-bridge", "native-host", "openapi", "payloads", "schemas", "scripts", "tests"]);
const RELEASE_ROOT_FILES = new Set(["README.md", "SECURITY.md", "RELEASE-NOTES.md", "VERIFICATION.md", "package.json", "LICENSE", "LICENSE.md"]);

export async function collectReleaseFiles(projectRoot) {
  const results = [];
  await walk(projectRoot, "", results);
  return results.sort();
}

export async function packageRelease({ projectRoot, outputPath, dryRun = false, firefox = false } = {}) {
  const root = path.resolve(projectRoot || path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
  const suffix = firefox ? "-firefox" : "";
  const output = path.resolve(outputPath || path.join(path.dirname(root), `${ROOT_NAME}-v${VERSION}${suffix}.zip`));
  const files = await collectReleaseFiles(root);
  const entries = [];
  const manifestSource = firefox ? "manifest.firefox.json" : "manifest.json";
  for (const relative of files) {
    const normalized = relative.replaceAll(path.sep, "/");
    if (normalized === "extension/manifest.firefox.json" && firefox) {
      entries.push({ name: `${ROOT_NAME}/extension/manifest.json`, data: await fs.readFile(path.join(root, relative)) });
    } else if (normalized === "extension/manifest.json" && firefox) {
      continue;
    } else if (normalized === "extension/manifest.firefox.json" && !firefox) {
      continue;
    } else {
      entries.push({ name: `${ROOT_NAME}/${normalized}`, data: await fs.readFile(path.join(root, relative)) });
    }
  }
  const blueprintPath = path.join(path.dirname(root), "chatgpt-native-agent-extension-complete-blueprint-v2.md");
  try {
    entries.push({ name: `${ROOT_NAME}/docs/BLUEPRINT-v2.md`, data: await fs.readFile(blueprintPath) });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const inventory = entries.map((entry) => ({
    path: entry.name.slice(ROOT_NAME.length + 1),
    bytes: entry.data.length,
    sha256: sha256(entry.data)
  }));
  entries.push({
    name: `${ROOT_NAME}/RELEASE-MANIFEST.json`,
    data: Buffer.from(`${JSON.stringify({ schema: "cnagent-release/1", version: VERSION, product: ROOT_NAME, variant: firefox ? "firefox" : "chrome", files: inventory }, null, 2)}\n`)
  });
  entries.push({
    name: `${ROOT_NAME}/SBOM.json`,
    data: Buffer.from(`${JSON.stringify({
      bomFormat: "CycloneDX",
      specVersion: "1.5",
      version: 1,
      metadata: { component: { type: "application", name: ROOT_NAME, version: VERSION } },
      components: [],
      properties: [{ name: "cnagent.runtime", value: "Node.js 18+ built-ins only" }]
    }, null, 2)}\n`)
  });
  if (dryRun) return { outputPath: output, files: entries.map((entry) => entry.name), bytes: entries.reduce((sum, entry) => sum + entry.data.length, 0) };
  const zip = createZipBuffer(entries);
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, zip);
  const digest = sha256(zip);
  await fs.writeFile(`${output}.sha256`, `${digest}  ${path.basename(output)}\n`, "utf8");
  return { outputPath: output, checksumPath: `${output}.sha256`, sha256: digest, files: entries.length, bytes: zip.length };
}

async function walk(root, relative, results) {
  const directory = path.join(root, relative);
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const child = path.join(relative, entry.name);
    if (!relative && entry.isDirectory() && !RELEASE_DIRECTORIES.has(entry.name)) continue;
    if (!relative && entry.isFile() && !RELEASE_ROOT_FILES.has(entry.name)) continue;
    if (excluded(child, entry.isDirectory())) continue;
    if (entry.isDirectory()) await walk(root, child, results);
    else if (entry.isFile()) results.push(child);
  }
}

function excluded(relative, directory) {
  const normalized = relative.replaceAll("\\", "/");
  const segments = normalized.split("/");
  if (segments.some((segment) => [".git", "node_modules", "dist", "runtime", ".runtime", ".agent-runtime", ".agent-snapshots", "transactions", "artifacts", "snapshots", "secrets", "logs", "data"].includes(segment))) return true;
  if (/\.(?:zip|sha256)$/i.test(normalized)) return true;
  if (/(?:runtime-logs|filesystem-changes|audit)\.jsonl$/i.test(normalized)) return true;
  if (/(?:local-api\.token|\.env(?:\.|$)|\.pem$|id_rsa)/i.test(normalized) && !normalized.endsWith(".env.example")) return true;
  if (directory && normalized === "coverage") return true;
  return false;
}

function sha256(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const dryRun = process.argv.includes("--dry-run");
  const outputIndex = process.argv.indexOf("--output");
  const outputPath = outputIndex >= 0 ? process.argv[outputIndex + 1] : undefined;
  const firefox = process.argv.includes("--firefox");
  const result = await packageRelease({ outputPath, dryRun, firefox });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
