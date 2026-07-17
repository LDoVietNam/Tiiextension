// mcp-proxy.js — exposes the deployed TiBrain SSE MCP server (legacy
// `event: endpoint` + `event: message` transport) as BOTH:
//   - Streamable HTTP  : POST/GET/DELETE /mcp  (what GPT web expects)
//   - Legacy SSE       : GET /mcp/sse + POST /mcp/messages
// so GPT web can connect to http://localhost:1811/mcp and reach all 90 brain_* tools.
//
// Env: UPSTREAM_URL (default https://mcp.trepremium.online/mcp/sse),
//      PROXY_PORT (default 1811), PROXY_HOST (default 0.0.0.0).

import http from 'node:http';
import { randomUUID } from 'node:crypto';

const HOST = process.env.PROXY_HOST || '0.0.0.0';
const PORT = parseInt(process.env.PROXY_PORT || '1811', 10);
const UPSTREAM = process.env.UPSTREAM_URL || 'https://mcp.trepremium.online/mcp/sse';
const UPSTREAM_ORIGIN = new URL(UPSTREAM).origin;

// Browser-like headers so Cloudflare's bot check does not deny the upstream SSE fetch.
const UPSTREAM_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/event-stream',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cache-Control': 'no-cache'
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, DELETE',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Mcp-Session-Id, Accept',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id'
};

// sessionId -> { stream, endpointUrl, pending:Map<id,{resolve,reject}), localSse, abort, alive }
const sessions = new Map();

function resolveEndpoint(data) {
  if (/^https?:\/\//.test(data)) return data;
  return new URL(data, UPSTREAM_ORIGIN).toString();
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (!body) return resolve({});
      try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

async function ensureUpstream(sessionId) {
  let s = sessions.get(sessionId);
  if (s && s.alive && s.stream) return s;
  if (!s) s = { pending: new Map(), localSse: null, stream: null, endpointUrl: null, alive: false, abort: new AbortController() };
  else s.abort = new AbortController();
  sessions.set(sessionId, s);

  const resp = await fetch(UPSTREAM, {
    headers: UPSTREAM_HEADERS,
    signal: s.abort.signal
  });
  if (!resp.ok || !resp.body) throw new Error(`Upstream SSE failed (${resp.status})`);
  s.stream = resp;
  s.alive = true;

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const raw = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          handleUpstreamEvent(s, raw);
        }
      }
    } catch { /* stream ended */ }
    s.alive = false;
  })();

  const deadline = Date.now() + 12000;
  while (!s.endpointUrl && Date.now() < deadline && s.alive) {
    await new Promise((r) => setTimeout(r, 50));
  }
  if (!s.endpointUrl) { s.alive = false; throw new Error('Upstream did not send endpoint event'); }
  return s;
}

function handleUpstreamEvent(s, raw) {
  let event = 'message';
  let data = '';
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data = line.slice(5).trim();
  }
  if (!data) return;
  if (event === 'endpoint') { s.endpointUrl = resolveEndpoint(data); return; }
  if (event === 'message') {
    let msg; try { msg = JSON.parse(data); } catch { return; }
    const id = msg.id;
    if (id !== undefined && s.pending.has(id)) {
      s.pending.get(id).resolve(msg);
      s.pending.delete(id);
    } else if (s.localSse && !s.localSse.destroyed) {
      s.localSse.write(`event: message\ndata: ${data}\n\n`);
    }
  }
}

