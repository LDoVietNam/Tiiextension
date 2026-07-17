// Parse tool calls from MiniMax Agent responses
// Follows ti-web-agent/1 protocol pattern

import { MinimaxDetector } from './minimax-detector.js';

export class MinimaxToolCallParser {
  /**
   * Parse tool calls from response text
   * @param {string} text
   * @returns {Array}
   */
  parseToolCalls(text) {
    if (!text || typeof text !== 'string') return [];

    const toolCalls = [];
    const seenIds = new Set();

    // Extract JSON blocks - same pattern as ChatGPT
    const jsonBlocks = this.extractJsonBlocks(text);

    for (const block of jsonBlocks) {
      try {
        const parsed = JSON.parse(block);
        if (this.isValidProtocolMessage(parsed)) {
          if (!seenIds.has(parsed.id)) {
            seenIds.add(parsed.id);
            toolCalls.push({
              id: parsed.id,
              tool: parsed.tool,
              arguments: parsed.arguments,
              ...parsed
            });
          }
        }
      } catch (e) {
        continue;
      }
    }

    return toolCalls;
  }

  /**
   * Extract JSON blocks from text
   * @param {string} text
   * @returns {string[]}
   */
  extractJsonBlocks(text) {
    const blocks = [];

    const fencedRegex = /```(?:json)?\s*([\s\S]*?)\s*```/g;
    let match;
    while ((match = fencedRegex.exec(text)) !== null) {
      blocks.push(match[1].trim());
    }

    // Try to parse entire text as JSON
    try {
      JSON.parse(text.trim());
      blocks.push(text.trim());
    } catch (e) {}

    return blocks;
  }

  /**
   * Validate protocol message
   * @param {Object} obj
   * @returns {boolean}
   */
  isValidProtocolMessage(obj) {
    if (!obj || typeof obj !== 'object') return false;
    if (!obj.type) return false;

    const validTypes = ['tool_call', 'tool_result', 'final'];
    if (!validTypes.includes(obj.type)) return false;

    if (obj.type === 'tool_call') {
      return typeof obj.id === 'string' &&
             typeof obj.tool === 'string' &&
             typeof obj.arguments === 'object';
    }

    return true;
  }
}