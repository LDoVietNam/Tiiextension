import assert from "node:assert/strict";
import test from "node:test";

import {
  createProviderConnectors,
  ProviderConnectorError,
  validateConnectorUrl,
} from "../native-host/src/provider-connectors.js";

function jsonResponse(value, { status = 200 } = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("browser-session requests use only the extension provider bridge", async () => {
  const calls = [];
  const extensionBridge = {
    async request(method, params, options) {
      calls.push({ method, params, options });
      return { text: "browser result", token: "must-not-leak" };
    },
  };
  const dispatch = createProviderConnectors({
    extensionBridge,
    fetchImpl: async () => assert.fail("browser provider must not use native fetch"),
    env: {},
  });

  const result = await dispatch({
    provider: "felo",
    operation: "chat.completions",
    model: "felo/chat-aggregator",
    payload: { messages: [{ role: "user", content: "hello" }] },
    timeoutMs: 5_000,
  });

  assert.deepEqual(result, { text: "browser result" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "provider.request");
  assert.equal(calls[0].params.provider, "felo-web");
  assert.equal(calls[0].params.operation, "chat.completions");
  assert.equal(calls[0].options.timeoutMs, 5_000);
  assert.equal(dispatch.dispatch, dispatch);
});

test("credential material in a provider request is rejected before dispatch", async () => {
  let called = false;
  const dispatch = createProviderConnectors({
    extensionBridge: { request: async () => { called = true; } },
    fetchImpl: async () => { called = true; },
    env: {},
  });
  await assert.rejects(
    dispatch({
      provider: "minimax-agent-web",
      payload: { headers: { authorization: "Bearer stolen" } },
    }),
    (error) => error instanceof ProviderConnectorError
      && error.code === "CREDENTIAL_FORWARDING_FORBIDDEN",
  );
  assert.equal(called, false);
});

test("FreeTheAI uses its configured HTTPS endpoint and runtime-only bearer key", async () => {
  const calls = [];
  const secret = "free_key_super_private";
  const dispatch = createProviderConnectors({
    env: {
      FREETHEAI_API_KEY: secret,
      FREETHEAI_BASE_URL: "https://gateway.example.test/v1",
    },
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse({
        id: "chatcmpl_test",
        choices: [{ message: { role: "assistant", content: "done" } }],
        authorization: secret,
        echoed: `prefix-${secret}-suffix`,
        usage: { total_tokens: 3 },
      });
    },
  });

  const result = await dispatch({
    provider: "freetheai",
    operation: "chat",
    model: "freetheai/auto",
    payload: { messages: [{ role: "user", content: "hi" }] },
  });
  assert.equal(calls[0].url, "https://gateway.example.test/v1/chat/completions");
  assert.equal(calls[0].init.headers.authorization, `Bearer ${secret}`);
  assert.equal(JSON.parse(calls[0].init.body).model, "auto");
  assert.equal(result.authorization, undefined);
  assert.equal(result.echoed, "prefix-[REDACTED]-suffix");
  assert.equal(result.usage.total_tokens, 3);
  assert.equal(JSON.stringify(result).includes(secret), false);
});

test("remote endpoints reject plaintext HTTP and URL credentials", async () => {
  assert.throws(
    () => validateConnectorUrl("http://api.example.test/v1", { kind: "remote" }),
    (error) => error.code === "CONNECTOR_URL_UNSAFE",
  );
  assert.throws(
    () => validateConnectorUrl("https://user:pass@api.example.test/v1", { kind: "remote" }),
    (error) => error.code === "CONNECTOR_URL_INVALID",
  );

  const dispatch = createProviderConnectors({
    env: {
      FREETHEAI_API_KEY: "configured_secret",
      FREETHEAI_BASE_URL: "http://api.example.test/v1",
    },
    fetchImpl: async () => assert.fail("unsafe endpoint must not be fetched"),
  });
  await assert.rejects(
    dispatch({ provider: "freetheai", payload: {} }),
    (error) => error.code === "CONNECTOR_URL_UNSAFE",
  );
});

test("Mixedbread embeddings preserve embedding payload and use runtime auth", async () => {
  const calls = [];
  const dispatch = createProviderConnectors({
    env: {
      MIXEDBREAD_API_KEY: "mixedbread_private_key",
      MIXEDBREAD_EMBEDDINGS_URL: "https://embed.example.test/custom",
      MIXEDBREAD_MODEL: "mxbai-embed-large-v1",
    },
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse({ data: [{ index: 0, embedding: [0.1, 0.2] }] });
    },
  });

  const result = await dispatch({
    model: "mixedbread/embeddings",
    operation: "embeddings",
    payload: { input: ["alpha", "beta"] },
  });
  assert.equal(calls[0].url, "https://embed.example.test/custom");
  assert.equal(calls[0].init.headers.authorization, "Bearer mixedbread_private_key");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    input: ["alpha", "beta"],
    model: "mxbai-embed-large-v1",
  });
  assert.deepEqual(result.data[0].embedding, [0.1, 0.2]);
});

