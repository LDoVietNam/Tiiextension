import crypto from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";

export function createProcessTools(context) {
  const guard = typeof context?.resolveInside === "function" ? context : context?.guard;
  const policy = typeof context?.resolveInside === "function" ? null : context?.policy || null;
  const events = typeof context?.resolveInside === "function" ? null : context?.events || null;
  if (!guard) throw new TypeError("workspace guard is required");
  const running = new Map();

  async function run({
    command,
    args = [],
    cwd = ".",
    timeoutMs,
    timeout_ms,
    env = {},
    maxOutputBytes,
    max_output_bytes,
    taskId,
    task_id,
    processId
  }) {
    if (typeof command !== "string" || !command) throw processError("PROCESS_COMMAND_REQUIRED", "command is required");
    if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string")) throw processError("PROCESS_INVALID_ARGUMENTS", "args must be a string array");
    const safeCwd = guard.resolveInside(cwd).path;
    if (policy && !policy.isCommandAllowed(command)) throw processError("PROCESS_COMMAND_DENIED", `Command is not allowlisted: ${command}`);
    const limits = policy?.limitsFor("process.run") || {};
    const effectiveTimeout = clamp(timeoutMs || timeout_ms || limits.default_timeout_ms || 30000, 1, 24 * 60 * 60 * 1000);
    const outputLimit = clamp(maxOutputBytes || max_output_bytes || limits.max_output_bytes || 1024 * 1024, 1, 64 * 1024 * 1024);
    const id = processId || `proc_${crypto.randomUUID().replaceAll("-", "")}`;
    const ownerTask = taskId || task_id || null;
    await emit("process.started", { process_id: id, command: path.basename(command), cwd: safeCwd }, ownerTask);

    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: safeCwd,
        shell: false,
        windowsHide: true,
        env: buildEnvironment(env),
        stdio: ["ignore", "pipe", "pipe"]
      });
      const started = Date.now();
      const record = { id, child, command, cwd: safeCwd, task_id: ownerTask, started_at: new Date(started).toISOString() };
      running.set(id, record);
      let stdout = "";
      let stderr = "";
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let truncated = false;
      let timedOut = false;
      let cancelled = false;
      let settled = false;

      child.stdout.on("data", (chunk) => {
        const appended = appendLimited(stdout, stdoutBytes, chunk, outputLimit);
        stdout = appended.text;
        stdoutBytes = appended.bytes;
        truncated ||= appended.truncated;
        emit("process.stdout", { process_id: id, chunk: appended.added }, ownerTask).catch(() => {});
      });
      child.stderr.on("data", (chunk) => {
        const appended = appendLimited(stderr, stderrBytes, chunk, outputLimit);
        stderr = appended.text;
        stderrBytes = appended.bytes;
        truncated ||= appended.truncated;
        emit("process.stderr", { process_id: id, chunk: appended.added }, ownerTask).catch(() => {});
      });

      const timer = setTimeout(() => {
        timedOut = true;
        terminateTree(child).catch(() => {});
      }, effectiveTimeout);

      record.cancel = () => {
        cancelled = true;
        return terminateTree(child);
      };

      child.on("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        running.delete(id);
        error.code = error.code || "PROCESS_SPAWN_FAILED";
        reject(error);
      });

      child.on("close", async (code, signal) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        running.delete(id);
        const result = {
          process_id: id,
          code,
          signal,
          stdout,
          stderr,
          stdout_bytes: stdoutBytes,
          stderr_bytes: stderrBytes,
          truncated,
          timed_out: timedOut,
          cancelled,
          reason: timedOut ? "timeout" : cancelled ? "cancelled" : code === 0 ? "completed" : "exit_nonzero",
          duration_ms: Date.now() - started
        };
        await emit("process.completed", { process_id: id, code, reason: result.reason }, ownerTask);
        resolve(result);
      });
    });
  }

  async function cancel({ id, processId, process_id } = {}) {
    const key = id || processId || process_id;
    const record = running.get(key);
    if (!record) return { process_id: key, cancelled: false, reason: "not_found" };
    await record.cancel();
    return { process_id: key, cancelled: true };
  }

  function list() {
    return {
      processes: [...running.values()].map(({ child, cancel: cancelFn, ...record }) => ({ ...record, pid: child.pid }))
    };
  }

  async function close() {
    await Promise.allSettled([...running.values()].map((record) => record.cancel()));
  }

  async function emit(type, data, taskId) {
    if (events) await events.emit(type, data, { taskId });
  }

  return { run, cancel, list, close };
}

function appendLimited(current, bytes, chunk, limit) {
  const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  const remaining = Math.max(0, limit - bytes);
  const included = buffer.subarray(0, remaining);
  return {
    text: current + included.toString("utf8"),
    added: included.toString("utf8"),
    bytes: bytes + buffer.length,
    truncated: buffer.length > remaining
  };
}

function buildEnvironment(overrides) {
  const baseline = {
    PATH: process.env.PATH || "",
    SystemRoot: process.env.SystemRoot || "",
    WINDIR: process.env.WINDIR || "",
    TEMP: process.env.TEMP || process.env.TMP || "",
    TMP: process.env.TMP || process.env.TEMP || "",
    HOME: process.env.HOME || "",
    USERPROFILE: process.env.USERPROFILE || "",
    CI: process.env.CI || ""
  };
  const safeOverrides = Object.fromEntries(Object.entries(overrides || {})
    .filter(([key, value]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && !/NODE_OPTIONS|ELECTRON_RUN_AS_NODE/i.test(key) && typeof value === "string"));
  return { ...baseline, ...safeOverrides };
}

async function terminateTree(child) {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === "win32") {
    await new Promise((resolve) => {
      const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, shell: false });
      killer.on("error", () => resolve());
      killer.on("close", () => resolve());
    });
    return;
  }
  child.kill("SIGTERM");
  const timer = setTimeout(() => {
    if (child.exitCode === null) child.kill("SIGKILL");
  }, 250);
  timer.unref?.();
}

function processError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.retryable = false;
  return error;
}

function clamp(value, min, max) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(min, Math.min(max, Math.trunc(numeric))) : min;
}
