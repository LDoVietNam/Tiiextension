# Tiiextension Flowchart - v2.0.0

## Extension Architecture Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           CHATGPT WEB BROWSER                               │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  ChatGPT Web Tab (chatgpt.com)                                       │    │
│  │  ┌─────────────────────────────────────────────────────────────┐  │    │
│  │  │ Content Script: chatgpt-content.js                           │  │    │
│  │  │ - extractCookieData() - reads document.cookie               │  │    │
│  │  │ - submitRawPrompt() - DOM interaction                       │  │    │
│  │  │ - waitForAssistantResponse() - response detection           │  │    │
│  │  │ - ALLOWED_TOOLS = {fs.list, fs.read, fs.search_text, ...}   │  │    │
│  │  │ - Message listener for ti-web-agent/1 protocol              │  │    │
│  │  └─────────────────────────────────────────────────────────────┘  │    │
│  │                                                                  │    │
│  │  [Message via window.postMessage for tool calls]                 │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└────────────────────────────────────┬────────────────────────────────────────┘
                                    │
                                    │ chrome.runtime.sendMessage (extension messaging)
                                    │
┌────────────────────────────────────▼────────────────────────────────────────┐
│                         BACKGROUND SERVICE WORKER                          │
│  extension/src/background.js                                                    │
│  ┌─────────────────────────────────────────────────────────────────────┐  │
│  │ Message Router (runtime.onMessage.addListener)                      │  │
│  │  - RPC messages: rpc.model.select, rpc.status                        │  │
│  │  - CDP actions: cdp.attach, cdp.send, cdp.screenshot                 │  │
│  │  - Native actions: native.connect, native.status                     │  │
│  │  - Tool calls: fs.list, fs.read, fs.search_text, workspace.list      │  │
│  │  - ChatGPT messages: chatgpt.ask, chatgpt.status                     │  │
│  │  - Session management: session.create, session.claim                 │  │
│  │  - Browser actions: browser.click, browser.type                      │  │
│  └─────────────────────────────────────────────────────────────────────┘  │
│                                                                           │
│  ┌─────────────────────────────────────────────────────────────────────┐  │
│  │ Engines                                                                │  │
│  │  - CDP Engine: chrome.debugger API for DOM/network control          │  │
│  │  - Session Manager: tab leasing, heartbeat, persistence             │  │
│  │  - Event Bus: event-driven architecture                             │  │
│  │  - Model Selector: intelligent model selection                      │  │
│  └─────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────┬────────────────────────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    │               │               │
         ┌──────────▼───┐  ┌────────▼───────┐  ┌──▼─────────────┐
         │  NATIVE HOST │  │   TiRouter     │  │  CONTEXT BRIDGE│
         │  (Native     │  │   (:1870)      │  │   (:3333)      │
         │   Messaging) │  │                │  │                │
         │              │  │  - Auth         │  │  - Filesystem  │
         │  bin/        │  │  - Routing      │  │  - Git         │
         │  agent-cli.js│  │  - Policy       │  │  - Execution   │
         │  server.js    │  │  - Provider     │  │  - Snapshot    │
         │              │  │    Registry     │  │                │
         └──────┬───────┘  └────────┬───────┘  └────────┬───────┘
                │                   │                   │
                │ port: 1840        │ port: 1870        │ port: 3333
                │                   │                   │
                ▼                   ▼                   ▼
    ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
    │   Local Runtime  │ │  CLIProxyAPI     │ │  Context Bridge  │
    │   (Go binary)    │ │  (Go server)     │ │  (Node.js)       │
    │   ti-bridge.exe  │ │  ti-router.exe   │ │  server.js       │
    └──────────────────┘ └──────────────────┘ └──────────────────┘
