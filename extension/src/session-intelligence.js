/**
 * Security-focused, in-memory session intelligence for browser-backed providers.
 *
 * This module intentionally does not perform I/O, persist credentials, emit
 * fingerprints, or return credential names/values. It only derives coarse
 * authentication health and router capability eligibility from provider-scoped,
 * allowlisted signals.
 */

const REDACTED = "[redacted]";
const DEFAULT_MAX_ENTRIES = 5_000;
const MAX_EVIDENCE_ITEMS = 64;

/** @typedef {"cookie" | "localStorage" | "sessionStorage"} SessionSignalSource */
/** @typedef {"session" | "access" | "refresh" | "csrf" | "account"} SessionSignalCategory */

/**
 * Error raised for invalid or unsafe session-intelligence requests.
 */
export class SessionIntelligenceError extends Error {
  /**
   * @param {string} code Stable, non-sensitive machine-readable error code.
   * @param {string} message Safe error message that never includes input data.
   */
  constructor(code, message) {
    super(message);
    this.name = "SessionIntelligenceError";
    this.code = code;
    this.retryable = false;
  }
}

/**
 * @typedef {Object} SignalRule
 * @property {RegExp} pattern Exact allowlisted key-name pattern.
 * @property {SessionSignalCategory} category Coarse, non-sensitive signal type.
 * @property {boolean} authenticates Whether an active value can establish auth.
 */

/**
 * @typedef {Object} ProviderPolicy
 * @property {string} id
 * @property {string} displayName
 * @property {readonly string[]} domains
 * @property {readonly string[]} modelIds
 * @property {readonly string[]} capabilities
 * @property {readonly SignalRule[]} cookieRules
 * @property {readonly SignalRule[]} storageRules
 */

/**
 * Build an immutable signal rule.
 *
 * @param {RegExp} pattern
 * @param {SessionSignalCategory} category
 * @param {boolean} [authenticates=false]
 * @returns {SignalRule}
 */
function signalRule(pattern, category, authenticates = false) {
  return Object.freeze({ pattern, category, authenticates });
}

