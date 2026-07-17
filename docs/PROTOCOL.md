# Protocol `cnagent/1`

`cnagent/1` dùng cho structured blocks giữa ChatGPT/extension và length-prefixed JSON giữa extension/native host. Mục tiêu là validation rõ, idempotency cho mutation, error ổn định và artifact reference cho dữ liệu lớn.

## Envelope

```json
{
  "protocol": "cnagent/1",
  "task_id": "task_example",
  "block_id": "block_unique",
  "tool_call": {
    "call_id": "call_unique",
    "tool": "fs.read",
    "args": { "path": "README.md" },
    "idempotency_key": "task_example:block_unique"
  }
}
```

Envelope bắt buộc `protocol`, `block_id` và đúng một business key: `agent_goal`, `agent_action`, `tool_call`, `payload_load`, `task_result`, `task_event`; các filesystem legacy blocks vẫn được normalize để tương thích. JSON Schema nằm trong `schemas/protocol-envelope.schema.json`.

## Block types

- `agent_goal`: goal, workspace profile, success criteria và max iterations. UI/local client tạo goal; model không tự tạo task ngoài context hiện tại.
- `agent_action`: browser action cùng args/timeout.
- `tool_call`: native/browser tool, args, call ID và idempotency key.
- `payload_load`: manifest path, optional expected name/version.
- `task_result`: ok/error, summary, data, artifacts và metrics.
- `task_event`: cursor, type, timestamp và data.

Mỗi executable action nên ở một fenced JSON block riêng. Parser bỏ block có nhiều business key, protocol lạ hoặc payload không phải object. Block legacy thiếu ID nhận deterministic compatibility ID, nhưng client mới không nên dựa vào hành vi đó.

## Native handshake

Request:

```json
{
  "type": "runtime.handshake",
  "payload": {
    "protocols": ["cnagent/1"],
    "client": "chrome-extension",
    "requested_capabilities": ["tasks", "filesystem", "payloads", "events"]
  }
}
```

Response trả `host_id`, `host_version`, selected `protocol`, capabilities, limits, active profile, workspaces, mode và random `session_nonce`. Extension ưu tiên `com.chatgpt_native_agent.host`; OpenAI compatibility host chỉ được nhận nếu handshake phù hợp, không chỉ vì tên host tồn tại.

Native Messaging frame là 4 byte little-endian unsigned length + UTF-8 JSON. Host giới hạn kích thước, từ chối JSON/frame sai và externalize kết quả lớn thành `artifact_ref` có SHA-256.

## Tool call và idempotency

Mutation nên mang `task_id`, `call_id` và `idempotency_key`. Runtime ghi call trước thực thi; replay cùng key trả result đã lưu. Một key không được tái sử dụng cho một operation khác.

Filesystem mutation tự mở/commit transaction nếu không có transaction ID. Với explicit transaction, client gọi begin, stage nhiều tool, preview, rồi commit/rollback.

## Errors

Boundary trả error object có:

```json
{
  "ok": false,
  "error": {
    "code": "WORKSPACE_OUTSIDE_ROOT",
    "message": "Path is outside configured workspaces",
    "retryable": false
  }
}
```

Nhóm code chính: `PROTOCOL_*`, `POLICY_*`, `WORKSPACE_*`, `FILESYSTEM_*`, `PROCESS_*`, `PAYLOAD_*`, `PROVIDER_*`, `TASK_*`, `API_*`, `NATIVE_*`. Không dùng message text làm machine contract.

## Task states và events

Task đi qua `queued`, `planning`, `awaiting_model`, `executing`, `verifying`, rồi terminal `completed`, `failed`, `cancelled` hoặc `rolled_back`. Event bus cấp cursor tăng đơn điệu; API/WS reconnect bằng `after_cursor`. Nếu cursor quá cũ do retention, response đánh dấu `pruned` và client phải refresh task snapshot.

## Provider boundary

Extension gửi prompt qua tab ChatGPT Web đang đăng nhập và đọc response bằng DOM/accessibility state. Cookie/session/token không thuộc protocol. Local API token là secret riêng, không cấp quyền gọi model ngoài browser. `/v1/chat` phải trả `PROVIDER_UNAVAILABLE` khi extension/provider bridge không kết nối.

## Protocol `ti-web-agent/1` (ChatGPT Web Integration)

`ti-web-agent/1` được sử dụng cho các tool call giữa ChatGPT Web và extension. Protocol này cho phép AI gọi các tool local (đọc file, git, v.v.) và nhận kết quả trả về.

### Envelope

```json
{
  "protocol": "ti-web-agent/1",
  "type": "tool_call",
  "id": "call_1234567890",
  "tool": "fs.read",
  "arguments": {
    "workspaceId": "tiiextension",
    "path": "README.md"
  }
}
```

### Message Types

| Type | Purpose |
|------|---------|
| `tool_call` | AI yêu cầu thực thi một tool |
| `tool_result` | Kết quả trả về từ tool (ok/error) |
| `final` | Response cuối cùng từ AI |

### Tool Call Flow

1. AI phản hồi với JSON tool_call trong block code
2. Extension parse bằng `ChatGptToolCallParser`
3. `ExecutionController.handleToolCall()` dispatch tới Context Bridge
4. Context Bridge thực thi và trả về result
5. `ChatGptResultInjector.injectFinalResponse()` chèn result vào DOM
6. AI nhận result và tiếp tục conversation

### Available Tools

| Tool | Description | Arguments |
|------|-------------|-----------|
| `fs.read` | Read file content | `{ workspaceId, path }` |
| `fs.list` | List directory | `{ workspaceId, path }` |
| `fs.search_text` | Search text in files | `{ workspaceId, pattern, path }` |
| `git.status` | Git status | `{ workspaceId, path }` |
| `git.diff` | Git diff | `{ workspaceId, path }` |

### Result Injection Format

Kết quả được inject dưới dạng code block JSON:

```
Here is the result:
```json
{ "ok": true, "result": { "content": "...", "path": "README.md" } }
```
```

Xem chi tiết tại: `docs/EXECUTION_FLOWCHART.md`
