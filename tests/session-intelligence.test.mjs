import test from "node:test";
import assert from "node:assert/strict";

import {
  SessionIntelligenceError,
  SUPPORTED_SESSION_PROVIDERS,
  analyzeProviderSession,
  analyzeSessionSnapshot,
  listSessionProviderMetadata
} from "../extension/src/session-intelligence.js";

const NOW = Date.parse("2026-07-15T00:00:00.000Z");

function jwtWithExpiry(exp) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none" })}.${encode({ exp })}.signature`;
}

test("reports an active ChatGPT session without returning credential material", () => {
  const rawName = "__Secure-next-auth.session-token";
  const rawValue = "top-secret-session-value";
  const report = analyzeProviderSession("chatgpt-web", {
    cookies: [{
      name: rawName,
      value: rawValue,
      domain: ".chatgpt.com",
      expirationDate: NOW / 1000 + 3600,
      secure: true,
      httpOnly: true,
      sameSite: "lax"
    }]
  }, { now: NOW });

  assert.equal(report.provider.id, "chatgpt");
  assert.equal(report.health.status, "authenticated");
  assert.equal(report.health.authenticated, true);
  assert.equal(report.auth.activeSignals, 1);
  assert.ok(report.capabilities.every(capability => capability.eligible));
  assert.deepEqual(report.evidence[0].security, {
    secure: true,
    httpOnly: true,
    sameSite: "lax"
  });

  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes(rawName), false);
  assert.equal(serialized.includes(rawValue), false);
  assert.equal(report.evidence[0].name, "[redacted]");
  assert.equal(report.evidence[0].value, "[redacted]");
  assert.equal(report.privacy.persisted, false);
  assert.equal(report.privacy.fingerprintsGenerated, false);
});

test("uses JWT expiry metadata in memory and marks expired storage auth", () => {
  const rawName = "chatgpt.access_token";
  const rawValue = jwtWithExpiry(NOW / 1000 - 60);
  const report = analyzeProviderSession("chatgpt", {
    origin: "https://chatgpt.com/c/123?access_token=never-return-this",
    localStorage: { [rawName]: rawValue }
  }, { now: NOW });

  assert.equal(report.health.status, "expired");
  assert.equal(report.auth.present, true);
  assert.equal(report.auth.active, false);
  assert.equal(report.auth.expiredSignals, 1);
  assert.equal(report.evidence[0].expired, true);
  assert.equal(report.evidence[0].expiresAt, "2026-07-14T23:59:00.000Z");
  assert.ok(report.capabilities.every(capability => !capability.eligible));

  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes(rawName), false);
  assert.equal(serialized.includes(rawValue), false);
  assert.equal(serialized.includes("never-return-this"), false);
});

test("ignores storage credentials when a trusted provider origin is absent", () => {
  const report = analyzeProviderSession("deepai", {
    localStorage: { "deepai.access_token": "secret" }
  }, { now: NOW });

  assert.equal(report.health.status, "unknown");
  assert.equal(report.auth.present, false);
  assert.equal(report.evidence.length, 0);
  assert.equal(report.warnings[0].code, "STORAGE_ORIGIN_REQUIRED");
});

test("accepts allowlisted auth signals for each requested web provider", () => {
  const cases = [
    {
      id: "minimax-hailuo",
      snapshot: {
        cookies: [{ name: "hailuo_session", value: "secret-a", domain: ".hailuoai.video" }]
      },
      modelId: "minimax-agent-web"
    },
    {
      id: "designer",
      snapshot: {
        cookies: [{ name: "ESTSAUTHPERSISTENT", value: "secret-b", domain: ".designer.microsoft.com" }]
      },
      modelId: "microsoft-designer-image"
    },
    {
      id: "deepai-multimodal",
      snapshot: {
        origin: "https://deepai.org/dashboard",
        localStorage: { "deepai.api-key": "secret-c" }
      },
      modelId: "deepai-multimodal"
    },
    {
      id: "felo-chat-aggregator",
      snapshot: {
        cookies: [{ name: "__Host-authjs.session-token", value: "secret-d", domain: ".felo.ai" }]
      },
      modelId: "felo-chat-aggregator"
    }
  ];

  for (const fixture of cases) {
    const report = analyzeProviderSession(fixture.id, fixture.snapshot, { now: NOW });
    assert.equal(report.health.status, "authenticated", fixture.id);
    assert.ok(report.provider.modelIds.includes(fixture.modelId), fixture.id);
    assert.ok(report.capabilities.some(capability => capability.id === "router.upstream" && capability.eligible));
    assert.equal(JSON.stringify(report).includes("secret-"), false);
  }
});

