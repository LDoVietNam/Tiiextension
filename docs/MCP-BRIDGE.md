# MCP Bridge

`mcp-bridge/` is a dependency-free stdio MCP bridge for Tiiextension.

It maps MCP:

```text
tools/list
tools/call
```

to Tiiextension:

```text
GET/POST http://127.0.0.1:18401/v1/tools/call
```

Start:

```powershell
$env:TIIEXTENSION_API_URL="http://127.0.0.1:18401"
$env:TIIEXTENSION_API_TOKEN="<local api token>"
node .\mcp-bridge\src\server.js
```

Primary tools exposed include filesystem read/write/search/patch/snapshot/rollback/watch/index, `project.summary`, and `process.run`.
