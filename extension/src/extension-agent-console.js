export function createAgentConsole({ sendMessage } = {}) {
  if (typeof sendMessage !== "function") throw new TypeError("sendMessage is required");
  return {
    submit: (goal) => sendMessage({ type: "extension-agent.submit", payload: { goal } }),
    refresh: (taskId) => sendMessage({ type: "native.task.get", payload: { task_id: taskId } }),
    cancel: (taskId) => sendMessage({ type: "native.task.cancel", payload: { task_id: taskId } }),
  };
}
