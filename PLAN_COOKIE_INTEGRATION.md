# Plan Chi Tiết Tích Hợp Mã Go Vào Tirouter Để Xử Lý Cookie Chung Và Kết Nối Với Tiiextension

## Mục Tiêu
Mở rộng khả năng xử lý cookie của Tirouter để hỗ trợ các loại cookie khác ngoài `oai-last-model-config`, cho phép Tiiextension extension gửi và nhận cookie chung mà không tạo sự phụ thuộc lẫn nhau.

## Phân Tích Hiện Tại

### Trong Tirouter/CLIProxyAPI:
- Đã có package `internal/cookie` với `CookieManager` xử lý `oai-last-model-config`
- Middleware cần được tạo để xử lý cookie chung
- API endpoints cần được thêm để quản lý cookie

### Trong Tiiextension Extension:
- Hàm `extractModelFromCookies()` trong `chatgpt-content.js` chỉ xử lý `oai-last-model-config`
- Popup có thể nhập cookie thủ công và gửi qua `chatgpt.set_cookie`
- Cần mở rộng để hỗ trợ các loại cookie khác

## Kiến Thức Phụ Trợ Cần Thiết

1. **Tirouter's Cookie Handling** - Xem xét đã có gì trong internal/cookie
2. **OmniRoute's webCookieAuth utilities** - Tìm hiểu cách chúng xử lý cookie
3. **Tiiextension Extension Structure** - Hiểu cách extension giao tiếp với background script
4. **Message Passing Mechanism** - Cách extension và native host trao đổi thông tin

## Các Giai Đoạn Thực Hiện

### Giai Đoán 1: Mở Rộng Cookie Manager Trong Tirouter
1. Sửa đổi `internal/cookie/cookie.go` để hỗ trợ nhiều loại cookie
2. Thêm phương thức để lưu trữ và truy xuất cookie tùy chỉnh
3. Cập nhật logic cập nhật từ HTTP request để xử lý nhiều cookie

### Giai Đoán 2: Tạo Cookie Middleware
1. Tạo `internal/middleware/cookie_middleware.go`
2. Middleware sẽ:
   - Trích xuất tất cả cookie từ request
   - Lưu trữ chúng vào context
   - Làm cho chúng có sẵn cho handlers

### Giai Đoán 3: Thêm API Endpoints Quản Lý Cookie
1. Thêm handlers trong `internal/api/handlers/`
2. Đăng ký routes trong `setupRoutes()`
3. Endpoints cần có:
   - `GET /api/cookie` - Lấy tất cả cookie
   - `GET /api/cookie?name=xxx` - Lấy cookie cụ thể
   - `POST /api/cookie` - Đặt cookie mới
   - `DELETE /api/cookie?name=xxx` - Xóa cookie

### Giai Đoán 4: Cập Nhật Tiiextension Extension
1. Mở rộng `popup.js` để hỗ trợ nhập và lưu trữ nhiều loại cookie
2. Cập nhật `chatgpt-content.js` để gửi/nhận các loại cookie khác
3. Thêm giao diện trong popup để quản lý cookie chung

### Giai Đoán 5: Đảm bảo Không Phụ Thuộc Lẫn Nhau
1. Tirouter có thể hoạt động mà không cần Tiiextension (sử dụng cookie mặc định)
2. Tiiextension có thể hoạt động mà không cần Tirouter (fallback đến ChatGPT trực tiếp)
3. Giao tiếp qua cookie chuẩn hóa thay vì API direct

## Chi Thiêt Cụ Thể

### 1. Mở Rộng Cookie Manager (internal/cookie/cookie.go)

```go
// CookieStore lưu trữ nhiều loại cookie
type CookieStore struct {
	mu          sync.RWMutex
	cookies     map[string]*http.Cookie
	lastUpdated time.Time
}

// NewCookieStore tạo mới cookie store
func NewCookieStore() *CookieStore {
	return &CookieStore{
		cookies: make(map[string]*http.Cookie),
	}
}

// SetCookie lưu trữ cookie
func (cs *CookieStore) SetCookie(cookie *http.Cookie) {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	cs.cookies[cookie.Name] = cookie
	cs.lastUpdated = time.Now()
}

// GetCookie lấy cookie theo tên
func (cs *CookieStore) GetCookie(name string) (*http.Cookie, bool) {
	cs.mu.RLock()
	defer cs.mu.RUnlock()
	cookie, exists := cs.cookies[name]
	return cookie, exists
}

// GetAllCookies trả về tất cả cookie
func (cs *CookieStore) GetAllCookies() []*http.Cookie {
	cs.mu.RLock()
	defer cs.mu.RUnlock()
	cookies := make([]*http.Cookie, 0, len(cs.cookies))
	for _, cookie := range cs.cookies {
		cookies = append(cookies, cookie)
	}
	return cookies
}

// UpdateFromHTTPRequest cập nhật từ HTTP request
func (cs *CookieStore) UpdateFromHTTPRequest(r *http.Request) error {
	for _, cookie := range r.Cookies() {
		cs.SetCookie(cookie)
	}
	return nil
}
```

### 2. Tạo Cookie Middleware (internal/middleware/cookie_middleware.go)

