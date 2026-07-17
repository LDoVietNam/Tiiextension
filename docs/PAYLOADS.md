# Hot payloads

Runtime hỗ trợ hai loại payload trong workspace/payload roots: `module` và `command`. Dev mode tối ưu vòng lặp phát triển; release mode fail closed bằng SHA-256 + Ed25519.

## Module payload

```json
{
  "schema": "cnagent-payload/1",
  "name": "hello.payload",
  "version": "1.0.0",
  "type": "module",
  "entry": "./index.js",
  "capabilities": [],
  "methods": {
    "run": { "timeout_ms": 30000 }
  }
}
```

Module default-export một async factory, trả object methods. Nó chạy trong `worker_threads`, có memory limit, timeout, crash isolation và request correlation. Worker không nhận native runtime internals. Đây không phải OS sandbox; chỉ load code đã review, đặc biệt ở release.

## Command payload

```json
{
  "schema": "cnagent-payload/1",
  "name": "format.payload",
  "version": "1.0.0",
  "type": "command",
  "command": "node",
  "args": ["./format.mjs", "{{path}}"],
  "cwd": ".",
  "timeout_ms": 60000,
  "capabilities": ["filesystem.read", "filesystem.write"]
}
```

Template chỉ thay `{{key}}` bằng args; không mở shell. Command vẫn phải qua process allowlist, cwd workspace guard, environment scrub, output limit và cancellation.

## Load/call/reload

```bash
node native-host/bin/agent-cli.js tool payload.validate --args '{"path":"payloads/examples/hello/manifest.json"}'
node native-host/bin/agent-cli.js tool payload.load --args '{"path":"payloads/examples/hello/manifest.json"}'
node native-host/bin/agent-cli.js tool payload.call --args '{"name":"hello.payload","method":"run","args":{"name":"Agent"}}'
node native-host/bin/agent-cli.js tool payload.reload --args '{"path":"payloads/examples/hello/manifest.json","name":"hello.payload"}'
node native-host/bin/agent-cli.js tool payload.unload --args '{"name":"hello.payload"}'
```

## Release signature

Release manifest có thêm:

```json
{
  "sha256": "HEX_SHA256_OF_ENTRY_OR_COMMAND_CONTRACT",
  "signature": {
    "algorithm": "ed25519",
    "key_id": "publisher-2026",
    "value": "BASE64_SIGNATURE"
  }
}
```

Với module, `sha256` là hash file entry. Với command, hash bao phủ chuỗi `command`, NUL và args nối NUL. Signature bao phủ canonical JSON của toàn manifest sau khi bỏ riêng `signature.value`; key order được sort đệ quy. Public key theo `key_id` nằm trong trust store do installer/admin quản lý.

Không commit private key. Pipeline release nên giữ key ngoài repo, tạo checksum sau build tái lập, ký canonical manifest, rồi chạy `payload.validate` trong release mode. Missing checksum/signature, key lạ, algorithm khác, hash mismatch hoặc signature mismatch đều bị từ chối.

Trust store mẫu trong `native-host/config/trusted-publishers.json` cố ý rỗng. Chỉ administrator thêm public keys. Model/tool không có route thay đổi trust store.
