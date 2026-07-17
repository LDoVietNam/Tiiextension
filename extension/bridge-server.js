// bridge-server.js - Minimal OpenBrowser-style job bridge on :5000
// Streams `job` events over SSE (/browser/events) and serves the claim /
// prompt-file / chunk / response contract that content-script.js expects.
//
// Job payload format (posted to POST /browser/jobs):
//   {
//     "sessionId": "job_xxx",        // required, unique per job
//     "delivery": "file" | "inline", // "file" -> attach prompt-file, else inline message
//     "message": "task text",        // inline prompt (used when delivery !== "file")
//     "systemPrompt": "..."          // optional, prepended for empty threads
//     "mode": "ask" | "run",         // "ask" streams a chunk back before final response
//     "promptFileName": "openbrowser-prompt.txt",
//     "promptFile": "raw prompt content", // used by /browser/prompt-file
//     "composerMessage": "...",      // optional override for file-attach path
//     "markdownDraft": false
//   }
// The server is tolerant: any extra fields are preserved and forwarded as-is.
// (If you have a different payload shape, tell me and I'll normalize it here.)

import http from 'node:http';
import { randomUUID } from 'node:crypto';

const HOST = process.env.BRIDGE_HOST || '127.0.0.1';
const PORT = parseInt(process.env.BRIDGE_PORT || '5000', 10);

/** @type {Map<string, object>} sessionId -> job */
const jobs = new Map();
/** @type {Set<string>} claimed sessionIds */
const claimed = new Set();
/** @type {Map<string, { text?: string, chunks: string[] }>} */
const responses = new Map();
/** @type {Set<import('node:http').ServerResponse>} */
const sseClients = new Set();

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
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

function sendSse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function broadcastJob(job) {
  for (const res of sseClients) {
    try { sendSse(res, 'job', job); } catch { /* client gone */ }
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;
  setCors(res);

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // Health
  if (path === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, status: 'bridge up', jobs: jobs.size }));
    return;
  }

  // SSE event stream
  if (path === '/browser/events' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    sseClients.add(res);
    // Replay unclaimed jobs so a late-connecting background catches up.
    for (const job of jobs.values()) {
      if (!claimed.has(job.sessionId)) {
        try { sendSse(res, 'job', job); } catch { /* ignore */ }
      }
    }
    req.on('close', () => sseClients.delete(res));
    return;
  }

  // Enqueue a job (payload format supplied by caller)
  if (path === '/browser/jobs' && req.method === 'POST') {
    let body;
    try { body = await readJson(req); }
    catch { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: 'invalid json' })); return; }

    const sessionId = body.sessionId || `job_${randomUUID()}`;
    const job = { ...body, sessionId };
    jobs.set(sessionId, job);
    broadcastJob(job);
    console.log(`[bridge] job enqueued: ${sessionId}`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, sessionId }));
    return;
  }

  // Claim a job
  if (path === '/browser/claim' && req.method === 'POST') {
    const body = await readJson(req);
    const job = jobs.get(body.sessionId);
    if (!job) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'job not found' }));
      return;
    }
    claimed.add(body.sessionId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, claimed: true, job }));
    return;
  }

  // Prompt file for a job
  if (path.startsWith('/browser/prompt-file/') && req.method === 'GET') {
    const sessionId = path.split('/').pop();
    const job = jobs.get(sessionId);
    const content = job?.promptFile ?? job?.message ?? '';
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, content }));
    return;
  }

  // Final response for a job (used by the side panel polling)
  if (path.startsWith('/browser/response/') && req.method === 'GET') {
    const sessionId = path.split('/').pop();
    const rec = responses.get(sessionId) || {};
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, text: rec.text || '', chunks: rec.chunks || [] }));
    return;
  }

  // Streaming chunk from the browser
  if (path === '/browser/chunk' && req.method === 'POST') {
    const body = await readJson(req);
    const rec = responses.get(body.sessionId) || { chunks: [] };
    rec.chunks.push(body.text || '');
    responses.set(body.sessionId, rec);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // Final response from the browser
  if (path === '/browser/response' && req.method === 'POST') {
    const body = await readJson(req);
    const rec = responses.get(body.sessionId) || { chunks: [] };
    rec.text = body.text || '';
    responses.set(body.sessionId, rec);
    console.log(`[bridge] response ${body.sessionId}: ${(body.text || '').slice(0, 80)}...`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: false, error: 'not found' }));
});

server.listen(PORT, HOST, () => {
  console.log(`OpenBrowser job bridge listening on http://${HOST}:${PORT}`);
});
