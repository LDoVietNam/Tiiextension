// test-runner.mjs
// Combined test runner that starts server and runs integration tests

import { spawn } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';

// Start the Context Bridge server
console.log('Starting Context Bridge server...');
const server = spawn('node', ['extension/src/context-bridge/server.js'], {
  detached: true,
  stdio: 'ignore'
});

server.unref();

// Wait for server to start
await setTimeout(1000);

console.log('Server started, running integration tests...\n');

// Run the full flow test
const testModule = await import('./test-full-flow.mjs');

console.log('\n--- Test Runner Complete ---');