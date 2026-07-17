import { runtime } from './browser-polyfill.js';
import { sendNative } from './native-client.js';
import { initPairingUI } from './pairing.js';

let elements = {};

const state = {
  activePanel: "agent",
  taskId: null,
  eventCursor: 0,
  roots: [],
  selectedRoot: null,
  selectedPath: null,
  transactionId: null,
  running: false
};

function getElements() {
  return {
    "goal": document.getElementById("goal"),
    "run-goal": document.getElementById("run-goal"),
    "cancel-task": document.getElementById("cancel-task"),
    "task-state": document.getElementById("task-state"),
    "task-summary": document.getElementById("task-summary"),
    "agent-messages": document.getElementById("agent-messages"),
    "workspace-select": document.getElementById("workspace-select"),
    "file-tree": document.getElementById("file-tree"),
    "file-preview": document.getElementById("file-preview"),
    "preview-title": document.getElementById("preview-title"),
    "search-input": document.getElementById("search-input"),
    "search-kind": document.getElementById("search-kind"),
    "search-results": document.getElementById("search-results"),
    "transaction-summary": document.getElementById("transaction-summary"),
    "diff-view": document.getElementById("diff-view"),
    "snapshot-list": document.getElementById("snapshot-list"),
    "task-timeline": document.getElementById("task-timeline"),
    "diagnostic-log": document.getElementById("diagnostic-log"),
    "direct-tool": document.getElementById("direct-tool"),
    "direct-args": document.getElementById("direct-args"),
    "clear-chat": document.getElementById("clear-chat"),
    "model-from-cookie": document.getElementById("model-from-cookie"),
    "model-effort": document.getElementById("model-effort"),
    "cookie-status": document.getElementById("cookie-status"),
    "refresh-model-cookie": document.getElementById("refresh-model-cookie")
  };
}

document.addEventListener("DOMContentLoaded", () => {
  elements = getElements();
  bindEvents();
  initialize().catch(console.error);
});

function bindEvents() {
  // Bind panel navigation buttons
  const panelButtons = getElements();
  for (const button of document.querySelectorAll("[data-panel]")) {
    button.addEventListener("click", () => showPanel(button.dataset.panel));
  }
  
  // Bind other elements after elements is populated
  document.getElementById("refresh-all").addEventListener("click", refreshAll);
  document.getElementById("refresh-tree").addEventListener("click", loadTree);
  document.getElementById("refresh-changes").addEventListener("click", refreshChanges);
  document.getElementById("refresh-activity").addEventListener("click", refreshActivity);
  
  if (elements["run-goal"]) {
    elements["run-goal"].addEventListener("click", runGoal);
  }
  if (elements["cancel-task"]) {
    elements["cancel-task"].addEventListener("click", cancelTask);
  }
  if (elements["clear-chat"]) {
    elements["clear-chat"].addEventListener("click", clearChat);
  }
  document.getElementById("run-search").addEventListener("click", runSearch);
  document.getElementById("create-snapshot").addEventListener("click", createSnapshot);
  document.getElementById("run-direct-tool").addEventListener("click", runDirectTool);
  
  if (elements["refresh-model-cookie"]) {
    elements["refresh-model-cookie"].addEventListener("click", refreshModelFromCookie);
  }
  if (elements["workspace-select"]) {
    elements["workspace-select"].addEventListener("change", () => {
      state.selectedRoot = state.roots.find((root) => root.path === elements["workspace-select"].value) || null;
      loadTree();
    });
  }
  if (elements.goal) {
    elements.goal.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) runGoal();
    });
  }
}

async function initialize() {
  appendDiagnostic("Initializing extension and native runtime...");
  initPairingUI();
  await refreshAll();
  refreshModelFromCookie();
  setInterval(() => {
    refreshConnections().catch(() => {});
    if (state.taskId) refreshActivity().catch(() => {});
  }, 5000);
}

async function refreshAll() {
  await Promise.allSettled([
    refreshConnections(), 
    loadWorkspace(), 
    refreshChanges(), 
    refreshActivity()
  ]);
}