/** @type {Readonly<Record<string, ProviderPolicy>>} */
const PROVIDER_POLICIES = Object.freeze({
  chatgpt: Object.freeze({
    id: "chatgpt",
    displayName: "ChatGPT Web",
    domains: Object.freeze(["chatgpt.com", "openai.com"]),
    modelIds: Object.freeze(["chatgpt-web"]),
    capabilities: Object.freeze([
      "chat.completions",
      "models.list",
      "multimodal.input",
      "router.upstream"
    ]),
    cookieRules: Object.freeze([
      signalRule(/^(?:__Secure-|__Host-)?(?:next-auth|authjs)\.session-token(?:\.\d+)?$/i, "session", true),
      signalRule(/^oai-client-auth-session$/i, "session", true),
      // Account context alone is intentionally insufficient to assert authentication.
      signalRule(/^_puid$/i, "account"),
      signalRule(/^(?:__Secure-|__Host-)?(?:next-auth|authjs)\.csrf-token$/i, "csrf")
    ]),
    storageRules: Object.freeze([
      signalRule(/^(?:oai|chatgpt)[._-](?:auth|session|access[._-]?token)$/i, "access", true),
      signalRule(/^(?:oai|chatgpt)[._-]refresh[._-]?token$/i, "refresh", true)
    ])
  }),
  minimax: Object.freeze({
    id: "minimax",
    displayName: "HailuoAI (MiniMax Web)",
    domains: Object.freeze(["hailuoai.video", "hailuoai.com", "minimax.io", "minimax.chat"]),
    modelIds: Object.freeze(["minimax-agent-web"]),
    capabilities: Object.freeze([
      "chat.completions",
      "agent.web",
      "multimodal.input",
      "router.upstream"
    ]),
    cookieRules: Object.freeze([
      signalRule(/^(?:minimax|hailuo|hailuoai)[._-]?(?:session|sid|token)$/i, "session", true),
      signalRule(/^(?:minimax|hailuo|hailuoai)[._-]?refresh[._-]?token$/i, "refresh", true)
    ]),
    storageRules: Object.freeze([
      signalRule(/^(?:minimax|hailuo|hailuoai)[._-](?:session|access[._-]?token|auth[._-]?token)$/i, "access", true),
      signalRule(/^(?:minimax|hailuo|hailuoai)[._-]refresh[._-]?token$/i, "refresh", true)
    ])
  }),
  "microsoft-designer": Object.freeze({
    id: "microsoft-designer",
    displayName: "Microsoft Designer",
    domains: Object.freeze(["designer.microsoft.com", "bing.com", "live.com", "microsoft.com"]),
    modelIds: Object.freeze(["microsoft-designer-image"]),
    capabilities: Object.freeze(["images.generate", "images.edit", "router.upstream"]),
    cookieRules: Object.freeze([
      signalRule(/^ESTSAUTH(?:LIGHT|PERSISTENT)?$/i, "session", true),
      signalRule(/^MSPAuth$/i, "session", true),
      signalRule(/^MSPProf$/i, "account"),
      signalRule(/^_U$/i, "session", true)
    ]),
    storageRules: Object.freeze([
      signalRule(/^designer[._-](?:auth|session|access[._-]?token)$/i, "access", true),
      signalRule(/^microsoft[._-]designer[._-](?:auth|session)$/i, "session", true)
    ])
  }),
  deepai: Object.freeze({
    id: "deepai",
    displayName: "DeepAI",
    domains: Object.freeze(["deepai.org"]),
    modelIds: Object.freeze(["deepai-multimodal"]),
    capabilities: Object.freeze([
      "chat.completions",
      "multimodal.input",
      "images.generate",
      "router.upstream"
    ]),
    cookieRules: Object.freeze([
      signalRule(/^deepai[._-](?:session|sid|auth|token)$/i, "session", true),
      signalRule(/^deepai[._-]refresh[._-]?token$/i, "refresh", true)
    ]),
    storageRules: Object.freeze([
      signalRule(/^deepai[._-](?:session|auth|access[._-]?token|api[._-]?key)$/i, "access", true),
      signalRule(/^deepai[._-]refresh[._-]?token$/i, "refresh", true)
    ])
  }),
  felo: Object.freeze({
    id: "felo",
    displayName: "Felo",
    domains: Object.freeze(["felo.ai"]),
    modelIds: Object.freeze(["felo-chat-aggregator"]),
    capabilities: Object.freeze(["chat.completions", "chat.aggregate", "router.upstream"]),
    cookieRules: Object.freeze([
      signalRule(/^felo[._-](?:session|sid|auth|token)$/i, "session", true),
      signalRule(/^(?:__Secure-|__Host-)?(?:next-auth|authjs)\.session-token(?:\.\d+)?$/i, "session", true),
      signalRule(/^felo[._-]refresh[._-]?token$/i, "refresh", true)
    ]),
    storageRules: Object.freeze([
      signalRule(/^felo[._-](?:session|auth|access[._-]?token)$/i, "access", true),
      signalRule(/^felo[._-]refresh[._-]?token$/i, "refresh", true)
    ])
  })
});

const PROVIDER_ALIASES = Object.freeze({
  "chatgpt-web": "chatgpt",
  hailuo: "minimax",
  hailuoai: "minimax",
  "minimax-hailuo": "minimax",
  designer: "microsoft-designer",
  microsoftdesigner: "microsoft-designer",
  "microsoft-designer-image": "microsoft-designer",
  "deepai-multimodal": "deepai",
  "felo-ai": "felo",
  "felo-chat-aggregator": "felo"
});

/** Supported canonical provider IDs. */
export const SUPPORTED_SESSION_PROVIDERS = Object.freeze(Object.keys(PROVIDER_POLICIES));

/**
 * @typedef {Object} SessionSnapshot
 * @property {Array<Object>} [cookies] Chrome-compatible cookie records.
 * @property {Record<string, unknown> | Array<Object>} [localStorage] Storage snapshot.
 * @property {Record<string, unknown> | Array<Object>} [sessionStorage] Storage snapshot.
 * @property {string} [origin] Origin for storage scoping; query/fragment are never returned.
 * @property {string} [url] Page URL used only for provider scoping.
 * @property {string} [pageUrl] Alias for url.
 */

