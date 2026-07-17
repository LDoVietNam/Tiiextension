# Tiiextension MCP Bridge

Dependency-free stdio MCP bridge for Tiiextension local API.

```powershell
$env:TIIEXTENSION_API_URL="http://127.0.0.1:18401"
$env:TIIEXTENSION_API_TOKEN="<local api token>"
node .\mcp-bridge\src\server.js
```

The bridge maps MCP `tools/list` and `tools/call` to Tiiextension `/v1/tools/call`.
