#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export async function runStaticChecks(projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")) {
  const failures = [];
  const manifest = await readJson(path.join(projectRoot, "extension/manifest.json"), failures);
  const pkg = await readJson(path.join(projectRoot, "package.json"), failures);
  const popup = await fs.readFile(path.join(projectRoot, "extension/popup.html"), "utf8");
  const panel = await fs.readFile(path.join(projectRoot, "extension/src/sidepanel.html"), "utf8");
  const modes = [...popup.matchAll(/data-mode="([^"]+)"/g)].map((match) => match[1]);
  const panels = [...panel.matchAll(/data-panel="([^"]+)"/g)].map((match) => match[1]);
  if (JSON.stringify(modes) !== JSON.stringify(["ui", "api", "tokens"])) failures.push(`Popup modes are ${JSON.stringify(modes)}`);
  if (JSON.stringify(panels) !== JSON.stringify(["agent", "files", "changes", "activity"])) failures.push(`Side-panel tabs are ${JSON.stringify(panels)}`);
  if (manifest?.manifest_version !== 3) failures.push("Extension is not Manifest V3");
  if (manifest?.version !== "1.3.0") failures.push(`Manifest version is ${manifest?.version}`);
  if (pkg?.version !== "1.3.0") failures.push(`Package version is ${pkg?.version}`);
  for (const permission of ["nativeMessaging", "sidePanel", "storage", "scripting", "tabs", "debugger", "downloads"]) {
    if (!manifest?.permissions?.includes(permission)) failures.push(`Missing permission: ${permission}`);
  }
  for (const [dir, file] of [["extension", "popup.html"], ["extension/src", "sidepanel.html"]]) {
    const html = await fs.readFile(path.join(projectRoot, dir, file), "utf8");
    if (/<script[^>]+src=["']https?:/i.test(html)) failures.push(`${file} references remote code`);
    if (/<script(?![^>]*src=)/i.test(html)) failures.push(`${file} contains inline script`);
  }
  for (const file of ["schemas/protocol-envelope.schema.json", "schemas/runtime-config.schema.json", "schemas/tool-manifest.schema.json", "native-host/config/default.workspaces.json", "native-host/config/trusted-publishers.json"]) {
    await readJson(path.join(projectRoot, file), failures);
  }
  if (failures.length) {
    const error = new Error(`Static checks failed:\n- ${failures.join("\n- ")}`);
    error.failures = failures;
    throw error;
  }
  return { ok: true, modes, panels, manifestVersion: manifest.version, packageVersion: pkg.version };
}

async function readJson(filePath, failures) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    failures.push(`${path.basename(filePath)}: ${error.message}`);
    return null;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.stdout.write(`${JSON.stringify(await runStaticChecks(), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
