# AGENTS.MD — Tiiextension v2.0.0

> **Phiên bản:** 2.0.0-TiEcosystem | **Cập nhật:** 2026-07-16 | **Công nghệ:** JavaScript/Node.js | **Cổng chính:** `1870` (TiRouter)
>
> **Local Tools:** 35 tools (Context Bridge) + 66 tools (Native Host)

---

## 1. Tổng quan & Vai trò

Tiiextension là **Browser Adapter** cho Ti Ecosystem. Extension mỏng, chủ yếu làm browser runtime và transport.

```
ChatGPT Web / Claude Web / Gemini Web
                  │
            Tiiextension (Browser Adapter)
                  │
                  ▼
              TiRouter (Gateway + Policy + Registry)
          │               │
          ▼               ▼
       TiBrain       Context Bridge
 Knowledge/Memory    Files/Git/Exec
          │               │
          └───────┬───────┘
                  ▼
        Z:\01_PROJECTS\apps
```

### Phân vai trách nhiệm

| Thành phần | Trách nhiệm |
|--------------|-------------|
| **Tiiextension** | Kết nối AI web, session bridge, hiển thị trạng thái |
| **TiRouter** | Authentication, routing, policy, provider registry |
| **TiBrain** | RAG, project memory, prompt/skill selection |
| **Context Bridge** | Đọc code, search symbol, patch, git, build, test |

---

## 2. Kiến trúc & Thành phần

### 2.1 Kiến trúc tổng thể (v2.0)

```
┌─────────────────────────────────────────────────────┐
│                    ChatGPT Web                       │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│             Tiiextension (Browser Adapter)          │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────┐  │
│  │  Popup UI   │  │  Side Panel  │  │  Overlay   │  │
│  │  (UI/API)   │  │Agent|Files|..│  │ (ChatGPT)  │  │
│  └──────┬──────┘  └──────┬───────┘  └─────┬──────┘  │
│         │                │                │         │
│  ┌──────┴──────────────────────────────────────┴───┐  │
│  │              Background Script                 │  │
│  │  • Message Router    • Session Manager          │  │
│  │  • TiRouter Client   • Tool Router              │  │
│  │  • Workspace Registry • Event Bus              │  │
│  └─────────────────────────────────────────────────┘  │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│               TiRouter Gateway (:1870)              │
│  • Authentication  • Policy  • Provider Registry    │
└──────────────────────┬──────────────────────────────┘
                       │
          ┌────────────┴────────────┐
          ▼                         ▼
┌───────────────────┐   ┌───────────────────────┐
│   TiBrain (:1810) │   │ Context Bridge (:3333)│
│ RAG, Memory,      │   │ Filesystem, Git,      │
│ Planning          │   │ Exec, Snapshot        │
└───────────────────┘   └───────────────────────┘
          │                         │
          └────────────┬────────────┘
                       ▼
              Z:\01_PROJECTS\apps
```

### 2.2 Core components (v2.0)

| Component | Path | Chức năng |
|---|---|---|
| **Extension Core** | `extension/src/` | Chrome MV3 extension |
| **Background** | `background.js` | Message router, TiRouter client, tool router |
| **Popup** | `popup.js/html/css` | UI/API dual-mode popup |
| **Side Panel** | `sidepanel.js/html/css` | Agent, Files, Changes, Activity tabs |
| **Content Script** | `chatgpt-content.js` | ChatGPT DOM interaction |
| **TiRouter Client** | `ti-router-client.js` | Giao tiếp với TiRouter |
| **Tool Router** | `tool-router.js` | Route tool calls đến Context Bridge |
| **Workspace Registry** | `workspace-registry.js` | Quản lý workspace và service |
| **Context Bridge Server** | `context-bridge/server.js` | Server riêng cho code access |
| **Native Host** | `native-host/` | Legacy support, fallback |

---

## 2. Kiến trúc & Thành phần

### 2.1 Kiến trúc tổng thể

