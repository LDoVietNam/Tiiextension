# Tiiextension v1.3.0

Một gói tự chứa cho Chrome/Edge Chromium trên Windows, kết hợp ChatGPT Web với native runtime giới hạn trong workspace. Bản v1.2 thêm orchestrator CLI để khởi động/dừng toàn bộ hệ thống một lệnh.

Extension có tính năng **đọc phiên ChatGPT đang hoạt động** (cookie cấu hình model `oai-last-model-config`, model đã chọn, và các key localStorage không nhạy cảm) để tự động chọn model, lưu/truy xuất session vào `chrome.storage.local`, và ghi lại cookie model khi người dùng chủ động yêu cầu. Thông tin này **chỉ lưu cục bộ trên máy**, không bao giờ được dùng làm credential cho API/CLI, không proxy và không xuất ra ngoài thiết bị. Browser vẫn tự gửi cookie xác thực cho `chatgpt.com` khi extension tương tác với trang.

## Thành phần chính

- Popup là runtime controller: xem trạng thái native runtime, Start/Stop backend và mở Side Panel.
- Side panel là **Extension Agent Console** cho browser automation, Files, Changes và Activity. Task từ panel được gắn `agent: "extension-browser"`; runtime có thể điều phối phần ngoài browser sang PC Automation Agent theo policy.
- Direct-control overlay trên ChatGPT Web.
- Native Messaging `cnagent/1`, reconnect và handshake kiểm chứng host.
- Durable task/event/call journal, idempotency và cancellation.
- Filesystem workspace guard, read-only roots, transaction, snapshot, rollback, diff/patch, encoding và watch events.
- Project/process supervisor không dùng shell, có allowlist, timeout, output cap và kill-tree trên Windows.
- Module payload chạy trong worker; command payload chạy qua process supervisor.
- Dev cho phép payload unsigned; release bắt buộc SHA-256 + Ed25519 từ trust store.
- Local HTTP API + WebSocket loopback có bearer token; CLI v2 dùng cùng tool contract.
- Cloudflare Tunnel templates trỏ sẵn `127.0.0.1:18401`; bạn bổ sung token sau.
- OpenAPI Custom Action schema cho GPT điều khiển runtime qua tunnel.
- MCP bridge dependency-free cho filesystem/project/process tools.
- Filesystem index/cache: `fs.index.build`, `fs.index.status`, `fs.index.search`, `fs.index.refresh`.
- Audit hash chain, secret redaction, artifact store, deterministic ZIP, checksum và SBOM.

## Cài nhanh trên Windows

Yêu cầu Node.js 18+, Chrome hoặc Edge và PowerShell. Giải nén ZIP vào một thư mục ổn định.

1. Mở `chrome://extensions` hoặc `edge://extensions`, bật Developer mode, chọn **Load unpacked**, rồi chọn thư mục `extension`.
2. Sao chép Extension ID.
3. Chạy một trong các lệnh sau từ thư mục gói:

```powershell
# Chrome + Edge; workspace ghi và thư mục tham chiếu chỉ đọc
.\scripts\install-native-host.ps1 `
  -Action Install `
  -Browser Both `
  -ExtensionId YOUR_32_CHARACTER_EXTENSION_ID `
  -WorkspaceRoot 'Z:\01_PROJECTS\apps\extension@filesystems' `
  -ReadOnlyRoot 'Z:\downloads\EXTEN'

# Xem trước, không thay đổi máy
.\scripts\install-native-host.ps1 -Action Install -Browser Both `
  -ExtensionId YOUR_EXTENSION_ID -WorkspaceRoot 'Z:\01_PROJECTS\apps' -DryRun
```

4. Reload extension, mở `https://chatgpt.com`, đăng nhập nếu cần, rồi mở popup/side panel.
5. Kiểm tra:

```powershell
.\scripts\doctor.ps1 -Browser Both
```

Installer cài per-user vào `%LOCALAPPDATA%\ChatGPTNativeAgent`, tạo launcher/manifest tuyệt đối, đăng ký HKCU, sinh local API token với ACL, giữ config/token khi repair và chạy native self-test. Các thao tác:

```powershell
.\scripts\install-native-host.ps1 -Action Repair -Browser Both -ExtensionId YOUR_EXTENSION_ID
.\scripts\install-native-host.ps1 -Action Doctor -Browser Both
.\scripts\uninstall-native-host.ps1 -Browser Both
.\scripts\uninstall-native-host.ps1 -Browser Both -KeepData
```

## Dùng popup và side panel

- `UI`: nhập yêu cầu tự nhiên. Goal loop gọi ChatGPT Web, đọc block có cấu trúc, thực thi tool hợp lệ rồi gửi kết quả về cuộc trò chuyện cho tới khi hoàn tất hoặc chạm stop condition.
- `API`: vẫn chat như UI, đồng thời hiển thị raw protocol, cho parse/run block và gọi native tool trực tiếp.
- Side panel cho phép chạy/cancel goal, xem cây file, đọc/search, preview thay đổi, transaction/snapshot/rollback, timeline, raw tool và diagnostics.
- Phím `Ctrl+Shift+Y` mở side panel.

