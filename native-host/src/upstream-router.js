import crypto from "node:crypto";

import {
  PROVIDER_CAPABILITIES,
  listPublicProviders,
  resolveModel,
  resolveProvider,
} from "../../extension/src/upstream-provider-catalog.js";

const DEFAULT_PROVIDER_BY_OPERATION = Object.freeze({
  "chat.completions": "chatgpt-web",
  "images.generations": "microsoft-designer-web",
  embeddings: "mixedbread-embeddings",
  "audio.speech": "edge-tts",
  "audio.transcriptions": "speechmatics-stt",
});

export function createUpstreamRouter({
  connectors,
  now = () => Date.now(),
  idFactory = (prefix) => `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`,
} = {}) {
  const dispatch = resolveDispatch(connectors);
  const getStatus = resolveStatus(connectors);

  async function listModels() {
    const created = Math.floor(now() / 1000);
    const data = listPublicProviders().flatMap((provider) => provider.models.map((model) => ({
      id: model.id,
      object: "model",
      created,
      owned_by: provider.vendor,
      provider: provider.id,
      capabilities: [...model.capabilities],
      integration_modes: [...provider.integrationModes],
      routes: [...(provider.router?.routes || [])],
    })));
    return { object: "list", data };
  }

  async function listProviders() {
    return { object: "list", data: listPublicProviders() };
  }

  async function getProviderStatuses() {
    const statusRows = typeof getStatus === "function" ? await getStatus() : [];
    const byProvider = new Map(
      (Array.isArray(statusRows) ? statusRows : []).map((row) => [normalizeProviderId(row?.provider), sanitizeStatus(row)]),
    );
    const data = listPublicProviders().map((provider) => ({
      ...provider,
      status: byProvider.get(provider.id) || {
        provider: provider.id,
        configured: false,
        mode: provider.integrationModes[0] || "unknown",
      },
    }));
    return { object: "list", data };
  }

  async function dispatchOperation(operation, payload = {}) {
    const provider = selectProvider(payload, operation);
    const model = typeof payload.model === "string" ? payload.model : null;
    const result = await dispatch({
      provider,
      operation,
      model,
      payload,
      timeoutMs: payload.timeoutMs,
    });

    switch (operation) {
      case "chat.completions":
        return normalizeChatCompletion(result, { provider, model, idFactory, now });
      case "images.generations":
        return normalizeImageGeneration(result, { provider, model, now });
      case "embeddings":
        return normalizeEmbeddings(result, { provider, model });
      case "audio.speech":
        return normalizeSpeech(result, { provider, model });
      case "audio.transcriptions":
        return normalizeTranscription(result, { provider, model });
      default:
        return result;
    }
  }

  async function dispatchRoute(pathname, payload = {}) {
    switch (pathname) {
      case "/v1/chat":
      case "/v1/chat/completions":
        return dispatchOperation("chat.completions", payload);
      case "/v1/images/generations":
        return dispatchOperation("images.generations", payload);
      case "/v1/embeddings":
        return dispatchOperation("embeddings", payload);
      case "/v1/audio/speech":
        return dispatchOperation("audio.speech", payload);
      case "/v1/audio/transcriptions":
        return dispatchOperation("audio.transcriptions", payload);
      default:
        throw routerError("ROUTER_ROUTE_NOT_FOUND", `Unsupported upstream route: ${pathname}`, 404);
    }
  }

  return {
    listModels,
    listProviders,
    getProviderStatuses,
    dispatchOperation,
    dispatchRoute,
  };
}

function resolveDispatch(connectors) {
  if (typeof connectors === "function") return connectors;
  if (connectors && typeof connectors.dispatch === "function") return connectors.dispatch.bind(connectors);
  throw new TypeError("connectors dispatch function is required");
}

function resolveStatus(connectors) {
  if (!connectors) return null;
  if (typeof connectors === "function" && typeof connectors.getStatus === "function") {
    return connectors.getStatus.bind(connectors);
  }
  if (typeof connectors.getStatus === "function") return connectors.getStatus.bind(connectors);
  return null;
}

