# Tiiextension v1.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the release from the v1.0 source package into `Tiiextension` v1.1.0 with GPT direct-control paths through Cloudflare Tunnel, OpenAPI Custom Action, MCP filesystem bridge, `/v1/agent/goal`, and filesystem index tools.

**Architecture:** Keep the native host as the authoritative runtime on `127.0.0.1:18401`. GPT Custom Actions reach it through a user-provided Cloudflare Tunnel URL; MCP clients reach it through a small dependency-free MCP bridge that maps MCP tool calls to `/v1/tools/call`. Packaging changes only the release product name/root, not the internal protocol name.

**Tech Stack:** Node.js 18+ ESM built-ins, Chrome/Edge MV3, PowerShell scripts, OpenAPI 3.1 YAML, Cloudflare Tunnel config templates.

## Global Constraints

- Product/release name: `Tiiextension`.
- ZIP name: `Tiiextension-v1.1.0.zip`.
- ZIP root directory: `Tiiextension/`.
- Local API default: `127.0.0.1:18401`.
- Cloudflare token is not included; use placeholders and `.env.example` only.
- Do not extract or proxy ChatGPT cookies, tokens, or sessions.
- Keep all runtime state, secrets, logs, node_modules, generated ZIPs, and token files out of the release inventory.
- Use TDD for behavior changes.

---

### Task 1: Product metadata and packaging root

**Files:**
- Modify: `package.json`
- Modify: `native-host/package.json`
- Modify: `extension/manifest.json`
- Modify: `scripts/package-release.mjs`
- Test: `tests/packaging.test.mjs`

**Interfaces:**
- Produces package release result with `product: "Tiiextension"`, `version: "1.1.0"`, output `Tiiextension-v1.1.0.zip`, and entries rooted at `Tiiextension/`.

- [ ] Write a failing packaging test that asserts release entry names start with `Tiiextension/`, output basename is `Tiiextension-v1.1.0.zip`, and release manifest product/version match.
- [ ] Run the packaging test and verify it fails against v1.0 metadata.
- [ ] Update metadata and packager constants.
- [ ] Run packaging tests and verify they pass.

### Task 2: Local API `/v1/agent/goal`

**Files:**
- Modify: `native-host/src/local-api.js`
- Test: `tests/local-api.test.mjs`

**Interfaces:**
- Consumes runtime `task.enqueue`.
- Produces `POST /v1/agent/goal` response `{ ok: true, result: { task_id, goal, status: "queued", workspace_id?, mode, source: "api.goal" } }`.

- [ ] Write a failing local API test for `POST /v1/agent/goal` that enqueues a task with `goal`, `workspace_id`, and `mode`.
- [ ] Run the local API test and verify 404/route failure.
- [ ] Implement the endpoint by validating `goal`, forwarding to `task.enqueue`, and preserving metadata.
- [ ] Run local API tests and verify pass.

### Task 3: Filesystem index/cache tools

**Files:**
- Modify: `native-host/src/filesystems.js`
- Modify: `native-host/src/tool-manifest.js`
- Test: `tests/filesystem-index.test.mjs`

**Interfaces:**
- Produces tools: `fs.index.build`, `fs.index.status`, `fs.index.search`, `fs.index.refresh`.
- Index entries include `{ path, relative, workspace_id, size, modified_at, sha256? }` and search matches by path and text snippet.

- [ ] Write failing tests for build/status/search/refresh on a temporary workspace.
- [ ] Run the index test and verify unknown tool failure.
- [ ] Implement an in-memory index with workspace guard, ignore rules, file size limits, binary skip, and optional text snippets.
- [ ] Add tools to manifest.
- [ ] Run filesystem index and manifest tests.

### Task 4: Cloudflare Tunnel templates and scripts

**Files:**
- Create: `cloudflare/config.example.yml`
- Create: `cloudflare/.env.example`
- Create: `cloudflare/README.md`
- Create: `scripts/start-api.ps1`
- Create: `scripts/start-tunnel.ps1`
- Create: `scripts/doctor-tunnel.ps1`
- Test: `tests/operations-contract.test.mjs`

**Interfaces:**
- Produces config placeholders for `CLOUDFLARE_TUNNEL_TOKEN`, `CLOUDFLARE_TUNNEL_NAME`, and service `http://127.0.0.1:18401`.

- [ ] Write failing operations test asserting files exist and include token placeholders and port 18401.
- [ ] Run the operations test and verify missing files.
- [ ] Add templates and scripts.
- [ ] Run operations tests.

### Task 5: OpenAPI Custom Action spec

**Files:**
- Create: `openapi/chatgpt-action.yaml`
- Create: `openapi/README.md`
- Test: `tests/openapi-contract.test.mjs`

**Interfaces:**
- Produces OpenAPI 3.1 spec with bearer auth and paths `/v1/health`, `/v1/tools`, `/v1/workspaces`, `/v1/tools/call`, `/v1/agent/goal`, `/v1/events`.

- [ ] Write failing OpenAPI contract test for required paths/security/server placeholder.
- [ ] Run it and verify missing spec.
- [ ] Add YAML spec and README.
- [ ] Run OpenAPI contract test.

### Task 6: MCP filesystem bridge

**Files:**
- Create: `mcp-bridge/package.json`
- Create: `mcp-bridge/src/cnagent-client.js`
- Create: `mcp-bridge/src/tool-mapper.js`
- Create: `mcp-bridge/src/server.js`
- Create: `mcp-bridge/README.md`
- Test: `tests/mcp-bridge.test.mjs`
- Modify: `scripts/check-syntax.mjs` if needed to include new JS files.

**Interfaces:**
- Produces dependency-free stdio MCP server.
- Supports `initialize`, `tools/list`, and `tools/call` JSON-RPC methods.
- Maps selected filesystem/project/process tools to native API `/v1/tools/call`.

- [ ] Write failing unit tests for tool mapping and request shape.
- [ ] Run MCP bridge tests and verify missing modules.
- [ ] Implement client, mapper, and server.
- [ ] Run MCP bridge tests and syntax check.

### Task 7: Documentation and final package

**Files:**
- Modify: `README.md`
- Modify: `RELEASE-NOTES.md`
- Modify: `VERIFICATION.md`
- Create: `docs/GPT-CUSTOM-ACTION.md`
- Create: `docs/MCP-BRIDGE.md`
- Create: `docs/CLOUDFLARE-TUNNEL.md`
- Modify: `scripts/package-release.mjs`
- Test: full suite and ZIP validation.

**Interfaces:**
- Produces final `Tiiextension-v1.1.0.zip`, `.sha256`, and updated verification report.

- [ ] Update docs with install/use flow and limitations.
- [ ] Run `npm test`, `npm run check`, `npm run static-check`, CLI doctor, package dry-run.
- [ ] Build ZIP and run `unzip -t` plus checksum verification.
- [ ] Confirm forbidden runtime/secrets inventory is absent.
