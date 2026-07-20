// background.js - Enhanced with CDP engine + Session manager + Event bus
// Patterns from ChatGPT Codex: persistent CDP, tab leasing, event-driven architecture, heartbeat

import { runtime, tabs, storage } from './browser-polyfill.js';
import { sendNative, connectNative, startHeartbeat, stopHeartbeat, checkHeartbeat, getNativeStatus, onNativeStatus, startReconnectAlarm, stopReconnectAlarm } from './native-client.js';
import { fetchGatewayModels } from './provider-gateway.js';
import { executeChatGptBlocks } from './chatgpt-block-runtime.js';
import { getCdpEngine } from './cdp-engine.js';
import { getSessionManager } from './session-manager.js';
import { getEventBus } from './event-bus.js';
import { getModelSelector } from './model-selector.js';
import { initWsBridge } from './ws-agent-bridge.js';
import { createExtensionAgentTask } from './extension-agent-task.js';

// Initialize engines
const cdp = getCdpEngine();
const sessions = getSessionManager();
const bus = getEventBus();
const modelSelector = getModelSelector();
const chatGptBlockIdempotency = new Map();

// Job bridge (OpenBrowser-style) on :5050 (fallback HTTP bridge)
const BRIDGE_BASE = 'http://127.0.0.1:5050';
const AI_TAB_PATTERNS = [
  'https://chatgpt.com/*',
  'https://chat.openai.com/*',
  'https://claude.ai/*',
  'https://gemini.google.com/*',
  'https://grok.com/*',
  'https://x.com/*',
  'https://agent.minimax.io/*',
  'https://www.minimax.io/*',
  'https://minimax.io/*',
  'https://chat.deepseek.com/*',
];

// ====== Initialization ======
async function initialize() {
  // Load persisted sessions
  await sessions.loadFromStorage();

  // Register RPC handlers
  bus.register("ping", () => ({ pong: true, timestamp: Date.now() }));
  bus.register("status", () => ({
    native: getNativeStatus(),
    cdp: cdp.getActiveSessions().size,
    sessions: sessions.getActiveSessions().size,
    eventBus: bus.getStats()
  }));

  // Model selection RPC (agent-driven, not user-picked)
  bus.register("model.select", async ({ goal, constraints }) => {
    return modelSelector.selectModel(goal, { constraints });
  });
  bus.register("model.analyze", ({ goal }) => modelSelector.analyzeTask(goal));

  // Set up alarm handlers
  setupAlarms();

  // Start heartbeat
  await startHeartbeat();

  // Connect native host
  connectNative().catch(() => {
    // Will retry via alarm
  });

  // Connect to the Go runtime bridge (ws://127.0.0.1:9000/v1/extension)
  // Handles the side-panel pairing modal (ws.pair -> runtime.pair).
  initWsBridge();

  // Connect to the job bridge SSE (:5000) and forward jobs to AI tabs.
  connectBridgeStream().catch(() => {});
}

// ====== Alarm handlers (pattern from Codex) ======
function setupAlarms() {
  runtime.onAlarm?.addListener(async (alarm) => {
    switch (alarm.name) {
      case "native-host-heartbeat":
        await checkHeartbeat();
        break;
      case "native-host-reconnect":
        if (!getNativeStatus().connected) {
          connectNative().catch(() => {});
        }
        break;
      default:
        break;
    }
  });
}