```
┌─────────────────────────────────────────────────────┐
│                    Extension                         │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────┐  │
│  │  Popup UI   │  │  Side Panel  │  │  Overlay   │  │
│  │  (UI/API)   │  │Agent|Files|..│  │ (ChatGPT)  │  │
│  └──────┬──────┘  └──────┬───────┘  └─────┬──────┘  │
│         │                │                │         │
│  ┌──────┴────────────────┴────────────────┴──────┐  │
│  │             Background Script                  │  │
│  │  • Message Router     • CDP Engine            │  │
│  │  • Session Manager    • Event Bus             │  │
│  │  • Native Client      • Model Selector        │  │
│  │  • Provider Registry  • Heartbeat            │  │
│  └───────────────────────┬───────────────────────┘  │
│                          │                          │
├──────────────────────────┼──────────────────────────┤
│  Native Messaging        │                          │
│  ┌───────────────────────┴───────────────────────┐  │
│  │              Native Host (Node.js)              │  │
│  │  ┌──────────┐ ┌──────────┐ ┌───────────────┐  │  │
│  │  │FS Engine │ │Process   │ │Payload Runtime│  │  │
│  │  │(workspace│ │Supervisor│ │(module+cmd)   │  │  │
│  │  │ guard)   │ │(allowlist)│ │              │  │  │
│  │  └──────────┘ └──────────┘ └───────────────┘  │  │
│  │  ┌──────────┐ ┌──────────┐ ┌───────────────┐  │  │
│  │  │Task      │ │Local API │ │Audit Hash     │  │  │
│  │  │Runtime   │ │:18401    │ │Chain + SBOM   │  │  │
│  │  └──────────┘ └──────────┘ └───────────────┘  │  │
│  └────────────────────────────────────────────────┘  │
│                          │                           │
│   ┌──────────────────────┴──────────────────────┐   │
│   │         MCP Bridge (:18402)                  │   │
│   │         Cloudflare Tunnel                    │   │
│   └─────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

### 2.2 Core components

| Component | Path | Chức năng |
|---|---|---|
| **Extension Core** | `extension/src/` | Chrome MV3 extension (27+ JS modules) |
| **Background** | `background.js` | Message router, RPC, CDP, session, heartbeat |
| **Popup** | `popup.js/html/css` | UI/API dual-mode popup |
| **Side Panel** | `sidepanel.js/html/css` | Agent, Files, Changes, Activity tabs |
| **Content Script** | `chatgpt-content.js` | ChatGPT Web adapter + overlay |
| **CDP Engine** | `cdp-engine.js` | Chrome DevTools Protocol (debugger API) |
| **Session Manager** | `session-manager.js` | Tab session lease, handoff, persistence |
| **Event Bus** | `event-bus.js` | Inter-component messaging |
| **Native Client** | `native-client.js` | Native messaging host communication |
| **Provider Registry** | `provider-registry.js` | Provider registration (chatgpt-web, etc.) |
| **Provider Gateway** | `provider-gateway.js` | Model fetch, fallback chains |
| **Model Selector** | `model-selector.js` | Intelligent model selection |
| **Freebuff Content** | `freebuff-content.js` | Freebuff session token extraction |
| **Block Parser** | `block-parser.js` | Structured block parsing (`cnagent/1`) |
| **ChatGPT Content** | `chatgpt-content.js` | ChatGPT DOM interaction, model detection |
| **Native Host** | `native-host/` | Node.js runtime (~18.8MB source) |
| **CLI v2** | `native-host/bin/agent-cli.js` | CLI: health, tools, workspace, task, doctor |
| **API Server** | `native-host/src/server/` | REST + WebSocket (:18401) |
| **FS Engine** | `native-host/src/fs/` | Workspace-guarded filesystem |
| **Process Supervisor** | `native-host/src/process/` | Allowlist, timeout, output cap |
| **Task Runtime** | `native-host/src/task/` | State machine, event cursor, call journal |
| **Payload Runtime** | `native-host/src/payload/` | Module Worker + command payload |
| **MCP Bridge** | `mcp-bridge/` | Dependency-free MCP filesystem bridge |
| **Go Runtime (1MCP)** | `runtime-go/` | Go backend cho 1MCP dashboard (:1840) |
| **Git Tools** | `native-host/src/git-tools.js` | Git operations (status, diff, log, branches, commit, restore) |
| **Verification Tools** | `native-host/src/verification-tools.js` | Workspace verification, secret scanning, lint/typecheck plans |
| **Provider Routing Tools** | `native-host/src/provider-routing-tools.js` | Model/provider routing, metrics, circuit breaker |
| **Runtime Management Tools** | `native-host/src/runtime-management-tools.js` | Diagnostics, capabilities, task management, audit |
| **Cloudflare** | `cloudflare/` | Tunnel templates + scripts |

### 2.3 Protocols

Tiiextension sử dụng **hai protocol** cho các mục đích khác nhau:

**`cnagent/1`** — Native host communication (filesystem, process, task runtime):
```json
{
  "protocol": "cnagent/1",
  "task_id": "task_123",
  "block_id": "call_readme",
  "tool_call": {
    "call_id": "call_123",
    "tool": "fs.read",
    "args": { "path": "README.md" },
    "idempotency_key": "task_123:call_readme"
  }
}
```

**`ti-web-agent/1`** — ChatGPT Web Agent loop (tool calls trong ChatGPT response):
```json
{
  "protocol": "ti-web-agent/1",
  "type": "tool_call",
  "id": "call-123",
  "tool": "fs.list",
  "arguments": { "path": "src" }
}
```

Browser action (`cnagent/1`):
```json
{
  "protocol": "cnagent/1",
  "task_id": "task_123",
  "block_id": "open_docs",
  "agent_action": {
    "action": "browser.tabs.create",
    "args": { "url": "https://example.com" }
  }
}
```

---

## 3. Cấu hình

### 3.1 Environment Variables

| Variable | Mô tả |
|---|---|
| `CHATGPT_NATIVE_AGENT_CONFIG` | Path to runtime.json config |
| `TIIEXTENSION_API_URL` | API URL (default: http://127.0.0.1:18401) |
| `TIIEXTENSION_API_TOKEN` | API bearer token |
| `CLOUDFLARE_TUNNEL_TOKEN` | Cloudflare tunnel token |

### 3.2 Config files

| File | Mô tả |
|---|---|
| `native-host/config/runtime.json` | Runtime config (workspace roots, allowlist) |
| `runtime-go/data/api-key.txt` | API key for local server |
| `secrets/local-api.token` | Local API bearer token |
| `cloudflare/.env` | Cloudflare tunnel config |

### 3.3 Extension manifest

| Field | Giá trị |
|---|---|
| **Name** | Tiiextension |
| **ID** | `ojjbdgfmnedbnpadfnmgkolfmhipkefi` |
| **Manifest** | MV3 |
| **Permissions** | nativeMessaging, storage, sidePanel, tabs, scripting, debugger, downloads, activeTab, host permissions |
| **Native Host** | `com.chatgpt_native_agent.host` |

---

## 4. Build, Run & Development

### 4.1 Cài đặt

```powershell
# 1. Load extension unpacked
# Mở chrome://extensions → Developer mode → Load unpacked → chọn extension/