// ===== MODEL FROM COOKIE =====
async function refreshModelFromCookie() {
  const modelEl = elements["model-from-cookie"];
  const effortEl = elements["model-effort"];
  const statusEl = elements["cookie-status"];
  
  if (!modelEl) return;
  
  modelEl.textContent = "Đang kiểm tra...";
  modelEl.className = "model-badge loading";
  effortEl.textContent = "";
  statusEl.textContent = "";
  
  try {
    // Send message to content script to get oai-last-model-config cookie
    const response = await call("chatgpt.extract_model", {});
    
    if (response && response.success && response.model) {
      modelEl.textContent = response.model;
      modelEl.className = "model-badge ready";
      
      effortEl.textContent = response.effort || "standard";
      effortEl.className = `effort-badge ${response.effort || "standard"}`;
      
      statusEl.textContent = "✅ Model đọc từ cookie ChatGPT";
      statusEl.className = "cookie-status-text ok";
      
      appendDiagnostic(`Model extracted: ${response.model} (effort: ${response.effort})`);
    } else {
      modelEl.textContent = "Chưa có model";
      modelEl.className = "model-badge pending";
      statusEl.textContent = "⚠️ Không tìm thấy cookie oai-last-model-config. Hãy mở https://chatgpt.com trước.";
      statusEl.className = "cookie-status-text pending";
    }
  } catch (error) {
    modelEl.textContent = "Lỗi";
    modelEl.className = "model-badge error";
    statusEl.textContent = `❌ ${error.message}`;
    statusEl.className = "cookie-status-text error";
    appendDiagnostic(`Cookie model error: ${error.message}`);
  }
}

// ===== CONNECTION CHECKS =====
async function refreshConnections() {
  await Promise.allSettled([checkCtxBridge(), checkGoBridge(), checkJobBridge()]);
}

function setPill(id, ok, label) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = `status-pill ${ok ? "ok" : "error"}`;
  el.textContent = label;
}

async function checkCtxBridge() {
  try {
    const r = await fetch("http://127.0.0.1:3333/health", { cache: "no-store" });
    setPill("ctx-bridge-status", r.ok, "File tools");
  } catch {
    setPill("ctx-bridge-status", false, "File tools off");
  }
}

async function checkGoBridge() {
  let paired = false;
  try {
    const res = await chrome.storage.local.get("tiSessionPaired");
    paired = Boolean(res.tiSessionPaired);
  } catch { /* storage unavailable */ }
  setPill("go-bridge-status", paired, paired ? "Runtime paired" : "Runtime unpaired");
}

async function checkJobBridge() {
  try {
    const r = await fetch("http://127.0.0.1:5050/health", { cache: "no-store" });
    setPill("job-bridge-status", r.ok, "Job Bridge");
  } catch {
    setPill("job-bridge-status", false, "Job Bridge off");
  }
}

// ===== RUN GOAL =====
const BRIDGE_BASE = 'http://127.0.0.1:5050';

async function runGoal() {
  const goal = elements.goal.value.trim();
  if (!goal || state.running) return;
  setRunning(true);
  appendMessage("goal", goal);
  elements["task-summary"].classList.remove("empty");
  elements["task-summary"].textContent = "Task submitted. Dispatching job to bridge…";

  // Dispatch a job to the OpenBrowser job bridge (:5000). The bridge streams it
  // over SSE -> background.js -> active ChatGPT tab (content-script.js runs it).
  // Payload follows the bridge contract; adjust once the exact schema is final.
  const sessionId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const job = {
    sessionId,
    delivery: "inline",
    message: goal,
    mode: "run",
    source: "sidepanel.run-goal"
  };

  try {
    const resp = await fetch(`${BRIDGE_BASE}/browser/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(job)
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Bridge ${resp.status}${text ? `: ${text}` : ""}`);
    }

    state.taskId = sessionId;
    elements["cancel-task"].disabled = false;
    elements["task-state"].textContent = "Submitted";
    elements["task-summary"].textContent = `Job ${sessionId}\nDispatched to ChatGPT via bridge…`;
    appendMessage("assistant", `Job dispatched to bridge (session ${sessionId}). Watch it run in the ChatGPT tab.`);

    await pollBridgeResponse(sessionId);
  } catch (error) {
    appendMessage("error", `BRIDGE_ERROR: ${error.message}`);
    elements["task-state"].textContent = "Failed";
    elements["task-summary"].textContent = error.message;
    appendDiagnostic(error);
  } finally {
    setRunning(false);
  }
}

