# Blueprint v2 v1.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the existing v0.2.0 Chrome/Edge extension and Node native host into a self-contained v1.0 release package implementing the Blueprint v2 contracts, filesystem-first autonomous runtime, local API/CLI, browser tools, workspace UI, and release controls.

**Architecture:** The MV3 extension remains the browser/provider control plane; the Node native host becomes the durable execution and trust plane. All model/page input is normalized into `cnagent/1`, task and call state is persisted atomically, and every filesystem mutation is mediated by a workspace-scoped transaction manager. Node 18 built-ins are used so the ZIP has no install-time package dependency.

**Tech Stack:** JavaScript ES modules, Node.js 18+ built-ins, Chrome/Edge Manifest V3 APIs, native messaging JSON framing, Node test runner, HTML/CSS.

## Global Constraints

- Target Chrome and Edge Chromium on Windows 10/11.
- Keep the popup to exactly two user modes, `UI` and `API`; both must chat.
- Use ChatGPT Web only through the current tab/session; never read, export, store, log, or proxy its cookie/session/access token.
- Prefer `com.chatgpt_native_agent.host`; accept another host only after a compatible handshake.
- Do not ask for confirmation per tool call; enforce workspace profiles and policy automatically.
- Every supported filesystem mutation is transactional and auditable.
- Dev mode may load unsigned payloads; release mode must verify checksum and Ed25519 signature.
- Bind the local API only to loopback and require a local bearer token.
- Keep backward compatibility with v0.2 structured blocks and native calls.
- The workspace does not contain writable Git metadata, so each task ends with fresh tests and a file/hash checkpoint instead of a commit.

---

### Task 1: Versioned protocol and schemas

**Files:**
- Create: `native-host/src/protocol.js`
- Create: `schemas/protocol-envelope.schema.json`
- Create: `schemas/runtime-config.schema.json`
- Create: `schemas/tool-manifest.schema.json`
- Modify: `extension/src/block-parser.js`
- Modify: `schemas/structured-blocks.schema.json`
- Test: `tests/protocol.test.mjs`
- Test: `tests/block-parser.test.mjs`

**Interfaces:**
- Produces `normalizeEnvelope(value, options) -> Envelope[]`.
- Produces `validateEnvelope(value) -> { ok, errors }`.
- Produces `makeTaskResult({taskId, blockId, callId, ok, data, error, metrics})`.
- Extension parser returns normalized blocks with `protocol`, `taskId`, `blockId`, `type`, and `payload`.

- [ ] **Step 1: Add failing protocol tests**

Cover exactly-one business key, ID generation, legacy normalization, multiple blocks, unknown-key rejection, and stable error results.

- [ ] **Step 2: Run protocol tests and confirm failure**

Run: `node --test tests/protocol.test.mjs tests/block-parser.test.mjs`

Expected: failure because `native-host/src/protocol.js` and cnagent/1 normalization do not exist.

- [ ] **Step 3: Implement strict protocol normalization**

Use this public shape:

```js
export const PROTOCOL = "cnagent/1";
export const BUSINESS_KEYS = [
  "agent_goal", "agent_action", "tool_call", "payload_load",
  "task_result", "task_event", "filesystem_read", "filesystem_write",
  "filesystem_patch", "filesystem_search"
];

export function normalizeEnvelope(value, { taskId, idFactory } = {}) {}
export function validateEnvelope(value) {}
export function makeTaskResult(input) {}
```

Legacy `{tool_call:{tool,args}}` must normalize without changing the tool name or args.

- [ ] **Step 4: Add complete JSON Schemas and update parser**

Schemas must use Draft 2020-12, reject multiple business keys, constrain IDs/limits, and preserve separate block types.

- [ ] **Step 5: Run focused tests**

Run: `node --test tests/protocol.test.mjs tests/block-parser.test.mjs`

Expected: all focused tests pass.

---

### Task 2: Durable store, event journal, and task engine

