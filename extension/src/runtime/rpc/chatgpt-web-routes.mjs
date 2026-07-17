// chatgpt-web-routes.mjs
// Routes incoming requests from ChatGPT Web Provider to execution workflows
// Maps tool names to proper handlers and dispatches through Context Bridge

import { executePlan } from '../../runtime/agent/web-provider-loop.mjs';

const routeMap = {
  // File system operations
  'fs.read': async (args) => {
    // Use execution controller to handle read requests
    const controller = await import('../../web-agent/execution-controller.js');
    return controller.handleToolCall({
      protocol: 'ti-web-agent/1',
      type: 'tool_call',
      tool: 'fs.read',
      arguments: args
    });
  },

  // Add other filesystem tools similarly
  'fs.list': async (args) => {
    const controller = await import('../../web-agent/execution-controller.js');
    return controller.handleToolCall({
      protocol: 'ti-web-agent/1',
      type: 'tool_call',
      tool: 'fs.list',
      arguments: args
    });
  },

  // Execution control
  'plan.execute': async (args) => {
    const { plan, timeout } = args;
    return await executePlan(plan, timeout);
  }
};

export async function routeRequest(request) {
  const { tool, args } = request;
  const handler = routeMap[tool];

  if (!handler) {
    return {
      ok: false,
      error: `Unhandled tool: ${tool}`
    };
  }

  return await handler(args);
}