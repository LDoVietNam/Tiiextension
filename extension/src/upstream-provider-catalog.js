/**
 * Static contracts for providers that Tiiextension can expose to an upstream
 * router. This module is intentionally pure: it performs no network, storage,
 * browser-session, or credential access.
 */

export const PROVIDER_CAPABILITIES = Object.freeze({
  CHAT_COMPLETIONS: "chat.completions",
  MULTIMODAL_INPUT: "input.multimodal",
  IMAGE_GENERATION: "images.generations",
  TEXT_TO_SPEECH: "audio.speech",
  SPEECH_TO_TEXT: "audio.transcriptions",
  EMBEDDINGS: "embeddings",
  STREAMING: "streaming",
  TOOL_USE: "tools",
  ROUTER_UPSTREAM: "router.upstream",
});

export const INTEGRATION_MODES = Object.freeze({
  BROWSER_SESSION: "browser-session",
  OPENAI_COMPATIBLE: "openai-compatible",
  NATIVE_SERVICE: "native-service",
  HTTP_API: "http-api",
  WEBSOCKET: "websocket",
  ROUTER_UPSTREAM: "router-upstream",
});

export const ROUTER_ROUTES = Object.freeze({
  CHAT_COMPLETIONS: "/v1/chat/completions",
  IMAGE_GENERATIONS: "/v1/images/generations",
  AUDIO_SPEECH: "/v1/audio/speech",
  AUDIO_TRANSCRIPTIONS: "/v1/audio/transcriptions",
  EMBEDDINGS: "/v1/embeddings",
});

