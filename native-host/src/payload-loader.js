import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { pathToFileURL } from "node:url";

export function createPayloadLoader({ mode = "dev", guard, policy = null, processTools = null, trustedKeys = {} }) {
  if (!guard) throw new TypeError("workspace guard is required");
  const registry = new Map();

  async function load(input) {
    const manifestPath = input.path || input.manifest_path;
    const manifestFile = guard.resolveInside(required(manifestPath, "path")).path;
    const manifest = JSON.parse(await fs.readFile(manifestFile, "utf8"));
    normalizeManifest(manifest);
    if (input.expected_name && input.expected_name !== manifest.name) throw payloadError("PAYLOAD_IDENTITY_MISMATCH", "Payload name does not match expected_name");
    if (input.expected_version && input.expected_version !== manifest.version) throw payloadError("PAYLOAD_IDENTITY_MISMATCH", "Payload version does not match expected_version");
    const verified = await verifyManifest({ manifest, manifestFile, mode, guard, trustedKeys });
    if (registry.has(manifest.name)) await unload({ name: manifest.name });

    let worker = null;
    if (manifest.type === "module") {
      worker = await startWorker(verified.entry, { mode, manifest });
    } else if (manifest.type === "command" && !processTools) {
      throw payloadError("PAYLOAD_PROCESS_UNAVAILABLE", "Command payloads require a process supervisor");
    }
    registry.set(manifest.name, {
      manifest,
      manifestFile,
      entry: verified.entry,
      worker,
      signed: verified.signed,
      loadedAt: new Date().toISOString()
    });
    return {
      loaded: true,
      name: manifest.name,
      type: manifest.type,
      version: manifest.version,
      signed: verified.signed,
      capabilities: manifest.capabilities || []
    };
  }

  async function list() {
    return {
      payloads: [...registry.values()].map(({ manifest, signed, loadedAt }) => ({
        name: manifest.name,
        version: manifest.version,
        type: manifest.type,
        capabilities: manifest.capabilities || [],
        signed,
        loaded_at: loadedAt
      }))
    };
  }

  async function unload({ name }) {
    const key = required(name, "name");
    const payload = registry.get(key);
    if (!payload) return { name: key, unloaded: false };
    if (payload.worker) await payload.worker.terminate();
    registry.delete(key);
    return { name: key, unloaded: true };
  }

  async function reload(input) {
    if (input.name) await unload({ name: input.name });
    return load(input);
  }

  async function validate(input) {
    const manifestPath = input.path || input.manifest_path;
    const manifestFile = guard.resolveInside(required(manifestPath, "path")).path;
    const manifest = JSON.parse(await fs.readFile(manifestFile, "utf8"));
    normalizeManifest(manifest);
    const verified = await verifyManifest({ manifest, manifestFile, mode, guard, trustedKeys });
    return { valid: true, manifest, signed: verified.signed, entry: verified.entry };
  }

  async function call({ name, method = "run", args = {}, timeoutMs, timeout_ms }) {
    const payload = registry.get(required(name, "name"));
    if (!payload) throw payloadError("PAYLOAD_NOT_LOADED", `Payload not loaded: ${name}`);
    if (payload.manifest.type === "module") {
      return payload.worker.call(method, args, timeoutMs || timeout_ms || payload.manifest.methods?.[method]?.timeout_ms || 60000);
    }
    const command = payload.manifest.command;
    const renderedArgs = (payload.manifest.args || []).map((value) => renderTemplate(value, args));
    const cwd = payload.manifest.cwd
      ? guard.resolveInside(path.resolve(path.dirname(payload.manifestFile), payload.manifest.cwd)).path
      : path.dirname(payload.manifestFile);
    return processTools.run({ command, args: renderedArgs, cwd, timeoutMs: timeoutMs || timeout_ms || payload.manifest.timeout_ms || 60000 });
  }

  async function close() {
    for (const name of [...registry.keys()]) await unload({ name });
  }

  return { load, list, unload, reload, validate, call, close };
}

export function payloadSignatureData(manifest) {
  const copy = JSON.parse(JSON.stringify(manifest));
  if (copy.signature) delete copy.signature.value;
  return Buffer.from(canonicalJson(copy), "utf8");
}

