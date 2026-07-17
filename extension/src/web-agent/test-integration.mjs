// test-integration.mjs
// Integration test for tool call flow

import { executionController } from './execution-controller.js';
import { taskStateStore } from './task-state-store.js';
import { TiWebAgentProtocol, MESSAGE_TYPES } from './protocol.js';

const protocol = new TiWebAgentProtocol();

console.log('=== Integration Test Start ===\n');

// Test 1: Protocol parsing
console.log('Test 1: Protocol factory methods');
const toolCall = protocol.createToolCall('fs.read', { path: 'README.md' });
console.log('Created tool call:', JSON.stringify(toolCall, null, 2));
console.log('Is valid tool_call:', protocol.isToolCall(toolCall));

// Test 2: Task state store
console.log('\nTest 2: Task state management');
taskStateStore.setPending(toolCall.id, toolCall);
console.log('Pending state:', taskStateStore.getState(toolCall.id));

// Test 3: Execution controller (will fail without Context Bridge running)
console.log('\nTest 3: Execution controller');
console.log('Controller initialized:', !!executionController);
console.log('Default workspace:', executionController.defaultWorkspace);

console.log('\n=== Integration Test Complete ===');