**Files:**
- Create: `native-host/src/durable-store.js`
- Create: `native-host/src/event-bus.js`
- Create: `native-host/src/task-engine.js`
- Test: `tests/task-engine.test.mjs`

**Interfaces:**
- `createDurableStore({filePath})` exposes `init`, `read`, `write`, `update`, and `snapshot`.
- `createEventBus({store, maxEvents})` exposes `emit`, `list`, and `subscribe`.
- `createTaskEngine({store, events, idFactory, clock})` exposes `enqueue`, `get`, `list`, `transition`, `cancel`, `recordCall`, `completeCall`, and `recover`.

- [ ] **Step 1: Add failing durability/state tests**

Tests must restart the store, reject invalid state transitions, preserve event cursors, deduplicate the same idempotency key, cancel clean tasks directly, and mark dirty tasks for rollback.

- [ ] **Step 2: Run tests and confirm failure**

Run: `node --test tests/task-engine.test.mjs`

Expected: module-not-found failure.

- [ ] **Step 3: Implement atomic JSON durable store**

Write a temporary sibling file, fsync/close it, then rename over the database file. Store schema:

```js
{
  schema: "cnagent-store/1",
  tasks: {},
  calls: {},
  transactions: {},
  events: [],
  nextCursor: 1
}
```

Serialize updates through a promise queue so concurrent writers cannot lose changes.

- [ ] **Step 4: Implement task state machine and call journal**

Allowed states and transitions must match Blueprint v2. `recordCall` must return the persisted result for a completed duplicate idempotency key and never re-run it.

- [ ] **Step 5: Implement ordered event replay**

`list({afterCursor, taskId, types, limit})` must preserve ascending cursor order and report whether earlier retained events were pruned.

- [ ] **Step 6: Run focused tests**

Run: `node --test tests/task-engine.test.mjs`

Expected: all focused tests pass.

---

### Task 3: Config v2, policy engine, and hardened workspace guard

**Files:**
- Create: `native-host/src/config-loader.js`
- Create: `native-host/src/policy-engine.js`
- Modify: `native-host/src/workspace-guard.js`
- Modify: `native-host/config/default.workspaces.json`
- Test: `tests/workspace-policy.test.mjs`

**Interfaces:**
- `loadRuntimeConfig(configPath) -> {config, activeProfile, baseDir}`.
- `createPolicyEngine({config, profile})` exposes `authorizeTool`, `limitsFor`, `scrub`, and `isCommandAllowed`.
- `createWorkspaceGuard(workspaces, baseDir)` exposes `resolveInside`, `resolveParentInside`, `listWorkspaces`, and `relativeRef`.

- [ ] **Step 1: Add failing path and policy tests**

Cover `..`, case-prefix collision, non-existing targets, nested roots, read-only roots, deny/redact globs, command allowlist, and Unix symlink escape where supported. Windows junction behavior is represented by a platform-gated fixture.

- [ ] **Step 2: Run tests and confirm failure**

Run: `node --test tests/workspace-policy.test.mjs`

- [ ] **Step 3: Implement config v1→v2 normalization**

Accept existing `mode/workspaces/profiles/logsPath`, emit one effective v2 profile, resolve relative roots against the config directory, and validate required values with explicit errors.

- [ ] **Step 4: Harden workspace containment**

Resolve the nearest existing ancestor for new targets, compare with `path.relative`, revalidate parents before mutation, return workspace IDs plus relative paths, and reject device/ADS forms by default on Windows.

- [ ] **Step 5: Implement automatic policy decisions**

Return `{allowed, reason, capability, limits}` without prompting. Model calls may not change profiles, trusted keys, or administrative policy.

- [ ] **Step 6: Run focused tests**

Run: `node --test tests/workspace-policy.test.mjs`

Expected: all focused tests pass.

---

### Task 4: Transactional filesystem, codecs, and unified diff