const C = PROVIDER_CAPABILITIES;
const I = INTEGRATION_MODES;
const R = ROUTER_ROUTES;
const VALID_CAPABILITIES = new Set(Object.values(C));
const VALID_INTEGRATION_MODES = new Set(Object.values(I));
const VALID_ROUTES = new Set(Object.values(R));
const VALID_CREDENTIAL_MODES = new Set([
  "browser-session",
  "runtime-config",
  "none",
]);
const PROVIDER_ID_PATTERN = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/;
const MODEL_ID_PATTERN = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?\/[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/;
const ALIAS_PATTERN = /^[a-z0-9](?:[a-z0-9._\/-]*[a-z0-9])?$/;

const RAW_PROVIDER_CATALOG = [
  {
    id: "minimax-agent-web",
    name: "MiniMax Agent Web",
    vendor: "HailuoAI / MiniMax",
    description: "Browser-session adapter for the HailuoAI MiniMax agent experience.",
    aliases: ["hailuoai", "hailuo", "minimax-web", "minimax-agent"],
    adapter: "minimax-agent-web",
    credentialMode: "browser-session",
    capabilities: [C.CHAT_COMPLETIONS, C.MULTIMODAL_INPUT, C.STREAMING, C.TOOL_USE, C.ROUTER_UPSTREAM],
    integrationModes: [I.BROWSER_SESSION, I.ROUTER_UPSTREAM],
    models: [
      {
        id: "hailuoai/minimax-agent-web",
        name: "MiniMax Agent Web",
        aliases: ["minimax-agent-web", "hailuo/minimax-agent-web", "minimax/minimax-agent-web"],
        capabilities: [C.CHAT_COMPLETIONS, C.MULTIMODAL_INPUT, C.STREAMING, C.TOOL_USE],
      },
    ],
    router: {
      exposed: true,
      protocol: "tiiextension-provider-v1",
      routes: [R.CHAT_COMPLETIONS],
    },
  },
  {
    id: "microsoft-designer-web",
    name: "Microsoft Designer Web",
    vendor: "Microsoft Designer",
    description: "Browser-session image generation adapter for Microsoft Designer.",
    aliases: ["microsoft-designer", "microsoftdesigner", "ms-designer", "designer-web"],
    adapter: "microsoft-designer-web",
    credentialMode: "browser-session",
    capabilities: [C.IMAGE_GENERATION, C.ROUTER_UPSTREAM],
    integrationModes: [I.BROWSER_SESSION, I.ROUTER_UPSTREAM],
    models: [
      {
        id: "microsoft-designer/image-generation",
        name: "Microsoft Designer Image Generation",
        aliases: ["microsoft-designer-image", "designer-image"],
        capabilities: [C.IMAGE_GENERATION],
      },
    ],
    router: {
      exposed: true,
      protocol: "tiiextension-provider-v1",
      routes: [R.IMAGE_GENERATIONS],
    },
  },
  {
    id: "deepai-web",
    name: "DeepAI Web",
    vendor: "DeepAI",
    description: "Browser-session multimodal chat adapter for DeepAI.",
    aliases: ["deepai", "deep-ai", "deepai-multimodal"],
    adapter: "deepai-web",
    credentialMode: "browser-session",
    capabilities: [C.CHAT_COMPLETIONS, C.MULTIMODAL_INPUT, C.STREAMING, C.ROUTER_UPSTREAM],
    integrationModes: [I.BROWSER_SESSION, I.ROUTER_UPSTREAM],
    models: [
      {
        id: "deepai/multimodal-chat",
        name: "DeepAI Multimodal Chat",
        aliases: ["deepai-multimodal", "deepai-chat"],
        capabilities: [C.CHAT_COMPLETIONS, C.MULTIMODAL_INPUT, C.STREAMING],
      },
    ],
    router: {
      exposed: true,
      protocol: "tiiextension-provider-v1",
      routes: [R.CHAT_COMPLETIONS],
    },
  },
  {
    id: "freetheai-openai",
    name: "FreeTheAi OpenAI Gateway",
    vendor: "FreeTheAi",
    description: "OpenAI-compatible gateway exposed through the Tiiextension upstream contract.",
    aliases: ["freetheai", "free-the-ai", "freetheai-gateway"],
    adapter: "freetheai-openai",
    credentialMode: "runtime-config",
    capabilities: [C.CHAT_COMPLETIONS, C.MULTIMODAL_INPUT, C.STREAMING, C.TOOL_USE, C.ROUTER_UPSTREAM],
    integrationModes: [I.OPENAI_COMPATIBLE, I.HTTP_API, I.ROUTER_UPSTREAM],
    models: [
      {
        id: "freetheai/auto",
        name: "FreeTheAi Automatic Model",
        aliases: ["freetheai-auto", "free-the-ai-auto"],
        capabilities: [C.CHAT_COMPLETIONS, C.MULTIMODAL_INPUT, C.STREAMING, C.TOOL_USE],
      },
    ],
    router: {
      exposed: true,
      protocol: "openai-compatible",
      routes: [R.CHAT_COMPLETIONS],
    },
  },
  {
    id: "sub2api-openai",
    name: "Sub2API OpenAI Gateway",
    vendor: "Sub2API",
    description: "Self-hosted Sub2API OpenAI-compatible gateway configured only in the native runtime.",
    aliases: ["sub2api", "sub2api-gateway"],
    adapter: "sub2api-openai",
    credentialMode: "runtime-config",
    capabilities: [C.CHAT_COMPLETIONS, C.MULTIMODAL_INPUT, C.STREAMING, C.TOOL_USE, C.ROUTER_UPSTREAM],
    integrationModes: [I.OPENAI_COMPATIBLE, I.HTTP_API, I.ROUTER_UPSTREAM],
    models: [
      {
        id: "sub2api/auto",
        name: "Sub2API Automatic Model",
        aliases: ["sub2api-auto"],
        capabilities: [C.CHAT_COMPLETIONS, C.MULTIMODAL_INPUT, C.STREAMING, C.TOOL_USE],
      },
    ],
    router: {
      exposed: true,
      protocol: "openai-compatible",
      routes: [R.CHAT_COMPLETIONS],
    },
  },
  {
    id: "edge-tts",
    name: "Edge TTS",
    vendor: "Microsoft Edge",
    description: "Native text-to-speech service using Edge voices.",
    aliases: ["edgetts", "microsoft-edge-tts"],
    adapter: "edge-tts",
    credentialMode: "none",
    capabilities: [C.TEXT_TO_SPEECH, C.STREAMING, C.ROUTER_UPSTREAM],
    integrationModes: [I.NATIVE_SERVICE, I.ROUTER_UPSTREAM],
    models: [
      {
        id: "edge-tts/default",
        name: "Edge TTS Default Voice",
        aliases: ["edgetts-default", "edge-tts-default"],
        capabilities: [C.TEXT_TO_SPEECH, C.STREAMING],
      },
    ],
    router: {
      exposed: true,
      protocol: "tiiextension-provider-v1",
      routes: [R.AUDIO_SPEECH],
    },
  },
  {
    id: "gtts",
    name: "gTTS",
    vendor: "Google Translate TTS",
    description: "Native text-to-speech service using the gTTS adapter.",
    aliases: ["google-tts", "g-tts"],
    adapter: "gtts",
    credentialMode: "none",
    capabilities: [C.TEXT_TO_SPEECH, C.ROUTER_UPSTREAM],
    integrationModes: [I.NATIVE_SERVICE, I.ROUTER_UPSTREAM],
    models: [
      {
        id: "gtts/default",
        name: "gTTS Default Voice",
        aliases: ["gtts-default", "google-tts-default"],
        capabilities: [C.TEXT_TO_SPEECH],
      },
    ],
    router: {
      exposed: true,
      protocol: "tiiextension-provider-v1",
      routes: [R.AUDIO_SPEECH],
    },
  },
  {
    id: "felo-chat",
    name: "Felo Chat Aggregator",
    vendor: "Felo",
    description: "Browser-session chat aggregator exposed as a router upstream.",
    aliases: ["felo", "felo-ai", "felo-aggregator"],
    adapter: "felo-chat",
    credentialMode: "browser-session",
    capabilities: [C.CHAT_COMPLETIONS, C.MULTIMODAL_INPUT, C.STREAMING, C.ROUTER_UPSTREAM],
    integrationModes: [I.BROWSER_SESSION, I.ROUTER_UPSTREAM],
    models: [
      {
        id: "felo/chat-aggregator",
        name: "Felo Chat Aggregator",
        aliases: ["felo-chat", "felo-auto"],
        capabilities: [C.CHAT_COMPLETIONS, C.MULTIMODAL_INPUT, C.STREAMING],
      },
    ],
    router: {
      exposed: true,
      protocol: "tiiextension-provider-v1",
      routes: [R.CHAT_COMPLETIONS],
    },
  },
  {
    id: "mixedbread-embeddings",
    name: "Mixedbread AI Embeddings",
    vendor: "Mixedbread AI",
    description: "Embedding service adapter for Mixedbread AI models.",
    aliases: ["mixedbread", "mixedbread-ai", "mxbai"],
    adapter: "mixedbread-embeddings",
    credentialMode: "runtime-config",
    capabilities: [C.EMBEDDINGS, C.ROUTER_UPSTREAM],
    integrationModes: [I.HTTP_API, I.ROUTER_UPSTREAM],
    models: [
      {
        id: "mixedbread/embeddings",
        name: "Mixedbread Embeddings",
        aliases: ["mixedbread-embed", "mixedbread-embedding", "mxbai-embed"],
        capabilities: [C.EMBEDDINGS],
      },
    ],
    router: {
      exposed: true,
      protocol: "tiiextension-provider-v1",
      routes: [R.EMBEDDINGS],
    },
  },
  {
    id: "speechmatics-stt",
    name: "Speechmatics STT",
    vendor: "Speechmatics",
    description: "Batch and streaming speech-to-text adapter for Speechmatics.",
    aliases: ["speechmatics", "speechmatics-transcription"],
    adapter: "speechmatics-stt",
    credentialMode: "runtime-config",
    capabilities: [C.SPEECH_TO_TEXT, C.STREAMING, C.ROUTER_UPSTREAM],
    integrationModes: [I.HTTP_API, I.WEBSOCKET, I.ROUTER_UPSTREAM],
    models: [
      {
        id: "speechmatics/transcribe",
        name: "Speechmatics Transcription",
        aliases: ["speechmatics-stt", "speechmatics-transcribe"],
        capabilities: [C.SPEECH_TO_TEXT, C.STREAMING],
      },
    ],
    router: {
      exposed: true,
      protocol: "tiiextension-provider-v1",
      routes: [R.AUDIO_TRANSCRIPTIONS],
    },
  },
  {
    id: "gladia-stt",
    name: "Gladia STT",
    vendor: "Gladia",
    description: "Batch and streaming speech-to-text adapter for Gladia.",
    aliases: ["gladia", "gladia-transcription"],
    adapter: "gladia-stt",
    credentialMode: "runtime-config",
    capabilities: [C.SPEECH_TO_TEXT, C.STREAMING, C.ROUTER_UPSTREAM],
    integrationModes: [I.HTTP_API, I.WEBSOCKET, I.ROUTER_UPSTREAM],
    models: [
      {
        id: "gladia/transcribe",
        name: "Gladia Transcription",
        aliases: ["gladia-stt", "gladia-transcribe"],
        capabilities: [C.SPEECH_TO_TEXT, C.STREAMING],
      },
    ],
    router: {
      exposed: true,
      protocol: "tiiextension-provider-v1",
      routes: [R.AUDIO_TRANSCRIPTIONS],
    },
  },
];

function isPlainObject(value) {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}

function normalizeLookup(value) {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase().replace(/\s+/g, "-").replace(/_+/g, "-");
}

function validateStringArray(value, path, errors, { allowed, pattern, nonEmpty = true } = {}) {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return;
  }
  if (nonEmpty && value.length === 0) errors.push(`${path} must not be empty`);
  const seen = new Set();
  value.forEach((entry, index) => {
    const entryPath = `${path}[${index}]`;
    if (typeof entry !== "string" || entry.length === 0) {
      errors.push(`${entryPath} must be a non-empty string`);
      return;
    }
    if (seen.has(entry)) errors.push(`${entryPath} duplicates ${entry}`);
    seen.add(entry);
    if (allowed && !allowed.has(entry)) errors.push(`${entryPath} has unsupported value ${entry}`);
    if (pattern && !pattern.test(entry)) errors.push(`${entryPath} is not router-safe`);
  });
}

