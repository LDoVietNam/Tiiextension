import assert from "node:assert/strict";
import test from "node:test";
import { createChatGptBlockExecutor } from "../extension/src/chatgpt-block-executor.js";

test("executes GPT cnagent blocks once and requires approval for mutation", async () => {
  const calls = [];
  let approvals = 0;
  const executor = createChatGptBlockExecutor({
    dispatch: async (block) => { calls.push(block); return { tool: block.payload.tool || block.type }; },
    approve: async () => { approvals += 1; return true; },
  });
  const text = '```json\n{"protocol":"cnagent/1","block_id":"read-1","tool_call":{"tool":"fs.read","args":{"path":"README.md"}}}\n```\n```json\n{"protocol":"cnagent/1","block_id":"write-1","tool_call":{"tool":"fs.write","args":{"path":"a.txt","content":"x"}}}\n```';
  const first = await executor.executeText(text);
  const second = await executor.executeText(text);
  assert.equal(first.results.length, 2);
  assert.equal(calls.length, 2);
  assert.equal(approvals, 1);
  assert.equal(second.results.every((item) => item.duplicate), true);
});

test("shares idempotency state across executor instances and denies unapproved writes", async () => {
  const completed = new Map();
  let calls = 0;
  const dispatch = async () => { calls += 1; return { ok: true }; };
  const text = '```json\n{"protocol":"cnagent/1","block_id":"write-1","tool_call":{"tool":"fs.write","args":{"path":"a.txt","content":"x"}}}\n```';
  const first = createChatGptBlockExecutor({ dispatch, completed, approve: async () => false });
  const denied = await first.executeText(text);
  assert.equal(denied.results[0].error.code, "POLICY_DENIED");
  assert.equal(calls, 0);

  const approved = createChatGptBlockExecutor({ dispatch, completed, approve: async () => true });
  await approved.executeText(text);
  const duplicate = await createChatGptBlockExecutor({ dispatch, completed }).executeText(text);
  assert.equal(calls, 1);
  assert.equal(duplicate.results[0].duplicate, true);
});
