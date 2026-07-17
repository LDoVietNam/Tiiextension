import assert from "node:assert/strict";
import test from "node:test";

import { createLocalApi } from "../native-host/src/local-api.js";

function createRuntimeStub() {
  return {
    config: { mode: "dev" },
    events: {
      async list() {
        return { events: [] };
      },
      subscribe() {
        return () => {};
      },
    },
    artifacts: {
      async read() {
        return {
          metadata: { mime_type: "text/plain", sha256: "abc" },
          data: Buffer.from("artifact"),
        };
      },
    },
    async handle(message) {
      if (message.type === "runtime.handshake") {
        return { host_version: "1.3.0", protocol: "cnagent/1" };
      }
      throw new Error(`Unexpected runtime message: ${message.type}`);
    },
  };
}

test("local API exposes raw OpenAI-compatible model listing", async () => {
  const api = createLocalApi({
    runtime: createRuntimeStub(),
    host: "127.0.0.1",
    port: 0,
    token: "test-token",
    allowedOrigins: ["chrome-extension://ojjbdgfmnedbnpadfnmgkolfmhipkefi"],
    providerConnectors: {
      async dispatch() {
        throw new Error("dispatch should not be called");
      },
      getStatus() {
        return [];
      },
    },
  });
  const address = await api.listen();

  try {
    const response = await fetch(`${address.url}/v1/models`, {
      headers: { Authorization: "Bearer test-token" },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.object, "list");
    assert.ok(Array.isArray(body.data));
    assert.equal(Object.prototype.hasOwnProperty.call(body, "ok"), false);
  } finally {
    await api.close();
  }
});

test("local API chat completions route uses upstream router shape", async () => {
  const api = createLocalApi({
    runtime: createRuntimeStub(),
    host: "127.0.0.1",
    port: 0,
    token: "test-token",
    allowedOrigins: ["chrome-extension://ojjbdgfmnedbnpadfnmgkolfmhipkefi"],
    providerConnectors: {
      async dispatch(request) {
        assert.equal(request.operation, "chat.completions");
        return { text: "hello from provider" };
      },
      getStatus() {
        return [];
      },
    },
  });
  const address = await api.listen();

  try {
    const response = await fetch(`${address.url}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: "Bearer test-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        provider: "felo",
        model: "felo/chat-aggregator",
        messages: [{ role: "user", content: "hi" }],
      }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.object, "chat.completion");
    assert.equal(body.choices[0].message.content, "hello from provider");
  } finally {
    await api.close();
  }
});

test("local API rejects unauthenticated model requests", async () => {
  const api = createLocalApi({
    runtime: createRuntimeStub(),
    host: "127.0.0.1",
    port: 0,
    token: "test-token",
    allowedOrigins: ["chrome-extension://ojjbdgfmnedbnpadfnmgkolfmhipkefi"],
    providerConnectors: {
      async dispatch() {
        throw new Error("dispatch should not be called");
      },
      getStatus() {
        return [];
      },
    },
  });
  const address = await api.listen();

  try {
    const response = await fetch(`${address.url}/v1/models`);
    assert.equal(response.status, 401);
    const body = await response.json();
    assert.equal(body.error.code, "API_UNAUTHORIZED");
  } finally {
    await api.close();
  }
});
