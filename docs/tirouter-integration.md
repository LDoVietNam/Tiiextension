# Hướng dẫn Tích hợp Tirouter với Tiiextension

## Kiến trúc Tổng quan

```
┌─────────────────┐       ┌──────────────────┐
│ Tiiextension    │       │ Tirouter         │
│ Extension       │       │ CLIProxyAPI        │
│                 │       │                  │
│ - popup.js      │<----->│ - /api/cookie    │
│ - chatgpt-      │       │ - Cookie         │
│   content.js    │       │   Middleware     │
│ - sidepanel.js  │       │ - CookieStore    │
└─────────────────┘       └──────────────────┘
         |                          |
         | document.cookie            | HTTP Request/Response
         v                          v
┌─────────────────────────────────────────┐
│              Cookie Layer               │
│  (oai-last-model-config, tii_*)         │
└─────────────────────────────────────────┘
```

## Luồng Giao tiếp (Không phụ thuộc)

### Từ Extension -> Tirouter
1. Extension đặt cookie trên `document.cookie`:
```javascript
document.cookie = "tiiextension_model=gpt-4; path=/; domain=.chatgpt.com";
```

2. Browser tự động gửi cookie khi request tới Tirouter
3. `CookieMiddleware` trích xuất và lưu vào `CookieStore`

### Từ Tirouter -> Extension
1. Tirouter đọc cookie từ `CookieStore`
2. Khi có response, đặt cookie trong HTTP response
3. Extension đọc từ `document.cookie` hoặc gọi API `/api/cookie/{name}`

## Cấu hình Extension

Thêm vào `manifest.json` để hỗ trợ cookie cross-domain:

```json
{
  "permissions": ["cookies"],
  "host_permissions": [
    "http://localhost:1840/*",
    "https://*.chatgpt.com/*"
  ]
}
```

## API Endpoints

| Endpoint | Phương thức | Mô tả |
|----------|-------------|------|
| GET /api/cookie | GET | Lấy tất cả cookie |
| GET /api/cookie/{name} | GET | Lấy cookie cụ thể |
| POST /api/cookie | POST | Đặt cookie mới |
| DELETE /api/cookie/{name} | DELETE | Xóa cookie |
| POST /v1/agent/runs | POST | Chạy agent (allowed_tools, prompt) |
| GET /health | GET | Kiểm tra trạng thái |

## Cookie Names Chuẩn

- `oai-last-model-config` - Cookie model config từ ChatGPT
- `tiiextension_model` - Thông tin model hiện tại
- `tiiextension_session` - Session ID
- `tiiextension_auth` - Auth token (nếu cần)

## Testing

```bash
# Khoi dong server
cd Tirouter/CLIProxyAPI
go run cmd/server/main.go

# Test API
curl http://localhost:1840/api/cookie
curl http://localhost:1840/health
```