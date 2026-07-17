import { resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, '..');

const CONFIG_PATH = process.env.CHATGPT_NATIVE_AGENT_CONFIG || 
  resolve(__dirname, '..', 'config', 'runtime.json');

let workspaceRegistry = {};

function loadWorkspaceConfig() {
  try {
    if (existsSync(CONFIG_PATH)) {
      const content = readFileSync(CONFIG_PATH, 'utf-8');
      const parsed = JSON.parse(content);
      if (parsed.profiles) {
        for (const profile of parsed.profiles) {
          if (profile.roots) {
            for (const root of profile.roots) {
              workspaceRegistry[root.id] = {
                id: root.id,
                root: root.path,
                permissions: root.read_only ? ['read', 'search'] : ['read', 'search', 'patch', 'test'],
                read_only: root.read_only || false
              };
            }
          }
        }
      }
    }
  } catch (error) {
    console.error('[workspace-service] Failed to load config:', error.message);
  }
  
  if (Object.keys(workspaceRegistry).length === 0) {
    workspaceRegistry = getDefaultRegistry();
  }
}

function getDefaultRegistry() {
  return {
    'package-root': {
      id: 'package-root',
      root: 'Z:\\01_PROJECTS\\apps\\Tiiextension',
      permissions: ['read', 'search', 'patch', 'test'],
      read_only: false
    }
  };
}

loadWorkspaceConfig();

export function getWorkspaceConfig() {
  return workspaceRegistry;
}

export function setWorkspaceConfig(config) {
  workspaceRegistry = config;
}

export function getWorkspace(workspaceId) {
  return workspaceRegistry[workspaceId] || null;
}

export function getAllWorkspaces() {
  return Object.values(workspaceRegistry);
}

export function validateWorkspacePermission(workspaceId, permission) {
  const workspace = workspaceRegistry[workspaceId];
  if (!workspace) return false;
  if (workspace.read_only && !['read', 'search'].includes(permission)) return false;
  return workspace.permissions.includes(permission);
}

export function resolveWorkspacePath(workspaceId, relativePath) {
  const workspace = workspaceRegistry[workspaceId];
  if (!workspace) return null;
  const resolvedPath = resolve(workspace.root, relativePath);
  if (!resolvedPath.startsWith(workspace.root)) {
    return null;
  }
  return resolvedPath;
}

export function getWorkspaceInfo(workspaceId) {
  const workspace = workspaceRegistry[workspaceId];
  if (!workspace) {
    return { error: 'Workspace not found' };
  }
  return {
    id: workspaceId,
    ...workspace
  };
}

export function listWorkspaces() {
  return Object.values(workspaceRegistry).map(w => ({
    id: w.id,
    root: w.root,
    permissions: w.permissions,
    read_only: w.read_only
  }));
}

export function refreshConfig() {
  loadWorkspaceConfig();
}

export function getActiveWorkspace() {
  return 'package-root';
}