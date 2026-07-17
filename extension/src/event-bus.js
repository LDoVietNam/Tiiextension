// event-bus.js
// Event-driven architecture pattern from ChatGPT Codex
// JSON-RPC 2.0 style message bus for extension communication

const EVENT_CHANNELS = new Map(); // channel -> Set<callback>
const RPC_HANDLERS = new Map();   // method -> handler function
const RPCS_IN_FLIGHT = new Map();  // requestId -> { resolve, reject, timer }

let nextRequestId = 1;

export function getEventBus() {
  return {
    // Event pub/sub (one-to-many)
    emit,
    on,
    off,
    once,

    // RPC request/response (one-to-one)
    register,
    unregister,
    call,
    respond,

    // Utilities
    clear,
    getStats: () => ({
      channels: EVENT_CHANNELS.size,
      handlers: RPC_HANDLERS.size,
      inFlight: RPCS_IN_FLIGHT.size
    })
  };
}

/**
 * Emit an event to all listeners on a channel.
 * Pattern from Codex: sendNotification with event name
 */
function emit(channel, data = {}) {
  const listeners = EVENT_CHANNELS.get(channel);
  if (!listeners || listeners.size === 0) return false;

  const event = {
    channel,
    data,
    timestamp: Date.now()
  };

  for (const cb of listeners) {
    try {
      cb(event);
    } catch (err) {
      console.warn(`[EventBus] Error in listener for "${channel}":`, err);
    }
  }
  return true;
}

/**
 * Register an event listener.
 * Returns unsubscribe function.
 */
function on(channel, callback) {
  if (!EVENT_CHANNELS.has(channel)) {
    EVENT_CHANNELS.set(channel, new Set());
  }
  EVENT_CHANNELS.get(channel).add(callback);
  return () => off(channel, callback);
}

/**
 * Remove an event listener.
 */
function off(channel, callback) {
  const listeners = EVENT_CHANNELS.get(channel);
  if (!listeners) return;
  listeners.delete(callback);
  if (listeners.size === 0) {
    EVENT_CHANNELS.delete(channel);
  }
}

/**
 * Listen for the next event on a channel, then remove.
 */
function once(channel, timeoutMs = null) {
  return new Promise((resolve, reject) => {
    const timer = timeoutMs ? setTimeout(() => {
      off(channel, handler);
      reject(new Error(`Event "${channel}" timed out after ${timeoutMs}ms`));
    }, timeoutMs) : null;

    const handler = (event) => {
      if (timer) clearTimeout(timer);
      resolve(event);
    };

    on(channel, handler);
  });
}

/**
 * Register an RPC handler.
 * Pattern from Codex: registerRequestHandler
 */
function register(method, handler) {
  if (RPC_HANDLERS.has(method)) {
    console.warn(`[EventBus] Overwriting existing RPC handler for "${method}"`);
  }
  RPC_HANDLERS.set(method, handler);
  return () => RPC_HANDLERS.delete(method);
}

/**
 * Unregister an RPC handler.
 */
function unregister(method) {
  RPC_HANDLERS.delete(method);
}

/**
 * Make an RPC call and wait for response.
 * Pattern from Codex: sendRequest with requestId
 */
function call(method, params = {}, { timeoutMs = 30000, target } = {}) {
  const requestId = `rpc_${Date.now()}_${nextRequestId++}`;

  // If a target (port/messenger) is provided, send through it
  if (target) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        RPCS_IN_FLIGHT.delete(requestId);
        reject(new Error(`RPC "${method}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      RPCS_IN_FLIGHT.set(requestId, { resolve, reject, timer });

      try {
        target.postMessage({
          jsonrpc: "2.0",
          id: requestId,
          method,
          params
        });
      } catch (err) {
        clearTimeout(timer);
        RPCS_IN_FLIGHT.delete(requestId);
        reject(err);
      }
    });
  }

  // Local RPC: find handler and call directly
  const handler = RPC_HANDLERS.get(method);
  if (!handler) {
    return Promise.reject(new Error(`No RPC handler registered for "${method}"`));
  }

  return Promise.resolve(handler(params));
}

/**
 * Respond to an RPC call (used by message listeners).
 */
function respond(requestId, result) {
  const pending = RPCS_IN_FLIGHT.get(requestId);
  if (!pending) return false;

  clearTimeout(pending.timer);
  RPCS_IN_FLIGHT.delete(requestId);

  if (result instanceof Error) {
    pending.reject(result);
  } else {
    pending.resolve(result);
  }
  return true;
}

/**
 * Clear all listeners and handlers.
 */
function clear() {
  EVENT_CHANNELS.clear();
  RPC_HANDLERS.clear();
  for (const [, pending] of RPCS_IN_FLIGHT) {
    clearTimeout(pending.timer);
    pending.reject(new Error("Event bus cleared"));
  }
  RPCS_IN_FLIGHT.clear();
}