# Verification report — Tiiextension v1.1.0

Date: 2026-07-11

This release was verified in the packaging workspace before building the final ZIP. v1.1 scope adds Cloudflare Tunnel templates, OpenAPI Custom Action, MCP bridge, `/v1/agent/goal`, and filesystem index/cache tools.

## Automated evidence

```bash
npm test
# tests 77, pass 77, fail 0

npm run check
# Syntax OK: 65 JavaScript files

npm run static-check
# ok: true
# popup modes: ui, api
# side panel tabs: agent, files, changes, activity

node native-host/bin/agent-cli.js doctor --config native-host/config/default.workspaces.json
# ok: true
# protocol: cnagent/1
# host_version: 1.1.0

node native-host/bin/agent-cli.js tools --config native-host/config/default.workspaces.json
# tool_count: 65
# includes fs.watch.start, fs.index.search and payload.load

npm run package:dry-run
# release inventory excludes runtime state, logs, data, secrets, snapshots,
# artifacts, transactions, node_modules and generated ZIP/checksum files.
# outputPath: ../Tiiextension-v1.1.0.zip
# root folder: Tiiextension/
```

## Covered contracts

- MV3 extension manifest, popup `UI/API` contract, side panel tabs and DOM-safe rendering.
- Structured JSON block parsing for `agent_action`, `tool_call`, `payload_load` and related cnagent/1 envelopes.
- ChatGPT Web adapter state handling, provider queueing, timeout/cancel behavior and browser-control guardrails.
- Native messaging framing, runtime handshake, durable task/event store, idempotency, audit redaction/hash chain and artifact externalization.
- Workspace guard, filesystem transactions, unified diff, encoding/BOM/EOL behavior, snapshots/rollback, search/hash/glob and filesystem watch.
- Process supervisor policy/timeout/output limits, project tools and hot payload validation/execution.
- Local HTTP/WebSocket API auth/origin checks and replay behavior.
- Local API `/v1/agent/goal` enqueue contract.
- Cloudflare Tunnel placeholders and helper scripts.
- OpenAPI Custom Action schema for GPT direct control through a tunnel.
- Dependency-free MCP bridge tool list and tool call mapping.
- Windows installer/repair/doctor/uninstall static contract and release packaging inventory.

## Explicit limitations

- The Linux packaging container cannot run the real Chrome/Edge Windows native messaging registry path.
- The release has not been store-signed or installer-code-signed.
- Authenticated ChatGPT Web end-to-end testing must be run on the target Windows machine after loading the unpacked extension and running the included native-host installer.
- The implementation does not extract or proxy ChatGPT cookies, access tokens or session secrets. It uses the active browser tab/provider bridge.
