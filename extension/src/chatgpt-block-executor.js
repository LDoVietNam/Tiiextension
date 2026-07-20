import { parseStructuredBlocks } from "./block-parser.js";

const MUTATING_TYPES = new Set(["filesystem_write", "filesystem_patch", "payload_load", "agent_action"]);

export function createChatGptBlockExecutor({ dispatch, approve = async () => true, completed = new Map(), maxCompleted = 500 } = {}) {
  if (typeof dispatch !== "function") throw new TypeError("dispatch is required");
  if (!(completed instanceof Map)) throw new TypeError("completed must be a Map");

  async function executeText(text, { autoRun = true } = {}) {
    const blocks = parseStructuredBlocks(text);
    const results = [];
    for (const block of blocks) {
      if (completed.has(block.blockId)) {
        results.push({ blockId: block.blockId, ok: true, duplicate: true, result: completed.get(block.blockId) });
        continue;
      }
      const requiresApproval = MUTATING_TYPES.has(block.type) || (block.type === "tool_call" && isMutatingTool(block.payload?.tool));
      if (!autoRun || requiresApproval) {
        const allowed = await approve(block);
        if (!allowed) {
          results.push({ blockId: block.blockId, ok: false, error: { code: "POLICY_DENIED", message: "Tool execution was not approved" } });
          continue;
        }
      }
      try {
        const result = await dispatch(block);
        completed.set(block.blockId, result);
        while (completed.size > maxCompleted) completed.delete(completed.keys().next().value);
        results.push({ blockId: block.blockId, ok: true, result });
      } catch (error) {
        results.push({ blockId: block.blockId, ok: false, error: { code: error?.code || "EXECUTION_FAILED", message: error?.message || "Tool execution failed" } });
      }
    }
    return { executed: blocks.length > 0, results };
  }
  return { executeText };
}

function isMutatingTool(tool) {
  return typeof tool === "string" && /^(fs\.(write|append|patch|delete|move|copy|mkdir)|process\.|git\.(commit|push)|payload\.)/.test(tool);
}
