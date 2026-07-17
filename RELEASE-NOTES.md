# Release notes — v1.1.0

Ngày đóng gói: 2026-07-11.

## Nâng cấp v1.1

- Đổi tên release/package sang `Tiiextension`.
- ZIP mới: `Tiiextension-v1.1.0.zip`, root bên trong ZIP là `Tiiextension/`.
- Thêm `POST /v1/agent/goal` để GPT/Custom Action enqueue goal trực tiếp.
- Thêm Cloudflare Tunnel templates và scripts `start-api.ps1`, `start-tunnel.ps1`, `doctor-tunnel.ps1`.
- Thêm OpenAPI 3.1 spec `openapi/chatgpt-action.yaml` cho GPT Custom Actions.
- Thêm MCP filesystem bridge dependency-free trong `mcp-bridge/`.
- Thêm filesystem index/cache tools: `fs.index.build`, `fs.index.status`, `fs.index.search`, `fs.index.refresh`.

## Nội dung

- Protocol `cnagent/1`, JSON Schemas, handshake version/capabilities và structured error.
- Native-first durable task runtime với state machine, event cursor, call journal, cancellation và crash recovery hooks.
- Filesystem engine tập trung workspace: transaction, atomic multi-write, strict unified diff nhiều file/hunk, snapshots, rollback, encoding/BOM/EOL, binary handling, search/hash/duplicates và coalesced watchers.
- Project/process tools có allowlist, no-shell, environment minimization, timeout, output cap và cancel.
- Dev/release payload runtime cho module Worker và command payload; release xác minh SHA-256 + Ed25519.
- ChatGPT Web provider coordinator, per-tab queue, login/challenge/rate-limit detection và visible model discovery; không tiếp cận cookie/session.
- Browser tools cho tabs/navigation/locator/DOM/screenshot/console/network/download và safe CDP allowlist.
- Popup UI/API, side panel bốn tab và ChatGPT direct-control overlay.
- Native HTTP/WebSocket API loopback, bearer/Origin protection, artifacts và CLI v2.
- Installer/repair/doctor/uninstall Windows, deterministic release ZIP, checksum, manifest, SBOM, audit hash chain và tài liệu vận hành.

## Compatibility

- Chrome và Microsoft Edge Chromium trên Windows.
- Node.js 18 trở lên.
- Native host chính: `com.chatgpt_native_agent.host`.
- Compatibility host chỉ được dùng sau handshake `cnagent/1` thành công.

## Known limitations

- Chưa có bằng chứng live E2E authenticated ChatGPT trên Windows trong môi trường đóng gói Linux; phải chạy doctor và smoke test trên máy đích.
- DOM ChatGPT Web có thể đổi; adapter dùng selector fallbacks và fail rõ ràng khi không chắc chắn.
- Local `/v1/chat` cần provider bridge đang kết nối; server native độc lập trả `PROVIDER_UNAVAILABLE` thay vì dùng cookie/token.
- Worker payload không phải OS sandbox; release phải giới hạn trust publishers và profile capabilities.
- Source ZIP không phải store-signed extension hay code-signed Windows installer. Tổ chức phải ký bằng pipeline/key riêng.

## Upgrade từ v0.2.0

Installer giữ config/token khi `Repair`. Config legacy được normalizer chuyển sang effective `cnagent-config/2`; nên lưu bản backup rồi đối chiếu roots, read-only flags, process allowlist, payload roots và release mode. Structured blocks cũ được adapter chuẩn hóa, nhưng block mới nên luôn có `protocol`, `task_id`, `block_id` và đúng một business key.
