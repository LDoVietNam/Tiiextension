const CAPABILITIES = Object.freeze([
  "browser.tabs",
  "browser.context",
  "browser.action",
]);

export function createExtensionAgentTask({ goal, source = "tiiextension" } = {}) {
  if (typeof goal !== "string" || !goal.trim()) throw new TypeError("goal is required");
  return {
    goal: goal.trim(),
    source,
    agent: "extension-browser",
    capabilities: [...CAPABILITIES],
    handoff: { target: "pc-automation", allowed: true },
  };
}

export function isExtensionAgentTask(task) {
  return Boolean(
    task
    && task.agent === "extension-browser"
    && Array.isArray(task.capabilities)
    && task.capabilities.every((capability) => CAPABILITIES.includes(capability)),
  );
}
