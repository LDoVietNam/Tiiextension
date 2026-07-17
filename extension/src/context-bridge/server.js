import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { join, resolve, relative, basename } from 'node:path';

const CONFIG_PATH = process.env.CHATGPT_NATIVE_AGENT_CONFIG || 
  (process.platform === 'win32' 
    ? 'Z:\\01_PROJECTS\\apps\\Tiiextension\\native-host\\config\\runtime.json'
    : '/Users/Shared/projects/Tiiextension/native-host/config/runtime.json');

const HOST = process.env.CONTEXT_BRIDGE_HOST || '127.0.0.1';
const PORT = parseInt(process.env.CONTEXT_BRIDGE_PORT || '3333', 10);

// Normalize workspace paths for cross-platform compatibility
const normalizePath = (p) => p.replace(/\\/g, '/');

const workspaceRegistry = {
  'tiiextension': {
    root: normalizePath('Z:\\01_PROJECTS\\apps\\Tiiextension'),
    permissions: ['read', 'search', 'patch', 'test']
  },
  'tirouter': {
    root: normalizePath('Z:\\01_PROJECTS\\apps\\Tirouter'),
    permissions: ['read', 'search']
  },
  'tibrain': {
    root: normalizePath('Z:\\01_PROJECTS\\apps\\tibrain'),
    permissions: ['read', 'search']
  }
};

const toolAllowlist = {
  'fs.read': ['tiiextension', 'tirouter', 'tibrain'],
  'fs.list': ['tiiextension', 'tirouter', 'tibrain'],
  'fs.search_text': ['tiiextension', 'tirouter', 'tibrain'],
  'git.status': ['tiiextension', 'tirouter'],
  'git.diff': ['tiiextension', 'tirouter'],
  'snapshot.create': ['tiiextension'],
  'snapshot.restore': ['tiiextension']
};

function computeRevision(filePath) {
  try {
    const content = require('node:fs').readFileSync(filePath, 'utf-8');
    return crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
  } catch {
    return null;
  }
}

async function validateWorkspace(workspaceId) {
  return workspaceRegistry[workspaceId] || null;
}

async function validatePath(workspaceId, path) {
  const workspace = await validateWorkspace(workspaceId);
  if (!workspace) return { valid: false, error: 'Workspace not found' };

  const resolvedPath = resolve(workspace.root, path);
  const normalizedResolved = normalizePath(resolvedPath);
  const normalizedRoot = normalizePath(workspace.root);

  if (!normalizedResolved.startsWith(normalizedRoot)) {
    return { valid: false, error: 'Path outside workspace' };
  }

  return { valid: true, workspace, resolvedPath };
}

async function handleRead(args) {
  const { workspaceId, path } = args;
  const validation = await validatePath(workspaceId, path);
  
  if (!validation.valid) {
    return { ok: false, error: validation.error };
  }
  
  try {
    const content = await readFile(validation.resolvedPath, 'utf-8');
    const revision = computeRevision(validation.resolvedPath);
    
    return {
      ok: true,
      result: {
        path,
        content,
        length: content.length,
        revision,
        workspaceId
      }
    };
  } catch (error) {
    return { ok: false, error: { message: error.message } };
  }
}

async function handleList(args) {
  const { workspaceId, path = '.' } = args;
  const validation = await validatePath(workspaceId, path);
  
  if (!validation.valid) {
    return { ok: false, error: validation.error };
  }
  
  try {
    const entries = await readdir(validation.resolvedPath, { withFileTypes: true });
    const files = entries.map(entry => ({
      name: entry.name,
      type: entry.isDirectory() ? 'directory' : 'file',
      path: join(path, entry.name)
    }));
    
    return {
      ok: true,
      result: {
        path,
        files,
        count: files.length,
        workspaceId
      }
    };
  } catch (error) {
    return { ok: false, error: { message: error.message } };
  }
}

