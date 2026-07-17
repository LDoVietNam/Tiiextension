# Tiiextension Runtime Directory

This directory is used by the orchestrator to store:

- `orchestrator.log` - Combined log output from all services
- `orchestrator-pids.json` - Process IDs for managing services
- `orchestrator-status.json` - Current status of all services

## Usage

### Start all services (PowerShell)
```powershell
.\scripts\tiiextension-up.ps1 -Tunnel -Mcp
```

### Stop all services (PowerShell)
```powershell
.\scripts\tiiextension-down.ps1
```

### Using CLI directly
```bash
node .\native-host\bin\agent-cli.js up --tunnel --mcp
node .\native-host\bin\agent-cli.js down
node .\native-host\bin\agent-cli.js status
```

## Status Output

When started, the orchestrator outputs:
```
API: running at http://127.0.0.1:18401
MCP: running over stdio/manual
Tunnel: running at https://xxxx.trycloudflare.com
```

If Cloudflare token is missing:
```
Tunnel: skipped, CLOUDFLARE_TUNNEL_TOKEN missing