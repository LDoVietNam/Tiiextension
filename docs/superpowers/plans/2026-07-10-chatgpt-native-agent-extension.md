# ChatGPT Native Agent Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a complete MV3 extension plus Windows native host that turns ChatGPT Web into an autonomous browser/native workspace agent.

**Architecture:** Native-first runtime. The extension owns browser automation, ChatGPT adapter, side panel UI, and native messaging. The native host owns task queue, logs, workspace guard, filesystems, payload loader, and command execution.

**Tech Stack:** JavaScript ES modules, Chrome/Edge MV3, Node.js native messaging host, PowerShell installer scripts, Node built-in test runner.

## Global Constraints

- Windows target for native messaging scripts.
- Chrome and Edge Chromium target for extension install.
- No per-action runtime permission prompts.
- Filesystem and process operations must stay inside configured workspace folders.
- Dev payload mode skips signature enforcement.
- Release payload mode requires manifest checksum/signature metadata.
- No external npm dependencies.

---

### Task 1: Extension Shell

**Files:**
- Create: `extension/manifest.json`
- Create: `extension/src/background.js`
- Create: `extension/src/native-client.js`
- Create: `extension/src/provider-registry.js`
- Create: `extension/src/block-parser.js`

**Interfaces:**
- Produces: `parseStructuredBlocks(text): Array<object>`
- Produces: `sendNative(type, payload): Promise<object>`
- Produces: background message handlers for side panel and content scripts

- [x] Create MV3 manifest with side panel, native messaging, tabs, scripting, storage, debugger, and broad host permissions.
- [x] Create native messaging client with request/response IDs.
- [x] Create structured block parser.
- [x] Create provider registry.
- [x] Create background router.

### Task 2: Browser and ChatGPT Adapter

**Files:**
- Create: `extension/src/browser-agent.js`
- Create: `extension/src/chatgpt-content.js`
- Create: `extension/src/sidepanel.html`
- Create: `extension/src/sidepanel.js`
- Create: `extension/src/sidepanel.css`

**Interfaces:**
- Consumes: `parseStructuredBlocks(text)`
- Produces: browser actions `open_tab`, `extract_text`, `click`, `type`, `scroll`
- Produces: side panel task submit/log UI

- [x] Implement browser automation actions.
- [x] Implement ChatGPT content script block extraction and prompt insertion helpers.
- [x] Implement side panel UI for goals, workspaces, native calls, and logs.

### Task 3: Native Host Runtime

**Files:**
- Create: `native-host/package.json`
- Create: `native-host/bin/chatgpt-native-agent-host.js`
- Create: `native-host/src/runtime.js`
- Create: `native-host/src/workspace-guard.js`
- Create: `native-host/src/filesystems.js`
- Create: `native-host/src/payload-loader.js`
- Create: `native-host/src/process-tools.js`
- Create: `native-host/config/default.workspaces.json`

**Interfaces:**
- Produces: native protocol `{ id, type, payload } -> { id, ok, result|error }`
- Produces: `createRuntime(options).handle(message)`

- [x] Implement length-prefixed native messaging.
- [x] Implement runtime dispatcher and logs.
- [x] Implement workspace guard.
- [x] Implement filesystem tools.
- [x] Implement hot payload loader and process runner.

### Task 4: Install Scripts, Schemas, Tests, Package

**Files:**
- Create: `scripts/install-native-host.ps1`
- Create: `scripts/uninstall-native-host.ps1`
- Create: `schemas/structured-blocks.schema.json`
- Create: `payloads/examples/hello/manifest.json`
- Create: `payloads/examples/hello/index.js`
- Create: `tests/block-parser.test.mjs`
- Create: `tests/native-runtime.test.mjs`
- Create: `README.md`
- Create: `package.json`

**Interfaces:**
- Consumes: runtime and parser modules.
- Produces: distributable zip.

- [x] Add Windows installer scripts.
- [x] Add schema and payload example.
- [x] Add Node tests.
- [x] Add README.
- [x] Run tests.
- [x] Create zip package.

