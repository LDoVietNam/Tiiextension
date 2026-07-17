import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export function createAuditStore({ filePath, scrub = (value) => value, clock = () => new Date().toISOString() }) {
  if (!filePath) throw new TypeError("filePath is required");
  let tailHash = null;
  let queue = Promise.resolve();

  async function append(entry) {
    const operation = queue.then(async () => {
      await initTail();
      const safe = scrub(clone(entry));
      const record = {
        event_id: entry.event_id || `audit_${crypto.randomUUID().replaceAll("-", "")}`,
        at: entry.at || clock(),
        ...safe,
        prev_hash: tailHash || "0".repeat(64)
      };
      record.event_hash = hashRecord(record);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.appendFile(filePath, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
      tailHash = record.event_hash;
      return clone(record);
    });
    queue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  async function list({ limit = 100 } = {}) {
    await queue;
    try {
      const lines = (await fs.readFile(filePath, "utf8")).trim().split(/\n/).filter(Boolean);
      return { entries: lines.slice(-Math.max(1, Math.min(limit, 5000))).map((line) => JSON.parse(line)) };
    } catch (error) {
      if (error.code === "ENOENT") return { entries: [] };
      throw error;
    }
  }

  async function verify() {
    await queue;
    const { entries } = await list({ limit: 500000 });
    let previous = "0".repeat(64);
    for (let index = 0; index < entries.length; index += 1) {
      const record = entries[index];
      if (record.prev_hash !== previous || hashRecord(record) !== record.event_hash) {
        return { valid: false, index, event_id: record.event_id };
      }
      previous = record.event_hash;
    }
    return { valid: true, entries: entries.length, tail_hash: previous };
  }

  async function initTail() {
    if (tailHash !== null) return;
    const { entries } = await listDirect(1);
    tailHash = entries[0]?.event_hash || "0".repeat(64);
  }

  async function listDirect(limit) {
    try {
      const lines = (await fs.readFile(filePath, "utf8")).trim().split(/\n/).filter(Boolean);
      return { entries: lines.slice(-limit).map((line) => JSON.parse(line)) };
    } catch (error) {
      if (error.code === "ENOENT") return { entries: [] };
      throw error;
    }
  }

  return { filePath, append, list, verify };
}

function hashRecord(record) {
  const copy = { ...record };
  delete copy.event_hash;
  return crypto.createHash("sha256").update(JSON.stringify(copy)).digest("hex");
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

