// test-full-flow.mjs
// Full integration test for ti-web-agent/1 flow

import { executionController } from './execution-controller.js';
import { taskStateStore } from './task-state-store.js';
import { TiWebAgentProtocol } from './protocol.js';

const protocol = new TiWebAgentProtocol();

console.log('=== Full Flow Test ===\n');

// Simulate receiving a tool call from ChatGPT
const toolCall = protocol.createToolCall('fs.read', {
  workspaceId: 'tiiextension',
  path: 'README.md'
});

console.log('1. Received tool call from ChatGPT:');
console.log(JSON.stringify(toolCall, null, 2));

// Execute the tool call
console.log('\n2. Executing via ExecutionController...');
const result = await executionController.handleToolCall(toolCall);

console.log('3. Execution result:');
console.log(JSON.stringify(result, null, 2));

// Verify result structure
if (result.status === 'completed' && result.result?.content) {
  console.log('\n✅ SUCCESS: Full flow works correctly!');
  console.log('File path:', result.result.path);
  console.log('Content length:', result.result.content.length);
  console.log('Has revision:', !!result.result.revision);
} else if (result.status === 'completed' && result.result?.error) {
  console.log('\n⚠️ Partial: Tool executed but returned error');
  console.log('Error:', result.result.error);
} else {
  console.log('\n❌ FAILED: Flow did not complete');
}

console.log('\n=== Test Complete ===');