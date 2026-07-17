import { runtime } from './browser-polyfill.js';

const COMPAT_MODE = process.env.TIIEXTENSION_COMPAT_MODE || 'native';

export class TiRouterCompatClient {
  constructor() {
    this.compatibilityMode = COMPAT_MODE;
    this.nativeHostUrl = process.env.TIIEXTENSION_API_URL || 'http://127.0.0.1:18401';
    this.apiKey = process.env.TIIEXTENSION_API_KEY || '';
  }

  async healthCheck() {
    if (this.compatibilityMode === 'native') {
      return await this._checkNativeHost();
    }
    return await this._checkHttp();
  }

  async _checkNativeHost() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({
        type: 'native.call',
        payload: {
          protocol: 'cnagent/1',
          block_id: 'health_check',
          tool_call: {
            call_id: `call_${Date.now()}`,
            tool: 'runtime.status',
            args: {},
            idempotency_key: `compat:health_check:${Date.now()}`
          }
        }
      }, (response) => {
        resolve(response?.ok === true);
      });
    });
  }

  async _checkHttp() {
    try {
      const response = await fetch(`${this.nativeHostUrl}/v1/health`);
      return response.ok;
    } catch {
      return false;
    }
  }

  async callTool(toolName, args, options = {}) {
    const { workspaceId, revision, timeoutMs = 30000, requestId } = options;

    if (this.compatibilityMode === 'native') {
      return await this._callNativeTool(toolName, args, { workspaceId, revision, timeoutMs, requestId });
    }

    return await this._callHttpTool(toolName, args, { workspaceId, revision, timeoutMs, requestId });
  }

  async _callNativeTool(toolName, args, options = {}) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Tool call timeout'));
      }, options.timeoutMs || 30000);

      chrome.runtime.sendMessage({
        type: 'native.call',
        payload: {
          protocol: 'cnagent/1',
          task_id: options.workspaceId || 'tiiextension',
          block_id: `tool_${toolName}_${Date.now()}`,
          tool_call: {
            call_id: `call_${Date.now()}`,
            tool: toolName,
            args: args || {},
            idempotency_key: `${options.workspaceId || 'tiiextension'}:${toolName}:${Date.now()}`
          }
        }
      }, (response) => {
        clearTimeout(timeout);
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
    });
  }

  async _callHttpTool(toolName, args, options = {}) {
    const response = await fetch(`${this.nativeHostUrl}/v1/tools/${toolName}/call`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey && { 'Authorization': `Bearer ${this.apiKey}` })
      },
      body: JSON.stringify({
        tool: toolName,
        args: args || {},
        workspaceId: options.workspaceId,
        revision: options.revision
      })
    });

    return await response.json();
  }
}

export const tiRouterClient = new TiRouterCompatClient();