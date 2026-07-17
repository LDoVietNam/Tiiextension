import fs from "node:fs";
import path from "node:path";

export function createWorkspaceGuard(workspaces, baseDir = process.cwd()) {
  if (!Array.isArray(workspaces) || workspaces.length === 0) throw new Error("At least one workspace is required");
  const roots = workspaces.map((workspace, index) => {
    const item = typeof workspace === "string" ? { path: workspace } : workspace;
    const rootPath = path.resolve(baseDir, required(item.path, "workspace.path"));
    const canonicalPath = canonicalExisting(rootPath);
    return {
      id: item.id || item.name || `root-${index + 1}`,
      name: item.name || item.id || path.basename(canonicalPath),
      path: canonicalPath,
      read_only: Boolean(item.read_only ?? item.readOnly)
    };
  });

  function resolveInside(inputPath = ".") {
    validatePathInput(inputPath);
    const absolute = path.isAbsolute(inputPath) ? path.resolve(inputPath) : path.resolve(roots[0].path, inputPath);
    const normalized = canonicalTarget(absolute);
    const root = roots
      .filter((candidate) => isInside(normalized, candidate.path))
      .sort((a, b) => b.path.length - a.path.length)[0];
    if (!root) throw outsideError(inputPath);
    return {
      path: normalized,
      root: { ...root },
      relative: path.relative(root.path, normalized),
      exists: fs.existsSync(normalized)
    };
  }

  function resolveParentInside(inputPath) {
    validatePathInput(inputPath);
    const absolute = path.isAbsolute(inputPath) ? path.resolve(inputPath) : path.resolve(roots[0].path, inputPath);
    const parent = resolveInside(path.dirname(absolute));
    const target = path.join(parent.path, path.basename(absolute));
    const resolved = resolveInside(target);
    return { ...resolved, parentPath: parent.path };
  }

  function listWorkspaces() {
    return roots.map((root) => ({ ...root }));
  }

  function relativeRef(inputPath) {
    const resolved = resolveInside(inputPath);
    return { workspace_id: resolved.root.id, path: resolved.relative.replaceAll(path.sep, "/") || "." };
  }

  function revalidate(inputPath, expected = {}) {
    const resolved = resolveInside(inputPath);
    if (expected.workspace_id && resolved.root.id !== expected.workspace_id) throw outsideError(inputPath);
    if (expected.parentPath && normalizeCase(path.dirname(resolved.path)) !== normalizeCase(expected.parentPath)) {
      const error = new Error(`Workspace path identity changed: ${inputPath}`);
      error.code = "WORKSPACE_IDENTITY_CHANGED";
      throw error;
    }
    return resolved;
  }

  return { resolveInside, resolveParentInside, listWorkspaces, relativeRef, revalidate };
}

function canonicalTarget(targetPath) {
  const resolved = path.resolve(targetPath);
  if (fs.existsSync(resolved)) return canonicalExisting(resolved);
  let ancestor = resolved;
  const missing = [];
  while (!fs.existsSync(ancestor)) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) break;
    missing.unshift(path.basename(ancestor));
    ancestor = parent;
  }
  const canonicalAncestor = canonicalExisting(ancestor);
  return path.resolve(canonicalAncestor, ...missing);
}

function canonicalExisting(targetPath) {
  const resolved = path.resolve(targetPath);
  try {
    return fs.realpathSync.native(resolved);
  } catch (error) {
    if (error.code === "ENOENT") return resolved;
    throw error;
  }
}

function isInside(candidate, root) {
  const relative = path.relative(normalizeCase(root), normalizeCase(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function normalizeCase(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function validatePathInput(value) {
  if (typeof value !== "string" || !value) throw new TypeError("path must be a non-empty string");
  if (value.includes("\0")) throw outsideError(value);
  if (process.platform === "win32") {
    if (/^(?:\\\\[?.]\\|\\\\\.\\)/.test(value)) throw outsideError(value);
    const withoutDrive = value.replace(/^[a-z]:/i, "");
    if (withoutDrive.includes(":")) throw outsideError(value);
  }
}

function outsideError(inputPath) {
  const error = new Error(`Path outside configured workspaces: ${inputPath}`);
  error.code = "WORKSPACE_OUTSIDE_ROOT";
  error.retryable = false;
  return error;
}

function required(value, name) {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

