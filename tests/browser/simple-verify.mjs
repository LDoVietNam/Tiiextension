#!/usr/bin/env node
// Simple Node.js test for dashboard endpoints (no browser needed)
// Run: node tests/browser/simple-verify.mjs

const API_KEY = 'tzcirtruyBU6bOj0zpW6HF6lS4ls0j9Qm2mb_ERhxeI';
const BASE = 'http://127.0.0.1:1840';
const ROOT = 'Z:\\01_PROJECTS\\apps\\Tiiextension';

async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { ...opts.headers, 'Content-Type': 'application/json' } });
  return { ok: res.ok, status: res.status, body: await res.json().catch(() => ({})) };
}

async function tool(name, args) {
  return api(`${BASE}/internal/tools/call`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({ tool: name, arguments: args, idempotencyKey: `test_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` })
  });
}

console.log('=== 1MCP Dashboard API Verification (Node.js) ===\n');

// 1. Health check
console.log('1. Health Check:');
const health = await api(`${BASE}/health`);
console.log(`   Status: ${health.ok ? 'OK' : 'FAIL'}`);
console.log(`   Response: ${JSON.stringify(health.body)}\n`);

// 2. Dashboard UI files
console.log('2. Dashboard UI Files:');
const html = await api(`${BASE}/ui/`);
console.log(`   index.html: ${html.ok ? 'OK' : 'FAIL'}`);
const css = await api(`${BASE}/ui/styles.css`);
console.log(`   styles.css: ${css.ok ? 'OK' : 'FAIL'}`);
const js = await api(`${BASE}/ui/app.js`);
console.log(`   app.js: ${js.ok ? 'OK' : 'FAIL'}\n`);

// 3. Get allowed roots
console.log('3. Get Allowed Roots:');
const roots = await tool('get_allowed_roots', {});
console.log(`   Status: ${roots.ok ? 'OK' : 'FAIL'}`);
console.log(`   Roots: ${JSON.stringify(roots.body?.result?.roots)}\n`);

// 4. List directory
console.log('4. List Directory:');
const list = await tool('list_directory', { path: ROOT });
console.log(`   Status: ${list.ok ? 'OK' : 'FAIL'}`);
console.log(`   Entry count: ${list.body?.result?.entries?.length}\n`);

// 5. Read file
console.log('5. Read File (README.md):');
const read = await tool('read_file', { path: `${ROOT}\\README.md` });
console.log(`   Status: ${read.ok ? 'OK' : 'FAIL'}`);
console.log(`   Content length: ${read.body?.result?.content?.length}\n`);

// 6. Write then read (without modifying real files)
console.log('6. Write & Read Test File:');
const testPath = `${ROOT}\\verify_temp.txt`;
const write = await tool('write_file', { path: testPath, content: `Test at ${new Date().toISOString()}` });
console.log(`   Write: ${write.ok ? 'OK' : 'FAIL'}`);

const readBack = await tool('read_file', { path: testPath });
console.log(`   Read back: ${readBack.ok ? 'OK' : 'FAIL'}`);
console.log(`   Content matches: ${readBack.body?.result?.content?.includes('Test at') ? 'YES' : 'NO'}\n`);

// 7. Cleanup
const del = await tool('delete_to_trash', { path: testPath });
console.log(`   Cleanup: ${del.ok ? 'OK' : 'FAIL'}\n`);

console.log('=== All API verifications complete ===');