**Files:**
- Create: `native-host/src/filesystem-codecs.js`
- Create: `native-host/src/unified-diff.js`
- Create: `native-host/src/transaction-manager.js`
- Rewrite: `native-host/src/filesystems.js`
- Test: `tests/filesystem-transaction.test.mjs`
- Test: `tests/unified-diff.test.mjs`

**Interfaces:**
- `createTransactionManager({guard, store, events, dataDir})` exposes `begin`, `stageWrite`, `stageDelete`, `stageMove`, `preview`, `commit`, `rollback`, `status`, and `listSnapshots`.
- `parseUnifiedDiff(text)` and `applyUnifiedDiff(files, patch, options)` return explicit conflicts and never guess mismatched context.
- `detectBuffer(buffer)` returns binary/encoding/BOM/EOL metadata.
- `createFilesystemTools(context)` routes legacy and v1 filesystem tools.

- [ ] **Step 1: Add failing transaction/diff tests**

Test atomic write, multi-file all-or-nothing, delete trash, rollback restore/remove, duplicate transaction commit, CRLF/BOM preservation, binary rejection, multi-hunk patch, malformed patch, and context conflict.

- [ ] **Step 2: Run tests and confirm failure**

Run: `node --test tests/filesystem-transaction.test.mjs tests/unified-diff.test.mjs`

- [ ] **Step 3: Implement codec and patch primitives**

Support UTF-8, UTF-8 BOM, UTF-16LE BOM, LF/CRLF detection, binary classification, and exact context matching. Patch output must preserve original EOL/BOM.

- [ ] **Step 4: Implement transaction journal and staging**

Each transaction directory contains `manifest.json`, `before/`, `stage/`, and `trash/`. Every entry records relative path, prior existence, SHA-256, staged hash, and operation. Revalidate path identity before apply.

- [ ] **Step 5: Route every mutation through a transaction**

Legacy `fs.write`, `fs.write_many`, `fs.append`, `fs.patch`, `fs.patch_unified`, `fs.delete`, `fs.move`, and `fs.copy` create an automatic transaction when no `transactionId` is supplied, commit it, and return transaction/snapshot metadata.

- [ ] **Step 6: Add expanded read/search/snapshot tools**

Implement `fs.hash`, `fs.detect_encoding`, `fs.read_bytes`, `fs.search_regex`, `fs.find_files`, transaction status/preview/commit/rollback, and snapshot pruning with pagination/limits.

- [ ] **Step 7: Run focused tests**

Run: `node --test tests/filesystem-transaction.test.mjs tests/unified-diff.test.mjs tests/native-runtime.test.mjs`

Expected: all focused and legacy tests pass.

---

### Task 5: Process supervisor, project verification, and signed payloads

**Files:**
- Rewrite: `native-host/src/process-tools.js`
- Modify: `native-host/src/project-tools.js`
- Rewrite: `native-host/src/payload-loader.js`
- Create: `native-host/src/payload-worker.js`
- Test: `tests/process-payload.test.mjs`

**Interfaces:**
- `createProcessTools({guard, policy, events})` exposes `run`, `cancel`, and `list`.
- `createPayloadLoader({mode, guard, policy, processTools, trustedKeys})` supports module and command manifests.
- Release signature verification uses canonical manifest bytes and Ed25519 `crypto.verify`.

- [ ] **Step 1: Add failing process/payload tests**

Cover allowed/denied commands, timeout, capped output, working-directory guard, command payload, unsigned dev module, release checksum mismatch, unknown key, invalid signature, and valid Ed25519 signature.

- [ ] **Step 2: Run tests and confirm failure**

Run: `node --test tests/process-payload.test.mjs`

- [ ] **Step 3: Implement supervised process execution**

Use no shell by default, minimal allowlisted environment, output byte caps, timeout, cancellation, and Windows process-tree termination fallback through `taskkill` only when needed.

- [ ] **Step 4: Implement project verification tools**

