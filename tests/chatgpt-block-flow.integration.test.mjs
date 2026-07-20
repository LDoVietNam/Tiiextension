import assert from "node:assert/strict";
import test from "node:test";

import { executeChatGptBlocks } from "../extension/src/chatgpt-block-runtime.js";

test("cnagent block flow maps parsed ChatGPT actions to native requests and inject-ready results", async () => {
  const nativeCalls = [];
  const response = await executeChatGptBlocks({
    text: '```json\n{"protocol":"cnagent/1","block_id":"readme","tool_call":{"tool":"fs.read","args":{"path":"README.md"}}}\n```',
    settings: { executionEnabled: true, autoApproveMutations: false },
    completed: new Map(),
    sendNative: async (type, payload) => {
      nativeCalls.push({ type, payload });
      return { ok: true, content: "# Tiiextension" };
    },
  });

  assert.deepEqual(nativeCalls, [{
    type: "tool_call",
    payload: { tool: "fs.read", args: { path: "README.md" } },
  }]);
  assert.deepEqual(response.results, [{
    blockId: "readme",
    ok: true,
    result: { ok: true, content: "# Tiiextension" },
  }]);
});