/**
 * @typedef {Object} SessionAnalysisOptions
 * @property {number | Date} [now=Date.now()] Deterministic analysis time.
 * @property {string} [origin] Trusted page-origin hint when absent from snapshot.
 * @property {number} [maxEntries=5000] Input-size guard, from 1 to 5000.
 */

/**
 * Analyze one provider session without performing I/O or retaining input data.
 *
 * Storage entries are considered only when a snapshot/option origin matches the
 * provider. Cookie records are independently scoped by their domain. All output
 * evidence uses static categories and redaction markers, never raw names/values.
 *
 * @param {string} providerId Canonical provider ID or supported alias.
 * @param {SessionSnapshot} snapshot In-memory browser session snapshot.
 * @param {SessionAnalysisOptions} [options]
 * @returns {Readonly<Object>} Redacted provider health/capability metadata.
 * @throws {SessionIntelligenceError} For unsupported providers or invalid input.
 */
export function analyzeProviderSession(providerId, snapshot, options = {}) {
  const policy = resolvePolicy(providerId);
  const context = normalizeAnalysisInput(snapshot, options);
  return analyzePolicy(policy, context);
}

/**
 * Analyze all supported providers from one in-memory snapshot.
 *
 * @param {SessionSnapshot} snapshot
 * @param {SessionAnalysisOptions} [options]
 * @returns {Readonly<Object>} Redacted aggregate report keyed by canonical ID.
 * @throws {SessionIntelligenceError} For invalid input.
 */
export function analyzeSessionSnapshot(snapshot, options = {}) {
  const context = normalizeAnalysisInput(snapshot, options);
  const providers = {};

  for (const policy of Object.values(PROVIDER_POLICIES)) {
    providers[policy.id] = analyzePolicy(policy, context);
  }

  return deepFreeze({
    schemaVersion: 1,
    analyzedAt: new Date(context.now).toISOString(),
    providers,
    privacy: privacySummary(context.totalEntries)
  });
}

/**
 * Return non-secret provider metadata for router discovery.
 * Allowlisted credential key patterns remain private to this module.
 *
 * @returns {ReadonlyArray<Readonly<Object>>}
 */
export function listSessionProviderMetadata() {
  return deepFreeze(Object.values(PROVIDER_POLICIES).map(policy => ({
    id: policy.id,
    displayName: policy.displayName,
    domains: [...policy.domains],
    modelIds: [...policy.modelIds],
    capabilities: [...policy.capabilities]
  })));
}

/**
 * @param {string} providerId
 * @returns {ProviderPolicy}
 */
function resolvePolicy(providerId) {
  if (typeof providerId !== "string" || providerId.trim() === "") {
    throw safeError("INVALID_PROVIDER", "A supported provider ID is required.");
  }

  const requested = providerId.trim().toLowerCase();
  const canonical = PROVIDER_ALIASES[requested] || requested;
  const policy = PROVIDER_POLICIES[canonical];
  if (!policy) {
    throw safeError("UNSUPPORTED_PROVIDER", "The requested provider is not supported.");
  }
  return policy;
}

/**
 * @param {SessionSnapshot} snapshot
 * @param {SessionAnalysisOptions} options
 * @returns {Object}
 */
function normalizeAnalysisInput(snapshot, options) {
  if (!isPlainObject(snapshot)) {
    throw safeError("INVALID_SNAPSHOT", "Session snapshot must be a plain object.");
  }
  if (!isPlainObject(options)) {
    throw safeError("INVALID_OPTIONS", "Analysis options must be a plain object.");
  }

  const now = normalizeNow(options.now);
  const maxEntries = normalizeMaxEntries(options.maxEntries);
  const fallbackOrigin = firstString(options.origin, snapshot.origin, snapshot.url, snapshot.pageUrl);
  const fallbackHostname = hostnameFrom(fallbackOrigin);
  const cookies = normalizeCookies(snapshot.cookies, fallbackHostname);
  const localStorageEntries = normalizeStorage(snapshot.localStorage, "localStorage", fallbackOrigin);
  const sessionStorageEntries = normalizeStorage(snapshot.sessionStorage, "sessionStorage", fallbackOrigin);
  const totalEntries = cookies.length + localStorageEntries.length + sessionStorageEntries.length;

  if (totalEntries > maxEntries) {
    throw safeError("ENTRY_LIMIT_EXCEEDED", "Session snapshot exceeds the configured entry limit.");
  }

  return {
    now,
    fallbackHostname,
    hasStorageOrigin: Boolean(fallbackHostname)
      || localStorageEntries.some(entry => Boolean(entry.hostname))
      || sessionStorageEntries.some(entry => Boolean(entry.hostname)),
    cookies,
    storageEntries: [...localStorageEntries, ...sessionStorageEntries],
    totalEntries
  };
}

