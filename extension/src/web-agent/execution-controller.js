// execution-controller.js
// Orchestrates tool calls from ChatGPT responses and routes them through Context Bridge
// Implements the missing execution layer for ti-web-agent/1 protocol

import { sendToContext, listWorkspace, searchWorkspace } from '../context-bridge/api.js';

// Route map for tool calls to Context Bridge methods
const TOOL_ROUTE_MAP = {
  'fs.read': { method: 'fs.read', workspace: 'tiiextension' },
  'fs.list': { method: 'fs.list', workspace: 'tiiextension' },
  'fs.search': { method: 'fs.search_text', workspace: 'tiiextension' },
  'git.status': { method: 'git.status', workspace: 'tiiextension' },
  'git.diff': { method: 'git.diff', workspace: 'tiiextension' }
};

class ExecutionController {
  constructor() {
    this.queue = [];
    this.active = false;
    this.defaultWorkspace = 'tiiextension';
  }

  /**
   * Process a parsed tool call and route it through Context Bridge
   * @param {Object} toolCall - Parsed ti-web-agent/1 tool call
   * @returns {Promise<Object>} Result of the tool execution
   */
  async handleToolCall(toolCall) {
    if (this.active) {
      this.queue.push(toolCall);
      return { status: 'queued', callId: toolCall.id };
    }

    this.active = true;
    try {
      const result = await this._executeTool(toolCall);
      return {
        status: 'completed',
        tool: toolCall.tool,
        callId: toolCall.id,
        result: result
      };
    } catch (error) {
      return {
        status: 'failed',
        tool: toolCall.tool,
        callId: toolCall.id,
        error: error.message || 'Unknown error'
      };
    } finally {
      this.active = false;
      if (this.queue.length > 0) {
        const nextCall = this.queue.shift();
        this.handleToolCall(nextCall);
      }
    }
  }

  /**
   * Execute a single tool call
   * @param {Object} toolCall
   * @returns {Promise<Object>}
   */
  async _executeTool(toolCall) {
    const { tool, arguments: args, id } = toolCall;

    // Look up the route
    const route = TOOL_ROUTE_MAP[tool] || this._parseCustomRoute(tool, args);

    if (!route) {
      throw new Error(`No route found for tool: ${tool}`);
    }

    // Build the request
    const request = {
      method: route.method,
      args: {
        workspaceId: args.workspaceId || route.workspace,
        ...args
      }
    };

    // Execute via Context Bridge
    const response = await sendToContext(request);

    if (!response.ok) {
      throw new Error(response.error?.message || 'Tool execution failed');
    }

    return response.result;
  }

  /**
   * Parse custom tool routes from tool name
   * @param {string} tool
   * @param {Object} args
   * @returns {Object|null}
   */
  _parseCustomRoute(tool, args) {
    // Support tools like: 'workspace.fs.read', 'git.log', etc.
    const parts = tool.split('.');
    if (parts.length >= 2) {
      const method = parts.join('.');
      return { method, workspace: args.workspaceId || this.defaultWorkspace };
    }
    return null;
  }

  /**
   * Set the default workspace
   * @param {string} workspaceId
   */
  setWorkspace(workspaceId) {
    this.defaultWorkspace = workspaceId;
  }

  /**
   * Get current queue length
   * @returns {number}
   */
  getQueueLength() {
    return this.queue.length;
  }
}

export const executionController = new ExecutionController();