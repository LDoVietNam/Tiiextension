import crypto from "node:crypto";
import { watch as watchNative } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { decodeText, detectBuffer, encodeText } from "./filesystem-codecs.js";
import { createTransactionManager } from "./transaction-manager.js";
import { applyPatchToText, parseUnifiedDiff } from "./unified-diff.js";

const DEFAULT_IGNORES = new Set([
  ".git", "node_modules", "dist", "build", ".next", "coverage",
  ".agent-snapshots", ".agent-runtime", ".runtime", "runtime-logs.jsonl",
  "filesystem-changes.jsonl"
]);

export function createFilesystemTools(guard, options = {}) {
  const baseDir = path.resolve(options.baseDir || process.cwd());
  const changeLogPath = path.resolve(options.changeLogPath || path.join(baseDir, "filesystem-changes.jsonl"));
  const transactions = options.transactions || createTransactionManager({
    guard,
    dataDir: path.resolve(options.dataDir || path.join(baseDir, ".agent-runtime"))
  });
  const policy = options.policy || null;
  const events = options.events || null;
  const watchers = new Map();
  const indexes = new Map();

  async function handle(type, payload = {}) {
    switch (type) {
      case "fs.workspace_info": return workspaceInfo();
      case "fs.roots.list": return { roots: guard.listWorkspaces() };
      case "fs.exists": return exists(payload);
      case "fs.list": return list(payload);
      case "fs.tree": return tree(payload);
      case "fs.stat": return stat(payload);
      case "fs.read": return read(payload);
      case "fs.read_many": return readMany(payload);
      case "fs.read_bytes": return readBytes(payload);
      case "fs.hash": return hash(payload);
      case "fs.detect_encoding": return detectEncoding(payload);
      case "fs.search":
      case "fs.search_text":
      case "fs.grep": return searchText(payload);
      case "fs.search_regex": return searchRegex(payload);
      case "fs.search_glob":
      case "fs.find_files": return searchGlob(payload);
      case "fs.find_duplicates": return findDuplicates(payload);
      case "fs.diff": return diff(payload);
      case "fs.diff_tree": return diffTree(payload);
      case "fs.preview_write": return previewWrite(payload);
      case "fs.preview_patch": return previewPatch(payload);
      case "fs.patch_check": return patchCheck(payload);
      case "fs.mkdir": return mkdir(payload);
      case "fs.write": return write(payload);
      case "fs.write_many": return writeMany(payload);
      case "fs.append": return append(payload);
      case "fs.patch": return patch(payload);
      case "fs.patch_unified": return patchUnified(payload);
      case "fs.delete": return remove(payload);
      case "fs.move": return move(payload);
      case "fs.copy": return copy(payload);
      case "fs.transaction.begin": return transactions.begin(payload);
      case "fs.transaction.status": return transactions.status(required(payload.id, "id"));
      case "fs.transaction.preview": return transactions.preview(required(payload.id, "id"));
      case "fs.transaction.commit": return transactions.commit(required(payload.id, "id"));
      case "fs.transaction.rollback": return transactions.rollback(required(payload.id, "id"));
      case "fs.snapshot": return snapshot(payload);
      case "fs.snapshots.list": return transactions.listSnapshots();
      case "fs.snapshots.prune": return transactions.pruneSnapshots(payload);
      case "fs.rollback": return rollback(payload);
      case "fs.change_log": return changeLog(payload);
      case "fs.watch":
      case "fs.watch.start": return watchStart(payload);
      case "fs.watch.stop": return watchStop(payload);
      case "fs.watch.status": return watchStatus(payload);
      case "fs.index.build": return indexBuild(payload);
      case "fs.index.status": return indexStatus(payload);
      case "fs.index.search": return indexSearch(payload);
      case "fs.index.refresh": return indexRefresh(payload);
      default: throw toolError("FILESYSTEM_UNKNOWN_TOOL", `Unknown filesystem tool: ${type}`);
    }
  }

  async function workspaceInfo() {
    const roots = guard.listWorkspaces();
    const summaries = [];
    for (const root of roots) {
      let packageJson = null;
      try {
        packageJson = JSON.parse(await fs.readFile(path.join(root.path, "package.json"), "utf8"));
      } catch {
        // A workspace does not need to be a Node project.
      }
      summaries.push({
        ...root,
        package: packageJson ? {
          name: packageJson.name,
          version: packageJson.version,
          scripts: Object.keys(packageJson.scripts || {})
        } : null
      });
    }
    return { roots: summaries, ignores: [...DEFAULT_IGNORES] };
  }

  async function exists({ path: inputPath }) {
    const resolved = guard.resolveInside(required(inputPath, "path"));
    try {
      const info = await fs.stat(resolved.path);
      return { path: resolved.path, relative: resolved.relative, workspace_id: resolved.root.id, exists: true, type: typeOf(info) };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      return { path: resolved.path, relative: resolved.relative, workspace_id: resolved.root.id, exists: false };
    }
  }

  async function list({ path: inputPath = ".", offset = 0, limit = 1000 } = {}) {
    const resolved = guard.resolveInside(inputPath);
    const entries = await fs.readdir(resolved.path, { withFileTypes: true });
    const sorted = entries
      .map((entry) => ({
        name: entry.name,
        type: entry.isDirectory() ? "directory" : entry.isSymbolicLink() ? "link" : "file",
        path: path.join(resolved.path, entry.name)
      }))
      .sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
    const safeLimit = clamp(limit, 1, 5000);
    return {
      path: resolved.path,
      workspace_id: resolved.root.id,
      entries: sorted.slice(offset, offset + safeLimit),
      total: sorted.length,
      next_offset: offset + safeLimit < sorted.length ? offset + safeLimit : null
    };
  }

  async function tree({ path: inputPath = ".", depth = 3, includeIgnored = false, maxEntries = 5000 } = {}) {
    const resolved = guard.resolveInside(inputPath);
    const counter = { value: 0, max: clamp(maxEntries, 1, 20000), truncated: false };
    return {
      path: resolved.path,
      workspace_id: resolved.root.id,
      tree: await readTree(resolved.path, clamp(depth, 0, 20), includeIgnored, counter),
      truncated: counter.truncated
    };
  }

  async function stat({ path: inputPath }) {
    const resolved = guard.resolveInside(required(inputPath, "path"));
    const info = await fs.stat(resolved.path);
    return {
      path: resolved.path,
      relative: resolved.relative,
      workspace_id: resolved.root.id,
      type: typeOf(info),
      size: info.size,
      created_at: info.birthtime.toISOString(),
      modified_at: info.mtime.toISOString(),
      mode: info.mode
    };
  }

  async function read({ path: inputPath, maxBytes, max_bytes } = {}) {
    const resolved = guard.resolveInside(required(inputPath, "path"));
    enforcePathPolicy(resolved, "read");
    const limit = maxBytes || max_bytes || policy?.limitsFor("fs.read")?.max_read_bytes || 1024 * 1024;
    const buffer = await readLimited(resolved.path, limit);
    const { text, metadata } = decodeText(buffer);
    return {
      path: resolved.path,
      relative: resolved.relative,
      workspace_id: resolved.root.id,
      content: text,
      bytes: buffer.length,
      ...metadata
    };
  }

  async function readMany({ paths = [], maxBytes, max_bytes } = {}) {
    if (!Array.isArray(paths) || !paths.length) throw new Error("paths array is required");
    const files = [];
    for (const inputPath of paths) files.push(await read({ path: inputPath, maxBytes: maxBytes || max_bytes }));
    return { files };
  }

  async function readBytes({ path: inputPath, maxBytes, max_bytes } = {}) {
    const resolved = guard.resolveInside(required(inputPath, "path"));
    enforcePathPolicy(resolved, "read");
    const limit = maxBytes || max_bytes || policy?.limitsFor("fs.read")?.max_read_bytes || 1024 * 1024;
    const buffer = await readLimited(resolved.path, limit);
    return { path: resolved.path, bytes: buffer.length, encoding: "base64", content: buffer.toString("base64"), sha256: sha256(buffer) };
  }

  async function hash({ path: inputPath, algorithm = "sha256" }) {
    if (!crypto.getHashes().includes(algorithm)) throw new Error(`Unsupported hash algorithm: ${algorithm}`);
    const resolved = guard.resolveInside(required(inputPath, "path"));
    const buffer = await fs.readFile(resolved.path);
    return { path: resolved.path, algorithm, digest: crypto.createHash(algorithm).update(buffer).digest("hex"), bytes: buffer.length };
  }

  async function detectEncoding({ path: inputPath }) {
    const resolved = guard.resolveInside(required(inputPath, "path"));
    return { path: resolved.path, ...detectBuffer(await fs.readFile(resolved.path)) };
  }

  async function previewWrite({ path: inputPath, content = "" }) {
    const resolved = guard.resolveParentInside(required(inputPath, "path"));
    const before = await readTextIfExists(resolved.path);
    return { path: resolved.path, diff: createUnifiedDiff(resolved.relative, before.text, content), encoding: before.metadata };
  }

  async function previewPatch(payload) {
    const computed = await computePatch(payload);
    return { path: computed.resolved.path, diff: createUnifiedDiff(computed.resolved.relative, computed.before, computed.after), replacements: computed.replacements };
  }

  async function patchCheck({ diff: diffText }) {
    const patches = parseUnifiedDiff(diffText);
    const files = [];
    for (const patchFile of patches) {
      const resolved = guard.resolveParentInside(patchFile.path);
      const before = patchFile.create ? { text: "", metadata: { encoding: "utf-8", eol: "lf", bom: null } } : await readTextIfExists(resolved.path, true);
      const after = applyPatchToText(before.text, patchFile);
      files.push({ path: resolved.path, hunks: patchFile.hunks.length, diff: createUnifiedDiff(resolved.relative, before.text, after) });
    }
    return { valid: true, files };
  }

  async function mkdir({ path: inputPath, transactionId, transaction_id } = {}) {
    const target = guard.resolveParentInside(required(inputPath, "path"));
    ensureWritable(target);
    return mutate("mkdir", transactionId || transaction_id, async (id) => {
      await transactions.stageMkdir(id, target.path);
      return { path: target.path, created: true };
    });
  }

  async function write({ path: inputPath, content = "", encoding = "auto", transactionId, transaction_id } = {}) {
    if (typeof content !== "string") throw new TypeError("content must be a string");
    const target = guard.resolveParentInside(required(inputPath, "path"));
    ensureWritable(target);
    const existing = await readTextIfExists(target.path);
    const metadata = encoding === "auto" ? existing.metadata : { encoding: normalizeEncoding(encoding), eol: existing.metadata.eol, bom: null };
    const buffer = encodeText(content, metadata);
    enforceWriteLimit(buffer.length);
    return mutate("write", transactionId || transaction_id, async (id) => {
      await transactions.stageWrite(id, target.path, buffer, metadata);
      return { path: target.path, bytes: buffer.length, append: false };
    });
  }

  async function writeMany({ files = [], encoding = "auto", transactionId, transaction_id } = {}) {
    if (!Array.isArray(files) || !files.length) throw new Error("files array is required");
    return mutate("write-many", transactionId || transaction_id, async (id) => {
      const results = [];
      for (const item of files) {
        const target = guard.resolveParentInside(required(item.path, "path"));
        ensureWritable(target);
        if (typeof item.content !== "string") throw new TypeError("file content must be a string");
        const existing = await readTextIfExists(target.path);
        const metadata = encoding === "auto" ? existing.metadata : { encoding: normalizeEncoding(encoding), eol: existing.metadata.eol, bom: null };
        const buffer = encodeText(item.content, metadata);
        enforceWriteLimit(buffer.length);
        await transactions.stageWrite(id, target.path, buffer, metadata);
        results.push({ path: target.path, bytes: buffer.length });
      }
      return { files: results };
    });
  }

  async function append({ path: inputPath, content = "", transactionId, transaction_id } = {}) {
    if (typeof content !== "string") throw new TypeError("content must be a string");
    const target = guard.resolveParentInside(required(inputPath, "path"));
    ensureWritable(target);
    const existing = await readTextIfExists(target.path);
    const buffer = encodeText(existing.text + content, existing.metadata);
    enforceWriteLimit(buffer.length);
    return mutate("append", transactionId || transaction_id, async (id) => {
      await transactions.stageWrite(id, target.path, buffer, existing.metadata);
      return { path: target.path, bytes: Buffer.byteLength(content), append: true };
    });
  }

  async function patch(payload) {
    const computed = await computePatch(payload);
    ensureWritable(computed.resolved);
    const buffer = encodeText(computed.after, computed.metadata);
    enforceWriteLimit(buffer.length);
    return mutate("patch", payload.transactionId || payload.transaction_id, async (id) => {
      await transactions.stageWrite(id, computed.resolved.path, buffer, computed.metadata);
      return { path: computed.resolved.path, changed: computed.before !== computed.after, replacements: computed.replacements };
    });
  }

  async function patchUnified({ diff: diffText, transactionId, transaction_id } = {}) {
    const patches = parseUnifiedDiff(diffText);
    return mutate("patch-unified", transactionId || transaction_id, async (id) => {
      const results = [];
      for (const patchFile of patches) {
        const target = guard.resolveParentInside(patchFile.path);
        ensureWritable(target);
        if (patchFile.delete) {
          await transactions.stageDelete(id, target.path);
          results.push({ path: target.path, deleted: true, hunks: patchFile.hunks.length });
          continue;
        }
        const existing = patchFile.create
          ? { text: "", metadata: { encoding: "utf-8", eol: "lf", bom: null } }
          : await readTextIfExists(target.path, true);
        const after = applyPatchToText(existing.text, patchFile);
        const buffer = encodeText(after, existing.metadata);
        enforceWriteLimit(buffer.length);
        await transactions.stageWrite(id, target.path, buffer, existing.metadata);
        results.push({ path: target.path, changed: existing.text !== after, hunks: patchFile.hunks.length });
      }
      return { files: results };
    });
  }

  async function remove({ path: inputPath, recursive = false, transactionId, transaction_id } = {}) {
    const target = guard.resolveInside(required(inputPath, "path"));
    ensureWritable(target);
    return mutate("delete", transactionId || transaction_id, async (id) => {
      await transactions.stageDelete(id, target.path, { recursive });
      return { path: target.path, deleted: true, recursive };
    });
  }

  async function move({ from, to, transactionId, transaction_id } = {}) {
    const source = guard.resolveInside(required(from, "from"));
    const target = guard.resolveParentInside(required(to, "to"));
    ensureWritable(source);
    ensureWritable(target);
    return mutate("move", transactionId || transaction_id, async (id) => {
      await transactions.stageMove(id, source.path, target.path);
      return { from: source.path, to: target.path, moved: true };
    });
  }

  async function copy({ from, to, recursive = true, transactionId, transaction_id } = {}) {
    const source = guard.resolveInside(required(from, "from"));
    const target = guard.resolveParentInside(required(to, "to"));
    ensureWritable(target);
    return mutate("copy", transactionId || transaction_id, async (id) => {
      await transactions.stageCopy(id, source.path, target.path, { recursive });
      return { from: source.path, to: target.path, copied: true };
    });
  }

  async function searchText({ path: inputPath = ".", query = "", maxResults, max_results, caseSensitive = false, case_sensitive = false } = {}) {
    if (!query) throw new Error("query is required");
    const root = guard.resolveInside(inputPath);
    const sensitive = caseSensitive || case_sensitive;
    const needle = sensitive ? query : query.toLowerCase();
    return searchFiles(root, maxResults || max_results, (content, file) => {
      const matches = [];
      content.split(/\r?\n/).forEach((line, index) => {
        const haystack = sensitive ? line : line.toLowerCase();
        if (haystack.includes(needle)) matches.push({ line: index + 1, text: line.slice(0, 1000) });
      });
      return matches.length ? { path: file, matches: matches.slice(0, 100) } : null;
    }, { query });
  }

  async function searchRegex({ path: inputPath = ".", pattern, flags = "i", maxResults, max_results } = {}) {
    if (!pattern) throw new Error("pattern is required");
    const regex = new RegExp(pattern, flags.replace("g", ""));
    const root = guard.resolveInside(inputPath);
    return searchFiles(root, maxResults || max_results, (content, file) => {
      const matches = [];
      content.split(/\r?\n/).forEach((line, index) => {
        const match = regex.exec(line);
        if (match) matches.push({ line: index + 1, column: match.index + 1, text: line.slice(0, 1000) });
      });
      return matches.length ? { path: file, matches: matches.slice(0, 100) } : null;
    }, { pattern, flags });
  }

async function searchFiles(root, requestedLimit, visitor, metadata) {
  const limit = clamp(requestedLimit || policy?.limitsFor("fs.search_text")?.max_results || 100, 1, 5000);
  const results = [];
  await walk(root.path, async (file) => {
    if (results.length >= limit) return;
    try {
      const resolved = guard.resolveInside(file);
      if (policy?.classifyPath(resolved.relative) === "deny") return;
      const buffer = await readLimited(file, 4 * 1024 * 1024);
      const { text } = decodeText(buffer);
      const found = visitor(text, file);
      if (found) results.push(found);
    } catch {
      // Binary, denied, too-large, and transient files are skipped by search.
    }
  });
  const matches = results.flatMap((file) => file.matches?.map((m) => ({ path: file.path, ...m })) || []);
  return { ok: true, path: root.path, workspace_id: root.root.id, ...metadata, files: results, matches, truncated: results.length >= limit };
}

  async function searchGlob({ path: inputPath = ".", pattern = "*", maxResults, max_results } = {}) {
    const root = guard.resolveInside(inputPath);
    const regex = globToRegExp(pattern);
    const limit = clamp(maxResults || max_results || 1000, 1, 10000);
    const results = [];
    await walk(root.path, async (file) => {
      if (results.length >= limit) return;
      const relative = path.relative(root.path, file).replaceAll(path.sep, "/");
      if (regex.test(relative)) results.push({ path: file, relative });
    });
    return { path: root.path, pattern, results, truncated: results.length >= limit };
  }

  async function findDuplicates({ path: inputPath = ".", maxResults = 1000 } = {}) {
    const root = guard.resolveInside(inputPath);
    const groups = new Map();
    await walk(root.path, async (file) => {
      const info = await fs.stat(file);
      const key = `${info.size}:${await hashFile(file)}`;
      const items = groups.get(key) || [];
      items.push(file);
      groups.set(key, items);
    });
    const duplicates = [...groups.entries()]
      .filter(([, files]) => files.length > 1)
      .slice(0, clamp(maxResults, 1, 5000))
      .map(([key, files]) => ({ sha256: key.split(":")[1], size: Number(key.split(":")[0]), files }));
    return { path: root.path, duplicates };
  }

  async function diff({ path: inputPath, content, comparePath }) {
    const resolved = guard.resolveInside(required(inputPath, "path"));
    const before = (await readTextIfExists(resolved.path, true)).text;
    let after = content;
    if (comparePath) after = (await readTextIfExists(guard.resolveInside(comparePath).path, true)).text;
    if (typeof after !== "string") throw new Error("content or comparePath is required");
    return { path: resolved.path, diff: createUnifiedDiff(resolved.relative, before, after) };
  }

  async function diffTree({ before = [], after = [] } = {}) {
    if (!Array.isArray(before) || !Array.isArray(after)) throw new TypeError("before and after arrays are required");
    const left = new Set(before);
    const right = new Set(after);
    return {
      added: [...right].filter((item) => !left.has(item)),
      removed: [...left].filter((item) => !right.has(item)),
      unchanged: [...left].filter((item) => right.has(item))
    };
  }

  async function snapshot(payload) {
    const result = await transactions.snapshot(payload);
    await recordChange({ op: "snapshot", id: result.id, label: result.label, files: result.files.length });
    return result;
  }

  async function rollback({ id }) {
    const result = await transactions.rollbackSnapshot(required(id, "id"));
    await recordChange({ op: "rollback", id, files: result.restored.length });
    return result;
  }

  async function changeLog({ limit = 100 } = {}) {
    try {
      const content = await fs.readFile(changeLogPath, "utf8");
      const entries = content.trim().split(/\n/).filter(Boolean).map((line) => JSON.parse(line));
      return { entries: entries.slice(-clamp(limit, 1, 5000)).reverse() };
    } catch (error) {
      if (error.code === "ENOENT") return { entries: [] };
      throw error;
    }
  }

  async function indexBuild({ path: inputPath = ".", include_hash = false, includeHash = false, max_files, maxFiles } = {}) {
    const root = guard.resolveInside(inputPath);
    enforcePathPolicy(root, "read");
    const limit = clamp(max_files ?? maxFiles ?? 10000, 1, 100000);
    const id = `index_${crypto.randomUUID().replaceAll("-", "")}`;
    const record = await buildIndexRecord({ id, root, includeHash: Boolean(include_hash || includeHash), limit });
    indexes.set(id, record);
    await events?.emit("fs.index.built", { index_id: id, workspace_id: root.root.id, files: record.files.length }).catch(() => {});
    return publicIndex(record);
  }

  async function indexStatus({ id } = {}) {
    if (id) {
      const record = indexes.get(id);
      if (!record) throw toolError("FILESYSTEM_INDEX_NOT_FOUND", `Index not found: ${id}`);
      return publicIndex(record);
    }
    return { indexes: [...indexes.values()].map(publicIndex) };
  }

  async function indexRefresh({ id, path: inputPath, include_hash, includeHash } = {}) {
    const existing = id ? indexes.get(id) : null;
    if (id && !existing) throw toolError("FILESYSTEM_INDEX_NOT_FOUND", `Index not found: ${id}`);
    const root = inputPath ? guard.resolveInside(inputPath) : existing ? guard.resolveInside(existing.path) : guard.resolveInside(".");
    enforcePathPolicy(root, "read");
    const record = await buildIndexRecord({
      id: existing?.id || `index_${crypto.randomUUID().replaceAll("-", "")}`,
      root,
      includeHash: Boolean(include_hash ?? includeHash ?? existing?.include_hash ?? false),
      limit: existing?.max_files || 10000
    });
    indexes.set(record.id, record);
    await events?.emit("fs.index.refreshed", { index_id: record.id, workspace_id: root.root.id, files: record.files.length }).catch(() => {});
    return publicIndex(record);
  }

  async function indexSearch({ query, id, limit = 100 } = {}) {
    if (typeof query !== "string" || !query.trim()) throw new Error("query is required");
    const selected = id ? [indexes.get(id)] : [...indexes.values()];
    if (id && !selected[0]) throw toolError("FILESYSTEM_INDEX_NOT_FOUND", `Index not found: ${id}`);
    const max = clamp(limit, 1, 1000);
    const needle = query.toLowerCase();
    const results = [];
    for (const record of selected.filter(Boolean)) {
      for (const entry of record.files) {
        if (results.length >= max) break;
        const pathHit = entry.relative.toLowerCase().includes(needle);
        const textHit = entry.preview?.toLowerCase().includes(needle);
        if (pathHit || textHit) {
          const { preview, ...safe } = entry;
          results.push({ ...safe, index_id: record.id, match: pathHit ? "path" : "text", ...(textHit ? { snippet: snippet(preview, query) } : {}) });
        }
      }
    }
    return { query, results, truncated: results.length >= max };
  }

  async function buildIndexRecord({ id, root, includeHash, limit }) {
    const files = [];
    await walk(root.path, async (file) => {
      if (files.length >= limit) return;
      const resolved = guard.resolveInside(file);
      if (policy?.classifyPath(resolved.relative) === "deny") return;
      const info = await fs.stat(file);
      if (!info.isFile()) return;
      let preview = "";
      try {
        const buffer = await readLimited(file, Math.min(policy?.limitsFor("fs.read")?.max_read_bytes || 1024 * 1024, 256 * 1024));
        const detected = detectBuffer(buffer);
        if (!detected.binary) preview = decodeText(buffer).text.slice(0, 4096);
      } catch {
        preview = "";
      }
      files.push({
        path: file,
        relative: path.relative(root.path, file),
        workspace_id: root.root.id,
        size: info.size,
        modified_at: info.mtime.toISOString(),
        ...(includeHash ? { sha256: await hashFile(file) } : {}),
        ...(preview ? { preview } : {})
      });
    });
    return {
      id,
      path: root.path,
      workspace_id: root.root.id,
      include_hash: includeHash,
      max_files: limit,
      status: "ready",
      files,
      built_at: new Date().toISOString()
    };
  }

  function publicIndex(record) {
    return {
      index_id: record.id,
      path: record.path,
      workspace_id: record.workspace_id,
      status: record.status,
      files: record.files.length,
      include_hash: record.include_hash,
      built_at: record.built_at
    };
  }

  function snippet(text = "", query = "") {
    const index = text.toLowerCase().indexOf(query.toLowerCase());
    if (index < 0) return text.slice(0, 240);
    return text.slice(Math.max(0, index - 80), Math.min(text.length, index + query.length + 160));
  }

  async function watchStart({ path: inputPath = ".", recursive = true, debounce_ms, debounceMs, ignore = [] } = {}) {
    const resolved = guard.resolveInside(inputPath);
    enforcePathPolicy(resolved, "read");
    const info = await fs.stat(resolved.path);
    const id = `watch_${crypto.randomUUID().replaceAll("-", "")}`;
    const record = {
      id,
      path: resolved.path,
      workspaceId: resolved.root.id,
      workspacePath: resolved.root.path,
      recursive: Boolean(recursive),
      debounceMs: clamp(debounce_ms ?? debounceMs ?? 100, 10, 5000),
      ignore: Array.isArray(ignore) ? ignore.map(String) : [],
      status: "watching",
      startedAt: new Date().toISOString(),
      eventsEmitted: 0,
      handles: new Set(),
      attached: new Set(),
      timers: new Map()
    };
    watchers.set(id, record);
    try {
      if (info.isDirectory()) await attachWatchDirectory(record, resolved.path);
      else attachNativeWatcher(record, resolved.path, false);
    } catch (error) {
      await closeWatchRecord(record);
      watchers.delete(id);
      throw toolError("FILESYSTEM_WATCH_FAILED", `Unable to watch ${resolved.path}: ${error.message}`);
    }
    return publicWatch(record);
  }

  async function watchStop({ id, watch_id } = {}) {
    const watchId = required(id || watch_id, "id");
    const record = watchers.get(watchId);
    if (!record) throw toolError("FILESYSTEM_WATCH_NOT_FOUND", `Watcher not found: ${watchId}`);
    await closeWatchRecord(record);
    watchers.delete(watchId);
    return publicWatch(record);
  }

  async function watchStatus({ id, watch_id } = {}) {
    const watchId = id || watch_id;
    if (!watchId) return { watchers: [...watchers.values()].map(publicWatch) };
    const record = watchers.get(watchId);
    if (!record) throw toolError("FILESYSTEM_WATCH_NOT_FOUND", `Watcher not found: ${watchId}`);
    return publicWatch(record);
  }

  async function attachWatchDirectory(record, directory) {
    if (record.status !== "watching" || isIgnoredWatchPath(record, directory)) return;
    attachNativeWatcher(record, directory, true);
    if (!record.recursive) return;
    let entries = [];
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      await attachWatchDirectory(record, path.join(directory, entry.name));
    }
  }

  function attachNativeWatcher(record, target, directoryTarget) {
    const key = normalizeWatchKey(target);
    if (record.attached.has(key)) return;
    const handle = watchNative(target, { persistent: false }, (eventType, filename) => {
      if (record.status !== "watching") return;
      const name = filename ? filename.toString() : "";
      const changedPath = directoryTarget && name ? path.join(target, name) : target;
      if (isIgnoredWatchPath(record, changedPath)) return;
      if (record.recursive && eventType === "rename") {
        fs.stat(changedPath).then((entry) => {
          if (entry.isDirectory()) return attachWatchDirectory(record, changedPath);
          return undefined;
        }).catch(() => {});
      }
      scheduleWatchEvent(record, changedPath, eventType);
    });
    handle.on("error", (error) => {
      if (record.status !== "watching") return;
      events?.emit("fs.watch.error", {
        watch_id: record.id,
        workspace_id: record.workspaceId,
        code: error.code || "FILESYSTEM_WATCH_ERROR",
        message: error.message
      }).catch(() => {});
    });
    record.attached.add(key);
    record.handles.add(handle);
  }

  function scheduleWatchEvent(record, changedPath, eventType) {
    const key = normalizeWatchKey(changedPath);
    const previous = record.timers.get(key);
    if (previous) clearTimeout(previous.timer);
    const timer = setTimeout(async () => {
      record.timers.delete(key);
      if (record.status !== "watching") return;
      const relative = path.relative(record.workspacePath, changedPath) || ".";
      let exists = true;
      let entryType = "unknown";
      try {
        const info = await fs.stat(changedPath);
        entryType = typeOf(info);
      } catch (error) {
        if (error.code === "ENOENT") exists = false;
        else entryType = "unavailable";
      }
      record.eventsEmitted += 1;
      await events?.emit("fs.watch.event", {
        watch_id: record.id,
        workspace_id: record.workspaceId,
        path: changedPath,
        relative: relative.replaceAll(path.sep, "/"),
        kind: previous?.eventType === "rename" || eventType === "rename" ? "rename" : "change",
        exists,
        entry_type: entryType,
        coalesced: Boolean(previous)
      });
    }, record.debounceMs);
    timer.unref?.();
    record.timers.set(key, { timer, eventType });
  }

  function isIgnoredWatchPath(record, target) {
    const relative = path.relative(record.path, target).replaceAll(path.sep, "/");
    if (relative === "" || relative === ".") return false;
    if (relative.split("/").some((segment) => DEFAULT_IGNORES.has(segment))) return true;
    return record.ignore.some((pattern) => {
      const normalized = String(pattern).replaceAll("\\", "/");
      if (globToRegExp(normalized).test(relative)) return true;
      return normalized.startsWith("**/") && globToRegExp(normalized.slice(3)).test(relative);
    });
  }

  async function closeWatchRecord(record) {
    record.status = "stopped";
    record.stoppedAt = new Date().toISOString();
    for (const { timer } of record.timers.values()) clearTimeout(timer);
    record.timers.clear();
    for (const handle of record.handles) handle.close();
    record.handles.clear();
    record.attached.clear();
  }

  function publicWatch(record) {
    return {
      watch_id: record.id,
      path: record.path,
      workspace_id: record.workspaceId,
      recursive: record.recursive,
      debounce_ms: record.debounceMs,
      ignore: [...record.ignore],
      status: record.status,
      started_at: record.startedAt,
      ...(record.stoppedAt ? { stopped_at: record.stoppedAt } : {}),
      events_emitted: record.eventsEmitted,
      native_watchers: record.handles.size
    };
  }

  async function computePatch({ path: inputPath, search, replace, all = false }) {
    const resolved = guard.resolveInside(required(inputPath, "path"));
    if (typeof search !== "string") throw new Error("search string is required");
    if (typeof replace !== "string") throw new Error("replace string is required");
    const existing = await readTextIfExists(resolved.path, true);
    if (!existing.text.includes(search)) throw toolError("FILESYSTEM_PATCH_CONFLICT", "search string not found");
    const replacements = all ? existing.text.split(search).length - 1 : 1;
    const after = all ? existing.text.split(search).join(replace) : existing.text.replace(search, replace);
    return { resolved, before: existing.text, after, metadata: existing.metadata, replacements };
  }

  async function mutate(label, existingId, stage) {
    const own = !existingId;
    const transaction = own ? await transactions.begin({ label }) : { id: existingId };
    try {
      const result = await stage(transaction.id);
      if (!own) return { ...result, transaction_id: transaction.id, transaction_status: "active" };
      const committed = await transactions.commit(transaction.id);
      await recordChange({ op: label, transaction_id: transaction.id, operations: committed.operations.length });
      return { ...result, transaction_id: transaction.id, transaction_status: committed.status };
    } catch (error) {
      if (own) await transactions.rollback(transaction.id).catch(() => {});
      throw error;
    }
  }

  function ensureWritable(resolved) {
    if (resolved.root.read_only) throw toolError("POLICY_READ_ONLY_ROOT", `Workspace root is read-only: ${resolved.root.id}`);
    const decision = policy?.authorizeTool("fs.write", {}, { root: resolved.root });
    if (decision && !decision.allowed) throw toolError("POLICY_DENIED", decision.reason);
    enforcePathPolicy(resolved, "write");
  }

  function enforcePathPolicy(resolved, mode) {
    const classification = policy?.classifyPath(resolved.relative) || "allow";
    if (classification === "deny") throw toolError("POLICY_PATH_DENIED", `Path is denied by profile: ${resolved.relative}`);
    if (classification === "redact" && mode === "write") {
      // Writes are allowed; subsequent audit/model output is redacted by the policy engine.
    }
  }

  function enforceWriteLimit(bytes) {
    const limit = policy?.limitsFor("fs.write")?.max_write_bytes || 16 * 1024 * 1024;
    if (bytes > limit) throw toolError("FILESYSTEM_WRITE_TOO_LARGE", `Write exceeds limit (${bytes} > ${limit})`);
  }

  async function readTextIfExists(filePath, requiredFile = false) {
    try {
      const buffer = await fs.readFile(filePath);
      return decodeText(buffer);
    } catch (error) {
      if (error.code === "ENOENT" && !requiredFile) return { text: "", metadata: { binary: false, encoding: "utf-8", bom: null, eol: "lf", bytes: 0 } };
      throw error;
    }
  }

  async function recordChange(entry) {
    await fs.mkdir(path.dirname(changeLogPath), { recursive: true });
    await fs.appendFile(changeLogPath, `${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`, { encoding: "utf8", mode: 0o600 });
  }

  async function close() {
    await Promise.all([...watchers.values()].map(closeWatchRecord));
    watchers.clear();
  }

  return { handle, transactions, close };
}