async function handleSearch(args) {
  const { workspaceId, pattern, path = '.' } = args;
  const validation = await validatePath(workspaceId, path);
  
  if (!validation.valid) {
    return { ok: false, error: validation.error };
  }

  try {
    const { readdir, readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    
    const matches = [];
    const searchInFile = async (filePath) => {
      try {
        const content = await readFile(filePath, 'utf-8');
        const lines = content.split('\n');
        lines.forEach((line, idx) => {
          if (line.includes(pattern)) {
            matches.push({
              file: filePath.replace(validation.workspace.root, ''),
              line: idx + 1,
              snippet: line.substring(0, 200)
            });
          }
        });
      } catch {
        // Skip files that can't be read
      }
    };

    const walkDir = async (dir) => {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          await walkDir(fullPath);
        } else if (entry.isFile() && /\.(js|ts|json|md|txt|py|java|cpp|cs|go|rs)$/i.test(entry.name)) {
          await searchInFile(fullPath);
        }
      }
    };

    await walkDir(validation.resolvedPath);

    return {
      ok: true,
      result: {
        path,
        pattern,
        matches,
        count: matches.length,
        workspaceId
      }
    };
  } catch (error) {
    return { ok: false, error: { message: error.message } };
  }
}

const handlers = {
  'fs.read': handleRead,
  'fs.list': handleList,
  'fs.search_text': handleSearch
};

function parseRequest(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        resolve({ error: 'Invalid JSON' });
      }
    });
    req.on('error', reject);
  });
}

// Security: Allow specific Chrome extension origins only
const ALLOWED_ORIGINS = [
  'chrome-extension://ojjbdgfmnedbnpadfnmgkolfmhipkefi',  // Default extension ID
  'chrome-extension://*',  // Any Chrome extension (development)
  'http://localhost:3333',  // Local development
  'http://127.0.0.1:3333'  // Local development
];

function isOriginAllowed(origin) {
  if (!origin) return false;
  return ALLOWED_ORIGINS.some(allowed => {
    if (allowed === origin) return true;
    if (allowed.endsWith('*')) {
      const prefix = allowed.slice(0, -1);
      return origin.startsWith(prefix);
    }
    return false;
  });
}

function sendResponse(res, statusCode, data, origin = null) {
  const corsOrigin = isOriginAllowed(origin) ? origin : ALLOWED_ORIGINS[0];
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': corsOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;
  const origin = req.headers.origin;

  // MCP (Streamable HTTP) transport for GPT web / remote MCP clients
  if (pathname === '/mcp') {
    await handleMcp(req, res, url);
    return;
  }

  try {
    if (req.method === 'OPTIONS') {
      const corsOrigin = isOriginAllowed(origin) ? origin : ALLOWED_ORIGINS[0];
      res.writeHead(200, {
        'Access-Control-Allow-Origin': corsOrigin,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      });
      res.end();
      return;
    }
    
    if (pathname === '/health') {
      sendResponse(res, 200, { ok: true, status: 'Context Bridge running' }, origin);
      return;
    }
    
    if (pathname === '/v1/workspaces') {
      sendResponse(res, 200, { ok: true, workspaces: Object.keys(workspaceRegistry) }, origin);
      return;
    }
    
    if (pathname === '/v1/tools' && req.method === 'GET') {
      sendResponse(res, 200, { ok: true, tools: Object.keys(handlers) }, origin);
      return;
    }
    
    if (pathname.startsWith('/v1/tools/') && req.method === 'POST') {
      const toolName = pathname.split('/').pop();
      const body = await parseRequest(req);

      if (!handlers[toolName]) {
        sendResponse(res, 404, { ok: false, error: `Tool not found: ${toolName}` }, origin);
        return;
      }

      const result = await handlers[toolName](body.args || {});
      sendResponse(res, result.ok ? 200 : 400, result, origin);
      return;
    }

    // Execute endpoint - accepts { method, args } for generic execution
    if (pathname === '/v1/execute' && req.method === 'POST') {
      const body = await parseRequest(req);
      const { method, args } = body;

      if (!method || !handlers[method]) {
        sendResponse(res, 400, {
          ok: false,
          error: `Invalid or missing method. Available: ${Object.keys(handlers).join(', ')}`
        }, origin);
        return;
      }

      const result = await handlers[method](args || {});
      sendResponse(res, result.ok ? 200 : 400, result, origin);
      return;
    }

    sendResponse(res, 404, { ok: false, error: 'Not found' }, origin);
  } catch (error) {
    sendResponse(res, 500, { ok: false, error: { message: error.message } }, origin);
  }
});

// ===== MCP (Streamable HTTP) transport on /mcp =====
// Exposes the local workspace file tools to remote MCP clients (e.g. GPT web)
// using the 2025-03-26 Streamable HTTP transport: POST /mcp carries JSON-RPC
// (response may be JSON or SSE), GET /mcp is a server->client SSE heartbeat.
const MCP_PROTOCOL_VERSION = '2025-03-26';
const mcpSessions = new Map();

