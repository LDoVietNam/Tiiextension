import crypto from "node:crypto";

export const PROTOCOL = "cnagent/1";

export const BUSINESS_KEYS = Object.freeze([
  "agent_goal",
  "agent_action",
  "tool_call",
  "payload_load",
  "task_result",
  "task_event",
  "filesystem_read",
  "filesystem_write",
  "filesystem_patch",
  "filesystem_search"
]);

const TOP_LEVEL_KEYS = new Set(["protocol", "task_id", "block_id", "meta", ...BUSINESS_KEYS]);

export function validateEnvelope(value) {
  const errors = [];
  if (!isPlainObject(value)) {
    return { ok: false, errors: [{ path: "$", message: "Envelope must be an object" }] };
  }

  const unknown = Object.keys(value).filter((key) => !TOP_LEVEL_KEYS.has(key));
  if (unknown.length) {
    errors.push({ path: "$", message: `Unknown top-level field(s): ${unknown.join(", ")}` });
  }

  if (value.protocol !== undefined && value.protocol !== PROTOCOL) {
    errors.push({ path: "$.protocol", message: `Unsupported protocol: ${value.protocol}` });
  }

  const present = BUSINESS_KEYS.filter((key) => Object.prototype.hasOwnProperty.call(value, key));
  if (present.length === 0) {
    errors.push({ path: "$", message: "Envelope must contain one recognized business key" });
  } else if (present.length !== 1) {
    errors.push({ path: "$", message: "Envelope must contain exactly one business key" });
  }

  if (present.length === 1) validatePayload(present[0], value[present[0]], errors);
  for (const key of ["task_id", "block_id"]) {
    if (value[key] !== undefined && (typeof value[key] !== "string" || !value[key].trim())) {
      errors.push({ path: `$.${key}`, message: `${key} must be a non-empty string` });
    }
  }

  return { ok: errors.length === 0, errors };
}

export function normalizeEnvelope(value, { taskId, idFactory = defaultIdFactory } = {}) {
  if (Array.isArray(value)) {
    return value.flatMap((item) => normalizeEnvelope(item, { taskId, idFactory }));
  }

  const validation = validateEnvelope(value);
  if (!validation.ok) {
    const error = new Error(validation.errors.map((item) => item.message).join("; "));
    error.code = "PROTOCOL_VALIDATION_ERROR";
    error.details = validation.errors;
    throw error;
  }

  const businessKey = BUSINESS_KEYS.find((key) => Object.prototype.hasOwnProperty.call(value, key));
  const envelope = {
    protocol: PROTOCOL,
    ...(value.task_id || taskId ? { task_id: value.task_id || taskId } : {}),
    block_id: value.block_id || idFactory("block"),
    ...(value.meta ? { meta: structuredCloneSafe(value.meta) } : {}),
    [businessKey]: structuredCloneSafe(value[businessKey])
  };
  return [envelope];
}

export function makeTaskResult({ taskId, blockId, callId, ok, data, error, summary, artifacts, metrics }) {
  if (typeof ok !== "boolean") throw new TypeError("ok must be boolean");
  const payload = {
    ...(callId ? { call_id: callId } : {}),
    ok,
    ...(summary ? { summary } : {}),
    ...(data !== undefined ? { data } : {}),
    ...(artifacts?.length ? { artifacts } : {}),
    ...(metrics ? { metrics } : {})
  };
  if (!ok) {
    payload.error = normalizeError(error);
  }
  return {
    protocol: PROTOCOL,
    ...(taskId ? { task_id: taskId } : {}),
    block_id: blockId || defaultIdFactory("block"),
    task_result: payload
  };
}

export function normalizeError(error) {
  if (isPlainObject(error)) {
    return {
      code: stringOr(error.code, "INTERNAL_ERROR"),
      message: stringOr(error.message, "Unknown error"),
      retryable: Boolean(error.retryable),
      ...(error.details !== undefined ? { details: structuredCloneSafe(error.details) } : {})
    };
  }
  return {
    code: stringOr(error?.code, "INTERNAL_ERROR"),
    message: stringOr(error?.message || error, "Unknown error"),
    retryable: Boolean(error?.retryable)
  };
}

function validatePayload(key, payload, errors) {
  if (!isPlainObject(payload)) {
    errors.push({ path: `$.${key}`, message: `${key} must be an object` });
    return;
  }
  const requireString = (field, aliases = []) => {
    const value = [field, ...aliases].map((name) => payload[name]).find((item) => typeof item === "string" && item.trim());
    if (!value) errors.push({ path: `$.${key}.${field}`, message: `${key}.${field} is required` });
  };
  if (key === "agent_goal") requireString("goal");
  if (key === "agent_action") requireString("action");
  if (key === "tool_call") {
    requireString("tool");
    if (payload.args !== undefined && !isPlainObject(payload.args)) {
      errors.push({ path: "$.tool_call.args", message: "tool_call.args must be an object" });
    }
  }
  if (key === "payload_load") requireString("manifest_path", ["path"]);
  if (key === "filesystem_read") requireString("path");
  if (key === "filesystem_write") {
    requireString("path");
    if (typeof payload.content !== "string") errors.push({ path: "$.filesystem_write.content", message: "filesystem_write.content is required" });
  }
  if (key === "filesystem_patch") {
    requireString("path");
    if (typeof payload.search !== "string") errors.push({ path: "$.filesystem_patch.search", message: "filesystem_patch.search is required" });
    if (typeof payload.replace !== "string") errors.push({ path: "$.filesystem_patch.replace", message: "filesystem_patch.replace is required" });
  }
  if (key === "filesystem_search") requireString("query");
  if (key === "task_result" && payload.ok !== undefined && typeof payload.ok !== "boolean") {
    errors.push({ path: "$.task_result.ok", message: "task_result.ok must be boolean" });
  }
}

function defaultIdFactory(prefix) {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

function structuredCloneSafe(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringOr(value, fallback) {
  return typeof value === "string" && value ? value : fallback;
}

