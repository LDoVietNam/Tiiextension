import {
  resolveModel,
  resolveProvider,
} from "../../extension/src/upstream-provider-catalog.js";

const DEFAULT_TIMEOUT_MS = 180_000;
const MAX_TIMEOUT_MS = 10 * 60_000;

const PROVIDER_OPERATIONS = Object.freeze({
  "chatgpt-web": "chat.completions",
  "minimax-agent-web": "chat.completions",
  "microsoft-designer-web": "images.generations",
  "deepai-web": ["chat.completions", "images.generations"],
  "felo-chat": "chat.completions",
  "freetheai-openai": "chat.completions",
  "mixedbread-embeddings": "embeddings",
  "edge-tts": "audio.speech",
  gtts: "audio.speech",
  "speechmatics-stt": "audio.transcriptions",
  "gladia-stt": "audio.transcriptions",
});

const BROWSER_PROVIDER_IDS = new Set([
  "chatgpt-web",
  "minimax-agent-web",
  "microsoft-designer-web",
  "deepai-web",
  "felo-chat",
]);

const BROWSER_PROVIDER_NAMES = Object.freeze({
  "felo-chat": "felo-web",
});

const OPERATION_ALIASES = Object.freeze({
  chat: "chat.completions",
  "chat/completions": "chat.completions",
  image: "images.generations",
  "images/generations": "images.generations",
  embedding: "embeddings",
  speech: "audio.speech",
  "audio/speech": "audio.speech",
  transcription: "audio.transcriptions",
  "audio/transcriptions": "audio.transcriptions",
});

const FORBIDDEN_CREDENTIAL_KEYS = new Set([
  "authorization",
  "headers",
  "cookie",
  "cookies",
  "apikey",
  "api_key",
  "accesstoken",
  "access_token",
  "refreshtoken",
  "refresh_token",
  "session",
  "sessionid",
  "session_id",
]);

const SENSITIVE_RESPONSE_KEYS = new Set([
  ...FORBIDDEN_CREDENTIAL_KEYS,
  "password",
  "secret",
  "token",
]);

/** Error type with stable, router-safe metadata and redacted messages. */
export class ProviderConnectorError extends Error {
  constructor(code, message, { retryable = false, status = 502 } = {}) {
    super(message);
    this.name = "ProviderConnectorError";
    this.code = code;
    this.retryable = retryable;
    this.status = status;
  }
}

/**
 * Create the native provider dispatcher.
 *
 * The returned value is callable and also exposes `.dispatch`, so callers may
 * inject either the function itself or the object-shaped contract expected by
 * a router. Secrets are read only while dispatching and are never returned.
 */
export function createProviderConnectors({
  fetchImpl = globalThis.fetch,
  extensionBridge = null,
  env = process.env,
  config = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw connectorError("CONNECTOR_CONFIG_INVALID", "A fetch implementation is required", {
      status: 500,
    });
  }

  const readSetting = (name, fallback = undefined) => {
    const configured = config && Object.prototype.hasOwnProperty.call(config, name)
      ? config[name]
      : env?.[name];
    return configured === undefined || configured === null || configured === ""
      ? fallback
      : configured;
  };

  async function dispatch(input) {
    assertNoCredentialMaterial(input);
    const request = normalizeRequest(input);
    assertOperationSupported(request.provider, request.operation);

    if (BROWSER_PROVIDER_IDS.has(request.provider)) {
      return dispatchBrowserProvider(request, extensionBridge);
    }

    switch (request.provider) {
      case "freetheai-openai":
        return dispatchFreeTheAi(request, { fetchImpl, readSetting, timeoutMs });
      case "mixedbread-embeddings":
        return dispatchMixedbread(request, { fetchImpl, readSetting, timeoutMs });
      case "edge-tts":
        return dispatchTtsSidecar(request, {
          fetchImpl,
          readSetting,
          timeoutMs,
          provider: "edge-tts",
          urlKeys: ["EDGE_TTS_SIDECAR_URL", "EDGE_TTS_URL"],
        });
      case "gtts":
        return dispatchTtsSidecar(request, {
          fetchImpl,
          readSetting,
          timeoutMs,
          provider: "gtts",
          urlKeys: ["GTTS_SIDECAR_URL", "GTTS_URL"],
        });
      case "speechmatics-stt":
        return dispatchStt(request, {
          fetchImpl,
          readSetting,
          timeoutMs,
          provider: "speechmatics-stt",
          urlKeys: ["SPEECHMATICS_STT_URL", "SPEECHMATICS_URL"],
          defaultUrl: "https://asr.api.speechmatics.com/v2/jobs/",
          apiKeyName: "SPEECHMATICS_API_KEY",
          authHeader: "authorization",
          authValue: (key) => `Bearer ${key}`,
        });
      case "gladia-stt":
        return dispatchStt(request, {
          fetchImpl,
          readSetting,
          timeoutMs,
          provider: "gladia-stt",
          urlKeys: ["GLADIA_STT_URL", "GLADIA_URL"],
          defaultUrl: "https://api.gladia.io/v2/pre-recorded",
          apiKeyName: "GLADIA_API_KEY",
          authHeader: "x-gladia-key",
          authValue: (key) => key,
        });
      default:
        throw connectorError("PROVIDER_NOT_FOUND", "Provider connector is not available", {
          status: 404,
        });
    }
  }

  dispatch.dispatch = dispatch;
  dispatch.getStatus = () => getConnectorStatus({ extensionBridge, readSetting });
  return dispatch;
}