const MCP_TOOLS = [
  {
    name: 'fs.read',
    description: 'Read a file from a registered workspace.',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string', enum: Object.keys(workspaceRegistry) },
        path: { type: 'string', description: 'Path relative to the workspace root' }
      },
      required: ['workspaceId', 'path']
    }
  },
  {
    name: 'fs.list',
    description: 'List entries of a directory in a workspace.',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string', enum: Object.keys(workspaceRegistry) },
        path: { type: 'string', default: '.' }
      },
      required: ['workspaceId']
    }
  },
  {
    name: 'fs.search_text',
    description: 'Search file contents for a pattern within a workspace.',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string', enum: Object.keys(workspaceRegistry) },
        pattern: { type: 'string' },
        path: { type: 'string', default: '.' }
      },
      required: ['workspaceId', 'pattern']
    }
  }
];

async function mcpToolResult(toolName, args) {
  const handler = handlers[toolName];
  if (!handler) {
    return { isError: true, content: [{ type: 'text', text: `Unknown tool: ${toolName}` }] };
  }
  const r = await handler(args || {});
  if (r.ok) {
    return { content: [{ type: 'text', text: JSON.stringify(r.result, null, 2) }] };
  }
  const msg = typeof r.error === 'string' ? r.error : (r.error?.message || 'Error');
  return { isError: true, content: [{ type: 'text', text: msg }] };
}

function mcpDispatch(request) {
  const { method, id, params } = request;
  switch (method) {
    case 'initialize':
      return {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'Tiiextension Context Bridge', version: '1.0.0' }
      };
    case 'ping':
      return {};
    case 'tools/list':
      return { tools: MCP_TOOLS };
    case 'tools/call':
      return mcpToolResult(params.name, params.arguments);
    default:
      return id !== undefined ? { code: -32601, message: `Method not found: ${method}` } : null;
  }
}

function mcpError(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

async function handleMcp(req, res) {
  const sessionId = req.headers['mcp-session-id'] || crypto.randomUUID();
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, DELETE',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Mcp-Session-Id, Accept',
    'Access-Control-Expose-Headers': 'Mcp-Session-Id'
  };

  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  if (req.method === 'GET') {
    if (!mcpSessions.has(sessionId)) {
      res.writeHead(400, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify(mcpError(null, -32000, 'No valid session for GET /mcp')));
      return;
    }
    res.writeHead(200, {
      ...corsHeaders,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    });
    const keepAlive = setInterval(() => res.write(': keep-alive\n\n'), 15000);
    req.on('close', () => clearInterval(keepAlive));
    return;
  }

  if (req.method === 'DELETE') {
    mcpSessions.delete(sessionId);
    res.writeHead(200, corsHeaders);
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    res.writeHead(405, corsHeaders);
    res.end();
    return;
  }

  let body = {};
  try { body = await parseRequest(req); } catch { /* ignore */ }
  const requests = Array.isArray(body) ? body : [body];
  mcpSessions.set(sessionId, true);

  const wantsSse = (req.headers.accept || '').includes('text/event-stream');
  const responses = [];

  for (const request of requests) {
    if (request.method === undefined) {
      if (request.id !== undefined) responses.push(mcpError(request.id, -32700, 'Parse error'));
      continue;
    }
    const result = await mcpDispatch(request);
    if (result === null) continue; // notification -> no response
    if (result.code !== undefined && result.message !== undefined && !('jsonrpc' in result)) {
      responses.push(mcpError(request.id, result.code, result.message));
    } else {
      responses.push({ jsonrpc: '2.0', id: request.id, result });
    }
  }

  if (wantsSse) {
    res.writeHead(200, {
      ...corsHeaders,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Mcp-Session-Id': sessionId
    });
    for (const r of responses) res.write(`event: message\ndata: ${JSON.stringify(r)}\n\n`);
    res.end();
  } else {
    res.writeHead(200, {
      ...corsHeaders,
      'Content-Type': 'application/json',
      'Mcp-Session-Id': sessionId
    });
    res.end(JSON.stringify(responses.length === 1 ? responses[0] : responses));
  }
}

server.listen(PORT, HOST, () => {
  console.log(`Context Bridge running on http://${HOST}:${PORT}`);
});

export default server;