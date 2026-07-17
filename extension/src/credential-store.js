// Credential storage for API tokens and browser session data
// Uses storage.local for persistence
import { storage, tabs } from './browser-polyfill.js';

const STORAGE_KEY = "credentials:v1";
const TOKEN_STORAGE_KEY = "tokens:v1";

export async function saveCredential(key, value) {
  if (!key || typeof key !== "string") throw credentialError("CREDENTIAL_KEY_REQUIRED", "key is required");
  if (isRedactedKey(key)) return { saved: false, reason: "redacted_key" };
  const stored = await storage.local.get(STORAGE_KEY);
  const credentials = stored[STORAGE_KEY] || {};
  credentials[key] = { value, savedAt: new Date().toISOString() };
  await storage.local.set({ [STORAGE_KEY]: credentials });
  return { saved: true };
}

export async function getCredential(key, { redact = true } = {}) {
  if (!key) throw credentialError("CREDENTIAL_KEY_REQUIRED", "key is required");
  const stored = await storage.local.get(STORAGE_KEY);
  const credentials = stored[STORAGE_KEY] || {};
  const entry = credentials[key];
  if (!entry) return null;
  if (redact && isRedactedKey(key)) return "[REDACTED]";
  return entry.value;
}

export async function listCredentials({ redact = true } = {}) {
  const stored = await storage.local.get(STORAGE_KEY);
  const credentials = stored[STORAGE_KEY] || {};
  const list = Object.entries(credentials).map(([key, entry]) => ({
    key,
    savedAt: entry.savedAt,
    value: redact && (isRedactedKey(key) || looksSecret(entry.value)) ? "[REDACTED]" : entry.value
  }));
  return { credentials: list, count: list.length };
}

export async function deleteCredential(key) {
  const stored = await storage.local.get(STORAGE_KEY);
  const credentials = stored[STORAGE_KEY] || {};
  delete credentials[key];
  await storage.local.set({ [STORAGE_KEY]: credentials });
  return { deleted: true };
}

// Token management for API endpoints
export async function saveToken(service, token) {
  if (!service || !token) throw credentialError("TOKEN_REQUIRED", "service and token are required");
  const stored = await storage.local.get(TOKEN_STORAGE_KEY);
  const tokens = stored[TOKEN_STORAGE_KEY] || {};
  tokens[service] = {
    token,
    savedAt: new Date().toISOString()
  };
  await storage.local.set({ [TOKEN_STORAGE_KEY]: tokens });
  return { saved: true };
}

export async function getToken(service) {
  const stored = await storage.local.get(TOKEN_STORAGE_KEY);
  const tokens = stored[TOKEN_STORAGE_KEY] || {};
  return tokens[service]?.token || null;
}

export async function listTokens({ redact = true } = {}) {
  const stored = await storage.local.get(TOKEN_STORAGE_KEY);
  const tokens = stored[TOKEN_STORAGE_KEY] || {};
  return {
    tokens: Object.entries(tokens).map(([service, data]) => ({
      service,
      savedAt: data.savedAt,
      token: redact ? `${data.token.slice(0, 4)}…${"*".repeat(Math.max(0, data.token.length - 8))}` : data.token
    })),
    count: Object.keys(tokens).length
  };
}

export async function deleteToken(service) {
  const stored = await storage.local.get(TOKEN_STORAGE_KEY);
  const tokens = stored[TOKEN_STORAGE_KEY] || {};
  delete tokens[service];
  await storage.local.set({ [TOKEN_STORAGE_KEY]: tokens });
  return { deleted: true };
}

// Load browser session directly (read from extension storage, no content script needed)
export async function loadBrowserSession() {
  const sessionKey = "browserSession:v1";
  const stored = await storage.local.get(sessionKey);
  return stored[sessionKey] || null;
}

// Save browser session (cookie/token) for reuse
export async function saveBrowserSession(sessionData) {
  if (!sessionData) throw credentialError("SESSION_REQUIRED", "session data is required");
  const sessionKey = "browserSession:v1";
  await storage.local.set({
    [sessionKey]: {
      ...sessionData,
      savedAt: new Date().toISOString()
    }
  });
  return { saved: true };
}

// Browser session extraction (requires content script on target page)
export async function extractChatGptSession(tabId) {
  try {
    const response = await tabs.sendMessage(tabId, { type: "chatgpt.extract_session" });
    if (!response?.ok) throw credentialError("SESSION_EXTRACTION_FAILED", response?.error?.message || "Could not extract session");
    return response.result;
  } catch (error) {
    throw credentialError("SESSION_EXTRACTION_FAILED", error.message, false);
  }
}

// Import credentials from JSON
export async function importCredentials(jsonData) {
  let data;
  try {
    data = typeof jsonData === "string" ? JSON.parse(jsonData) : jsonData;
  } catch {
    throw credentialError("CREDENTIALS_JSON_INVALID", "Invalid JSON format");
  }
  const stored = await storage.local.get(STORAGE_KEY);
  const credentials = stored[STORAGE_KEY] || {};
  let imported = 0;
  for (const [key, value] of Object.entries(data)) {
    // Reject storing high-sensitivity auth secrets through this path.
    if (isAuthSecretKey(key) && value !== undefined) continue;
    if (!isRedactedKey(key) && value !== undefined) {
      credentials[key] = { value, savedAt: new Date().toISOString() };
      imported++;
    }
  }
  if (imported) {
    await storage.local.set({ [STORAGE_KEY]: credentials });
  }
  return { imported, total: Object.keys(data).length };
}

// Export credentials to JSON
export async function exportCredentials({ redact = true } = {}) {
  const stored = await storage.local.get(STORAGE_KEY);
  const credentials = stored[STORAGE_KEY] || {};
  const output = {};
  for (const [key, entry] of Object.entries(credentials)) {
    // Never export high-sensitivity auth secrets.
    if (isAuthSecretKey(key)) continue;
    if (isRedactedKey(key) || (redact && looksSecret(entry.value))) continue;
    output[key] = redact ? "[REDACTED]" : entry.value;
  }
  return output;
}

function isRedactedKey(key) {
  return /cookie|session|token|secret|password|authorization|api[-_]?key/i.test(key);
}

// Keys whose values are login/auth secrets that must not be stored, logged, or exported.
function isAuthSecretKey(key) {
  return /(authorization|access[-_]?token|refresh[-_]?token|bearer|password|secret)/i.test(key);
}

// Detect token-like values (JWTs, long base64/hex bearer strings) regardless of key name.
function looksSecret(value) {
  if (typeof value !== "string") return false;
  if (/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) return true; // JWT
  if (/^(Bearer|Basic)\s+/i.test(value)) return true;
  return value.length >= 32 && /^[A-Za-z0-9+/=_-]{32,}$/.test(value); // long opaque token
}

function credentialError(code, message, retryable = false) {
  const error = new Error(message);
  error.code = code;
  error.retryable = retryable;
  return error;
}