function selectProvider(payload, operation) {
  if (typeof payload.provider === "string" && payload.provider.trim()) {
    const provider = resolveProvider(payload.provider);
    return provider?.id || payload.provider.trim().toLowerCase();
  }
  if (typeof payload.model === "string" && payload.model.trim()) {
    const model = resolveModel(payload.model);
    if (model?.providerId) return model.providerId;
  }
  const fallback = DEFAULT_PROVIDER_BY_OPERATION[operation];
  if (fallback) return fallback;

  const providers = listPublicProviders({ capability: capabilityForOperation(operation) });
  if (providers[0]?.id) return providers[0].id;
  throw routerError("ROUTER_PROVIDER_REQUIRED", `No upstream provider is available for ${operation}`, 400);
}

function capabilityForOperation(operation) {
  switch (operation) {
    case "chat.completions":
      return PROVIDER_CAPABILITIES.CHAT_COMPLETIONS;
    case "images.generations":
      return PROVIDER_CAPABILITIES.IMAGE_GENERATION;
    case "embeddings":
      return PROVIDER_CAPABILITIES.EMBEDDINGS;
    case "audio.speech":
      return PROVIDER_CAPABILITIES.TEXT_TO_SPEECH;
    case "audio.transcriptions":
      return PROVIDER_CAPABILITIES.SPEECH_TO_TEXT;
    default:
      return null;
  }
}

function normalizeChatCompletion(result, { provider, model, idFactory, now }) {
  if (isPlainObject(result) && Array.isArray(result.choices)) {
    return {
      object: "chat.completion",
      id: result.id || idFactory("chatcmpl"),
      created: result.created || Math.floor(now() / 1000),
      model: result.model || model || provider,
      ...result,
      provider,
    };
  }

  const text = typeof result === "string" ? result : result?.text;
  if (!text) {
    throw routerError("ROUTER_PROVIDER_RESPONSE_INVALID", "Chat provider returned no assistant content", 502);
  }
  return {
    id: idFactory("chatcmpl"),
    object: "chat.completion",
    created: Math.floor(now() / 1000),
    model: model || provider,
    provider,
    choices: [{
      index: 0,
      message: { role: "assistant", content: text },
      finish_reason: "stop",
    }],
  };
}

function normalizeImageGeneration(result, { provider, model, now }) {
  const data = Array.isArray(result?.data) ? result.data : [];
  return {
    created: result?.created || Math.floor(now() / 1000),
    data,
    provider,
    ...(model ? { model } : {}),
  };
}

function normalizeEmbeddings(result, { provider, model }) {
  if (!isPlainObject(result) || !Array.isArray(result.data)) {
    throw routerError("ROUTER_PROVIDER_RESPONSE_INVALID", "Embedding provider returned an invalid payload", 502);
  }
  return {
    object: result.object || "list",
    data: result.data,
    model: result.model || model || provider,
    provider,
    ...(result.usage ? { usage: result.usage } : {}),
  };
}

function normalizeSpeech(result, { provider, model }) {
  if (isPlainObject(result) && typeof result.data === "string") {
    return {
      provider,
      ...(model ? { model } : {}),
      data: result.data,
      encoding: result.encoding || "base64",
      contentType: result.contentType || "application/octet-stream",
    };
  }
  return {
    provider,
    ...(model ? { model } : {}),
    ...result,
  };
}

function normalizeTranscription(result, { provider, model }) {
  if (isPlainObject(result)) {
    if (typeof result.text === "string") {
      return {
        text: result.text,
        provider,
        ...(model ? { model } : {}),
        ...(result.language ? { language: result.language } : {}),
        ...(result.duration ? { duration: result.duration } : {}),
      };
    }
    return {
      provider,
      ...(model ? { model } : {}),
      ...result,
    };
  }
  throw routerError("ROUTER_PROVIDER_RESPONSE_INVALID", "Transcription provider returned an invalid payload", 502);
}

function sanitizeStatus(row) {
  if (!isPlainObject(row)) return { configured: false, mode: "unknown" };
  return {
    provider: normalizeProviderId(row.provider) || null,
    configured: Boolean(row.configured),
    mode: typeof row.mode === "string" ? row.mode : "unknown",
    ...(typeof row.ready === "boolean" ? { ready: row.ready } : {}),
    ...(typeof row.state === "string" ? { state: row.state } : {}),
  };
}

function normalizeProviderId(value) {
  if (typeof value !== "string") return null;
  const provider = resolveProvider(value);
  return provider?.id || value.trim().toLowerCase();
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function routerError(code, message, status = 500) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.retryable = status >= 500;
  return error;
}
