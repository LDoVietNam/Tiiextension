import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFileSync, existsSync } from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ProjectRoot = path.resolve(__dirname, "../..");
const StateFile = path.join(ProjectRoot, "runtime/orchestrator-state.json");

function isPidRunning(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return false;
  }
}

export function orchestratorUp(options = {}) {
  return new Promise((resolve, reject) => {
    const { tunnel = false, mcp = false } = options;
    const psScript = path.join(ProjectRoot, "scripts/tiiextension-up.ps1");
    const args = ["-ExecutionPolicy", "Bypass", "-File", psScript, "-NoWait"];
    if (tunnel) args.push("-Tunnel");
    if (mcp) args.push("-Mcp");

    const child = spawn("powershell.exe", args, {
      cwd: ProjectRoot,
      detached: true,
      stdio: "ignore",
      env: {
        ...process.env,
        TIIEXTENSION_NODE_EXE: process.execPath
      }
    });
    child.unref();

    // Wait a few seconds for services to initialize, then return status
    setTimeout(() => {
      resolve(orchestratorStatus());
    }, 4000);
  });
}

export function orchestratorDown() {
  return new Promise((resolve, reject) => {
    const psScript = path.join(ProjectRoot, "scripts/tiiextension-down.ps1");
    const args = ["-ExecutionPolicy", "Bypass", "-File", psScript];

    const child = spawn("powershell.exe", args, {
      cwd: ProjectRoot,
      stdio: "inherit",
      env: {
        ...process.env,
        TIIEXTENSION_NODE_EXE: process.execPath
      }
    });

    child.on("error", (err) => {
      reject(err);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve({ ok: true, message: "Tiiextension services stopped successfully." });
      } else {
        reject(new Error(`Orchestrator down script exited with code ${code}`));
      }
    });
  });
}

export function orchestratorStatus() {
  if (!existsSync(StateFile)) {
    return {
      status: "down",
      api: "stopped",
      mcp: "stopped",
      tunnel: "stopped"
    };
  }

  try {
    const state = JSON.parse(readFileSync(StateFile, "utf8"));
    const apiRunning = isPidRunning(state.api_pid);
    const mcpRunning = state.mcp_pid ? isPidRunning(state.mcp_pid) : false;
    const tunnelRunning = state.tunnel_pid ? isPidRunning(state.tunnel_pid) : false;

    return {
      status: apiRunning ? "up" : "down",
      api: apiRunning ? `running (PID: ${state.api_pid})` : "stopped",
      mcp: state.mcp_pid ? (mcpRunning ? `running (PID: ${state.mcp_pid})` : "stopped") : "disabled",
      tunnel: state.tunnel_pid ? (tunnelRunning ? `running (PID: ${state.tunnel_pid})` : "stopped") : "disabled",
      api_url: state.api_url || null,
      tunnel_url: state.tunnel_url || null,
      started_at: state.started_at || null
    };
  } catch (e) {
    return {
      status: "error",
      error: e.message
    };
  }
}