import { parentPort, workerData } from "node:worker_threads";

let instance = null;

try {
  const module = await import(workerData.entry);
  if (typeof module.default !== "function") throw new Error("Payload entry must export a default factory function");
  instance = await module.default({
    mode: workerData.mode,
    capabilities: Object.freeze([...(workerData.manifest.capabilities || [])]),
    manifest: Object.freeze({
      name: workerData.manifest.name,
      version: workerData.manifest.version,
      type: workerData.manifest.type
    })
  });
  parentPort.postMessage({ type: "ready" });
} catch (error) {
  parentPort.postMessage({ type: "init_error", error: serializeError(error) });
}

parentPort.on("message", async (message) => {
  if (message.type !== "call") return;
  try {
    const fn = instance?.[message.method];
    if (typeof fn !== "function") {
      const error = new Error(`Payload method not found: ${message.method}`);
      error.code = "PAYLOAD_METHOD_NOT_FOUND";
      throw error;
    }
    const result = await fn(message.args || {});
    parentPort.postMessage({ id: message.id, ok: true, result });
  } catch (error) {
    parentPort.postMessage({ id: message.id, ok: false, error: serializeError(error) });
  }
});

function serializeError(error) {
  return { code: error?.code || "PAYLOAD_WORKER_ERROR", message: error?.message || String(error) };
}