/**
 * @param {ProviderPolicy} policy
 * @param {Object} context
 * @returns {Readonly<Object>}
 */
function analyzePolicy(policy, context) {
  const evidence = [];
  let inspected = 0;
  let ignored = 0;
  let matchedScope = hostAllowed(context.fallbackHostname, policy.domains);

  for (const cookie of context.cookies) {
    inspected += 1;
    const inScope = hostAllowed(cookie.hostname || context.fallbackHostname, policy.domains);
    matchedScope ||= inScope;
    if (!inScope || !cookie.hasValue) {
      ignored += 1;
      continue;
    }

    const rule = findRule(cookie.key, policy.cookieRules);
    if (!rule) {
      ignored += 1;
      continue;
    }
    evidence.push(toRedactedEvidence(cookie, rule, context.now));
  }

  for (const entry of context.storageEntries) {
    inspected += 1;
    const inScope = hostAllowed(entry.hostname, policy.domains);
    matchedScope ||= inScope;
    if (!inScope || !entry.hasValue) {
      ignored += 1;
      continue;
    }

    const rule = findRule(entry.key, policy.storageRules);
    if (!rule) {
      ignored += 1;
      continue;
    }
    evidence.push(toRedactedEvidence(entry, rule, context.now));
  }

  const authSignals = evidence.filter(item => item.authenticates);
  const activeAuthSignals = authSignals.filter(item => !item.expired);
  const expiredAuthSignals = authSignals.filter(item => item.expired);
  const activeContextSignals = evidence.filter(item => !item.expired && !item.authenticates);
  const status = deriveStatus({
    matchedScope,
    activeAuthCount: activeAuthSignals.length,
    expiredAuthCount: expiredAuthSignals.length,
    activeContextCount: activeContextSignals.length
  });
  const eligible = status === "authenticated";
  const reason = eligible
    ? "active_session"
    : status === "expired"
      ? "session_expired"
      : "authentication_required";

  const warnings = [];
  if (context.storageEntries.length > 0 && !context.hasStorageOrigin) {
    warnings.push({
      code: "STORAGE_ORIGIN_REQUIRED",
      message: "Storage signals were ignored because no trusted page origin was supplied."
    });
  }
  if (evidence.length > MAX_EVIDENCE_ITEMS) {
    warnings.push({
      code: "EVIDENCE_TRUNCATED",
      message: "Redacted evidence was truncated to the safe reporting limit."
    });
  }

  return deepFreeze({
    schemaVersion: 1,
    provider: {
      id: policy.id,
      displayName: policy.displayName,
      modelIds: [...policy.modelIds]
    },
    health: {
      status,
      authenticated: eligible,
      confidence: eligible ? "high" : status === "expired" || status === "partial" ? "medium" : "none",
      analyzedAt: new Date(context.now).toISOString(),
      originMatched: matchedScope
    },
    auth: {
      present: authSignals.length > 0,
      active: activeAuthSignals.length > 0,
      activeSignals: activeAuthSignals.length,
      expiredSignals: expiredAuthSignals.length
    },
    capabilities: policy.capabilities.map(id => ({ id, eligible, reason })),
    evidence: evidence.slice(0, MAX_EVIDENCE_ITEMS).map((item, index) => ({
      id: `signal-${index + 1}`,
      source: item.source,
      category: item.category,
      name: REDACTED,
      value: REDACTED,
      authenticates: item.authenticates,
      expired: item.expired,
      expiresAt: item.expiresAt,
      sessionScoped: item.sessionScoped,
      ...(item.security ? { security: item.security } : {})
    })),
    diagnostics: {
      inspectedEntries: inspected,
      ignoredEntries: ignored,
      acceptedSignals: evidence.length
    },
    warnings,
    privacy: privacySummary(inspected)
  });
}