async function dispatchBrowserProvider(request, extensionBridge) {
  if (!extensionBridge || typeof extensionBridge.request !== "function") {
    throw connectorError(
      "EXTENSION_PROVIDER_UNAVAILABLE",
      "The browser extension provider bridge is not connected",
      { retryable: true, status: 503 },
    );
  }

  const forwarded = {
    provider: BROWSER_PROVIDER_NAMES[request.provider] || request.provider,
    operation: request.operation,
    model: request.model,
    payload: cloneSafe(request.payload),
    timeoutMs: request.timeoutMs,
  };
  try {
    const result = await extensionBridge.request("provider.request", forwarded, {
      timeoutMs: request.timeoutMs,
    });
    return sanitizeResponse(result);
  } catch (error) {
    throw wrapProviderError(error, "BROWSER_PROVIDER_FAILED");
  }
}

async function dispatchFreeTheAi(request, context) {
  const apiKey = requireSecret(context.readSetting, "FREETHEAI_API_KEY", "FreeTheAI");
  const url = resolveRemoteEndpoint(context.readSetting, {
    exactKeys: ["FREETHEAI_CHAT_URL"],
    baseKeys: ["FREETHEAI_BASE_URL"],
    fallbackBase: "https://api.freetheai.xyz/v1",
    path: "chat/completions",
  });
  const body = cloneSafe(request.payload);
  body.model = selectUpstreamModel(
    body.model || request.model,
    "freetheai/auto",
    context.readSetting("FREETHEAI_MODEL", "auto"),
  );
  return requestJson({
    ...context,
    request,
    url,
    headers: { authorization: `Bearer ${apiKey}` },
    body,
    secrets: [apiKey],
  });
}

async function dispatchMixedbread(request, context) {
  const apiKey = requireSecret(context.readSetting, "MIXEDBREAD_API_KEY", "Mixedbread");
  const url = resolveRemoteEndpoint(context.readSetting, {
    exactKeys: ["MIXEDBREAD_EMBEDDINGS_URL"],
    baseKeys: ["MIXEDBREAD_BASE_URL"],
    fallbackBase: "https://api.mixedbread.com",
    path: "v1/embeddings",
  });
  const body = cloneSafe(request.payload);
  const configuredModel = context.readSetting("MIXEDBREAD_MODEL");
  const requestedModel = body.model || request.model;
  if (requestedModel && requestedModel !== "mixedbread/embeddings") {
    body.model = requestedModel;
  } else if (configuredModel) {
    body.model = configuredModel;
  } else {
    delete body.model;
  }
  return requestJson({
    ...context,
    request,
    url,
    headers: { authorization: `Bearer ${apiKey}` },
    body,
    secrets: [apiKey],
  });
}

