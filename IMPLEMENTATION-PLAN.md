# KẾ HOẠCH TRIỂN KHAI: Tiiextension v2 - Milestone A Refactor

## Tóm tắt kiến trúc mới (theo phản tính)

```text
ChatGPT Web / Claude Web / Gemini Web
                  │
            Tiiextension (Browser Adapter)
                  │
                  ▼
              TiRouter (Gateway + Policy)
                      │
              ┌───────┴────────┐
              ▼                ▼
   Native Host         Context Bridge
   (Context Runtime)  (via Native Messaging)
              │                │
              └───────┬────────┘
                      ▼
            Z:\01_PROJECTS\apps
```

### Phân vai trách nhiệm mới

| Thành phần | Trách nhiệm |
|--------------|-------------|
| **Tiiextension** | Browser adapter, session bridge, hiển thị trạng thái |
| **Native Host** | Context Runtime, Tool Execution, TiRouter Client |
| **TiRouter** | Gateway, authentication, routing, policy |
| **_workspace** | Source of truth cho workspace và service |

---

## MILESTONE A: Native Host Refactor - Context Runtime

### Mục tiêu
Biến Native Host thành Context Runtime duy nhất cho toàn hệ thống

### Thành phần đã tạo (2026-07-16)

#### 1. Context Services (native-host/src/context/)

| File | Mô tả |
|------|-------|
| `workspace-service.js` | Quản lý workspace, permission, root path |
| `revision-service.js` | Tính SHA-256, track git changes |
| `repository-service.js` | File read, list, stat, text search |
| `search-service.js` | Tìm kiếm nâng cao, symbol extraction |
| `symbol-service.js` | Symbol index, references, dependency graph |

#### 2. Orchestration Layer (native-host/src/orchestration/)

| File | Mô tả |
|------|-------|
| `request-dispatcher.js` | Dispatch tool calls đến context/execution/router |

#### 3. Clients (native-host/src/clients/)

| File | Mô tả |
|------|-------|
| `ti-router-client.js` | Giao tiếp với TiRouter (port 1870) |

#### 4. Adapters (native-host/src/adapters/)

| File | Mô tả |
|------|-------|
| `tool-call-forwarder.js` | Normalize và forward tool calls |

### API Endpoints mới (qua Native Host)

```
GET  /health                    → Health check
GET  /v1/workspace/:id          → Thông tin workspace
GET  /v1/files/:path            → Đọc file
POST /v1/search                 → Tìm kiếm text
GET  /v1/symbols                → Symbol index
GET  /v1/git/status             → Git status
GET  /v1/git/diff               → Git diff
GET  /v1/revision               → Revision tracking
```

---

## MỤC TIÊU HOÀN THÀNH Milestone A

### ✅ Đã hoàn thành

1. **Tạo cấu trúc thư mục mới**
   - `native-host/src/context/` - 5 service
   - `native-host/src/orchestration/` - 1 dispatcher
   - `native-host/src/clients/` - 1 client
   - `native-host/src/adapters/` - 1 adapter

2. **Tạo workspace registry chung**
   - `Z:\01_PROJECTS\apps\_workspace\workspace-registry.json`
   - Extension đọc từ đây thay vì duplicate

3. **Tạo compatibility wrapper**
   - `extension/src/ti-router-client.js` - Wrapper gọi Native Host
   - Hỗ trợ cả native messaging và HTTP fallback

4. **Cập nhật workspace-registry.js**
   - Đọc từ `_workspace` chung
   - Hỗ trợ cross-project access

### 🚧 Còn thiếu

1. **Integration tests** - Verify Native Host → TiRouter flow
2. **Build verification** - Extension build pass
3. **Rollback documentation** - Hướng dẫn rollback nếu có vấn đề

---

## NEXT STEPS

### Phase 1: Verification (1-2 ngày)
- [ ] Chạy build extension
- [ ] Chạy tests native-host
- [ ] Verify read/search/git status hoạt động
- [ ] Verify TiRouter health qua Native Host

### Phase 2: Migration (1-2 ngày)
- [ ] Update manifest.json permissions
- [ ] Thêm documentation cho migration
- [ ] Tạo rollback script

### Phase 3: Cleanup (1 ngày)
- [ ] Xóa deprecated files cũ
- [ ] Update docs
- [ ] Final testing

---

## FILES ĐÃ TẠO MỚI

```
native-host/
├── src/
│   ├── context/
│   │   ├── workspace-service.js
│   │   ├── revision-service.js
│   │   ├── repository-service.js
│   │   ├── search-service.js
│   │   └── symbol-service.js
│   ├── orchestration/
│   │   └── request-dispatcher.js
│   ├── clients/
│   │   └── ti-router-client.js
│   └── adapters/
│       └── tool-call-forwarder.js

_workspace/
└── workspace-registry.json

extension/
├── src/
│   ├── ti-router-client.js  (updated - compatibility wrapper)
│   └── workspace-registry.js (updated - reads from _workspace)
└── config/
    └── workspaces.json      (deprecated reference)

tree-bundle.txt              (project tree snapshot)
```

---

## RISKS & MITIGATION

| Risk | Mitigation |
|------|------------|
| Native Host không khớp với extension | Compatibility wrapper, fallback HTTP |
| Workspace registry thiếu | Graceful degradation với default config |
| Tool call không hoạt động | Native messaging + HTTP dual mode |
| Revision tracking sai | SHA-256 checksum verification |