/**
 * @param {Object} counts
 * @returns {"authenticated" | "expired" | "partial" | "unauthenticated" | "unknown"}
 */
function deriveStatus({ matchedScope, activeAuthCount, expiredAuthCount, activeContextCount }) {
  if (activeAuthCount > 0) return "authenticated";
  if (expiredAuthCount > 0) return "expired";
  if (activeContextCount > 0) return "partial";
  if (matchedScope) return "unauthenticated";
  return "unknown";
}

/**
 * @param {Object} entry
 * @param {SignalRule} rule
 * @param {number} now
 * @returns {Object}
 */
function toRedactedEvidence(entry, rule, now) {
  const metadataExpiry = firstExpiry(entry.expiresAt, entry.expirationDate, entry.expires);
  const jwtExpiry = jwtExpiryMs(entry.rawValue);
  const expiryMs = earliestFinite(metadataExpiry, jwtExpiry);

  return {
    source: entry.source,
    category: rule.category,
    authenticates: rule.authenticates,
    expired: expiryMs !== null && expiryMs <= now,
    expiresAt: expiryMs === null ? null : new Date(expiryMs).toISOString(),
    sessionScoped: entry.source === "sessionStorage"
      || (entry.source === "cookie" && expiryMs === null),
    security: entry.source === "cookie"
      ? {
          secure: Boolean(entry.secure),
          httpOnly: Boolean(entry.httpOnly),
          sameSite: normalizeSameSite(entry.sameSite)
        }
      : null
  };
}

/**
 * @param {unknown} cookies
 * @param {string | null} fallbackHostname
 * @returns {Array<Object>}
 */
function normalizeCookies(cookies, fallbackHostname) {
  if (cookies == null) return [];
  if (!Array.isArray(cookies)) {
    throw safeError("INVALID_COOKIES", "Cookies must be supplied as an array.");
  }

  return cookies.map(cookie => {
    if (!isPlainObject(cookie)) {
      throw safeError("INVALID_COOKIE_ENTRY", "Each cookie entry must be a plain object.");
    }
    return {
      source: "cookie",
      key: safeKey(cookie.name),
      rawValue: cookie.value,
      hasValue: hasCredentialValue(cookie.value),
      hostname: hostnameFrom(cookie.domain) || hostnameFrom(cookie.url) || fallbackHostname,
      expirationDate: cookie.expirationDate,
      expiresAt: cookie.expiresAt,
      expires: cookie.expires,
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      sameSite: cookie.sameSite
    };
  });
}

/**
 * @param {unknown} storage
 * @param {"localStorage" | "sessionStorage"} source
 * @param {string | null} fallbackOrigin
 * @returns {Array<Object>}
 */
function normalizeStorage(storage, source, fallbackOrigin) {
  if (storage == null) return [];

  if (Array.isArray(storage)) {
    return storage.map(item => {
      if (!isPlainObject(item)) {
        throw safeError("INVALID_STORAGE_ENTRY", "Each storage entry must be a plain object.");
      }
      return {
        source,
        key: safeKey(item.key ?? item.name),
        rawValue: item.value,
        hasValue: hasCredentialValue(item.value),
        hostname: hostnameFrom(firstString(item.origin, item.url, fallbackOrigin)),
        expirationDate: item.expirationDate,
        expiresAt: item.expiresAt,
        expires: item.expires
      };
    });
  }

  if (!isPlainObject(storage)) {
    throw safeError("INVALID_STORAGE", "Storage snapshots must be plain objects or entry arrays.");
  }

  return Object.entries(storage).map(([key, value]) => ({
    source,
    key: safeKey(key),
    rawValue: value,
    hasValue: hasCredentialValue(value),
    hostname: hostnameFrom(fallbackOrigin),
    expirationDate: null,
    expiresAt: null,
    expires: null
  }));
}

/**
 * @param {string} key
 * @param {readonly SignalRule[]} rules
 * @returns {SignalRule | null}
 */
function findRule(key, rules) {
  if (!key) return null;
  return rules.find(rule => rule.pattern.test(key)) || null;
}