async function dispatchTtsSidecar(request, context) {
  const configuredUrl = firstSetting(context.readSetting, context.urlKeys);
  if (!configuredUrl) {
    throw connectorError(
      "PROVIDER_NOT_CONFIGURED",
      `${context.provider} requires a loopback sidecar URL in runtime configuration`,
      { status: 503 },
    );
  }
  const url = validateConnectorUrl(configuredUrl, { kind: "sidecar" });
  const body = cloneSafe(request.payload);
  if (!body.model && request.model) body.model = request.model;
  return requestAudio({ ...context, request, url, body });
}

async function dispatchStt(request, context) {
  const apiKey = requireSecret(context.readSetting, context.apiKeyName, context.provider);
  const configuredUrl = firstSetting(context.readSetting, context.urlKeys) || context.defaultUrl;
  const url = validateConnectorUrl(configuredUrl, { kind: "remote" });
  const body = cloneSafe(request.payload);
  if (!body.model && request.model) body.model = request.model;
  return requestJson({
    ...context,
    request,
    url,
    headers: { [context.authHeader]: context.authValue(apiKey) },
    body,
    secrets: [apiKey],
  });
}

async function requestJson({ fetchImpl, request, url, headers, body, timeoutMs, secrets = [] }) {
  const response = await performFetch(fetchImpl, url, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
    redirect: "error",
  }, request.timeoutMs || timeoutMs);

  if (!response?.ok) throw upstreamHttpError(response);
  let value;
  try {
    value = await response.json();
  } catch {
    throw connectorError("PROVIDER_RESPONSE_INVALID", "Provider returned invalid JSON", {
      retryable: true,
    });
  }
  return sanitizeResponse(value, new WeakMap(), secrets);
}

