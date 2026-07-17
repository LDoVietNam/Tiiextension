// provider-gateway.js
// Automation layer: routes the extension's "model" path through the Tirouter AI Gateway Hub
// (CLIProxyAPI on 20128 / OmniRoute on 1807) which already aggregates ChatGPT/Claude/Gemini/
// Grok/DeepSeek as OpenAI-compatible models. This makes "multi-site AI chat" = "select model
// from gateway" instead of writing brittle per-site DOM adapters.
//
// Features:
//  - Auto-discovery: pings gateway health, reorders fallback chain by reachability (cached).
//  - Auto model catalog: pulls live /v1/models from the first reachable gateway.
//  - Auto fallback: walks provider chain, then last-resort ChatGPT Web DOM (real model).

import {
  PROVIDER_ENDPOINTS,
  PROVIDER_FALLBACK_ORDER,
  GATEWAY_CANDIDATES,
  getProviderConfig,
  mapRouterModel
} from "./provider-presets.js";
import { tabs, storage } from './browser-polyfill.js';

// Cache of auto-discovered, reachable gateways (avoid re-pinging every call).
let _discoveredOrder = null;
let _discoveredAt = 0;
const DISCOVERY_TTL_MS = 60_000;

// Auto-discover gateways: ping health, return reachable provider ids ordered by priority.
export async function discoverGateways() {
  const now = Date.now();
  if (_discoveredOrder && now - _discoveredAt < DISCOVERY_TTL_MS) return _discoveredOrder;

  const reachable = [];
  await Promise.all(
    GATEWAY_CANDIDATES.map(async (gw) => {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 800);
        const res = await fetch(`${gw.baseUrl.replace(/\/v1$/, "")}/health`, {
          signal: ctrl.signal
        }).catch(() => null);
        clearTimeout(t);
        if (res && res.ok) reachable.push(gw.id);
      } catch {
        /* unreachable */
      }
    })
  );

  // Discovered gateways first (preserving static priority), then the rest.
  const discoveredSet = new Set(reachable);
  _discoveredOrder = [
    ...PROVIDER_FALLBACK_ORDER.filter((id) => discoveredSet.has(id)),
    ...PROVIDER_FALLBACK_ORDER.filter((id) => !discoveredSet.has(id))
  ];
  _discoveredAt = now;
  return _discoveredOrder;
}

// Auto-build model list from gateway /v1/models when available; null if none reachable.
export async function fetchGatewayModels() {
  const order = await discoverGateways();
  for (const id of order) {
    const cfg = getProviderConfig(id);
    if (!cfg || cfg.type === "browser") continue;
    try {
      const res = await fetch(`${cfg.baseUrl}/models`, {
        headers: cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}
      });
      if (!res.ok) continue;
      const data = await res.json();
      const models = (data.data || []).map((m) => m.id).filter(Boolean);
      if (models.length) return { provider: id, models };
    } catch {
      /* try next */
    }
  }
  return null;
}

export async function callWithFallback(messages, { provider, model } = {}) {
  const selectedProvider = provider || (await getSavedProvider()) || (await discoverGateways())[0];
  const selectedModel = mapRouterModel(model || (await getSavedModel()) || "gpt-5.4");

  const modelChain = buildModelChain(selectedModel);
  const order = await discoverGateways();

  for (const providerName of order) {
    const config = getProviderConfig(providerName);
    if (!config || config.type === "browser") continue;

    for (const modelId of modelChain) {
      try {
        const result = await callProvider(config, modelId, messages);
        if (result?.ok) return result;
      } catch (err) {
        console.warn(`[ProviderGateway] ${providerName}/${modelId} failed:`, err.message);
      }
    }
  }

  // Last resort: ChatGPT Web DOM (real model) if user has the tab open.
  try {
    const domResult = await callChatGptWeb(modelChain, messages);
    if (domResult?.ok) return domResult;
  } catch (err) {
    console.warn(`[ProviderGateway] chatgpt-web fallback failed:`, err.message);
  }

  throw new Error("All providers exhausted - no successful response");
}

async function callChatGptWeb(modelChain, messages) {
  const last = messages[messages.length - 1]?.content || "";
  const tabsList = await tabs.query({ url: ["https://chatgpt.com/*", "https://chat.openai.com/*"] });
  if (!tabsList.length) return null;
  const resp = await tabs.sendMessage(tabsList[0].id, {
    type: "chatgpt.ask",
    payload: { prompt: last }
  });
  if (resp?.ok) return { ok: true, text: resp.result, provider: "chatgpt-web", model: "web" };
  return null;
}

async function callProvider(config, modelId, messages) {
  const headers = { "Content-Type": "application/json" };

  // Resolve API key: static config OR dynamic per-provider storage key.
  let apiKey = config.apiKey;
  if (!apiKey && config.baseUrl?.includes("localhost:8080")) {
    // Freebuff2API: load token stored via popup settings (key: "freebuffToken").
    const stored = await storage.local.get("freebuffToken").catch(() => ({}));
    apiKey = stored.freebuffToken || null;
  }

  if (apiKey && apiKey !== "therouter-proxy-key") {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({ model: modelId, messages, stream: false })
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    if (response.status === 404 || response.status === 400) return null;
    throw new Error(error.error?.message || response.statusText);
  }

  const data = await response.json();
  return {
    ok: true,
    text: data.choices?.[0]?.message?.content,
    model: modelId,
    provider: config.baseUrl
  };
}

async function getSavedProvider() {
  const stored = await storage.local.get("selectedProvider");
  return stored.selectedProvider;
}

async function getSavedModel() {
  const stored = await storage.local.get("selectedModel");
  return stored.selectedModel;
}

function buildModelChain(model) {
  const fallbackMap = {
    "openai/gpt-5.2": ["openai/gpt-5.2", "gpt-4o", "gpt-4.1"],
    "gpt-4o": ["gpt-4o"],
    "gpt-4.1": ["gpt-4.1"],
    "kira-mini-1.0": ["kira-mini-1.0", "gpt-4o", "gpt-4.1"]
  };
  return fallbackMap[model] || [model, "gpt-4o"];
}