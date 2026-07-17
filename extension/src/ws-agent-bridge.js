// ws-agent-bridge.js - WebSocket JSON-RPC bridge connecting Tiiextension to TiRouter (CLIProxyAPI)

const DEFAULT_WS_URL = "ws://127.0.0.1:9000/v1/extension";
let socket = null;
let reconnectTimer = null;
let authorized = false;
const pendingRequests = new Map();

// Initialize the WebSocket connection
export function initWsBridge() {
  if (socket) return;
  connect();
  setupMessageListener();
}

function connect() {
  const wsUrl = DEFAULT_WS_URL;
  console.log(`Connecting to Ti Router Bridge: ${wsUrl}`);
  
  socket = new WebSocket(wsUrl);

  socket.onopen = () => {
    console.log("WebSocket connection established. Sending handshake...");
    sendHandshake();
  };

  socket.onmessage = async (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.method) {
        await handleIncomingRequest(data);
      } else if (data.id !== undefined) {
        // Match response to pending request
        const resolve = pendingRequests.get(data.id);
        if (resolve) {
          pendingRequests.delete(data.id);
          resolve(data);
        }
      }
    } catch (err) {
      console.error("Failed to parse WebSocket message:", err);
    }
  };

  socket.onclose = (event) => {
    console.warn(`WebSocket connection closed: ${event.reason}. Reconnecting in 5s...`);
    cleanup();
    scheduleReconnect();
  };

  socket.onerror = (err) => {
    console.error("WebSocket error observed:", err);
  };
}

function cleanup() {
  socket = null;
  authorized = false;
  // Reject all pending requests
  for (const [id, resolve] of pendingRequests) {
    resolve({ error: { code: -32099, message: "Connection closed" } });
  }
  pendingRequests.clear();
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    connect();
  }, 5000);
}

// Send runtime.hello handshake request if we have a session ID
function sendHandshake() {
  chrome.storage.local.get(["tiSessionId"], (res) => {
    if (!res.tiSessionId) {
      console.log("No stored session ID. Awaiting pairing...");
      return;
    }

    const msg = {
      jsonrpc: "2.0",
      method: "runtime.hello",
      params: {
        sessionId: res.tiSessionId
      },
      id: "handshake_1"
    };
    sendJsonRpcMessage(msg);
  });
}

function sendJsonRpcMessage(msg) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error("Socket not open"));
  
  return new Promise((resolve) => {
    if (msg.id !== undefined) {
      pendingRequests.set(msg.id, resolve);
    }
    socket.send(JSON.stringify(msg));
  });
}

// Handle messages sent from sidepanel.js
function setupMessageListener() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "ws.pair") {
      const code = message.payload.code;
      const reqId = `pair_${Date.now()}`;
      
      sendJsonRpcMessage({
        jsonrpc: "2.0",
        method: "runtime.pair",
        params: { code },
        id: reqId
      }).then((resp) => {
        if (resp.result && resp.result.sessionId) {
          chrome.storage.local.set({ tiSessionId: resp.result.sessionId }, () => {
            authorized = true;
            sendResponse({ ok: true });
          });
        } else {
          sendResponse({ ok: false, error: resp.error || { message: "Pairing failed" } });
        }
      }).catch((err) => {
        sendResponse({ ok: false, error: { message: err.message } });
      });

      return true; // Keep channel open for async response
    }
  });
}

// Route and process incoming RPC requests from TiRouter
async function handleIncomingRequest(req) {
  const { id, method, params = {} } = req;
  
  try {
    let result = null;
    switch (method) {
      case "browser.session.get":
        result = await getBrowserSession(params);
        break;
      case "browser.context.capture":
        result = await captureBrowserContext(params);
        break;
      case "browser.action.execute":
        result = await executeBrowserAction(params);
        break;
      default:
        throw { code: -32601, message: `Method not found: ${method}` };
    }
    
    sendResponse(id, result, null);
  } catch (err) {
    console.error(`Error handling method ${method}:`, err);
    sendResponse(id, null, {
      code: err.code || -32000,
      message: err.message || String(err)
    });
  }
}

function sendResponse(id, result, error) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  
  const resp = {
    jsonrpc: "2.0",
    id,
    result,
    error
  };
  socket.send(JSON.stringify(resp));
}

// Implement browser.session.get
async function getBrowserSession(params) {
  const urlFilter = params.url || "";
  
  // 1. Get cookies
  let cookies = [];
  try {
    const query = urlFilter ? { url: urlFilter } : {};
    cookies = await chrome.cookies.getAll(query);
  } catch (err) {
    console.warn("Failed to retrieve cookies:", err);
  }

  // 2. Get local & session storage from active tab
  let localStorageData = {};
  let sessionStorageData = {};
  
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id && !tab.url.startsWith("chrome://")) {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          return {
            localStorage: { ...localStorage },
            sessionStorage: { ...sessionStorage }
          };
        }
      });
      if (results && results[0] && results[0].result) {
        localStorageData = results[0].result.localStorage;
        sessionStorageData = results[0].result.sessionStorage;
      }
    }
  } catch (err) {
    console.warn("Failed to retrieve tab storage:", err);
  }

  return {
    cookies: cookies.map(c => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      secure: c.secure,
      httpOnly: c.httpOnly
    })),
    localStorage: localStorageData,
    sessionStorage: sessionStorageData
  };
}

// Implement browser.context.capture
async function captureBrowserContext(params) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error("No active tab found");

  let screenshot = "";
  if (params.screenshot !== false) {
    try {
      screenshot = await chrome.tabs.captureVisibleTab(null, { format: "jpeg", quality: 80 });
    } catch (err) {
      console.warn("Failed to capture tab screenshot:", err);
    }
  }

  let domTree = "";
  try {
    if (tab.id && !tab.url.startsWith("chrome://")) {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => document.documentElement.outerHTML
      });
      if (results && results[0]) {
        domTree = results[0].result;
      }
    }
  } catch (err) {
    console.warn("Failed to capture tab DOM:", err);
  }

  return {
    title: tab.title,
    url: tab.url,
    screenshot,
    domTree
  };
}

// Implement browser.action.execute
async function executeBrowserAction(params) {
  const { action, selector, text } = params;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error("No active tab found");

  if (tab.url.startsWith("chrome://")) {
    throw new Error("Cannot automate chrome:// pages");
  }

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    args: [action, selector, text || ""],
    func: (action, selector, text) => {
      const element = document.querySelector(selector);
      if (!element) return { success: false, error: `Element not found: ${selector}` };
      
      if (action === "click") {
        element.click();
        return { success: true };
      } else if (action === "type") {
        element.value = text;
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        return { success: true };
      }
      
      return { success: false, error: `Unsupported action: ${action}` };
    }
  });

  if (results && results[0] && results[0].result) {
    return results[0].result;
  }
  
  throw new Error("Action execution failed without returning a status");
}
