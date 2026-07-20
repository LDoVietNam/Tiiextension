import assert from "node:assert/strict";
import test from "node:test";

import { createExtensionAgentTask, isExtensionAgentTask } from "../extension/src/extension-agent-task.js";

test("creates a browser-scoped Extension Agent task", () => {
  const task = createExtensionAgentTask({ goal: " inspect the active tab " });
  assert.deepEqual(task, {
    goal: "inspect the active tab",
    source: "tiiextension",
    agent: "extension-browser",
    capabilities: ["browser.tabs", "browser.context", "browser.action"],
    handoff: { target: "pc-automation", allowed: true },
  });
  assert.equal(isExtensionAgentTask(task), true);
});

test("rejects an empty Extension Agent goal", () => {
  assert.throws(() => createExtensionAgentTask({ goal: " " }), /goal is required/);
});
