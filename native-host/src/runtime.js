import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createArtifactStore } from "./artifact-store.js";
import { createAuditStore } from "./audit-store.js";
import { loadRuntimeConfig } from "./config-loader.js";
import { createDurableStore } from "./durable-store.js";
import { createEventBus } from "./event-bus.js";
import { createFilesystemTools } from "./filesystems.js";
import { createGitTools } from "./git-tools.js";
import { createPayloadLoader } from "./payload-loader.js";
import { createPolicyEngine } from "./policy-engine.js";
import { createProcessTools } from "./process-tools.js";
import { createProjectTools } from "./project-tools.js";
import { createProviderRoutingTools } from "./provider-routing-tools.js";
import { createRuntimeManagementTools } from "./runtime-management-tools.js";
import { createContextTools } from "./context/context-tools.js";
import { createTaskEngine } from "./task-engine.js";
import { createTransactionManager } from "./transaction-manager.js";
import { createVerificationTools } from "./verification-tools.js";
import { createWorkspaceGuard } from "./workspace-guard.js";
import { TOOL_MANIFEST, compactToolManifest, describeTool } from "./tool-manifest.js";
import { orchestratorUp, orchestratorDown, orchestratorStatus } from "./orchestrator.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONFIG = path.resolve(__dirname, "../config/default.workspaces.json");
const HOST_ID = "com.chatgpt_native_agent.host";
const HOST_VERSION = "1.3.0";
const PROTOCOL = "cnagent/1";