/**
 * Decode only the expiry timestamp of a JWT-like value. Payload fields are not
 * retained or returned. Malformed/untrusted values fail closed without throwing.
 *
 * @param {unknown} value
 * @returns {number | null}
 */
function jwtExpiryMs(value) {
  if (typeof value !== "string") return null;
  const parts = value.split(".");
  if (parts.length !== 3 || parts[1].length === 0 || parts[1].length > 16_384) return null;

  try {
    const normalized = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const decoded = globalThis.atob(padded);
    const payload = JSON.parse(decoded);
    return isPlainObject(payload) ? epochToMs(payload.exp) : null;
  } catch {
    return null;
  }
}

/** @param {...unknown} values @returns {number | null} */
function firstExpiry(...values) {
  for (const value of values) {
    const result = epochToMs(value);
    if (result !== null) return result;
  }
  return null;
}

/** @param {unknown} value @returns {number | null} */
function epochToMs(value) {
  if (value == null || value === "") return null;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }

  if (typeof value === "string" && !/^\d+(?:\.\d+)?$/.test(value.trim())) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return numeric < 1e12 ? numeric * 1000 : numeric;
}

/** @param {number | null} left @param {number | null} right @returns {number | null} */
function earliestFinite(left, right) {
  if (left === null) return right;
  if (right === null) return left;
  return Math.min(left, right);
}

/** @param {unknown} value @returns {boolean} */
function hasCredentialValue(value) {
  if (value == null) return false;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized !== "" && normalized !== "null" && normalized !== "undefined" && normalized !== "\"\"";
  }
  return typeof value === "number" || typeof value === "boolean";
}

/** @param {unknown} value @returns {string} */
function safeKey(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) return "";
  return value;
}

/**
 * Extract a hostname without returning or logging the original input.
 *
 * @param {unknown} value
 * @returns {string | null}
 */
function hostnameFrom(value) {
  if (typeof value !== "string" || value.trim() === "") return null;
  const trimmed = value.trim().toLowerCase();
  try {
    return new URL(trimmed.includes("://") ? trimmed : `https://${trimmed.replace(/^\./, "")}`).hostname;
  } catch {
    return null;
  }
}

/** @param {string | null} hostname @param {readonly string[]} domains @returns {boolean} */
function hostAllowed(hostname, domains) {
  if (!hostname) return false;
  const host = hostname.toLowerCase().replace(/^\./, "");
  return domains.some(domain => host === domain || host.endsWith(`.${domain}`));
}

/** @param {unknown} value @returns {"strict" | "lax" | "none" | "unspecified"} */
function normalizeSameSite(value) {
  const normalized = typeof value === "string" ? value.toLowerCase() : "";
  return normalized === "strict" || normalized === "lax" || normalized === "none"
    ? normalized
    : "unspecified";
}

/** @param {unknown} value @returns {number} */
function normalizeNow(value) {
  if (value == null) return Date.now();
  const now = value instanceof Date ? value.getTime() : Number(value);
  if (!Number.isFinite(now) || now < 0) {
    throw safeError("INVALID_NOW", "Analysis time must be a valid date or epoch value.");
  }
  return now;
}

/** @param {unknown} value @returns {number} */
function normalizeMaxEntries(value) {
  if (value == null) return DEFAULT_MAX_ENTRIES;
  const maxEntries = Number(value);
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > DEFAULT_MAX_ENTRIES) {
    throw safeError("INVALID_ENTRY_LIMIT", "Entry limit must be an integer between 1 and 5000.");
  }
  return maxEntries;
}

/** @param {...unknown} values @returns {string | null} */
function firstString(...values) {
  return values.find(value => typeof value === "string" && value.trim() !== "") || null;
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isPlainObject(value) {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** @param {number} inspectedEntries @returns {Readonly<Object>} */
function privacySummary(inspectedEntries) {
  return Object.freeze({
    processing: "memory_only",
    persisted: false,
    rawNamesReturned: false,
    rawValuesReturned: false,
    fingerprintsGenerated: false,
    inspectedEntries
  });
}

/** @param {string} code @param {string} message @returns {SessionIntelligenceError} */
function safeError(code, message) {
  return new SessionIntelligenceError(code, message);
}

/** @template T @param {T} value @returns {Readonly<T>} */
function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