// ====== Message Router ======
runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { type, payload, ...options } = message || {};

  if (!type || typeof type !== 'string') {
    return sendResponse({ ok: false, error: { message: 'Invalid message type' } });
  }

  // RPC-style messages
  if (type.startsWith('rpc.')) {
    handleRpc(type, payload, sender)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({
        ok: false,
        error: { message: error.message, code: error.code, retryable: Boolean(error.retryable) }
      }));
    return true;
  }

  // Bridge proxy: content-script -> :5000 job bridge
  if (type === 'BRIDGE_REQUEST') {
    bridgeProxy(payload)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  // CDP actions
  if (type.startsWith('cdp.')) {
    handleCdpAction(type, payload, sender)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({
        ok: false,
        error: { message: error.message, code: error.code, retryable: Boolean(error.retryable) }
      }));
    return true;
  }

  // Native host actions
  if (type.startsWith('native.')) {
    const nativeType = type.slice('native.'.length);
    sendNative(nativeType, payload, options)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({
        ok: false,
        error: {
          message: error.message,
          code: error.code,
          retryable: Boolean(error.retryable),
          details: error.details
        }
      }));
    return true;
  }

  if (type === 'sidepanel.open') {
    tabs.query({ active: true, currentWindow: true })
      .then(([tab]) => chrome.sidePanel.open({ tabId: tab?.id }))
      .then(() => sendResponse({ ok: true, result: { opened: true } }))
      .catch((error) => sendResponse({ ok: false, error: { message: error.message, code: 'SIDEPANEL_OPEN_FAILED' } }));
    return true;
  }

  // Local runtime tool calls (fs.list, fs.read, fs.search_text, workspace.list, runtime.status)
  if (['fs.list', 'fs.read', 'fs.search_text', 'workspace.list', 'runtime.status'].includes(type)) {
    sendNative(type, payload, options)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({
        ok: false,
        error: {
          message: error.message,
          code: error.code,
          retryable: Boolean(error.retryable),
          details: error.details
        }
      }));
    return true;
  }

  // Execution mode toggle
  if (type === 'native.execution_mode') {
    // Store execution mode preference (fire and forget)
    storage.local.set({
      executionEnabled: payload.enabled,
      autoInjectResults: payload.autoInjectResults
    }).then(() => {
      sendResponse({ ok: true, result: { enabled: payload.enabled } });
    }).catch(() => {
      sendResponse({ ok: true, result: { enabled: payload.enabled } });
    });
    return true;
  }

  // Provider model fetch
  if (type === 'provider.fetchModels') {
    fetchGatewayModels()
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: { message: error.message } }));
    return true;
  }

  // ChatGPT web messages
  if (type.startsWith('chatgpt.')) {
    handleChatGptMessage(type, payload, options, sender)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: { message: error.message } }));
    return true;
  }

  // MiniMax Agent web messages
  if (type.startsWith('minimax-agent.')) {
    handleMinimaxAgentMessage(type, payload, options, sender)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: { message: error.message } }));
    return true;
  }

  // Session management
  if (type.startsWith('session.')) {
    handleSessionMessage(type, payload)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: { message: error.message } }));
    return true;
  }

  // AI tabs discovery
  if (type === 'ai.tabs.discover') {
    handleAiTabsDiscover(payload)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: { message: error.message } }));
    return true;
  }

  // Browser actions
  if (type.startsWith('browser.')) {
    handleBrowserAction(type, payload)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({
        ok: false,
        error: { message: error.message, code: error.code, retryable: Boolean(error.retryable) }
      }));
    return true;
  }

  // Orchestrator actions
  if (type.startsWith('orchestrator.')) {
    const action = type.slice('orchestrator.'.length);
    if (action === 'up') {
      // Start backend and try to connect
      return startBackend()
        .then((connected) => {
          sendResponse({ connected, message: connected ? "Backend started" : "Backend start failed" });
        })
        .catch((error) => {
          sendResponse({ error: error.message });
        });
      return true; // Keep message channel open
    }
    if (action === 'down') {
      return stopBackend()
        .then(() => sendResponse({ stopped: true, message: "Backend stopped" }))
        .catch((error) => sendResponse({ error: error.message }));
    }
    if (action === 'status') {
      return sendResponse({ connected: getNativeStatus().connected, hostVersion: getNativeStatus().hostVersion });
    }
    return sendResponse({ ok: false, error: { message: `Unknown orchestrator action: ${action}` } });
  }

  if (type === 'extension-agent.submit') {
    Promise.resolve()
      .then(() => sendNative('task.enqueue', createExtensionAgentTask(payload)))
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({
        ok: false,
        error: { message: error.message, code: error.code, retryable: Boolean(error.retryable) },
      }));
    return true;
  }

  async function startBackend() {
    // Try to connect first (backend might already be running)
    try {
      await connectNative();
      if (getNativeStatus().connected) return true;
    } catch {}

    // Try to bootstrap native host (which may start the backend)
    try {
      await bootstrapNativeHost();
      // Give it a moment to start
      await new Promise(r => setTimeout(r, 2000));
      return getNativeStatus().connected;
    } catch (error) {
      console.error('Failed to start backend:', error);
      return false;
    }
  }

  async function bootstrapNativeHost() {
    // Try native messaging first
    try {
      const port = chrome.runtime.connectNative('com.chatgpt_native_agent.host');
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Native host timeout')), 5000);
        port.onMessage.addListener((response) => {
          clearTimeout(timer);
          if (response?.ok) resolve();
          else reject(new Error(response?.error?.message || 'Native host failed'));
        });
        port.onDisconnect.addListener(() => {
          clearTimeout(timer);
          reject(new Error(chrome.runtime.lastError?.message || 'Native host disconnected'));
        });
        port.postMessage({ type: 'orchestrator.up', payload: {} });
      });
      return true;
    } catch (error) {
      console.warn('Native host bootstrap failed:', error.message);
      throw error;
    }
  }

  async function stopBackend() {
    // Try to stop via backend API if running
    try {
      const resp = await fetch('http://127.0.0.1:18401/v1/orchestrator/down', { method: 'POST' });
      return await resp.json();
    } catch {
      return { stopped: false, message: 'No backend to stop' };
    }
  }

  // Chat/task actions
  if (type.startsWith('chat.') || type.startsWith('task.')) {
    const nativeType = type.startsWith('chat.') ? type.slice('chat.'.length) : type;
    sendNative(nativeType, payload, options)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({
        ok: false,
        error: {
          message: error.message,
          code: error.code,
          retryable: Boolean(error.retryable),
          details: error.details
        }
      }));
    return true;
  }

  // Filesystem tools
  if (type.startsWith('filesystem_')) {
    sendNative(type, payload, options)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({
        ok: false,
        error: {
          message: error.message,
          code: error.code,
          retryable: Boolean(error.retryable),
          details: error.details
        }
      }));
    return true;
  }

  // Tool calls
  if (type === 'tool_call' || type === 'tool.call') {
    sendNative('tool_call', payload, options)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({
        ok: false,
        error: {
          message: error.message,
          code: error.code,
          retryable: Boolean(error.retryable),
          details: error.details
        }
      }));
    return true;
  }

  // Task actions
  if (type.startsWith('task.')) {
    sendNative(type, payload, options)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({
        ok: false,
        error: { message: error.message }
      }));
    return true;
  }

  // Workspace tools
  if (type.startsWith('workspace.')) {
    sendNative(type, payload, options)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({
        ok: false,
        error: { message: error.message }
      }));
    return true;
  }

  return sendResponse({ ok: false, error: { message: `Unknown message type: ${type}` } });
});

