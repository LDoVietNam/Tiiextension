import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { getWorkspace, resolveWorkspacePath, validateWorkspacePermission } from './workspace-service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, '..');

let gitToolsModule = null;

async function loadGitTools() {
  if (!gitToolsModule) {
    try {
      const gitModule = await import('../git-tools.js');
      gitToolsModule = gitModule.default || gitModule;
    } catch (error) {
      console.error('[search-service] Failed to load git-tools:', error.message);
    }
  }
  return gitToolsModule;
}

export async function searchText(workspaceId, pattern, options = {}) {
  if (!validateWorkspacePermission(workspaceId, 'search')) {
    return { ok: false, error: 'Permission denied: search not allowed' };
  }

  const { 
    path: searchPath = '.', 
    filePattern = '*', 
    maxResults = 100, 
    caseSensitive = false,
    includeBinary = false
  } = options;

  const workspace = getWorkspace(workspaceId);
  if (!workspace) {
    return { ok: false, error: 'Workspace not found' };
  }

  const resolvedPath = resolveWorkspacePath(workspaceId, searchPath);
  if (!resolvedPath) {
    return { ok: false, error: 'Path validation failed' };
  }

  try {
    const results = [];
    const searchPattern = caseSensitive ? pattern : pattern.toLowerCase();
    const { readdirSync, statSync, readFileSync } = await import('node:fs');
    const { join, relative, extname } = await import('node:path');

    function walk(dir, depth = 0) {
      if (depth > 10 || results.length >= maxResults) return;

      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (results.length >= maxResults) break;

        const fullPath = join(dir, entry.name);
        const relativePath = relative(resolvedPath, fullPath).replace(/\\/g, '/');

        if (entry.isDirectory()) {
          if (!entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== 'dist' && entry.name !== 'build') {
            walk(fullPath, depth + 1);
          }
        } else if (entry.isFile()) {
          const ext = extname(entry.name).toLowerCase();
          if (filePattern === '*' || filePattern.includes(ext.slice(1)) || entry.name.includes(filePattern)) {
            try {
              const content = readFileSync(fullPath, 'utf-8');
              const lines = content.split('\n');
              
              for (let i = 0; i < lines.length; i++) {
                if (results.length >= maxResults) break;
                const line = lines[i];
                const lineContent = caseSensitive ? line : line.toLowerCase();
                
                if (lineContent.includes(searchPattern)) {
                  const indices = [];
                  let searchContent = lineContent;
                  let start = 0;
                  
                  while ((index = searchContent.indexOf(searchPattern, start)) !== -1) {
                    indices.push(index);
                    start = index + 1;
                  }

                  results.push({
                    path: relativePath,
                    line: i + 1,
                    snippet: line.length > 200 ? line.substring(0, 200) + '...' : line,
                    matches: indices.length
                  });
                }
              }
            } catch {}
          }
        }
      }
    }

    walk(resolvedPath);

    return {
      ok: true,
      result: {
        pattern,
        path: searchPath,
        matches: results,
        count: results.length,
        workspaceId
      }
    };
  } catch (error) {
    return { ok: false, error: { message: error.message } };
  }
}

export async function extractSymbols(workspaceId, filePath) {
  if (!validateWorkspacePermission(workspaceId, 'read')) {
    return { ok: false, error: 'Permission denied: read not allowed' };
  }

  const resolvedPath = resolveWorkspacePath(workspaceId, filePath);
  if (!resolvedPath) {
    return { ok: false, error: 'Path validation failed' };
  }

  try {
    const { readFileSync } = await import('node:fs');
    const content = readFileSync(resolvedPath, 'utf-8');
    const symbols = [];

    const functionPattern = /function\s+(\w+)/g;
    const classPattern = /class\s+(\w+)/g;
    const constPattern = /const\s+(\w+)\s*=/g;
    const letPattern = /let\s+(\w+)\s*=/g;
    const varPattern = /var\s+(\w+)\s*=/g;
    const exportPattern = /export\s+(?:function|class|const|let|var)\s+(\w+)/g;
    const importPattern = /import\s+\{\s*([^}]+)\s*\}/g;

    let match;

    while ((match = functionPattern.exec(content)) !== null) {
      symbols.push({ name: match[1], type: 'function', line: content.substring(0, match.index).split('\n').length });
    }

    while ((match = classPattern.exec(content)) !== null) {
      symbols.push({ name: match[1], type: 'class', line: content.substring(0, match.index).split('\n').length });
    }

    while ((match = exportPattern.exec(content)) !== null) {
      symbols.push({ name: match[1], type: 'exported', line: content.substring(0, match.index).split('\n').length });
    }

    while ((match = importPattern.exec(content)) !== null) {
      const imports = match[1].split(',').map(s => s.trim()).filter(s => s);
      for (const imp of imports) {
        symbols.push({ name: imp, type: 'import', line: content.substring(0, match.index).split('\n').length });
      }
    }

    return {
      ok: true,
      result: {
        path: filePath,
        symbols,
        count: symbols.length,
        workspaceId
      }
    };
  } catch (error) {
    return { ok: false, error: { message: error.message } };
  }
}

export async function getGitInfo(workspaceId) {
  try {
    const gitModule = await loadGitTools();
    if (gitModule && gitModule.createGitTools) {
      const guard = createGuard(getWorkspace(workspaceId).root);
      const gitTools = gitModule.createGitTools(guard);
      const result = await gitTools.gitStatus({ path: '.' });
      return {
        branch: result.branch || 'unknown',
        commit: result.branch || 'unknown',
        isClean: result.clean === true,
        dirty: result.clean !== true
      };
    }
  } catch (error) {
    console.error('[search-service] Git info failed:', error.message);
  }

  return {
    branch: 'unknown',
    commit: 'unknown',
    isClean: false,
    dirty: true
  };
}

function createGuard(basePath) {
  const { resolve } = require('node:path');
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