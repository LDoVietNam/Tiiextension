# GPT Web Sub2API Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the existing GPT Web → Tiiextension → native runtime path use a self-hosted Sub2API instance as a runtime-configured OpenAI-compatible model provider without exposing its key to the extension or tool-call payloads.

**Architecture:** The extension remains the browser adapter and Native Messaging remains the only filesystem/CLI control path. The native host adds a `sub2api-openai` provider connector; it reads the base URL and API key only from runtime configuration/environment, sends requests to `/v1/chat/completions`, and returns sanitized OpenAI-shaped results through the existing `/v1/chat/completions` local API.

**Tech Stack:** Node.js ESM, node:test, native `fetch`, existing Tiiextension provider catalog and local HTTP API.

## Global Constraints

- Do not send Sub2API credentials to the MV3 extension, ChatGPT Web, task payload, audit events, or API response.
- Remote Sub2API URLs must be HTTPS and may not contain user info or fragments.
- The extension continues to execute filesystem/CLI operations through Native Messaging; Sub2API is model-only.
- Reuse the existing OpenAI-compatible `/v1/chat/completions` local route.
- Test before implementation and keep existing provider behavior unchanged.

---

### Task 1: Add a public Sub2API provider descriptor

**Files:**

- Modify: `extension/src/upstream-provider-catalog.js`
- Modify: `tests/upstream-provider-catalog.test.mjs`

**Interfaces:** Produces provider id `sub2api-openai`, model id `sub2api/auto`, and aliases `sub2api`, `sub2api-gateway`, and `sub2api-auto`.

- [ ] Write a failing catalog test asserting `resolveProvider("sub2api").id === "sub2api-openai"` and `resolveModel("sub2api-auto").model.id === "sub2api/auto"`.
- [ ] Run `node --test tests/upstream-provider-catalog.test.mjs`; it must fail before implementation.
- [ ] Add an immutable runtime-configured OpenAI-compatible catalog descriptor with chat, multimodal, streaming, tool-use, and router-upstream capabilities.
- [ ] Re-run the focused test; it must pass.
- [ ] Commit: `feat: add Sub2API provider catalog entry`.

### Task 2: Add the native Sub2API connector

**Files:**

- Modify: `native-host/src/provider-connectors.js`
- Modify: `tests/provider-connectors.test.mjs`

**Interfaces:** Consumes `SUB2API_API_KEY`, `SUB2API_BASE_URL`, optional `SUB2API_CHAT_URL`, and optional `SUB2API_MODEL` only from runtime configuration. Handles `provider: "sub2api-openai"`, operation `chat.completions`.

- [ ] Write failing tests that assert `POST https://sub2api.example/v1/chat/completions`, Bearer auth, model fallback, redaction of the configured key, missing-key failure, and rejection of an HTTP endpoint.
- [ ] Run `node --test tests/provider-connectors.test.mjs`; it must fail because `sub2api-openai` is unavailable.
- [ ] Add `sub2api-openai` to `PROVIDER_OPERATIONS` and implement `dispatchSub2Api`. It must use existing `requireSecret`, `resolveRemoteEndpoint`, `requestJson`, and secret redaction.
- [ ] Re-run the focused test; it must pass.
- [ ] Commit: `feat: route native model requests through Sub2API`.

### Task 3: Verify local API routing and document configuration

**Files:**

- Modify: `tests/local-api.test.mjs`
- Modify: `README.md`
- Create: `native-host/config/runtime/sub2api.env.example`

**Interfaces:** Existing `POST /v1/chat/completions` accepts `provider: "sub2api"` and `model: "sub2api/auto"`; only native runtime settings contain `SUB2API_*` values.

- [ ] Write a failing local API test that submits the Sub2API provider alias and checks that the OpenAI-shaped response reports `provider: "sub2api-openai"`.
- [ ] Run `node --test tests/local-api.test.mjs`; it must fail until the real connector is wired.
- [ ] Use the existing local API/router contract and add an example file with `SUB2API_BASE_URL`, `SUB2API_API_KEY`, and `SUB2API_MODEL`.
- [ ] Document that credentials must never be stored in extension storage or a ChatGPT prompt.
- [ ] Run `npm test`, `npm run check`, and `npm run static-check`; all must pass.
- [ ] Commit: `docs: document Tiiextension Sub2API runtime setup`.
