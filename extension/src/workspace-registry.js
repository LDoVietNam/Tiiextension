import { runtime } from './browser-polyfill.js';

const NATIVE_HOST_URL = process.env.TIIEXTENSION_API_URL || 'http://127.0.0.1:18401';

let workspaceConfig = null;
let configPromise = null;
let isLoading = false;

async function fetchWorkspaceConfig() {
  if (workspaceConfig) return workspaceConfig;
  if (configPromise) return configPromise;

  isLoading = true;
  
  configPromise = (async () => {
    try {
      const response = await fetch(`${NATIVE_HOST_URL}/v1/workspace/registry`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(5000)
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.ok && data.result) {
          workspaceConfig = data.result;
          return workspaceConfig;
        }
      }
    } catch (error) {
      console.warn('[workspace-registry] Failed to fetch from Native Host:', error.message);
    }

    try {
      const response = await fetch(`${NATIVE_HOST_URL}/v1/workspaces`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(3000)
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.ok && data.result) {
          workspaceConfig = {
            workspaces: data.result,
            services: data.services || {},
            toolPolicies: data.toolPolicies || {},
            crossProjectAccess: data.crossProjectAccess || {}
          };
          return workspaceConfig;
        }
      }
    } catch (error) {
      console.warn('[workspace-registry] Failed to fetch workspaces:', error.message);
    }

    workspaceConfig = getDefaultConfig();
    return workspaceConfig;
  })();

  try {
    return await configPromise;
  } finally {
    isLoading = false;
  }
}

function getDefaultConfig() {
  return {
    workspaces: [
      { id: 'tiiextension', root: 'Z:\\01_PROJECTS\\apps\\Tiiextension', permissions: ['read', 'search', 'patch', 'test'], type: 'extension' },
      { id: 'tirouter', root: 'Z:\\01_PROJECTS\\apps\\Tirouter', permissions: ['read', 'search'], type: 'gateway' },
      { id: 'tibrain', root: 'Z:\\01_PROJECTS\\apps\\tibrain', permissions: ['read', 'search'], type: 'knowledge' },
      { id: 'tiandroid', root: 'Z:\\01_PROJECTS\\apps\\Ti-Android', permissions: ['read', 'build'], type: 'runtime' },
      { id: 'ticli', root: 'Z:\\01_PROJECTS\\apps\\Ti-CLI', permissions: ['read', 'build'], type: 'cli' },
      { id: 'shared', root: 'Z:\\01_PROJECTS\\apps\\shared', permissions: ['read'], type: 'library' }
    ],
    services: {
      tirouter: { url: 'http://127.0.0.1:1870' },
      contextBridge: { url: 'http://127.0.0.1:3333' }
    },
    toolPolicies: {},
    crossProjectAccess: {}
  };
}

export async function getWorkspaceConfig() {
  return await fetchWorkspaceConfig();
}

export async function setWorkspaceConfig(config) {
  workspaceConfig = config;
}

export async function getWorkspace(workspaceId) {
  const config = await fetchWorkspaceConfig();
  return config.workspaces.find(w => w.id === workspaceId) || null;
}

export async function getAllWorkspaces() {
  const config = await fetchWorkspaceConfig();
  return config.workspaces;
}

export async function getService(serviceName) {
  const config = await fetchWorkspaceConfig();
  return config.services[serviceName] || null;
}

export async function getAllServices() {
  const config = await fetchWorkspaceConfig();
  return config.services;
}

export async function validateWorkspacePermission(workspaceId, permission) {
  const workspace = await getWorkspace(workspaceId);
  if (!workspace) return false;
  return workspace.permissions.includes(permission);
}

export async function getWorkspaceRoots() {
  const config = await fetchWorkspaceConfig();
  return config.workspaces.map(w => w.root);
}

export async function resolveWorkspacePath(workspaceId, relativePath) {
  const workspace = await getWorkspace(workspaceId);
  if (!workspace) return null;
  return `${workspace.root}\\${relativePath}`;
}

export async function getActiveWorkspace() {
  return 'tiiextension';
}

export function refreshConfig() {
  workspaceConfig = null;
  configPromise = null;
  return fetchWorkspaceConfig();
}