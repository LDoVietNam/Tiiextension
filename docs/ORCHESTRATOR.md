# Tiiextension Orchestrator

Orchestrator CLI để quản lý tất cả services trong một lệnh duy nhất.

## Usage

### PowerShell Scripts

```powershell
# Start all services (API only)
.\scripts\tiiextension-up.ps1

# Start with MCP bridge
.\scripts\tiiextension-up.ps1 -Mcp

# Start with Cloudflare Tunnel
.\scripts\tiiextension-up.ps1 -Tunnel

# Start with both MCP and Tunnel
.\scripts\tiiextension-up.ps1 -Mcp -Tunnel

# Stop all services
.\scripts\tiiextension-down.ps1
```

### Node.js CLI

```bash
# Start API only
node native-host/bin/agent-cli.js up

# Start with MCP bridge
node native-host/bin/agent-cli.js up --mcp

# Start with Cloudflare Tunnel
node native-host/bin/agent-cli.js up --tunnel

# Start with both
node native-host/bin/agent-cli.js up --tunnel --mcp

# Stop all services
node native-host/bin/agent-cli.js down

# Check status
node native-host/bin/agent-cli.js status
```

### npm Scripts

```bash
npm run up          # Start API only
npm run up:tunnel   # Start with tunnel
npm run up:mcp      # Start with MCP
npm run up:all      # Start with both
npm run down        # Stop all
npm run status      # Check status
```

## What It Does

1. **Check Node.js** - Yêu cầu Node.js 18+
2. **Check config workspace** - Xác thực `native-host/config/default.workspaces.json`
3. **Create/read local API token** - Tự động tạo token tại `native-host/config/secrets/local-api.token`
4. **Start local API** - Chạy `agent-server.js` trên port 18401
5. **Start MCP bridge** - Nếu có flag `--mcp`
6. **Start Cloudflare Tunnel** - Nếu có flag `--tunnel` và tìm thấy `CLOUDFLARE_TUNNEL_TOKEN` ở:
   - `Z:\00_SECRET\cloudflare-api-key.txt`
   - `cloudflare/.env`
7. **In ra tunnel URL** - Khi tunnel khởi động thành công
8. **Chạy health check** - Kiểm tra API đang hoạt động
9. **Ghi log** - Tại `runtime/orchestrator.log`
10. **Lưu state** - PID của processes tại `runtime/orchestrator-state.json`

## Output Example

```
[2026-07-11 01:30:00] Checking Node.js...
[2026-07-11 01:30:00] Node.js 20.15.1 found.
[2026-07-11 01:30:00] Checking workspace config...
[2026-07-11 01:30:00] Workspace: package
[2026-07-11 01:30:00] Checking local API token...
[2026-07-11 01:30:00] Found existing API token.
[2026-07-11 01:30:00] Starting local API on http://127.0.0.1:18401...
[2026-07-11 01:30:00] API started (PID: 12345)

========================================
  Tiiextension Orchestrator Status
========================================
API:      running at http://127.0.0.1:18401
MCP:      running (PID: 12346, stdio mode)
Tunnel:   https://abc123.trycloudflare.com
========================================
```

## Files Created

- `scripts/tiiextension-up.ps1` - Orchestrator startup script
- `scripts/tiiextension-down.ps1` - Orchestrator shutdown script
- `native-host/bin/orchestrator.js` - Node.js orchestrator module
- `native-host/bin/agent-cli.js` - Updated with up/down/status commands
- `runtime/orchestrator-state.json` - Process state (PID tracking)
- `runtime/orchestrator.log` - Orchestrator log