// api.js
// Context Bridge client API for making requests to the local server
// Uses fetch API for browser compatibility

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 3333;
const DEFAULT_BASE_URL = `http://${DEFAULT_HOST}:${DEFAULT_PORT}`;

async function makeRequest(path, method = 'GET', body = null) {
  const url = `${DEFAULT_BASE_URL}${path}`;
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    }
  };

  try {
    const response = await fetch(url, {
      ...options,
      body: body ? JSON.stringify(body) : undefined
    });

    const data = await response.text();
    try {
      const parsed = JSON.parse(data);
      return parsed;
    } catch (e) {
      return { ok: false, error: { message: 'Invalid JSON response' } };
    }
  } catch (error) {
    return { ok: false, error: { message: error.message } };
  }
}

/**
 * Generic execute function that routes to any tool handler
 * @param {Object} request - { method, args }
 * @returns {Promise<Object>}
 */
export async function executeTool(request) {
  return makeRequest('/v1/execute', 'POST', request);
}

/**
 * Send a request to Context Bridge (legacy function)
 * @param {Object} request - { method, args }
 * @returns {Promise<Object>}
 */
export async function sendToContext(request) {
  return executeTool(request);
}

/**
 * Read a file from a workspace
 * @param {string} workspaceId
 * @param {string} path
 * @returns {Promise<Object>}
 */
export async function readFile(workspaceId, path) {
  return makeRequest(`/v1/tools/fs.read`, 'POST', { args: { workspaceId, path } });
}

/**
 * List directory contents in a workspace
 * @param {string} workspaceId
 * @param {string} path
 * @returns {Promise<Object>}
 */
export async function listWorkspace(workspaceId, path = '.') {
  return makeRequest(`/v1/tools/fs.list`, 'POST', { args: { workspaceId, path } });
}

/**
 * Search for text in workspace files
 * @param {string} workspaceId
 * @param {string} pattern
 * @param {string} path
 * @returns {Promise<Object>}
 */
export async function searchWorkspace(workspaceId, pattern, path = '.') {
  return makeRequest('/v1/tools/fs.search_text', 'POST', { args: { workspaceId, pattern, path } });
}

/**
 * Health check for Context Bridge
 * @returns {Promise<Object>}
 */
export async function healthCheck() {
  return makeRequest('/health', 'GET');
}

/**
 * Get list of available tools
 * @returns {Promise<Object>}
 */
export async function getTools() {
  return makeRequest('/v1/tools', 'GET');
}