import { getActiveWorkspace, getWorkspace, validateWorkspacePermission } from '../context/workspace-service.js';
import { computeWorkspaceRevision, checkRevisionMatch, getGitInfo } from '../context/revision-service.js';
import { listDirectory, readTextFile, getFileInfo, searchText } from '../context/repository-service.js';
import { extractSymbols, searchText as searchTextRaw } from '../context/search-service.js';
import { 
  getSymbolsForFile, 
  getReferences, 
  buildDependencyGraph,
  autoIndexWorkspace
} from '../context/symbol-service.js';
import TiRouterClient from '../clients/ti-router-client.js';

const contextTools = new Set([
  'fs.list',
  'fs.read',
  'fs.search_text',
  'fs.stat',
  'git.status',
  'git.diff',
  'workspace.info',
  'workspace.status',
  'repo.tree',
  'repo.search',
  'repo.symbols',
  'repo.dependencies',
  'revision.compute',
  'revision.check'
]);

const executionTools = new Set([
  'command.run',
  'test.run',
  'lint.run',
  'build.run',
  'fs.patch',
  'fs.write',
  'fs.delete',
  'git.commit',
  'git.branch'
]);

export function getToolCategory(toolName) {
  if (contextTools.has(toolName)) return 'context';
  if (executionTools.has(toolName)) return 'execution';
  return 'external';
}

export function isContextTool(toolName) {
  return contextTools.has(toolName);
}

export function isExecutionTool(toolName) {
  return executionTools.has(toolName);
}

let tiRouterClient = null;

function getTiRouterClient() {
  if (!tiRouterClient) {
    tiRouterClient = new TiRouterClient();
  }
  return tiRouterClient;
}

export async function dispatchToolCall(toolName, args, options = {}) {
  const { 
    workspaceId, 
    revision, 
    timeoutMs = 30000, 
    requestId, 
    source = 'native' 
  } = options;

  const wsId = workspaceId || getActiveWorkspace();

  if (wsId && !validateWorkspacePermission(wsId, 'read')) {
    return {
      ok: false,
      error: { message: 'Workspace permission denied', code: 'WORKSPACE_PERMISSION_DENIED' },
      requestId,
      workspaceId: wsId,
      duration: 0
    };
  }

  const startTime = Date.now();

  try {
    const handler = HANDLERS[toolName];
    if (!handler) {
      if (executionTools.has(toolName)) {
        return {
          ok: false,
          error: { message: `Execution tool not implemented: ${toolName}`, code: 'TOOL_NOT_IMPLEMENTED' },
          requestId,
          workspaceId: wsId,
          duration: Date.now() - startTime
        };
      }
      return {
        ok: false,
        error: { message: `Unknown tool: ${toolName}`, code: 'UNKNOWN_TOOL' },
        requestId,
        workspaceId: wsId,
        duration: Date.now() - startTime
      };
    }

    const result = await handler(wsId, args, { revision, timeoutMs });
    
    return {
      ...result,
      requestId,
      workspaceId: wsId,
      duration: Date.now() - startTime
    };
  } catch (error) {
    return {
      ok: false,
      error: { message: error.message, code: error.code || 'INTERNAL_ERROR', type: error.name || 'Error' },
      requestId,
      workspaceId: wsId,
      duration: Date.now() - startTime
    };
  }
}

