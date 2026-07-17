// cdp-engine.js
// Persistent CDP (Chrome DevTools Protocol) engine
// Pattern from ChatGPT Codex: attach once, reuse, auto-reconnect
// Enables Tiiextension to control ANY web page, not just ChatGPT

const SAFE_CDP_DOMAINS = new Set([
  "Accessibility", "Animation", "Audits", "CacheStorage", "CSS", "Database",
  "DOM", "DOMDebugger", "DOMSnapshot", "DOMStorage", "Emulation",
  "Fetch", "HeapProfiler", "IndexedDB", "Input", "IO", "LayerTree",
  "Log", "Memory", "Network", "Overlay", "Page", "Performance",
  "Profiler", "Runtime", "Security", "ServiceWorker", "Storage",
  "SystemInfo", "Target", "Tethering", "Tracing", "WebAudio", "WebAuthn"
]);

const DEFAULT_TIMEOUT_MS = 30000;
const CDP_ATTACH_TIMEOUT = 5000;
const RECONNECT_DELAY_MS = 2000;

// Active debugger sessions: tabId -> { attached, targets }
const activeSessions = new Map();

// Event listeners
const eventListeners = new Map(); // method prefix -> Set<callback>

// Pending CDP commands
let nextCommandId = 1;
const pendingCommands = new Map();

export function getCdpEngine() {
  return {
    attach,
    detach,
    send,
    sendWithRetry,
    getActiveSessions: () => new Map(activeSessions),
    isAttached: (tabId) => activeSessions.has(tabId),
    onEvent,
    offEvent,
    getSafeDomains: () => new Set(SAFE_CDP_DOMAINS)
  };
}

/**
 * Attach debugger to a tab persistently.
 * Pattern from Codex: attach once, keep alive across multiple commands.
 */
async function attach(tabId, { viewport } = {}) {
  if (activeSessions.has(tabId)) {
    const session = activeSessions.get(tabId);
    session.refCount++;
    return session;
  }

  const target = { tabId };
  
  try {
    await withTimeout(
      chrome.debugger.attach(target, "1.3"),
      CDP_ATTACH_TIMEOUT,
      `CDP attach timeout for tab ${tabId}`
    );
  } catch (err) {
    // "Another debugger is already attached" - still usable
    if (!err.message?.includes("Another debugger")) {
      throw cdpError("CDP_ATTACH_FAILED", `Failed to attach to tab ${tabId}: ${err.message}`);
    }
  }

  const session = {
    tabId,
    target,
    refCount: 1,
    attachedAt: Date.now(),
    enabledDomains: new Set()
  };

  activeSessions.set(tabId, session);

  // Set up event listener for this tab
  const eventHandler = (source, method, params) => {
    if (source.tabId === tabId) {
      dispatchEvent(method, { source, method, params, tabId });
    }
  };
  chrome.debugger.onEvent.addListener(eventHandler);
  session._eventHandler = eventHandler;

  // Apply viewport if specified
  if (viewport) {
    await send(tabId, "Emulation.setDeviceMetricsOverride", {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: false
    });
  }

  return session;
}

/**
 * Detach debugger from a tab.
 * Pattern from Codex: ref-counted detach (only truly detach when refCount reaches 0)
 */
async function detach(tabId) {
  const session = activeSessions.get(tabId);
  if (!session) return;

  session.refCount--;
  if (session.refCount > 0) return;

  // Remove event listener
  if (session._eventHandler) {
    chrome.debugger.onEvent.removeListener(session._eventHandler);
  }

  activeSessions.delete(tabId);

  try {
    await chrome.debugger.detach({ tabId });
  } catch {
    // Ignore detach errors (tab may already be closed)
  }
}

/**
 * Send CDP command to a tab.
 * Pattern from Codex: sendCommand with timeout, error handling
 */
async function send(tabId, method, params = {}, { timeoutMs = DEFAULT_TIMEOUT_MS, preserveOnTimeout = false } = {}) {
  validateMethod(method);

  // Auto-attach if not attached
  if (!activeSessions.has(tabId)) {
    await attach(tabId);
  }

  const target = { tabId };
  const commandId = nextCommandId++;

  try {
    const result = await withTimeout(
      chrome.debugger.sendCommand(target, method, params),
      timeoutMs,
      `CDP command timed out after ${timeoutMs}ms: ${method}`
    );
    return { tabId, method, result, commandId };
  } catch (err) {
    if (err.message?.includes("timed out") && !preserveOnTimeout) {
      // Detach on timeout to avoid stuck debugger (Codex pattern)
      await detach(tabId).catch(() => {});
    }
    throw cdpError("CDP_COMMAND_FAILED", `CDP ${method} failed: ${err.message}`, {
      method,
      tabId,
      timeoutMs,
      retryable: !err.message?.includes("timed out")
    });
  }
}