async function requestAudio({ fetchImpl, request, url, body, timeoutMs }) {
  const response = await performFetch(fetchImpl, url, {
    method: "POST",
    headers: {
      accept: "audio/*, application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    redirect: "error",
  }, request.timeoutMs || timeoutMs);
  if (!response?.ok) throw upstreamHttpError(response);

  const contentType = String(response.headers?.get?.("content-type") || "application/octet-stream")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (contentType === "application/json" || contentType.endsWith("+json")) {
    try {
      return sanitizeResponse(await response.json());
    } catch {
      throw connectorError("PROVIDER_RESPONSE_INVALID", "TTS sidecar returned invalid JSON", {
        retryable: true,
      });
    }
  }

  let bytes;
  try {
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch {
    throw connectorError("PROVIDER_RESPONSE_INVALID", "TTS sidecar returned invalid audio", {
      retryable: true,
    });
  }
  return {
    data: Buffer.from(bytes).toString("base64"),
    encoding: "base64",
    contentType,
  };
}

async function performFetch(fetchImpl, url, init, requestedTimeout) {
  const controller = new AbortController();
  const effectiveTimeout = clampTimeout(requestedTimeout);
  const timer = setTimeout(() => controller.abort(), effectiveTimeout);
  try {
    return await fetchImpl(url.href, { ...init, signal: controller.signal });
  } catch {
    if (controller.signal.aborted) {
      throw connectorError("PROVIDER_TIMEOUT", "Provider request timed out", {
        retryable: true,
        status: 504,
      });
    }
    throw connectorError("PROVIDER_NETWORK_ERROR", "Provider network request failed", {
      retryable: true,
    });
  } finally {
    clearTimeout(timer);
  }
}

function normalizeRequest(input) {
  if (!isPlainObject(input)) {
    throw connectorError("PROVIDER_REQUEST_INVALID", "Provider request must be an object", {
      status: 400,
    });
  }
  const modelResolution = typeof input.model === "string" ? resolveModel(input.model) : null;
  const providerResolution = typeof input.provider === "string" ? resolveProvider(input.provider) : null;
  const requestedProvider = String(input.provider || "").trim().toLowerCase();
  const provider = providerResolution?.id
    || modelResolution?.providerId
    || (requestedProvider === "chatgpt" ? "chatgpt-web" : requestedProvider);
  if (!provider) {
    throw connectorError("PROVIDER_REQUEST_INVALID", "Provider is required", { status: 400 });
  }
  if (!Object.prototype.hasOwnProperty.call(PROVIDER_OPERATIONS, provider)) {
    throw connectorError("PROVIDER_NOT_FOUND", "Provider connector is not available", { status: 404 });
  }
  const payload = isPlainObject(input.payload) ? input.payload : {};
  return {
    provider,
    operation: normalizeOperation(input.operation),
    model: typeof input.model === "string" ? input.model : null,
    payload,
    timeoutMs: clampTimeout(input.timeoutMs ?? payload.timeoutMs),
  };
}

function normalizeOperation(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return OPERATION_ALIASES[normalized] || normalized || "chat.completions";
}

function assertOperationSupported(provider, operation) {
  const supported = PROVIDER_OPERATIONS[provider];
  const operations = Array.isArray(supported) ? supported : [supported];
  if (!operations.includes(operation)) {
    throw connectorError(
      "PROVIDER_OPERATION_UNSUPPORTED",
      `${provider} does not support ${operation}`,
      { status: 400 },
    );
  }
}

function assertNoCredentialMaterial(value, path = "request", seen = new WeakSet()) {
  if (!value || typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);
  for (const [key, nested] of Object.entries(value)) {
    const normalized = key.toLowerCase().replace(/[-\s]/g, "_");
    const compact = normalized.replace(/_/g, "");
    if (FORBIDDEN_CREDENTIAL_KEYS.has(normalized) || FORBIDDEN_CREDENTIAL_KEYS.has(compact)) {
      throw connectorError(
        "CREDENTIAL_FORWARDING_FORBIDDEN",
        `Credential material is not accepted at ${path}.${key}`,
        { status: 400 },
      );
    }
    assertNoCredentialMaterial(nested, `${path}.${key}`, seen);
  }
}

/** Validate a runtime-configured connector URL against its trust boundary. */
export function validateConnectorUrl(value, { kind = "remote" } = {}) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    throw connectorError("CONNECTOR_URL_INVALID", "Provider endpoint URL is invalid", {
      status: 500,
    });
  }
  if (url.username || url.password || url.hash) {
    throw connectorError("CONNECTOR_URL_INVALID", "Provider endpoint URL contains forbidden components", {
      status: 500,
    });
  }
  if (kind === "sidecar") {
    const loopback = url.hostname === "localhost"
      || url.hostname === "127.0.0.1"
      || url.hostname === "[::1]"
      || url.hostname === "::1";
    if (!loopback || !["http:", "https:"].includes(url.protocol)) {
      throw connectorError(
        "CONNECTOR_URL_UNSAFE",
        "Sidecar endpoint must use HTTP(S) on the loopback interface",
        { status: 500 },
      );
    }
  } else if (url.protocol !== "https:") {
    throw connectorError("CONNECTOR_URL_UNSAFE", "Remote provider endpoint must use HTTPS", {
      status: 500,
    });
  }
  return url;
}

function resolveRemoteEndpoint(readSetting, {
  exactKeys,
  baseKeys,
  fallbackBase,
  path,
}) {
  const exact = firstSetting(readSetting, exactKeys);
  if (exact) return validateConnectorUrl(exact, { kind: "remote" });
  const base = firstSetting(readSetting, baseKeys) || fallbackBase;
  const baseUrl = validateConnectorUrl(ensureTrailingSlash(base), { kind: "remote" });
  return validateConnectorUrl(new URL(path.replace(/^\/+/, ""), baseUrl).href, { kind: "remote" });
}

