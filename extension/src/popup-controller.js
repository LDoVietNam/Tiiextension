function normaliseResponse(response) {
  if (response?.ok === false) {
    const error = new Error(response.error?.message || "Backend request failed");
    error.code = response.error?.code || "BACKEND_REQUEST_FAILED";
    throw error;
  }
  return response?.result ?? response ?? {};
}

export function initializePopup({
  documentRef = document,
  sendMessage = (message) => chrome.runtime.sendMessage(message),
} = {}) {
  const status = documentRef.getElementById("runtime-status");
  const startButton = documentRef.getElementById("start-backend");
  const stopButton = documentRef.getElementById("stop-backend");
  const panelButton = documentRef.getElementById("open-panel");

  function render(text) {
    if (status) status.textContent = text;
  }

  async function run(button, type) {
    if (button) button.disabled = true;
    try {
      normaliseResponse(await sendMessage({ type, payload: {} }));
      return await refresh();
    } catch (error) {
      render(`${error.code || "BACKEND_ERROR"}: ${error.message}`);
      return null;
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function refresh() {
    try {
      const result = normaliseResponse(await sendMessage({ type: "orchestrator.status", payload: {} }));
      render(result.connected ? "Native runtime connected" : "Native runtime offline");
      return result;
    } catch (error) {
      render(`${error.code || "BACKEND_OFFLINE"}: ${error.message}`);
      return null;
    }
  }

  const controller = {
    refresh,
    start: () => run(startButton, "orchestrator.up"),
    stop: () => run(stopButton, "orchestrator.down"),
    openPanel: () => run(panelButton, "sidepanel.open"),
  };
  startButton?.addEventListener("click", controller.start);
  stopButton?.addEventListener("click", controller.stop);
  panelButton?.addEventListener("click", controller.openPanel);
  return controller;
}

if (typeof document !== "undefined") {
  const controller = initializePopup();
  controller.refresh();
}