/**
 * Send CDP command with automatic retry on failure.
 */
async function sendWithRetry(tabId, method, params = {}, { timeoutMs = DEFAULT_TIMEOUT_MS, maxRetries = 2 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        // Re-attach before retry
        await detach(tabId).catch(() => {});
        await attach(tabId);
      }
      return await send(tabId, method, params, { timeoutMs });
    } catch (err) {
      lastError = err;
      if (!err.retryable) throw err;
      await sleep(RECONNECT_DELAY_MS * attempt);
    }
  }
  throw lastError;
}

/**
 * Enable a CDP domain (e.g., "Network", "Page", "Runtime").
 * Pattern from Codex: enable domains for event collection
 */
async function enableDomain(tabId, domain) {
  if (!SAFE_CDP_DOMAINS.has(domain)) {
    throw cdpError("CDP_DOMAIN_DENIED", `CDP domain not allowed: ${domain}`);
  }
  const session = activeSessions.get(tabId);
  if (!session) throw cdpError("CDP_NOT_ATTACHED", `Not attached to tab ${tabId}`);

  if (session.enabledDomains.has(domain)) return;
  
  await send(tabId, `${domain}.enable`);
  session.enabledDomains.add(domain);
}

/**
 * Disable a CDP domain.
 */
async function disableDomain(tabId, domain) {
  const session = activeSessions.get(tabId);
  if (!session || !session.enabledDomains.has(domain)) return;

  await send(tabId, `${domain}.disable`).catch(() => {});
  session.enabledDomains.delete(domain);
}

/**
 * Collect CDP events for a duration.
 * Pattern from Codex: collectCdpEvents
 */
async function collectEvents(tabId, { domains = [], durationMs = 1000, filterPrefixes = [] } = {}) {
  const events = [];
  const listener = (source, method, params) => {
    if (source.tabId === tabId) {
      if (filterPrefixes.length === 0 || filterPrefixes.some(p => method.startsWith(p))) {
        events.push({ method, params, timestamp: Date.now() });
      }
    }
  };

  chrome.debugger.onEvent.addListener(listener);
  try {
    for (const domain of domains) {
      await enableDomain(tabId, domain);
    }
    await sleep(durationMs);
    return events;
  } finally {
    chrome.debugger.onEvent.removeListener(listener);
  }
}

/**
 * Register event listener for CDP events.
 * Pattern from Codex: event-driven architecture
 */
function onEvent(methodPrefix, callback) {
  if (!eventListeners.has(methodPrefix)) {
    eventListeners.set(methodPrefix, new Set());
  }
  eventListeners.get(methodPrefix).add(callback);
  return () => {
    const listeners = eventListeners.get(methodPrefix);
    if (listeners) {
      listeners.delete(callback);
      if (listeners.size === 0) eventListeners.delete(methodPrefix);
    }
  };
}

function offEvent(methodPrefix, callback) {
  const listeners = eventListeners.get(methodPrefix);
  if (listeners) {
    listeners.delete(callback);
    if (listeners.size === 0) eventListeners.delete(methodPrefix);
  }
}

function dispatchEvent(method, event) {
  for (const [prefix, callbacks] of eventListeners) {
    if (method.startsWith(prefix)) {
      for (const cb of callbacks) {
        try { cb(event); } catch { /* isolated */ }
      }
    }
  }
}

/**
 * Navigate a tab to a URL.
 */
async function navigate(tabId, url) {
  validateUrl(url);
  await send(tabId, "Page.navigate", { url });
  return { tabId, url };
}

/**
 * Wait for page to load.
 */
async function waitForLoad(tabId, { timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(cdpError("CDP_LOAD_TIMEOUT", `Page load timed out after ${timeoutMs}ms`, true));
    }, timeoutMs);

    const handler = (source, method, params) => {
      if (source.tabId === tabId && method === "Page.loadEventFired") {
        cleanup();
        resolve({ tabId, loaded: true });
      }
    };

    const cleanup = () => {
      clearTimeout(timer);
      chrome.debugger.onEvent.removeListener(handler);
    };

    chrome.debugger.onEvent.addListener(handler);
    send(tabId, "Page.enable").catch(() => {});
  });
}