Ví dụ goal:

```text
Phân tích project hiện tại, sửa các test đang lỗi trong workspace, chạy test và tóm tắt diff. Không sửa file ngoài workspace.
```

## Structured block `cnagent/1`

Mỗi block có đúng một business key và một `block_id` ổn định:

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

Browser action:

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

Chi tiết contract: [docs/PROTOCOL.md](docs/PROTOCOL.md).

## Filesystem tools

Nhóm inspect/read: `fs.workspace_info`, `fs.roots.list`, `fs.exists`, `fs.stat`, `fs.list`, `fs.tree`, `fs.read`, `fs.read_many`, `fs.read_bytes`, `fs.hash`, `fs.detect_encoding`.

Nhóm search/diff: `fs.search_text`, `fs.search_regex`, `fs.search_glob`, `fs.find_files`, `fs.find_duplicates`, `fs.diff`, `fs.diff_tree`, `fs.preview_write`, `fs.preview_patch`, `fs.patch_check`.

Nhóm mutation/transaction: `fs.mkdir`, `fs.write`, `fs.write_many`, `fs.append`, `fs.patch`, `fs.patch_unified`, `fs.copy`, `fs.move`, `fs.delete`, `fs.transaction.*`, `fs.snapshot`, `fs.snapshots.*`, `fs.rollback`, `fs.change_log`.

Nhóm event: `fs.watch.start`, `fs.watch.stop`, `fs.watch.status`. Watch chỉ là tín hiệu thay đổi; runtime vẫn đọc/hash lại file trước quyết định quan trọng.

Mọi mutation tự tạo transaction nếu không truyền transaction ID. `write_many` và unified patch nhiều file là all-or-nothing; rollback dùng snapshot trước thay đổi.

## CLI

Chạy trực tiếp từ gói hoặc thư mục đã cài:

```powershell
node .\native-host\bin\agent-cli.js health
node .\native-host\bin\agent-cli.js tools
node .\native-host\bin\agent-cli.js workspace list
node .\native-host\bin\agent-cli.js tool fs.tree --args '{"path":".","depth":3}'
node .\native-host\bin\agent-cli.js task run "Index workspace"
node .\native-host\bin\agent-cli.js events --after 0
node .\native-host\bin\agent-cli.js doctor
```

CLI chỉ gọi native runtime; không dùng credentials ChatGPT. Provider-backed chat cần extension kết nối với tab ChatGPT Web.

## Orchestrator CLI

**Tiiextension v1.2+** cung cấp lệnh orchestrator để khởi động/dừng toàn bộ hệ thống một lần:

```powershell
# Khởi động API localhost
node .\native-host\bin\agent-cli.js up

# Khởi động API + MCP bridge
node .\native-host\bin\agent-cli.js up --mcp

# Khởi động API + Cloudflare Tunnel
node .\native-host\bin\agent-cli.js up --tunnel

# Khởi động đầy đủ
node .\native-host\bin\agent-cli.js up --tunnel --mcp

# Kiểm tra trạng thái
node .\native-host\bin\agent-cli.js status

# Dừng toàn bộ
node .\native-host\bin\agent-cli.js down
```

Hoặc dùng PowerShell script trực tiếp:

```powershell
.\scripts\tiiextension-up.ps1 -Mcp
.\scripts\tiiextension-down.ps1
```

Orchestrator sẽ:
1. Kiểm tra Node.js 18+
2. Kiểm tra config workspace
3. Tạo/sử dụng local API token
4. Start local API `127.0.0.1:18401`
5. Start MCP bridge nếu `--mcp`
6. Start Cloudflare Tunnel nếu `--tunnel` và có `CLOUDFLARE_TUNNEL_TOKEN` (đọc từ `Z:\00_SECRET\secrets.env`)
7. In ra trạng thái từng thành phần
8. Ghi log vào `runtime/orchestrator-state.json`

## Local API, GPT Custom Action và Cloudflare Tunnel

Khởi động server loopback riêng:

```powershell
$env:CHATGPT_NATIVE_AGENT_CONFIG="$env:LOCALAPPDATA\ChatGPTNativeAgent\config\runtime.json"
node "$env:LOCALAPPDATA\ChatGPTNativeAgent\native-host\bin\agent-server.js"
```

Đọc token cục bộ và gọi health:

```powershell
$token = (Get-Content "$env:LOCALAPPDATA\ChatGPTNativeAgent\secrets\local-api.token" -Raw).Trim()
Invoke-RestMethod http://127.0.0.1:18401/v1/health -Headers @{ Authorization = "Bearer $token" }
```

Endpoints gồm health, capabilities, tools, workspaces, tasks, tool calls, agent goal, artifacts và `/v1/events` WebSocket có cursor replay. `/v1/chat` trả `PROVIDER_UNAVAILABLE` nếu chưa có extension/provider bridge; không fallback sang proxy session.

Endpoint goal mới:

```powershell
Invoke-RestMethod http://127.0.0.1:18401/v1/agent/goal `
  -Method POST `
  -Headers @{ Authorization = "Bearer $token" } `
  -ContentType application/json `
  -Body '{"goal":"index workspace and summarize","workspace_id":"package-root","mode":"plan_then_execute"}'
```

### Sub2API model gateway

Tiiextension có thể dùng một instance Sub2API self-hosted làm model gateway cho
native runtime. Đây là đường model độc lập với filesystem/CLI:

```text
GPT Web → Tiiextension extension → Native Messaging → filesystem / CLI
Native runtime → Sub2API → model upstream
```

Sao chép `native-host/config/runtime/sub2api.env.example` vào secret store hoặc
user environment của native runtime, rồi đặt `SUB2API_BASE_URL`,
`SUB2API_API_KEY` và `SUB2API_MODEL`. URL phải là HTTPS. Key chỉ được đọc tại
native runtime; không đặt key trong `chrome.storage`, browser content script,
prompt GPT, task payload, hay file cấu hình commit vào Git.

Sau khi runtime đang chạy, thử qua local API:

```powershell
Invoke-RestMethod http://127.0.0.1:18401/v1/chat/completions `
  -Method POST `
  -Headers @{ Authorization = "Bearer $token" } `
  -ContentType "application/json" `
  -Body '{"provider":"sub2api","model":"sub2api/auto","messages":[{"role":"user","content":"Reply with sub2api-ok"}]}'
```

`POST /v1/agent/model` dành cho agent runtime. Nó nhận cùng `messages`, hỗ trợ
`stream: true`, `max_retries` (0–3) và `fallback_providers`. Khi streaming,
response là SSE với `delta`, `done` hoặc `error`; router chỉ retry/fallback
trước khi phát delta đầu tiên để không trộn hai câu trả lời. Ví dụ:

```powershell
curl.exe -N http://127.0.0.1:18401/v1/agent/model `
  -H "Authorization: Bearer $token" `
  -H "Content-Type: application/json" `
  -d '{"provider":"sub2api","messages":[{"role":"user","content":"stream a short answer"}],"stream":true,"max_retries":1,"fallback_providers":["freetheai"]}'
```

Các block `cnagent/1` từ ChatGPT được deduplicate theo `block_id`. Read-only
block chạy khi `executionEnabled` bật; block ghi/process/git chỉ chạy khi
`autoApproveMutations` được bật rõ ràng trong extension storage, mặc định là
`false`. Kết quả thực thi được gửi về đúng tab ChatGPT đã phát block.

Khởi động API và tunnel:

```powershell
.\scripts\start-api.ps1
Copy-Item .\cloudflare\.env.example .\cloudflare\.env
# thêm CLOUDFLARE_TUNNEL_TOKEN nếu dùng named tunnel
.\scripts\start-tunnel.ps1
```

Sau đó thay URL trong [openapi/chatgpt-action.yaml](openapi/chatgpt-action.yaml) bằng URL tunnel và dùng làm GPT Custom Action. Xem [docs/GPT-CUSTOM-ACTION.md](docs/GPT-CUSTOM-ACTION.md) và [docs/CLOUDFLARE-TUNNEL.md](docs/CLOUDFLARE-TUNNEL.md).

## MCP bridge

MCP bridge cho phép MCP client/router gọi filesystem runtime:

```powershell
$env:TIIEXTENSION_API_URL="http://127.0.0.1:18401"
$env:TIIEXTENSION_API_TOKEN=$token
node .\mcp-bridge\src\server.js
```

Xem [docs/MCP-BRIDGE.md](docs/MCP-BRIDGE.md).

## Payload

```powershell
node .\native-host\bin\agent-cli.js tool payload.load --args '{"path":"payloads/examples/hello/manifest.json"}'
node .\native-host\bin\agent-cli.js tool payload.call --args '{"name":"hello.payload","method":"run","args":{"name":"Codex"}}'
```

Xem format, chữ ký và trust modes tại [docs/PAYLOADS.md](docs/PAYLOADS.md).

## Phát triển và đóng gói

```bash
npm test
npm run check
npm run static-check
npm run package
```

`npm run package` tạo ZIP deterministic, `*.sha256`, `RELEASE-MANIFEST.json` và `SBOM.json`; secrets, runtime state, audit logs và ZIP cũ bị loại.

## Giới hạn đã biết

- Adapter ChatGPT Web phụ thuộc DOM/accessibility của giao diện hiện tại; khi UI thay đổi, nó fail rõ ràng thay vì đọc token.
- Test trong gói kiểm tra logic/contract ở Linux; smoke test Chrome/Edge authenticated và registry phải chạy trên Windows đích.
- Worker payload là ranh giới lỗi/tài nguyên trong Node, không phải OS sandbox cho mã không tin cậy. Release chỉ nên tin publisher kiểm soát được.
- Extension unpacked là build phát triển. Phân phối release cần ký/phát hành qua kênh Chrome/Edge phù hợp và nên code-sign installer/scripts.

Xem [SECURITY.md](SECURITY.md), [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) và [docs/VERIFICATION.md](docs/VERIFICATION.md).
