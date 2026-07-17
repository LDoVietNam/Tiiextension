import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import crypto from 'node:crypto';
import { getWorkspace, resolveWorkspacePath } from './workspace-service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, '..');

const revisionCache = new Map();

let gitToolsModule = null;

async function loadGitTools() {
  if (!gitToolsModule) {
    try {
      const gitModule = await import('../git-tools.js');
      gitToolsModule = gitModule.default || gitModule;
    } catch (error) {
      console.error('[revision-service] Failed to load git-tools:', error.message);
    }
  }
  return gitToolsModule;
}

export function computeFileRevision(filePath) {
  try {
    const content = require('node:fs').readFileSync(filePath);
    return crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
  } catch {
    return null;
  }
}

export async function computeWorkspaceRevision(workspaceId, relativePath = '.') {
  const workspace = getWorkspace(workspaceId);
  if (!workspace) {
    return null;
  }

  const resolvedPath = resolveWorkspacePath(workspaceId, relativePath);
  if (!resolvedPath) {
    return null;
  }

  try {
    const gitModule = await loadGitTools();
    if (gitModule && gitModule.createGitTools) {
      const guard = createGuard(workspace.root);
      const gitTools = gitModule.createGitTools(guard);
      const result = await gitTools.gitStatus({ path: workspace.root });
      if (result.ok && result.result) {
        return result.result.commit || result.result.revision || null;
      }
    }
  } catch (error) {
    console.error('[revision-service] Git revision failed:', error.message);
  }

  const { readdirSync, statSync, readFileSync } = require('node:fs');
  const { join: pathJoin, relative: pathRelative } = require('node:path');

  let hash = crypto.createHash('sha256');

  function walk(dir) {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = pathJoin(dir, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== 'dist' && entry.name !== 'build') {
          walk(fullPath);
        }
      } else if (entry.isFile()) {
        try {
          const content = readFileSync(fullPath);
          hash.update(content.toString());
        } catch {}
      }
    }
  }

  walk(resolvedPath);
  return hash.digest('hex').substring(0, 16);
}

export function getRevision(filePath) {
  if (revisionCache.has(filePath)) {
    return revisionCache.get(filePath);
  }
  const revision = computeFileRevision(filePath);
  if (revision) {
    revisionCache.set(filePath, revision);
  }
  return revision;
}

export function invalidateRevisionCache(filePath) {
  revisionCache.delete(filePath);
}

export function clearRevisionCache() {
  revisionCache.clear();
}

export function checkRevisionMatch(expectedRevision, filePath) {
  const current = getRevision(filePath);
  return {
    valid: current === expectedRevision,
    current,
    expected: expectedRevision
  };
}

export async function getGitInfo(workspaceId) {
  const workspace = getWorkspace(workspaceId);
  if (!workspace) {
    return { branch: 'unknown', commit: 'unknown', isClean: false, dirty: true };
  }

  try {
    const gitModule = await loadGitTools();
    if (gitModule && gitModule.createGitTools) {
      const guard = createGuard(workspace.root);
      const gitTools = gitModule.createGitTools(guard);
      const result = await gitTools.gitStatus({ path: workspace.root });
      if (result.ok && result.result) {
        return {
          branch: result.result.branch || 'unknown',
          commit: result.result.commit || 'unknown',
          isClean: result.result.clean === true,
          dirty: result.result.clean !== true
        };
      }
    }
  } catch (error) {
    console.error('[revision-service] Git info failed:', error.message);
  }

  return {
    branch: 'unknown',
    commit: 'unknown',
    isClean: false,
    dirty: true
  };
}

function createGuard(basePath) {
  return {
    resolveInside: (inputPath) => {
      const resolvedPath = resolve(basePath, inputPath);
      if (!resolvedPath.startsWith(basePath)) {
        throw new Error('Path traversal detected');
      }
      return { path: resolvedPath };
    }
  };
}