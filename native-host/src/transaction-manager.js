import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export function createTransactionManager({
  guard,
  store = null,
  events = null,
  dataDir,
  idFactory = (prefix) => `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`,
  clock = () => new Date().toISOString()
}) {
  if (!guard || !dataDir) throw new TypeError("guard and dataDir are required");
  const transactionsDir = path.join(dataDir, "transactions");
  const snapshotsDir = path.join(dataDir, "snapshots");
  const locks = new Map();

  async function begin({ taskId = null, label = "transaction" } = {}) {
    const id = idFactory("tx");
    const directory = path.join(transactionsDir, id);
    const manifest = {
      schema: "cnagent-transaction/1",
      id,
      ...(taskId ? { task_id: taskId } : {}),
      label,
      status: "active",
      created_at: clock(),
      updated_at: clock(),
      operations: [],
      snapshots: []
    };
    await fs.mkdir(path.join(directory, "before"), { recursive: true });
    await fs.mkdir(path.join(directory, "stage"), { recursive: true });
    await fs.mkdir(path.join(directory, "trash"), { recursive: true });
    await persistManifest(manifest);
    await emit("transaction.began", { transaction_id: id, label }, taskId);
    return publicManifest(manifest);
  }

  async function stageWrite(id, inputPath, content, metadata = {}) {
    const manifest = await requireActive(id);
    const resolved = guard.resolveParentInside(inputPath);
    claim(resolved.path, id);
    await ensureSnapshot(manifest, resolved.path);
    const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const stagePath = storagePath(id, "stage", resolved);
    await fs.mkdir(path.dirname(stagePath), { recursive: true });
    await fs.writeFile(stagePath, buffer);
    manifest.operations.push({
      op: "write",
      path: resolved.path,
      workspace_id: resolved.root.id,
      relative: resolved.relative,
      stage_path: stagePath,
      bytes: buffer.length,
      sha256: sha256(buffer),
      metadata
    });
    await persistManifest(manifest);
    return { transaction_id: id, path: resolved.path, bytes: buffer.length, sha256: sha256(buffer) };
  }

  async function stageDelete(id, inputPath, { recursive = true } = {}) {
    const manifest = await requireActive(id);
    const resolved = guard.resolveInside(inputPath);
    claim(resolved.path, id);
    await ensureSnapshot(manifest, resolved.path);
    manifest.operations.push({ op: "delete", path: resolved.path, workspace_id: resolved.root.id, relative: resolved.relative, recursive });
    await persistManifest(manifest);
    return { transaction_id: id, path: resolved.path };
  }

  async function stageMove(id, from, to) {
    const manifest = await requireActive(id);
    const source = guard.resolveInside(from);
    const target = guard.resolveParentInside(to);
    claim(source.path, id);
    claim(target.path, id);
    await ensureSnapshot(manifest, source.path);
    await ensureSnapshot(manifest, target.path);
    manifest.operations.push({ op: "move", from: source.path, to: target.path });
    await persistManifest(manifest);
    return { transaction_id: id, from: source.path, to: target.path };
  }

  async function stageCopy(id, from, to, { recursive = true } = {}) {
    const manifest = await requireActive(id);
    const source = guard.resolveInside(from);
    const target = guard.resolveParentInside(to);
    claim(target.path, id);
    await ensureSnapshot(manifest, target.path);
    manifest.operations.push({ op: "copy", from: source.path, to: target.path, recursive });
    await persistManifest(manifest);
    return { transaction_id: id, from: source.path, to: target.path };
  }

  async function stageMkdir(id, inputPath) {
    const manifest = await requireActive(id);
    const resolved = guard.resolveParentInside(inputPath);
    claim(resolved.path, id);
    await ensureSnapshot(manifest, resolved.path);
    manifest.operations.push({ op: "mkdir", path: resolved.path });
    await persistManifest(manifest);
    return { transaction_id: id, path: resolved.path };
  }

  async function preview(id) {
    const manifest = await loadManifest(id);
    return publicManifest(manifest);
  }

  async function status(id) {
    return publicManifest(await loadManifest(id));
  }

  async function commit(id) {
    const manifest = await loadManifest(id);
    if (manifest.status === "committed") return publicManifest(manifest);
    if (manifest.status !== "active") throw transactionError("TRANSACTION_INVALID_STATE", `Cannot commit transaction in state ${manifest.status}`);
    manifest.status = "committing";
    manifest.updated_at = clock();
    await persistManifest(manifest);
    try {
      for (const operation of manifest.operations) await applyOperation(id, operation);
      await verifyOperations(manifest.operations);
      manifest.status = "committed";
      manifest.committed_at = clock();
      manifest.updated_at = clock();
      await persistManifest(manifest);
      releaseLocks(id);
      await emit("transaction.committed", { transaction_id: id, operations: manifest.operations.length }, manifest.task_id);
      return publicManifest(manifest);
    } catch (error) {
      manifest.failure = { code: error.code || "FILESYSTEM_COMMIT_FAILED", message: error.message };
      await persistManifest(manifest);
      await rollbackInternal(manifest, "commit_failure");
      error.transaction_id = id;
      throw error;
    }
  }

  async function rollback(id) {
    const manifest = await loadManifest(id);
    if (manifest.status === "rolled_back") return publicManifest(manifest);
    return rollbackInternal(manifest, "requested");
  }

  async function rollbackInternal(manifest, reason) {
    manifest.status = "rolling_back";
    manifest.updated_at = clock();
    await persistManifest(manifest);
    try {
      for (const snapshot of [...manifest.snapshots].reverse()) await restoreSnapshotEntry(snapshot);
      manifest.status = "rolled_back";
      manifest.rolled_back_at = clock();
      manifest.rollback_reason = reason;
      manifest.updated_at = clock();
      await persistManifest(manifest);
      releaseLocks(manifest.id);
      await emit("transaction.rolled_back", { transaction_id: manifest.id, reason }, manifest.task_id);
      return publicManifest(manifest);
    } catch (error) {
      manifest.status = "rollback_failed";
      manifest.updated_at = clock();
      manifest.rollback_failure = { code: error.code || "TRANSACTION_ROLLBACK_FAILED", message: error.message };
      await persistManifest(manifest);
      releaseLocks(manifest.id);
      throw transactionError("TRANSACTION_ROLLBACK_FAILED", `Rollback failed for ${manifest.id}: ${error.message}`, { cause: error });
    }
  }

  async function snapshot({ paths = [], label = "snapshot" }) {
    if (!Array.isArray(paths) || !paths.length) throw new Error("paths array is required");
    const id = idFactory("snap");
    const directory = path.join(snapshotsDir, id);
    const files = [];
    await fs.mkdir(path.join(directory, "files"), { recursive: true });
    for (const inputPath of paths) {
      const resolved = guard.resolveInside(inputPath);
      const entry = await capturePath(resolved, path.join(directory, "files"));
      files.push({
        path: entry.path,
        snapshotPath: entry.snapshot_path,
        missing: !entry.exists_before,
        kind: entry.kind,
        sha256: entry.sha256
      });
    }
    const manifest = { schema: "cnagent-snapshot/1", id, label, createdAt: clock(), files };
    await writeJsonAtomic(path.join(directory, "manifest.json"), manifest);
    return clone(manifest);
  }

  async function listSnapshots() {
    await fs.mkdir(snapshotsDir, { recursive: true });
    const entries = await fs.readdir(snapshotsDir, { withFileTypes: true });
    const snapshots = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        snapshots.push(JSON.parse(await fs.readFile(path.join(snapshotsDir, entry.name, "manifest.json"), "utf8")));
      } catch {
        // Invalid/incomplete snapshots are omitted from normal listing.
      }
    }
    snapshots.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { snapshots };
  }

  async function rollbackSnapshot(id) {
    const manifest = JSON.parse(await fs.readFile(path.join(snapshotsDir, id, "manifest.json"), "utf8"));
    const restored = [];
    for (const file of [...manifest.files].reverse()) {
      await restoreSnapshotEntry({
        path: file.path,
        snapshot_path: file.snapshotPath,
        exists_before: !file.missing,
        kind: file.kind,
        sha256: file.sha256
      });
      restored.push({ path: file.path, restored: !file.missing, removed: Boolean(file.missing) });
    }
    return { id, restored };
  }

  async function pruneSnapshots({ olderThanDays = 14 } = {}) {
    const cutoff = Date.now() - Math.max(0, olderThanDays) * 86400000;
    const { snapshots } = await listSnapshots();
    const removed = [];
    for (const item of snapshots) {
      if (new Date(item.createdAt).getTime() >= cutoff) continue;
      await fs.rm(path.join(snapshotsDir, item.id), { recursive: true, force: true });
      removed.push(item.id);
    }
    return { removed };
  }

  async function ensureSnapshot(manifest, inputPath) {
    if (manifest.snapshots.some((entry) => samePath(entry.path, inputPath))) return;
    const resolved = guard.resolveInside(inputPath);
    const directory = path.join(transactionsDir, manifest.id, "before");
    const entry = await capturePath(resolved, directory);
    manifest.snapshots.push(entry);
  }

  async function capturePath(resolved, base) {
    const snapshotPath = path.join(base, safeSegment(resolved.root.id), safeRelative(resolved.relative));
    try {
      const info = await fs.stat(resolved.path);
      await fs.mkdir(path.dirname(snapshotPath), { recursive: true });
      if (info.isDirectory()) await fs.cp(resolved.path, snapshotPath, { recursive: true, force: true });
      else await fs.copyFile(resolved.path, snapshotPath);
      return {
        path: resolved.path,
        workspace_id: resolved.root.id,
        relative: resolved.relative,
        exists_before: true,
        kind: info.isDirectory() ? "directory" : "file",
        snapshot_path: snapshotPath,
        size: info.size,
        ...(info.isFile() ? { sha256: await hashFile(resolved.path) } : {})
      };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      return {
        path: resolved.path,
        workspace_id: resolved.root.id,
        relative: resolved.relative,
        exists_before: false,
        kind: "missing",
        snapshot_path: snapshotPath
      };
    }
  }

  async function restoreSnapshotEntry(snapshot) {
    guard.resolveParentInside(snapshot.path);
    if (!snapshot.exists_before) {
      await fs.rm(snapshot.path, { recursive: true, force: true });
      return;
    }
    await fs.rm(snapshot.path, { recursive: true, force: true });
    await fs.mkdir(path.dirname(snapshot.path), { recursive: true });
    await fs.cp(snapshot.snapshot_path, snapshot.path, { recursive: true, force: true });
    if (snapshot.kind === "file" && snapshot.sha256) {
      const actual = await hashFile(snapshot.path);
      if (actual !== snapshot.sha256) throw transactionError("TRANSACTION_ROLLBACK_VERIFY_FAILED", `Restored hash mismatch: ${snapshot.path}`);
    }
  }

  async function applyOperation(id, operation) {
    if (operation.op === "write") {
      const temporary = `${operation.path}.cnagent-${id}.tmp`;
      await fs.mkdir(path.dirname(operation.path), { recursive: true });
      await fs.copyFile(operation.stage_path, temporary);
      try {
        await fs.rename(temporary, operation.path);
      } catch (error) {
        if (!["EEXIST", "EPERM", "ENOTEMPTY"].includes(error.code)) throw error;
        await fs.rm(operation.path, { recursive: true, force: true });
        await fs.rename(temporary, operation.path);
      }
      return;
    }
    if (operation.op === "delete") {
      await fs.rm(operation.path, { recursive: operation.recursive, force: false });
      return;
    }
    if (operation.op === "mkdir") {
      await fs.mkdir(operation.path, { recursive: true });
      return;
    }
    if (operation.op === "move") {
      await fs.mkdir(path.dirname(operation.to), { recursive: true });
      try {
        await fs.rename(operation.from, operation.to);
      } catch (error) {
        if (error.code !== "EXDEV") throw error;
        await fs.cp(operation.from, operation.to, { recursive: true, force: true });
        await fs.rm(operation.from, { recursive: true, force: true });
      }
      return;
    }
    if (operation.op === "copy") {
      await fs.mkdir(path.dirname(operation.to), { recursive: true });
      await fs.cp(operation.from, operation.to, { recursive: operation.recursive, force: true });
      return;
    }
    throw transactionError("TRANSACTION_UNKNOWN_OPERATION", `Unknown transaction operation: ${operation.op}`);
  }

  async function verifyOperations(operations) {
    for (const operation of operations) {
      if (operation.op === "write") {
        const actual = await hashFile(operation.path);
        if (actual !== operation.sha256) throw transactionError("TRANSACTION_VERIFY_FAILED", `Committed hash mismatch: ${operation.path}`);
      } else if (operation.op === "delete") {
        try {
          await fs.stat(operation.path);
          throw transactionError("TRANSACTION_VERIFY_FAILED", `Deleted path still exists: ${operation.path}`);
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
      } else if (operation.op === "move" || operation.op === "copy") {
        await fs.stat(operation.to);
      } else if (operation.op === "mkdir") {
        const info = await fs.stat(operation.path);
        if (!info.isDirectory()) throw transactionError("TRANSACTION_VERIFY_FAILED", `Expected directory: ${operation.path}`);
      }
    }
  }

  async function requireActive(id) {
    const manifest = await loadManifest(id);
    if (manifest.status !== "active") throw transactionError("TRANSACTION_INVALID_STATE", `Transaction is not active: ${id}`);
    return manifest;
  }

  async function loadManifest(id) {
    if (!/^[A-Za-z0-9_.-]+$/.test(String(id))) throw transactionError("TRANSACTION_INVALID_ID", "Invalid transaction id");
    try {
      return JSON.parse(await fs.readFile(path.join(transactionsDir, id, "manifest.json"), "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") throw transactionError("TRANSACTION_NOT_FOUND", `Transaction not found: ${id}`);
      throw error;
    }
  }

  async function persistManifest(manifest) {
    manifest.updated_at = clock();
    const manifestPath = path.join(transactionsDir, manifest.id, "manifest.json");
    await writeJsonAtomic(manifestPath, manifest);
    if (store) {
      await store.update((draft) => {
        draft.transactions[manifest.id] = {
          id: manifest.id,
          task_id: manifest.task_id,
          label: manifest.label,
          status: manifest.status,
          operations: manifest.operations.length,
          manifest_path: manifestPath,
          updated_at: manifest.updated_at
        };
      });
    }
  }

  async function emit(type, data, taskId) {
    if (events) await events.emit(type, data, { taskId });
  }

  function claim(targetPath, transactionId) {
    const key = normalizePath(targetPath);
    const owner = locks.get(key);
    if (owner && owner !== transactionId) throw transactionError("TRANSACTION_PATH_LOCKED", `Path is locked by ${owner}: ${targetPath}`);
    locks.set(key, transactionId);
  }

  function releaseLocks(transactionId) {
    for (const [key, owner] of locks) if (owner === transactionId) locks.delete(key);
  }

  function storagePath(id, bucket, resolved) {
    return path.join(transactionsDir, id, bucket, safeSegment(resolved.root.id), safeRelative(resolved.relative));
  }

  return {
    begin,
    stageWrite,
    stageDelete,
    stageMove,
    stageCopy,
    stageMkdir,
    preview,
    status,
    commit,
    rollback,
    snapshot,
    listSnapshots,
    rollbackSnapshot,
    pruneSnapshots
  };
}

function publicManifest(manifest) {
  return clone({
    id: manifest.id,
    task_id: manifest.task_id,
    label: manifest.label,
    status: manifest.status,
    created_at: manifest.created_at,
    updated_at: manifest.updated_at,
    committed_at: manifest.committed_at,
    rolled_back_at: manifest.rolled_back_at,
    operations: manifest.operations.map((operation) => {
      const { stage_path, ...safe } = operation;
      return safe;
    }),
    snapshots: manifest.snapshots.map((snapshot) => {
      const { snapshot_path, ...safe } = snapshot;
      return safe;
    }),
    failure: manifest.failure,
    rollback_failure: manifest.rollback_failure
  });
}

async function writeJsonAtomic(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await fs.rename(temporary, filePath);
}

async function hashFile(filePath) {
  return sha256(await fs.readFile(filePath));
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function safeRelative(relative) {
  if (!relative || relative === ".") return "__root__";
  return relative.split(/[\\/]+/).map(safeSegment).join(path.sep);
}

function safeSegment(value) {
  return String(value).replace(/[^A-Za-z0-9_.-]+/g, "_") || "_";
}

function samePath(a, b) {
  return normalizePath(a) === normalizePath(b);
}

function normalizePath(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function transactionError(code, message, options) {
  const error = new Error(message, options);
  error.code = code;
  error.retryable = false;
  return error;
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

