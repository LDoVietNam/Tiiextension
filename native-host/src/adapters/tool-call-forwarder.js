import { dispatchToolCall, getToolCategory, isContextTool, isExecutionTool } from '../orchestration/request-dispatcher.js';
import TiRouterClient from '../clients/ti-router-client.js';

export class ToolCallForwarder {
  constructor() {
    this.timeout = 30000;
  }

  async forwardToolCall(toolCall, options = {}) {
    const { requestId, workspaceId, revision, timeoutMs } = options;

    if (isContextTool(toolCall.tool)) {
      return await dispatchToolCall(toolCall.tool, toolCall.args, {
        requestId,
        workspaceId,
        revision,
        timeoutMs: timeoutMs || this.timeout
      });
    }

    if (isExecutionTool(toolCall.tool)) {
      return await dispatchToolCall(toolCall.tool, toolCall.args, {
        requestId,
        workspaceId,
        revision,
        timeoutMs: timeoutMs || this.timeout
      });
    }

    const client = TiRouterClient;
    return await client.callTool(toolCall.tool, toolCall.args, {
      workspaceId,
      revision,
      timeoutMs: timeoutMs || this.timeout
    });
  }

  normalizeToolCall(rawToolCall, options = {}) {
    const { requestId, workspaceId, revision } = options;

    return {
      protocol: 'cnagent/1',
      requestId: requestId || `req_${Date.now()}`,
      workspaceId: workspaceId || 'tiiextension',
      revision: revision || null,
      tool: rawToolCall.tool || rawToolCall.name,
      args: rawToolCall.args || rawToolCall.arguments || {},
      timeoutMs: rawToolCall.timeoutMs || 30000,
      idempotencyKey: `${workspaceId || 'tiiextension'}:${rawToolCall.tool || rawToolCall.name}:${JSON.stringify(rawToolCall.args || {})}`
    };
  }

  getToolCategory(toolName) {
    return getToolCategory(toolName);
  }

  isContextTool(toolName) {
    return isContextTool(toolName);
  }

  isExecutionTool(toolName) {
    return isExecutionTool(toolName);
  }

  async normalizeResponse(response, options = {}) {
    const { requestId, workspaceId } = options;

    return {
      protocol: 'cnagent/1',
      requestId,
      workspaceId,
      status: response.ok ? 'success' : 'error',
      result: response.result,
      error: response.error,
      diagnostics: response.diagnostics || [],
      artifacts: response.artifacts || [],
      timestamp: Date.now()
    };
  }
}

export const toolCallForwarder = new ToolCallForwarder();