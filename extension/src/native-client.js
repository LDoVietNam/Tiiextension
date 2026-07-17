// native-client.js - Extension/local-runtime bridge with service-worker WS ownership

import { runtime } from "./browser-polyfill.js";
import { analyzeProviderSession, analyzeSessionSnapshot } from "./session-intelligence.js";
import {
  executeBrowserProviderRequest,
  getBrowserProviderStatuses,
  listBrowserProviders,
} from "./browser-provider-bridge.js";

const WS_URL = "ws://127.0.0.1:1840/v1/extension";
const NATIVE_HOST_NAME = "com.chatgpt_native_agent.host";
const DEFAULT_TIMEOUT_MS = 180_000;
const IS_SERVICE_WORKER = typeof ServiceWorkerGlobalScope !== "undefined"
  && globalThis instanceof ServiceWorkerGlobalScope;

let socket = null;
let reconnectTimer = null;
let bootstrapPromise = null;
let authorized = false;
const pendingRequests = new Map();
const statusListeners = new Set();
const connectionWaiters = new Set();

let status = {
  connected: false,
  host: "ti-runtime-bridge",
  protocol: "ti/1",
  hostVersion: "1.3.0",
  capabilities: [
    "workspace.files",
    "workspace.patch",
    "terminal.process",
    "git",
    "artifacts",
    "agent.tasks",
  ],
  activeProfile: "default",
  mode: "local",
};

if (IS_SERVICE_WORKER) {
  connectWs();
  setupPairingListener();
}

function connectWs(force = false) {
  if (!IS_SERVICE_WORKER) return;
  if (!force && socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  socket = new WebSocket(WS_URL);
  socket.onopen = () => sendHandshake();
  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.method) {
        handleIncomingRequest(data);
      } else if (data.id !== undefined) {
        const entry = pendingRequests.get(data.id);
        if (entry) {
          pendingRequests.delete(data.id);
          clearTimeout(entry.timer);
          entry.resolve(data);
        }
      }
    } catch (error) {
      console.error("Failed to parse websocket message:", error);
    }
  };
  socket.onclose = () => {
    cleanup();
    scheduleReconnect();
  };
  socket.onerror = () => {
    // onclose will handle retries; keep logging small to avoid console spam.
  };
}

function cleanup() {
  socket = null;
  authorized = false;
  status.connected = false;
  notifyStatus();

  for (const [id, entry] of pendingRequests) {
    clearTimeout(entry.timer);
    entry.resolve({ error: { code: -32099, message: "Connection closed" } });
    pendingRequests.delete(id);
  }
}

function scheduleReconnect() {
  if (!IS_SERVICE_WORKER) return;
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    connectNative().catch(() => {});
  }, 5000);
}

function sendHandshake() {
  const message = {
    jsonrpc: "2.0",
    method: "runtime.hello",
    params: {
      extensionId: chrome.runtime.id,
      version: chrome.runtime.getManifest().version,
      protocol: "ti-provider/1",
    },
    id: `handshake_${Date.now()}`,
  };

  sendJsonRpc(message).then((response) => {
    if (!response.result) throw new Error(response.error?.message || "Handshake rejected");
    authorized = true;
    status = {
      ...status,
      connected: true,
      protocol: response.result.protocol || "ti-provider/1",
      hostVersion: response.result.runtimeVersion || status.hostVersion,
      capabilities: Array.isArray(response.result.capabilities) ? response.result.capabilities : status.capabilities,
    };
    resolveConnectionWaiters();
    notifyStatus();
  }).catch(async (error) => {
    cleanup();
    rejectConnectionWaiters(error);
    try {
      await maybeBootstrapLocalBridge();
    } catch {
      // Native host bootstrap is best-effort; the reconnect alarm keeps trying.
    }
  });
}

function sendJsonRpc(message, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return Promise.reject(new Error("WebSocket not connected"));
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(message.id);
      resolve({ error: { code: -32098, message: "Request timed out" } });
    }, clampTimeout(timeoutMs));
    pendingRequests.set(message.id, { resolve, timer });
    socket.send(JSON.stringify(message));
  });
}