// ====== RPC Handler ======
async function handleRpc(type, payload, sender) {
  const method = type.slice('rpc.'.length);
  return bus.call(method, payload);
}

// ====== CDP Action Handler ======
async function handleCdpAction(type, payload = {}, sender) {
  const action = type.slice('cdp.'.length);
  const tabId = payload.tabId || sender?.tab?.id;

  switch (action) {
    case 'attach':
      return cdp.attach(tabId, payload);
    case 'detach':
      return cdp.detach(tabId);
    case 'send':
      return cdp.send(tabId, payload.method, payload.params, payload.options);
    case 'navigate':
      return cdp.navigate(tabId, payload.url);
    case 'click':
      return cdp.click(tabId, payload.x, payload.y, payload);
    case 'type':
      return cdp.type(tabId, payload.text);
    case 'evaluate':
      return { value: await cdp.evaluate(tabId, payload.expression, payload) };
    case 'screenshot':
      return cdp.screenshot(tabId, payload);
    case 'html':
      return { html: await cdp.getOuterHTML(tabId, payload) };
    case 'console_logs':
      return { logs: await cdp.getConsoleLogs(tabId, payload) };
    case 'network_logs':
      return { logs: await cdp.getNetworkLogs(tabId, payload) };
    case 'wait_load':
      return cdp.waitForLoad(tabId, payload);
    case 'sessions':
      return cdpSessionsInfo();
    default:
      throw new Error(`Unknown CDP action: ${action}`);
  }
}

function cdpSessionsInfo() {
  const active = cdp.getActiveSessions();
  return {
    sessions: Array.from(active.entries()).map(([tabId, session]) => ({
      tabId,
      refCount: session.refCount,
      attachedAt: session.attachedAt,
      enabledDomains: [...session.enabledDomains]
    }))
  };
}

// ====== Session Message Handler ======
async function handleSessionMessage(type, payload = {}) {
  const action = type.slice('session.'.length);
  const { sessionId, tabId, turnId, origin } = payload;

  switch (action) {
    case 'create':
      return sessions.createSession(sessionId, { turnId, origin });
    case 'end':
      return sessions.endSession(sessionId);
    case 'claim':
      return sessions.claimTab(sessionId, tabId, { turnId, origin });
    case 'release':
      return sessions.releaseTab(sessionId, tabId);
    case 'handoff':
      return sessions.handoffTab(sessionId, tabId, { turnId });
    case 'resume':
      return sessions.resumeHandoff(sessionId, tabId, { turnId });
    case 'get':
      return sessions.getSessionTabs(sessionId);
    case 'lease':
      return sessions.getTabLease(tabId);
    case 'list':
      return sessions.getActiveSessions();
    default:
      throw new Error(`Unknown session action: ${action}`);
  }
}