Add `project.dependencies`, `project.lint`, and `project.typecheck`; route every script through the process supervisor.

- [ ] **Step 5: Implement module and command payloads**

Dev modules run in a worker thread with serialized method calls. Command payloads resolve templates to a no-shell process call. Release load verifies entry SHA-256 and Ed25519 signature against config trusted keys before starting a worker.

- [ ] **Step 6: Run focused tests**

Run: `node --test tests/process-payload.test.mjs`

Expected: all focused tests pass.

---

### Task 6: Runtime integration, native handshake, audit, and artifacts

**Files:**
- Create: `native-host/src/audit-store.js`
- Create: `native-host/src/artifact-store.js`
- Rewrite: `native-host/src/runtime.js`
- Modify: `native-host/src/tool-manifest.js`
- Modify: `native-host/bin/chatgpt-native-agent-host.js`
- Modify: `extension/src/native-client.js`
- Test: `tests/runtime-v1.test.mjs`

**Interfaces:**
- `createRuntime(options)` returns `{handle, close, guard, tasks, events}`.
- `runtime.handshake` returns host ID/version, selected protocol, capabilities, limits, active profile, and nonce.
- Every response uses `{ok,result}` or `{ok:false,error}` at transport boundaries.
- Results above the internal message budget become artifact references.

- [ ] **Step 1: Add failing runtime contract tests**

Test handshake, tool manifests, policy denial error code, idempotent tool call, task lifecycle, event cursor, audit redaction/hash chain, artifact creation, and legacy native message compatibility.

- [ ] **Step 2: Run tests and confirm failure**

Run: `node --test tests/runtime-v1.test.mjs`

- [ ] **Step 3: Implement audit and artifact stores**

Audit JSONL entries include `prev_hash` and `event_hash`; payloads are scrubbed before hashing. Artifacts have metadata, SHA-256, sensitivity, task/call owner, and a safe path below runtime data directory.

- [ ] **Step 4: Compose the v1 runtime**

Load config/policy/store, recover transactions/tasks, dispatch tool calls through policy and call journal, emit task events, and convert errors to stable code families.

- [ ] **Step 5: Upgrade native port client**

Handshake after connect, correlate request IDs, reconnect with bounded backoff, expose status/capabilities, and keep service-worker global state disposable.

- [ ] **Step 6: Run focused and legacy tests**

Run: `node --test tests/runtime-v1.test.mjs tests/native-runtime.test.mjs`

Expected: all tests pass.

---

### Task 7: Loopback HTTP/WebSocket API and CLI v2

**Files:**
- Create: `native-host/src/websocket.js`
- Create: `native-host/src/local-api.js`
- Rewrite: `native-host/bin/agent-cli.js`
- Create: `native-host/bin/agent-server.js`
- Test: `tests/local-api.test.mjs`

**Interfaces:**
- `createLocalApi({runtime,host,port,token,allowedOrigins})` exposes `listen` and `close`.
- HTTP routes match Blueprint `/v1/*` endpoints.
- WebSocket `/v1/events` supports text event frames and cursor replay.
- CLI prints JSON with `--json` and uses stable exit code classes.

- [ ] **Step 1: Add failing API security and route tests**

Test loopback default, missing/wrong bearer token, denied Origin, health/tools/tasks/tool call/artifact routes, body limit, and WebSocket handshake/event frame.

- [ ] **Step 2: Run tests and confirm failure**

Run: `node --test tests/local-api.test.mjs`

- [ ] **Step 3: Implement authenticated HTTP routes**

Use Node `http`, reject non-loopback bind in release standard mode, parse bounded JSON bodies, set no permissive CORS header, and map stable runtime errors to HTTP status.

- [ ] **Step 4: Implement minimal RFC6455 event server**

Validate Upgrade headers, compute `Sec-WebSocket-Accept`, send unmasked server text frames, parse client close/ping frames, and unsubscribe on disconnect.

- [ ] **Step 5: Implement CLI and standalone server**

