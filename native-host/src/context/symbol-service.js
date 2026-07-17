import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { getWorkspace, resolveWorkspacePath, validateWorkspacePermission } from './workspace-service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, '..');

const symbolIndex = new Map();
let searchService = null;

async function getSearchService() {
  if (!searchService) {
    searchService = await import('./search-service.js');
  }
  return searchService;
}

export async function indexSymbols(workspaceId, filePath, symbols) {
  if (!validateWorkspacePermission(workspaceId, 'read')) {
    return false;
  }
  const key = `${workspaceId}:${filePath}`;
  symbolIndex.set(key, symbols);
  return true;
}

export async function searchSymbols(workspaceId, query) {
  if (!validateWorkspacePermission(workspaceId, 'search')) {
    return { ok: false, error: 'Permission denied: search not allowed' };
  }

  const workspace = getWorkspace(workspaceId);
  if (!workspace) {
    return { ok: false, error: 'Workspace not found' };
  }

  const results = [];
  const queryLower = query.toLowerCase();

  for (const [key, symbols] of symbolIndex) {
    if (key.startsWith(`${workspaceId}:`)) {
      for (const symbol of symbols) {
        if (symbol.name.toLowerCase().includes(queryLower)) {
          const filePath = key.replace(`${workspaceId}:`, '');
          results.push({
            path: filePath,
            name: symbol.name,
            type: symbol.type,
            line: symbol.line
          });
        }
      }
    }
  }

  return {
    ok: true,
    result: {
      query,
      matches: results,
      count: results.length,
      workspaceId
    }
  };
}

export async function getSymbolsForFile(workspaceId, filePath) {
  if (!validateWorkspacePermission(workspaceId, 'read')) {
    return { ok: false, error: 'Permission denied: read not allowed' };
  }

  const key = `${workspaceId}:${filePath}`;
  const symbols = symbolIndex.get(key);

  if (!symbols) {
    return { ok: false, error: 'File not indexed' };
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
}

export async function getReferences(workspaceId, symbolName) {
  if (!validateWorkspacePermission(workspaceId, 'search')) {
    return { ok: false, error: 'Permission denied: search not allowed' };
  }

  const references = [];
  const symbolNameLower = symbolName.toLowerCase();

  for (const [key, symbols] of symbolIndex) {
    if (key.startsWith(`${workspaceId}:`)) {
      for (const symbol of symbols) {
        if (symbol.name.toLowerCase() === symbolNameLower) {
          const filePath = key.replace(`${workspaceId}:`, '');
          references.push({
            path: filePath,
            name: symbol.name,
            type: symbol.type,
            line: symbol.line
          });
        }
      }
    }
  }

  return {
    ok: true,
    result: {
      symbol: symbolName,
      references,
      count: references.length,
      workspaceId
    }
  };
}

export async function clearSymbolIndex(workspaceId) {
  for (const key of symbolIndex.keys()) {
    if (key.startsWith(`${workspaceId}:`)) {
      symbolIndex.delete(key);
    }
  }
}

export async function buildDependencyGraph(workspaceId) {
  if (!validateWorkspacePermission(workspaceId, 'read')) {
    return { ok: false, error: 'Permission denied: read not allowed' };
  }

  const dependencies = new Map();

  for (const [key, symbols] of symbolIndex) {
    if (key.startsWith(`${workspaceId}:`)) {
      const filePath = key.replace(`${workspaceId}:`, '');
      dependencies.set(filePath, {
        imports: symbols.filter(s => s.type === 'import').map(s => s.name),
        exports: symbols.filter(s => s.type === 'exported' || s.type === 'function' || s.type === 'class').map(s => s.name)
      });
    }
  }

  return {
    ok: true,
    result: {
      workspaceId,
      files: Array.from(dependencies.keys()).length,
      dependencies: Object.fromEntries(dependencies)
    }
  };
}

export async function autoIndexWorkspace(workspaceId) {
  if (!validateWorkspacePermission(workspaceId, 'read')) {
    return { ok: false, error: 'Permission denied' };
  }

  const workspace = getWorkspace(workspaceId);
  if (!workspace) {
    return { ok: false, error: 'Workspace not found' };
  }

  const searchSvc = await getSearchService();
  let indexed = 0;
  let errors = 0;

  const { readdirSync, statSync } = await import('node:fs');
  const { join, relative, extname } = await import('node:path');

  async function walk(dir) {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== 'dist' && entry.name !== 'build') {
          await walk(fullPath);
        }
      } else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase();
        if (['.js', '.ts', '.jsx', '.tsx', '.json'].includes(ext)) {
          try {
            const relativePath = relative(workspace.root, fullPath).replace(/\\/g, '/');
            const result = await searchSvc.extractSymbols(workspaceId, relativePath);
            if (result.ok) {
              await indexSymbols(workspaceId, relativePath, result.result.symbols);
              indexed++;
            }
          } catch (error) {
            errors++;
          }
        }
      }
    }
  }

  await walk(workspace.root);

  return {
    ok: true,
    result: {
      workspaceId,
      indexed,
      errors,
      totalSymbols: Array.from(symbolIndex.values()).reduce((sum, s) => sum + s.length, 0)
    }
  };
}