```

## Execution Mode Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            POPUP UI FLOW                                   │
│                                                                              │
│  User clicks tab → switchMode(mode)                                          │
│                                                                             │
│  ┌──────────┐     ┌──────────┐     ┌──────────┐                             │
│  │   Chat   │     │  Tools   │     │   Token  │                             │
│  │  (ui)    │     │ (api)    │     │ (tokens) │                             │
│  └────┬─────┘     └────┬─────┘     └────┬─────┘                             │
│       │                │                │                                      │
│       ▼                ▼                ▼                                      │
│  section.ui    section.api    section.tokens                                 │
│  .hidden=false .hidden=false  .hidden=false                                  │
│  others hidden others hidden  others hidden                                  │
│                                                                             │
│  [Current: UI mode is active by default]                                     │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                        EXECUTION MODE TOGGLE (IMPLEMENTED)                 │
│                                                                              │
│  Popup UI Sections:                                                           │
│  ┌──────────┐     ┌──────────┐     ┌──────────┐                             │
│  │   Chat   │     │  Tools   │     │   Token  │                             │
│  │  (ui)    │     │ (api)    │     │ (tokens) │                             │
│  └────┬─────┘     └────┬─────┘     └────┬─────┘                             │
│       │                │                │                                      │
│       ▼                ▼                ▼                                      │
│  section.ui    section.api    section.tokens                                 │
│  .hidden=false .hidden=false  .hidden=false                                  │
│  others hidden others hidden  others hidden                                  │
│                                                                              │
│  Execution Mode Section (in popup.html):                                      │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ [x] Bật thực thi tool (execution-enabled)                          │   │
│  │ [x] Tự động inject kết quả (auto-inject-results)                   │   │
│  │ Status: ✅ Bật / ⏸️ Tắt                                              │   │
│  │ Context Bridge: ✅ Online (port 3333) / ⏸️ Offline                   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  Implementation (popup.js):                                                 │
│  - Event listeners for checkboxes added to DOMContentLoaded               │
│  - checkExecutionMode() reads from chrome.storage                           │
│  - saveExecutionMode() persists to chrome.storage                           │
│  - checkContextBridgeStatus() pings port 3333                             │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Tool Call Flow (ChatGPT Web → Local Files)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         TOOL CALL FLOW                                       │
│                                                                              │
│  1. ChatGPT Web Response contains tool call                               │
│     ↓                                                                        │
│  2. chatgpt-content.js message listener                                       │
│     ↓                                                                        │
│  3. Check ALLOWED_TOOLS (whitelist)                                         │
│     ↓                                                                        │
│  4. chrome.runtime.sendMessage({type: tool_name, payload: args})            │
│     ↓                                                                        │
│  5. background.js message router                                              │
│     ↓                                                                        │
│  6. sendNative(tool_name, payload) → Native Host                            │
│     ↓                                                                        │
│  7. Native Host executes tool                                               │
│     ↓                                                                        │
│  8. Result sent back via postMessage                                        │
│     ↓                                                                        │
│  9. Result injected into ChatGPT DOM (if sendResultBack=true)               │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                         LOCAL FILE ACCESS PATHS                             │
│                                                                              │
│  Path A: TiRouter Gateway (:1870)                                           │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Extension → TiRouter Gateway → TiBrain → Context Bridge             │   │
│  │ Benefits: Full OpenAI-compatible API, knowledge integration         │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  Path B: Native Host Direct (:1840)                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Extension → Native Host → Filesystem/Git/Process tools            │   │
│  │ Benefits: Direct local access, CDP control                          │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  Path C: Context Bridge (:3333)                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Extension → Context Bridge Server → Workspace tools                 │   │
│  │ Benefits: Persistent state, audit trail                           │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Required Setup Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         SETUP REQUIREMENTS                                   │
│                                                                              │
│  Step 1: Load Extension (Chrome/Firefox)                                      │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ chrome://extensions → Developer mode → Load unpacked               │   │
│  │ Extension ID: ojjbdgfmnedbnpadfnmgkolfmhipkefi (example)            │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  Step 2: Install Native Host                                                │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ .\scripts\install-native-host.ps1 -Action Install                 │   │
│  │ -ExtensionId <your-extension-id>                                  │   │
│  │ -WorkspaceRoot 'Z:\01_PROJECTS\apps\Tiiextension'                 │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  Step 3: Start Orchestrator                                                 │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ node ./native-host/bin/agent-cli.js up                            │   │
│  │ Options: --mcp (add MCP bridge), --tunnel (CF tunnel)              │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  Step 4: Verify Connection                                                  │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ .\scripts\doctor.ps1 -Browser Both                               │   │
│  │ Check: ports 1840, 1870, 3333, 18402 are listening                  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  Step 5: Open ChatGPT Web                                                   │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Navigate to https://chatgpt.com                                   │   │
│  │ Extension overlay appears in bottom-right corner                    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Data Flow Diagram

```
┌──────────────┐    cookie/model    ┌──────────────┐
│  ChatGPT.com │ ─────────────────▶ │ Content      │
│  Browser Tab │                    │ Script       │
│              │                    │ (chatgpt-    │
│              │ ◀───────────────── │ content.js)  │
│              │    status/response │              │
└──────────────┘                    └──────┬───────┘
                                           │
                                           │ chrome.runtime.sendMessage
                                           ▼
┌──────────────┐                   ┌──────────────┐
│ Native Host  │ ◀─────────────────│ Background   │
│ (:1840)      │  WebSocket/WS     │ Service      │
│              │                   │ Worker       │
│ - Filesystem │                   │ (background  │
│ - Git        │                   │ .js)         │
│ - Process    │                   │              │
│ - Tasks      │                   │ - Router     │
│              │                   │ - Session    │
│              │                   │ - Event Bus  │
└──────────────┘                   └──────┬───────┘
                                         │
                    ┌────────────────────┼────────────────────┐
                    │                    │                    │
                    ▼                    ▼                    ▼
           ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
           │ TiRouter     │    │ Context      │    │ MCP Bridge   │
           │ (:1870)      │    │ Bridge       │    │ (:18402)     │
           │              │    │ (:3333)      │    │              │
           │ - Auth       │    │ - FS tools   │    │ - Protocol   │
           │ - Models     │    │ - Git        │    │   translate  │
           │ - Chat       │    │ - Exec       │    │              │
           └──────────────┘    └──────────────┘    └──────────────┘
```