/**
 * Click at coordinates on a page.
 */
async function click(tabId, x, y, { button = "left", clickCount = 1 } = {}) {
  const btn = { left: 0, middle: 1, right: 2 }[button] || 0;
  
  await send(tabId, "Input.dispatchMouseEvent", {
    type: "mousePressed",
    x, y,
    button: btn,
    clickCount
  });
  await send(tabId, "Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x, y,
    button: btn,
    clickCount
  });

  return { tabId, x, y, button };
}

/**
 * Type text on a page.
 */
async function type(tabId, text) {
  await send(tabId, "Input.insertText", { text });
  return { tabId, text: text.length };
}

/**
 * Get DOM snapshot of a page.
 */
async function getDocument(tabId, { depth = 4 } = {}) {
  await enableDomain(tabId, "DOM");
  const { result } = await send(tabId, "DOM.getDocument", { depth });
  return result;
}

/**
 * Get full page HTML.
 */
async function getOuterHTML(tabId, { nodeId } = {}) {
  await enableDomain(tabId, "DOM");
  if (!nodeId) {
    const doc = await getDocument(tabId, { depth: 1 });
    nodeId = doc.root.nodeId;
  }
  const { result } = await send(tabId, "DOM.getOuterHTML", { nodeId });
  return result.outerHTML;
}

/**
 * Screenshot a tab.
 */
async function screenshot(tabId, { format = "png", quality = 80, fullPage = false } = {}) {
  const params = { format };
  if (format === "jpeg") params.quality = quality;
  if (fullPage) {
    const { result: metrics } = await send(tabId, "Page.getLayoutMetrics");
    params.clip = {
      x: 0, y: 0,
      width: Math.ceil(metrics.contentSize.width),
      height: Math.ceil(metrics.contentSize.height),
      scale: 1
    };
  }
  const { result } = await send(tabId, "Page.captureScreenshot", params);
  return { tabId, dataUrl: `data:image/${format === "jpeg" ? "jpeg" : "png"};base64,${result.data}`, format };
}

/**
 * Evaluate JavaScript in page context.
 */
async function evaluate(tabId, expression, { awaitPromise = true } = {}) {
  const { result } = await send(tabId, "Runtime.evaluate", {
    expression,
    awaitPromise,
    returnByValue: true
  });
  if (result.exceptionDetails) {
    throw cdpError("CDP_EVALUATION_ERROR",
      `Evaluation error: ${result.exceptionDetails.text || result.exceptionDetails.exception?.description || "Unknown"}`);
  }
  return result.result?.value;
}

/**
 * Get console logs from a page.
 */
async function getConsoleLogs(tabId, { durationMs = 2000 } = {}) {
  const events = await collectEvents(tabId, {
    domains: ["Runtime", "Log"],
    durationMs,
    filterPrefixes: ["Log.", "Runtime.consoleAPICalled", "Runtime.exceptionThrown"]
  });
  return events.map(e => ({
    method: e.method,
    text: e.params?.args?.[0]?.value || e.params?.text || e.params?.exceptionDetails?.text || "",
    timestamp: e.timestamp
  }));
}

/**
 * Get network logs from a page.
 */
async function getNetworkLogs(tabId, { durationMs = 2000 } = {}) {
  const events = await collectEvents(tabId, {
    domains: ["Network"],
    durationMs,
    filterPrefixes: ["Network."]
  });
  return events.map(e => ({
    method: e.method,
    requestId: e.params?.requestId,
    url: e.params?.request?.url || e.params?.response?.url || "",
    status: e.params?.response?.status,
    timestamp: e.timestamp
  }));
}

// ====== Helpers ======

function validateMethod(method) {
  if (typeof method !== "string" || !method.includes(".")) {
    throw cdpError("CDP_METHOD_INVALID", `Invalid CDP method: ${method}`);
  }
  const domain = method.split(".", 1)[0];
  if (!SAFE_CDP_DOMAINS.has(domain)) {
    throw cdpError("CDP_METHOD_DENIED", `CDP domain not allowed: ${domain}`);
  }
}

function validateUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw cdpError("CDP_URL_INVALID", `Invalid URL: ${url}`);
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw cdpError("CDP_URL_DENIED", `URL protocol not allowed: ${parsed.protocol}`);
  }
}

function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms))
  ]);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function cdpError(code, message, details = {}) {
  const err = new Error(message);
  err.code = code;
  err.retryable = details.retryable !== false;
  err.details = details;
  return err;
}