/** Validate one provider descriptor without mutating it. */
export function validateProviderDescriptor(provider) {
  const errors = [];
  if (!isPlainObject(provider)) return { valid: false, errors: ["provider must be a plain object"] };

  if (typeof provider.id !== "string" || !PROVIDER_ID_PATTERN.test(provider.id)) {
    errors.push("id must be a router-safe provider id");
  }
  for (const field of ["name", "vendor", "description", "adapter"]) {
    if (typeof provider[field] !== "string" || provider[field].trim() === "") {
      errors.push(`${field} must be a non-empty string`);
    }
  }
  if (typeof provider.adapter === "string" && !PROVIDER_ID_PATTERN.test(provider.adapter)) {
    errors.push("adapter must be router-safe");
  }
  if (!VALID_CREDENTIAL_MODES.has(provider.credentialMode)) {
    errors.push("credentialMode is unsupported");
  }

  validateStringArray(provider.aliases, "aliases", errors, { pattern: ALIAS_PATTERN, nonEmpty: false });
  validateStringArray(provider.capabilities, "capabilities", errors, { allowed: VALID_CAPABILITIES });
  validateStringArray(provider.integrationModes, "integrationModes", errors, { allowed: VALID_INTEGRATION_MODES });

  if (!provider.capabilities?.includes(C.ROUTER_UPSTREAM)) {
    errors.push(`capabilities must include ${C.ROUTER_UPSTREAM}`);
  }
  if (!provider.integrationModes?.includes(I.ROUTER_UPSTREAM)) {
    errors.push(`integrationModes must include ${I.ROUTER_UPSTREAM}`);
  }

  if (!Array.isArray(provider.models) || provider.models.length === 0) {
    errors.push("models must be a non-empty array");
  } else {
    const modelIds = new Set();
    provider.models.forEach((model, index) => {
      const path = `models[${index}]`;
      if (!isPlainObject(model)) {
        errors.push(`${path} must be a plain object`);
        return;
      }
      if (typeof model.id !== "string" || !MODEL_ID_PATTERN.test(model.id)) {
        errors.push(`${path}.id must use namespace/model format`);
      } else if (modelIds.has(model.id)) {
        errors.push(`${path}.id duplicates ${model.id}`);
      } else {
        modelIds.add(model.id);
      }
      if (typeof model.name !== "string" || model.name.trim() === "") {
        errors.push(`${path}.name must be a non-empty string`);
      }
      validateStringArray(model.aliases, `${path}.aliases`, errors, { pattern: ALIAS_PATTERN, nonEmpty: false });
      validateStringArray(model.capabilities, `${path}.capabilities`, errors, { allowed: VALID_CAPABILITIES });
      if (Array.isArray(model.capabilities) && Array.isArray(provider.capabilities)) {
        for (const capability of model.capabilities) {
          if (!provider.capabilities.includes(capability)) {
            errors.push(`${path}.capabilities contains ${capability}, which the provider does not declare`);
          }
        }
      }
    });
  }

  if (!isPlainObject(provider.router)) {
    errors.push("router must be a plain object");
  } else {
    if (provider.router.exposed !== true) errors.push("router.exposed must be true");
    if (typeof provider.router.protocol !== "string" || provider.router.protocol.trim() === "") {
      errors.push("router.protocol must be a non-empty string");
    }
    validateStringArray(provider.router.routes, "router.routes", errors, { allowed: VALID_ROUTES });
  }

  return { valid: errors.length === 0, errors };
}

