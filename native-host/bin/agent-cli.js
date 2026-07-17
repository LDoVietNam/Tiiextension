#!/usr/bin/env node
import { createRuntime } from "../src/runtime.js";
import { orchestratorUp, orchestratorDown, orchestratorStatus } from "../src/orchestrator.js";

const argv = process.argv.slice(2);
const configPath = takeOption(argv, "--config") || process.env.CHATGPT_NATIVE_AGENT_CONFIG;
takeFlag(argv, "--json");
const command = argv.shift();

if (!command || ["-h", "--help", "help"].includes(command)) {
  printHelp();
  process.exitCode = 0;
} else if (command === "up" || command === "down" || command === "status") {
  // Orchestrator commands - no runtime needed
  try {
    let result;
    if (command === "up") {
      const tunnel = takeFlag(argv, "--tunnel") || takeFlag(argv, "-t");
      const namedTunnel = takeFlag(argv, "--named-tunnel");
      const mcp = takeFlag(argv, "--mcp") || takeFlag(argv, "-m");
      result = await orchestratorUp({ tunnel, mcp, namedTunnel });
    } else if (command === "down") {
      result = await orchestratorDown();
    } else {
      result = await orchestratorStatus();
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      error: { code: error.code || "CLI_ERROR", message: error.message, retryable: Boolean(error.retryable) }
    }, null, 2)}\n`);
    process.exitCode = exitCodeFor(error.code);
  }
} else {
  const runtime = await createRuntime({ ...(configPath ? { configPath } : {}) });
  try {
    const result = await execute(runtime, command, argv);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      error: { code: error.code || "CLI_ERROR", message: error.message, retryable: Boolean(error.retryable) }
    }, null, 2)}\n`);
    process.exitCode = exitCodeFor(error.code);
  } finally {
    await runtime.close();
  }
}

async function execute(runtime, commandName, args) {
  if (commandName === "health") return runtime.handle({ type: "runtime.handshake", payload: { protocols: ["cnagent/1"], client: "cli" } });
  if (commandName === "tools") return runtime.handle({ type: "tool.list", payload: {} });
  if (commandName === "workspace") {
    const subcommand = args[0];
    if (!subcommand || subcommand === "list") return runtime.handle({ type: "profiles.active", payload: {} });
    throw cliError(`Unknown workspace command: ${subcommand}`);
  }
  if (commandName === "tool") {
    const tool = args.shift();
    if (!tool) throw cliError("tool name is required");
    const rawArgs = takeOption(args, "--args") || args[0] || "{}";
    return runtime.handle({ type: tool, payload: parseJson(rawArgs), idempotency_key: takeOption(args, "--idempotency-key") });
  }
  if (commandName === "task") {
    const subcommand = args.shift();
    if (subcommand === "run") {
      const goal = args.shift();
      if (!goal) throw cliError("task goal is required");
      return runtime.handle({ type: "task.enqueue", payload: { goal, profile: takeOption(args, "--profile") || undefined } });
    }
    if (subcommand === "status") return runtime.handle({ type: "task.get", payload: { task_id: required(args.shift(), "task id") } });
    if (subcommand === "cancel") return runtime.handle({ type: "task.cancel", payload: { task_id: required(args.shift(), "task id") } });
    if (subcommand === "list") return runtime.handle({ type: "task.list", payload: {} });
    throw cliError(`Unknown task command: ${subcommand}`);
  }
  if (commandName === "events") {
    return runtime.handle({
      type: "task.events",
      payload: {
        task_id: takeOption(args, "--task") || undefined,
        after_cursor: Number(takeOption(args, "--after") || 0)
      }
    });
  }
  if (commandName === "snapshots") {
    if (!args[0] || args[0] === "list") return runtime.handle({ type: "fs.snapshots.list", payload: {} });
    throw cliError(`Unknown snapshots command: ${args[0]}`);
  }
  if (commandName === "rollback") return runtime.handle({ type: "fs.rollback", payload: { id: required(args.shift(), "snapshot id") } });
  if (commandName === "doctor") {
    const [handshake, audit] = await Promise.all([
      runtime.handle({ type: "runtime.handshake", payload: { protocols: ["cnagent/1"], client: "doctor" } }),
      runtime.handle({ type: "audit.verify", payload: {} })
    ]);
    return { ok: true, node: process.version, platform: process.platform, handshake, audit };
  }
  throw cliError(`Unknown command: ${commandName}`);
}

function takeOption(args, name) {
  const index = args.indexOf(name);
  if (index < 0) return null;
  if (index + 1 >= args.length) throw cliError(`${name} requires a value`);
  const [, value] = args.splice(index, 2);
  return value;
}

function takeFlag(args, name) {
  const index = args.indexOf(name);
  if (index < 0) return false;
  args.splice(index, 1);
  return true;
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw cliError(`Invalid --args JSON: ${error.message}`);
  }
}

function required(value, name) {
  if (!value) throw cliError(`${name} is required`);
  return value;
}

function cliError(message) {
  const error = new Error(message);
  error.code = "CLI_USAGE_ERROR";
  return error;
}

function exitCodeFor(code = "") {
  if (code.startsWith("PROTOCOL_") || code === "CLI_USAGE_ERROR") return 2;
  if (code.startsWith("POLICY_") || code.startsWith("WORKSPACE_")) return 3;
  if (code.startsWith("PROVIDER_")) return 4;
  if (code.startsWith("TASK_") && code.includes("CANCEL")) return 6;
  if (code.startsWith("FILESYSTEM_") || code.startsWith("PROCESS_") || code.startsWith("PAYLOAD_")) return 5;
  return 1;
}

function printHelp() {
  process.stdout.write(`Tiiextension CLI v1.3.0

Usage:
  agent up [--tunnel] [--named-tunnel] [--mcp]     Start API, MCP bridge, and tunnel
  agent down                         Stop all orchestrated services
  agent status                       Show orchestrator status
  agent health [--config PATH]
  agent tools [--json]
  agent workspace list
  agent task run "<goal>" [--profile ID]
  agent task status <task_id>
  agent task cancel <task_id>
  agent tool <name> --args '{"path":"."}' [--idempotency-key KEY]
  agent events [--task TASK_ID] [--after CURSOR]
  agent snapshots list
  agent rollback <snapshot_id>
  agent doctor

The CLI never reads or proxies ChatGPT cookies/session tokens.
`);
}