// Best-effort poll for the job result posted back by content-script.js.
// Works against the local fallback bridge-server.js; degrades gracefully if
// the running bridge does not expose this GET endpoint (the ChatGPT tab still
// executes the job regardless).
async function pollBridgeResponse(sessionId) {
  for (let i = 0; i < 120; i++) {
    try {
      const resp = await fetch(`${BRIDGE_BASE}/browser/response/${sessionId}`);
      if (resp.ok) {
        const data = await resp.json().catch(() => ({}));
        const text = data?.text ?? data?.result?.text ?? "";
        if (text) {
          elements["task-state"].textContent = "Completed";
          elements["task-summary"].textContent = `Job ${sessionId}\nGoal completed`;
          appendMessage("assistant", text.slice(0, 4000));
          await Promise.allSettled([refreshActivity(), refreshChanges(), loadTree()]);
          return;
        }
      }
    } catch { /* endpoint may not exist on the running bridge; keep waiting */ }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
}

function showPanel(name) {
  state.activePanel = name;
  document.querySelectorAll("[data-panel]").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.panel === name);
  });
  document.querySelectorAll(".panel-view").forEach(view => {
    view.classList.toggle("active", view.dataset.view === name);
  });
}

function setRunning(running) {
  state.running = running;
  elements["run-goal"].disabled = running;
  elements["cancel-task"].disabled = !running;
  elements["run-goal"].textContent = running ? "Running..." : "Run with ChatGPT";
}

function appendMessage(type, content) {
  const messageDiv = document.createElement("div");
  messageDiv.className = `message-card message-${type}`;
  messageDiv.textContent = content;
  elements["agent-messages"].appendChild(messageDiv);
  elements["agent-messages"].scrollTop = elements["agent-messages"].scrollHeight;
}

function appendDiagnostic(message) {
  const timestamp = new Date().toLocaleTimeString();
  elements["diagnostic-log"].textContent += `[${timestamp}] ${message}\n`;
  elements["diagnostic-log"].scrollTop = elements["diagnostic-log"].scrollHeight;
}

async function call(type, payload = {}, options = {}) {
  if (type.startsWith('native.')) {
    const nativeType = type.slice('native.'.length);
    return sendNative(nativeType, payload, options);
  }
  const response = await runtime.sendMessage({ type, payload, ...options });
  if (!response?.ok) throw new Error(response?.error?.message || 'Request failed');
  return response.result;
}

async function nativeCall(type, payload = {}) {
  return sendNative(type, payload);
}

async function clearChat() {
  if (confirm("Are you sure you want to clear the chat history?")) {
    elements["agent-messages"].textContent = "";
    elements["task-summary"].classList.add("empty");
    elements["task-summary"].textContent = "No active task.";
    elements["task-state"].textContent = "Idle";
    elements.goal.value = "";
    appendDiagnostic("Chat history cleared");
  }
}

async function loadWorkspace() {
  try {
    const info = await nativeCall("fs.workspace_info", {});
    state.roots = info.roots || [];
    const select = elements["workspace-select"];
    const previous = select.value;
    select.replaceChildren();
    for (const root of state.roots) {
      const option = document.createElement("option");
      option.value = root.path;
      option.textContent = `${root.name || root.id} ${root.read_only ? "read-only" : "read/write"}`;
      select.append(option);
    }
    state.selectedRoot = state.roots.find((root) => root.path === previous) || state.roots[0] || null;
    if (state.selectedRoot) select.value = state.selectedRoot.path;
    await loadTree();
  } catch (error) {
    elements["file-tree"].textContent = `Workspace unavailable: ${error.message}`;
    appendDiagnostic(error);
  }
}

async function loadTree() {
  if (!state.selectedRoot) return;
  elements["file-tree"].textContent = "Loading tree...";
  try {
    const result = await nativeCall("fs.tree", { path: state.selectedRoot.path, depth: 5, maxEntries: 5000 });
    elements["file-tree"].replaceChildren(renderTree(result.tree || [], state.selectedRoot.path));
    if (result.truncated) appendDiagnostic("File tree was truncated by the configured entry limit.");
  } catch (error) {
    elements["file-tree"].textContent = error.message;
    appendDiagnostic(error);
  }
}

function renderTree(items, parentPath) {
  const fragment = document.createDocumentFragment();
  for (const item of items) {
    const node = document.createElement("div");
    node.className = "file-item";
    node.dataset.type = item.type;
    node.dataset.path = joinPath(parentPath, item.name);

    const icon = document.createElement("span");
    icon.className = "file-icon";
    icon.textContent = item.type === "directory" ? "📁" : item.type === "link" ? "🔗" : getFileIcon(item.name);
    node.appendChild(icon);

    const name = document.createElement("span");
    name.className = "file-name";
    name.textContent = item.name;
    node.appendChild(name);

    if (item.type === "file") {
      const size = document.createElement("span");
      size.className = "file-size";
      size.textContent = formatFileSize(item.size || 0);
      node.appendChild(size);

      node.addEventListener("click", () => previewFile(node.dataset.path));
    } else if (item.type === "directory") {
      const children = document.createElement("div");
      children.className = "file-children";
      if (item.children?.length) {
        children.append(renderTree(item.children, node.dataset.path));
      }
      node.appendChild(children);

      node.addEventListener("click", (e) => {
        e.stopPropagation();
        const children = node.querySelector(".file-children");
        if (children) {
          children.style.display = children.style.display === "none" ? "block" : "none";
          node.querySelector(".file-icon").textContent =
            children.style.display === "none" ? "📁" : "📂";
        }
      });

      const childrenEl = node.querySelector(".file-children");
      if (childrenEl) childrenEl.style.display = "none";
    }

    fragment.appendChild(node);
  }
  return fragment;
}