export async function createRuntime(options = {}) {
  const configPath = options.configPath || process.env.CHATGPT_NATIVE_AGENT_CONFIG || DEFAULT_CONFIG;
  const { config, activeProfile, baseDir } = await loadRuntimeConfig(configPath);
  await fs.mkdir(config.data_dir, { recursive: true });
  const guard = createWorkspaceGuard(activeProfile.roots, baseDir);
  const policy = createPolicyEngine({ config, profile: activeProfile });
  const store = createDurableStore({ filePath: options.storePath || path.join(config.data_dir, "runtime-store.json") });
  await store.init();
  const events = createEventBus({ store, maxEvents: options.maxEvents || 10000 });
  const tasks = createTaskEngine({ store, events, idFactory: options.idFactory });
  const transactions = createTransactionManager({ guard, store, events, dataDir: config.data_dir, idFactory: options.idFactory });
  const audit = createAuditStore({ filePath: config.audit.path, scrub: policy.scrub });
  const approvals = options?.approvals || null;
  const processTools = createProcessTools({ guard, policy, events });
  const projectTools = createProjectTools(guard, processTools);
  const gitTools = createGitTools(guard, { events, audit });
  const verificationTools = createVerificationTools(guard, { events, audit });
  const providerRoutingTools = createProviderRoutingTools(store, { events, audit, config });
  const runtimeManagementTools = createRuntimeManagementTools(store, { events, audit, config, guard, approvals, taskManager: tasks });
  const trustedKeys = options.trustedKeys || await loadTrustedKeys(config, baseDir);
  const payloadLoader = createPayloadLoader({ mode: config.mode, guard, policy, processTools, trustedKeys });
  const fsTools = createFilesystemTools(guard, {
    baseDir,
    dataDir: config.data_dir,
    transactions,
    policy,
    events,
    changeLogPath: path.join(config.data_dir, "filesystem-changes.jsonl")
  });
  const contextTools = createContextTools({ guard, config, events });
  const artifacts = createArtifactStore({ dataDir: config.data_dir, store, maxInlineBytes: options.maxInlineBytes || 768 * 1024 });
  const sessionNonce = randomId("session");
  let closed = false;

  async function handle(message) {
    if (closed) throw runtimeError("NATIVE_RUNTIME_CLOSED", "Runtime is closed");
    const type = message?.type;
    const payload = message?.payload || {};
    if (typeof type !== "string" || !type) throw runtimeError("PROTOCOL_VALIDATION_ERROR", "message.type is required");
    const taskId = message.task_id || payload.task_id || null;
    const callId = message.call_id || payload.call_id || null;
    const idempotencyKey = message.idempotency_key || payload.idempotency_key || null;
    const started = Date.now();
    await audit.append({ direction: "in", component: "runtime", action: type, task_id: taskId, call_id: callId, payload });

    try {
      let callRecord = null;
      if (isToolCall(type) && (callId || idempotencyKey)) {
        callRecord = await tasks.recordCall({ taskId, callId: callId || undefined, tool: type, args: payload, idempotencyKey });
        if (callRecord.duplicate) {
          await audit.append({ direction: "out", component: "runtime", action: type, task_id: taskId, call_id: callRecord.call.call_id, result: "deduplicated" });
          return callRecord.result;
        }
      }

      authorize(type, payload);
      const rawResult = await dispatch(type, payload);
      const result = shouldExternalize(type)
        ? await artifacts.maybeExternalize(rawResult, { taskId, callId: callRecord?.call.call_id || callId })
        : rawResult;
      if (callRecord) await tasks.completeCall(callRecord.call.call_id, result, { ok: true });
      await audit.append({
        direction: "out",
        component: componentFor(type),
        action: type,
        task_id: taskId,
        call_id: callRecord?.call.call_id || callId,
        result,
        duration_ms: Date.now() - started
      });
      return result;
    } catch (caught) {
      const error = normalizeRuntimeError(caught);
      await audit.append({
        direction: "out",
        component: componentFor(type),
        action: type,
        task_id: taskId,
        call_id: callId,
        decision: error.code.startsWith("POLICY_") || error.code.startsWith("WORKSPACE_") ? "denied" : "failed",
        error: { code: error.code, message: error.message, retryable: error.retryable },
        duration_ms: Date.now() - started
      });
      throw error;
    }
  }

  async function dispatch(type, payload) {
    if (type === "runtime.handshake") return handshake(payload);
    if (type === "runtime.ping" || type === "runtime.status") return { pong: true, ...handshake(payload) };
    if (type === "runtime.log") return { logged: true };
    if (type === "tool.list") return { tools: compactToolManifest() };
    if (type === "tool.manifest") {
      const offset = Math.max(0, Number(payload.offset) || 0);
      const limit = Math.max(1, Math.min(Number(payload.limit) || TOOL_MANIFEST.length, 500));
      const filtered = payload.prefix ? TOOL_MANIFEST.filter((tool) => tool.name.startsWith(payload.prefix)) : TOOL_MANIFEST;
      return { tools: filtered.slice(offset, offset + limit), total: filtered.length, next_offset: offset + limit < filtered.length ? offset + limit : null };
    }
    if (type === "tool.describe") {
      const tool = describeTool(payload.name);
      if (!tool) throw runtimeError("NATIVE_TOOL_NOT_FOUND", `Tool not found: ${payload.name}`);
      return tool;
    }
    if (type === "tool.capabilities") return { profile: activeProfile.id, capabilities: activeProfile.capabilities, limits: { filesystem: activeProfile.filesystem, process: activeProfile.process } };
    if (type === "profiles.list") return { active_profile: activeProfile.id, profiles: config.profiles.map(publicProfile) };
    if (type === "profiles.active") return { active_profile: activeProfile.id, profile: publicProfile(activeProfile), workspaces: guard.listWorkspaces() };
    if (type === "task.enqueue" || type === "task.create") return tasks.enqueue(payload);
    if (type === "task.get") return tasks.get(payload.task_id || payload.id);
    if (type === "task.list") return { tasks: await tasks.list(payload) };
    if (type === "task.transition") return tasks.transition(payload.task_id || payload.id, payload.status, payload.patch || {});
    if (type === "task.cancel") return tasks.cancel(payload.task_id || payload.id);
    if (type === "task.events") return events.list({ afterCursor: payload.after_cursor || 0, taskId: payload.task_id, types: payload.types, limit: payload.limit });
    if (type === "audit.list") return audit.list(payload);
    if (type === "audit.verify") return audit.verify();
    if (type === "artifact.get") return publicArtifact(await artifacts.get(payload.id || payload.artifact_id));
    if (type === "artifact.read") {
      const item = await artifacts.read(payload.id || payload.artifact_id);
      return { metadata: item.metadata, encoding: "base64", content: item.data.toString("base64") };
    }
    if (type?.startsWith("fs.")) return fsTools.handle(type, payload);
    if (type?.startsWith("project.")) return projectTools.handle(type, payload);
    if (type?.startsWith("git.")) {
      // Map git.status -> git_status, git.diff -> git_diff
      const nativeType = type.replace('git.', 'git_');
      return gitTools.call(nativeType, payload);
    }
    if (type?.startsWith("verify.")) return verificationTools.call(type, payload);
    if (type?.startsWith("route.")) return providerRoutingTools.call(type, payload);
    if (type?.startsWith("runtime.")) return runtimeManagementTools.call(type, payload);
    if (type === "payload.list") return payloadLoader.list(payload);
    if (type === "payload.load") return payloadLoader.load(payload);
    if (type === "payload.unload") return payloadLoader.unload(payload);
    if (type === "payload.reload") return payloadLoader.reload(payload);
    if (type === "payload.validate") return payloadLoader.validate(payload);
    if (type === "payload.call") return payloadLoader.call(payload);
    if (type === "process.run") return processTools.run(payload);
    if (type === "process.cancel") return processTools.cancel(payload);
    if (type === "process.list") return processTools.list(payload);
    if (type === "orchestrator.up") return orchestratorUp();
    if (type === "orchestrator.down") return orchestratorDown();
    if (type === "orchestrator.status") return orchestratorStatus();
    
    // Context tools
    if (type?.startsWith("workspace.")) return contextTools.handle(type, payload);
    if (type?.startsWith("repo.")) return contextTools.handle(type, payload);
    if (type?.startsWith("revision.")) return contextTools.handle(type, payload);
    
    throw runtimeError("NATIVE_TOOL_NOT_FOUND", `Unknown native tool: ${type}`);
  }

  function handshake(payload = {}) {
    const protocols = Array.isArray(payload.protocols) ? payload.protocols : [PROTOCOL];
    if (!protocols.includes(PROTOCOL)) throw runtimeError("PROTOCOL_UNSUPPORTED", "No compatible protocol was offered");
    return {
      host_id: HOST_ID,
      host_version: HOST_VERSION,
      protocol: PROTOCOL,
      capabilities: [...activeProfile.capabilities],
      limits: { filesystem: activeProfile.filesystem, process: activeProfile.process, native_message_bytes: 768 * 1024 },
      active_profile: activeProfile.id,
      workspaces: guard.listWorkspaces(),
      session_nonce: sessionNonce,
      mode: config.mode
    };
  }

  function authorize(type, payload) {
    if (!isToolCall(type)) return;
    const context = rootContext(type, payload);
    const decision = policy.authorizeTool(type, payload, context);
    if (!decision.allowed) throw runtimeError("POLICY_DENIED", decision.reason);
  }

  function rootContext(type, payload) {
    try {
      if (type.startsWith("fs.") && payload.path) return { root: guard.resolveInside(payload.path).root };
      if (type.startsWith("project.")) return { root: guard.resolveInside(payload.path || ".").root };
      if (type === "process.run") return { root: guard.resolveInside(payload.cwd || ".").root };
      if (type.startsWith("payload.") && (payload.path || payload.manifest_path)) return { root: guard.resolveInside(payload.path || payload.manifest_path).root };
    } catch (error) {
      throw normalizeRuntimeError(error);
    }
    return {};
  }

  async function close() {
    if (closed) return;
    closed = true;
    await Promise.allSettled([payloadLoader.close(), processTools.close(), fsTools.close()]);
  }

  if (options.recover === true) await tasks.recover();

  return { handle, close, guard, policy, store, tasks, events, transactions, audit, artifacts, config, activeProfile };
}