/** Validate descriptors plus aliases and model ids across the whole catalog. */
export function validateProviderCatalog(catalog) {
  const errors = [];
  if (!Array.isArray(catalog) || catalog.length === 0) {
    return { valid: false, errors: ["catalog must be a non-empty array"] };
  }

  const providerKeys = new Map();
  const modelKeys = new Map();
  const register = (map, rawKey, owner, path) => {
    const key = normalizeLookup(rawKey);
    if (!key) return;
    const previousOwner = map.get(key);
    if (previousOwner && previousOwner !== owner) {
      errors.push(`${path} conflicts with ${previousOwner}`);
    } else {
      map.set(key, owner);
    }
  };

  catalog.forEach((provider, index) => {
    const result = validateProviderDescriptor(provider);
    errors.push(...result.errors.map((error) => `providers[${index}].${error}`));
    if (!isPlainObject(provider)) return;

    register(providerKeys, provider.id, provider.id, `providers[${index}].id`);
    if (Array.isArray(provider.aliases)) {
      provider.aliases.forEach((alias, aliasIndex) => register(
        providerKeys,
        alias,
        provider.id,
        `providers[${index}].aliases[${aliasIndex}]`,
      ));
    }
    if (Array.isArray(provider.models)) {
      provider.models.forEach((model, modelIndex) => {
        if (!isPlainObject(model)) return;
        register(modelKeys, model.id, model.id, `providers[${index}].models[${modelIndex}].id`);
        if (Array.isArray(model.aliases)) {
          model.aliases.forEach((alias, aliasIndex) => register(
            modelKeys,
            alias,
            model.id,
            `providers[${index}].models[${modelIndex}].aliases[${aliasIndex}]`,
          ));
        }
      });
    }
  });

  return { valid: errors.length === 0, errors };
}