test("rejects non-allowlisted keys even on an allowed provider domain", () => {
  const report = analyzeProviderSession("minimax", {
    origin: "https://hailuoai.video/",
    cookies: [{ name: "unrelated_token", value: "must-not-count", domain: ".hailuoai.video" }],
    localStorage: { access_token: "also-must-not-count" }
  }, { now: NOW });

  assert.equal(report.health.status, "unauthenticated");
  assert.equal(report.auth.present, false);
  assert.equal(report.diagnostics.acceptedSignals, 0);
  assert.equal(report.diagnostics.ignoredEntries, 2);
  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes("unrelated_token"), false);
  assert.equal(serialized.includes("must-not-count"), false);
});

test("a CSRF-only signal is partial and cannot make router capabilities eligible", () => {
  const report = analyzeProviderSession("chatgpt", {
    cookies: [{
      name: "__Host-authjs.csrf-token",
      value: "csrf-secret",
      domain: ".chatgpt.com"
    }]
  }, { now: NOW });

  assert.equal(report.health.status, "partial");
  assert.equal(report.auth.present, false);
  assert.ok(report.capabilities.every(capability => !capability.eligible));
});

test("aggregate analysis is deterministic, immutable, and leaves input untouched", () => {
  const snapshot = {
    cookies: [{ name: "felo_session", value: "secret", domain: ".felo.ai" }],
    sessionStorage: {}
  };
  const before = structuredClone(snapshot);
  const report = analyzeSessionSnapshot(snapshot, { now: NOW });

  assert.deepEqual(snapshot, before);
  assert.equal(report.analyzedAt, "2026-07-15T00:00:00.000Z");
  assert.equal(report.providers.felo.health.status, "authenticated");
  assert.equal(report.providers.deepai.health.status, "unknown");
  assert.equal(Object.isFrozen(report), true);
  assert.equal(Object.isFrozen(report.providers.felo.capabilities), true);
  assert.deepEqual(SUPPORTED_SESSION_PROVIDERS, [
    "chatgpt",
    "minimax",
    "microsoft-designer",
    "deepai",
    "felo"
  ]);
});

test("provider metadata exposes no credential allowlist patterns", () => {
  const metadata = listSessionProviderMetadata();
  assert.equal(metadata.length, 5);
  assert.ok(metadata.find(provider => provider.id === "minimax").modelIds.includes("minimax-agent-web"));
  assert.equal(JSON.stringify(metadata).includes("session-token"), false);
  assert.equal(Object.isFrozen(metadata), true);
});

test("malformed JWT-like values are handled without throwing or leaking", () => {
  const report = analyzeProviderSession("felo", {
    origin: "https://felo.ai/",
    sessionStorage: [{ key: "felo.access_token", value: "x.%%%not-json%%%.y" }]
  }, { now: NOW });

  assert.equal(report.health.status, "authenticated");
  assert.equal(report.evidence[0].expiresAt, null);
  assert.equal(report.evidence[0].sessionScoped, true);
  assert.equal(JSON.stringify(report).includes("%%%not-json%%%"), false);
});

test("returns safe typed errors for invalid requests and input limits", () => {
  assert.throws(
    () => analyzeProviderSession("not-a-provider-secret", {}, { now: NOW }),
    error => error instanceof SessionIntelligenceError
      && error.code === "UNSUPPORTED_PROVIDER"
      && !error.message.includes("not-a-provider-secret")
  );

  assert.throws(
    () => analyzeProviderSession("chatgpt", { cookies: {} }, { now: NOW }),
    error => error instanceof SessionIntelligenceError && error.code === "INVALID_COOKIES"
  );

  assert.throws(
    () => analyzeProviderSession("chatgpt", {
      cookies: [
        { name: "a", value: "1", domain: ".chatgpt.com" },
        { name: "b", value: "2", domain: ".chatgpt.com" }
      ]
    }, { now: NOW, maxEntries: 1 }),
    error => error instanceof SessionIntelligenceError && error.code === "ENTRY_LIMIT_EXCEEDED"
  );
});
