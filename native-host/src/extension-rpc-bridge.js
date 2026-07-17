import crypto from "node:crypto";

const DEFAULT_TIMEOUT_MS = 180_000;

/**
 * Creates a single-client JSON-RPC bridge for the browser extension.
 * Authentication is performed during the WebSocket HTTP upgrade by the
 * caller; this object deliberately never accepts or forwards browser
 * credentials.
 */
export function createExtensionRpcBridge({
  timeoutMs = DEFAULT_TIMEOUT_MS,
  idFactory = () => `ext_${crypto.randomUUID()}`
} = {}) {
  let connection = null;
  let clientInfo = null;
  const pending = new Map();

  function attach(nextConnection) {
    if (!nextConnection || typeof nextConnection.send !== "function") {
      throw bridgeError("EXTENSION_CONNECTION_INVALID", "A WebSocket connection is required");
    }
    detach("Extension connection replaced");
    connection = nextConnection;
  }

  function detach(reason = "Extension disconnected") {
    connection = null;
    clientInfo = null;
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(bridgeError("EXTENSION_DISCONNECTED", reason, { retryable: true }));
    }
    pending.clear();
  }

  function isConnected() {
    return Boolean(connection && clientInfo);
  }

  function getStatus() {
    return {
      connected: isConnected(),
      client: clientInfo ? { ...clientInfo } : null,
      pending: pending.size
    };
  }

  function handleMessage(rawMessage) {
    let message;
    try {
      message = typeof rawMessage === "string" ? JSON.parse(rawMessage) : rawMessage;
    } catch {
      throw bridgeError("EXTENSION_RPC_PARSE_ERROR", "Extension sent invalid JSON");
    }
    if (!message || message.jsonrpc !== "2.0") {
      throw bridgeError("EXTENSION_RPC_INVALID", "Extension message must use JSON-RPC 2.0");
    }

    if (message.method) return handleRequest(message);
    if (message.id === undefined || message.id === null) return false;

    const entry = pending.get(String(message.id));
    if (!entry) return false;
    pending.delete(String(message.id));
    clearTimeout(entry.timer);
    if (message.error) {
      entry.reject(bridgeError(
        message.error.code || "EXTENSION_PROVIDER_ERROR",
        safeMessage(message.error.message),
        { retryable: Boolean(message.error.retryable) }
      ));
    } else {
      entry.resolve(message.result);
    }
    return true;
  }

  function handleRequest(message) {
    if (message.method !== "runtime.hello") {
      if (message.id !== undefined) send({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32601, message: "Method not found" }
      });
      return false;
    }

    const params = message.params && typeof message.params === "object" ? message.params : {};
    clientInfo = {
      extensionId: safeIdentifier(params.extensionId),
      version: safeIdentifier(params.version),
      protocol: "ti-provider/1",
      connectedAt: new Date().toISOString()
    };
    if (message.id !== undefined) send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocol: "ti-provider/1",
        runtimeVersion: "1.3.0",
        capabilities: ["provider.list", "provider.status", "provider.request", "browser.session.analyze"]
      }
    });
    return true;
  }

  function request(method, params = {}, options = {}) {
    if (!isConnected()) {
      return Promise.reject(bridgeError(
        "EXTENSION_PROVIDER_UNAVAILABLE",
        "No authenticated Tiiextension client is connected",
        { retryable: true }
      ));
    }
    if (typeof method !== "string" || !method.trim()) {
      return Promise.reject(bridgeError("EXTENSION_RPC_INVALID", "RPC method is required"));
    }

    const id = String(idFactory());
    const requestTimeout = clampTimeout(options.timeoutMs ?? timeoutMs);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(bridgeError("EXTENSION_PROVIDER_TIMEOUT", "Browser provider timed out", { retryable: true }));
      }, requestTimeout);
      pending.set(id, { resolve, reject, timer });
      try {
        send({ jsonrpc: "2.0", id, method, params });
      } catch (error) {
        clearTimeout(timer);
        pending.delete(id);
        reject(error);
      }
    });
  }

  function send(message) {
    if (!connection) throw bridgeError("EXTENSION_DISCONNECTED", "Extension is not connected", { retryable: true });
    connection.send(JSON.stringify(message));
  }

  return { attach, detach, handleMessage, request, isConnected, getStatus };
}

function clampTimeout(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_TIMEOUT_MS;
  return Math.max(1_000, Math.min(parsed, 10 * 60_000));
}

function safeIdentifier(value) {
  return typeof value === "string" ? value.slice(0, 128) : null;
}

function safeMessage(value) {
  const message = typeof value === "string" ? value : "Browser provider failed";
  return message
    .replace(/(?:bearer\s+|api[_-]?key[=:]\s*|token[=:]\s*)[^\s,;]+/gi, "$1[REDACTED]")
    .slice(0, 1_000);
}

function bridgeError(code, message, { retryable = false } = {}) {
  const error = new Error(message);
  error.code = code;
  error.retryable = retryable;
  return error;
}