async function forwardToUpstream(s, request) {
  if (request.id === undefined) {
    await fetch(s.endpointUrl, {
      method: 'POST', headers: { ...UPSTREAM_HEADERS, 'Content-Type': 'application/json' }, body: JSON.stringify(request)
    });
    return null;
  }
  const p = new Promise((resolve, reject) => {
    s.pending.set(request.id, { resolve, reject });
    setTimeout(() => {
      if (s.pending.has(request.id)) { s.pending.delete(request.id); reject(new Error('upstream timeout')); }
    }, 30000);
  });
  await fetch(s.endpointUrl, {
    method: 'POST', headers: { ...UPSTREAM_HEADERS, 'Content-Type': 'application/json' }, body: JSON.stringify(request)
  });
  return p;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;
  Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // ===== Streamable HTTP transport =====
  if (path === '/mcp') {
    if (req.method === 'POST') {
      const sessionId = req.headers['mcp-session-id'] || randomUUID();
      let body = {}; try { body = await readJson(req); } catch { /* ignore */ }
      const requests = Array.isArray(body) ? body : [body];
      let s;
      try { s = await ensureUpstream(sessionId); }
      catch (e) { res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: e.message })); return; }
      const wantsSse = (req.headers.accept || '').includes('text/event-stream');
      const results = [];
      for (const request of requests) {
        if (request.method === undefined) {
          if (request.id !== undefined) results.push({ jsonrpc: '2.0', id: request.id, error: { code: -32700, message: 'Parse error' } });
          continue;
        }
        try {
          const r = await forwardToUpstream(s, request);
          if (r) results.push(r);
        } catch (e) {
          if (request.id !== undefined) results.push({ jsonrpc: '2.0', id: request.id, error: { code: -32000, message: e.message } });
        }
      }
      if (wantsSse) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Mcp-Session-Id': sessionId });
        for (const r of results) res.write(`event: message\ndata: ${JSON.stringify(r)}\n\n`);
        res.end();
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Mcp-Session-Id': sessionId });
        res.end(JSON.stringify(results.length === 1 ? results[0] : results));
      }
      return;
    }
    if (req.method === 'GET') {
      const sessionId = req.headers['mcp-session-id'];
      if (!sessionId || !sessions.has(sessionId)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No valid session for GET /mcp' }));
        return;
      }
      let s; try { s = await ensureUpstream(sessionId); } catch { res.writeHead(502); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Mcp-Session-Id': sessionId });
      s.localSse = res;
      const ka = setInterval(() => { try { res.write(': keep-alive\n\n'); } catch { /* ignore */ } }, 15000);
      req.on('close', () => { clearInterval(ka); if (s.localSse === res) s.localSse = null; });
      return;
    }
    if (req.method === 'DELETE') {
      const sessionId = req.headers['mcp-session-id'];
      const s = sessions.get(sessionId);
      if (s) { s.alive = false; try { s.abort.abort(); } catch { /* ignore */ } sessions.delete(sessionId); }
      res.writeHead(200); res.end();
      return;
    }
    res.writeHead(405); res.end();
    return;
  }

  // ===== Legacy SSE transport =====
  if (path === '/mcp/sse' && req.method === 'GET') {
    const localSession = randomUUID();
    let s; try { s = await ensureUpstream(localSession); }
    catch (e) { res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: e.message })); return; }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    s.localSse = res;
    res.write(`event: endpoint\ndata: /mcp/messages?sessionId=${localSession}\n\n`);
    const ka = setInterval(() => { try { res.write(': keep-alive\n\n'); } catch { /* ignore */ } }, 15000);
    req.on('close', () => { clearInterval(ka); if (s.localSse === res) s.localSse = null; });
    return;
  }
  if (path === '/mcp/messages' && req.method === 'POST') {
    const localSession = url.searchParams.get('sessionId');
    const s = sessions.get(localSession);
    if (!s || !s.endpointUrl) { res.writeHead(404); res.end(); return; }
    let body = {}; try { body = await readJson(req); } catch { /* ignore */ }
    await fetch(s.endpointUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    res.writeHead(202); res.end();
    return;
  }

  if (path === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, role: 'mcp-proxy', upstream: UPSTREAM }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

server.listen(PORT, HOST, () => console.log(`MCP proxy (SSE<->Streamable HTTP) on http://${HOST}:${PORT} -> ${UPSTREAM}`));