function getFileIcon(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  switch (ext) {
    case 'js': case 'ts': return '📝';
    case 'html': case 'htm': return '🌐';
    case 'css': return '🎨';
    case 'json': return '📋';
    case 'md': case 'markdown': return '📄';
    case 'png': case 'jpg': case 'jpeg': case 'gif': case 'svg': return '🖼️';
    case 'pdf': return '📕';
    case 'zip': case 'rar': case '7z': return '📦';
    default: return '📄';
  }
}

function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${sizes[i]} ${bytes / Math.pow(k, i) > 1024 ? Math.round(bytes / Math.pow(k, i)) : bytes}`;
}

function joinPath(...parts) {
  return parts.join('/').replace(/\/+/g, '/');
}

async function previewFile(path) {
  try {
    const result = await nativeCall("fs.read", { path, maxBytes: 1024 * 1024 });
    const preview = document.querySelector("#file-preview");
    const title = document.querySelector("#preview-title");
    if (preview) {
      preview.textContent = result.content || result;
      preview.className = "file-preview-content";
    }
    if (title) title.textContent = path;
  } catch (error) {
    appendDiagnostic(`Preview failed: ${error.message}`);
  }
}

async function refreshActivity() {
  const list = elements["task-timeline"];
  if (!list) return;
  try {
    const result = await nativeCall("task.list", { limit: 50 });
    list.replaceChildren();
    for (const task of result.tasks || []) {
      const item = document.createElement("div");
      item.className = "activity-item";
      item.textContent = `${task.task_id || task.id}: ${task.status || 'running'}`;
      list.appendChild(item);
    }
  } catch (error) {
    appendDiagnostic(`refreshActivity failed: ${error.message}`);
  }
}

async function refreshChanges() {
  const diffView = document.getElementById("diff-view");
  if (!diffView) return;
  try {
    const result = await nativeCall("git.status", { path: state.selectedRoot?.path || "." });
    diffView.textContent = JSON.stringify(result, null, 2);
  } catch (error) {
    appendDiagnostic(`refreshChanges failed: ${error.message}`);
  }
}

async function runSearch() {
  const input = elements["search-input"];
  const kind = elements["search-kind"];
  const results = elements["search-results"];
  if (!input || !results) return;

  const query = input.value.trim();
  if (!query) return;

  results.textContent = "Searching...";
  try {
    const tool = kind?.value === "glob" ? "fs.search_glob" : "fs.search_text";
    const result = await nativeCall(tool, {
      path: state.selectedRoot?.path || ".",
      [kind?.value === "glob" ? "pattern" : "query"]: query
    });
    results.textContent = JSON.stringify(result, null, 2);
  } catch (error) {
    results.textContent = `Search failed: ${error.message}`;
    appendDiagnostic(error);
  }
}

async function createSnapshot() {
  if (!state.selectedRoot) {
    appendDiagnostic("No workspace selected");
    return;
  }
  try {
    const result = await nativeCall("snapshot.create", { path: state.selectedRoot.path });
    appendDiagnostic(`Snapshot created: ${result.snapshot_id}`);
    await loadTree();
  } catch (error) {
    appendDiagnostic(`createSnapshot failed: ${error.message}`);
  }
}

async function runDirectTool() {
  const tool = elements["direct-tool"]?.value;
  const args = elements["direct-args"]?.value;
  if (!tool) {
    appendDiagnostic("Tool name required");
    return;
  }
  try {
    const parsedArgs = args ? JSON.parse(args) : {};
    const result = await call(tool, parsedArgs);
    appendDiagnostic(`Tool result: ${JSON.stringify(result)}`);
  } catch (error) {
    appendDiagnostic(`runDirectTool failed: ${error.message}`);
  }
}

function formatExecution(item) {
  const status = item.ok ? "✓" : "✗";
  const tool = item.tool || item.type;
  const result = item.result ? JSON.stringify(item.result).slice(0, 100) : "";
  return `${status} ${tool}: ${result}`;
}