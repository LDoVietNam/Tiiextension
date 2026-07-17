#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { createLocalApi } from "../src/local-api.js";
import { createRuntime } from "../src/runtime.js";

const configIndex = process.argv.indexOf("--config");
const configPath = configIndex >= 0 ? process.argv[configIndex + 1] : process.env.CHATGPT_NATIVE_AGENT_CONFIG;
const hostIndex = process.argv.indexOf("--host");
const portIndex = process.argv.indexOf("--port");
const runtime = await createRuntime({ ...(configPath ? { configPath } : {}) });
const token = process.env.TIIEXTENSION_API_TOKEN
  || process.env.CHATGPT_NATIVE_AGENT_API_TOKEN
  || await ensureToken(runtime.config.api.token_file);
const host = hostIndex >= 0 ? process.argv[hostIndex + 1] : runtime.config.api.host;
const port = portIndex >= 0 ? parsePort(process.argv[portIndex + 1]) : runtime.config.api.port;
const api = createLocalApi({
  runtime,
  host,
  port,
  token,
  allowedOrigins: runtime.config.api.allowed_origins || []
});
const address = await api.listen();
process.stdout.write(`${JSON.stringify({ ok: true, url: address.url, token_file: runtime.config.api.token_file })}\n`);

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

async function shutdown() {
  await api.close();
  await runtime.close();
  process.exitCode = 0;
}

async function ensureToken(filePath) {
  try {
    return (await fs.readFile(filePath, "utf8")).trim();
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const value = crypto.randomBytes(32).toString("base64url");
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, `${value}\n`, { encoding: "utf8", mode: 0o600 });
    return value;
  }
}

function parsePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid --port value: ${value}`);
  }
  return port;
}