# 2. Lấy Extension ID (32 ký tự)
# 3. Cài native host
.\scripts\install-native-host.ps1 `
  -Action Install `
  -Browser Both `
  -ExtensionId YOUR_32_CHAR_ID `
  -WorkspaceRoot 'Z:\01_PROJECTS\apps\extension@filesystems' `
  -ReadOnlyRoot 'Z:\downloads'

# 4. Kiểm tra
.\scripts\doctor.ps1 -Browser Both
```

### 4.2 Orchestrator

```powershell
# Khởi động
node .\native-host\bin\agent-cli.js up                  # API localhost
node .\native-host\bin\agent-cli.js up --mcp             # + MCP bridge
node .\native-host\bin\agent-cli.js up --tunnel          # + Cloudflare Tunnel
node .\native-host\bin\agent-cli.js up --tunnel --mcp    # All

# Kiểm tra / Dừng
node .\native-host\bin\agent-cli.js status
node .\native-host\bin\agent-cli.js down
```

### 4.3 CLI Commands

```powershell
node .\native-host\bin\agent-cli.js health
node .\native-host\bin\agent-cli.js tools
node .\native-host\bin\agent-cli.js workspace list
node .\native-host\bin\agent-cli.js tool fs.tree --args '{"path":".","depth":3}'
node .\native-host\bin\agent-cli.js task run "Index workspace"
node .\native-host\bin\agent-cli.js events --after 0
node .\native-host\bin\agent-cli.js doctor
```

### 4.4 Scripts

| Script | Chức năng |
|---|---|
| `scripts/install-native-host.ps1` | Install/Repair/Doctor native host |
| `scripts/uninstall-native-host.ps1` | Uninstall (with --KeepData) |
| `scripts/tiiextension-up.ps1` | Start orchestrator (API + optional MCP/Tunnel) |
| `scripts/tiiextension-down.ps1` | Stop orchestrator |
| `scripts/start-api.ps1` | Start local API server |
| `scripts/start-tunnel.ps1` | Start Cloudflare tunnel |
| `scripts/doctor.ps1` | Diagnostic check |
| `scripts/doctor-tunnel.ps1` | Tunnel diagnostic |
| `scripts/check-syntax.mjs` | Syntax check |
| `scripts/package-release.mjs` | Build deterministic release ZIP |
| `scripts/static-ui-check.mjs` | Static UI check |
| `scripts/zip-writer.mjs` | ZIP writer utility |