Support health/tools/workspace/task/tool/events/snapshots/rollback/doctor. The direct CLI may instantiate the runtime; chat tasks require an active extension/provider bridge and must return `PROVIDER_UNAVAILABLE` otherwise.

- [ ] **Step 6: Run focused tests**

Run: `node --test tests/local-api.test.mjs`

Expected: all focused tests pass.

---

### Task 8: Extension provider coordinator and browser tools

**Files:**
- Create: `extension/src/provider-coordinator.js`
- Rewrite: `extension/src/browser-agent.js`
- Modify: `extension/src/background.js`
- Modify: `extension/src/chatgpt-content.js`
- Modify: `extension/src/provider-registry.js`
- Modify: `extension/manifest.json`
- Test: `tests/provider-coordinator.test.mjs`

**Interfaces:**
- `createProviderCoordinator(adapter)` serializes requests per tab and marks ambiguous submissions.
- `runBrowserAction(action)` supports tabs/navigation/locator/screenshot/DOM/console/network/download/CDP methods.
- Background routes validate sender and normalized protocol before auto-run.

- [ ] **Step 1: Add failing pure coordinator tests**

Use a fake adapter to prove per-tab concurrency one, ordered responses, timeout, cancellation, ambiguous submission behavior, and reconnect-safe request IDs.

- [ ] **Step 2: Run tests and confirm failure**

Run: `node --test tests/provider-coordinator.test.mjs`

- [ ] **Step 3: Implement provider state and queue**

Keep only disposable queue objects in the service worker; native tasks remain authoritative. Status includes login, model label from visible UI, streaming, rate-limit/challenge/network/DOM errors.

- [ ] **Step 4: Implement browser tools with exact-match locators**

Accessible role/name, text/label, test ID, then CSS. Mutating locator calls reject zero or multiple matches. Add tab leases and debugger attach/detach cleanup.

- [ ] **Step 5: Harden ChatGPT content adapter**

Use selector groups, response-turn boundaries, stable-stream detection, login/challenge/rate-limit detection, one-time content-script guard, and `cnagent/1` result binding. Never inspect cookies or tokens.

- [ ] **Step 6: Update manifest permissions**

Declare the permissions used by the shipped full-control build and document why. Restrict the content script to ChatGPT domains; broad host permissions are used only by on-demand scripting/browser tools.

- [ ] **Step 7: Run focused tests and syntax checks**

Run: `node --test tests/provider-coordinator.test.mjs && npm run check`

Expected: tests and checks pass.

---

### Task 9: Popup, side-panel workspace, overlay, and diagnostics UI

**Files:**
- Modify: `extension/src/popup.html`
- Modify: `extension/src/popup.css`
- Modify: `extension/src/popup.js`
- Rewrite: `extension/src/sidepanel.html`
- Rewrite: `extension/src/sidepanel.css`
- Rewrite: `extension/src/sidepanel.js`
- Modify: `extension/src/chatgpt-content.js`

**Interfaces:**
- Popup exposes exactly `UI` and `API` modes with shared chat.
- Side panel exposes `Agent`, `Files`, `Changes`, and `Activity` tabs.
- UI uses native routes for workspace tree/read/search/transactions/snapshots/tasks/events.

- [ ] **Step 1: Build the semantic side-panel shell**

Create accessible tabs, connection header, goal composer, task controls, tree/search, preview, diff/transaction controls, timeline, and diagnostics regions.

- [ ] **Step 2: Implement side-panel state and routing**

Use one state object and render functions. Poll/replay task events by cursor when long-lived port events are unavailable. Escape all rendered file/page/model text by assigning `textContent`.

- [ ] **Step 3: Complete file and changes flows**

Tree nodes load lazily, preview detects binary/truncation, search renders path/line cards, changes show transaction preview, snapshot list supports rollback, and errors show stable code plus retryability.

- [ ] **Step 4: Polish popup and overlay**

