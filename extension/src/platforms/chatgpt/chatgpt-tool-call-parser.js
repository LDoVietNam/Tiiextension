// Parse tool calls from AI responses
import { TiWebAgentProtocol } from '../../../web-agent/protocol.js';

export class ChatgptToolCallParser {
  /**
   * Parse tool calls from text
   * @param {string} text - AI response text
   * @returns {Object[]} Array of parsed tool calls
   */
  static parseToolCalls(text) {
    if (!text || typeof text !== 'string') return [];
    
    const toolCalls = [];
    
    // Use protocol utility to extract JSON blocks
    const jsonBlocks = TiWebAgentProtocol.extractJsonBlocks(text);
    
    for (const block of jsonBlocks) {
      try {
        const parsed = JSON.parse(block);
        if (TiWebAgentProtocol.isValidProtocolMessage(parsed) && 
            parsed.type === 'tool_call') {
          toolCalls.push({
            id: parsed.id,
            tool: parsed.tool,
            arguments: parsed.arguments,
            raw: block
          });
        }
      } catch (e) {
        // Not a valid tool call, ignore
      }
    }
    
    // Also look for tool calls in markdown code blocks with specific markers
    const pattern = /```(?:json)?\s*({"protocol":\s*"ti-web-agent\/1",\s*"type":\s*"tool_call"[\s\S]*?})\s*```/gi;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      try {
        const parsed = JSON.parse(match[1]);
        if (TiWebAgentProtocol.isValidProtocolMessage(parsed) && 
            parsed.type === 'tool_call') {
          // Avoid duplicates
          if (!toolCalls.some(tc => tc.id === parsed.id)) {
            toolCalls.push({
              id: parsed.id,
              tool: parsed.tool,
              arguments: parsed.arguments,
              raw: match[1]
            });
          }
        }
      } catch (e) {
        // Invalid JSON
      }
    }
    
    return toolCalls;
  }

  /**
   * Extract a single tool call (first one found)
   * @param {string} text - AI response text
   * @returns {Object|null} Tool call or null
   */
  static parseToolCall(text) {
    const calls = this.parseToolCalls(text);
    return calls.length > 0 ? calls[0] : null;
  }

  /**
   * Check if text contains any tool calls
   * @param {string} text - AI response text
   * @returns {boolean}
   */
  static hasToolCalls(text) {
    return this.parseToolCalls(text).length > 0;
  }

  /**
   * Remove tool calls from text (to get the explanatory text)
   * @param {string} text - Original text
   * @returns {string} Text with tool calls removed
   */
  static stripToolCalls(text) {
    if (!text || typeof text !== 'string') return text;
    
    // Remove fenced code blocks containing tool calls
    let result = text;
    const blockRegex = /```(?:json)?\s*[\s\S]*?\"type\"\s*:\s*\"tool_call\"[\s\S]*?```/g;
    result = result.replace(blockRegex, '');
    
    // Clean up extra newlines
    result = result.replace(/\n\s*\n\s*\n/g, '\n\n').trim();
    return result;
  }

  /**
   * Format a tool call for display in chat
   * @param {Object} toolCall - Tool call object
   * @returns {string} Formatted string
   */
  static formatToolCall(toolCall) {
    if (!toolCall) return '';
    
    const { tool, args } = toolCall;
    const argsStr = JSON.stringify(args, null, 2);
    return `🔧 **Tool Call**: \`${tool}\`\n\`\`\`json\n${argsStr}\n\`\`\``;
  }
}