### 4.5 Build & Package

```bash
npm test                          # Run tests
npm run check                     # Syntax check
npm run static-check              # Static UI check
npm run package                   # Build release ZIP
npm run package:firefox           # Firefox release
npm run package:dry-run           # Dry run packaging
```

### 4.6 Agent Workflow

```
1. Đọc docs    → AGENTS.MD, README.md, docs/PROTOCOL.md, SECURITY.md
2. Cài đặt     → Load extension unpacked + install-native-host.ps1
3. Start       → tiiextension-up.ps1 [--mcp] [--tunnel]
4. Test        → npm test, doctor.ps1, agent-cli.js doctor
5. Phát triển  → Sửa extension/src/ hoặc native-host/src/
6. Package     → npm run package
7. Ghi handoff → handoff.json
```

### 4.7 Code Rules

| Rule | Mô tả |
|---|---|
| **Protocol** | Luôn dùng `cnagent/1` với đầy đủ `protocol`, `task_id`, `block_id` |
| **Idempotency** | Mọi tool call cần `idempotency_key: "task_id:block_id"` |
| **Workspace** | Mọi đường dẫn native phải trong active workspace root |
| **Security** | Không đọc/set cookie auth ChatGPT; chỉ đọc model config |
| **Audit** | Audit JSONL hash chain — không ghi secret vào log |
| **Payload** | Dev cho unsigned; Release bắt buộc SHA-256 + Ed25519 |
| **Process** | Không shell; allowlist; timeout; output cap |
| **Handoff** | Ghi vào `Z:\02_CORE\_cli\.config\handoff.json` |

---

## 5. API Endpoints

### 5.1 TiRouter Gateway (:1870)

| Method | Path | Mô tả |
|---|---|---|
| GET | `/health` | Health check |
| GET | `/v1/models` | Model list |
| POST | `/v1/chat/completions` | Chat completion |
| GET | `/v1/capabilities` | Capability list |
| GET | `/v1/tools` | Tool list |
| POST | `/v1/tools/:name/call` | Call tool |
| POST | `/v1/agent/goal` | Enqueue agent goal |
| GET | `/v1/runtime/status` | Runtime status |
| POST | `/v1/context/query` | Query knowledge (qua TiBrain) |
| GET | `/v1/events` | WebSocket event stream |

### 5.2 Context Bridge (:3333)

| Method | Path | Mô tả |
|---|---|---|
| GET | `/health` | Health check |
| GET | `/v1/workspaces` | Workspace list |
| GET | `/v1/tools` | Tool list |
| POST | `/v1/tools/:name` | Call tool |

### 5.3 Context Tools (35 tools)

| Nhóm | Tools |
|---|---|
| **Workspace** | `workspace.list`, `workspace.status`, `repo.overview` |
| **Read** | `fs.read`, `fs.list`, `fs.search_text`, `code.search`, `code.symbols` |
| **Git** | `git.status`, `git.diff`, `git.log`, `git.branches` |
| **Snapshot** | `snapshot.create`, `snapshot.restore`, `snapshot.list` |
| **Execution** | `command.run`, `test.run`, `lint.run`, `build.run` |

---

## 6. Cấu trúc dự án (v2.0)

### 6.1 File tree

