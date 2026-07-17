import crypto from "node:crypto";

export const TASK_STATES = Object.freeze([
  "queued", "planning", "executing", "awaiting_model", "verifying",
  "rolling_back", "completed", "rolled_back", "failed", "cancelled"
]);

const TERMINAL = new Set(["completed", "rolled_back", "failed", "cancelled"]);
const TRANSITIONS = Object.freeze({
  queued: new Set(["planning", "cancelled", "failed"]),
  planning: new Set(["executing", "cancelled", "failed"]),
  executing: new Set(["awaiting_model", "verifying", "rolling_back", "cancelled", "failed"]),
  awaiting_model: new Set(["executing", "rolling_back", "cancelled", "failed"]),
  verifying: new Set(["completed", "rolling_back", "failed"]),
  rolling_back: new Set(["rolled_back", "failed"]),
  completed: new Set(),
  rolled_back: new Set(),
  failed: new Set(),
  cancelled: new Set()
});

export function createTaskEngine({ store, events, idFactory = defaultIdFactory, clock = () => new Date().toISOString() }) {
  if (!store || !events) throw new TypeError("store and events are required");

  async function enqueue({ goal, profile = "default", provider = "chatgpt-web", maxIterations = 20, ...metadata }) {
    if (typeof goal !== "string" || !goal.trim()) throw new TypeError("goal is required");
    const now = clock();
    const task = {
      task_id: idFactory("task"),
      goal: goal.trim(),
      profile,
      provider,
      status: "queued",
      iteration: 0,
      max_iterations: maxIterations,
      dirty: false,
      created_at: now,
      updated_at: now,
      ...metadata
    };
    await store.update((draft) => {
      draft.tasks[task.task_id] = task;
    });
    await events.emit("task.queued", { status: task.status, goal: task.goal }, { taskId: task.task_id });
    return clone(task);
  }

  async function get(taskId) {
    const task = await store.read((state) => state.tasks[taskId]);
    if (!task) throw codedError("TASK_NOT_FOUND", `Task not found: ${taskId}`);
    return clone(task);
  }

  async function list({ status, limit = 100 } = {}) {
    const tasks = await store.read((state) => Object.values(state.tasks));
    return tasks
      .filter((task) => !status || task.status === status)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, Math.max(1, Math.min(limit, 1000)));
  }

  async function transition(taskId, nextStatus, patch = {}) {
    if (!TASK_STATES.includes(nextStatus)) throw codedError("TASK_INVALID_STATE", `Unknown task state: ${nextStatus}`);
    const task = await store.update((draft) => {
      const current = draft.tasks[taskId];
      if (!current) throw codedError("TASK_NOT_FOUND", `Task not found: ${taskId}`);
      if (current.status === nextStatus) return current;
      if (!TRANSITIONS[current.status]?.has(nextStatus)) {
        throw codedError("TASK_INVALID_TRANSITION", `Invalid task transition: ${current.status} -> ${nextStatus}`);
      }
      Object.assign(current, clone(patch), { status: nextStatus, updated_at: clock() });
      return current;
    });
    await events.emit("task.state", { status: nextStatus }, { taskId });
    return task;
  }

  async function cancel(taskId) {
    const current = await get(taskId);
    if (TERMINAL.has(current.status)) return current;
    const dirty = Boolean(current.dirty || current.transaction_id);
    const next = dirty && ["executing", "awaiting_model", "verifying"].includes(current.status)
      ? "rolling_back"
      : "cancelled";
    return transition(taskId, next, { stop_reason: "cancelled" });
  }

  async function recordCall({ taskId, callId = idFactory("call"), tool, args = {}, idempotencyKey }) {
    if (!tool) throw new TypeError("tool is required");
    return store.update((draft) => {
      if (taskId && !draft.tasks[taskId]) throw codedError("TASK_NOT_FOUND", `Task not found: ${taskId}`);
      if (idempotencyKey) {
        const existing = Object.values(draft.calls).find((call) => call.idempotency_key === idempotencyKey);
        if (existing) return { duplicate: true, call: existing, result: existing.result };
      }
      const call = {
        call_id: callId,
        ...(taskId ? { task_id: taskId } : {}),
        tool,
        args: clone(args),
        ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
        status: "received",
        created_at: clock(),
        updated_at: clock()
      };
      draft.calls[call.call_id] = call;
      return { duplicate: false, call };
    });
  }

  async function completeCall(callId, result, { ok = true } = {}) {
    const call = await store.update((draft) => {
      const current = draft.calls[callId];
      if (!current) throw codedError("TASK_CALL_NOT_FOUND", `Call not found: ${callId}`);
      current.status = ok ? "completed" : "failed";
      current.result = clone(result);
      current.updated_at = clock();
      return current;
    });
    await events.emit("tool.completed", { call_id: callId, ok }, { taskId: call.task_id });
    return call;
  }

  async function recover() {
    const recovered = [];
    const candidates = await list({ limit: 1000 });
    for (const task of candidates) {
      if (TERMINAL.has(task.status)) continue;
      if (task.dirty || task.transaction_id) {
        if (TRANSITIONS[task.status]?.has("rolling_back")) {
          recovered.push(await transition(task.task_id, "rolling_back", { stop_reason: "runtime_recovery" }));
        }
      } else if (TRANSITIONS[task.status]?.has("failed")) {
        recovered.push(await transition(task.task_id, "failed", { stop_reason: "runtime_interrupted" }));
      }
    }
    return recovered;
  }

  return { enqueue, get, list, transition, cancel, recordCall, completeCall, recover };
}

function defaultIdFactory(prefix) {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

