import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFile(path.join(root, file), "utf8");

test("active Extension Agent UI avoids legacy bridge endpoints", async () => {
  const source = await Promise.all([
    "extension/src/sidepanel.js",
    "extension/src/popup-controller.js",
    "extension/src/workspace-registry.js",
  ].map(read));
  assert.equal(/127\.0\.0\.1:(3333|5050|9000)/.test(source.join("\n")), false);
});

test("compatibility client uses the native tools route", async () => {
  const source = await read("extension/src/ti-router-client.js");
  assert.match(source, /\/v1\/tools\/call/);
  assert.doesNotMatch(source, /\/v1\/tools\/\$\{toolName\}\/call/);
});
