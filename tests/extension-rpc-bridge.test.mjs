import test from "node:test";
import assert from "node:assert/strict";
import { createExtensionRpcBridge } from "../native-host/src/extension-rpc-bridge.js";

test("extension bridge handshakes and resolves provider requests", async () => {
  const sent = [];
  const bridge = createExtensionRpcBridge({ idFactory: () => "request-1", timeoutMs: 2_000 });
  bridge.attach({ send: (value) => sent.push(JSON.parse(value)) });
  bridge.handleMessage(JSON.stringify({
    jsonrpc: "2.0",
    id: "hello",
    method: "runtime.hello",
    params: { extensionId: "test-extension", version: "1.3.0" }
  }));
  assert.equal(bridge.isConnected(), true);
  assert.equal(sent[0].result.protocol, "ti-provider/1");

  const resultPromise = bridge.request("provider.request", { provider: "minimax-agent-web" });
  assert.equal(sent[1].method, "provider.request");
  bridge.handleMessage(JSON.stringify({ jsonrpc: "2.0", id: "request-1", result: { text: "ok" } }));
  assert.deepEqual(await resultPromise, { text: "ok" });
});

test("extension bridge requires hello before requests", async () => {
  const bridge = createExtensionRpcBridge();
  bridge.attach({ send() {} });
  await assert.rejects(
    bridge.request("provider.request", {}),
    (error) => error.code === "EXTENSION_PROVIDER_UNAVAILABLE"
  );
});

test("extension bridge rejects unsupported client methods without leaking details", () => {
  const sent = [];
  const bridge = createExtensionRpcBridge();
  bridge.attach({ send: (value) => sent.push(JSON.parse(value)) });
  assert.equal(bridge.handleMessage(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "cookie.dump" })), false);
  assert.equal(sent[0].error.code, -32601);
});
