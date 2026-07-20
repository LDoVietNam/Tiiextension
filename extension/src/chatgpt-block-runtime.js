import { createChatGptBlockExecutor } from "./chatgpt-block-executor.js";

/** Execute parsed cnagent/1 blocks through the native runtime contract. */
export async function executeChatGptBlocks({
  text,
  settings = {},
  completed,
  sendNative,
} = {}) {
  if (typeof text !== "string" || !text.trim()) return { executed: false, results: [] };
  if (typeof sendNative !== "function") throw new TypeError("sendNative is required");

  const executionEnabled = settings.executionEnabled !== false;
  const executor = createChatGptBlockExecutor({
    completed,
    approve: async () => Boolean(executionEnabled && settings.autoApproveMutations),
    dispatch: (block) => dispatchBlock(block, sendNative),
  });
  return executor.executeText(text, { autoRun: executionEnabled });
}

async function dispatchBlock(block, sendNative) {
  if (block.type === "tool_call") return sendNative("tool_call", block.payload);
  if (block.type === "payload_load") return sendNative("payload_load", block.payload);
  if (block.type.startsWith("filesystem_")) return sendNative(block.type, block.payload);
  if (block.type === "agent_action") return sendNative("agent_action", block.payload);
  if (block.type === "task_result" || block.type === "task_event") return sendNative(block.type, block.payload);
  throw Object.assign(new Error(`Unsupported block type: ${block.type}`), { code: "BLOCK_UNSUPPORTED" });
}
