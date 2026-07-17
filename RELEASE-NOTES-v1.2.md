# Release notes — v1.3.0

Ngày đóng gói: 2026-07-13.

## Nâng cấp v1.3 (bảo mật & nhất quán)

- **Làm rõ mô hình cookie/session**: Đây là tính năng chủ động của extension (tự động chọn model, khôi phục phiên, ghi lại cookie model theo yêu cầu). Tài liệu (README, SECURITY.md) được cập nhật để phản ánh đúng thực tế thay vì tuyên bố "không đọc/lưu cookie". Dữ liệu phiên chỉ lưu cục bộ, không dùng làm credential, không proxy, không xuất thiết bị.
- **Siết chặt redaction**: `credential-store.js` giờ redact theo cả tên key lẫn giá trị (JWT/Bearer/token dài), từ chối lưu và không bao giờ export các auth secret (password, access/refresh token, authorization, bearer, secret).
- **Đồng bộ version**: `manifest.json` và `package.json` đều là `1.3.0`.

## Nâng cấp v1.2 (mini)

Ngày đóng gói: 2026-07-11.

### Orchestrator CLI

Thêm orchestrator CLI để khởi động/dừng tất cả dịch vụ một lần:

**PowerShell scripts:**
```powershell
.\scripts\tiiextension-up.ps1 -Tunnel -Mcp
.\scripts\tiiextension-down.ps1
```

**Node.js CLI:**
```bash
node .\native-host\bin\agent-cli.js up --tunnel --mcp
node .\native-host\bin\agent-cli.js down
node .\native-host\bin\agent-cli.js status
```

#### Tính năng orchestrator

1. **Kiểm tra Node.js** - Yêu cầu Node.js 18+
2. **Kiểm tra config workspace** - Kiểm tra file config tồn tại
3. **Tạo/đọc local API token** - Tự động tạo token tại `native-host/config/secrets/local-api.token`
4. **Start local API** - Khởi động API tại `http://127.0.0.1:18401`
5. **Start MCP bridge** (tùy chọn) - Chạy `mcp-bridge/src/server.js` qua stdio
6. **Start Cloudflare Tunnel** (tùy chọn) - Tunnel URL được in ra nếu có token
7. **Health check** - Kiểm tra API sẵn sàng
8. **Ghi log vào runtime** - Log tại `runtime/orchestrator/`
9. **Lưu trạng thái** - Lưu PID vào `runtime/orchestrator-state.json`
10. **Lệnh down** - Dừng tất cả services, dọn dẹp state

#### Output mẫu

```
[01:24:32] Checking Node.js...
[01:24:32] Node.js 20.12.0 detected.
[01:24:32] Config loaded from ...\native-host\config\default.workspaces.json
[01:24:32] Loaded existing API token
[01:24:32] Starting Tiiextension API on http://127.0.0.1:18401...
[01:24:34] API: running at http://127.0.0.1:18401
[01:24:34] Starting MCP bridge...
[01:24:34] MCP: running over stdio/manual
[01:24:34] Tunnel: skipped, CLOUDFLARE_TUNNEL_TOKEN missing
[01:24:34] Health check passed
[01:24:34] Orchestrator state saved to ...\runtime\orchestrator-state.json
[01:24:34] Tiiextension is UP (PID: 12345)
```

#### CLOUDFLARE_TUNNEL_TOKEN

Orchestrator tìm token tại:
1. Biến môi trường `CLOUDFLARE_TUNNEL_TOKEN`
2. File `Z:\00_SECRET\cloudflare-api-key.txt`
3. File `cloudflare/.env`

#### Files mới

- `scripts/tiiextension-up.ps1` - Orchestrator startup script
- `scripts/tiiextension-down.ps1` - Orchestrator shutdown script  
- `native-host/src/orchestrator.js` - Node.js orchestrator module
- `native-host/config/secrets/.gitignore` - Bảo vệ token không bị commit
- `docs/ORCHESTRATOR.md` - Tài liệu orchestrator