const initialValidation = validateProviderCatalog(RAW_PROVIDER_CATALOG);
if (!initialValidation.valid) {
  throw new Error(`Invalid upstream provider catalog:\n${initialValidation.errors.join("\n")}`);
}

export const UPSTREAM_PROVIDER_CATALOG = deepFreeze(RAW_PROVIDER_CATALOG);

const providerAliasIndex = new Map();
const modelAliasIndex = new Map();
const modelOwnerIndex = new Map();

for (const provider of UPSTREAM_PROVIDER_CATALOG) {
  for (const key of [provider.id, ...provider.aliases]) {
    providerAliasIndex.set(normalizeLookup(key), provider.id);
  }
  for (const model of provider.models) {
    modelOwnerIndex.set(model.id, provider.id);
    for (const key of [model.id, ...model.aliases]) {
      modelAliasIndex.set(normalizeLookup(key), model.id);
    }
  }
}

/** Resolve a provider id or alias to its canonical provider id. */
export function resolveProviderId(idOrAlias) {
  return providerAliasIndex.get(normalizeLookup(idOrAlias)) ?? null;
}

/** Resolve a provider id or alias to the immutable provider descriptor. */
export function resolveProvider(idOrAlias) {
  const id = resolveProviderId(idOrAlias);
  return id ? UPSTREAM_PROVIDER_CATALOG.find((provider) => provider.id === id) ?? null : null;
}