test("TTS sidecars are loopback-only and binary audio is returned as base64", async () => {
  const dispatch = createProviderConnectors({
    env: { EDGE_TTS_SIDECAR_URL: "http://127.0.0.1:7860/v1/audio/speech" },
    fetchImpl: async (url, init) => {
      assert.equal(url, "http://127.0.0.1:7860/v1/audio/speech");
      assert.equal(JSON.parse(init.body).input, "xin chao");
      return new Response(Uint8Array.from([1, 2, 3]), {
        headers: { "content-type": "audio/mpeg" },
      });
    },
  });
  const result = await dispatch({
    provider: "edge-tts",
    operation: "audio.speech",
    payload: { input: "xin chao", voice: "vi-VN-HoaiMyNeural" },
  });
  assert.deepEqual(result, {
    data: Buffer.from([1, 2, 3]).toString("base64"),
    encoding: "base64",
    contentType: "audio/mpeg",
  });

  const unsafe = createProviderConnectors({
    env: { GTTS_SIDECAR_URL: "https://sidecar.example.test/v1/audio/speech" },
    fetchImpl: async () => assert.fail("non-loopback sidecar must not be fetched"),
  });
  await assert.rejects(
    unsafe({ provider: "gtts", operation: "audio.speech", payload: { input: "hello" } }),
    (error) => error.code === "CONNECTOR_URL_UNSAFE",
  );
});

test("Speechmatics and Gladia STT use provider-specific runtime auth", async () => {
  const calls = [];
  const dispatch = createProviderConnectors({
    env: {
      SPEECHMATICS_API_KEY: "speechmatics_private",
      SPEECHMATICS_STT_URL: "https://speech.example.test/jobs",
      GLADIA_API_KEY: "gladia_private",
      GLADIA_STT_URL: "https://gladia.example.test/pre-recorded",
    },
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse({ id: `job-${calls.length}`, status: "queued" });
    },
  });

  await dispatch({
    provider: "speechmatics",
    operation: "audio.transcriptions",
    payload: { audio_url: "https://media.example.test/sample.wav" },
  });
  await dispatch({
    provider: "gladia",
    operation: "audio.transcriptions",
    payload: { audio_url: "https://media.example.test/sample.wav" },
  });
  assert.equal(calls[0].init.headers.authorization, "Bearer speechmatics_private");
  assert.equal(calls[0].init.headers["x-gladia-key"], undefined);
  assert.equal(calls[1].init.headers["x-gladia-key"], "gladia_private");
  assert.equal(calls[1].init.headers.authorization, undefined);
});

test("upstream failures do not expose response bodies or thrown secrets", async () => {
  const secret = "token_super_secret_value";
  const httpFailure = createProviderConnectors({
    env: { FREETHEAI_API_KEY: secret },
    fetchImpl: async () => new Response(`authorization: Bearer ${secret}`, { status: 401 }),
  });
  await assert.rejects(
    httpFailure({ provider: "freetheai", payload: {} }),
    (error) => error.code === "PROVIDER_HTTP_ERROR"
      && error.status === 401
      && !error.message.includes(secret),
  );

  const networkFailure = createProviderConnectors({
    env: { FREETHEAI_API_KEY: secret },
    fetchImpl: async () => { throw new Error(`Bearer ${secret}`); },
  });
  await assert.rejects(
    networkFailure({ provider: "freetheai", payload: {} }),
    (error) => error.code === "PROVIDER_NETWORK_ERROR"
      && !error.message.includes(secret),
  );
});
