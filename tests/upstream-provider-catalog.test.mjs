import test from "node:test";
import assert from "node:assert/strict";

import {
  INTEGRATION_MODES,
  PROVIDER_CAPABILITIES,
  UPSTREAM_PROVIDER_CATALOG,
  filterProvidersByCapability,
  filterProvidersByIntegrationMode,
  listProviders,
  resolveModel,
  resolveModelId,
  resolveProvider,
  resolveProviderId,
  serializePublicCatalog,
  serializePublicProvider,
  toPublicProvider,
  validateProviderCatalog,
  validateProviderDescriptor,
} from "../extension/src/upstream-provider-catalog.js";

const EXPECTED_PROVIDER_IDS = [
  "minimax-agent-web",
  "microsoft-designer-web",
  "deepai-web",
  "freetheai-openai",
  "edge-tts",
  "gtts",
  "felo-chat",
  "mixedbread-embeddings",
  "speechmatics-stt",
  "gladia-stt",
];

test("catalog contains every requested provider and validates as a whole", () => {
  assert.deepEqual(UPSTREAM_PROVIDER_CATALOG.map(({ id }) => id), EXPECTED_PROVIDER_IDS);
  assert.deepEqual(validateProviderCatalog(UPSTREAM_PROVIDER_CATALOG), { valid: true, errors: [] });
  for (const provider of UPSTREAM_PROVIDER_CATALOG) {
    assert.deepEqual(validateProviderDescriptor(provider), { valid: true, errors: [] });
    assert.equal(Object.isFrozen(provider), true);
    assert.equal(provider.capabilities.includes(PROVIDER_CAPABILITIES.ROUTER_UPSTREAM), true);
    assert.equal(provider.integrationModes.includes(INTEGRATION_MODES.ROUTER_UPSTREAM), true);
  }
});

test("model ids are stable, globally unique, and router-friendly", () => {
  const ids = UPSTREAM_PROVIDER_CATALOG.flatMap(({ models }) => models.map(({ id }) => id));
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids.every((id) => /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/.test(id)), true);
  assert.ok(ids.includes("hailuoai/minimax-agent-web"));
  assert.ok(ids.includes("microsoft-designer/image-generation"));
  assert.ok(ids.includes("deepai/multimodal-chat"));
});

test("provider and model aliases resolve case-insensitively", () => {
  assert.equal(resolveProviderId("HailuoAI"), "minimax-agent-web");
  assert.equal(resolveProviderId("Microsoft Designer"), "microsoft-designer-web");
  assert.equal(resolveProvider("mxbai")?.id, "mixedbread-embeddings");
  assert.equal(resolveProviderId("does-not-exist"), null);

  assert.equal(resolveModelId("MiniMax_Agent_Web"), "hailuoai/minimax-agent-web");
  assert.equal(resolveModelId("designer-image"), "microsoft-designer/image-generation");
  const resolved = resolveModel("speechmatics-transcribe");
  assert.equal(resolved?.providerId, "speechmatics-stt");
  assert.equal(resolved?.model.id, "speechmatics/transcribe");
  assert.equal(resolveModel("does-not-exist"), null);
});

test("providers can be listed and filtered by capability or integration mode", () => {
  assert.equal(listProviders().length, EXPECTED_PROVIDER_IDS.length);

  const imageProviders = filterProvidersByCapability(PROVIDER_CAPABILITIES.IMAGE_GENERATION);
  assert.deepEqual(imageProviders.map(({ id }) => id), ["microsoft-designer-web"]);

  const sttProviders = filterProvidersByCapability(PROVIDER_CAPABILITIES.SPEECH_TO_TEXT);
  assert.deepEqual(sttProviders.map(({ id }) => id), ["speechmatics-stt", "gladia-stt"]);

  const browserProviders = filterProvidersByIntegrationMode(INTEGRATION_MODES.BROWSER_SESSION);
  assert.deepEqual(browserProviders.map(({ id }) => id), [
    "minimax-agent-web",
    "microsoft-designer-web",
    "deepai-web",
    "felo-chat",
  ]);

  assert.deepEqual(listProviders({ capability: "unsupported.capability" }), []);
});

test("public serialization uses an allowlist and never leaks secret material", () => {
  const source = {
    ...UPSTREAM_PROVIDER_CATALOG[0],
    apiKey: "do-not-serialize",
    token: "do-not-serialize",
    cookie: "do-not-serialize",
    headers: { authorization: "do-not-serialize" },
    session: { accessToken: "do-not-serialize" },
    router: {
      ...UPSTREAM_PROVIDER_CATALOG[0].router,
      authorization: "do-not-serialize",
    },
    models: UPSTREAM_PROVIDER_CATALOG[0].models.map((model) => ({
      ...model,
      apiKey: "do-not-serialize",
    })),
  };

  const publicDescriptor = toPublicProvider(source);
  const serialized = JSON.stringify(publicDescriptor);
  assert.equal(serialized.includes("do-not-serialize"), false);
  assert.deepEqual(Object.keys(publicDescriptor).sort(), [
    "adapter",
    "aliases",
    "capabilities",
    "credentialMode",
    "description",
    "id",
    "integrationModes",
    "models",
    "name",
    "router",
    "vendor",
  ]);
  assert.equal(serializePublicProvider("hailuo")?.includes("do-not-serialize"), false);
  assert.equal(serializePublicCatalog().includes("do-not-serialize"), false);
});

test("validation rejects malformed and conflicting descriptors", () => {
  const invalid = {
    ...UPSTREAM_PROVIDER_CATALOG[0],
    id: "Not Router Safe",
    integrationModes: [INTEGRATION_MODES.BROWSER_SESSION],
    models: [{
      ...UPSTREAM_PROVIDER_CATALOG[0].models[0],
      id: "missing-namespace",
      capabilities: [PROVIDER_CAPABILITIES.IMAGE_GENERATION],
    }],
  };
  const descriptorResult = validateProviderDescriptor(invalid);
  assert.equal(descriptorResult.valid, false);
  assert.match(descriptorResult.errors.join("\n"), /router-safe provider id/);
  assert.match(descriptorResult.errors.join("\n"), /namespace\/model/);
  assert.match(descriptorResult.errors.join("\n"), /router-upstream/);

  const duplicateAlias = [
    UPSTREAM_PROVIDER_CATALOG[0],
    {
      ...UPSTREAM_PROVIDER_CATALOG[1],
      aliases: [...UPSTREAM_PROVIDER_CATALOG[1].aliases, "hailuo"],
    },
  ];
  const catalogResult = validateProviderCatalog(duplicateAlias);
  assert.equal(catalogResult.valid, false);
  assert.match(catalogResult.errors.join("\n"), /conflicts with minimax-agent-web/);
});