/** Resolve a model id or alias to its canonical namespace/model id. */
export function resolveModelId(idOrAlias) {
  return modelAliasIndex.get(normalizeLookup(idOrAlias)) ?? null;
}

/** Resolve a model reference and include its owning provider. */
export function resolveModel(idOrAlias) {
  const id = resolveModelId(idOrAlias);
  if (!id) return null;
  const providerId = modelOwnerIndex.get(id);
  const provider = resolveProvider(providerId);
  const model = provider?.models.find((candidate) => candidate.id === id) ?? null;
  return model ? deepFreeze({ providerId, provider, model }) : null;
}

/** List immutable providers, optionally filtering by capability and/or mode. */
export function listProviders({ capability, integrationMode } = {}) {
  if (capability !== undefined && !VALID_CAPABILITIES.has(capability)) return Object.freeze([]);
  if (integrationMode !== undefined && !VALID_INTEGRATION_MODES.has(integrationMode)) return Object.freeze([]);
  return Object.freeze(UPSTREAM_PROVIDER_CATALOG.filter((provider) => (
    (capability === undefined || provider.capabilities.includes(capability))
    && (integrationMode === undefined || provider.integrationModes.includes(integrationMode))
  )));
}

export function filterProvidersByCapability(capability) {
  return listProviders({ capability });
}

export function filterProvidersByIntegrationMode(integrationMode) {
  return listProviders({ integrationMode });
}

/**
 * Create a public descriptor using an explicit allowlist. Unknown properties
 * (including apiKey, token, cookie, headers, and session material) are omitted.
 */
export function toPublicProvider(providerOrAlias) {
  const provider = typeof providerOrAlias === "string"
    ? resolveProvider(providerOrAlias)
    : providerOrAlias;
  if (!isPlainObject(provider)) return null;

  return deepFreeze({
    id: provider.id,
    name: provider.name,
    vendor: provider.vendor,
    description: provider.description,
    aliases: Array.isArray(provider.aliases) ? [...provider.aliases] : [],
    adapter: provider.adapter,
    credentialMode: provider.credentialMode,
    capabilities: Array.isArray(provider.capabilities) ? [...provider.capabilities] : [],
    integrationModes: Array.isArray(provider.integrationModes) ? [...provider.integrationModes] : [],
    models: Array.isArray(provider.models) ? provider.models.map((model) => ({
      id: model.id,
      name: model.name,
      aliases: Array.isArray(model.aliases) ? [...model.aliases] : [],
      capabilities: Array.isArray(model.capabilities) ? [...model.capabilities] : [],
    })) : [],
    router: isPlainObject(provider.router) ? {
      exposed: provider.router.exposed === true,
      protocol: provider.router.protocol,
      routes: Array.isArray(provider.router.routes) ? [...provider.router.routes] : [],
    } : null,
  });
}

export function listPublicProviders(filters = {}) {
  return deepFreeze(listProviders(filters).map((provider) => toPublicProvider(provider)));
}

export function serializePublicProvider(providerOrAlias, space = 0) {
  const provider = toPublicProvider(providerOrAlias);
  return provider ? JSON.stringify(provider, null, space) : null;
}

export function serializePublicCatalog({ space = 0, ...filters } = {}) {
  return JSON.stringify(listPublicProviders(filters), null, space);
}