```
Tiiextension/
├── extension/                            # Chrome MV3 Extension
│   ├── manifest.json                     # MV3 manifest (Chrome)
│   ├── manifest.firefox.json             # Firefox manifest
│   ├── popup.html                        # Popup UI
│   ├── platforms/                        # Platform adapters (chatgpt, etc.)
│   │   └── chatgpt/
│   │       ├── chatgpt-detector.js
│   │       ├── chatgpt-composer.js
│   │       ├── chatgpt-response-observer.js
│   │       ├── chatgpt-tool-call-parser.js
│   │       ├── chatgpt-result-injector.js
│   │       └── chatgpt-web-provider.js
│   ├── plugins/                          # Plugins
│   ├── config/                           # Configuration
│   │   └── workspaces.json               # Workspace registry
│   └── src/                              # Core source
│       ├── background.js                 # Message router, CDP
│       ├── popup.js / popup.css          # Popup UI logic
│       ├── sidepanel.js / .html / .css   # Side panel
│       ├── chatgpt-content.js            # ChatGPT content script
│       ├── ti-router-client.js           # TiRouter client
│       ├── tool-router.js                # Tool routing
│       ├── workspace-registry.js         # Workspace management
│       ├── block-parser.js               # cnagent/1 block parser
│       ├── session-manager.js            # Tab session management
│       ├── event-bus.js                  # Inter-component messaging
│       └── context-bridge/               # Context Bridge client
│           └── server.js                 # Context Bridge server
│
├── native-host/                          # Native runtime (legacy/fallback)
│   ├── package.json                      # Dependencies
│   ├── bin/
│   │   └── agent-cli.js                  # CLI v2 orchestrator
│   └── src/
│       └── ...                           # Existing tools
│
├── mcp-bridge/                           # MCP Bridge
├── cloudflare/                           # Cloudflare Tunnel
├── payloads/                             # Payload examples
├── docs/                                 # Documentation
├── scripts/                              # PowerShell + Node.js scripts
├── tests/                                # Tests
└── package.json                          # v2.0.0
```

### 6.2 Port mapping (v2.0)

| Port | Service | Mô tả |
|---|---|---|
| `1870` | TiRouter Gateway | Authentication, routing, policy |
| `1810` | TiBrain | Knowledge, memory, planning |
| `3333` | Context Bridge | Filesystem, git, execution |
| `18402` | MCP Bridge | MCP protocol bridge |
| `1840` | 1MCP Dashboard | Go runtime dashboard |

---

## 7. Operations

### 7.1 Troubleshooting

| Vấn đề | Giải pháp |
|---|---|
| **Extension không load** | Check Developer mode; reload unpacked |
| **TiRouter không kết nối** | Chạy `scripts/doctor.ps1`; kiểm tra port 1870 |
| **Context Bridge không khởi động** | Kiểm tra port 3333; chạy `context-bridge/server.js` |
| **ChatGPT không phản hồi** | Reload ChatGPT tab; kiểm tra workspace config |
| **Permission denied** | Kiểm tra `workspaces.json`; kiểm tra workspace permissions |
| **Revision mismatch** | Refresh workspace context; kiểm tra git status |

---

## 8. Phụ lục

### 8.1 Documents

| Document | Nội dung |
|---|---|
| `PROTOCOL.md` | `cnagent/1` protocol specification |
| `MCP-BRIDGE.md` | MCP bridge setup and usage |
| `CLOUDFLARE-TUNNEL.md` | Cloudflare tunnel configuration |
| `GPT-CUSTOM-ACTION.md` | GPT Custom Action integration |
| `PAYLOADS.md` | Module/command payload format |
| `ORCHESTRATOR.md` | Orchestrator CLI reference |
| `TROUBLESHOOTING.md` | Common issues and fixes |
| `VERIFICATION.md` | Verification guide |
| `SECURITY.md` | Security model and threats |
| `CURRENT-STATE.md` | Current development state analysis |
| `WALKTHROUGH.md` | Architecture and data flow |
| `FEATURE-MATRIX.md` | Capability comparison |
| `IMPLEMENTATION-PLAN.md` | Implementation roadmap |
| `TEST-REPORT.md` | Test results and coverage |
| `RELEASE-NOTES.md` | Release changelog |

### 8.2 Release Package

```powershell
# Build deterministic release
npm run package

# Output:
#   Tiiextension-v1.3.0.zip
#   Tiiextension-v1.3.0.zip.sha256
#   RELEASE-MANIFEST.json
#   SBOM.json
```

### 8.3 Handoff & Error Logging

```json
// Z:\02_CORE\_cli\.config\handoff.json (JSON Lines)
{"agent":"tiiextension","action":"up","timestamp":"ISO_UTC","details":{"port":18401,"mcp":true,"tunnel":false}}

// runtime/orchestrator-state.json (orchestrator state)
```

---

*Kế thừa policy từ `Z:\AGENTS.md`, `Z:\01_PROJECTS\AGENTS.md`, `Z:\01_PROJECTS\apps\AGENTS.md`.*
*Nếu có mơ hồ, dừng lại và hỏi người dùng trước khi thay đổi kiến trúc.*
