import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { getWorkspace, resolveWorkspacePath, validateWorkspacePermission } from './workspace-service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, '..');

let filesystemsModule = null;

async function loadFilesystems() {
  if (!filesystemsModule) {
    try {
      const fsModule = await import('../filesystems.js');
      filesystemsModule = fsModule.default || fsModule;
    } catch (error) {
      console.error('[repository-service] Failed to load filesystems:', error.message);
    }
  }
  return filesystemsModule;
}

export async function listDirectory(workspaceId, dirPath = '.') {
  const workspace = getWorkspace(workspaceId);

  if (!workspace) {
    return {
      ok: false,
      error: {
        code: "WORKSPACE_NOT_FOUND",
        message: `Workspace not found: ${workspaceId}`
      }
    };
  }

  if (!validateWorkspacePermission(workspaceId, 'read')) {
    return {
      ok: false,
      error: {
        code: "FORBIDDEN",
        message: "Permission denied: read not allowed"
      }
    };
  }

  const fs = await loadFilesystems();
  if (!fs) {
    return { ok: false, error: 'Filesystem module not available' };
  }

  try {
    const guard = createGuard(workspace.root, workspaceId);
    const tools = fs.createFilesystemTools(guard, { baseDir: workspace.root });

    const result = await tools.handle('fs.list', { path: dirPath });

    return {
      ok: true,
      result: {
        path: dirPath,
        files: result.files || result,
        count: (result.files || result).length,
        workspaceId
      }
    };
  } catch (error) {
    return { ok: false, error: { message: error.message } };
  }
}

export async function readTextFile(workspaceId, filePath) {
  const workspace = getWorkspace(workspaceId);

  if (!workspace) {
    return {
      ok: false,
      error: {
        code: "WORKSPACE_NOT_FOUND",
        message: `Workspace not found: ${workspaceId}`
      }
    };
  }

  if (!validateWorkspacePermission(workspaceId, 'read')) {
    return {
      ok: false,
      error: {
        code: "FORBIDDEN",
        message: "Permission denied: read not allowed"
      }
    };
  }

  const fs = await loadFilesystems();
  if (!fs) {
    return { ok: false, error: 'Filesystem module not available' };
  }

  try {
    const guard = createGuard(workspace.root, workspaceId);
    const tools = fs.createFilesystemTools(guard, { baseDir: workspace.root });

    const result = await tools.handle('fs.read', { path: filePath });

    return {
      ok: true,
      workspaceId,
      path: filePath,
      content: result.content || result,
      length: (result.content || result).length
    };
  } catch (error) {
    return { ok: false, error: { message: error.message } };
  }
}

export async function getFileInfo(workspaceId, filePath) {
  const workspace = getWorkspace(workspaceId);

  if (!workspace) {
    return {
      ok: false,
      error: {
        code: "WORKSPACE_NOT_FOUND",
        message: `Workspace not found: ${workspaceId}`
      }
    };
  }

  if (!validateWorkspacePermission(workspaceId, 'read')) {
    return {
      ok: false,
      error: {
        code: "FORBIDDEN",
        message: "Permission denied: read not allowed"
      }
    };
  }

  const fs = await loadFilesystems();
  if (!fs) {
    return { ok: false, error: 'Filesystem module not available' };
  }

  try {
    const guard = createGuard(workspace.root, workspaceId);
    const tools = fs.createFilesystemTools(guard, { baseDir: workspace.root });

    const result = await tools.handle('fs.stat', { path: filePath });

    return {
      ok: true,
      workspaceId,
      path: filePath,
      isFile: result.isFile(),
      isDirectory: result.isDirectory(),
      size: result.size,
      mtime: result.mtime?.toISOString()
    };
  } catch (error) {
    return { ok: false, error: { message: error.message } };
  }
}

export async function searchText(workspaceId, pattern, options = {}) {
  if (!validateWorkspacePermission(workspaceId, 'search')) {
    return { ok: false, error: 'Permission denied: search not allowed' };
  }

  const fs = await loadFilesystems();
  if (!fs) {
    return { ok: false, error: 'Filesystem module not available' };
  }

  try {
    const workspace = getWorkspace(workspaceId);
    if (!workspace) {
      return { ok: false, error: 'Workspace not found' };
    }

    const guard = createGuard(workspace.root, workspaceId);
    const tools = fs.createFilesystemTools(guard, { baseDir: workspace.root });

    const result = await tools.handle('fs.search_text', {
      path: options.path || '.',
      query: pattern,
      maxResults: options.maxResults || 100,
      caseSensitive: options.caseSensitive || false,
      filePattern: options.filePattern || '*'
    });

    const nativeMatches = result.matches || result.results || [];
    const nativeFiles = result.files || [];
    const files = nativeFiles.length ? nativeFiles : nativeMatches.reduce((acc, m) => {
      const existing = acc.find(f => f.path === m.path);
      if (existing) {
        existing.matches.push({ line: m.line, column: m.column, text: m.text });
      } else {
        acc.push({ path: m.path, matches: [{ line: m.line, column: m.column, text: m.text }] });
      }
      return acc;
    }, []);

    return {
      ok: true,
      workspaceId,
      query: pattern,
      path: options.path || '.',
      files,
      matches: nativeMatches,
      fileCount: files.length,
      matchCount: nativeMatches.length,
      truncated: result.truncated || false,
      diagnostics: []
    };
  } catch (error) {
    return { ok: false, error: { message: error.message } };
  }
}

function createGuard(basePath, workspaceId) {
  return {
    resolveInside: (inputPath) => {
      const { resolve: pathResolve, relative } = require('node:path');
      const resolvedPath = pathResolve(basePath, inputPath);
      if (!resolvedPath.startsWith(basePath)) {
        throw new Error('Path traversal detected');
      }
      return { 
        path: resolvedPath, 
        root: { id: workspaceId },
        relative: relative(basePath, resolvedPath)
      };
    },
    listWorkspaces: () => [{ path: basePath, read_only: false, id: workspaceId }]
  };
}