// ====== AI Tabs Discovery ======
async function handleAiTabsDiscover(payload = {}) {
  const patterns = [
    /chatgpt\.com/,
    /chat\.openai\.com/,
    /agent\.minimax\.io/,
    /www\.minimax\.io/,
    /minimax\.io/,
    /claude\.ai/,
    /anthropic\.com/,
    /gemini\.google/,
    /poe\.com/,
    /pi\.ai/,
    /you\.com/,
    /bing\.com/,
    /copilot\.microsoft\.com/
  ];

  const allTabs = await tabs.query({});
  return {
    tabs: allTabs.filter(tab => patterns.some(p => p.test(tab.url || ""))).map(tab => ({
      id: tab.id,
      url: tab.url,
      title: tab.title,
      active: tab.active
    }))
  };
}

// ====== Browser Action Handler ======
async function handleBrowserAction(type, payload = {}) {
  const { runBrowserAction } = await import('./browser-agent.js');
  return runBrowserAction({ action: type, ...payload });
}

// ====== ChatGPT Message Handler ======
async function handleChatGptMessage(type, payload, options, sender) {
  if (type === 'chatgpt.blocks') {
    return handleChatGptBlocks(payload, sender);
  }

  // Handle chat.* actions (sidepanel task execution)
  if (type.startsWith('chat.')) {
    return handleChatAction(type, payload, options, sender);
  }

  const tabId = sender.tab?.id;
  if (!tabId) {
    throw new Error('No sender tab for chatgpt message');
  }

  const strippedType = type.replace('chatgpt.', '');
  try {
    return await tabs.sendMessage(tabId, { type: strippedType, payload });
  } catch {
    const chatTabs = await tabs.query({ url: ['https://chatgpt.com/*', 'https://chat.openai.com/*'] });
    if (!chatTabs.length) throw new Error('No ChatGPT tab found');
    return await tabs.sendMessage(chatTabs[0].id, { type: strippedType, payload });
  }
}

// ====== Chat Action Handler (sidepanel task execution) ======
async function handleChatAction(type, payload, options, sender) {
  const action = type.replace('chat.', '');

  if (action === 'start') {
    // Start a chat task - equivalent to task.enqueue with chat execution
    const { prompt, mode, execute, maxIterations } = payload;
    if (!prompt) throw new Error('prompt is required');

    // Create a task with the chat execution profile
    const taskId = `task_${Date.now()}`;
    await sessions.createSession(taskId, { turnId: 'turn_0', origin: 'popup' });

    // Enqueue task with chat execution
    const result = await sendNative('task.enqueue', {
      goal: prompt,
      profile: 'default',
      provider: 'chatgpt-web',
      max_iterations: maxIterations || 20,
      mode: mode || 'plan_then_execute',
      source: 'popup.chat.start',
      execute: execute !== false,
    });

    return {
      taskId: result.task_id,
      status: result.status,
      goal: result.goal,
    };
  }

  if (action === 'job.get') {
    // Get task status
    const { taskId } = payload;
    if (!taskId) throw new Error('taskId is required');
    return await sendNative('task.get', { task_id: taskId });
  }

  if (action === 'status') {
    // Get chat provider status
    const chatTabs = await tabs.query({ url: ['https://chatgpt.com/*', 'https://chat.openai.com/*'] });
    if (!chatTabs.length) {
      return { ready: false, state: 'no_tab', currentModel: 'unknown' };
    }
    return {
      ready: true,
      state: 'ready',
      currentModel: 'ChatGPT Web',
      tabId: chatTabs[0].id,
    };
  }

  throw new Error(`Unknown chat action: ${action}`);
}

// ====== MiniMax Agent Message Handler ======
async function handleMinimaxAgentMessage(type, payload, options, sender) {
  const tabId = sender.tab?.id;

  if (type === 'minimax-agent.ask') {
    if (!tabId) {
      throw new Error('No sender tab for minimax-agent message');
    }
    return tabs.sendMessage(tabId, { type: 'minimax.ask', payload });
  }

  if (type === 'minimax-agent.status') {
    if (!tabId) {
      throw new Error('No sender tab for minimax-agent message');
    }
    return tabs.sendMessage(tabId, { type: 'minimax.status', payload });
  }

  if (type === 'minimax-agent.session.capture') {
    if (!tabId) {
      throw new Error('No sender tab for minimax-agent message');
    }
    return tabs.sendMessage(tabId, { type: 'minimax.session.capture', payload });
  }

  if (type === 'minimax-agent.session.tokens') {
    if (!tabId) {
      throw new Error('No sender tab for minimax-agent message');
    }
    return tabs.sendMessage(tabId, { type: 'minimax.session.tokens', payload });
  }

  // Handle provider bridge chat requests
  if (type === 'minimax-agent.chat') {
    const minimaxTabs = await tabs.query({ url: ['https://agent.minimax.io/*', 'https://www.minimax.io/*', 'https://minimax.io/*'] });
    if (!minimaxTabs.length) {
      throw new Error('No MiniMax Agent tab found. Please open https://agent.minimax.io');
    }
    return tabs.sendMessage(minimaxTabs[0].id, { type: 'minimax.chat', payload });
  }

  // Fallback: try to find any MiniMax Agent tab
  const minimaxTabs = await tabs.query({ url: ['https://agent.minimax.io/*', 'https://www.minimax.io/*', 'https://minimax.io/*'] });
  if (!minimaxTabs.length) {
    throw new Error('No MiniMax Agent tab found. Please open https://agent.minimax.io');
  }

  const strippedType = type.replace('minimax-agent.', '');
  return tabs.sendMessage(minimaxTabs[0].id, { type: strippedType, payload });
}