async function verifyManifest({ manifest, manifestFile, mode, guard, trustedKeys }) {
  let entry = null;
  if (manifest.type === "module") {
    entry = guard.resolveInside(path.resolve(path.dirname(manifestFile), manifest.entry)).path;
  }
  if (mode !== "release") {
    if (manifest.sha256 && entry) await verifyChecksum(entry, manifest.sha256);
    return { signed: Boolean(manifest.signature?.value), entry };
  }
  if (!manifest.sha256 || !manifest.signature?.value || !manifest.signature?.key_id) {
    throw payloadError("PAYLOAD_SIGNATURE_REQUIRED", "Release payload requires sha256 and Ed25519 signature");
  }
  if (manifest.type === "module") await verifyChecksum(entry, manifest.sha256);
  else {
    const commandHash = crypto.createHash("sha256").update(`${manifest.command}\0${(manifest.args || []).join("\0")}`).digest("hex");
    if (commandHash !== manifest.sha256) throw payloadError("PAYLOAD_CHECKSUM_MISMATCH", "Command payload sha256 mismatch");
  }
  if (manifest.signature.algorithm?.toLowerCase() !== "ed25519") throw payloadError("PAYLOAD_SIGNATURE_ALGORITHM", "Only Ed25519 payload signatures are supported");
  const keyValue = resolveTrustedKey(trustedKeys, manifest.signature.key_id);
  if (!keyValue) throw payloadError("PAYLOAD_UNKNOWN_SIGNING_KEY", `Unknown signing key: ${manifest.signature.key_id}`);
  let valid = false;
  try {
    valid = crypto.verify(null, payloadSignatureData(manifest), keyValue, Buffer.from(manifest.signature.value, "base64"));
  } catch {
    valid = false;
  }
  if (!valid) throw payloadError("PAYLOAD_SIGNATURE_INVALID", "Payload signature verification failed");
  return { signed: true, entry };
}

function normalizeManifest(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw payloadError("PAYLOAD_MANIFEST_INVALID", "Payload manifest must be an object");
  for (const key of ["name", "version", "type"]) if (!manifest[key]) throw payloadError("PAYLOAD_MANIFEST_INVALID", `Payload manifest missing ${key}`);
  if (manifest.type === "tool") manifest.type = "module";
  if (!["module", "command"].includes(manifest.type)) throw payloadError("PAYLOAD_MANIFEST_INVALID", `Unsupported payload type: ${manifest.type}`);
  if (manifest.type === "module" && !manifest.entry) throw payloadError("PAYLOAD_MANIFEST_INVALID", "Module payload requires entry");
  if (manifest.type === "command" && !manifest.command) throw payloadError("PAYLOAD_MANIFEST_INVALID", "Command payload requires command");
  if (manifest.capabilities !== undefined && !Array.isArray(manifest.capabilities)) throw payloadError("PAYLOAD_MANIFEST_INVALID", "capabilities must be an array");
}

async function verifyChecksum(entry, expected) {
  const actual = crypto.createHash("sha256").update(await fs.readFile(entry)).digest("hex");
  if (actual !== expected) throw payloadError("PAYLOAD_CHECKSUM_MISMATCH", "Payload sha256 mismatch");
}

async function startWorker(entry, { mode, manifest }) {
  const worker = new Worker(new URL("./payload-worker.js", import.meta.url), {
    workerData: { entry: pathToFileURL(entry).href, mode, manifest },
    env: { NODE_NO_WARNINGS: "1" },
    resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 32 }
  });
  let sequence = 0;
  const pending = new Map();
  let readyResolve;
  let readyReject;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  worker.on("message", (message) => {
    if (message.type === "ready") {
      readyResolve();
      return;
    }
    if (message.type === "init_error") {
      readyReject(payloadError("PAYLOAD_INIT_FAILED", message.error?.message || "Payload worker failed to initialize"));
      return;
    }
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (pending.size === 0) worker.unref();
    if (message.ok) request.resolve(message.result);
    else request.reject(payloadError(message.error?.code || "PAYLOAD_CALL_FAILED", message.error?.message || "Payload call failed"));
  });
  worker.on("error", (error) => {
    readyReject(error);
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  });
  const readyTimer = setTimeout(() => readyReject(payloadError("PAYLOAD_INIT_TIMEOUT", "Payload worker initialization timed out")), 10000);
  try {
    await ready;
  } finally {
    clearTimeout(readyTimer);
  }
  worker.unref();
  return {
    async call(method, args, timeoutMs) {
      const id = `payload_call_${++sequence}`;
      return new Promise((resolve, reject) => {
        worker.ref();
        const timer = setTimeout(() => {
          pending.delete(id);
          if (pending.size === 0) worker.unref();
          reject(payloadError("PAYLOAD_CALL_TIMEOUT", `Payload call timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        worker.postMessage({ type: "call", id, method, args });
      });
    },
    terminate() {
      for (const request of pending.values()) {
        clearTimeout(request.timer);
        request.reject(payloadError("PAYLOAD_UNLOADED", "Payload was unloaded"));
      }
      pending.clear();
      return worker.terminate();
    }
  };
}

function resolveTrustedKey(trustedKeys, keyId) {
  if (Array.isArray(trustedKeys)) return trustedKeys.find((item) => item.key_id === keyId)?.public_key;
  return trustedKeys?.[keyId];
}

function renderTemplate(value, args) {
  return String(value).replace(/\{\{([A-Za-z0-9_.-]+)\}\}/g, (_, key) => {
    const replacement = args?.[key];
    if (replacement === undefined || replacement === null) return "";
    return typeof replacement === "string" ? replacement : JSON.stringify(replacement);
  });
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function required(value, name) {
  if (value === undefined || value === null || value === "") throw new Error(`${name} is required`);
  return value;
}

function payloadError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.retryable = false;
  return error;
}
