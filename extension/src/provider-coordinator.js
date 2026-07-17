// Provider coordinator for background service
// Serializes ChatGPT Web (content-script) requests per tab and supports timeout/cancel.
// Gateway/routing automation lives in ./provider-gateway.js

export function createProviderCoordinator(adapter, opts = {}) {
  const idFactory = opts.idFactory || (() => `r${Math.random().toString(36).slice(2)}`);
  const queue = new Map(); // tabId -> array of pending requests
  const inflight = new Map(); // requestId -> { abort, timer }

  async function request(tabId, { prompt, requestId, timeoutMs = 180000 } = {}, options = {}) {
    const id = requestId || idFactory();
    if (!queue.has(tabId)) queue.set(tabId, []);
    const list = queue.get(tabId);

    const run = async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      inflight.set(id, { abort: () => controller.abort(), timer });
      try {
        const result = await adapter.ask({ tabId, prompt, requestId: id, signal: controller.signal });
        return result;
      } catch (error) {
        if (error.name === "AbortError" || controller.signal.aborted) {
          const e = new Error("Provider response timed out");
          e.code = "PROVIDER_RESPONSE_TIMEOUT";
          e.retryable = true;
          throw e;
        }
        throw error;
      } finally {
        clearTimeout(timer);
        inflight.delete(id);
      }
    };

    // Serialize per tab: wait for prior requests on this tab.
    const prev = list[list.length - 1];
    if (prev) {
      try { await prev; } catch { /* continue regardless */ }
    }
    const promise = run();
    list.push(promise);
    // Clean up resolved promises.
    promise.finally(() => {
      const idx = list.indexOf(promise);
      if (idx !== -1) list.splice(idx, 1);
    });
    return promise;
  }

  function cancel(requestId) {
    const entry = inflight.get(requestId);
    if (!entry) return false;
    clearTimeout(entry.timer);
    entry.abort();
    return true;
  }

  function status() {
    return {
      queuedTabs: queue.size,
      inflight: inflight.size
    };
  }

  return { request, cancel, status };
}