export async function sendNative(type, payload = {}, options = {}) {
  if (!IS_SERVICE_WORKER) {
    return proxyToBackground(type, payload, options);
  }

  if (type === "connect") return connectNative();
  if (type === "status") return getNativeStatus();
  if (type === "orchestrator.up") return { ok: true, result: { started: true, mode: "native-messaging", message: "Use CLI: node native-host/bin/agent-cli.js up" } };
  if (type === "orchestrator.down") return { ok: true, result: { stopped: true } };
  if (type === "orchestrator.status") return { ok: true, result: { connected: status.connected, hostVersion: status.hostVersion } };

  const reqId = `native_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  let method = type;
  if (type === "codexRuntime/hello") method = "runtime.hello";
  else if (type === "codexRuntime/ensure") method = "runtime.ensure";
  else if (type === "codexRuntime/restart") method = "runtime.restart";
  else if (type === "codexRuntime/openLocalFile") method = "workspace.file.open";
  else if (type === "codexRuntime/tabContextAsset/create") method = "asset.create";
  else if (type === "codexRuntime/tabContextAsset/appendChunk") method = "asset.append";
  else if (type === "codexRuntime/tabContextAsset/finish") method = "asset.commit";

  const response = await sendJsonRpc({
    jsonrpc: "2.0",
    method,
    params: payload,
    id: reqId,
  }, { timeoutMs: options.timeoutMs || payload.timeoutMs });

  if (response.error) {
    const error = new Error(response.error.message);
    error.code = response.error.code;
    throw error;
  }
  return response.result;
}

async function proxyToBackground(type, payload = {}, options = {}) {
  const response = await runtime.sendMessage({ type: `native.${type}`, payload, ...options });
  if (!response?.ok) {
    const error = new Error(response?.error?.message || "Native request failed");
    error.code = response?.error?.code;
    error.retryable = Boolean(response?.error?.retryable);
    throw error;
  }
  return response.result;
}

async function handleIncomingRequest(request) {
  const { id, method, params = {} } = request;
  let result;
  let error = null;

  try {
    if (method === "browser.session.get" || method === "browser.session.analyze") {
      result = await analyzeBrowserSession(params);
    } else if (method === "browser.context.capture") {
      result = await captureBrowserContext(params);
    } else if (method === "browser.action.execute") {
      result = await executeBrowserAction(params);
    } else if (method === "provider.list") {
      result = listBrowserProviders();
    } else if (method === "provider.status") {
      result = await getBrowserProviderStatuses();
    } else if (method === "provider.request") {
      result = await executeBrowserProviderRequest(params);
    } else {
      throw { code: -32601, message: `Method not found: ${method}` };
    }
  } catch (caught) {
    error = { code: caught.code || -32000, message: caught.message || String(caught) };
  }

  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(error
      ? { jsonrpc: "2.0", id, error }
      : { jsonrpc: "2.0", id, result }));
  }
}

function setupPairingListener() {
  // ws.pair is owned by ws-agent-bridge.js (Go runtime bridge on :9000).
  // This client targets the native-host API on :1840 and must NOT respond to
  // ws.pair, or it would short-circuit the async :9000 pairing handshake.
}

async function analyzeBrowserSession(params = {}) {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = params.tabId ? await chrome.tabs.get(params.tabId) : tabs[0];
  if (!tab?.url || !/^https?:/i.test(tab.url)) {
    throw Object.assign(new Error("An active HTTP(S) provider tab is required"), { code: "PROVIDER_TAB_REQUIRED" });
  }

  let cookies = [];
  try {
    cookies = await chrome.cookies.getAll({ url: tab.url });
  } catch (error) {
    console.warn("Provider-scoped cookie metadata unavailable:", error.message);
  }

  let localStorageData = {};
  let sessionStorageData = {};
  try {
    if (tab.id) {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => ({ localStorage: { ...localStorage }, sessionStorage: { ...sessionStorage } }),
      });
      if (results && results[0]?.result) {
        localStorageData = results[0].result.localStorage;
        sessionStorageData = results[0].result.sessionStorage;
      }
    }
  } catch (error) {
    console.warn(error);
  }

  const snapshot = {
    origin: new URL(tab.url).origin,
    url: tab.url,
    cookies,
    localStorage: localStorageData,
    sessionStorage: sessionStorageData,
  };
  return params.provider
    ? analyzeProviderSession(params.provider, snapshot)
    : analyzeSessionSnapshot(snapshot);
}

async function captureBrowserContext(params) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error("No active tab");

  let screenshot = "";
  if (params.screenshot !== false) {
    try {
      screenshot = await chrome.tabs.captureVisibleTab(null, { format: "jpeg", quality: 85 });
    } catch (error) {
      console.warn(error);
    }
  }

  let domTree = "";
  try {
    if (tab.id && !tab.url.startsWith("chrome://")) {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => document.documentElement.outerHTML,
      });
      domTree = results[0]?.result || "";
    }
  } catch (error) {
    console.warn(error);
  }

  return { title: tab.title, url: tab.url, screenshot, domTree };
}

async function executeBrowserAction(params) {
  const { action, selector, text } = params;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error("No active tab");

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    args: [action, selector, text || ""],
    func: (nextAction, nextSelector, nextText) => {
      const element = document.querySelector(nextSelector);
      if (!element) return { success: false, error: `Element not found: ${nextSelector}` };
      if (nextAction === "click") {
        element.click();
        return { success: true };
      }
      if (nextAction === "type") {
        element.value = nextText;
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
        return { success: true };
      }
      return { success: false, error: `Unsupported action: ${nextAction}` };
    },
  });

  return results[0]?.result || { success: false, error: "Action failed" };
}

export function getNativeStatus() {
  return status;
}

export function onNativeStatus(listener) {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

function notifyStatus() {
  for (const listener of statusListeners) {
    try {
      listener(status);
    } catch {}
  }
}

function resolveConnectionWaiters() {
  for (const waiter of connectionWaiters) {
    clearTimeout(waiter.timer);
    waiter.resolve(status);
  }
  connectionWaiters.clear();
}

function rejectConnectionWaiters(error) {
  for (const waiter of connectionWaiters) {
    clearTimeout(waiter.timer);
    waiter.reject(error);
  }
  connectionWaiters.clear();
}

function waitForConnection(timeoutMs = 15_000) {
  if (status.connected) return Promise.resolve(status);
  return new Promise((resolve, reject) => {
    const waiter = {
      resolve,
      reject,
      timer: setTimeout(() => {
        connectionWaiters.delete(waiter);
        reject(new Error("Local Ti bridge is not available"));
      }, timeoutMs),
    };
    connectionWaiters.add(waiter);
  });
}

async function maybeBootstrapLocalBridge() {
  if (!IS_SERVICE_WORKER) return false;
  if (status.connected) return true;
  if (bootstrapPromise) return bootstrapPromise;

  bootstrapPromise = bootstrapLocalBridge().finally(() => {
    bootstrapPromise = null;
  });
  return bootstrapPromise;
}

function bootstrapLocalBridge() {
  return new Promise((resolve, reject) => {
    if (!chrome.runtime?.connectNative) {
      reject(new Error("Native Messaging is not available"));
      return;
    }

    const requestId = `bootstrap_${Date.now()}`;
    const port = chrome.runtime.connectNative(NATIVE_HOST_NAME);
    let settled = false;
    const timer = setTimeout(() => finish(new Error("Timed out while starting the native host")), 12_000);

    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { port.disconnect(); } catch {}
      if (error) reject(error);
      else resolve(result);
    };

    port.onMessage.addListener((message) => {
      if (message?.id !== requestId) return;
      if (message.ok === false) {
        finish(new Error(message.error?.message || "Native host bootstrap failed"));
      } else {
        finish(null, message.result);
      }
    });
    port.onDisconnect.addListener(() => {
      if (settled) return;
      const lastError = chrome.runtime.lastError;
      finish(new Error(lastError?.message || "Native host disconnected during bootstrap"));
    });

    try {
      port.postMessage({
        id: requestId,
        type: "orchestrator.up",
        payload: {},
      });
    } catch (error) {
      finish(error);
    }
  });
}

function clampTimeout(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_TIMEOUT_MS;
  return Math.max(1_000, Math.min(parsed, 10 * 60_000));
}

export async function startHeartbeat() {}
export async function stopHeartbeat() {}
export async function checkHeartbeat() { return true; }

export async function connectNative() {
  if (!IS_SERVICE_WORKER) {
    return proxyToBackground("connect", {});
  }

  if (status.connected) return status;
  connectWs();

  try {
    return await waitForConnection(3_000);
  } catch {
    await maybeBootstrapLocalBridge();
    connectWs(true);
    return waitForConnection(15_000);
  }
}

export function startReconnectAlarm() {
  scheduleReconnect();
}

export function stopReconnectAlarm() {
  clearTimeout(reconnectTimer);
}
