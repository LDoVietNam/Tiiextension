// test-mock-sse.js — minimal legacy SSE MCP server for verifying mcp-proxy.js
// locally (the real upstream mcp.trepremium.online is unreachable from the sandbox).
import http from 'node:http';

const PORT = 1812;
const clients = new Map();

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === '/mcp/sse' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    const sessionId = 'up_' + Math.random().toString(36).slice(2, 8);
    res.write(`event: endpoint\ndata: /mcp/messages?sessionId=${sessionId}\n\n`);
    clients.set(sessionId, res);
    req.on('close', () => clients.delete(sessionId));
    return;
  }
  if (url.pathname === '/mcp/messages' && req.method === 'POST') {
    const sessionId = url.searchParams.get('sessionId');
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const msg = JSON.parse(body);
      const client = clients.get(sessionId);
      let response;
      if (msg.method === 'initialize') {
        response = { jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'mock', version: '1' } } };
      } else if (msg.method === 'tools/list') {
        response = { jsonrpc: '2.0', id: msg.id, result: { tools: [{ name: 'mock_tool', description: 'mock tool', inputSchema: { type: 'object', properties: {}, required: [] } }] } };
      } else if (msg.method === 'tools/call') {
        response = { jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: 'mock result for ' + (msg.params?.name || '') }] } };
      } else {
        response = { jsonrpc: '2.0', id: msg.id, result: {} };
      }
      if (client && !client.destroyed) client.write(`event: message\ndata: ${JSON.stringify(response)}\n\n`);
      res.writeHead(202); res.end();
    });
    return;
  }
  res.writeHead(404); res.end();
});

server.listen(PORT, '127.0.0.1', () => console.log(`mock SSE MCP on :${PORT}`));
