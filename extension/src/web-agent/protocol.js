// protocol.js
// Protocol definitions for ti-web-agent/1 protocol used in ChatGPT Web interactions

export const PROTOCOL = 'ti-web-agent/1';

export const MESSAGE_TYPES = {
  TOOL_CALL: 'tool_call',
  TOOL_RESULT: 'tool_result',
  FINAL: 'final'
};

export class TiWebAgentProtocol {
  constructor() {
    this.protocol = PROTOCOL;
    this.types = MESSAGE_TYPES;
  }

  createToolCall(tool, args, id = this._generateId()) {
    return {
      protocol: this.protocol,
      type: MESSAGE_TYPES.TOOL_CALL,
      id,
      tool,
      arguments: args
    };
  }

  createToolResult(id, result, ok = true, error = null) {
    return {
      protocol: this.protocol,
      type: MESSAGE_TYPES.TOOL_RESULT,
      id,
      ok,
      ...(ok ? { result } : { error })
    };
  }

  createFinalResponse(summary, verification = {}) {
    return {
      protocol: this.protocol,
      type: MESSAGE_TYPES.FINAL,
      summary,
      verification
    };
  }

  _generateId() {
    return `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  isToolCall(obj) {
    return obj?.protocol === this.protocol && obj?.type === MESSAGE_TYPES.TOOL_CALL;
  }

  isToolResult(obj) {
    return obj?.protocol === this.protocol && obj?.type === MESSAGE_TYPES.TOOL_RESULT;
  }

  isFinal(obj) {
    return obj?.protocol === this.protocol && obj?.type === MESSAGE_TYPES.FINAL;
  }
}