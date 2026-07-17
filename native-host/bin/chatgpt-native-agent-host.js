#!/usr/bin/env node
import { NativeMessageDecoder, encodeNativeMessage } from "../src/native-framing.js";
import { createRuntime } from "../src/runtime.js";

const runtime = await createRuntime();
const decoder = new NativeMessageDecoder({ maxBytes: 64 * 1024 * 1024 });
let queue = Promise.resolve();
let shuttingDown = false;

process.stdin.on("data", (chunk) => {
  if (shuttingDown) return;
  try {
    for (const message of decoder.push(chunk)) {
      queue = queue.then(() => handleMessage(message));
    }
  } catch (error) {
    writeResponse({ id: null, ok: false, error: serializeError(error) });
    shutdown(1).catch(() => process.exit(1));
  }
});

process.stdin.on("end", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
process.on("SIGINT", () => shutdown(0));

async function handleMessage(message) {
  try {
    const result = await runtime.handle(message);
    writeResponse({ id: message?.id || null, ok: true, result });
  } catch (error) {
    writeResponse({ id: message?.id || null, ok: false, error: serializeError(error) });
  }
}

function writeResponse(message) {
  try {
    process.stdout.write(encodeNativeMessage(message));
  } catch (error) {
    const fallback = {
      id: message.id || null,
      ok: false,
      error: serializeError(error)
    };
    process.stdout.write(encodeNativeMessage(fallback));
  }
}

function serializeError(error) {
  return {
    code: error?.code || "NATIVE_INTERNAL_ERROR",
    message: error?.message || String(error),
    retryable: Boolean(error?.retryable),
    ...(error?.details !== undefined ? { details: error.details } : {})
  };
}

async function shutdown(exitCode) {
  if (shuttingDown) return;
  shuttingDown = true;
  await queue.catch(() => {});
  await runtime.close();
  process.exitCode = exitCode;
}

