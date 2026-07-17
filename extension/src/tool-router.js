import { tiRouterClient } from './ti-router-client.js';
import { runtime } from './browser-polyfill.js';

const CONTEXT_BRIDGE_URL = process.env.TIIEXTENSION_CONTEXT_BRIDGE_URL || 'http://127.0.0.1:3333';

export class ToolRouter {
  constructor() {
    this.contextBridgeUrl = CONTEXT_BRIDGE_URL;
    this.contextTools = new Set([
      'fs.read', 'fs.list', 'fs.search_text', 'fs.tree',
      'git.status', 'git.diff', 'git.log', 'git.branches',
      'repo.overview', 'code.search', 'code.symbols', 'code.dependencies'
    ]);
    this.executionTools = new Set([
      'fs.patch', 'fs.write', 'fs.delete',
      'command.run', 'test.run', 'lint.run', 'build.run',
      'git.commit', 'git.create_branch', 'git.restore'
    ]);
  }

  async routeToolCall(toolName, args, options = {}) {
    const { workspaceId, revision, timeoutMs = 30000 } = options;
    
    if (this.contextTools.has(toolName)) {
      return this.callContextBridge(toolName, args, options);
    }
    
    if (this.executionTools.has(toolName)) {
      return this.callContextBridge(toolName, args, options);
    }
    
    return tiRouterClient.callTool(toolName, args, options);
  }

  async callContextBridge(toolName, args, options = {}) {
    const { workspaceId, revision, timeoutMs = 30000 } = options;
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Context bridge timeout'));
      }, timeoutMs);

      fetch(`${this.contextBridgeUrl}/v1/tools/${toolName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tool: toolName,
          args,
          workspaceId,
          revision
        })
      })
        .then(response => response.json())
        .then(data => {
          clearTimeout(timeout);
          resolve(data);
        })
        .catch(error => {
          clearTimeout(timeout);
          reject(error);
        });
    });
  }

  isContextTool(toolName) {
    return this.contextTools.has(toolName);
  }

  isExecutionTool(toolName) {
    return this.executionTools.has(toolName);
  }

  getToolCategory(toolName) {
    if (this.contextTools.has(toolName)) return 'context';
    if (this.executionTools.has(toolName)) return 'execution';
    return 'external';
  }
}

export const toolRouter = new ToolRouter();