function getConnectorStatus({ extensionBridge, readSetting }) {
  const extensionReady = Boolean(
    extensionBridge
    && typeof extensionBridge.request === "function"
    && (typeof extensionBridge.isConnected !== "function" || extensionBridge.isConnected()),
  );
  return Object.freeze([
    ...["chatgpt-web", "minimax-agent-web", "microsoft-designer-web", "deepai-web", "felo-chat"]
      .map((provider) => ({ provider, configured: extensionReady, mode: "browser-session" })),
    { provider: "freetheai-openai", configured: Boolean(readSetting("FREETHEAI_API_KEY")), mode: "remote-api" },
    { provider: "mixedbread-embeddings", configured: Boolean(readSetting("MIXEDBREAD_API_KEY")), mode: "remote-api" },
    { provider: "edge-tts", configured: Boolean(firstSetting(readSetting, ["EDGE_TTS_SIDECAR_URL", "EDGE_TTS_URL"])), mode: "loopback-sidecar" },
    { provider: "gtts", configured: Boolean(firstSetting(readSetting, ["GTTS_SIDECAR_URL", "GTTS_URL"])), mode: "loopback-sidecar" },
    { provider: "speechmatics-stt", configured: Boolean(readSetting("SPEECHMATICS_API_KEY")), mode: "remote-api" },
    { provider: "gladia-stt", configured: Boolean(readSetting("GLADIA_API_KEY")), mode: "remote-api" },
  ]);
}

function requireSecret(readSetting, name, providerName) {
  const value = readSetting(name);
  if (typeof value !== "string" || value.trim() === "") {
    throw connectorError(
      "PROVIDER_NOT_CONFIGURED",
      `${providerName} credentials are not configured in the native runtime`,
      { status: 503 },
    );
  }
  return value;
}

function firstSetting(readSetting, names) {
  for (const name of names) {
    const value = readSetting(name);
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function selectUpstreamModel(requested, catalogPlaceholder, fallback) {
  return requested && requested !== catalogPlaceholder ? requested : fallback;
}

function upstreamHttpError(response) {
  const status = Number(response?.status) || 502;
  return connectorError(
    "PROVIDER_HTTP_ERROR",
    `Provider request failed with HTTP ${status}`,
    { retryable: status === 408 || status === 429 || status >= 500, status },
  );
}

function wrapProviderError(error, fallbackCode) {
  if (error instanceof ProviderConnectorError) return error;
  return connectorError(error?.code || fallbackCode, safeMessage(error?.message), {
    retryable: Boolean(error?.retryable),
    status: Number(error?.status) || 502,
  });
}

function sanitizeResponse(value, seen = new WeakMap(), secrets = []) {
  if (typeof value === "string") return redactKnownSecrets(value, secrets);
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return seen.get(value);
  if (Array.isArray(value)) {
    const result = [];
    seen.set(value, result);
    for (const entry of value) result.push(sanitizeResponse(entry, seen, secrets));
    return result;
  }
  const result = {};
  seen.set(value, result);
  for (const [key, nested] of Object.entries(value)) {
    const normalized = key.toLowerCase().replace(/[-\s]/g, "_");
    const compact = normalized.replace(/_/g, "");
    if (SENSITIVE_RESPONSE_KEYS.has(normalized) || SENSITIVE_RESPONSE_KEYS.has(compact)) continue;
    result[key] = sanitizeResponse(nested, seen, secrets);
  }
  return result;
}

function cloneSafe(value) {
  return sanitizeResponse(value);
}

function safeMessage(value) {
  const message = typeof value === "string" ? value : "Provider request failed";
  return message
    .replace(/(?:bearer\s+|api[_-]?key[=:\s]+|token[=:\s]+|cookie[=:\s]+)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/\b(?:sk|key|token)_[A-Za-z0-9._-]{8,}\b/g, "[REDACTED]")
    .slice(0, 1_000);
}

function redactKnownSecrets(value, secrets) {
  let result = value;
  for (const secret of secrets) {
    if (typeof secret === "string" && secret.length > 0) {
      result = result.split(secret).join("[REDACTED]");
    }
  }
  return result;
}

function clampTimeout(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_TIMEOUT_MS;
  return Math.max(1_000, Math.min(parsed, MAX_TIMEOUT_MS));
}

function ensureTrailingSlash(value) {
  const text = String(value);
  return text.endsWith("/") ? text : `${text}/`;
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function connectorError(code, message, options = {}) {
  return new ProviderConnectorError(code, safeMessage(message), options);
}