async function handleChatGptBlocks(payload, sender) {
  const { text, sendResultBack } = payload || {};
  if (!text || typeof text !== 'string') return { executed: false, reason: 'no text' };
  const settings = await storage.local.get({
    executionEnabled: true,
    autoInjectResults: true,
    autoApproveMutations: false,
  });
  const execution = await executeChatGptBlocks({
    text,
    settings,
    completed: chatGptBlockIdempotency,
    sendNative,
  });
  const results = execution.results;

  if (sendResultBack) {
    const fallbackTabId = sender.tab?.id || (await tabs.query({ url: ['https://chatgpt.com/*', 'https://chat.openai.com/*'] }))[0]?.id;
    if (fallbackTabId) {
      try {
        await tabs.sendMessage(fallbackTabId, { type: 'chatgpt.blocks_result', payload: { results } });
      } catch { /* content script may not be listening */ }
    }
  }

  return { ...execution, results, count: results.length };
}

// ====== Job Bridge SSE + proxy ======
let bridgeStreamAbort = null;
let bridgeReconnectTimer = null;

async function bridgeProxy({ path: p, init = {} } = {}) {
  const headers = { ...(init.headers || {}) };
  if (init.body && !headers['content-type']) {
    headers['content-type'] = 'application/json';
  }
  const resp = await fetch(`${BRIDGE_BASE}${p}`, { ...init, headers });
  const text = await resp.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!resp.ok) {
    throw new Error(`Bridge ${resp.status}${text ? `: ${text}` : ''}`);
  }
  return data;
}

async function connectBridgeStream() {
  if (bridgeStreamAbort) bridgeStreamAbort.abort();
  bridgeStreamAbort = new AbortController();

  try {
    const resp = await fetch(`${BRIDGE_BASE}/browser/events`, {
      signal: bridgeStreamAbort.signal,
      headers: { Accept: 'text/event-stream' },
    });
    if (!resp.ok || !resp.body) {
      throw new Error(`SSE failed (${resp.status})`);
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = consumeSse(buffer, (event, data) => {
        if (event === 'job') void dispatchJob(data);
      });
    }
    throw new Error('SSE stream ended');
  } catch (error) {
    if (bridgeStreamAbort?.signal.aborted) return;
    console.warn('[bridge] SSE disconnected, retrying...', error.message);
    scheduleBridgeReconnect();
  }
}

function consumeSse(buffer, onEvent) {
  const chunks = buffer.split('\n\n');
  const remainder = chunks.pop() ?? '';

  for (const chunk of chunks) {
    if (!chunk.trim() || chunk.startsWith(':')) continue;
    let event = 'message';
    let dataLine = '';
    for (const line of chunk.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLine = line.slice(5).trim();
    }
    if (!dataLine) continue;
    try { onEvent(event, JSON.parse(dataLine)); } catch { /* ignore malformed */ }
  }
  return remainder;
}

async function dispatchJob(job) {
  if (!job?.sessionId) return;
  const aiTabs = await tabs.query({ url: AI_TAB_PATTERNS });
  for (const tab of aiTabs) {
    if (!tab.id) continue;
    try {
      const r = await tabs.sendMessage(tab.id, { type: 'OPENBROWSER_JOB', job });
      if (r?.ok !== false) return; // delivered
    } catch {
      // tab not ready / no content script; try next
    }
  }
}

function scheduleBridgeReconnect() {
  if (bridgeReconnectTimer) return;
  bridgeReconnectTimer = setTimeout(() => {
    bridgeReconnectTimer = null;
    void connectBridgeStream();
  }, 2500);
}

// ====== Start ======
initialize().catch(console.error);