async function readTree(root, depth, includeIgnored, counter) {
  if (counter.value >= counter.max) {
    counter.truncated = true;
    return [];
  }
  const entries = await fs.readdir(root, { withFileTypes: true });
  const items = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (counter.value >= counter.max) {
      counter.truncated = true;
      break;
    }
    if (!includeIgnored && DEFAULT_IGNORES.has(entry.name)) continue;
    counter.value += 1;
    const fullPath = path.join(root, entry.name);
    const item = { name: entry.name, type: entry.isDirectory() ? "directory" : entry.isSymbolicLink() ? "link" : "file" };
    if (entry.isDirectory() && depth > 0) item.children = await readTree(fullPath, depth - 1, includeIgnored, counter);
    items.push(item);
  }
  return items;
}

async function walk(root, visit) {
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (DEFAULT_IGNORES.has(entry.name) || entry.name.endsWith(".jsonl")) continue;
    if (entry.isSymbolicLink()) continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) await walk(full, visit);
    else await visit(full);
  }
}

async function readLimited(filePath, maxBytes) {
  const info = await fs.stat(filePath);
  if (!info.isFile()) throw toolError("FILESYSTEM_NOT_FILE", `Not a file: ${filePath}`);
  if (info.size > maxBytes) throw toolError("FILESYSTEM_READ_TOO_LARGE", `File too large (${info.size} > ${maxBytes})`);
  return fs.readFile(filePath);
}

