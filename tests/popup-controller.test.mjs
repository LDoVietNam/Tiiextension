import assert from "node:assert/strict";
import test from "node:test";

import { initializePopup } from "../extension/src/popup-controller.js";

function createPopupDocument() {
  const elements = new Map();
  for (const id of ["runtime-status", "start-backend", "stop-backend", "open-panel"]) {
    elements.set(id, {
      id,
      textContent: "",
      disabled: false,
      listeners: new Map(),
      addEventListener(type, listener) { this.listeners.set(type, listener); },
    });
  }
  return { getElementById: (id) => elements.get(id) || null, elements };
}

test("popup routes start and stop through the background", async () => {
  const calls = [];
  const popup = initializePopup({
    documentRef: createPopupDocument(),
    sendMessage: async (message) => {
      calls.push(message.type);
      return { ok: true, result: { connected: message.type !== "orchestrator.down" } };
    },
  });

  await popup.start();
  await popup.stop();
  assert.deepEqual(calls, ["orchestrator.up", "orchestrator.status", "orchestrator.down", "orchestrator.status"]);
});

test("popup renders a typed backend error", async () => {
  const documentRef = createPopupDocument();
  const popup = initializePopup({
    documentRef,
    sendMessage: async () => ({ ok: false, error: { code: "BACKEND_OFFLINE", message: "Backend unavailable" } }),
  });
  await popup.refresh();
  assert.match(documentRef.elements.get("runtime-status").textContent, /BACKEND_OFFLINE/);
});
