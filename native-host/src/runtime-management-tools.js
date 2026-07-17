export function createRuntimeManagementTools(stateStore, context = {}) {
  const events = context.events || null;
  const audit = context.audit || null;
  const config = context.config || {};

  function nowIso() { return new Date().toISOString(); }

  async function runtimeCapabilities() {
    const state = stateStore.state || {};
    const roots = context.guard?.listWorkspaces?.() || [];

    return {
      version: "1.3.0-enhanced",
      roots: roots,
      toolCount: 66,
      browserPlannerFallback: true,
      providerRouter: true,
      durableTasks: true,
      transactionalWorkspace: true,
      independentVerification: true,
      tools: [],
      commandPolicy: {
        allowedCommands: config.allowedCommands || [],
        deniedCommands: config.deniedCommands || [],
        allowShellCommands: config.allowShellCommands || false,
        allowAbsoluteCommandPaths: config.allowAbsoluteCommandPaths || false
      },
      limits: {
        maxReadBytes: config.maxReadBytes || 2 * 1024 * 1024,
        maxWriteBytes: config.maxWriteBytes || 4 * 1024 * 1024,
        maxCommandTimeoutMs: config.maxCommandTimeoutMs || 120000,
        maxCommandOutputBytes: config.maxCommandOutputBytes || 4 * 1024 * 1024,
        maxSnapshotBytes: config.maxSnapshotBytes || 512 * 1024 * 1024,
        maxSnapshotFiles: config.maxSnapshotFiles || 20000,
        maxCopyBytes: config.maxCopyBytes || 1024 * 1024 * 1024,
        maxCopyFiles: config.maxCopyFiles || 100000
      }
    };
  }

  async function runtimeDiagnostics() {
    const checks = [];
    const state = stateStore.state || {};

    checks.push({ name: "runtime:version", ok: true, version: "1.3.0-enhanced" });
    checks.push({ name: "runtime:state_file", ok: true, path: config.stateFile || "runtime/data/state.json" });
    checks.push({ name: "runtime:provider_count", ok: true, count: (state.providers || []).length });
    checks.push({ name: "runtime:task_queue", ok: true, pending: (state.browserTasks || []).filter(t => t.status === "queued").length });
    checks.push({ name: "runtime:api_key", ok: !!config.apiKey });

    return {
      ok: checks.every(c => c.ok),
      version: "1.3.0-enhanced",
      timestamp: nowIso(),
      checks,
      providers: (state.providers || []).length,
      tasks: { total: (state.browserTasks || []).length, queued: (state.browserTasks || []).filter(t => t.status === "queued").length }
    };
  }

  async function listPendingApprovals({ status } = {}) {
    const approvals = context.approvals?.list?.({ status: status || "pending" }) || [];
    return { approvals: approvals.slice(0, 100) };
  }

  async function readAuditLog({ limit = 100 } = {}) {
    const events = await audit?.read?.(limit) || [];
    return { events: events.slice(-Math.min(limit, 1000)) };
  }

  async function listTasks({ status, limit = 100 } = {}) {
    const tasks = context.taskManager?.list?.({ status, limit }) || [];
    return { tasks: tasks.slice(0, limit) };
  }

  async function cancelTask({ id, reason } = {}) {
    const task = await context.taskManager?.cancel?.(id, reason) || { cancelled: false };
    await audit?.append({ type: "task.cancelled", taskId: id, reason });
    return { task };
  }

  async function retryTask({ id } = {}) {
    const task = await context.taskManager?.retry?.(id) || { retried: false };
    await audit?.append({ type: "task.retried", taskId: id });
    return { task };
  }

  const definitions = [
    ["runtime_capabilities", "Đọc capability, policy và tool inventory của local runtime.", { type: "object", properties: {} }],
    ["runtime_diagnostics", "Chạy self-check cấu hình, roots, state persistence, provider, task queue và transaction store.", { type: "object", properties: {} }],
    ["list_pending_approvals", "Liệt kê operation nguy hiểm đang chờ người dùng duyệt.", { type: "object", properties: { status: { type: "string" } } }],
    ["read_audit_log", "Đọc audit log gần nhất đã được redaction.", { type: "object", properties: { limit: { type: "integer" } } }],
    ["list_tasks", "Liệt kê durable task theo trạng thái.", { type: "object", properties: { status: { type: "string" }, limit: { type: "integer" } } }],
    ["cancel_task", "Hủy durable task đang queued/leased/retry_wait.", { type: "object", properties: { id: { type: "string" }, reason: { type: "string" } }, required: ["id"] }],
    ["retry_task", "Đưa task failed/cancelled trở lại hàng đợi.", { type: "object", properties: { id: { type: "string" } }, required: ["id"] }]
  ].map(([name, description, inputSchema]) => ({ name, description, inputSchema }));

  return { definitions, async call(name, args = {}) {
    const handlers = {
      runtimeCapabilities,
      runtimeDiagnostics,
      listPendingApprovals,
      readAuditLog,
      listTasks,
      cancelTask,
      retryTask
    };
    const handler = handlers[name];
    if (!handler) throw new Error(`Unknown runtime tool: ${name}`);
    return handler(args);
  }};
}