Keep popup simple, add provider/native/task badges and “Open workspace”. Overlay remains compact and binds Run/Preview/Copy to a block ID so MutationObserver rescans cannot duplicate execution.

- [ ] **Step 5: Run syntax and static UI checks**

Run: `npm run check && node scripts/static-ui-check.mjs`

Expected: all scripts parse, required IDs/tabs/modes exist, and no inline remote code is referenced.

---

### Task 10: Installer, doctor, release mode, and documentation

**Files:**
- Rewrite: `scripts/install-native-host.ps1`
- Modify: `scripts/uninstall-native-host.ps1`
- Create: `scripts/doctor.ps1`
- Create: `scripts/package-release.mjs`
- Create: `scripts/static-ui-check.mjs`
- Create: `native-host/config/trusted-publishers.json`
- Rewrite: `README.md`
- Create: `SECURITY.md`
- Create: `docs/PROTOCOL.md`
- Create: `docs/PAYLOADS.md`
- Create: `docs/TROUBLESHOOTING.md`

**Interfaces:**
- Installer modes: install, repair, dry-run; Chrome, Edge, or both.
- Doctor checks Node, config, manifest, registry command previews, runtime handshake, API token ACL hints, and writable runtime directories.
- Packaging creates deterministic release content, excludes runtime logs/secrets/snapshots/node_modules, and emits SHA-256.

- [ ] **Step 1: Upgrade installer and add doctor**

Use stable absolute host path, validate extension ID, generate allowed origins, create config/token directories, register HKCU browser keys, and make reruns idempotent. Dry-run performs no write.

- [ ] **Step 2: Add release packager**

Copy only allowlisted source/docs/config files into a staging directory, set package versions to 1.0.0, write release manifest/SBOM/checksum, and create ZIP using available platform tooling.

- [ ] **Step 3: Rewrite user/security/protocol/payload docs**

Clearly distinguish implemented v1 behavior from compatibility/future limits, include install/use examples, and repeat the no-cookie-proxy boundary.

- [ ] **Step 4: Run doctor/static/package dry runs**

Run: `node scripts/static-ui-check.mjs && node scripts/package-release.mjs --dry-run`

Expected: required package inventory prints with no excluded runtime file.

---

### Task 11: Full verification and final ZIP

**Files:**
- Modify: `package.json`
- Modify: `native-host/package.json`
- Create: `RELEASE-NOTES.md`
- Create: `VERIFICATION.md`

**Interfaces:**
- `npm test` runs the complete Node test suite.
- `npm run check` syntax-checks every shipped JavaScript module.
- `npm run package` creates `chatgpt-native-agent-extension-v1.0.0.zip` and `.sha256` outside the source directory.

- [ ] **Step 1: Set versions and complete scripts**

Set package/manifest/runtime versions to `1.0.0`. Add test, check, static-check, doctor, and package scripts without network dependencies.

- [ ] **Step 2: Run the full test suite**

Run: `npm test`

Expected: zero failed tests.

- [ ] **Step 3: Run syntax/static checks**

Run: `npm run check && npm run static-check`

Expected: exit 0 with every shipped JS file parsed.

- [ ] **Step 4: Exercise CLI/runtime smoke tests**

Run:

```bash
node native-host/bin/agent-cli.js health
node native-host/bin/agent-cli.js tools --json
node native-host/bin/agent-cli.js workspace list
```

Expected: protocol/version/profile/tool output with exit 0.

- [ ] **Step 5: Build and inspect final ZIP**

Run: `npm run package`, then list and integrity-test the ZIP. Confirm no `.env`, API token, runtime log, transaction, snapshot, artifact, `node_modules`, or test temp data is present.

- [ ] **Step 6: Write verification evidence**

Record exact commands, pass/fail counts, ZIP checksum, package inventory summary, and the explicit limitation that a live authenticated ChatGPT Chrome/Edge session cannot be automated inside this Linux build container.

