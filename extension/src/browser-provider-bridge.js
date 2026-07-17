const BROWSER_PROVIDERS = Object.freeze({
  "chatgpt-web": {
    matches: ["https://chatgpt.com/*", "https://chat.openai.com/*"],
    requestType: "chatgpt.ask",
    statusType: "chatgpt.status",
    operations: ["chat.completions"]
  },
  "minimax-agent-web": {
    matches: ["https://agent.minimax.io/*", "https://www.minimax.io/*", "https://minimax.io/*"],
    requestType: "minimax.chat",
    statusType: "minimax.status",
    operations: ["chat.completions"]
  },
  "microsoft-designer-web": {
    matches: ["https://designer.microsoft.com/*", "https://*.designer.microsoft.com/*"],
    requestType: "ti-provider.request",
    statusType: "ti-provider.status",
    operations: ["images.generations"]
  },
  "deepai-web": {
    matches: ["https://deepai.org/*", "https://*.deepai.org/*"],
    requestType: "ti-provider.request",
    statusType: "ti-provider.status",
    operations: ["chat.completions", "images.generations"]
  },
  "felo-web": {
    matches: ["https://felo.ai/*", "https://*.felo.ai/*"],
    requestType: "ti-provider.request",
    statusType: "ti-provider.status",
    operations: ["chat.completions"]
  }
});

const PROVIDER_ALIASES = Object.freeze({
  chatgpt: "chatgpt-web",
  minimax: "minimax-agent-web",
  hailuo: "minimax-agent-web",
  "microsoft-designer": "microsoft-designer-web",
  designer: "microsoft-designer-web",
  deepai: "deepai-web",
  felo: "felo-web"
});

export async function executeBrowserProviderRequest(request, { tabsApi = chrome.tabs } = {}) {
  const normalized = normalizeRequest(request);
  const config = BROWSER_PROVIDERS[normalized.provider];
  if (!config) throw providerError("PROVIDER_NOT_FOUND", "Unknown browser provider");
  if (!config.operations.includes(normalized.operation)) {
    throw providerError("PROVIDER_OPERATION_UNSUPPORTED", `${normalized.provider} does not support ${normalized.operation}`);
  }

  const tab = await findProviderTab(config, tabsApi);
  if (!tab) {
    throw providerError(
      "PROVIDER_TAB_REQUIRED",
      `Open and sign in to ${normalized.provider} before using it as an upstream provider`,
      true
    );
  }

  const message = config.requestType === "chatgpt.ask"
    ? { type: config.requestType, payload: { prompt: extractPrompt(normalized.payload), timeoutMs: normalized.timeoutMs } }
    : { type: config.requestType, payload: normalized };
  const response = await tabsApi.sendMessage(tab.id, message);
  if (response?.ok === false) {
    throw providerError(response.error?.code || "PROVIDER_REQUEST_FAILED", safeMessage(response.error?.message || response.error), true);
  }
  const result = response?.result ?? response;
  return normalizeBrowserResult(normalized, result, tab);
}

export async function getBrowserProviderStatuses({ tabsApi = chrome.tabs } = {}) {
  const statuses = [];
  for (const [provider, config] of Object.entries(BROWSER_PROVIDERS)) {
    const tab = await findProviderTab(config, tabsApi);
    if (!tab) {
      statuses.push({ provider, ready: false, state: "tab_required", credentialsExported: false });
      continue;
    }
    try {
      const response = await tabsApi.sendMessage(tab.id, { type: config.statusType });
      const result = response?.result ?? response;
      statuses.push({ provider, ready: Boolean(result?.ready ?? result?.loggedIn), state: result?.state || "unknown", credentialsExported: false });
    } catch {
      statuses.push({ provider, ready: false, state: "adapter_unavailable", credentialsExported: false });
    }
  }
  return statuses;
}

export function listBrowserProviders() {
  return Object.entries(BROWSER_PROVIDERS).map(([id, config]) => ({ id, operations: [...config.operations], mode: "browser-session" }));
}

async function findProviderTab(config, tabsApi) {
  for (const pattern of config.matches) {
    const matches = await tabsApi.query({ url: pattern });
    const tab = matches.find((candidate) => Number.isInteger(candidate.id));
    if (tab) return tab;
  }
  return null;
}

function normalizeRequest(input) {
  if (!input || typeof input !== "object") throw providerError("PROVIDER_REQUEST_INVALID", "Provider request must be an object");
  const requested = String(input.provider || "").toLowerCase();
  const provider = PROVIDER_ALIASES[requested] || requested;
  if (!provider) throw providerError("PROVIDER_REQUEST_INVALID", "Provider is required");
  return {
    provider,
    operation: normalizeOperation(input.operation),
    model: typeof input.model === "string" ? input.model : null,
    payload: input.payload && typeof input.payload === "object" ? input.payload : input,
    timeoutMs: clampTimeout(input.timeoutMs || input.payload?.timeoutMs)
  };
}

function normalizeOperation(value) {
  const aliases = {
    chat: "chat.completions",
    "chat/completions": "chat.completions",
    image: "images.generations",
    "images/generations": "images.generations"
  };
  return aliases[value] || value || "chat.completions";
}

function normalizeBrowserResult(request, result, tab) {
  const base = {
    provider: request.provider,
    model: request.model,
    tab: { id: tab.id, origin: safeOrigin(tab.url) },
    credentialsExported: false
  };
  if (request.operation === "images.generations") {
    return { ...base, data: Array.isArray(result?.data) ? result.data : [] };
  }
  const text = typeof result === "string" ? result : result?.text;
  if (!text) throw providerError("PROVIDER_EMPTY_RESPONSE", "Browser provider returned no content", true);
  return { ...base, text };
}

function extractPrompt(payload) {
  if (typeof payload.prompt === "string") return payload.prompt;
  if (typeof payload.input === "string") return payload.input;
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  const message = [...messages].reverse().find((item) => item?.role === "user") || messages.at(-1);
  if (typeof message?.content === "string") return message.content;
  if (Array.isArray(message?.content)) return message.content.filter((part) => part?.type === "text").map((part) => part.text).join("\n");
  return "";
}

function safeOrigin(value) {
  try { return new URL(value).origin; } catch { return null; }
}

function safeMessage(value) {
  return String(value || "Provider failed")
    .replace(/(?:bearer\s+|api[_-]?key[=:]\s*|token[=:]\s*)[^\s,;]+/gi, "$1[REDACTED]")
    .slice(0, 1_000);
}

function clampTimeout(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(5_000, Math.min(parsed, 10 * 60_000)) : 180_000;
}

function providerError(code, message, retryable = false) {
  const error = new Error(message);
  error.code = code;
  error.retryable = retryable;
  return error;
}
