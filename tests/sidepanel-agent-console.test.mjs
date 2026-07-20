import assert from "node:assert/strict";
import test from "node:test";

import { createAgentConsole } from "../extension/src/extension-agent-console.js";

test("agent console submits browser tasks through the Extension Agent route", async () => {
  const sent = [];
  const console = createAgentConsole({
    sendMessage: async (message) => {
      sent.push(message);
      return { ok: true, result: { task_id: "task_1" } };
    },
  });
  await console.submit("open the active tab and collect errors");
  assert.deepEqual(sent, [{
    type: "extension-agent.submit",
    payload: { goal: "open the active tab and collect errors" },
  }]);
});

test("agent console routes refresh and cancellation through native runtime", async () => {
  const sent = [];
  const console = createAgentConsole({ sendMessage: async (message) => { sent.push(message); return { ok: true }; } });
  await console.refresh("task_1");
  await console.cancel("task_1");
  assert.deepEqual(sent, [
    { type: "native.task.get", payload: { task_id: "task_1" } },
    { type: "native.task.cancel", payload: { task_id: "task_1" } },
  ]);
});