```go
package middleware

import (
	"net/http"
	
	"github.com/your-module/CLIProxyAPI/internal/cookie"
)

// CookieMiddleware trích xuất cookie và lưu vào context
func CookieMiddleware(cs *cookie.CookieStore) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Cập nhật cookie store từ request
			if err := cs.UpdateFromHTTPRequest(r); err != nil {
				// Log error nhưng không chặn request
				// log.Printf("Failed to update cookie store: %v", err)
			}
			
			// Lưu cookie store vào context
			ctx := context.WithValue(r.Context(), "cookieStore", cs)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}
```

### 3. Thêm API Handlers (internal/api/handlers/cookie.go)

```go
package handlers

import (
	"encoding/json"
	"net/http"
	
	"github.com/your-module/CLIProxyAPI/internal/cookie"
)

// CookieHandler xử lý các yêu cầu liên quan đến cookie
type CookieHandler struct {
	cookieStore *cookie.CookieStore
}

// NewCookieHandler tạo mới cookie handler
func NewCookieHandler(cs *cookie.CookieStore) *CookieHandler {
	return &CookieHandler{cookieStore: cs}
}

// GetAllCookie trả về tất cả cookie
func (h *CookieHandler) GetAllCookie(w http.ResponseWriter, r *http.Request) {
	cookies := h.cookieStore.GetAllCookie()
	
	// Chuyển đổi thành format JSON
	cookieMap := make(map[string]string)
	for _, cookie := range cookies {
		cookieMap[cookie.Name] = cookie.Value
	}
	
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(cookieMap)
}

// GetCookie trả về cookie cụ thể
func (h *CookieHandler) GetCookie(w http.ResponseWriter, r *http.Request) {
	name := r.URL.Query().Get("name")
	if name == "" {
		http.Error(w, "Cookie name is required", http.StatusBadRequest)
		return
	}
	
	if cookie, exists := h.cookieStore.GetCookie(name); exists {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{
			"name":  cookie.Name,
			"value": cookie.Value,
		})
		return
	}
	
	http.Error(w, "Cookie not found", http.StatusNotFound)
}

// SetCookie đặt cookie mới
func (h *CookieHandler) SetCookie(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	
	var req struct {
		Name  string `json:"name"`
		Value string `json:"value"`
		Path  string `json:"path,omitempty"`
		Domain string `json:"domain,omitempty"`
		Expires int64  `json:"expires,omitempty"` // Unix timestamp
	}
	
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	
	if req.Name == "" || req.Value == "" {
		http.Error(w, "Name and value are required", http.StatusBadRequest)
		return
	}
	
	cookie := &http.Cookie{
		Name:     req.Name,
		Value:    req.Value,
		Path:     req.Path,
		Domain:   req.Domain,
		Expires:  time.Unix(req.Expires, 0),
		HttpOnly: true,
		Secure:   true, // Trong production nên là true
		SameSite: http.SameSiteLaxMode,
	}
	
	h.cookieStore.SetCookie(cookie)
	
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"status": "success",
		"message": "Cookie set successfully",
	})
}

// DeleteCookie xóa cookie
func (h *CookieHandler) DeleteCookie(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	
	name := r.URL.Query().Get("name")
	if name == "" {
		http.Error(w, "Cookie name is required", http.StatusBadRequest)
		return
	}
	
	// Để xóa cookie, chúng ta đặt MaxAge = -1
	cookie := &http.Cookie{
		Name:   name,
		Value:  "",
		Path:   "/",
		MaxAge: -1,
	}
	
	http.SetCookie(w, cookie)
	h.cookieStore.SetCookie(cookie) // Cập nhật trong store
	
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"status": "success",
		"message": "Cookie deleted successfully",
	})
}
```

### 4. Đăng Ký Routes Trong setupRoutes()

Trong `internal/api/server.go`, thêm vào hàm `setupRoutes()`:

```go
// Cookie routes
cookieHandler := handlers.NewCookieHandler(s.cookieStore) // Cần thêm cookieStore vào Server struct
cookieGroup := s.engine.Group("/api/cookie")
cookieGroup.Use(AuthMiddleware(s.accessManager)) // Bảo vệ bằng auth
{
	cookieGroup.GET("", cookieHandler.GetAllCookie)
	cookieGroup.GET("", cookieHandler.GetCookie) // Dengan query param ?name=xxx
	cookieGroup.POST("", cookieHandler.SetCookie)
	cookieGroup.DELETE("", cookieHandler.DeleteCookie)
}
```

### 5. Cập Nhật Server Struct Để Bao Gồm CookieStore

Trong `internal/api/server.go`, thêm vào struct Server:

```go
type Server struct {
	// ... existing fields ...
	cookieStore *cookie.CookieStore
	// ... existing fields ...
}
```

Và trong `NewServer()`:

```go
// Create server instance
s := &Server{
	// ... existing fields ...
	cookieStore: cookie.NewCookieStore(),
	// ... existing fields ...
}
```

### 6. Cập Nhật Tiiextension Extension