function isToolCall(type) {
  return type.startsWith("fs.") || type.startsWith("project.") || type.startsWith("payload.") || type.startsWith("process.");
}

function shouldExternalize(type) {
  return !type.startsWith("artifact.") && !type.startsWith("runtime.") && type !== "tool.manifest";
}

function componentFor(type) {
  return type.split(".", 1)[0] || "runtime";
}

function publicProfile(profile) {
  return {
    id: profile.id,
    roots: profile.roots,
    payload_roots: profile.payload_roots,
    capabilities: profile.capabilities,
    process: profile.process,
    filesystem: profile.filesystem
  };
}

function publicArtifact(metadata) {
  const { file_path, ...safe } = metadata;
  return safe;
}

async function loadTrustedKeys(config, baseDir) {
  const configured = config.trusted_publishers || config.trustedPublishers;
  if (configured && typeof configured === "object" && !Array.isArray(configured)) return configured;
  const filePath = path.resolve(baseDir, config.trusted_publishers_file || "./trusted-publishers.json");
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, "utf8"));
    return parsed.keys || parsed;
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

function normalizeRuntimeError(caught) {
  if (caught?.code && typeof caught.code === "string") {
    caught.retryable = Boolean(caught.retryable);
    return caught;
  }
  const error = new Error(caught?.message || String(caught));
  error.code = inferErrorCode(error.message);
  error.retryable = false;
  return error;
}

function inferErrorCode(message) {
  if (/outside configured workspaces/i.test(message)) return "WORKSPACE_OUTSIDE_ROOT";
  if (/not found/i.test(message)) return "NATIVE_NOT_FOUND";
  return "NATIVE_INTERNAL_ERROR";
}

function runtimeError(code, message, details) {
  const error = new Error(message);
  error.code = code;
  error.retryable = false;
  if (details !== undefined) error.details = details;
  return error;
}

function randomId(prefix) {
  return `${prefix}_${globalThis.crypto.randomUUID().replaceAll("-", "")}`;
}
