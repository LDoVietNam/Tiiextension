import assert from "node:assert/strict";
import test from "node:test";

import { createUpstreamRouter } from "../native-host/src/upstream-router.js";

test("router lists public upstream models in OpenAI-compatible shape", async () => {
  const router = createUpstreamRouter({
    connectors: {
      async dispatch() {
        throw new Error("dispatch should not be called");
      },
      getStatus() {
        return [];
      },
    },
    now: () => Date.parse("2026-07-15T00:00:00.000Z"),
  });

  const result = await router.listModels();
  assert.equal(result.object, "list");
  assert.ok(result.data.some((model) => model.id === "hailuoai/minimax-agent-web"));
  assert.ok(result.data.some((model) => model.id === "mixedbread/embeddings"));
});

test("router normalizes browser text providers to chat completions", async () => {
  const calls = [];
  const router = createUpstreamRouter({
    connectors: {
      async dispatch(request) {
        calls.push(request);
        return { text: "hello from browser provider" };
      },
      getStatus() {
        return [];
      },
    },
    now: () => Date.parse("2026-07-15T00:00:00.000Z"),
    idFactory: () => "chatcmpl_test",
  });

  const result = await router.dispatchOperation("chat.completions", {
    provider: "felo",
    model: "felo/chat-aggregator",
    messages: [{ role: "user", content: "hi" }],
  });

  assert.equal(calls[0].provider, "felo-chat");
  assert.equal(result.id, "chatcmpl_test");
  assert.equal(result.object, "chat.completion");
  assert.equal(result.choices[0].message.content, "hello from browser provider");
});

test("router preserves embedding payloads and provider metadata", async () => {
  const router = createUpstreamRouter({
    connectors: {
      async dispatch() {
        return {
          data: [{ index: 0, embedding: [0.25, 0.5] }],
          usage: { prompt_tokens: 4, total_tokens: 4 },
        };
      },
      getStatus() {
        return [{ provider: "mixedbread-embeddings", configured: true, mode: "remote-api" }];
      },
    },
  });

  const result = await router.dispatchOperation("embeddings", {
    model: "mixedbread/embeddings",
    input: ["alpha"],
  });
  assert.equal(result.model, "mixedbread/embeddings");
  assert.equal(result.provider, "mixedbread-embeddings");
  assert.deepEqual(result.data[0].embedding, [0.25, 0.5]);
});