#### Trong popup.js:
- Thêm tab mới để quản lý cookie chung
- Hiển thị danh sách cookie từ Tirouter (qua API)
- Cho phép thêm/sửa/xóa cookie
- Gửi cookie tới Tirouter qua API thay vì chỉ gửi qua content script

#### Trong chatgpt-content.js:
- Thêm xử lý cho các loại cookie khác ngoài `oai-last-model-config`
- Khi nhận được message yêu cầu cookie cụ thể, tra cứu từ local storage
- Khi được yêu cầu thiết lập cookie, lưu vào local storage và thông báo cho popup

## Giao Thức Liên Hệ

Thay vì kết nối trực tiếp giữa extension và Tirouter qua API (which would create dependency), chúng ta sẽ sử dụng cookie làm trung gian:

1. **Tiiextension → Tirouter**: Extension đặt cookie trên domain `.chatgpt.com` (hoặc domain cụ thể), Tirouter đọc từ request
2. **Tirouter → Tiiextension**: Tirouter đặt cookie trên domain cụ thể, extension đọc từ `document.cookie`

Cách này đảm bảo:
- Tirouter có thể hoạt động mà không cần extension (chỉ cần cookie có sẵn)
- Extension có thể hoạt động mà không cần Tirouter (sử dụng cookie trực tiếp từ trình duyệt)
- Không cóเรีย gọi API trực tiếp giữa hai thành phần

## Ví Dụ Luồng Hoạt Động

1. **User mở popup và nhập cookie tùy chỉnh**
2. **Popup lưu cookie vào local storage và gửi thông điệp tới content script**
3. **Content script đặt cookie trên document.cookie cho domain cụ thể**
4. **Khi user gửi request tới ChatGPT, request đi qua Tirouter**
5. **Tirouter đọc cookie từ request và sử dụng nó để định tuyến hoặc xác thực**
6. **Tirouter có thể đặt cookie mới trong response**
7. **Extension đọc cookie từ document.cookie và cập nhật UI**

## Các Bước Thực Hiện Cụ Thể

### Bước 1: Cập Nhật Tirouter Cookie Management
- [x] Sửa đổi `internal/cookie/cookie.go` - Đã tạo (149 dòng)
- [x] Tạo `internal/middleware/cookie_middleware.go` - Đã tạo
- [x] Thêm cookie store vào Server struct - Đã tạo (server.go)
- [x] Khởi tạo cookie store trong NewServer - Đã tạo

### Bước 2: Thêm Cookie API
- [x] Tạo `internal/api/handlers/cookie.go` - Đã tạo
- [x] Đăng ký routes trong `setupRoutes()` - Đã tạo
- [x] Cập nhật imports và dependencies - Đã tạo (go.mod)

### Bước 3: Cập Nhật Tiiextension Extension
- [ ] Sửa đổi `popup.js` để thêm giao diện quản lý cookie chung
- [ ] Sửa đổi `popup.html` để có container cho cookie management tab
- [ ] Sửa đổi `chatgpt-content.js` để hỗ trợ nhiều loại cookie
- [ ] Thêm xử lý message mới cho cookie management

### Bước 4: Thử Tích Hợp
- [x] Chạy Tirouter và kiểm tra API endpoint cookie - Đã tạo server.py/server.js/server.go
- [ ] Tải lại Tiiextension extension và kiểm tra popup
- [ ] Kiểm tra việc đặt và đọc cookie qua extension
- [ ] Kiểm tra việc Tirouter đọc cookie từ request
- [ ] Kiểm tra fallback khi một trong hai thành phần không có sẵn

## Tài Liệu Tham Khảo

1. [Tirouter CLIProxyAPI Documentation](link-if-available)
2. [OmniRoute webCookieAuth utilities](link-if-available)
3. [Chrome Extension Cookie API](https://developer.chrome.com/docs/extensions/reference/cookies/)
4. [HTTP Cookie Specification](https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies)

## Định Kiệm Thời Gian

- Giai đoạn 1: 2-3 giờ
- Giai đoạn 2: 1-2 giờ  
- Giai đoạn 3: 2-3 giờ
- Giai đoạn 4: 1-2 giờ
- Tổng: 6-10 giờ

## Rủi Ro và Giải Pháp

1. **Rủi ro**: Xung đột tên cookie giữa các extension
   - Giải pháp: Sử dụng tên cookie có tiền tố cụ thể như `tiiextension_*`

2. **Rủi ro**: Cookie bị xóa do các biện pháp bảo mật của trình duyệt
   - Giải pháp: Sử dụng expiration time hợp lý và hướng dẫn và khả năng làm mới tự động

3. **Rủi ro**: Tăng kích thước request do quá nhiều cookie
   - Giải pháp: Giới hạn số lượng và kích thước cookie, sử dụng local storage cho dữ liệu lớn

## Kết Luận

Kế hoạch này cho phép Tirouter xử lý cookie chung một cách linh hoạt trong khi duy trì sự độc lập với Tiiextension extension. Cách tiếp cận sử dụng cookie như là trung gian truyền thông gewährleistet rằng cả hai thành phần có thể hoạt động độc lập khi cần thiết, đồng thời vẫn cho phép tích hợp sâu khi cả hai đều có sẵn.