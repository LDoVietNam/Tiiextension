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

test("local API routes the Sub2API alias through native runtime configuration", async () => {
  const secret = "sub2api_local_api_secret";
  const api = createLocalApi({
    runtime: createRuntimeStub(),
    host: "127.0.0.1",
    port: 0,
    token: "test-token",
    allowedOrigins: ["chrome-extension://ojjbdgfmnedbnpadfnmgkolfmhipkefi"],
    env: {
      SUB2API_API_KEY: secret,
      SUB2API_BASE_URL: "https://sub2api.example.test/v1",
      SUB2API_MODEL: "sub2api-enabled-model",
    },
    fetchImpl: async (url, init) => {
      assert.equal(url, "https://sub2api.example.test/v1/chat/completions");
      assert.equal(init.headers.authorization, `Bearer ${secret}`);
      assert.equal(JSON.parse(init.body).model, "sub2api-enabled-model");
      return new Response(JSON.stringify({
        choices: [{ message: { role: "assistant", content: "sub2api ok" }, finish_reason: "stop" }],
      }), { headers: { "content-type": "application/json" } });
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
        provider: "sub2api",
        model: "sub2api/auto",
        messages: [{ role: "user", content: "ping" }],
      }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.provider, "sub2api-openai");
    assert.equal(body.choices[0].message.content, "sub2api ok");
    assert.equal(JSON.stringify(body).includes(secret), false);
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

test("agent model requests retry a provider and stream SSE deltas", async () => {
  const calls = [];
  const api = createLocalApi({
    runtime: createRuntimeStub(),
    host: "127.0.0.1",
    port: 0,
    token: "test-token",
    allowedOrigins: ["chrome-extension://ojjbdgfmnedbnpadfnmgkolfmhipkefi"],
    providerConnectors: {
      async dispatch() {
        throw new Error("non-stream dispatch should not be called");
      },
      async stream(request, onEvent) {
        calls.push(request.provider);
        if (calls.length === 1) {
          const error = new Error("rate limited");
          error.code = "PROVIDER_HTTP_ERROR";
          error.retryable = true;
          error.status = 429;
          throw error;
        }
        await onEvent({ choices: [{ delta: { content: "streamed" } }] });
        return { done: true };
      },
      getStatus() {
        return [];
      },
    },
  });
  const address = await api.listen();

  try {
    const response = await fetch(`${address.url}/v1/agent/model`, {
      method: "POST",
      headers: {
        Authorization: "Bearer test-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        provider: "sub2api",
        model: "sub2api/auto",
        messages: [{ role: "user", content: "ping" }],
        stream: true,
        max_retries: 1,
      }),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "text/event-stream; charset=utf-8");
    const body = await response.text();
    assert.match(body, /event: delta/);
    assert.match(body, /streamed/);
    assert.match(body, /event: done/);
    assert.deepEqual(calls, ["sub2api-openai", "sub2api-openai"]);
  } finally {
    await api.close();
  }
});