function createUnifiedDiff(file, before, after) {
  if (before === after) return "";
  const beforeLines = before.replace(/\r\n/g, "\n").split("\n");
  const afterLines = after.replace(/\r\n/g, "\n").split("\n");
  const lines = [`--- a/${file}`, `+++ b/${file}`, `@@ -1,${beforeLines.length} +1,${afterLines.length} @@`];
  for (const line of beforeLines) lines.push(`-${line}`);
  for (const line of afterLines) lines.push(`+${line}`);
  return lines.join("\n");
}

function globToRegExp(pattern) {
  const escaped = String(pattern)
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "__GLOBSTAR__")
    .replace(/\*/g, "[^/]*")
    .replace(/__GLOBSTAR__/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}

async function hashFile(filePath) {
  return sha256(await fs.readFile(filePath));
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function normalizeWatchKey(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function typeOf(info) {
  return info.isDirectory() ? "directory" : info.isFile() ? "file" : "other";
}

function normalizeEncoding(value) {
  const normalized = String(value).toLowerCase().replace("utf8", "utf-8").replace("utf16le", "utf-16le");
  if (!["utf-8", "utf-16le"].includes(normalized)) throw new Error(`Unsupported text encoding: ${value}`);
  return normalized;
}

function clamp(value, min, max) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(min, Math.min(max, Math.trunc(numeric))) : min;
}

function required(value, name) {
  if (value === undefined || value === null || value === "") throw new Error(`${name} is required`);
  return value;
}

function toolError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.retryable = false;
  return error;
}