const HANDLERS = {
  'fs.list': async (wsId, args) => {
    return await listDirectory(wsId, args.path || '.');
  },

  'fs.read': async (wsId, args) => {
    if (!args.path) {
      return { ok: false, error: { message: 'Path is required', code: 'INVALID_ARGS' } };
    }
    return await readTextFile(wsId, args.path);
  },

  'fs.search_text': async (wsId, args) => {
    const query = args.query ?? args.pattern ?? args.text;
    if (typeof query !== "string" || !query.trim()) {
      return { ok: false, error: { message: "query must be a non-empty string", code: "INVALID_ARGUMENT" } };
    }
    return await searchText(wsId, query, {
      path: args.path,
      filePattern: args.filePattern,
      maxResults: args.maxResults,
      caseSensitive: args.caseSensitive
    });
  },

  'fs.stat': async (wsId, args) => {
    if (!args.path) {
      return { ok: false, error: { message: 'Path is required', code: 'INVALID_ARGS' } };
    }
    return await getFileInfo(wsId, args.path);
  },

  'git.status': async (wsId, args) => {
    const workspace = getWorkspace(wsId);
    if (!workspace) {
      return { ok: false, error: { message: 'Workspace not found', code: 'WORKSPACE_NOT_FOUND' } };
    }

    const gitInfo = await getGitInfo(wsId);
    return {
      ok: true,
      result: {
        workspaceId: wsId,
        ...gitInfo
      }
    };
  },

  'git.diff': async (wsId, args) => {
    const workspace = getWorkspace(wsId);
    if (!workspace) {
      return { ok: false, error: { message: 'Workspace not found', code: 'WORKSPACE_NOT_FOUND' } };
    }

    try {
      const { execSync } = require('node:child_process');
      const diffArgs = args.staged ? ['diff', '--cached'] : ['diff'];
      const diff = execSync(`git -C "${workspace.root}" ${diffArgs.join(' ')}`, { encoding: 'utf-8' });

      return {
        ok: true,
        result: {
          workspaceId: wsId,
          path: args.path || '.',
          staged: args.staged || false,
          diff: diff || '(no changes)'
        }
      };
    } catch (error) {
      return { ok: false, error: { message: error.message, code: 'GIT_DIFF_FAILED' } };
    }
  },

  'workspace.info': async (wsId) => {
    const workspace = getWorkspace(wsId);
    if (!workspace) {
      return { ok: false, error: { message: 'Workspace not found', code: 'WORKSPACE_NOT_FOUND' } };
    }

    const revision = await computeWorkspaceRevision(wsId);
    const gitInfo = await getGitInfo(wsId);

    return {
      ok: true,
      result: {
        id: wsId,
        root: workspace.root,
        permissions: workspace.permissions,
        type: workspace.type,
        revision,
        git: gitInfo
      }
    };
  },

  'workspace.status': async (wsId) => {
    return HANDLERS['workspace.info'](wsId);
  },

  'repo.tree': async (wsId, args) => {
    return await listDirectory(wsId, args.path || '.');
  },

  'repo.search': async (wsId, args) => {
    const query = args.query ?? args.pattern ?? args.text;
    if (typeof query !== "string" || !query.trim()) {
      return { ok: false, error: { message: "query must be a non-empty string", code: "INVALID_ARGUMENT" } };
    }
    return await searchText(wsId, query.trim(), {
      path: args.path,
      filePattern: args.filePattern,
      maxResults: args.maxResults,
      caseSensitive: args.caseSensitive
    });
  },

  'repo.symbols': async (wsId, args) => {
    const filePath = args.path || '.';
    if (filePath !== '.') {
      return await extractSymbols(wsId, filePath);
    }
    return await autoIndexWorkspace(wsId);
  },

  'repo.dependencies': async (wsId) => {
    return await buildDependencyGraph(wsId);
  },

  'revision.compute': async (wsId, args) => {
    const workspace = getWorkspace(wsId);
    if (!workspace) {
      return { ok: false, error: { message: 'Workspace not found', code: 'WORKSPACE_NOT_FOUND' } };
    }

    const { resolve } = require('node:path');
    const fullPath = resolve(workspace.root, args.path || '.');
    const revision = await computeWorkspaceRevision(wsId, args.path || '.');

    return {
      ok: true,
      result: {
        workspaceId: wsId,
        path: args.path || '.',
        revision
      }
    };
  },

  'revision.check': async (wsId, args) => {
    const workspace = getWorkspace(wsId);
    if (!workspace) {
      return { ok: false, error: { message: 'Workspace not found', code: 'WORKSPACE_NOT_FOUND' } };
    }

    const { resolve } = require('node:path');
    const fullPath = resolve(workspace.root, args.path || '.');
    const check = await checkRevisionMatch(args.expectedRevision, fullPath);

    return {
      ok: true,
      result: {
        workspaceId: wsId,
        path: args.path || '.',
        ...check
      }
    };
  }
};
 
export async function forwardToTiRouter(toolName, args, options = {}) {
  const client = getTiRouterClient();
  return await client.callTool(toolName, args, options);
}

export async function forwardToTiRouterChat(messages, options = {}) {
  const client = getTiRouterClient();
  return await client.chatCompletion(messages, options);
}

export async function checkTiRouterHealth() {
  const client = getTiRouterClient();
  return await client.healthCheck();
}